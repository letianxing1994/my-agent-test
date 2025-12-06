/**
 * 2D图像生成服务（重构版）
 * 采用策略模式，支持多种图像生成模型
 *
 * 支持的模型：
 * - gemini-3-pro: Google Gemini 3 Pro（默认）
 * - dall-e-3: OpenAI DALL-E 3
 * - stable-diffusion-xl: Stable Diffusion XL
 * - imagen-3: Google Imagen 3
 */

import fs from "fs-extra";
import path from "node:path";
import type { Image2DProvider, Image2DOptions } from "./image2d/ImageProvider";
import { GeminiProProvider } from "./image2d/providers/GeminiProProvider";
import { DallE3Provider } from "./image2d/providers/DallE3Provider";
import { StableDiffusionProvider } from "./image2d/providers/StableDiffusionProvider";
import { Imagen3Provider } from "./image2d/providers/Imagen3Provider";

/**
 * 2D图像生成服务（工厂类）
 */
export class AI2DService {
	/**
	 * 创建图像生成提供者
	 */
	static createProvider(modelName: string): Image2DProvider {
		const normalizedModel = modelName.toLowerCase().trim();

		switch (normalizedModel) {
			case "gemini-3-pro":
			case "gemini-pro":
			case "gemini":
				return new GeminiProProvider(
					process.env.GOOGLE_AI_API_KEY || "YOUR_GOOGLE_API_KEY",
				);

			case "dall-e-3":
			case "dalle-3":
			case "dalle3":
				return new DallE3Provider(
					process.env.OPENAI_API_KEY || "YOUR_OPENAI_API_KEY",
					process.env.OPENAI_ENDPOINT,
				);

			case "stable-diffusion-xl":
			case "stable-diffusion":
			case "sdxl":
				return new StableDiffusionProvider(
					process.env.STABILITY_API_KEY || "YOUR_STABILITY_API_KEY",
					process.env.STABILITY_ENDPOINT ||
						"https://api.stability.ai",
				);

			case "imagen-3":
			case "imagen":
				return new Imagen3Provider(
					process.env.GOOGLE_CLOUD_API_KEY || "YOUR_GOOGLE_CLOUD_API_KEY",
					process.env.VERTEX_AI_ENDPOINT || "https://us-central1-aiplatform.googleapis.com",
				);

			default:
				console.warn(
					`[AI2DService] 未知模型 "${modelName}"，使用默认模型 gemini-3-pro`,
				);
				return new GeminiProProvider(
					process.env.GOOGLE_AI_API_KEY || "YOUR_GOOGLE_API_KEY",
				);
		}
	}

	/**
	 * 生成图像并保存到OSS
	 * @param modelName 模型名称（如 "gemini-3-pro", "dall-e-3"）
	 * @param prompt 提示词
	 * @param options 可选配置
	 * @returns 图像在OSS中的URL路径
	 */
	static async generateAndSave(
		modelName: string,
		prompt: string,
		options?: Image2DOptions,
	): Promise<string> {
		try {
			console.log(`[AI2DService] 使用模型 ${modelName} 生成图像...`);

			// 1. 创建提供者
			const provider = this.createProvider(modelName);

			// 2. 生成图像
			const base64Image = await provider.generate(prompt, options);

			// 3. 保存到OSS（这里简化为保存到本地）
			const imageUrl = await this.saveToOSS(base64Image, modelName);

			console.log(`[AI2DService] 图像生成并保存成功: ${imageUrl}`);
			return imageUrl;
		} catch (error) {
			console.error("[AI2DService] 图像生成失败:", error);
			throw error;
		}
	}

	/**
	 * 保存base64图像到OSS（临时实现：保存到本地）
	 */
	private static async saveToOSS(
		base64Data: string,
		modelName: string,
	): Promise<string> {
		try {
			// 生成文件名
			const timestamp = Date.now();
			const randomStr = Math.random().toString(36).substring(2, 10);
			const filename = `${modelName}_${timestamp}_${randomStr}.png`;

			// 保存到本地 data 目录
			const outputDir = path.resolve(process.cwd(), "data", "generated-images");
			await fs.ensureDir(outputDir);

			const outputPath = path.join(outputDir, filename);

			// 将base64转为Buffer并保存
			const buffer = Buffer.from(base64Data, "base64");
			await fs.writeFile(outputPath, buffer);

			// 返回相对路径（前端可拼接完整URL）
			const relativePath = `/data/generated-images/${filename}`;

			console.log(`[AI2DService] 图像已保存: ${outputPath}`);
			return relativePath;
		} catch (error) {
			console.error("[AI2DService] 保存图像失败:", error);
			throw new Error(
				`保存图像失败: ${error instanceof Error ? error.message : "未知错误"}`,
			);
		}
	}

	/**
	 * 直接生成图像（返回base64）
	 * @param modelName 模型名称
	 * @param prompt 提示词
	 * @param options 可选配置
	 * @returns Base64编码的图像数据
	 */
	static async generate(
		modelName: string,
		prompt: string,
		options?: Image2DOptions,
	): Promise<string> {
		const provider = this.createProvider(modelName);
		return await provider.generate(prompt, options);
	}
}

// 向后兼容的导出
export const ai2dService = {
	generateAndSave: AI2DService.generateAndSave.bind(AI2DService),
	generate: AI2DService.generate.bind(AI2DService),
};
