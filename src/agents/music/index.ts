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

type CloudProvider = "aliyun" | "gcp";

interface AudioRequirement {
	type: string;
	description: string;
	quantity: number;
	priority: "high" | "medium" | "low";
	mood?: string;
}

interface ProjectMetadata {
	cloudProvider?: CloudProvider;
}

interface AudioResource {
	id: string;
	projectId: string;
	type: string;
	description: string;
	filePath: string;
	priority: "high" | "medium" | "low";
	mood?: string;
	createdAt: string;
	updatedAt: string;
	remoteUrl?: string;
	provider?: CloudProvider;
	uploadMetadata?: Record<string, unknown>;
}

interface AudioRequest {
	type?: string;
	description?: string;
	mood?: string;
}

interface AudioFeedback {
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

// 模拟AI模型调用（用于生成音频）
class AIModel {
  // 生成音频的方法（模拟）
  async generateAudio(prompt: string, type: string): Promise<string> {
    console.log(`[模型调用] 生成音频 - 提示词: ${prompt}, 类型: ${type}`);
    
    // 从知识库获取相关音乐创作指南
    const audioKnowledge = await knowledgeBaseService.searchByKeyword(
			`${type}创作 游戏音频设计 ${type}音效技巧`,
    );
    
    console.log(`获取了 ${audioKnowledge.length} 条音频创作相关知识`);
    
    // 这里是模拟的音频生成逻辑，后续可以替换为真实的音频生成API调用
    // 例如OpenAI Audio API、MusicLM等
    
    // 模拟生成音频文件路径
		const extension = type === "bgm" ? "mp3" : "wav";
    const fileName = `generated_${Date.now()}.${extension}`;
    
    // 保存音频资源生成经验到Mem0
    await mem0Service.saveMemory(
			"system",
			"audio_creation",
      `生成了${type}类型音频资源，提示词: ${prompt}`,
			"design",
			"medium",
      {
        audioType: type,
        prompt,
				fileName,
			},
    );
    
    return fileName;
  }
  
  // 分析GDD中的音频需求
	async analyzeAudioRequirements(gdd: GDD): Promise<AudioRequirement[]> {
    console.log("[模型调用] 分析音频需求");
    
    // 从知识库获取游戏类型相关的音频需求建议
		const primaryGenre = gdd.primaryGenre ?? gdd.gameType;
    const gddKnowledge = await knowledgeBaseService.searchByKeyword(
			`${primaryGenre}游戏音频设计 ${primaryGenre}游戏音效需求`,
    );
    
    console.log(`获取了 ${gddKnowledge.length} 条游戏音频需求相关知识`);
    
    // 如果GDD中已经包含音频需求，则直接返回
    if (gdd.audioRequirements && gdd.audioRequirements.length > 0) {
      return gdd.audioRequirements;
    }
    
    // 否则，根据GDD内容生成音频需求
		const baseRequirements: AudioRequirement[] = [
      {
        type: "bgm",
        description: "主菜单背景音乐",
        quantity: 1,
        priority: "high",
				mood: "energetic",
      },
      {
        type: "sfx",
        description: "按钮点击音效",
        quantity: 3,
				priority: "high",
      },
      {
        type: "sfx",
        description: "角色移动音效",
        quantity: 1,
				priority: "medium",
			},
    ];
    
    // 根据游戏类型添加特定的音频需求
		if (primaryGenre === "rpg") {
      baseRequirements.push(
        {
          type: "bgm",
          description: "探索区域背景音乐",
          quantity: 2,
          priority: "high",
					mood: "adventurous",
        },
        {
          type: "bgm",
          description: "战斗背景音乐",
          quantity: 2,
          priority: "high",
					mood: "intense",
        },
        {
          type: "sfx",
          description: "战斗技能音效",
          quantity: 10,
					priority: "medium",
        },
        {
          type: "voice",
          description: "角色对话语音",
          quantity: 15,
					priority: "medium",
				},
      );
		} else if (primaryGenre === "slg") {
      baseRequirements.push(
        {
          type: "bgm",
          description: "基地建设背景音乐",
          quantity: 1,
          priority: "high",
					mood: "strategic",
        },
        {
          type: "bgm",
          description: "战斗背景音乐",
          quantity: 1,
          priority: "high",
					mood: "epic",
        },
        {
          type: "sfx",
          description: "建筑升级音效",
          quantity: 5,
					priority: "medium",
        },
        {
          type: "sfx",
          description: "军事单位音效",
          quantity: 8,
					priority: "medium",
				},
      );
		} else if (primaryGenre === "sim" || primaryGenre === "rac") {
      baseRequirements.push(
        {
          type: "bgm",
          description: "比赛背景音乐",
          quantity: 2,
          priority: "high",
					mood: "energetic",
        },
        {
          type: "sfx",
          description: "比赛中各种动作音效",
          quantity: 20,
					priority: "high",
        },
        {
          type: "voice",
          description: "裁判哨声和评论",
          quantity: 10,
					priority: "medium",
				},
      );
    }
    
    // 保存音频需求分析结果到Mem0
    await mem0Service.saveMemory(
			"system",
			"audio_requirement_analysis",
			`为${primaryGenre}游戏分析了音频需求`,
			"design",
			"high",
      {
				gameType: primaryGenre,
        requirementCount: baseRequirements.length,
				bgmCount: baseRequirements.filter((r) => r.type === "bgm").length,
				sfxCount: baseRequirements.filter((r) => r.type === "sfx").length,
				voiceCount: baseRequirements.filter((r) => r.type === "voice").length,
			},
    );
    
    return baseRequirements;
  }
}

// Music Agent类
class MusicAgent {
  private ws: WebSocket | null = null;
  private aiModel: AIModel;
	private agentId = "music-agent";
  private serverUrl: string;
	private generatedResources: Map<string, AudioResource[]> = new Map(); // 存储每个项目已生成的音频资源
	private pausedProjects: Set<string> = new Set();
	private stageContexts: Map<
		string,
		{ gdd: GDD; stageConfig?: StageConfig; cloudProvider?: CloudProvider }
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
			content: { action: "register", name: "音乐Agent", version: "1.0.0" },
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
          
        // 注释掉不存在的消息类型处理
        // case MessageType.RESOURCE_REQUEST:
        //   await this.processResourceRequest(data.projectId, data.content);
        //   break;
          
        case MessageType.STATUS_UPDATE:
          this.handleStatusUpdate(data.content);
          break;
          
        case MessageType.FEEDBACK:
					await this.processFeedback(
						data.projectId,
						data.content as AudioFeedback,
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
    console.log(`开始处理项目 ${projectId} 的音频需求`);
		const cloudProvider: CloudProvider = projectMeta?.cloudProvider || "aliyun";
		this.stageContexts.set(projectId, { gdd, stageConfig, cloudProvider });
    
    // 分析音频需求
    const audioRequirements = this.aiModel.analyzeAudioRequirements(gdd);
    
    // 搜索知识库获取相关信息
		const primaryGenre = gdd.primaryGenre ?? gdd.gameType;
		const query = `${primaryGenre} 游戏音频设计指南`;
		const knowledgeResults = await knowledgeBaseService.searchByKeyword(query);
    
    console.log(`获取到 ${knowledgeResults.length} 条知识库结果`);
    
    // 生成音频资源
    // 修正方法调用参数
    const audioReqs = await audioRequirements;
		const generatedResources = await this.generateAudioResources(
			projectId,
			audioReqs,
		);
    
    // 存储生成的资源
    this.generatedResources.set(projectId, generatedResources);
    
    // 保存重要信息到Mem0
		await mem0Service.saveMemory(
			"system",
			projectId,
			`生成了${primaryGenre}游戏的音频资源，共${generatedResources.length}个`,
			"asset",
			"medium",
			{
				gameType: primaryGenre,
      resourcesCount: generatedResources.length,
				bgmCount: generatedResources.filter((r) => r.type === "bgm").length,
				sfxCount: generatedResources.filter((r) => r.type === "sfx").length,
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
			`项目 ${projectId} 的音频资源生成完成，共生成 ${generatedResources.length} 个资源`,
		);
  }
  
  // 处理资源请求
	private async processResourceRequest(
		projectId: string,
		request: AudioRequest,
	) {
    console.log(`收到项目 ${projectId} 的音频资源请求`);
    
    const existingResources = this.generatedResources.get(projectId) || [];
    
		if (request.type === "specific" && request.description) {
      // 特定音频资源请求
      const { description, type, mood } = request;
			const newResource = await this.generateSingleAudioResource(
				projectId,
				description,
				type || "sfx",
				mood,
			);
      
      // 添加到资源列表
      existingResources.push(newResource);
      this.generatedResources.set(projectId, existingResources);
      
      // 发送新资源更新
			await this.sendResourcesUpdate(projectId, [newResource], "completed");
		} else if (request.type === "specific") {
			console.error("特定音频资源请求缺少描述信息");
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
	private async processFeedback(projectId: string, feedback: AudioFeedback) {
    console.log(`收到项目 ${projectId} 的音频反馈，开始修正`);
    
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
    
    console.log(`音频资源 ${feedback.resourceId} 已根据反馈更新`);
  }
  
  // 生成音频资源
	private async generateAudioResources(
		projectId: string,
		requirements: AudioRequirement[],
	): Promise<AudioResource[]> {
		const resources: AudioResource[] = [];
    
    // 创建资源目录
    const resourcesDir = path.resolve(`./data/projects/${projectId}/audio`);
    fs.ensureDirSync(resourcesDir);
    
    // 根据需求生成资源
    for (const req of requirements) {
      console.log(`生成音频资源: ${req.type} - ${req.description}`);
      
      for (let i = 0; i < req.quantity; i++) {
        let prompt = `${req.description}`;
        if (req.mood) {
          prompt += `，风格：${req.mood}`;
        }
        
        const filePath = await this.aiModel.generateAudio(prompt, req.type);
        
        // 模拟保存文件（实际应该保存生成的音频）
        const resourcePath = path.join(resourcesDir, filePath);
        
        // 创建空文件作为示例
        fs.writeFileSync(resourcePath, `模拟的${req.type}音频资源内容`);
        
				const resource: AudioResource = {
          id: uuidv4(),
          projectId,
          type: req.type,
          description: req.description,
          filePath: resourcePath,
          priority: req.priority,
          mood: req.mood,
          createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
        };
        
        resources.push(resource);

				if (this.pausedProjects.has(projectId)) {
					return resources;
				}
      }
    }
    
    return resources;
  }
  
  // 生成单个音频资源
	private async generateSingleAudioResource(
		projectId: string,
		description: string,
		type: string,
		mood?: string,
	): Promise<AudioResource> {
    const resourcesDir = path.resolve(`./data/projects/${projectId}/audio`);
    fs.ensureDirSync(resourcesDir);
    
    let prompt = description;
    if (mood) {
      prompt += `，风格：${mood}`;
    }
    
    const filePath = await this.aiModel.generateAudio(prompt, type);
    
    // 模拟保存文件
    const resourcePath = path.join(resourcesDir, filePath);
    fs.writeFileSync(resourcePath, `模拟的音频资源内容: ${description}`);
    
    return {
      id: uuidv4(),
      projectId,
      type,
      description,
      filePath: resourcePath,
      priority: "medium",
      mood,
      createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
    };
  }
  
  // 重新生成资源
	private async regenerateResource(
		projectId: string,
		original: AudioResource,
		suggestions: string,
	): Promise<AudioResource> {
    const resourcesDir = path.resolve(`./data/projects/${projectId}/audio`);
    
    let prompt = `${original.description}，根据反馈修改：${suggestions}`;
    if (original.mood) {
      prompt += `，风格：${original.mood}`;
    }
    
    const newFilePath = await this.aiModel.generateAudio(prompt, original.type);
    
    // 模拟保存新文件
    const resourcePath = path.join(resourcesDir, newFilePath);
		fs.writeFileSync(resourcePath, "根据反馈修改的音频资源内容");
    
    return {
      ...original,
      filePath: resourcePath,
      description: `${original.description} [已修改]`,
			updatedAt: new Date().toISOString(),
    };
  }
  
  // 处理状态更新
	private handleStatusUpdate(content: unknown) {
		console.log("状态更新:", content);
  }
  
  // 发送资源更新
	private async sendResourcesUpdate(
		projectId: string,
		resources: AudioResource[],
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
			stageId: "music",
			type: "audio",
			format: path.extname(resource.filePath)?.replace(".", "") || "wav",
			url: resource.remoteUrl || resource.filePath,
			source: "llm",
			description: resource.description,
			metadata: {
				priority: resource.priority,
				mood: resource.mood,
				type: resource.type,
				provider: resource.provider,
			},
		}));
    
    const message: AgentMessage = {
      messageId: uuidv4(),
      senderId: this.agentId,
			receiverId: "a2a-server",
      projectId,
      type: MessageType.ASSET_UPDATE,
			content: {
				stageId: "music",
				status,
				artifacts,
				checkpoint: status === "paused" ? { artifacts } : undefined,
			},
      timestamp: new Date().toISOString(),
			requiresAck: true,
    };
    
    this.ws.send(JSON.stringify(message));
  }

	private async sendCheckpoint(
		projectId: string,
		resources: AudioResource[],
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
			stageId: "music",
			type: "audio",
			format: path.extname(resource.filePath)?.replace(".", "") || "wav",
			url: resource.remoteUrl || resource.filePath,
			source: "llm",
			description: resource.description,
			metadata: {
				priority: resource.priority,
				mood: resource.mood,
				type: resource.type,
				provider: resource.provider,
			},
		}));
		const message: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId,
			type: MessageType.ASSET_UPDATE,
			content: {
				stageId: "music",
				status: "paused",
				artifacts,
				checkpoint: {
					artifacts,
					notes,
				},
			},
			timestamp: new Date().toISOString(),
			requiresAck: true,
		};
		this.ws.send(JSON.stringify(message));
	}

	private async ensureResourcesUploaded(
		projectId: string,
		resources: AudioResource[],
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
				const key = `${projectId}/music/${path.basename(resource.filePath)}`;
				const metadata = {
					type: resource.type,
					mood: resource.mood,
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
			`[MusicAgent] 上传进度 ${projectId}/${resourceId}: ${(fraction * 100).toFixed(1)}%`,
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

// 启动Music Agent
console.log("=== Music Agent 启动 ===");
const agent = new MusicAgent();
agent.connect();

// 优雅关闭
process.on("SIGTERM", () => {
  console.log("正在关闭Music Agent...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("正在关闭Music Agent...");
  process.exit(0);
});
