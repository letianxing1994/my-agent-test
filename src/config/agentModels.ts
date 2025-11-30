import fs from "node:fs";
import path from "node:path";

export interface AgentModelDefaults {
	provider: string;
	model: string;
	endpoint?: string;
	apiKey?: string;
	apiKeyEnv?: string;
	systemPrompt?: string;
	extra?: Record<string, unknown>;
	fallback?: AgentModelDefaults;
}

// 多模型配置（用于3D美术Agent）
export interface MultiModelConfig {
	name: string; // 模型标识，如 texture_generator, model_generator
	provider: string;
	model: string;
	endpoint?: string;
	apiKeyEnv?: string;
	purpose: "texture" | "3d_model" | "other"; // 模型用途
	extra?: Record<string, unknown>;
	systemPrompt?: string;
}

// 3D美术Agent配置（支持多模型）
export interface Art3DConfig {
	models: MultiModelConfig[]; // 多个模型的数组
	workflow: "sequential" | "parallel"; // 执行顺序：顺序或并行
	systemPrompt?: string; // 整体提示词
}

// 美术 Agent 可以是 2D 或 3D 的配置对象
export interface ArtAgentConfig {
	"2d": AgentModelDefaults;
	"3d": Art3DConfig;
}

type AgentId = "planning" | "art" | "music" | "tech" | "test";

type AgentModelConfig = Record<AgentId, AgentModelDefaults | ArtAgentConfig>;

type StageToolOverrides = {
	endpoint?: string;
	apiKey?: string;
	apiKeyEnv?: string;
	provider?: string;
	extra?: Record<string, unknown>;
};

let cachedAgentModels: AgentModelConfig | null = null;

function loadAgentModelConfig(): AgentModelConfig {
	if (cachedAgentModels) {
		return cachedAgentModels;
	}

	const configPath =
		process.env.AGENT_MODEL_CONFIG_PATH ||
		path.resolve(process.cwd(), "config", "agentModels.default.json");

	const raw = fs.readFileSync(configPath, "utf-8");
	cachedAgentModels = JSON.parse(raw) as AgentModelConfig;
	return cachedAgentModels;
}

export function getAgentModelConfig(
	agentId: AgentId,
	dimension?: "2d" | "3d",
): AgentModelDefaults | Art3DConfig {
	const config = loadAgentModelConfig();
	const agentConfig = config[agentId];

	// 如果是美术 Agent 且配置是对象形式，根据 dimension 选择
	if (agentId === "art" && typeof agentConfig === "object" && "2d" in agentConfig) {
		const artConfig = agentConfig as ArtAgentConfig;
		return dimension === "2d" ? artConfig["2d"] : artConfig["3d"];
	}

	return agentConfig as AgentModelDefaults;
}

// 新增：获取3D美术Agent的所有模型配置
export function get3DArtModels(dimension?: "2d" | "3d"): MultiModelConfig[] | null {
	if (dimension !== "3d") return null;

	const config = getAgentModelConfig("art", "3d") as Art3DConfig;
	return config.models || null;
}

/**
 * 标准化模型名称
 * 将常见的别名映射为官方模型名
 *
 * 特别处理：所有包含"deepseek"的模型名都映射为deepseek-reasoner
 */
function normalizeModelName(modelName: string): string {
	if (!modelName) return modelName;

	const modelMap: Record<string, string> = {
		// DeepSeek 系列 - 所有deepseek变体都映射为deepseek-reasoner
		"deepseek-r1": "deepseek-reasoner",
		"deepseek-r1-distill": "deepseek-reasoner",
		"deepseek-chat": "deepseek-reasoner",
		"deepseek": "deepseek-reasoner",

		// OpenAI 系列
		"gpt-4o": "gpt-4o",
		"gpt-5": "gpt-5",

		// Anthropic 系列
		"claude-sonnet-4.5": "claude-sonnet-4.5",

		// 图像生成
		"dall-e-3": "dall-e-3",
		"banana2": "banana2",

		// 3D模型生成
		"meshy-4": "meshy-4",
	};

	// 转换为小写进行匹配
	const normalizedInput = modelName.toLowerCase().trim();

	// 精确匹配
	if (modelMap[normalizedInput]) {
		return modelMap[normalizedInput];
	}

	// 🔥 关键：任何包含"deepseek"的都映射为deepseek-reasoner
	if (normalizedInput.includes("deepseek")) {
		console.log(`[Model映射] ${modelName} → deepseek-reasoner`);
		return "deepseek-reasoner";
	}

	// 没有匹配则返回原始名称
	return modelName;
}

/**
 * 导出的公共函数，供其他模块使用
 */
export function normalizeModel(modelName: string): string {
	return normalizeModelName(modelName);
}

/**
 * 标准化endpoint地址
 * 根据provider自动修正endpoint
 */
function normalizeEndpoint(endpoint: string | undefined, provider: string): string {
	// DeepSeek API endpoint 应该是 https://api.deepseek.com（不带/v1）
	if (provider === "deepseek") {
		if (!endpoint || endpoint.includes("placeholder")) {
			return "https://api.deepseek.com";
		}
		// 如果用户传了 /v1 后缀，移除它
		if (endpoint.endsWith("/v1")) {
			return endpoint.replace(/\/v1$/, "");
		}
	}

	return endpoint || "https://api.placeholder-model.com/v1";
}

export function resolveModelRuntime(
	agentId: AgentId,
	stageConfig?: {
		model?: string;
		tools?: StageToolOverrides;
		dimension?: "2d" | "3d"; // 新增：支持美术 Agent 的 dimension
	},
) {
	const config = getAgentModelConfig(agentId, stageConfig?.dimension);
	
	// 如果是 Art3DConfig，使用第一个模型的配置
	let defaults: AgentModelDefaults;
	if ("models" in config && Array.isArray(config.models)) {
		const firstModel = config.models[0];
		defaults = {
			provider: firstModel.provider,
			model: firstModel.model,
			endpoint: firstModel.endpoint,
			apiKeyEnv: firstModel.apiKeyEnv,
			extra: firstModel.extra,
			systemPrompt: config.systemPrompt || firstModel.systemPrompt,
		};
	} else {
		defaults = config as AgentModelDefaults;
	}
	
	const resolvedModel = normalizeModelName(stageConfig?.model || defaults.model);
	const provider =
		stageConfig?.tools?.provider || defaults.provider || "custom";
	const rawEndpoint =
		stageConfig?.tools?.endpoint ||
		defaults.endpoint ||
		process.env[`${agentId.toUpperCase()}_MODEL_ENDPOINT`];
	const endpoint = normalizeEndpoint(rawEndpoint, provider);
	const apiKeyEnv =
		stageConfig?.tools?.apiKeyEnv ||
		defaults.apiKeyEnv ||
		`${agentId.toUpperCase()}_API_KEY`;
	const apiKey =
		stageConfig?.tools?.apiKey ||
		process.env[apiKeyEnv] ||
		defaults.apiKey ||
		"TODO_API_KEY";

	return {
		provider,
		model: resolvedModel,
		endpoint,
		apiKey,
		extra: {
			...(defaults.extra || {}),
			...(stageConfig?.tools?.extra || {}),
		},
	};
}
