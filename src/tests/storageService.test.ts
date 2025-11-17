import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
const aliConstructor = jest.fn();
jest.mock("ali-oss", () => ({
	__esModule: true,
	default: aliConstructor,
}));

const storageConstructor = jest.fn();
jest.mock("@google-cloud/storage", () => ({
	__esModule: true,
	Storage: storageConstructor,
}));

const TEMP_CONFIG_PATH = path.join(
	os.tmpdir(),
	`cloud-config-${process.pid}.json`,
);

const mockAliClient = {
	put: jest.fn(),
	multipartUpload: jest.fn(),
	signatureUrl: jest.fn(),
	generateObjectUrl: jest.fn(),
};

const mockBucket = {
	name: "test-bucket",
	upload: jest.fn(),
	file: jest.fn(),
};

const mockFile = {
	createWriteStream: jest.fn(),
	getSignedUrl: jest.fn(),
};

beforeAll(() => {
	const config = {
		aliyun: {
			oss: {
				endpoint: "oss-cn-test.aliyuncs.com",
				bucket: "demo-bucket",
				accessKeyId: "test-key",
				accessKeySecret: "test-secret",
			},
			mysql: "",
			redis: "",
			kafka: "",
			logging: { slsProject: "", slsEndpoint: "" },
		},
		gcp: {
			gcs: {
				bucket: "gcs-bucket",
				credentials: Buffer.from(
					JSON.stringify({
						client_email: "test@example.com",
						private_key:
							"-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
						project_id: "demo",
					}),
				).toString("base64"),
			},
			mysql: "",
			redis: "",
			pubsub: "",
			logging: { sink: "" },
		},
	};
	fs.writeFileSync(TEMP_CONFIG_PATH, JSON.stringify(config), "utf-8");
	process.env.CLOUD_CONFIG_PATH = TEMP_CONFIG_PATH;
});

afterAll(() => {
	if (fs.existsSync(TEMP_CONFIG_PATH)) {
		fs.unlinkSync(TEMP_CONFIG_PATH);
	}
});

beforeEach(() => {
	jest.resetModules();
	mockAliClient.put.mockResolvedValue({ url: "https://oss/example" });
	mockAliClient.multipartUpload.mockResolvedValue({});
	mockAliClient.signatureUrl.mockReturnValue("https://oss/signed");
	mockAliClient.generateObjectUrl.mockReturnValue("https://oss/object");

	mockBucket.upload.mockResolvedValue(undefined);
	mockBucket.file.mockReturnValue(mockFile);
	mockFile.getSignedUrl.mockResolvedValue(["https://gcs/upload"]);
	mockFile.createWriteStream.mockImplementation(() => {
		const stream = new PassThrough();
		process.nextTick(() => stream.emit("finish"));
		return stream;
	});

	aliConstructor.mockReturnValue(mockAliClient);
	storageConstructor.mockImplementation(() => ({
		bucket: () => mockBucket,
	}));
});

describe("CloudStorageService", () => {
	const loadService = async () => import("../services/storage/StorageService");

	it("uploads files to Aliyun OSS", async () => {
		const { storageService } = await loadService();
		const tmpFile = path.join(os.tmpdir(), "oss-upload.txt");
		fs.writeFileSync(tmpFile, "hello-world");

		const result = await storageService.upload(
			"aliyun",
			"demo/path.txt",
			tmpFile,
			{ owner: "unit-test" },
		);

		expect(result.url).toBe("https://oss/example");
		expect(mockAliClient.put).toHaveBeenCalledWith(
			"demo/path.txt",
			tmpFile,
			expect.objectContaining({
				headers: expect.objectContaining({ "x-oss-meta-owner": "unit-test" }),
			}),
		);
	});

	it("uploads files to GCS bucket", async () => {
		const { storageService } = await loadService();
		const tmpFile = path.join(os.tmpdir(), "gcs-upload.txt");
		fs.writeFileSync(tmpFile, "hello-world");

		const result = await storageService.upload("gcp", "demo/key.bin", tmpFile);

		expect(result.url).toBe("gs://test-bucket/demo/key.bin");
		expect(mockBucket.upload).toHaveBeenCalledWith(tmpFile, {
			destination: "demo/key.bin",
			metadata: undefined,
			resumable: true,
		});
	});

	it("streams multipart uploads with progress callbacks", async () => {
		const { storageService } = await loadService();
		const tmpFile = path.join(os.tmpdir(), "multipart.bin");
		fs.writeFileSync(tmpFile, "x".repeat(1024));
		const onProgress = jest.fn();

		await storageService.uploadMultipart("aliyun", "game/build.zip", tmpFile, {
			chunkSize: 256,
			onProgress,
		});

		expect(mockAliClient.multipartUpload).toHaveBeenCalled();
		const [, , options] = mockAliClient.multipartUpload.mock.calls[0];
		options.progress(0.5);
		expect(onProgress).toHaveBeenCalled();
	});

	it("generates signed upload URLs for GCS", async () => {
		const { storageService } = await loadService();

		const result = await storageService.getSignedUploadUrl(
			"gcp",
			"inbox/object.bin",
			"application/octet-stream",
		);

		expect(result.url).toBe("https://gcs/upload");
		expect(mockFile.getSignedUrl).toHaveBeenCalled();
	});
});
