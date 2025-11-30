/**
 * 任务状态管理服务
 * 用于追踪和管理 Agent 预览任务的状态和进度
 */

export enum TaskStatus {
	PENDING = "pending",
	RUNNING = "running",
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
}

class TaskStateManager {
	private tasks: Map<string, TaskState> = new Map();

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
	updateTaskStatus(taskId: string, status: TaskStatus, errorMessage?: string): void {
		const task = this.tasks.get(taskId);
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
		if (errorMessage) {
			task.errorMessage = errorMessage;
		}

		console.log(`[TaskState] 任务 ${taskId} 状态更新: ${status}`);

		// 触发回调
		this.notifyCallback(task);
	}

	/**
	 * 更新任务进度
	 */
	updateTaskProgress(taskId: string, progress: number): void {
		const task = this.tasks.get(taskId);
		if (!task) {
			console.warn(`[TaskState] 任务不存在: ${taskId}`);
			return;
		}

		task.progress = Math.max(0, Math.min(100, progress));
		console.log(`[TaskState] 任务 ${taskId} 进度: ${task.progress}%`);

		// 定期回调（每10%）
		if (task.progress % 10 === 0) {
			this.notifyCallback(task);
		}
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
			});

			if (!response.ok) {
				console.error(
					`[TaskState] 回调失败: ${task.callbackUrl}, status: ${response.status}`,
				);
			} else {
				console.log(`[TaskState] 回调成功: ${task.taskId}`);
			}
		} catch (error) {
			console.error(`[TaskState] 回调异常: ${task.callbackUrl}`, error);
		}
	}

	/**
	 * 获取所有任务
	 */
	getAllTasks(): TaskState[] {
		return Array.from(this.tasks.values());
	}
}

// 单例导出
export const taskStateManager = new TaskStateManager();
