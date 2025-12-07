/**
 * Google Gemini 3 Pro 图像生成提供者
 * 基于官方 @google/genai SDK (新版统一SDK)
 */

import { GoogleGenAI } from "@google/genai";
import type { Image2DProvider, Image2DOptions } from "../ImageProvider";

export class GeminiProProvider implements Image2DProvider {
	private apiKey: string;
	private client: GoogleGenAI;

	constructor(apiKey: string) {
		this.apiKey = apiKey;
		this.client = new GoogleGenAI({ apiKey });
	}

	getName(): string {
		return "gemini-3-pro";
	}

	async generate(prompt: string, options?: Image2DOptions): Promise<string> {
		try {
			// 解析选项
			const aspectRatio = options?.aspectRatio || "16:9";
			const imageSize = this.parseImageSize(options?.size) || "1K";

			// 发送生成请求（新SDK格式）
			const response = await this.client.models.generateContent({
				model: "gemini-3-pro-image-preview",
				contents: prompt,
				config: {
					responseModalities: ["TEXT", "IMAGE"],
					imageConfig: {
						aspectRatio: aspectRatio,
						imageSize: imageSize,
					},
				},
			});

			// 方法1：使用 response.data getter（推荐，更简洁）
			if (response.data) {
				return response.data;
			}

			// 方法2：手动从 candidates 中提取（兜底）
			if (response.candidates && response.candidates.length > 0) {
				const candidate = response.candidates[0];
				if (candidate.content?.parts) {
					for (const part of candidate.content.parts) {
						if (part.inlineData?.data) {
							return part.inlineData.data;
						}
					}
				}
			}

			throw new Error("Gemini未生成图像数据");
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
