/**
 * Google Imagen 3 图像生成提供者
 * 基于 Vertex AI API
 */

import type { Image2DProvider, Image2DOptions } from "../ImageProvider";

export class Imagen3Provider implements Image2DProvider {
	private apiKey: string;
	private endpoint: string;

	constructor(apiKey: string, endpoint: string) {
		this.apiKey = apiKey;
		this.endpoint = endpoint;
	}

	getName(): string {
		return "imagen-3";
	}

	async generate(prompt: string, options?: Image2DOptions): Promise<string> {
		try {
			// 调用 Google Vertex AI Imagen API
			const response = await fetch(`${this.endpoint}/v1/projects/YOUR_PROJECT_ID/locations/us-central1/publishers/google/models/imagen-3.0-generate-001:predict`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					instances: [
						{
							prompt,
						},
					],
					parameters: {
						sampleCount: 1,
						aspectRatio: options?.aspectRatio || "1:1",
						safetySetting: "block_some",
					},
				}),
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(`API错误: ${JSON.stringify(error)}`);
			}

			const result = await response.json();

			if (!result.predictions || result.predictions.length === 0) {
				throw new Error("Imagen未生成图像");
			}

			// 返回base64数据
			const imageData = result.predictions[0].bytesBase64Encoded;
			return imageData;
		} catch (error) {
			console.error("[Imagen3Provider] 图像生成失败:", error);
			throw new Error(
				`Imagen图像生成失败: ${error instanceof Error ? error.message : "未知错误"}`,
			);
		}
	}
}
