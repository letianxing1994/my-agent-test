/**
 * 2D图像生成提供者接口
 * 所有2D图像生成模型都需要实现此接口
 */
export interface Image2DProvider {
	/**
	 * 生成图像
	 * @param prompt 提示词
	 * @param options 可选配置（如尺寸、风格等）
	 * @returns Base64编码的图像数据
	 */
	generate(prompt: string, options?: Image2DOptions): Promise<string>;

	/**
	 * 获取提供者名称
	 */
	getName(): string;
}

/**
 * 图像生成选项（通用）
 */
export interface Image2DOptions {
	// 通用选项
	size?: string; // 如 "1024x1024", "1K", "2K", "4K"
	aspectRatio?: "1:1" | "16:9" | "9:16"; // 宽高比
	quality?: "standard" | "hd" | "high"; // 质量
	style?: string; // 风格提示（如 "vivid", "natural", "digital art"）

	// 模型特定选项（可扩展）
	[key: string]: any;
}

/**
 * 图像生成结果
 */
export interface Image2DResult {
	base64: string; // Base64编码的图像
	mimeType: string; // 图像MIME类型（如 image/png）
	metadata?: Record<string, any>; // 额外元数据
}
