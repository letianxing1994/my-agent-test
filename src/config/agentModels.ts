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
	
	const resolvedModel = stageConfig?.model || defaults.model;
	const endpoint =
		stageConfig?.tools?.endpoint ||
		defaults.endpoint ||
		process.env[`${agentId.toUpperCase()}_MODEL_ENDPOINT`] ||
		"https://api.placeholder-model.com/v1";
	const apiKeyEnv =
		stageConfig?.tools?.apiKeyEnv ||
		defaults.apiKeyEnv ||
		`${agentId.toUpperCase()}_API_KEY`;
	const apiKey =
		stageConfig?.tools?.apiKey ||
		process.env[apiKeyEnv] ||
		defaults.apiKey ||
		"TODO_API_KEY";
	const provider =
		stageConfig?.tools?.provider || defaults.provider || "custom";

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
