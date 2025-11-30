import "dotenv/config";
import express from "express";
import { Kafka } from "kafkajs";
import fetch from "node-fetch";
import type { ExecutionRecord, ExecutionRequest } from "../types";

type WorkflowJobStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "clarifying";

interface WorkflowTaskMessage {
	jobId: string;
	companyId: number;
	ownerId: number;
	enqueuedAt: string;
	payload: ExecutionRequest;
}

interface WorkflowResultMessage {
	jobId: string;
	status: WorkflowJobStatus;
	executionId?: string;
	projectId?: string;
	workflowId?: string;
	error?: string;
	startedAt?: string;
	finishedAt?: string;
	message?: string;
}

const API_BASE =
	process.env.MY_AGENT_API_BASE_URL || "http://localhost:8080/api";
const TASK_TOPIC = process.env.WORKFLOW_TASK_TOPIC || "workflow-tasks";
const RESULT_TOPIC = process.env.WORKFLOW_RESULT_TOPIC || "workflow-results";
const CONSUMER_GROUP =
	process.env.WORKFLOW_CONSUMER_GROUP || "my-agent-workflow-consumers";
const POLL_INTERVAL_MS = Number(process.env.WORKFLOW_POLL_INTERVAL_MS || 15000);
const POLL_TIMEOUT_MS =
	Number(process.env.WORKFLOW_POLL_TIMEOUT_MINUTES || 240) * 60 * 1000;

const MAX_CONCURRENCY = Number(process.env.WORKFLOW_MAX_CONCURRENCY || 3);
const STATUS_PORT = Number(process.env.WORKFLOW_CONSUMER_PORT || 8091);

const kafka = new Kafka({
	clientId: process.env.KAFKA_CLIENT_ID || "my-agent-workflow-consumer",
	brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
	retry: {
		retries: 5,
		initialRetryTime: 100,
		factor: 2,
	},
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: CONSUMER_GROUP });

interface WorkflowJobState extends WorkflowResultMessage {
	lastUpdate: string;
}

const jobStates = new Map<string, WorkflowJobState>();

function updateJobState(update: WorkflowResultMessage) {
	const existing = jobStates.get(update.jobId);
	jobStates.set(update.jobId, {
		...existing,
		...update,
		lastUpdate: new Date().toISOString(),
	});
}

async function sendResult(result: WorkflowResultMessage) {
	updateJobState(result);
	await producer.send({
		topic: RESULT_TOPIC,
		messages: [
			{
				key: result.jobId,
				value: JSON.stringify({
					...result,
					timestamp: new Date().toISOString(),
				}),
			},
		],
	});
}

interface ExecutionStartResponse {
	executionId: string;
	projectId: string;
	workflowId: string;
	status: ExecutionRecord["status"];
}

async function startExecution(
	task: WorkflowTaskMessage,
): Promise<ExecutionStartResponse> {
	console.log(
		`[Job ${task.jobId}] Starting execution for company ${task.companyId}, owner ${task.ownerId}`,
	);

	// 🔥 将 userId 和 companyId 传递给 A2A Server
	const payload = {
		...task.payload,
		userId: task.ownerId, // 🔥 用户ID
		companyId: task.companyId, // 🔥 公司ID
	};

	const response = await fetch(`${API_BASE}/executions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`startExecution failed: ${response.status} ${text}`);
	}

	return (await response.json()) as ExecutionStartResponse;
}

async function fetchExecution(executionId: string): Promise<ExecutionRecord> {
	const response = await fetch(`${API_BASE}/executions/${executionId}`);
	if (!response.ok) {
		throw new Error(`fetchExecution failed: ${response.status}`);
	}
	return (await response.json()) as ExecutionRecord;
}

async function waitForCompletion(
	jobId: string,
	workflowId: string | undefined,
	executionId: string,
): Promise<ExecutionRecord> {
	const deadline = Date.now() + POLL_TIMEOUT_MS;
	let lastStatus: ExecutionRecord["status"] | undefined;
	while (true) {
		const execution = await fetchExecution(executionId);
		if (execution.status !== lastStatus) {
			if (execution.status === "awaiting_clarification") {
				await sendResult({
					jobId,
					status: "clarifying",
					executionId,
					workflowId,
					projectId: execution.projectId,
					message: "awaiting_clarification",
				});
			} else if (
				execution.status === "running" &&
				lastStatus === "awaiting_clarification"
			) {
				await sendResult({
					jobId,
					status: "running",
					executionId,
					workflowId,
					projectId: execution.projectId,
					message: "clarification_resolved",
				});
			}
			lastStatus = execution.status;
		}
		if (
			execution.status === "completed" ||
			execution.status === "failed" ||
			execution.status === "aborted"
		) {
			return execution;
		}
		if (Date.now() > deadline) {
			throw new Error("execution_poll_timeout");
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}
}

async function processTask(task: WorkflowTaskMessage) {
	console.log(`[workflow-consumer] 开始处理任务 ${task.jobId}`);
	try {
		const execution = await startExecution(task);
		const startedAt = new Date().toISOString();

		await sendResult({
			jobId: task.jobId,
			status:
				execution.status === "awaiting_clarification"
					? "clarifying"
					: "running",
			executionId: execution.executionId,
			projectId: execution.projectId,
			workflowId: task.payload.workflowId,
			startedAt,
			message: execution.status,
		});

		const finalExecution = await waitForCompletion(
			task.jobId,
			task.payload.workflowId,
			execution.executionId,
		);
		const finalStatus: WorkflowJobStatus =
			finalExecution.status === "completed" ? "completed" : "failed";

		await sendResult({
			jobId: task.jobId,
			status: finalStatus,
			executionId: execution.executionId,
			projectId: execution.projectId,
			workflowId: task.payload.workflowId,
			finishedAt: new Date().toISOString(),
			error:
				finalStatus === "failed"
					? JSON.stringify((finalExecution as any).issues ?? finalExecution)
					: undefined,
			message: finalExecution.status,
		});

		console.log(
			`[workflow-consumer] 任务 ${task.jobId} 完成，状态 ${finalStatus}`,
		);
	} catch (error) {
		console.error(`[workflow-consumer] 任务 ${task.jobId} 失败`, error);
		await sendResult({
			jobId: task.jobId,
			status: "failed",
			error: error instanceof Error ? error.message : String(error),
			finishedAt: new Date().toISOString(),
		});
		throw error;
	}
}

class WorkflowScheduler {
	private active = 0;
	private readonly queue: Array<() => void> = [];

	constructor(private readonly limit: number) {}

	schedule<T>(task: () => Promise<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			const run = async () => {
				this.active++;
				try {
					const result = await task();
					resolve(result);
				} catch (error) {
					reject(error);
				} finally {
					this.active--;
					this.shift();
				}
			};

			if (this.active < this.limit) {
				void run();
			} else {
				this.queue.push(run);
			}
		});
	}

	private shift() {
		const next = this.queue.shift();
		if (next) {
			void next();
		}
	}

	stats() {
		return {
			active: this.active,
			queued: this.queue.length,
			limit: this.limit,
		};
	}
}

const scheduler = new WorkflowScheduler(MAX_CONCURRENCY);

async function bootstrap() {
	await producer.connect();
	await consumer.connect();
	await consumer.subscribe({ topic: TASK_TOPIC });

	await consumer.run({
		eachMessage: async ({ message }) => {
			const payload = JSON.parse(
				message.value?.toString() || "{}",
			) as WorkflowTaskMessage;
			if (!payload.jobId) {
				console.warn("收到无效的workflow任务消息", message.value?.toString());
				return;
			}
			await sendResult({
				jobId: payload.jobId,
				status: "queued",
				workflowId: payload.payload.workflowId,
			});
			await scheduler.schedule(() => processTask(payload));
		},
	});

	console.log("[workflow-consumer] 启动完成，等待任务...");
}

bootstrap().catch((error) => {
	console.error("workflow consumer 启动失败", error);
	process.exit(1);
});

async function gracefulShutdown() {
	console.log("workflow consumer 正在关闭...");
	await consumer.disconnect();
	await producer.disconnect();
	process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

const statusApp = express();
statusApp.get("/health", (req, res) => {
	const schedulerStats = scheduler.stats();
	res.json({
		status: "ok",
		...schedulerStats,
		jobsTracked: jobStates.size,
	});
});

statusApp.get("/jobs", (req, res) => {
	res.json(Array.from(jobStates.values()));
});

statusApp.get("/jobs/:jobId", (req, res) => {
	const job = jobStates.get(req.params.jobId);
	if (!job) {
		res.status(404).json({ error: "job_not_found" });
		return;
	}
	res.json(job);
});

statusApp.listen(STATUS_PORT, () => {
	console.log(
		`[workflow-consumer] 状态接口已启动 http://localhost:${STATUS_PORT}/health`,
	);
});
