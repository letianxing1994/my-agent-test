import path from "node:path";
import type { Bucket } from "@google-cloud/storage";
import { Storage as GoogleStorage } from "@google-cloud/storage";
import OSS from "ali-oss";
import fs from "fs-extra";
import { getProviderConfig } from "../../config";

export interface UploadResult {
	url: string;
	provider: "aliyun" | "gcp";
	metadata?: Record<string, unknown>;
}

export interface StorageService {
	upload(
		provider: "aliyun" | "gcp",
		key: string,
		filePath: string,
		metadata?: Record<string, unknown>,
	): Promise<UploadResult>;
	uploadMultipart(
		provider: "aliyun" | "gcp",
		key: string,
		filePath: string,
		options?: {
			chunkSize?: number;
			metadata?: Record<string, unknown>;
			onProgress?: (progress: {
				uploadedBytes: number;
				totalBytes: number;
			}) => void;
		},
	): Promise<UploadResult>;
	getSignedUploadUrl(
		provider: "aliyun" | "gcp",
		key: string,
		contentType?: string,
	): Promise<{ url: string; fields?: Record<string, string> }>;
}

class CloudStorageService implements StorageService {
	private aliClient?: OSS;
	private gcsStorage?: GoogleStorage;
	private gcsBucket?: Bucket;

	private async ensureAliClient() {
		if (this.aliClient) return this.aliClient;
		const config = getProviderConfig("aliyun");
		this.aliClient = new OSS({
			bucket: config.oss.bucket,
			endpoint: config.oss.endpoint,
			accessKeyId: config.oss.accessKeyId,
			accessKeySecret: config.oss.accessKeySecret,
			secure: true,
		});
		return this.aliClient;
	}

	private async ensureGcsBucket() {
		if (this.gcsBucket) return this.gcsBucket;
		const config = getProviderConfig("gcp");
		const credentials = parseGcpCredentials(config.gcs.credentials);
		this.gcsStorage = new GoogleStorage({ credentials });
		this.gcsBucket = this.gcsStorage.bucket(config.gcs.bucket);
		return this.gcsBucket;
	}

	async upload(
		provider: "aliyun" | "gcp",
		key: string,
		filePath: string,
		metadata?: Record<string, unknown>,
	): Promise<UploadResult> {
		if (provider === "aliyun") {
			const client = await this.ensureAliClient();
			const result = await client.put(key, filePath, {
				headers: buildAliMetadataHeaders(metadata),
			});
			return {
				url: result.url,
				provider,
				metadata,
			};
		}

		const bucket = await this.ensureGcsBucket();
		await bucket.upload(filePath, {
			destination: key,
			metadata: metadata ? { metadata } : undefined,
			resumable: true,
		});

		return {
			url: `gs://${bucket.name}/${key}`,
			provider,
			metadata,
		};
	}

	async uploadMultipart(
		provider: "aliyun" | "gcp",
		key: string,
		filePath: string,
		options?: {
			chunkSize?: number;
			metadata?: Record<string, unknown>;
			onProgress?: (progress: {
				uploadedBytes: number;
				totalBytes: number;
			}) => void;
		},
	): Promise<UploadResult> {
		if (provider === "aliyun") {
			const client = await this.ensureAliClient();
			const partSize = options?.chunkSize || 16 * 1024 * 1024;
			let uploaded = 0;
			const stats = await fs.stat(filePath);
			await client.multipartUpload(key, filePath, {
				partSize,
				progress: (percentage: number) => {
					uploaded = Math.floor(percentage * stats.size);
					options?.onProgress?.({
						uploadedBytes: uploaded,
						totalBytes: stats.size,
					});
				},
				headers: buildAliMetadataHeaders(options?.metadata),
			});
			const fileUrl = client.generateObjectUrl(key);
			return {
				url: fileUrl,
				provider,
				metadata: options?.metadata,
			};
		}

		const bucket = await this.ensureGcsBucket();
		const file = bucket.file(key);
		const stats = await fs.stat(filePath);
		const chunkSize = options?.chunkSize || 16 * 1024 * 1024;

		await new Promise<void>((resolve, reject) => {
			let uploaded = 0;
			const readStream = fs.createReadStream(filePath, {
				highWaterMark: chunkSize,
			});
			const writeStream = file.createWriteStream({
				resumable: true,
				metadata: options?.metadata
					? { metadata: options.metadata }
					: undefined,
			});

			readStream.on("data", (chunk) => {
				uploaded += chunk.length;
				options?.onProgress?.({
					uploadedBytes: uploaded,
					totalBytes: stats.size,
				});
			});
			readStream.on("error", reject);
			writeStream.on("error", reject);
			writeStream.on("finish", resolve);
			readStream.pipe(writeStream);
		});

		return {
			url: `gs://${bucket.name}/${key}`,
			provider,
			metadata: options?.metadata,
		};
	}

	async getSignedUploadUrl(
		provider: "aliyun" | "gcp",
		key: string,
		contentType?: string,
	): Promise<{ url: string; fields?: Record<string, string> }> {
		if (provider === "aliyun") {
			const client = await this.ensureAliClient();
			const url = client.signatureUrl(key, {
				method: "PUT",
				expires: 3600,
				"Content-Type": contentType,
			});
			return { url };
		}

		const bucket = await this.ensureGcsBucket();
		const file = bucket.file(key);
		const [url] = await file.getSignedUrl({
			action: "write",
			expires: Date.now() + 60 * 60 * 1000,
			contentType: contentType || "application/octet-stream",
		});
		return { url };
	}
}

function buildAliMetadataHeaders(metadata?: Record<string, unknown>) {
	if (!metadata) return undefined;
	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(metadata)) {
		headers[`x-oss-meta-${key}`] = String(value);
	}
	return headers;
}

function parseGcpCredentials(raw: string) {
	if (!raw) {
		throw new Error("GCP凭据未配置");
	}
	if (raw.trim().startsWith("{")) {
		return JSON.parse(raw);
	}
	if (fs.existsSync(raw)) {
		return JSON.parse(fs.readFileSync(raw, "utf-8"));
	}
	const decoded = Buffer.from(raw, "base64").toString("utf-8");
	return JSON.parse(decoded);
}

export const storageService: StorageService = new CloudStorageService();
