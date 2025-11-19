import { spawn } from "node:child_process";
import fs from "fs-extra";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { CloudProvider } from "../types";
import { storageService } from "./storage/StorageService";

/**
 * MCP 本地工具类型
 */
export type MCPToolType =
	| "blender" // Blender 3D建模
	| "maya" // Maya 3D建模
	| "photoshop" // Photoshop 图像处理
	| "unity" // Unity 游戏引擎
	| "unreal" // Unreal 游戏引擎
	| "reaper" // Reaper 音频编辑
	| "logic" // Logic Pro 音频编辑
	| "vscode"; // VS Code 代码编辑

/**
 * MCP 工具配置
 */
export interface MCPToolConfig {
	type: MCPToolType;
	name: string;
	executablePath: string; // 工具可执行文件路径
	workingDirectory: string; // 工作目录
	mcpServerScript?: string; // MCP服务器脚本路径（如果需要）
	autoSync: boolean; // 是否自动同步输出到云端
	watchPatterns?: string[]; // 监控的文件模式
}

/**
 * MCP 工具状态
 */
export interface MCPToolStatus {
	type: MCPToolType;
	name: string;
	connected: boolean;
	lastActiveTime?: Date;
	processId?: number;
	workingDirectory: string;
}

/**
 * MCP 输出事件
 */
export interface MCPOutputEvent {
	toolType: MCPToolType;
	toolName: string;
	filePath: string;
	fileType: string;
	timestamp: Date;
	projectId?: string;
}

/**
 * MCP 连接器 - 管理本地 DCC 工具和游戏引擎的集成
 *
 * 功能：
 * 1. 启动和管理 MCP 服务器连接到本地工具
 * 2. 监控本地工具的输出文件
 * 3. 自动上传生成的资源到云端
 * 4. 提供工具状态查询和管理
 */
export class MCPConnector extends EventEmitter {
	private tools = new Map<string, MCPToolConfig>();
	private toolProcesses = new Map<string, any>();
	private fileWatchers = new Map<string, fs.FSWatcher>();
	private cloudProvider: CloudProvider = "aliyun";

	constructor(cloudProvider?: CloudProvider) {
		super();
		if (cloudProvider) {
			this.cloudProvider = cloudProvider;
		}
	}

	/**
	 * 注册 MCP 工具
	 */
	registerTool(config: MCPToolConfig): void {
		const key = `${config.type}:${config.name}`;
		this.tools.set(key, config);
		console.log(`已注册 MCP 工具: ${config.name} (${config.type})`);

		// 如果启用自动同步，设置文件监控
		if (config.autoSync) {
			this.setupFileWatcher(key, config);
		}
	}

	/**
	 * 设置文件监控
	 */
	private setupFileWatcher(key: string, config: MCPToolConfig): void {
		const watchDir = config.workingDirectory;

		if (!fs.existsSync(watchDir)) {
			fs.ensureDirSync(watchDir);
		}

		const watcher = fs.watch(
			watchDir,
			{ recursive: true },
			async (eventType, filename) => {
				if (eventType !== "change" && eventType !== "rename") return;
				if (!filename) return;

				const filePath = path.join(watchDir, filename);

				// 检查是否匹配监控模式
				if (config.watchPatterns) {
					const matches = config.watchPatterns.some((pattern) => {
						const regex = new RegExp(
							pattern.replace(/\*/g, ".*").replace(/\?/g, "."),
						);
						return regex.test(filename);
					});
					if (!matches) return;
				}

				// 等待文件写入完成
				await this.waitForFileStable(filePath);

				// 触发输出事件
				const event: MCPOutputEvent = {
					toolType: config.type,
					toolName: config.name,
					filePath,
					fileType: path.extname(filename),
					timestamp: new Date(),
				};

				this.emit("output", event);

				// 自动上传到云端
				if (config.autoSync) {
					await this.uploadOutput(event);
				}
			},
		);

		this.fileWatchers.set(key, watcher);
		console.log(`已设置文件监控: ${watchDir}`);
	}

	/**
	 * 等待文件写入稳定
	 */
	private async waitForFileStable(
		filePath: string,
		timeout = 3000,
	): Promise<void> {
		if (!fs.existsSync(filePath)) return;

		let lastSize = -1;
		const startTime = Date.now();

		while (Date.now() - startTime < timeout) {
			try {
				const stats = await fs.stat(filePath);
				if (stats.size === lastSize) {
					await new Promise((resolve) => setTimeout(resolve, 500));
					const newStats = await fs.stat(filePath);
					if (newStats.size === lastSize) {
						return; // 文件大小稳定
					}
				}
				lastSize = stats.size;
			} catch (error) {
				// 文件可能还在写入
			}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}

	/**
	 * 上传工具输出到云端
	 */
	private async uploadOutput(event: MCPOutputEvent): Promise<void> {
		try {
			const fileName = path.basename(event.filePath);
			const relativePath = path.relative(
				this.tools.get(`${event.toolType}:${event.toolName}`)
					?.workingDirectory || "",
				event.filePath,
			);

			const key = `mcp-output/${event.toolType}/${event.toolName}/${relativePath}`;

			const result = await storageService.upload(
				this.cloudProvider,
				key,
				event.filePath,
				{
					toolType: event.toolType,
					toolName: event.toolName,
					generatedAt: event.timestamp.toISOString(),
					projectId: event.projectId,
				},
			);

			console.log(`已上传 MCP 输出: ${fileName} -> ${result.url}`);

			this.emit("uploaded", {
				...event,
				cloudUrl: result.url,
			});
		} catch (error) {
			console.error(`上传 MCP 输出失败: ${event.filePath}`, error);
			this.emit("uploadError", { event, error });
		}
	}

	/**
	 * 启动 MCP 工具连接
	 */
	async connectTool(toolType: MCPToolType, toolName: string): Promise<void> {
		const key = `${toolType}:${toolName}`;
		const config = this.tools.get(key);

		if (!config) {
			throw new Error(`MCP 工具未注册: ${toolName} (${toolType})`);
		}

		// 如果有 MCP 服务器脚本，启动它
		if (config.mcpServerScript) {
			if (this.toolProcesses.has(key)) {
				console.log(`MCP 工具已连接: ${toolName}`);
				return;
			}

			const process = spawn("node", [config.mcpServerScript], {
				cwd: config.workingDirectory,
				stdio: ["pipe", "pipe", "pipe"],
			});

			process.stdout.on("data", (data) => {
				this.emit("toolOutput", {
					toolType,
					toolName,
					output: data.toString(),
				});
			});

			process.stderr.on("data", (data) => {
				this.emit("toolError", {
					toolType,
					toolName,
					error: data.toString(),
				});
			});

			process.on("exit", (code) => {
				this.toolProcesses.delete(key);
				this.emit("toolDisconnected", { toolType, toolName, exitCode: code });
			});

			this.toolProcesses.set(key, process);
			console.log(`已启动 MCP 服务器: ${toolName} (PID: ${process.pid})`);
		} else {
			console.log(
				`MCP 工具 ${toolName} 无需服务器进程，仅监控文件输出`,
			);
		}
	}

	/**
	 * 断开 MCP 工具连接
	 */
	disconnectTool(toolType: MCPToolType, toolName: string): void {
		const key = `${toolType}:${toolName}`;
		const process = this.toolProcesses.get(key);

		if (process) {
			process.kill();
			this.toolProcesses.delete(key);
			console.log(`已断开 MCP 工具: ${toolName}`);
		}

		const watcher = this.fileWatchers.get(key);
		if (watcher) {
			watcher.close();
			this.fileWatchers.delete(key);
		}
	}

	/**
	 * 获取所有工具状态
	 */
	getToolsStatus(): MCPToolStatus[] {
		return Array.from(this.tools.entries()).map(([key, config]) => {
			const process = this.toolProcesses.get(key);
			return {
				type: config.type,
				name: config.name,
				connected: !!process,
				processId: process?.pid,
				workingDirectory: config.workingDirectory,
			};
		});
	}

	/**
	 * 获取特定工具状态
	 */
	getToolStatus(
		toolType: MCPToolType,
		toolName: string,
	): MCPToolStatus | null {
		const key = `${toolType}:${toolName}`;
		const config = this.tools.get(key);

		if (!config) return null;

		const process = this.toolProcesses.get(key);
		return {
			type: config.type,
			name: config.name,
			connected: !!process,
			processId: process?.pid,
			workingDirectory: config.workingDirectory,
		};
	}

	/**
	 * 手动触发文件上传
	 */
	async manualUpload(
		toolType: MCPToolType,
		toolName: string,
		filePath: string,
		projectId?: string,
	): Promise<string> {
		const event: MCPOutputEvent = {
			toolType,
			toolName,
			filePath,
			fileType: path.extname(filePath),
			timestamp: new Date(),
			projectId,
		};

		await this.uploadOutput(event);

		// 等待上传完成事件
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error("上传超时")),
				30000,
			);

			const onUploaded = (data: any) => {
				if (data.filePath === filePath) {
					clearTimeout(timeout);
					this.off("uploaded", onUploaded);
					this.off("uploadError", onError);
					resolve(data.cloudUrl);
				}
			};

			const onError = (data: any) => {
				if (data.event.filePath === filePath) {
					clearTimeout(timeout);
					this.off("uploaded", onUploaded);
					this.off("uploadError", onError);
					reject(data.error);
				}
			};

			this.on("uploaded", onUploaded);
			this.on("uploadError", onError);
		});
	}

	/**
	 * 清理所有连接
	 */
	cleanup(): void {
		for (const [key] of this.tools) {
			const [type, name] = key.split(":");
			this.disconnectTool(type as MCPToolType, name);
		}
		this.tools.clear();
		console.log("已清理所有 MCP 连接");
	}
}

// 单例导出
export const mcpConnector = new MCPConnector();
