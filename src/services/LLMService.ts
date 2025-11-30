/**
 * LLM服务 - 统一的大语言模型调用接口
 * 支持多种模型提供商：OpenAI, DeepSeek, Anthropic Claude等
 */

export interface LLMMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface LLMResponse {
	content: string;
	model: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
}

export interface LLMConfig {
	provider: string;
	model: string;
	endpoint: string;
	apiKey: string;
	temperature?: number;
	maxTokens?: number;
	topP?: number;
	extra?: Record<string, unknown>;
}

/**
 * LLM服务类
 */
export class LLMService {
	/**
	 * 调用LLM模型生成响应
	 */
	static async chat(
		messages: LLMMessage[],
		config: LLMConfig,
	): Promise<LLMResponse> {
		const {
			provider,
			model,
			endpoint,
			apiKey,
			temperature = 0.7,
			maxTokens = 4000,
			topP = 1,
			extra = {}
		} = config;

		console.log(`[LLM调用] Provider: ${provider}, 模型: ${model}, 温度: ${temperature}, 最大token: ${maxTokens}`);

		// 根据provider选择不同的API调用方式
		if (provider === "openai" || provider === "deepseek") {
			return this.callOpenAICompatible(messages, config);
		} else if (provider === "anthropic") {
			return this.callClaude(messages, config);
		} else {
			// 尝试使用OpenAI兼容的API
			console.warn(`[LLM警告] 未知provider ${provider}，尝试使用OpenAI兼容接口`);
			return this.callOpenAICompatible(messages, config);
		}
	}

	/**
	 * 调用OpenAI兼容的API (OpenAI, DeepSeek等)
	 */
	private static async callOpenAICompatible(
		messages: LLMMessage[],
		config: LLMConfig,
	): Promise<LLMResponse> {
		const { endpoint, apiKey, model, temperature = 0.7, maxTokens = 4000, topP = 1, extra = {} } = config;

		const response = await fetch(`${endpoint}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model,
				messages,
				temperature: extra.temperature ?? temperature,
				max_tokens: extra.max_tokens ?? maxTokens,
				top_p: topP,
				...extra,
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`API调用失败: ${response.status} ${error}`);
		}

		const data = await response.json();

		return {
			content: data.choices[0].message.content,
			model: data.model,
			usage: {
				promptTokens: data.usage.prompt_tokens,
				completionTokens: data.usage.completion_tokens,
				totalTokens: data.usage.total_tokens,
			},
		};
	}

	/**
	 * 调用Anthropic Claude API
	 */
	private static async callClaude(
		messages: LLMMessage[],
		config: LLMConfig,
	): Promise<LLMResponse> {
		const { endpoint, apiKey, model, temperature = 0.7, maxTokens = 4000, extra = {} } = config;

		// 将messages格式转换为Claude格式
		let system = "";
		const claudeMessages: Array<{ role: string; content: string }> = [];

		for (const msg of messages) {
			if (msg.role === "system") {
				system = msg.content;
			} else {
				claudeMessages.push({
					role: msg.role,
					content: msg.content,
				});
			}
		}

		const response = await fetch(`${endpoint}/messages`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model,
				max_tokens: extra.max_tokens ?? maxTokens,
				temperature: extra.temperature ?? temperature,
				system,
				messages: claudeMessages,
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Claude API调用失败: ${response.status} ${error}`);
		}

		const data = await response.json();

		return {
			content: data.content[0].text,
			model: data.model,
			usage: {
				promptTokens: data.usage.input_tokens,
				completionTokens: data.usage.output_tokens,
				totalTokens: data.usage.input_tokens + data.usage.output_tokens,
			},
		};
	}
}
