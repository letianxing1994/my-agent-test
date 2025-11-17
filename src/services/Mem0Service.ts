import fs from "node:fs";
import path from "node:path";
import type { JsonRecord } from "../types";

// 记忆条目接口
export interface MemoryEntry {
	id: string;
	userId: string;
	projectId: string;
	content: string;
	category: "technical" | "design" | "asset" | "test";
	importance: "low" | "medium" | "high";
	metadata?: JsonRecord;
	createdAt: string;
	updatedAt: string;
}

// Mem0服务接口
export interface Mem0Service {
	// 保存记忆
	saveMemory(
		userId: string,
		projectId: string,
		content: string,
		category: MemoryEntry["category"],
		importance: MemoryEntry["importance"],
		metadata?: JsonRecord,
	): Promise<string>;

	// 获取项目相关的所有记忆
	getProjectMemories(projectId: string): Promise<MemoryEntry[]>;

	// 获取用户相关的所有记忆
	getUserMemories(userId: string): Promise<MemoryEntry[]>;

	// 根据分类获取记忆
	getMemoriesByCategory(
		projectId: string,
		category: MemoryEntry["category"],
	): Promise<MemoryEntry[]>;

	// 获取重要级别以上的记忆
	getImportantMemories(
		projectId: string,
		minImportance: MemoryEntry["importance"],
	): Promise<MemoryEntry[]>;

	// 删除记忆
	deleteMemory(memoryId: string): Promise<boolean>;

	// 更新记忆
	updateMemory(
		memoryId: string,
		updates: Partial<MemoryEntry>,
	): Promise<boolean>;
}

// 模拟Mem0服务实现
export class MockMem0Service implements Mem0Service {
	private memoriesDir: string;
	private memoryStore: Map<string, MemoryEntry>;

	constructor() {
		// 初始化记忆存储目录
		this.memoriesDir = path.join(process.cwd(), "data", "memories");
		fs.mkdirSync(this.memoriesDir, { recursive: true });

		// 内存存储
		this.memoryStore = new Map();

		console.log("Mock Mem0 Service initialized");
	}

	async saveMemory(
		userId: string,
		projectId: string,
		content: string,
		category: MemoryEntry["category"],
		importance: MemoryEntry["importance"],
		metadata: JsonRecord = {},
	): Promise<string> {
		console.log(
			`[Mem0] 保存记忆 - 项目: ${projectId}, 分类: ${category}, 重要性: ${importance}`,
		);

		// 生成唯一ID
		const memoryId = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		const memory: MemoryEntry = {
			id: memoryId,
			userId,
			projectId,
			content,
			category,
			importance,
			metadata,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		// 保存到内存
		this.memoryStore.set(memoryId, memory);

		// 创建项目记忆目录
		const projectMemoriesDir = path.join(this.memoriesDir, projectId);
		fs.mkdirSync(projectMemoriesDir, { recursive: true });

		// 保存到文件系统
		try {
			fs.writeFileSync(
				path.join(projectMemoriesDir, `${memoryId}.json`),
				JSON.stringify(memory, null, 2),
				"utf8",
			);

			// 同时更新项目的记忆索引文件
			this.updateProjectMemoryIndex(projectId, memoryId);
		} catch (error) {
			console.error("保存记忆到文件系统失败:", error);
		}

		return memoryId;
	}

	async getProjectMemories(projectId: string): Promise<MemoryEntry[]> {
		console.log(`[Mem0] 获取项目 ${projectId} 的所有记忆`);

		const memories: MemoryEntry[] = [];

		// 从内存存储中获取
		for (const memory of this.memoryStore.values()) {
			if (memory.projectId === projectId) {
				memories.push(memory);
			}
		}

		// 从文件系统加载额外的记忆
		const projectMemoriesDir = path.join(this.memoriesDir, projectId);
		try {
			if (fs.existsSync(projectMemoriesDir)) {
				const files = fs.readdirSync(projectMemoriesDir);
				for (const file of files) {
					if (file.endsWith(".json") && !file.includes("index")) {
						const memoryId = file.replace(".json", "");

						// 避免重复加载已在内存中的记忆
						if (!this.memoryStore.has(memoryId)) {
							const content = fs.readFileSync(
								path.join(projectMemoriesDir, file),
								"utf8",
							);
							const memory = JSON.parse(content) as MemoryEntry;
							memories.push(memory);
						}
					}
				}
			}
		} catch (error) {
			console.error("从文件系统加载项目记忆失败:", error);
		}

		// 按创建时间倒序排序
		return memories.sort(
			(a, b) =>
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
	}

	async getUserMemories(userId: string): Promise<MemoryEntry[]> {
		console.log(`[Mem0] 获取用户 ${userId} 的所有记忆`);

		const memories: MemoryEntry[] = [];

		// 从内存存储中获取
		for (const memory of this.memoryStore.values()) {
			if (memory.userId === userId) {
				memories.push(memory);
			}
		}

		// 从文件系统加载 (这里简化处理，实际应遍历所有项目目录)
		try {
			const projectDirs = fs.readdirSync(this.memoriesDir);
			for (const projectId of projectDirs) {
				const projectMemoriesDir = path.join(this.memoriesDir, projectId);
				if (fs.statSync(projectMemoriesDir).isDirectory()) {
					const files = fs.readdirSync(projectMemoriesDir);
					for (const file of files) {
						if (file.endsWith(".json") && !file.includes("index")) {
							const content = fs.readFileSync(
								path.join(projectMemoriesDir, file),
								"utf8",
							);
							const memory = JSON.parse(content) as MemoryEntry;

							if (
								memory.userId === userId &&
								!this.memoryStore.has(memory.id)
							) {
								memories.push(memory);
							}
						}
					}
				}
			}
		} catch (error) {
			console.error("从文件系统加载用户记忆失败:", error);
		}

		return memories;
	}

	async getMemoriesByCategory(
		projectId: string,
		category: MemoryEntry["category"],
	): Promise<MemoryEntry[]> {
		console.log(`[Mem0] 获取项目 ${projectId} 的分类 ${category} 记忆`);

		const allMemories = await this.getProjectMemories(projectId);
		return allMemories.filter((memory) => memory.category === category);
	}

	async getImportantMemories(
		projectId: string,
		minImportance: MemoryEntry["importance"],
	): Promise<MemoryEntry[]> {
		console.log(
			`[Mem0] 获取项目 ${projectId} 重要性为 ${minImportance} 及以上的记忆`,
		);

		const importanceLevels = { low: 1, medium: 2, high: 3 };
		const targetLevel = importanceLevels[minImportance];

		const allMemories = await this.getProjectMemories(projectId);
		return allMemories.filter(
			(memory) => importanceLevels[memory.importance] >= targetLevel,
		);
	}

	async deleteMemory(memoryId: string): Promise<boolean> {
		console.log(`[Mem0] 删除记忆: ${memoryId}`);

		const memory = this.memoryStore.get(memoryId);
		if (!memory) {
			return false;
		}

		// 从内存中删除
		this.memoryStore.delete(memoryId);

		// 从文件系统删除
		try {
			const memoryPath = path.join(
				this.memoriesDir,
				memory.projectId,
				`${memoryId}.json`,
			);
			if (fs.existsSync(memoryPath)) {
				fs.unlinkSync(memoryPath);
				// 更新索引
				this.updateProjectMemoryIndex(memory.projectId);
				return true;
			}
		} catch (error) {
			console.error("删除记忆文件失败:", error);
		}

		return false;
	}

	async updateMemory(
		memoryId: string,
		updates: Partial<MemoryEntry>,
	): Promise<boolean> {
		console.log(`[Mem0] 更新记忆: ${memoryId}`);

		const memory = this.memoryStore.get(memoryId);
		if (!memory) {
			// 尝试从文件系统加载
			try {
				const projects = fs.readdirSync(this.memoriesDir);
				for (const projectId of projects) {
					const memoryPath = path.join(
						this.memoriesDir,
						projectId,
						`${memoryId}.json`,
					);
					if (fs.existsSync(memoryPath)) {
						const content = fs.readFileSync(memoryPath, "utf8");
						const loadedMemory = JSON.parse(content) as MemoryEntry;
						this.memoryStore.set(memoryId, loadedMemory);
						return this.updateMemory(memoryId, updates);
					}
				}
			} catch (error) {
				console.error("加载记忆失败:", error);
				return false;
			}

			return false;
		}

		// 更新记忆
		const updatedMemory = {
			...memory,
			...updates,
			updatedAt: new Date().toISOString(),
		};

		// 保存到内存
		this.memoryStore.set(memoryId, updatedMemory);

		// 保存到文件系统
		try {
			const memoryPath = path.join(
				this.memoriesDir,
				memory.projectId,
				`${memoryId}.json`,
			);
			fs.writeFileSync(
				memoryPath,
				JSON.stringify(updatedMemory, null, 2),
				"utf8",
			);
			return true;
		} catch (error) {
			console.error("更新记忆文件失败:", error);
			return false;
		}
	}

	// 辅助方法：更新项目记忆索引
	private updateProjectMemoryIndex(
		projectId: string,
		newMemoryId?: string,
	): void {
		try {
			const indexPath = path.join(this.memoriesDir, projectId, "index.json");

			let index = { memories: [] as string[] };
			if (fs.existsSync(indexPath)) {
				const content = fs.readFileSync(indexPath, "utf8");
				index = JSON.parse(content);
			}

			// 添加新记忆ID
			if (newMemoryId && !index.memories.includes(newMemoryId)) {
				index.memories.push(newMemoryId);
			}

			// 保存索引
			fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
		} catch (error) {
			console.error("更新项目记忆索引失败:", error);
		}
	}
}

// 导出单例实例
export const mem0Service = new MockMem0Service();
