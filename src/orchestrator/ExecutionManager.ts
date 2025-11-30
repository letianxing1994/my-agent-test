import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";
import type {
	AgentArtifact,
	ClarificationQuestion,
	ConversationMessage,
	ExecutionConfig,
	ExecutionRecord,
	ExecutionRequest,
	JsonRecord,
	StageConfig,
} from "../types";

type StageStatus = "pending" | "running" | "completed" | "failed" | "paused";

interface StageCheckpoint {
	timestamp: string;
	artifacts: AgentArtifact[];
	notes?: string;
}

interface StageUpdates {
	updatedAt: string;
	notes?: string;
	resources?: Array<{ type: string; url: string; metadata?: JsonRecord }>;
	overrides?: Partial<StageConfig>;
}

interface StageState {
	status: StageStatus;
	startedAt?: string;
	completedAt?: string;
	artifacts: string[];
	logs: string[];
	checkpoint?: StageCheckpoint;
	userUpdates?: StageUpdates;
}

interface ExecutionEvent {
	type: string;
	payload: unknown;
}

export class ExecutionManager {
	private executions = new Map<string, ExecutionRecord>();
	private projectExecutionMap = new Map<string, string>();
	private eventStreams = new Map<
		string,
		Set<{ id: string; push: (event: ExecutionEvent) => void }>
	>();
	private emitter = new EventEmitter();

	constructor() {
		this.emitter.setMaxListeners(0);
	}

	createExecution(
		request: ExecutionRequest,
		projectId: string,
	): ExecutionRecord {
		const executionId = uuidv4();
		const stages: ExecutionRecord["stages"] = {};
		for (const stage of request.stages) {
			stages[stage.stageId] = {
				status: "pending",
				artifacts: [],
				logs: [],
			};
		}

		const config: ExecutionConfig = {
			workflowId: request.workflowId,
			cloudProvider: request.cloudProvider,
			callbacks: request.callbacks,
			stages: request.stages,
		};

		const record: ExecutionRecord = {
			executionId,
			projectId,

			// 🔥 保存 game-factory 的核心标识（用于路径构建和数据隔离）
			userId: request.userId,      // 来自 companies.owner_id
			companyId: request.companyId, // 来自 games.company_id

			workflowId: request.workflowId,
			cloudProvider: request.cloudProvider,
			executionMode: request.executionMode,
			status: "pending",
			config,
			stages,
			resources: [],
			clarification: {
				status: "idle",
				questions: [],
				conversation: [],
			},
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		this.executions.set(executionId, record);
		this.projectExecutionMap.set(projectId, executionId);
		this.dispatchEvent(executionId, { type: "created", payload: record });
		return record;
	}

	getExecution(executionId: string): ExecutionRecord | undefined {
		return this.executions.get(executionId);
	}

	getExecutionByProject(projectId: string): ExecutionRecord | undefined {
		const executionId = this.projectExecutionMap.get(projectId);
		if (!executionId) return undefined;
		return this.executions.get(executionId);
	}

	attachStageConfig(
		projectId: string,
		stageId: string,
	): StageConfig | undefined {
		const execution = this.getExecutionByProject(projectId);
		return execution?.config.stages.find((stage) => stage.stageId === stageId);
	}

	updateStageStatus(
		projectId: string,
		stageId: string,
		status: ExecutionRecord["stages"][string]["status"],
	) {
		const execution = this.getExecutionByProject(projectId);
		if (!execution) return;
		const stage = execution.stages[stageId];
		if (!stage) return;

		stage.status = status;
		const now = new Date().toISOString();
		if (status === "running") {
			stage.startedAt = now;
		}
		if (status === "completed" || status === "failed") {
			stage.completedAt = now;
		}
		execution.updatedAt = now;
		this.dispatchEvent(execution.executionId, {
			type: "stage_status",
			payload: { stageId, status },
		});
	}

	addStageArtifact(
		projectId: string,
		stageId: string,
		artifactUrl: string,
		metadata?: JsonRecord,
	) {
		const execution = this.getExecutionByProject(projectId);
		if (!execution) return;
		const stage = execution.stages[stageId];
		if (!stage) return;

		stage.artifacts.push(artifactUrl);
		const metadataType = metadata?.type;
		execution.resources.push({
			stageId,
			type: typeof metadataType === "string" ? metadataType : "generic",
			url: artifactUrl,
			metadata,
		});
		execution.updatedAt = new Date().toISOString();
		this.dispatchEvent(execution.executionId, {
			type: "artifact",
			payload: { stageId, artifactUrl, metadata },
		});
	}

	addStageLog(projectId: string, stageId: string, log: string) {
		const execution = this.getExecutionByProject(projectId);
		if (!execution) return;
		const stage = execution.stages[stageId];
		if (!stage) return;

		stage.logs.push(log);
		this.dispatchEvent(execution.executionId, {
			type: "log",
			payload: { stageId, log },
		});
	}

	updateExecutionStatus(
		projectId: string,
		status: ExecutionRecord["status"],
		details?: JsonRecord,
	) {
		const execution = this.getExecutionByProject(projectId);
		if (!execution) return;
		execution.status = status;
		execution.updatedAt = new Date().toISOString();
		this.dispatchEvent(execution.executionId, {
			type: "status",
			payload: { status, details },
		});
	}

	registerEventStream(
		executionId: string,
		push: (event: ExecutionEvent) => void,
	): () => void {
		const streamId = uuidv4();
		let streamSet = this.eventStreams.get(executionId);
		if (!streamSet) {
			streamSet = new Set();
			this.eventStreams.set(executionId, streamSet);
		}
		streamSet.add({ id: streamId, push });

		return () => {
			const current = this.eventStreams.get(executionId);
			if (!current) return;
			for (const item of current) {
				if (item.id === streamId) {
					current.delete(item);
					break;
				}
			}
		};
	}

	private dispatchEvent(executionId: string, event: ExecutionEvent) {
		const streams = this.eventStreams.get(executionId);
		if (streams) {
			for (const stream of streams) {
				stream.push(event);
			}
		}
		this.emitter.emit(executionId, event);
	}

	getStageConfigs(projectId: string): StageConfig[] {
		const execution = this.getExecutionByProject(projectId);
		return execution?.config.stages ?? [];
	}

	getClarification(executionId: string) {
		return this.executions.get(executionId)?.clarification;
	}

	hasPendingClarification(projectId: string): boolean {
		const execution = this.getExecutionByProject(projectId);
		return execution?.clarification?.status === "pending";
	}

	addClarificationQuestions(
		projectId: string,
		questions: ClarificationQuestion[],
	) {
		const execution = this.getExecutionByProject(projectId);
		if (!execution) return;
		const clarification = execution.clarification ?? {
			status: "idle",
			questions: [],
			conversation: [],
		};
		execution.clarification = clarification;

		const now = new Date().toISOString();
		for (const question of questions) {
			clarification.questions.push(question);
			clarification.conversation.push({
				messageId: question.questionId,
				role: "orchestrator",
				type: "question",
				content: question.question,
				stageId: question.stageId,
				timestamp: question.createdAt || now,
				metadata: question.context,
			});
		}
		clarification.status = "pending";
		clarification.lastPromptedAt = now;
		execution.updatedAt = now;
		this.dispatchEvent(execution.executionId, {
			type: "clarification",
			payload: clarification,
		});
	}

	recordClarificationResponses(
		projectId: string,
		responses: Array<{
			questionId: string;
			answer: string;
			role?: "user" | "orchestrator";
		}>,
	) {
		const execution = this.getExecutionByProject(projectId);
		if (!execution) return;
		const clarification = execution.clarification ?? {
			status: "idle",
			questions: [],
			conversation: [],
		};
		execution.clarification = clarification;
		const now = new Date().toISOString();

		for (const response of responses) {
			const target = clarification.questions.find(
				(question) => question.questionId === response.questionId,
			);
			if (target) {
				target.status = "answered";
				target.answer = response.answer;
				target.answeredAt = now;
			}
			clarification.conversation.push({
				messageId: `${response.questionId}-reply-${Date.now()}`,
				role: response.role || "user",
				type: "answer",
				content: response.answer,
				stageId: target?.stageId,
				timestamp: now,
				metadata: target?.context,
			});
		}

		const hasOpen = clarification.questions.some(
			(question) => question.status === "open",
		);
		clarification.status = hasOpen ? "pending" : "resolved";
		execution.updatedAt = now;
		this.dispatchEvent(execution.executionId, {
			type: "clarification",
			payload: clarification,
		});
	}

	appendConversationMessage(projectId: string, message: ConversationMessage) {
		const execution = this.getExecutionByProject(projectId);
		if (!execution) return;
		const clarification = execution.clarification ?? {
			status: "idle",
			questions: [],
			conversation: [],
		};
		execution.clarification = clarification;
		clarification.conversation.push(message);
		execution.updatedAt = message.timestamp;
		this.dispatchEvent(execution.executionId, {
			type: "clarification",
			payload: clarification,
		});
	}

	getExecutionById(executionId: string): ExecutionRecord | undefined {
		return this.executions.get(executionId);
	}

	getRunningStage(projectId: string) {
		const execution = this.getExecutionByProject(projectId);
		if (!execution) return undefined;
		for (const [stageId, stage] of Object.entries(execution.stages)) {
			if (stage.status === "running") {
				return { stageId, stage, execution };
			}
		}
		return undefined;
	}

	registerExternalResource(
		executionId: string,
		resource: {
			stageId: string;
			type: string;
			url: string;
			metadata?: JsonRecord;
		},
	) {
		const execution = this.executions.get(executionId);
		if (!execution) return;
		execution.resources.push(resource);
		execution.updatedAt = new Date().toISOString();
		this.dispatchEvent(executionId, { type: "resource", payload: resource });
	}

	updateExecutionConfig(
		executionId: string,
		updates: Partial<ExecutionConfig>,
	) {
		const execution = this.executions.get(executionId);
		if (!execution) return;
		execution.config = {
			...execution.config,
			...updates,
			stages: updates.stages || execution.config.stages,
		};
		execution.updatedAt = new Date().toISOString();
		this.dispatchEvent(executionId, {
			type: "config_updated",
			payload: execution.config,
		});
	}

	recordCheckpoint(
		projectId: string,
		stageId: string,
		checkpoint: StageCheckpoint,
	) {
		const execution = this.getExecutionByProject(projectId);
		if (!execution) return;
		const stage = execution.stages[stageId];
		if (!stage) return;
		stage.checkpoint = checkpoint;
		execution.updatedAt = new Date().toISOString();
		this.dispatchEvent(execution.executionId, {
			type: "checkpoint",
			payload: { stageId, checkpoint },
		});
	}

	applyStageUpdates(
		executionId: string,
		stageId: string,
		updates: StageUpdates,
	) {
		const execution = this.executions.get(executionId);
		if (!execution) return;
		const stage = execution.stages[stageId];
		if (!stage) return;
		stage.userUpdates = updates;
		execution.updatedAt = new Date().toISOString();
		this.dispatchEvent(executionId, {
			type: "stage_updates",
			payload: { stageId, updates },
		});
	}

	getStageContext(executionId: string, stageId: string) {
		const execution = this.executions.get(executionId);
		if (!execution) return undefined;
		const stage = execution.stages[stageId];
		if (!stage) return undefined;
		const stageConfig = execution.config.stages.find(
			(stage) => stage.stageId === stageId,
		);
		return {
			execution,
			stageId,
			stage,
			stageConfig,
		};
	}
}

export const executionManager = new ExecutionManager();
