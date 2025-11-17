import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
	| JsonPrimitive
	| JsonValue[]
	| {
			[key: string]: JsonValue;
	  };
export type JsonRecord = Record<string, JsonValue>;

export const GameGenreSchema = z.enum([
	"rpg",
	"slg",
	"shooter",
	"moba",
	"act",
	"avg",
	"sim",
	"ftg",
	"rac",
	"sandbox",
	"survival",
	"card",
	"casual",
	"puzzle",
	"rhythm",
	"horror",
]);

export const GameSubGenreSchema = z.enum([
	"arpg",
	"turn_based_rpg",
	"mmorpg",
	"turn_based_slg",
	"rts",
	"srpg",
	"fps",
	"tps",
	"rougelike",
	"action_adventure",
	"visual_novel",
	"life_sim",
	"management",
	"driving",
	"open_world",
	"crafting",
	"deck_builder",
	"match3",
	"platform_puzzle",
	"rhythm_action",
	"psychological_horror",
]);

export const GameGenreSelectionSchema = z.object({
	primary: GameGenreSchema,
	subGenre: GameSubGenreSchema.optional(),
	hybrid: z.array(GameGenreSchema).max(2).optional(),
});

export type GameGenre = z.infer<typeof GameGenreSchema>;
export type GameSubGenre = z.infer<typeof GameSubGenreSchema>;
export type GameGenreSelection = z.infer<typeof GameGenreSelectionSchema>;

// 执行模式枚举
export enum ExecutionMode {
	SEQUENTIAL = "sequential", // 顺序执行
	ASYNC_PARALLEL = "async_parallel", // 异步并行
	FEEDBACK_LOOP = "feedback_loop", // 反馈循环
}

// 用户输入验证模式
export const UserInputSchema = z
	.object({
		gameGenre: GameGenreSelectionSchema.optional(),
		gameType: GameGenreSchema.optional(),
		dimension: z.enum(["2d", "3d"]),
		artStyle: z.enum(["realistic", "cartoon", "pixel", "anime", "abstract"]),
		gameMode: z.enum(["singleplayer", "multiplayer"]),
		projectName: z.string().optional(),
		additionalRequirements: z.string().optional(),
		resourceFiles: z
			.array(
				z.object({
					filename: z.string(),
					type: z.enum(["image", "audio", "3d", "document"]),
					purpose: z.string(),
					path: z.string().optional(),
				}),
			)
			.optional(),
	})
	.refine(
		(data) => {
			const primary = data.gameGenre?.primary ?? data.gameType;
			const incompatible2D = ["moba", "shooter", "fps"];
			if (
				data.dimension === "2d" &&
				primary &&
				incompatible2D.includes(primary)
			) {
				return false;
			}
			return true;
		},
		{
			message: "该游戏类型不支持2D模式，请选择3D",
			path: ["dimension"],
		},
	);

// 用户输入类型
export type UserInput = z.infer<typeof UserInputSchema>;

// 游戏设计文档(GDD)结构
export const GDD_Schema = z.object({
	projectId: z.string(),
	projectName: z.string(),
	coreConcept: z.string(),
	gameType: z.string(),
	primaryGenre: GameGenreSchema.optional(),
	subGenre: GameSubGenreSchema.optional(),
	hybridGenres: z.array(GameGenreSchema).optional(),
	dimension: z.string(),
	artStyle: z.string(),
	gameMode: z.string(),
	gameplayMechanics: z.array(
		z.object({
			name: z.string(),
			description: z.string(),
			implementationDetails: z.string(),
		}),
	),
	characterDesigns: z
		.array(
			z.object({
				name: z.string(),
				type: z.enum(["player", "npc", "enemy", "boss"]),
				description: z.string(),
				attributes: z.record(z.string(), z.unknown()),
			}),
		)
		.optional(),
	levelDesigns: z
		.array(
			z.object({
				name: z.string(),
				description: z.string(),
				objectives: z.array(z.string()),
			}),
		)
		.optional(),
	uiDesign: z
		.object({
			screens: z.array(z.string()),
			controls: z.record(z.string(), z.string()),
		})
		.optional(),
	artRequirements: z.array(
		z.object({
			type: z.enum(["character", "environment", "ui", "icon"]),
			description: z.string(),
			quantity: z.number(),
			priority: z.enum(["high", "medium", "low"]),
		}),
	),
	audioRequirements: z.array(
		z.object({
			type: z.enum(["bgm", "sfx"]),
			description: z.string(),
			quantity: z.number(),
			priority: z.enum(["high", "medium", "low"]),
		}),
	),
	technicalRequirements: z.object({
		engine: z.string(),
		targetPlatforms: z.array(z.string()),
		performanceRequirements: z.string().optional(),
	}),
	storyBeats: z
		.array(
			z.object({
				act: z.string(),
				summary: z.string(),
			}),
		)
		.optional(),
	numericModels: z
		.array(
			z.object({
				system: z.string(),
				metrics: z.array(z.string()),
				notes: z.string().optional(),
			}),
		)
		.optional(),
	systemDesigns: z
		.array(
			z.object({
				name: z.string(),
				description: z.string(),
				components: z.array(z.string()).optional(),
			}),
		)
		.optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

// GDD类型
export type GDD = z.infer<typeof GDD_Schema>;

// 项目配置
export interface GameProjectConfig {
	projectId: string;
	projectName: string;
	executionMode: ExecutionMode;
	userInput: UserInput;
	cloudProvider?: "aliyun" | "gcp";
	executionConfig?: ExecutionConfig;
	gdd?: GDD;
	status:
		| "initialized"
		| "planning"
		| "art"
		| "music"
		| "tech"
		| "testing"
		| "completed"
		| "failed";
	createdAt: string;
	updatedAt: string;
	assets: {
		art: string[];
		music: string[];
		code: string;
	};
	testReports: string[];
}

export interface StageConfig {
	stageId: string;
	agentId: string;
	model: string;
	knowledgeBase?: string;
	mode: "llm+kb" | "llm+custom-kb" | "mcp-local" | "hybrid";
	tools?: JsonRecord;
	mcp?: {
		endpoint: string;
		token?: string;
	};
	resources?: Array<{
		type: string;
		url: string;
		metadata?: JsonRecord;
	}>;
	outputFormats?: string[];
	expectedArtifacts?: Array<{
		type: string;
		format?: string;
	}>;
	planningFocus?: PlanningFocusConfig;
}

export interface ExecutionConfig {
	workflowId: string;
	cloudProvider: "aliyun" | "gcp";
	callbacks?: {
		webhook?: string;
		events?: "ws" | "sse";
	};
	stages: StageConfig[];
}

export interface ExecutionRequest {
	workflowId: string;
	executionMode: ExecutionMode;
	cloudProvider: "aliyun" | "gcp";
	project: {
		projectName: string;
		gameGenre?: GameGenreSelection;
		gameType?: GameGenre;
		dimension: UserInput["dimension"];
		artStyle: UserInput["artStyle"];
		gameMode: UserInput["gameMode"];
		additionalRequirements?: string;
	};
	stages: StageConfig[];
	callbacks?: ExecutionConfig["callbacks"];
}

export interface PlanningFocusConfig {
	narrative?: boolean;
	numeric?: boolean;
	levelDesign?: boolean;
	systemDesign?: {
		growth?: boolean;
		equipment?: boolean;
		social?: boolean;
		combat?: boolean;
	};
}

export interface StagePreviewRequest {
	stageId: "planning" | "art" | "music" | "tech" | "test";
	stageConfig?: StageConfig;
	cloudProvider?: "aliyun" | "gcp";
	project?: {
		projectName?: string;
		description?: string;
	};
	userInput?: UserInput;
	gdd?: Partial<GDD> | JsonRecord;
	assets?: {
		art?: string[];
		music?: string[];
		code?: string;
	};
	notes?: string;
}

export type ClarificationStatus = "idle" | "pending" | "resolved";

export interface ClarificationQuestion {
	questionId: string;
	stageId?: string;
	category?: string;
	question: string;
	context?: JsonRecord;
	status: "open" | "answered";
	createdAt: string;
	answeredAt?: string;
	answer?: string;
}

export interface ConversationMessage {
	messageId: string;
	role: "orchestrator" | "user" | "agent";
	type: "question" | "answer" | "update";
	content: string;
	stageId?: string;
	timestamp: string;
	metadata?: JsonRecord;
}

export interface ClarificationState {
	status: ClarificationStatus;
	questions: ClarificationQuestion[];
	conversation: ConversationMessage[];
	lastPromptedAt?: string;
}

export interface ExecutionRecord {
	executionId: string;
	projectId: string;
	workflowId: string;
	cloudProvider: "aliyun" | "gcp";
	status:
		| "pending"
		| "awaiting_clarification"
		| "running"
		| "paused"
		| "completed"
		| "failed"
		| "aborted";
	executionMode: ExecutionMode;
	config: ExecutionConfig;
	stages: Record<
		string,
		{
			status: "pending" | "running" | "completed" | "failed" | "paused";
			startedAt?: string;
			completedAt?: string;
			artifacts: string[];
			logs: string[];
			checkpoint?: {
				timestamp: string;
				artifacts: AgentArtifact[];
				notes?: string;
			};
			userUpdates?: {
				updatedAt: string;
				notes?: string;
				resources?: Array<{ type: string; url: string; metadata?: JsonRecord }>;
				overrides?: Partial<StageConfig>;
			};
		}
	>;
	resources: Array<{
		stageId: string;
		type: string;
		url: string;
		metadata?: JsonRecord;
	}>;
	clarification?: ClarificationState;
	createdAt: string;
	updatedAt: string;
}

export type ArtifactCategory =
	| "document"
	| "instruction"
	| "art"
	| "audio"
	| "code"
	| "model"
	| "test_report"
	| "build"
	| "resource";

export interface AgentArtifact {
	artifactId: string;
	stageId: string;
	type: ArtifactCategory;
	format: string;
	url: string;
	source: "llm" | "mcp" | "user_upload" | "pipeline";
	description?: string;
	metadata?: JsonRecord;
}

export interface ArtifactMessage {
	stageId: string;
	status?: "in_progress" | "completed" | "paused";
	artifacts: AgentArtifact[];
	checkpoint?: {
		artifacts: AgentArtifact[];
		notes?: string;
	};
}

// Agent消息类型
export enum MessageType {
	USER_INPUT = "user_input",
	GDD_UPDATE = "gdd_update",
	ASSET_UPDATE = "asset_update",
	STATUS_UPDATE = "status_update",
	TEST_REPORT = "test_report",
	FEEDBACK = "feedback",
	COMPLETION = "completion",
	CONFIG = "config",
	CONTROL = "control",
	LOG = "log",
}

// Agent消息结构
export interface AgentMessage {
	messageId: string;
	senderId: string; // Agent ID
	receiverId: string; // Target Agent ID or 'a2a-server'
	projectId: string;
	type: MessageType;
	content: JsonValue;
	timestamp: string;
	requiresAck: boolean;
}

// 资产类型
export interface Asset {
	assetId: string;
	projectId: string;
	type: "image" | "audio" | "model" | "code" | "document";
	name: string;
	path: string;
	description: string;
	createdBy: string;
	createdAt: string;
	metadata?: JsonRecord;
}

// 测试报告类型
export interface TestReport {
	reportId: string;
	projectId: string;
	testsRun: number;
	testsPassed: number;
	testsFailed: number;
	issues: Array<{
		issueId: string;
		severity: "critical" | "major" | "minor";
		description: string;
		category: "gameplay" | "performance" | "crash" | "visual" | "audio";
		suggestedFix: string;
	}>;
	summary: string;
	generatedAt: string;
}

// Mem0接口（模拟）
export interface Mem0Interface {
	save(key: string, value: JsonValue): Promise<void>;
	get(key: string): Promise<JsonValue | undefined>;
	delete(key: string): Promise<void>;
	query(query: string): Promise<JsonRecord[]>;
}

// 知识库接口
export interface KnowledgeBaseInterface {
	search(query: string): Promise<JsonRecord[]>;
	addDocument(content: string, metadata?: JsonRecord): Promise<void>;
	getRelevantCode(gameType: string, dimension: string): Promise<string[]>;
}
