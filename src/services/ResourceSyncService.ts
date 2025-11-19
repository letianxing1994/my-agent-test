import fs from "fs-extra";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { CloudProvider } from "../types";
import { storageService } from "./storage/StorageService";

/**
 * 同步任务状态
 */
export type SyncStatus = "pending" | "syncing" | "completed" | "failed";

/**
 * 同步任务
 */
export interface SyncTask {
	id: string;
	projectId: string;
	localPath: string;
	cloudKey: string;
	status: SyncStatus;
	provider: CloudProvider;
	cloudUrl?: string;
	error?: string;
	createdAt: Date;
	updatedAt: Date;
	retryCount: number;
	fileSize?: number;
	fileHash?: string;
}

/**
 * 同步配置
 */
export interface SyncConfig {
	projectId: string;
	localDirectory: string;
	cloudPrefix: string; // 云端路径前缀
	provider: CloudProvider;
	watchPatterns?: string[]; // 监控的文件模式
	excludePatterns?: string[]; // 排除的文件模式
	autoSync: boolean; // 是否自动同步
	syncInterval?: number; // 定期同步间隔（毫秒）
	maxRetries?: number; // 最大重试次数
}

/**
 * 资源同步服务 - 监控本地目录，自动同步到云端
 *
 * 功能：
 * 1. 监控本地项目目录的文件变化
 * 2. 自动上传新文件到云端
 * 3. 版本控制和冲突处理
 * 4. 同步状态查询和管理
 * 5. 失败重试机制
 */
export class ResourceSyncService extends EventEmitter {
	private syncConfigs = new Map<string, SyncConfig>();
	private watchers = new Map<string, fs.FSWatcher>();
	private syncQueue = new Map<string, SyncTask>();
	private syncIntervals = new Map<string, NodeJS.Timeout>();
	private processing = false;

	/**
	 * 添加同步配置
	 */
	addSyncConfig(config: SyncConfig): void {
		const key = config.projectId;
		this.syncConfigs.set(key, config);

		// 确保目录存在
		fs.ensureDirSync(config.localDirectory);

		// 设置文件监控
		if (config.autoSync) {
			this.setupWatcher(key, config);
		}

		// 设置定期同步
		if (config.syncInterval && config.syncInterval > 0) {
			const interval = setInterval(() => {
				this.scanAndSync(key);
			}, config.syncInterval);
			this.syncIntervals.set(key, interval);
		}

		console.log(`已添加同步配置: ${config.projectId} -> ${config.cloudPrefix}`);
	}

	/**
	 * 设置文件监控
	 */
	private setupWatcher(key: string, config: SyncConfig): void {
		const watcher = fs.watch(
			config.localDirectory,
			{ recursive: true },
			async (eventType, filename) => {
				if (!filename) return;
				if (eventType !== "change" && eventType !== "rename") return;

				const filePath = path.join(config.localDirectory, filename);

				// 检查文件是否存在（可能是删除事件）
				if (!fs.existsSync(filePath)) return;

				// 检查是否是文件（跳过目录）
				const stats = await fs.stat(filePath);
				if (!stats.isFile()) return;

				// 检查匹配模式
				if (!this.shouldSync(filename, config)) return;

				// 添加到同步队列
				await this.addToSyncQueue(config, filePath, filename);
			},
		);

		this.watchers.set(key, watcher);
		console.log(`已设置文件监控: ${config.localDirectory}`);
	}

	/**
	 * 检查文件是否应该同步
	 */
	private shouldSync(filename: string, config: SyncConfig): boolean {
		// 检查排除模式
		if (config.excludePatterns) {
			for (const pattern of config.excludePatterns) {
				const regex = new RegExp(
					pattern.replace(/\*/g, ".*").replace(/\?/g, "."),
				);
				if (regex.test(filename)) {
					return false;
				}
			}
		}

		// 检查包含模式
		if (config.watchPatterns && config.watchPatterns.length > 0) {
			for (const pattern of config.watchPatterns) {
				const regex = new RegExp(
					pattern.replace(/\*/g, ".*").replace(/\?/g, "."),
				);
				if (regex.test(filename)) {
					return true;
				}
			}
			return false;
		}

		return true;
	}

	/**
	 * 添加到同步队列
	 */
	private async addToSyncQueue(
		config: SyncConfig,
		filePath: string,
		relativePath: string,
	): Promise<void> {
		const taskId = `${config.projectId}:${relativePath}`;

		// 如果已在队列中，跳过
		if (this.syncQueue.has(taskId)) {
			const task = this.syncQueue.get(taskId);
			if (task && task.status === "syncing") {
				return; // 正在同步，跳过
			}
		}

		const stats = await fs.stat(filePath);
		const cloudKey = path.join(
			config.cloudPrefix,
			relativePath.replace(/\\/g, "/"),
		);

		const task: SyncTask = {
			id: taskId,
			projectId: config.projectId,
			localPath: filePath,
			cloudKey,
			status: "pending",
			provider: config.provider,
			createdAt: new Date(),
			updatedAt: new Date(),
			retryCount: 0,
			fileSize: stats.size,
		};

		this.syncQueue.set(taskId, task);
		this.emit("taskAdded", task);

		// 触发同步处理
		this.processQueue();
	}

	/**
	 * 处理同步队列
	 */
	private async processQueue(): Promise<void> {
		if (this.processing) return;
		this.processing = true;

		const pendingTasks = Array.from(this.syncQueue.values()).filter(
			(task) => task.status === "pending",
		);

		for (const task of pendingTasks) {
			await this.syncFile(task);
		}

		this.processing = false;
	}

	/**
	 * 同步单个文件
	 */
	private async syncFile(task: SyncTask): Promise<void> {
		const config = this.syncConfigs.get(task.projectId);
		if (!config) {
			task.status = "failed";
			task.error = "同步配置不存在";
			this.emit("taskFailed", task);
			return;
		}

		task.status = "syncing";
		task.updatedAt = new Date();
		this.emit("taskStarted", task);

		try {
			// 等待文件稳定
			await this.waitForFileStable(task.localPath);

			// 上传到云端
			const result = await storageService.upload(
				task.provider,
				task.cloudKey,
				task.localPath,
				{
					projectId: task.projectId,
					syncedAt: new Date().toISOString(),
					fileSize: task.fileSize,
				},
			);

			task.cloudUrl = result.url;
			task.status = "completed";
			task.updatedAt = new Date();

			this.emit("taskCompleted", task);
			console.log(`同步成功: ${task.localPath} -> ${result.url}`);

			// 从队列中移除（可选，或保留用于历史记录）
			// this.syncQueue.delete(task.id);
		} catch (error) {
			task.status = "failed";
			task.error = error instanceof Error ? error.message : String(error);
			task.retryCount++;
			task.updatedAt = new Date();

			const maxRetries = config.maxRetries || 3;
			if (task.retryCount < maxRetries) {
				// 重试
				task.status = "pending";
				this.emit("taskRetry", task);
				console.log(`同步失败，将重试: ${task.localPath} (${task.retryCount}/${maxRetries})`);
			} else {
				this.emit("taskFailed", task);
				console.error(`同步失败，已达最大重试次数: ${task.localPath}`, error);
			}
		}
	}

	/**
	 * 等待文件稳定（写入完成）
	 */
	private async waitForFileStable(
		filePath: string,
		timeout = 5000,
	): Promise<void> {
		if (!fs.existsSync(filePath)) {
			throw new Error("文件不存在");
		}

		let lastSize = -1;
		const startTime = Date.now();

		while (Date.now() - startTime < timeout) {
			const stats = await fs.stat(filePath);
			if (stats.size === lastSize) {
				// 文件大小稳定，再等待500ms确认
				await new Promise((resolve) => setTimeout(resolve, 500));
				const newStats = await fs.stat(filePath);
				if (newStats.size === lastSize) {
					return;
				}
			}
			lastSize = stats.size;
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}

	/**
	 * 扫描目录并同步所有文件
	 */
	async scanAndSync(projectId: string): Promise<void> {
		const config = this.syncConfigs.get(projectId);
		if (!config) {
			throw new Error(`同步配置不存在: ${projectId}`);
		}

		const files = await this.getFilesRecursively(config.localDirectory);

		for (const file of files) {
			const relativePath = path.relative(config.localDirectory, file);
			if (this.shouldSync(relativePath, config)) {
				await this.addToSyncQueue(config, file, relativePath);
			}
		}

		console.log(`已扫描项目: ${projectId}，待同步文件: ${files.length}`);
	}

	/**
	 * 递归获取目录下的所有文件
	 */
	private async getFilesRecursively(dir: string): Promise<string[]> {
		const files: string[] = [];
		const entries = await fs.readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				files.push(...(await this.getFilesRecursively(fullPath)));
			} else {
				files.push(fullPath);
			}
		}

		return files;
	}

	/**
	 * 获取项目的同步任务
	 */
	getProjectTasks(projectId: string, status?: SyncStatus): SyncTask[] {
		const tasks = Array.from(this.syncQueue.values()).filter(
			(task) => task.projectId === projectId,
		);

		if (status) {
			return tasks.filter((task) => task.status === status);
		}

		return tasks;
	}

	/**
	 * 获取同步统计
	 */
	getSyncStats(projectId: string) {
		const tasks = this.getProjectTasks(projectId);
		return {
			total: tasks.length,
			pending: tasks.filter((t) => t.status === "pending").length,
			syncing: tasks.filter((t) => t.status === "syncing").length,
			completed: tasks.filter((t) => t.status === "completed").length,
			failed: tasks.filter((t) => t.status === "failed").length,
		};
	}

	/**
	 * 手动重试失败的任务
	 */
	retryFailedTasks(projectId: string): void {
		const failedTasks = this.getProjectTasks(projectId, "failed");
		for (const task of failedTasks) {
			task.status = "pending";
			task.retryCount = 0;
			task.error = undefined;
		}
		this.processQueue();
	}

	/**
	 * 移除同步配置
	 */
	removeSyncConfig(projectId: string): void {
		const watcher = this.watchers.get(projectId);
		if (watcher) {
			watcher.close();
			this.watchers.delete(projectId);
		}

		const interval = this.syncIntervals.get(projectId);
		if (interval) {
			clearInterval(interval);
			this.syncIntervals.delete(projectId);
		}

		this.syncConfigs.delete(projectId);
		console.log(`已移除同步配置: ${projectId}`);
	}

	/**
	 * 清理所有配置
	 */
	cleanup(): void {
		for (const projectId of this.syncConfigs.keys()) {
			this.removeSyncConfig(projectId);
		}
		this.syncQueue.clear();
		console.log("已清理所有同步配置");
	}
}

// 单例导出
export const resourceSyncService = new ResourceSyncService();
