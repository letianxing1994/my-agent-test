/**
 * 任务状态管理服务
 * 用于追踪和管理 Agent 预览任务的状态和进度
 */

import { EventEmitter } from "node:events";

export enum TaskStatus {
	PENDING = "pending",
	RUNNING = "running",
	IN_PROGRESS = "in_progress", // 新增：用于 ReAct Agent
	COMPLETED = "completed",
	FAILED = "failed",
}

export interface TaskState {
	taskId: string;
	projectId: string;
	stageId: string;
	status: TaskStatus;
	progress: number; // 0-100
	startTime?: Date;
	completeTime?: Date;
	resultData?: {
		artifactType?: string;
		artifactUrl?: string;
		previewUrl?: string;
		[key: string]: unknown;
	};
	errorMessage?: string;
	callbackUrl?: string; // game-factory 的回调地址

	// ReAct Planning Agent 扩展字段
	metadata?: {
		phase?: string;
		currentGoal?: string;
		iteration?: number;
		awaitingUserInput?: boolean;
		question?: string;
		[key: string]: unknown;
	};
}

class TaskStateManager extends EventEmitter {
	private tasks: Map<string, TaskState> = new Map();

	constructor() {
		super();
	}

	/**
	 * 创建新任务
	 */
	createTask(
		taskId: string,
		projectId: string,
		stageId: string,
		callbackUrl?: string,
	): TaskState {
		const task: TaskState = {
			taskId,
			projectId,
			stageId,
			status: TaskStatus.PENDING,
			progress: 0,
			callbackUrl,
		};
		this.tasks.set(taskId, task);
		console.log(`[TaskState] 创建任务: ${taskId}, stageId: ${stageId}`);
		return task;
	}

	/**
	 * 获取任务状态
	 */
	getTask(taskId: string): TaskState | undefined {
		return this.tasks.get(taskId);
	}

	/**
	 * 通过 projectId 获取任务
	 */
	getTaskByProjectId(projectId: string): TaskState | undefined {
		for (const task of this.tasks.values()) {
			if (task.projectId === projectId) {
				return task;
			}
		}
		return undefined;
	}

	/**
	 * 更新任务状态
	 */
	updateTaskStatus(taskId: string, status: TaskStatus, metadata?: any): void {
		let task = this.tasks.get(taskId);
		// 如果taskId查找失败，尝试用projectId查找（兼容Planning Agent使用projectId的情况）
		if (!task) {
			task = this.getTaskByProjectId(taskId);
		}
		if (!task) {
			console.warn(`[TaskState] 任务不存在: ${taskId}`);
			return;
		}

		task.status = status;
		if (status === TaskStatus.RUNNING && !task.startTime) {
			task.startTime = new Date();
		}
		if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
			task.completeTime = new Date();
			task.progress = status === TaskStatus.COMPLETED ? 100 : task.progress;
		}

		// 更新元数据
		if (metadata) {
			if (typeof metadata === "string") {
				// 兼容旧的错误消息参数
				task.errorMessage = metadata;
			} else {
				task.metadata = { ...task.metadata, ...metadata };
				if (metadata.errorMessage) {
					task.errorMessage = metadata.errorMessage;
				}
			}
		}

		console.log(`[TaskState] 任务 ${taskId} 状态更新: ${status}`);

		// 发射事件，通知所有订阅者（SSE 连接）
		this.emit("taskUpdate", { taskId, task });

		// 只在任务完成或失败时触发回调，避免频繁回调导致429错误
		if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
			this.notifyCallback(task);
		}
	}

	/**
	 * 更新任务进度
	 */
	updateTaskProgress(taskId: string, progress: number, metadata?: any): void {
		let task = this.tasks.get(taskId);
		// 如果taskId查找失败，尝试用projectId查找（兼容Planning Agent使用projectId的情况）
		if (!task) {
			task = this.getTaskByProjectId(taskId);
		}
		if (!task) {
			console.warn(`[TaskState] 任务不存在: ${taskId}`);
			return;
		}

		const oldProgress = task.progress;
		task.progress = Math.max(0, Math.min(100, progress));

		// 更新元数据
		if (metadata) {
			task.metadata = { ...task.metadata, ...metadata };
		}

		console.log(`[TaskState] 任务 ${taskId} 进度: ${task.progress}%`);

		// 发射事件，通知所有订阅者（SSE 连接）
		this.emit("taskUpdate", { taskId, task });

		// 进度更新不触发回调，只有完成或失败时才回调
		// 这样可以避免频繁回调导致429错误
	}

	/**
	 * 设置任务结果
	 */
	setTaskResult(taskId: string, resultData: TaskState["resultData"]): void {
		const task = this.tasks.get(taskId);
		if (!task) {
			console.warn(`[TaskState] 任务不存在: ${taskId}`);
			return;
		}

		task.resultData = resultData;
		console.log(`[TaskState] 任务 ${taskId} 结果已设置`);
	}

	/**
	 * 删除任务（清理）
	 */
	deleteTask(taskId: string): void {
		this.tasks.delete(taskId);
		console.log(`[TaskState] 任务已删除: ${taskId}`);
	}

	/**
	 * 通知 game-factory 回调
	 */
	private async notifyCallback(task: TaskState): Promise<void> {
		if (!task.callbackUrl) {
			return;
		}

		// 验证 callbackUrl 格式
		try {
			new URL(task.callbackUrl);
		} catch (error) {
			console.warn(`[TaskState] 无效的回调URL: ${task.callbackUrl}`);
			return;
		}

		try {
			const response = await fetch(task.callbackUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					taskId: task.taskId,
					status: task.status,
					progress: task.progress,
					startTime: task.startTime,
					completeTime: task.completeTime,
					resultData: task.resultData,
					errorMessage: task.errorMessage,
				}),
				// 添加超时控制
				signal: AbortSignal.timeout(5000), // 5秒超时
			});

			if (!response.ok) {
				console.warn(
					`[TaskState] 回调失败: ${task.callbackUrl}, status: ${response.status}`,
				);
			} else {
				console.log(`[TaskState] 回调成功: ${task.taskId}`);
			}
		} catch (error) {
			// 降低错误级别，避免干扰主流程
			if (error instanceof Error && error.name === 'AbortError') {
				console.warn(`[TaskState] 回调超时: ${task.callbackUrl}`);
			} else if (error instanceof Error && 'cause' in error) {
				const cause = error.cause as any;
				if (cause?.code === 'ECONNREFUSED') {
					console.warn(
						`[TaskState] 回调服务未运行: ${task.callbackUrl}`,
						`(这在开发环境中是正常的，如果不需要回调可以忽略此警告)`
					);
				} else {
					console.warn(`[TaskState] 回调异常: ${task.callbackUrl}`, error.message);
				}
			} else {
				console.warn(`[TaskState] 回调异常: ${task.callbackUrl}`, error);
			}
		}
	}

	/**
	 * 获取所有任务
	 */
	getAllTasks(): TaskState[] {
		return Array.from(this.tasks.values());
	}

	// ==================== ReAct Planning Agent 扩展方法 ====================

	/**
	 * 发射思考流事件（用于前端流式显示 Agent 思考过程）
	 */
	emitThoughtStream(taskId: string, thought: string, metadata?: any): void {
		const task = this.tasks.get(taskId);
		if (!task) {
			console.warn(`[TaskState] 任务不存在: ${taskId}`);
			return;
		}

		this.emit("thoughtStream", {
			taskId,
			thought,
			metadata,
			timestamp: new Date(),
		});

		console.log(`[TaskState] 思考流 ${taskId}: ${thought.substring(0, 50)}...`);
	}

	/**
	 * 发射用户输入请求事件
	 */
	emitUserInputRequest(
		taskId: string,
		goalId: string,
		question: string,
		options?: string[]
	): void {
		const task = this.tasks.get(taskId);
		if (!task) {
			console.warn(`[TaskState] 任务不存在: ${taskId}`);
			return;
		}

		this.emit("userInputRequired", {
			taskId,
			goalId,
			question,
			options,
			timestamp: new Date(),
		});

		// 更新任务元数据
		task.metadata = {
			...task.metadata,
			awaitingUserInput: true,
			question,
		};

		console.log(`[TaskState] 等待用户输入 ${taskId}: ${question}`);
	}

	/**
	 * 接收用户输入并发射事件
	 */
	receiveUserInput(taskId: string, goalId: string, input: string): void {
		const task = this.tasks.get(taskId);
		if (!task) {
			console.warn(`[TaskState] 任务不存在: ${taskId}`);
			return;
		}

		this.emit("userInputReceived", {
			taskId,
			goalId,
			input,
			timestamp: new Date(),
		});

		// 更新任务元数据
		if (task.metadata) {
			task.metadata.awaitingUserInput = false;
			task.metadata.question = undefined;
		}

		console.log(`[TaskState] 收到用户输入 ${taskId}: ${input}`);
	}

	/**
	 * 发射目标更新事件
	 */
	emitGoalUpdate(taskId: string, goalName: string): void {
		const task = this.tasks.get(taskId);
		if (!task) {
			console.warn(`[TaskState] 任务不存在: ${taskId}`);
			return;
		}

		this.emit("goalUpdate", {
			taskId,
			goalName,
			timestamp: new Date(),
		});

		// 更新任务元数据
		if (task.metadata) {
			task.metadata.currentGoal = goalName;
		}

		console.log(`[TaskState] 目标更新 ${taskId}: ${goalName}`);
	}
}

// 单例导出
export const taskStateManager = new TaskStateManager();
