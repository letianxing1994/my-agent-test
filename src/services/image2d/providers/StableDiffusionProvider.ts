/**
 * Stable Diffusion XL 图像生成提供者
 * 支持自托管或第三方API（如Stability AI官方API）
 */

import type { Image2DProvider, Image2DOptions } from "../ImageProvider";

export class StableDiffusionProvider implements Image2DProvider {
	private apiKey: string;
	private endpoint: string;

	constructor(apiKey: string, endpoint: string) {
		this.apiKey = apiKey;
		this.endpoint = endpoint;
	}

	getName(): string {
		return "stable-diffusion-xl";
	}

	async generate(prompt: string, options?: Image2DOptions): Promise<string> {
		try {
			// 调用 Stability AI 官方 API
			const response = await fetch(`${this.endpoint}/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					text_prompts: [
						{
							text: prompt,
							weight: 1,
						},
					],
					cfg_scale: 7,
					height: this.parseHeight(options?.size),
					width: this.parseWidth(options?.size),
					samples: 1,
					steps: 30,
					style_preset: options?.style || "digital-art",
				}),
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(`API错误: ${JSON.stringify(error)}`);
			}

			const result = await response.json();

			if (!result.artifacts || result.artifacts.length === 0) {
				throw new Error("Stable Diffusion未生成图像");
			}

			// 返回第一张图像的base64数据
			return result.artifacts[0].base64;
		} catch (error) {
			console.error("[StableDiffusionProvider] 图像生成失败:", error);
			throw new Error(
				`Stable Diffusion图像生成失败: ${error instanceof Error ? error.message : "未知错误"}`,
			);
		}
	}

	private parseWidth(size?: string): number {
		if (!size) return 1024;
		const match = size.match(/(\d+)x\d+/);
		return match ? parseInt(match[1]) : 1024;
	}

	private parseHeight(size?: string): number {
		if (!size) return 1024;
		const match = size.match(/\d+x(\d+)/);
		return match ? parseInt(match[1]) : 1024;
	}
}
