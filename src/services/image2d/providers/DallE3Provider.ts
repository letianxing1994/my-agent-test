/**
 * OpenAI DALL-E 3 图像生成提供者
 */

import OpenAI from "openai";
import type { Image2DProvider, Image2DOptions } from "../ImageProvider";

export class DallE3Provider implements Image2DProvider {
	private client: OpenAI;

	constructor(apiKey: string, endpoint?: string) {
		this.client = new OpenAI({
			apiKey,
			baseURL: endpoint || "https://api.openai.com/v1",
		});
	}

	getName(): string {
		return "dall-e-3";
	}

	async generate(prompt: string, options?: Image2DOptions): Promise<string> {
		try {
			const response = await this.client.images.generate({
				model: "dall-e-3",
				prompt,
				size: this.parseSize(options?.size) || "1024x1024",
				quality: options?.quality === "hd" ? "hd" : "standard",
				style: options?.style === "natural" ? "natural" : "vivid",
				response_format: "b64_json",
				n: 1,
			});

			const imageData = response.data[0];
			if (!imageData.b64_json) {
				throw new Error("DALL-E未返回图像数据");
			}

			return imageData.b64_json;
		} catch (error) {
			console.error("[DallE3Provider] 图像生成失败:", error);
			throw new Error(
				`DALL-E图像生成失败: ${error instanceof Error ? error.message : "未知错误"}`,
			);
		}
	}

	/**
	 * 解析尺寸（DALL-E 3只支持特定尺寸）
	 */
	private parseSize(
		size?: string,
	): "1024x1024" | "1792x1024" | "1024x1792" | undefined {
		if (!size) return undefined;

		if (
			size === "1024x1024" ||
			size === "1792x1024" ||
			size === "1024x1792"
		) {
			return size;
		}

		// 默认正方形
		return "1024x1024";
	}
}
