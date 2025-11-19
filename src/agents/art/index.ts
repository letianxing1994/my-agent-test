import "dotenv/config";
import path from "node:path";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import { WebSocket } from "ws";

// 导入共享类型
import {
	type AgentArtifact,
	type AgentMessage,
	type GDD,
	type JsonValue,
	MessageType,
	type StageConfig,
} from "../../types";

// 导入服务
import { knowledgeBaseService } from "../../services/KnowledgeBaseService";
import { mem0Service } from "../../services/Mem0Service";
import { storageService } from "../../services/storage/StorageService";

const LARGE_FILE_THRESHOLD =
	Number(process.env.LARGE_UPLOAD_THRESHOLD_MB || "50") * 1024 * 1024;
const MULTIPART_CHUNK_SIZE =
	Number(process.env.MULTIPART_CHUNK_SIZE_MB || "16") * 1024 * 1024;

const RESOURCE_FILE_MAP: Record<
	string,
	{
		extension: string;
		formatLabel: string;
		defaultUsage: string;
		contentHint: string;
	}
> = {
	character: {
		extension: "glb",
		formatLabel: "3d_model",
		defaultUsage: "character",
		contentHint: "glTF binary mesh",
	},
	environment: {
		extension: "glb",
		formatLabel: "3d_environment",
		defaultUsage: "scene",
		contentHint: "Environment mesh",
	},
	ui: {
		extension: "png",
		formatLabel: "ui_sprite",
		defaultUsage: "ui",
		contentHint: "2D UI texture",
	},
	icon: {
		extension: "png",
		formatLabel: "icon",
		defaultUsage: "ui",
		contentHint: "Icon sprite",
	},
	item: {
		extension: "glb",
		formatLabel: "3d_prop",
		defaultUsage: "prop",
		contentHint: "Game prop",
	},
	texture: {
		extension: "exr",
		formatLabel: "pbr_texture",
		defaultUsage: "material",
		contentHint: "PBR texture set",
	},
	material: {
		extension: "mat.json",
		formatLabel: "material_profile",
		defaultUsage: "material",
		contentHint: "Material definition",
	},
	shader: {
		extension: "shader",
		formatLabel: "shader_code",
		defaultUsage: "rendering",
		contentHint: "Rendering shader",
	},
	animation: {
		extension: "anim.json",
		formatLabel: "animation_clip",
		defaultUsage: "animation",
		contentHint: "Skeletal animation clip",
	},
	particle: {
		extension: "particle.json",
		formatLabel: "particle_preset",
		defaultUsage: "vfx",
		contentHint: "VFX preset",
	},
};

type CloudProvider = "aliyun" | "gcp";

interface ArtRequirement {
	type: string;
	description: string;
	quantity: number;
	priority: "high" | "medium" | "low";
	format?: string;
	usage?: string;
}

interface ProjectMetadata {
	cloudProvider?: CloudProvider;
}

interface ResourceRequest {
	type?: string;
	description?: string;
	style?: string;
}

interface GeneratedResource {
	id: string;
	projectId: string;
	type: string;
	description: string;
	filePath: string;
	format: string;
	style: string;
	priority: "high" | "medium" | "low";
	usage?: string;
	createdAt: string;
	updatedAt: string;
	remoteUrl?: string;
	provider?: CloudProvider;
	uploadMetadata?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

interface ResourceFeedback {
	resourceId: string;
	suggestions: string;
}

interface ControlMessagePayload {
	action?: "pause" | "resume" | "abort";
	notes?: string;
	updates?: {
		overrides?: Partial<GDD>;
	};
}

interface GDDPayload {
	gdd?: GDD;
	stageConfig?: StageConfig;
	project?: ProjectMetadata;
}

// 模拟AI模型调用（多模态模型，用于生成图像）
class AIModel {
  // 生成图像的方法（模拟）
	async generateImage(
		prompt: string,
		style: string,
		extension = "png",
	): Promise<string> {
    console.log(`[模型调用] 生成图像 - 提示词: ${prompt}, 风格: ${style}`);
    
    // 从知识库获取相关美术风格指南
    const artKnowledge = await knowledgeBaseService.searchByKeyword(
			`${style}风格设计`,
    );
    
    console.log(`获取了 ${artKnowledge.length} 条美术创作相关知识`);
    
    // 这里是模拟的图像生成逻辑，后续可以替换为真实的多模态模型API调用
    // 例如DALL-E、Midjourney、Stable Diffusion等
    
		const generatedFileName = `generated_${Date.now()}.${extension}`;
    
    // 保存美术资源生成经验到Mem0
    await mem0Service.saveMemory(
			"system",
			"art_image_creation",
      `生成了${style}风格的图像，提示词：${prompt}`,
			"asset",
			"medium",
      {
        prompt,
        style,
				fileName: generatedFileName,
			},
    );
    
    return generatedFileName;
  }
  
  // 分析GDD中的美术需求
	analyzeArtRequirements(
		gdd: GDD,
		agentMeta?: StageConfig['agentMeta'],
	): ArtRequirement[] {
		console.log("[模型调用] 分析美术需求");
		const primaryGenre = gdd.primaryGenre ?? gdd.gameType;
		
		// 根据agentMeta调整分析策略
		if (agentMeta?.dimension) {
			console.log(`[模型提示] 美术Agent专精 ${agentMeta.dimension} 资产制作`);
		}
		if (agentMeta?.specialization) {
			console.log(
				`[模型提示] 美术风格偏好: ${agentMeta.specialization}`,
			);
		}
		if (agentMeta?.extraTraits) {
			console.log(`[模型提示] 额外专长: ${agentMeta.extraTraits}`);
    
    // 如果GDD中已经包含美术需求，则直接返回
    if (gdd.artRequirements && gdd.artRequirements.length > 0) {
      return gdd.artRequirements;
    }
    
    // 否则，根据GDD内容生成美术需求
		const baseRequirements: ArtRequirement[] = [
      {
        type: "character",
				description: `玩家角色，${gdd.artStyle || "卡通"}风格，适合${primaryGenre}游戏`,
        quantity: 1,
				priority: "high",
				format: "3d_model",
      },
      {
        type: "environment",
				description: `游戏主场景，${gdd.artStyle || "卡通"}风格，适合${gdd.dimension === "3d" ? "3D" : "2D"}${primaryGenre}游戏`,
        quantity: 1,
				priority: "high",
				format: "3d_environment",
			},
			{
				type: "texture",
				description: `PBR贴图集 - ${gdd.coreConcept || "通用风格"}`,
				quantity: 3,
				priority: "high",
				format: "pbr_texture",
			},
			{
				type: "material",
				description: `材质配置（JSON）- ${gdd.artStyle || "默认"}方案`,
				quantity: 2,
				priority: "medium",
				format: "material_profile",
      },
      {
        type: "ui",
				description: `游戏界面元素，${gdd.artStyle || "卡通"}风格`,
        quantity: 10,
				priority: "medium",
				format: "ui_sprite",
      },
      {
        type: "icon",
				description: `游戏图标，${gdd.artStyle || "卡通"}风格`,
        quantity: 1,
				priority: "high",
				format: "icon",
			},
			{
				type: "animation",
				description: "通用骨骼动画（待机、跑步、攻击）",
				quantity: 3,
				priority: "high",
				format: "animation_clip",
			},
			{
				type: "particle",
				description: "粒子特效（受击、环境）",
				quantity: 2,
				priority: "medium",
				format: "particle_preset",
			},
    ];
    
    // 根据游戏类型添加特定的美术需求
		if (primaryGenre === "rpg") {
      baseRequirements.push(
        {
          type: "character",
          description: "NPC角色，需要有辨识度",
          quantity: 5,
					priority: "medium",
        },
        {
          type: "character",
          description: "BOSS角色，具有威慑力",
          quantity: 2,
					priority: "high",
        },
        {
          type: "item",
          description: "游戏中的道具和装备",
          quantity: 20,
					priority: "medium",
				},
      );
		} else if (primaryGenre === "slg") {
      baseRequirements.push(
        {
          type: "building",
          description: "游戏中的各种建筑",
          quantity: 15,
					priority: "high",
        },
        {
          type: "unit",
          description: "游戏中的战斗单位",
          quantity: 10,
					priority: "high",
				},
      );
    }
    
    return baseRequirements;
  }
}

// Art Agent类
class ArtAgent {
  private ws: WebSocket | null = null;
  private aiModel: AIModel;
	private agentId = "art-agent";
  private serverUrl: string;
	private generatedResources: Map<string, GeneratedResource[]> = new Map(); // 存储每个项目已生成的资源
	private pausedProjects: Set<string> = new Set();
	private stageContexts: Map<
		string,
		{ gdd: GDD; stageConfig?: StageConfig; cloudProvider?: "aliyun" | "gcp" }
	> = new Map();
	private uploadProgress: Map<string, number> = new Map();
  
  constructor() {
    this.aiModel = new AIModel();
		this.serverUrl = process.env.A2A_SERVER_URL || "ws://localhost:8080";
  }
  
  // 连接到A2A服务器
  async connect() {
    try {
      this.ws = new WebSocket(this.serverUrl);
      
			this.ws.on("open", () => {
        console.log("已连接到A2A服务器");
        this.register();
      });
      
			this.ws.on("message", (message: string) => {
        this.handleMessage(message);
      });
      
			this.ws.on("close", () => {
        console.log("与A2A服务器的连接已关闭");
        // 尝试重连
        setTimeout(() => this.connect(), 5000);
      });
      
			this.ws.on("error", (error) => {
        console.error("WebSocket错误:", error);
      });
    } catch (error) {
      console.error("连接失败:", error);
      setTimeout(() => this.connect(), 5000);
    }
  }
  
  // 注册Agent
  private register() {
    if (!this.ws) return;
    
    const registerMessage: AgentMessage = {
      messageId: uuidv4(),
      senderId: this.agentId,
			receiverId: "a2a-server",
			projectId: "",
      type: MessageType.STATUS_UPDATE,
			content: { action: "register", name: "美术Agent", version: "1.0.0" },
      timestamp: new Date().toISOString(),
			requiresAck: true,
    };
    
    this.ws.send(JSON.stringify(registerMessage));
  }
  
  // 处理接收到的消息
  private async handleMessage(message: string) {
    try {
      const data = JSON.parse(message) as AgentMessage;
      
      console.log(`收到消息: ${data.type} 来自: ${data.senderId}`);
      
      switch (data.type) {
				case MessageType.GDD_UPDATE: {
					const payload = data.content as GDDPayload;
					await this.processGDD(
						data.projectId,
						payload.gdd || (data.content as GDD),
						payload.stageConfig,
						payload.project,
					);
          break;
				}

				case MessageType.ASSET_UPDATE:
					// 处理资源请求
					await this.processResourceRequest(
						data.projectId,
						data.content as ResourceRequest,
					);
          break;
          
        case MessageType.STATUS_UPDATE:
          this.handleStatusUpdate(data.content);
          break;
          
        case MessageType.FEEDBACK:
					await this.processFeedback(
						data.projectId,
						data.content as unknown as ResourceFeedback,
					);
					break;

				case MessageType.CONTROL:
					await this.handleControlMessage(
						data.projectId,
						data.content as ControlMessagePayload,
					);
          break;
          
        default:
          console.log(`未知消息类型: ${data.type}`);
      }
    } catch (error) {
      console.error("处理消息失败:", error);
    }
  }
  
  // 处理GDD
	private async processGDD(
		projectId: string,
		gdd: GDD,
		stageConfig?: StageConfig,
		projectMeta?: ProjectMetadata,
	) {
    console.log(`开始处理项目 ${projectId} 的美术需求`);
		const cloudProvider: CloudProvider = projectMeta?.cloudProvider || "aliyun";
		this.stageContexts.set(projectId, { gdd, stageConfig, cloudProvider });
    
    // 从agentMeta获取美术agent的维度和风格专长
		const agentMeta = stageConfig?.agentMeta;
		const dimension = agentMeta?.dimension || gdd.dimension; // 优先使用agent的dimension（2d/3d）
		const artStylePreference = agentMeta?.specialization; // 美术风格偏好：realistic/cartoon/pixel等
		
		if (agentMeta) {
			console.log(`美术Agent维度: ${dimension}`);
			console.log(`美术Agent风格专长: ${artStylePreference || '通用'}`);
			if (agentMeta.extraTraits) {
				console.log(`额外特点: ${agentMeta.extraTraits}`);
			}
		}
    
    // 分析美术需求（传入agentMeta影响生成策略）
    const artRequirements = this.aiModel.analyzeArtRequirements(gdd, agentMeta);
    
    // 搜索知识库获取相关信息（结合agent的specialization）
		const searchKeywords = [
			artStylePreference || gdd.artStyle,
			dimension,
			'游戏美术资源生成指南',
		]
			.filter(Boolean)
			.join(' ');
		const knowledgeResults = await knowledgeBaseService.searchByKeyword(searchKeywords);
    
    console.log(`获取到 ${knowledgeResults.length} 条知识库结果`);
    
    // 生成美术资源
		const generatedResources = await this.generateArtResources(
			projectId,
			artRequirements,
			gdd.artStyle || "cartoon",
		);
    
    // 存储生成的资源
    this.generatedResources.set(projectId, generatedResources);
    
    // 保存重要信息到Mem0
		await mem0Service.saveMemory(
			"system",
			projectId,
			`生成了${gdd.artStyle}风格的美术资源，共${generatedResources.length}个`,
			"asset",
			"medium",
			{
      style: gdd.artStyle,
      dimension: gdd.dimension,
      resourcesCount: generatedResources.length,
				generatedAt: new Date().toISOString(),
			},
		);

		if (this.pausedProjects.has(projectId)) {
			await this.sendCheckpoint(projectId, generatedResources, "生成中被暂停");
			return;
		}
    
    // 发送资源更新消息
		await this.sendResourcesUpdate(projectId, generatedResources, "completed");
    
		console.log(
			`项目 ${projectId} 的美术资源生成完成，共生成 ${generatedResources.length} 个资源`,
		);
  }
  
  // 处理资源请求
	private async processResourceRequest(
		projectId: string,
		request: ResourceRequest,
	) {
    console.log(`收到项目 ${projectId} 的资源请求`);
    
    const existingResources = this.generatedResources.get(projectId) || [];
    
		if (request.type === "specific" && request.description) {
      // 特定资源请求
      const { description, style } = request;
			const newResource = await this.generateSingleResource(
				projectId,
				description,
				style || "cartoon",
			);
      
      // 添加到资源列表
      existingResources.push(newResource);
      this.generatedResources.set(projectId, existingResources);
      
      // 发送新资源更新
			await this.sendResourcesUpdate(projectId, [newResource], "completed");
		} else if (request.type === "specific") {
			console.error("特定资源请求缺少描述信息");
    } else {
      // 返回所有现有资源
			await this.sendResourcesUpdate(
				projectId,
				existingResources,
				"in_progress",
			);
    }
  }
  
  // 处理反馈
	private async processFeedback(projectId: string, feedback: ResourceFeedback) {
    console.log(`收到项目 ${projectId} 的美术反馈，开始修正`);
    
    if (!feedback.resourceId) {
      console.error("反馈缺少资源ID");
      return;
    }
    
    const resources = this.generatedResources.get(projectId) || [];
		const resourceIndex = resources.findIndex(
			(r) => r.id === feedback.resourceId,
		);
    
    if (resourceIndex === -1) {
      console.error(`找不到资源: ${feedback.resourceId}`);
      return;
    }
    
    // 根据反馈重新生成资源
    const updatedResource = await this.regenerateResource(
      projectId,
      resources[resourceIndex],
			feedback.suggestions,
    );
    
    // 更新资源
    resources[resourceIndex] = updatedResource;
    this.generatedResources.set(projectId, resources);
    
    // 发送更新的资源
		await this.sendResourcesUpdate(projectId, [updatedResource], "completed");
    
    console.log(`资源 ${feedback.resourceId} 已根据反馈更新`);
  }
  
  // 生成美术资源
	private async generateArtResources(
		projectId: string,
		requirements: ArtRequirement[],
		style: string,
	): Promise<GeneratedResource[]> {
		const resources: GeneratedResource[] = [];
    
    // 创建资源目录
    const resourcesDir = path.resolve(`./data/projects/${projectId}/art`);
    fs.ensureDirSync(resourcesDir);
    
    // 根据需求生成资源
    for (const req of requirements) {
      console.log(`生成资源: ${req.type} - ${req.description}`);
      
      for (let i = 0; i < req.quantity; i++) {
        const prompt = `${req.description}，第${i + 1}个，${style}风格`;
				const resource = await this.createResourceFile(
          projectId,
					resourcesDir,
					req,
					prompt,
          style,
				);
        
        resources.push(resource);
      }
    }
    
    return resources;
  }
  
  // 生成单个资源
	private async generateSingleResource(
		projectId: string,
		description: string,
		style: string,
		type = "custom",
	): Promise<GeneratedResource> {
    const resourcesDir = path.resolve(`./data/projects/${projectId}/art`);
    fs.ensureDirSync(resourcesDir);
    
    const prompt = `${description}，${style}风格`;
		const resource = await this.createResourceFile(
      projectId,
			resourcesDir,
			{
				type,
      description,
				quantity: 1,
				priority: "medium",
			},
			prompt,
      style,
		);

		return resource;
  }
  
  // 重新生成资源
	private async regenerateResource(
		projectId: string,
		original: GeneratedResource,
		suggestions: string,
	): Promise<GeneratedResource> {
    const resourcesDir = path.resolve(`./data/projects/${projectId}/art`);
    
    const prompt = `${original.description}，根据反馈修改：${suggestions}，${original.style}风格`;
		const profile =
			RESOURCE_FILE_MAP[original.type] ?? RESOURCE_FILE_MAP.character;
		const fileName = await this.aiModel.generateImage(
			prompt,
			original.style,
			profile.extension,
		);
		const resourcePath = path.join(resourcesDir, fileName);
		fs.writeFileSync(
			resourcePath,
			`根据反馈生成的${original.type}资源：${profile.contentHint}`,
		);
    
    return {
      ...original,
      filePath: resourcePath,
      description: `${original.description} [已修改]`,
			updatedAt: new Date().toISOString(),
		};
	}

	private async createResourceFile(
		projectId: string,
		resourcesDir: string,
		requirement: ArtRequirement,
		prompt: string,
		style: string,
	): Promise<GeneratedResource> {
		const profile = RESOURCE_FILE_MAP[requirement.type] ?? {
			extension: "bin",
			formatLabel: "generic_resource",
			defaultUsage: "general",
			contentHint: "Generic asset blob",
		};

		const fileName = await this.aiModel.generateImage(
			prompt,
			style,
			profile.extension,
		);
		const resourcePath = path.join(resourcesDir, fileName);

		fs.writeFileSync(
			resourcePath,
			`模拟的${requirement.type}资源内容：${profile.contentHint}`,
		);

		return {
			id: uuidv4(),
			projectId,
			type: requirement.type,
			description: requirement.description,
			filePath: resourcePath,
			format: profile.formatLabel,
			style,
			priority: requirement.priority,
			usage: requirement.usage || profile.defaultUsage,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			metadata: {
				resourceType: requirement.type,
				format: profile.formatLabel,
				usage: requirement.usage || profile.defaultUsage,
			},
    };
  }
  
  // 处理状态更新
	private handleStatusUpdate(content: unknown) {
		console.log("状态更新:", content);
  }
  
  // 发送资源更新
	private async sendResourcesUpdate(
		projectId: string,
		resources: GeneratedResource[],
		status: "in_progress" | "completed" | "paused",
	) {
    if (!this.ws) return;
		const preparedResources = await this.ensureResourcesUploaded(
			projectId,
			resources,
		);
		this.generatedResources.set(projectId, preparedResources);
		const artifacts: AgentArtifact[] = preparedResources.map((resource) => ({
			artifactId: resource.id,
			stageId: "art",
			type: "art",
			format: path.extname(resource.filePath)?.replace(".", "") || "bin",
			url: resource.remoteUrl || resource.filePath,
			source: "llm" as const,
			description: resource.description,
			metadata: {
				priority: resource.priority,
				style: resource.style,
				provider: resource.provider || "aliyun",
				resourceType: resource.type,
				format: resource.format,
				usage: resource.usage || "",
			},
		}));
    
    const message: AgentMessage = {
      messageId: uuidv4(),
      senderId: this.agentId,
			receiverId: "a2a-server",
      projectId,
      type: MessageType.ASSET_UPDATE,
			content: {
				stageId: "art",
				status,
				artifacts,
				checkpoint:
					status === "paused" ? { artifacts, notes: "用户暂停" } : undefined,
			} as unknown as JsonValue,
      timestamp: new Date().toISOString(),
			requiresAck: true,
    };
    
    this.ws.send(JSON.stringify(message));
  }

	private async sendCheckpoint(
		projectId: string,
		resources: GeneratedResource[],
		notes?: string,
	) {
		if (!this.ws) return;
		const preparedResources = await this.ensureResourcesUploaded(
			projectId,
			resources,
		);
		this.generatedResources.set(projectId, preparedResources);
		const artifacts: AgentArtifact[] = preparedResources.map((resource) => ({
			artifactId: resource.id,
			stageId: "art",
			type: "art",
			format: path.extname(resource.filePath)?.replace(".", "") || "bin",
			url: resource.remoteUrl || resource.filePath,
			source: "llm" as const,
			description: resource.description,
			metadata: {
				priority: resource.priority,
				style: resource.style,
				provider: resource.provider || "aliyun",
				resourceType: resource.type,
				format: resource.format,
				usage: resource.usage || "",
			},
		}));
		const message: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId,
			type: MessageType.ASSET_UPDATE,
			content: {
				stageId: "art",
				status: "paused",
				artifacts,
				checkpoint: {
					artifacts,
					notes,
				},
			} as unknown as JsonValue,
			timestamp: new Date().toISOString(),
			requiresAck: true,
		};
		this.ws.send(JSON.stringify(message));
	}

	private async ensureResourcesUploaded(
		projectId: string,
		resources: GeneratedResource[],
	) {
		if (!resources || resources.length === 0) {
			return resources;
		}
		const context = this.stageContexts.get(projectId);
		const provider: CloudProvider = context?.cloudProvider || "aliyun";
		return Promise.all(
			resources.map(async (resource) => {
				if (resource.remoteUrl) {
					return resource;
				}
				const stats = await fs.stat(resource.filePath);
				const key = `${projectId}/art/${path.basename(resource.filePath)}`;
				const metadata: Record<string, unknown> = {
					type: resource.type,
					description: resource.description,
					priority: resource.priority,
				};
				const upload =
					stats.size > LARGE_FILE_THRESHOLD
						? storageService.uploadMultipart(provider, key, resource.filePath, {
								chunkSize: MULTIPART_CHUNK_SIZE,
								metadata,
								onProgress: ({ uploadedBytes, totalBytes }) => {
									const fraction = totalBytes ? uploadedBytes / totalBytes : 1;
									this.emitUploadProgress(projectId, resource.id, fraction);
								},
							})
						: storageService.upload(provider, key, resource.filePath, metadata);
				const result = await upload;
				return {
					...resource,
					remoteUrl: result.url,
					provider: result.provider,
					uploadMetadata: result.metadata,
					metadata: {
						...(resource.metadata ?? {}),
						...result.metadata,
					},
				};
			}),
		);
	}

	private emitUploadProgress(
		projectId: string,
		resourceId: string,
		fraction: number,
	) {
		const key = `${projectId}:${resourceId}`;
		const prev = this.uploadProgress.get(key) || 0;
		if (fraction < 1 && fraction - prev < 0.1) {
			return;
		}
		this.uploadProgress.set(key, fraction);
		console.log(
			`[ArtAgent] 上传进度 ${projectId}/${resourceId}: ${(fraction * 100).toFixed(1)}%`,
		);
	}

	private async handleControlMessage(
		projectId: string,
		content: ControlMessagePayload,
	) {
		const action = content.action;
		switch (action) {
			case "pause":
				this.pausedProjects.add(projectId);
				await this.sendCheckpoint(
					projectId,
					this.generatedResources.get(projectId) || [],
					content.notes,
				);
				break;
			case "resume": {
				this.pausedProjects.delete(projectId);
				const ctx = this.stageContexts.get(projectId);
				if (ctx) {
					const overrides = content.updates?.overrides;
					const gdd = overrides ? { ...ctx.gdd, ...overrides } : ctx.gdd;
					await this.processGDD(projectId, gdd, ctx.stageConfig, {
						cloudProvider: ctx.cloudProvider,
					});
				}
				break;
			}
			case "abort":
				this.pausedProjects.delete(projectId);
				break;
		}
	}
  
  // 发送状态更新
  private sendStatusUpdate(projectId: string, status: string) {
    if (!this.ws) return;
    
    const message: AgentMessage = {
      messageId: uuidv4(),
      senderId: this.agentId,
			receiverId: "a2a-server",
      projectId,
      type: MessageType.STATUS_UPDATE,
      content: { status },
      timestamp: new Date().toISOString(),
			requiresAck: false,
    };
    
    this.ws.send(JSON.stringify(message));
  }
}

// 启动Art Agent
console.log("=== Art Agent 启动 ===");
const agent = new ArtAgent();
agent.connect();

// 优雅关闭
process.on("SIGTERM", () => {
  console.log("正在关闭Art Agent...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("正在关闭Art Agent...");
  process.exit(0);
});
