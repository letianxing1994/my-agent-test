import fs from "node:fs";
import path from "node:path";

export interface AgentModelDefaults {
	provider: string;
	model: string;
	endpoint?: string;
	apiKey?: string;
	apiKeyEnv?: string;
	extra?: Record<string, unknown>;
}

type AgentId = "planning" | "art" | "music" | "tech" | "test";

type AgentModelConfig = Record<AgentId, AgentModelDefaults>;

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

export function getAgentModelConfig(agentId: AgentId): AgentModelDefaults {
	const config = loadAgentModelConfig();
	return config[agentId];
}

export function resolveModelRuntime(
	agentId: AgentId,
	stageConfig?: {
		model?: string;
		tools?: StageToolOverrides;
	},
) {
	const defaults = getAgentModelConfig(agentId);
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
			...defaults.extra,
			...(stageConfig?.tools?.extra || {}),
		},
	};
}
