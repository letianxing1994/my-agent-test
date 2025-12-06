/**
 * Google Gemini 3 Pro 图像生成提供者
 * 基于官方 @google/generative-ai SDK
 */

import {
	GoogleGenerativeAI,
	type GenerateContentConfig,
	type ImageConfig,
} from "@google/generative-ai";
import type { Image2DProvider, Image2DOptions } from "../ImageProvider";

export class GeminiProProvider implements Image2DProvider {
	private apiKey: string;
	private client: GoogleGenerativeAI;

	constructor(apiKey: string) {
		this.apiKey = apiKey;
		this.client = new GoogleGenerativeAI(apiKey);
	}

	getName(): string {
		return "gemini-3-pro";
	}

	async generate(prompt: string, options?: Image2DOptions): Promise<string> {
		try {
			// 获取模型实例
			const model = this.client.getGenerativeModel({
				model: "gemini-3-pro-image-preview",
			});

			// 解析选项
			const aspectRatio = options?.aspectRatio || "16:9";
			const imageSize = this.parseImageSize(options?.size) || "1K";

			// 配置生成参数
			const config: GenerateContentConfig = {
				responseModalities: ["text", "image"],
				imageConfig: {
					aspectRatio,
					imageSize,
				} as ImageConfig,
			};

			// 发送生成请求
			const result = await model.generateContent({
				contents: [{ role: "user", parts: [{ text: prompt }] }],
				generationConfig: config,
			});

			// 解析响应，提取图像数据
			const imagePart = result.response.parts.find((part) => part.inlineData);
			if (!imagePart?.inlineData) {
				throw new Error("Gemini未生成图像数据");
			}

			// 返回 base64 数据
			return imagePart.inlineData.data;
		} catch (error) {
			console.error("[GeminiProProvider] 图像生成失败:", error);
			throw new Error(
				`Gemini图像生成失败: ${error instanceof Error ? error.message : "未知错误"}`,
			);
		}
	}

	/**
	 * 解析图像尺寸（将通用尺寸映射为Gemini支持的格式）
	 */
	private parseImageSize(size?: string): "1K" | "2K" | "4K" {
		if (!size) return "1K";

		// 已经是Gemini格式
		if (size === "1K" || size === "2K" || size === "4K") {
			return size;
		}

		// 从像素尺寸映射
		if (size.includes("1024")) return "1K";
		if (size.includes("2048")) return "2K";
		if (size.includes("4096")) return "4K";

		return "1K"; // 默认
	}
}
