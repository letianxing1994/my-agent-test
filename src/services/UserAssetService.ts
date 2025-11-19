import type { Request, Response, NextFunction } from "express";
import path from "node:path";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import { storageService } from "../services/storage/StorageService";
import type { CloudProvider } from "../types";

// 用户素材类型
export type UserAssetType =
	| "planning_doc" // 策划文档
	| "art_concept" // 原画
	| "art_texture" // 贴图
	| "art_model" // 3D模型
	| "art_animation" // 动画
	| "audio_music" // 音乐
	| "audio_sfx" // 音效
	| "code_source" // 源代码
	| "code_asset"; // 代码资产

export interface UserAssetMetadata {
	assetId: string;
	projectId: string;
	assetType: UserAssetType;
	fileName: string;
	fileSize: number;
	mimeType: string;
	localPath: string;
	cloudUrl?: string;
	cloudProvider?: CloudProvider;
	uploadedBy: string;
	uploadedAt: string;
	description?: string;
	tags?: string[];
	// Agent 可用性标记
	availableForAgents: string[]; // ["planning-agent", "art-agent", etc.]
}

// 用户素材服务
export class UserAssetService {
	private assetsDir: string;
	private metadataStore: Map<string, UserAssetMetadata>;

	constructor(baseDir = "./data/user-assets") {
		this.assetsDir = baseDir;
		this.metadataStore = new Map();
		this.ensureDirectories();
		this.loadMetadata();
	}

	private ensureDirectories() {
		fs.ensureDirSync(this.assetsDir);
		fs.ensureDirSync(path.join(this.assetsDir, "metadata"));
	}

	private loadMetadata() {
		const metadataDir = path.join(this.assetsDir, "metadata");
		if (!fs.existsSync(metadataDir)) return;

		const files = fs.readdirSync(metadataDir);
		for (const file of files) {
			if (file.endsWith(".json")) {
				try {
					const data = fs.readJSONSync(path.join(metadataDir, file));
					this.metadataStore.set(data.assetId, data);
				} catch (error) {
					console.error(`加载素材元数据失败: ${file}`, error);
				}
			}
		}
	}

	private saveMetadata(metadata: UserAssetMetadata) {
		const metadataPath = path.join(
			this.assetsDir,
			"metadata",
			`${metadata.assetId}.json`,
		);
		fs.writeJSONSync(metadataPath, metadata, { spaces: 2 });
		this.metadataStore.set(metadata.assetId, metadata);
	}

	/**
	 * 上传用户素材
	 */
	async uploadAsset(
		projectId: string,
		file: Express.Multer.File,
		options: {
			assetType: UserAssetType;
			uploadedBy: string;
			description?: string;
			tags?: string[];
			cloudProvider?: CloudProvider;
			autoUploadToCloud?: boolean;
		},
	): Promise<UserAssetMetadata> {
		const assetId = uuidv4();
		const ext = path.extname(file.originalname);
		const fileName = `${assetId}${ext}`;

		// 根据类型分类存储
		const category = options.assetType.split("_")[0];
		const assetDir = path.join(this.assetsDir, projectId, category);
		fs.ensureDirSync(assetDir);

		const localPath = path.join(assetDir, fileName);
		await fs.move(file.path, localPath, { overwrite: true });

		// 创建元数据
		const metadata: UserAssetMetadata = {
			assetId,
			projectId,
			assetType: options.assetType,
			fileName: file.originalname,
			fileSize: file.size,
			mimeType: file.mimetype,
			localPath,
			uploadedBy: options.uploadedBy,
			uploadedAt: new Date().toISOString(),
			description: options.description,
			tags: options.tags || [],
			availableForAgents: this.determineAvailableAgents(options.assetType),
			cloudProvider: options.cloudProvider,
		};

		// 自动上传到云端
		if (options.autoUploadToCloud !== false) {
			try {
				const cloudUrl = await this.uploadToCloud(
					localPath,
					fileName,
					options.cloudProvider || "aliyun",
				);
				metadata.cloudUrl = cloudUrl;
			} catch (error) {
				console.error("云端上传失败，仅保存本地", error);
			}
		}

		this.saveMetadata(metadata);
		return metadata;
	}

	/**
	 * 上传到云端存储
	 */
	private async uploadToCloud(
		localPath: string,
		fileName: string,
		provider: CloudProvider,
	): Promise<string> {
		const key = `user-assets/${fileName}`;
		const result = await storageService.upload(provider, key, localPath, {
			uploadedBy: "user",
			timestamp: new Date().toISOString(),
		});
		return result.url;
	}

	/**
	 * 根据素材类型确定可用的 Agent
	 */
	private determineAvailableAgents(assetType: UserAssetType): string[] {
		const mapping: Record<UserAssetType, string[]> = {
			planning_doc: ["planning-agent"],
			art_concept: ["art-agent"],
			art_texture: ["art-agent", "tech-agent"],
			art_model: ["art-agent", "tech-agent"],
			art_animation: ["art-agent", "tech-agent"],
			audio_music: ["music-agent", "tech-agent"],
			audio_sfx: ["music-agent", "tech-agent"],
			code_source: ["tech-agent"],
			code_asset: ["tech-agent"],
		};
		return mapping[assetType] || [];
	}

	/**
	 * 获取项目的所有用户素材
	 */
	getProjectAssets(
		projectId: string,
		assetType?: UserAssetType,
	): UserAssetMetadata[] {
		const assets = Array.from(this.metadataStore.values()).filter(
			(asset) => asset.projectId === projectId,
		);

		if (assetType) {
			return assets.filter((asset) => asset.assetType === assetType);
		}

		return assets;
	}

	/**
	 * 获取 Agent 可用的素材
	 */
	getAssetsForAgent(projectId: string, agentId: string): UserAssetMetadata[] {
		return Array.from(this.metadataStore.values()).filter(
			(asset) =>
				asset.projectId === projectId &&
				asset.availableForAgents.includes(agentId),
		);
	}

	/**
	 * 获取单个素材
	 */
	getAsset(assetId: string): UserAssetMetadata | undefined {
		return this.metadataStore.get(assetId);
	}

	/**
	 * 删除素材
	 */
	async deleteAsset(assetId: string): Promise<boolean> {
		const metadata = this.metadataStore.get(assetId);
		if (!metadata) return false;

		try {
			// 删除本地文件
			if (fs.existsSync(metadata.localPath)) {
				await fs.remove(metadata.localPath);
			}

			// 删除元数据
			const metadataPath = path.join(
				this.assetsDir,
				"metadata",
				`${assetId}.json`,
			);
			if (fs.existsSync(metadataPath)) {
				await fs.remove(metadataPath);
			}

			this.metadataStore.delete(assetId);
			return true;
		} catch (error) {
			console.error("删除素材失败", error);
			return false;
		}
	}

	/**
	 * 批量上传到云端（用于本地生成的资源）
	 */
	async syncLocalAssetsToCloud(
		projectId: string,
		localDir: string,
		provider: CloudProvider,
	): Promise<
		Array<{
			localPath: string;
			cloudUrl: string;
			fileName: string;
		}>
	> {
		const results: Array<{
			localPath: string;
			cloudUrl: string;
			fileName: string;
		}> = [];

		const files = await this.getFilesRecursively(localDir);

		for (const file of files) {
			try {
				const relativePath = path.relative(localDir, file);
				const key = `projects/${projectId}/local-generated/${relativePath}`;

				const result = await storageService.upload(provider, key, file, {
					generatedLocally: true,
					projectId,
				});
				results.push({
					localPath: file,
					cloudUrl: result.url,
					fileName: relativePath,
				});

				console.log(`已上传: ${relativePath} -> ${result.url}`);
			} catch (error) {
				console.error(`上传失败: ${file}`, error);
			}
		}

		return results;
	}

	/**
	 * 递归获取目录下所有文件
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
}

// 导出单例
export const userAssetService = new UserAssetService();

// Express 中间件：处理用户素材上传
export const handleUserAssetUpload = async (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	try {
		const { projectId } = req.params;
		const { assetType, description, tags, cloudProvider, uploadedBy } =
			req.body;

		if (!req.file) {
			return res.status(400).json({ error: "没有上传文件" });
		}

		const metadata = await userAssetService.uploadAsset(
			projectId,
			req.file,
			{
				assetType,
				uploadedBy: uploadedBy || "system",
				description,
				tags: tags ? JSON.parse(tags) : undefined,
				cloudProvider,
			},
		);

		res.json({
			success: true,
			asset: metadata,
		});
	} catch (error) {
		console.error("用户素材上传失败", error);
		next(error);
	}
};
