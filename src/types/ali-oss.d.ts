declare module "ali-oss" {
	export default class OSS {
		constructor(options: Record<string, unknown>);
		put(
			objectKey: string,
			filePath: string,
			options?: Record<string, unknown>,
		): Promise<{ url: string }>;
		multipartUpload(
			objectKey: string,
			filePath: string,
			options?: Record<string, unknown>,
		): Promise<unknown>;
		signatureUrl(objectKey: string, options?: Record<string, unknown>): string;
		generateObjectUrl(objectKey: string): string;
	}
}
