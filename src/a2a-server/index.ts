import "dotenv/config";
import http from "node:http";
import path from "node:path";
import archiver from "archiver";
import express from "express";
import type { Express } from "express";
import fs from "fs-extra";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";

import { executionManager } from "../orchestrator/ExecutionManager";
import { instructionOrchestrator } from "../orchestrator/InstructionOrchestrator";
import { storageService } from "../services/storage/StorageService";
import { taskStateManager, TaskStatus } from "../services/TaskStateManager";
import { getAgentModelConfig, normalizeModel } from "../config/agentModels";
// 导入共享类型
import {
	type AgentArtifact,
	type AgentMessage,
	type ArtifactMessage,
	Asset,
	ExecutionMode,
	type ExecutionRequest,
	type GDD,
	type GameGenre,
	type GameProjectConfig,
	type JsonRecord,
	type JsonValue,
	MessageType,
	type StageConfig,
	type StagePreviewRequest,
	type TestReport,
	type UserInput,
	UserInputSchema,
	GameGenreSelectionSchema,
	GameGenreSchema,
} from "../types";
// 导入路由
import userAssetsRoutes from "./routes/userAssets";

type UploadedFileInfo = {
	filename: string;
	path: string;
	size: number;
	mimetype: string;
};

// 项目管理器类
class ProjectManager {
  private projects: Map<string, GameProjectConfig> = new Map();
  private taskDependencies: Map<string, string[]> = new Map();
  private completedTasks: Set<string> = new Set<string>();
  
  constructor() {
    this.setupTaskDependencies();
  }
  
  // 设置任务依赖关系
  private setupTaskDependencies(): void {
		this.taskDependencies.set("planning", []);
		this.taskDependencies.set("art", ["planning"]);
		this.taskDependencies.set("music", ["planning"]);
		this.taskDependencies.set("tech", ["art", "music"]);
		this.taskDependencies.set("test", ["tech"]);
		this.taskDependencies.set("feedback", ["test"]);
  }
  
  // 创建新项目
	createProject(
		projectId: string,
		name: string,
		userInput: UserInput,
		executionMode: ExecutionMode,
	): GameProjectConfig {
    const project: GameProjectConfig = {
      projectId,
      projectName: name,
      executionMode,
      userInput,
			status: "initialized",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      assets: {
        art: [],
        music: [],
				code: "",
      },
			testReports: [],
    };
    this.projects.set(projectId, project);
    return project;
  }
  
  // 获取项目
  getProject(projectId: string): GameProjectConfig | undefined {
    return this.projects.get(projectId);
  }
  
  // 更新项目
  updateProject(project: GameProjectConfig): void {
    project.updatedAt = new Date().toISOString();
    this.projects.set(project.projectId, project);
  }
  
  // 获取所有项目
  getAllProjects(): GameProjectConfig[] {
    return Array.from(this.projects.values());
  }

	deleteProject(projectId: string): void {
		this.projects.delete(projectId);
		this.completedTasks.delete(projectId);
	}
  
  // 检查阶段是否可以开始
  canStartPhase(project: GameProjectConfig, phase: string): boolean {
    const dependencies = this.taskDependencies.get(phase);
    if (!dependencies) return false;
    
    // 异步并行模式下，美术和音乐可以同时进行
    if (project.executionMode === ExecutionMode.ASYNC_PARALLEL) {
			if (phase === "music") {
				return project.status === "planning" || project.status === "art";
      }
    }
    
    // 检查依赖是否完成
    for (const dep of dependencies) {
      const depStatus = this.getPhaseStatus(project, dep);
      if (!depStatus.completed) {
        return false;
      }
    }
    return true;
  }
  
  // 获取阶段状态
	private getPhaseStatus(
		project: GameProjectConfig,
		phase: string,
	): { completed: boolean; current: boolean } {
    switch (phase) {
			case "planning":
        return { 
          completed: !!project.gdd,
					current: project.status === "planning",
        };
			case "art":
        return { 
          completed: project.assets.art.length > 0,
					current: project.status === "art",
        };
			case "music":
        return { 
          completed: project.assets.music.length > 0,
					current: project.status === "music",
        };
			case "tech":
        return { 
          completed: !!project.assets.code,
					current: project.status === "tech",
        };
			case "test":
        return { 
          completed: project.testReports.length > 0,
					current: project.status === "testing",
        };
      default:
        return { completed: false, current: false };
    }
  }
  
  // 标记任务完成
  markTaskCompleted(taskId: string): void {
    this.completedTasks.add(taskId);
  }
  
  // 检查任务是否已完成
  isTaskCompleted(taskId: string): boolean {
    return this.completedTasks.has(taskId);
  }
}

// 创建项目管理器实例
const projectManager = new ProjectManager();

// 创建Express应用
const app = express();
app.use(express.json());

// 注册路由
app.use("/api/user-assets", userAssetsRoutes);

// 配置multer用于文件上传
const upload = multer({
	dest: "./data/uploads/",
	limits: {
		fileSize: 100 * 1024 * 1024, // 100MB限制
	},
});

const StageConfigSchema = z.object({
	stageId: z.string(),
	agentId: z.string(),
	model: z.string(),
	knowledgeBase: z.string().optional(),
	mode: z.enum(["llm+kb", "llm+custom-kb", "mcp-local", "hybrid"]),
	tools: z.record(z.string(), z.unknown()).optional(),
	mcp: z
		.object({
			endpoint: z.string(),
			token: z.string().optional(),
		})
		.optional(),
	resources: z
		.array(
			z.object({
				type: z.string(),
				url: z.string(),
				metadata: z.record(z.string(), z.unknown()).optional(),
			}),
		)
		.optional(),
	planningFocus: z
		.object({
			narrative: z.boolean().optional(),
			numeric: z.boolean().optional(),
			levelDesign: z.boolean().optional(),
			systemDesign: z
				.object({
					growth: z.boolean().optional(),
					equipment: z.boolean().optional(),
					social: z.boolean().optional(),
					combat: z.boolean().optional(),
				})
				.optional(),
		})
		.optional(),
});

const ExecutionRequestSchema = z.object({
	workflowId: z.string(),
	executionMode: z.nativeEnum(ExecutionMode),
	cloudProvider: z.enum(["aliyun", "gcp"]),
	callbacks: z
		.object({
			webhook: z.string().url().optional(),
			events: z.enum(["ws", "sse"]).optional(),
		})
		.optional(),
	project: z.object({
		projectName: z.string(),
		gameGenre: GameGenreSelectionSchema,
		gameType: GameGenreSchema.optional(),
		dimension: z.enum(["2d", "3d"]),
		artStyle: z.enum(["realistic", "cartoon", "pixel", "anime", "abstract"]),
		gameMode: z.enum(["singleplayer", "multiplayer"]),
		additionalRequirements: z.string().optional(),
	}),
	stages: z.array(StageConfigSchema).nonempty(),
});

// 原有格式 schema（stageId 在顶层）
const PreviewRequestSchemaLegacy = z.object({
	stageId: z.enum(["planning", "art", "music", "tech", "test"]),
	cloudProvider: z.enum(["aliyun", "gcp"]).optional(),
	project: z
		.object({
			projectName: z.string().optional(),
			description: z.string().optional(),
		})
		.optional(),
	stageConfig: StageConfigSchema.partial().optional(),
	userInput: UserInputSchema.optional(),
	gdd: z.record(z.string(), z.unknown()).optional(),
	assets: z
		.object({
			art: z.array(z.string()).optional(),
			music: z.array(z.string()).optional(),
			code: z.string().optional(),
		})
		.optional(),
	notes: z.string().optional(),
	taskId: z.string().optional(),
	callbackUrl: z.string().optional(),
	async: z.boolean().optional(),
});

// game-factory 格式 schema（stageId 在 stage 对象中）
const PreviewRequestSchemaGameFactory = z.object({
	stage: z.object({
		stageId: z.enum(["planning", "art", "music", "tech", "test"]),
		agentId: z.string().optional(),
		model: z.string().optional(),
		mode: z.string().optional(),
	}),
	cloudProvider: z.enum(["aliyun", "gcp"]).optional(),
	project: z
		.object({
			projectName: z.string().optional(),
			description: z.string().optional(),
		})
		.optional(),
	stageConfig: StageConfigSchema.partial().optional(),
	userInput: UserInputSchema.optional(),
	gdd: z.record(z.string(), z.unknown()).optional(),
	assets: z
		.object({
			art: z.array(z.string()).optional(),
			music: z.array(z.string()).optional(),
			code: z.string().optional(),
		})
		.optional(),
	notes: z.string().optional(),
	taskId: z.string().optional(),
	callbackUrl: z.string().optional(),
	async: z.boolean().optional(),
});

// 统一的格式（用于内部处理）
const PreviewRequestSchema = z.union([
	PreviewRequestSchemaLegacy,
	PreviewRequestSchemaGameFactory,
]);

// 规范化请求数据，将 game-factory 格式转换为统一格式
function normalizePreviewRequest(data: any): z.infer<typeof PreviewRequestSchemaLegacy> {
	// 如果是 game-factory 格式（有 stage 对象）
	if (data.stage && data.stage.stageId) {
		// 从 project.description 创建基本的 userInput（如果没有提供）
		let userInput = data.userInput;
		if (!userInput && data.project?.description) {
			userInput = {
				additionalRequirements: data.project.description,
				projectName: data.project.projectName,
			};
		}

		// 从 stage 对象中提取 stageConfig
		const stageConfig = data.stageConfig || {
			agentId: data.stage.agentId,
			model: data.stage.model,
			mode: data.stage.mode,
		};

		return {
			stageId: data.stage.stageId,
			cloudProvider: data.cloudProvider,
			project: data.project,
			stageConfig,
			userInput,
			gdd: data.gdd,
			assets: data.assets,
			notes: data.notes,
			taskId: data.taskId,
			callbackUrl: data.callbackUrl,
			async: data.async,
		};
	}
	// 否则已经是规范格式
	return data;
}

type PreviewSession = {
	stageId: string;
	resolve: (payload: ArtifactMessage) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout | null; // null 表示无超时
};

const previewSessions = new Map<string, PreviewSession>();
// 默认 30 分钟超时，设置为 0 表示无限等待
// 大模型调用通常需要较长时间，建议设置为 0 或很大的值
const PREVIEW_TIMEOUT_MS = Number(process.env.PREVIEW_TIMEOUT_MS || "0");

// 创建HTTP服务器
const server = http.createServer(app);

// 创建WebSocket服务器
const wss = new WebSocketServer({ server });

// 存储活跃的Agent连接
const activeAgents = new Map<string, WebSocket>();

// 确保项目数据目录存在
const projectsDir = path.resolve("./data/projects");
fs.ensureDirSync(projectsDir);

// 加载已有的项目
function loadProjects() {
  try {
    const projectFiles = fs.readdirSync(projectsDir);
		for (const file of projectFiles) {
			if (file.endsWith(".json")) {
        const projectPath = path.join(projectsDir, file);
        const projectData = fs.readJSONSync(projectPath);
        projectManager.updateProject(projectData);
      }
		}
    console.log(`已加载 ${projectManager.getAllProjects().length} 个项目`);
  } catch (error) {
    console.error("加载项目失败:", error);
  }
}

// 保存项目配置
function saveProject(project: GameProjectConfig) {
  try {
    const projectPath = path.join(projectsDir, `${project.projectId}.json`);
    fs.writeJSONSync(projectPath, project, { spaces: 2 });
    projectManager.updateProject(project);
  } catch (error) {
    console.error("保存项目失败:", error);
  }
}

// 处理Agent连接
wss.on("connection", (ws: WebSocket) => {
  let agentId: string | null = null;
  
  console.log("新的Agent连接");
  
  ws.on("message", (message: string) => {
    try {
      const data = JSON.parse(message) as AgentMessage;
      
      // 处理注册消息
			if (
				data.type === MessageType.STATUS_UPDATE &&
				typeof data.content === 'object' && data.content !== null && 'action' in data.content &&
				data.content.action === "register"
			) {
        agentId = data.senderId;
        activeAgents.set(agentId, ws);
        console.log(`Agent ${agentId} 已注册`);
        
        // 发送确认消息
        const response: AgentMessage = {
          messageId: uuidv4(),
					senderId: "a2a-server",
          receiverId: agentId,
          projectId: data.projectId,
          type: MessageType.STATUS_UPDATE,
					content: { status: "connected", message: "成功连接到A2A服务器" },
          timestamp: new Date().toISOString(),
					requiresAck: false,
        };
        ws.send(JSON.stringify(response));
        return;
      }
      
      console.log(`收到来自 ${data.senderId} 的消息: ${data.type}`);
      
      // 路由消息到目标Agent
			if (data.receiverId !== "a2a-server") {
        const targetAgent = activeAgents.get(data.receiverId);
        if (targetAgent && targetAgent.readyState === WebSocket.OPEN) {
          targetAgent.send(message);
          console.log(`消息已转发到 ${data.receiverId}`);
        } else {
          console.error(`目标Agent ${data.receiverId} 未连接`);
          // 发送错误响应
          if (ws.readyState === WebSocket.OPEN) {
            const errorResponse: AgentMessage = {
              messageId: uuidv4(),
							senderId: "a2a-server",
              receiverId: data.senderId,
              projectId: data.projectId,
              type: MessageType.STATUS_UPDATE,
							content: {
								status: "error",
								message: `目标Agent ${data.receiverId} 未连接`,
							},
              timestamp: new Date().toISOString(),
							requiresAck: false,
            };
            ws.send(JSON.stringify(errorResponse));
          }
        }
      } else {
        // 处理发送给服务器的消息
        handleServerMessage(data, ws);
      }
    } catch (error) {
      console.error("处理消息失败:", error);
    }
  });
  
  ws.on("close", () => {
    if (agentId) {
      activeAgents.delete(agentId);
      console.log(`Agent ${agentId} 已断开连接`);
    }
  });
  
  ws.on("error", (error) => {
    console.error("WebSocket错误:", error);
  });
});

// 处理发送给服务器的消息
function handleServerMessage(message: AgentMessage, senderWs: WebSocket) {
  switch (message.type) {
		case MessageType.USER_INPUT: {
      // 创建新项目
      const projectId = uuidv4();
      const content = message.content as unknown as UserInput & { projectName?: string; executionMode?: ExecutionMode };
      const project: GameProjectConfig = {
        projectId,
				projectName:
					content.projectName || `游戏项目_${projectId.slice(0, 8)}`,
				executionMode:
					content.executionMode || ExecutionMode.SEQUENTIAL,
        userInput: content as UserInput,
				status: "initialized",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        assets: {
          art: [],
          music: [],
					code: "",
        },
				testReports: [],
      };
      
      saveProject(project);
      
      // 转发给Planning Agent
      const planningMessage: AgentMessage = {
        messageId: uuidv4(),
				senderId: "a2a-server",
				receiverId: "planning-agent",
        projectId,
        type: MessageType.USER_INPUT,
        content: message.content,
        timestamp: new Date().toISOString(),
				requiresAck: true,
      };
      
			const planningAgent = activeAgents.get("planning-agent");
      if (planningAgent && planningAgent.readyState === WebSocket.OPEN) {
        planningAgent.send(JSON.stringify(planningMessage));
      }
      
      // 发送确认给客户端
      const response: AgentMessage = {
        messageId: uuidv4(),
				senderId: "a2a-server",
        receiverId: message.senderId,
        projectId,
        type: MessageType.STATUS_UPDATE,
				content: {
					status: "project_created",
					projectId,
					projectName: project.projectName,
				},
        timestamp: new Date().toISOString(),
				requiresAck: false,
      };
      senderWs.send(JSON.stringify(response));
      break;
		}
      
		case MessageType.GDD_UPDATE: {
      // 更新项目的GDD
      const projectToUpdate = projectManager.getProject(message.projectId);
      if (projectToUpdate) {
        projectToUpdate.gdd = message.content as GDD;
				projectToUpdate.status = "planning";
        projectToUpdate.updatedAt = new Date().toISOString();
        saveProject(projectToUpdate);
				if (hasExecutionRecord(message.projectId)) {
					const gddPath = path.join(projectsDir, message.projectId, "gdd.json");
					recordStageArtifact(message.projectId, "planning", gddPath, {
						type: "gdd",
					});
					markStageStatus(message.projectId, "planning", "completed");
				}
				if (isPreviewProject(message.projectId)) {
					const payload: ArtifactMessage = {
						stageId: "planning",
						status: "completed",
						artifacts: [
							{
								artifactId: uuidv4(),
								stageId: "planning",
								type: "document",
								format: "gdd",
								url: path.join(projectsDir, message.projectId, "gdd.json"),
								source: "llm" as const,
								metadata: {
									projectName: projectToUpdate.projectName,
								},
							},
						],
					};
					resolvePreviewSession(message.projectId, payload);
					break;
				}
        
        // 根据执行模式决定下一步
				if (
					projectToUpdate.executionMode === ExecutionMode.SEQUENTIAL ||
					projectToUpdate.executionMode === ExecutionMode.ASYNC_PARALLEL
				) {
          // 转发给Art Agent
          const artMessage: AgentMessage = {
            messageId: uuidv4(),
						senderId: "a2a-server",
						receiverId: "art-agent",
            projectId: message.projectId,
            type: MessageType.GDD_UPDATE,
            content: message.content,
            timestamp: new Date().toISOString(),
						requiresAck: true,
          };
          
					const artAgent = activeAgents.get("art-agent");
          if (artAgent && artAgent.readyState === WebSocket.OPEN) {
            artAgent.send(JSON.stringify(artMessage));
          }
          
          // 如果是并行模式，同时转发给Music Agent
          if (projectToUpdate.executionMode === ExecutionMode.ASYNC_PARALLEL) {
            const musicMessage: AgentMessage = {
              messageId: uuidv4(),
							senderId: "a2a-server",
							receiverId: "music-agent",
              projectId: message.projectId,
              type: MessageType.GDD_UPDATE,
              content: message.content,
              timestamp: new Date().toISOString(),
							requiresAck: true,
            };
            
						const musicAgent = activeAgents.get("music-agent");
            if (musicAgent && musicAgent.readyState === WebSocket.OPEN) {
              musicAgent.send(JSON.stringify(musicMessage));
            }
          } else {
            // 顺序模式下，等待Art Agent完成后再通知Music Agent
            // 这个逻辑在ASSET_UPDATE消息处理中
          }
        }
      }
      break;
		}
      
		case MessageType.ASSET_UPDATE: {
      const assetProject = projectManager.getProject(message.projectId);
			if (!assetProject) break;

			const payload = message.content as unknown as ArtifactMessage;
			const artifacts = payload.artifacts || [];

			for (const artifact of artifacts) {
				switch (artifact.stageId) {
					case "art":
						assetProject.assets.art.push(artifact.url);
						break;
					case "music":
						assetProject.assets.music.push(artifact.url);
						break;
					case "tech":
						assetProject.assets.code = artifact.url;
						break;
				}
				recordStageArtifact(message.projectId, artifact.stageId, artifact.url, {
					type: artifact.type,
					format: artifact.format,
					source: artifact.source,
					...artifact.metadata,
				});
			}

			if (payload.status === "completed") {
				markStageStatus(message.projectId, payload.stageId, "completed");
        }
        
        assetProject.updatedAt = new Date().toISOString();
        saveProject(assetProject);
        
			if (!isPreviewProject(message.projectId)) {
				const { summary, followUps } = instructionOrchestrator.summarizeStage(
					payload.stageId,
					artifacts,
					payload.status,
				);
				executionManager.appendConversationMessage(message.projectId, {
            messageId: uuidv4(),
					role: "orchestrator",
					type: "update",
					content: summary,
					stageId: payload.stageId,
            timestamp: new Date().toISOString(),
					metadata: { artifacts: artifacts.length, status: payload.status || "in_progress" },
				});
				if (followUps.length > 0) {
					executionManager.addClarificationQuestions(
						message.projectId,
						followUps,
					);
					executionManager.updateExecutionStatus(
						message.projectId,
						"awaiting_clarification",
						{
							reason: "stage_followup",
							stageId: payload.stageId,
						},
					);
				}
			}

			if (resolvePreviewSession(message.projectId, payload)) {
				break;
			}

			if (payload.status === "paused" && payload.checkpoint) {
				executionManager.recordCheckpoint(
					message.projectId,
					payload.stageId,
					{ ...payload.checkpoint, timestamp: new Date().toISOString() },
				);
			}

			if (
				!isPreviewProject(message.projectId) &&
				payload.stageId === "art" &&
				assetProject.executionMode === ExecutionMode.SEQUENTIAL &&
				payload.status === "completed"
			) {
				sendMusicTask(assetProject);
			}

			if (
				payload.stageId === "music" &&
				assetProject.executionMode === ExecutionMode.SEQUENTIAL &&
				payload.status === "completed"
			) {
				// nothing extra; sequential flow automatically handles after music when assets ready
			}

			if (
				!isPreviewProject(message.projectId) &&
				isAllAssetsReady(assetProject)
			) {
				assetProject.status = "tech";
          saveProject(assetProject);
				sendTechTask(assetProject);
			}
			break;
		}

		case MessageType.COMPLETION: {
			const completionProject = projectManager.getProject(message.projectId);
			if (completionProject) {
				const content = message.content as any;
				completionProject.assets.code =
					content?.outputPath || completionProject.assets.code;
				completionProject.updatedAt = new Date().toISOString();
				completionProject.status = "tech";
				saveProject(completionProject);
				if (content?.outputPath) {
					recordStageArtifact(
						message.projectId,
						"tech",
						content.outputPath,
						{ type: "code", buildId: content.buildId },
					);
				}
				markStageStatus(message.projectId, "tech", "completed");
				if (isPreviewProject(message.projectId)) {
					const payload: ArtifactMessage = {
						stageId: "tech",
						status: "completed",
						artifacts: [
							{
								artifactId: uuidv4(),
								stageId: "tech",
								type: "code",
								format: "build",
								url: content?.outputPath || "",
								source: "llm" as const,
								metadata: {
									buildId: content?.buildId || "",
								},
							},
						],
					};
					resolvePreviewSession(message.projectId, payload);
      break;
				}
				completionProject.status = "testing";
				saveProject(completionProject);
				sendTestTask(completionProject);
			}
			break;
		}
      
		case MessageType.TEST_REPORT: {
      // 处理测试报告
      const testProject = projectManager.getProject(message.projectId);
      if (testProject) {
				const testReport = message.content as unknown as TestReport;
				testProject.testReports.push(testReport.reportId);
        testProject.updatedAt = new Date().toISOString();
        saveProject(testProject);
				const reportPath = path.join(
					projectsDir,
					message.projectId,
					"reports",
					`${testReport.reportId}.json`,
				);
				recordStageArtifact(message.projectId, "test", reportPath, {
					type: "test_report",
				});
				if (isPreviewProject(message.projectId)) {
					const payload: ArtifactMessage = {
						stageId: "test",
						status: testReport.testsFailed > 0 ? "in_progress" : "completed",
						artifacts: [
							{
								artifactId: uuidv4(),
								stageId: "test",
								type: "test_report",
								format: "json",
								url: reportPath,
								source: "llm" as const,
								metadata: {
									testsFailed: testReport.testsFailed,
									summary: testReport.summary,
								},
							},
						],
					};
					resolvePreviewSession(message.projectId, payload);
					break;
				}

				const hasFailures = testReport.testsFailed > 0;
				const issues = testReport.issues ?? [];
				const hasCriticalIssue = issues.some(
					(issue) => issue.severity === "critical",
				);
        
        // 如果有严重问题，触发反馈循环
				if (
					hasFailures &&
					hasCriticalIssue &&
					testProject.executionMode === ExecutionMode.FEEDBACK_LOOP
				) {
          // 根据问题类型决定通知哪个Agent
					const hasTechIssues = issues.some((issue) =>
						["performance", "crash"].includes(issue.category),
          );
          
					const hasDesignIssues = issues.some((issue) =>
						["gameplay"].includes(issue.category),
          );
          
          if (hasTechIssues) {
            const techFeedbackMessage: AgentMessage = {
              messageId: uuidv4(),
							senderId: "a2a-server",
							receiverId: "tech-agent",
              projectId: message.projectId,
              type: MessageType.FEEDBACK,
							content: testReport as unknown as JsonValue,
              timestamp: new Date().toISOString(),
							requiresAck: true,
            };
            
						const techAgent = activeAgents.get("tech-agent");
            if (techAgent && techAgent.readyState === WebSocket.OPEN) {
              techAgent.send(JSON.stringify(techFeedbackMessage));
            }
          }
          
          if (hasDesignIssues) {
            const planningFeedbackMessage: AgentMessage = {
              messageId: uuidv4(),
							senderId: "a2a-server",
							receiverId: "planning-agent",
              projectId: message.projectId,
              type: MessageType.FEEDBACK,
							content: testReport as unknown as JsonValue,
              timestamp: new Date().toISOString(),
							requiresAck: true,
            };
            
						const planningAgent = activeAgents.get("planning-agent");
            if (planningAgent && planningAgent.readyState === WebSocket.OPEN) {
              planningAgent.send(JSON.stringify(planningFeedbackMessage));
            }
          }
				} else if (hasFailures) {
					testProject.status = "failed";
					saveProject(testProject);
					markStageStatus(message.projectId, "test", "failed");
					executionManager.updateExecutionStatus(message.projectId, "failed", {
						reportId: testReport.reportId,
					});
        } else {
          // 测试通过，标记项目完成
					testProject.status = "completed";
          saveProject(testProject);
					markStageStatus(message.projectId, "test", "completed");
				executionManager.updateExecutionStatus(
					message.projectId,
					"completed",
					{ reportId: (message.content as any)?.reportId || "" },
				);          // 通知所有相关Agent
          broadcastProjectStatus(testProject);
        }
      }
      break;
		}
      
    default:
      console.log(`未知消息类型: ${message.type}`);
  }
}

// 检查所有前置资产是否准备就绪
function isAllAssetsReady(project: GameProjectConfig): boolean {
  if (!project.gdd) return false;
  
  // 检查美术资产需求是否满足
  const requiredArtAssets = project.gdd.artRequirements || [];
	const hasArtAssets =
		requiredArtAssets.length === 0 || project.assets.art.length > 0;
  
  // 检查音乐资产需求是否满足
  const requiredAudioAssets = project.gdd.audioRequirements || [];
	const hasMusicAssets =
		requiredAudioAssets.length === 0 || project.assets.music.length > 0;
  
  return hasArtAssets && hasMusicAssets;
}

// 处理项目下一阶段
function processNextPhase(project: GameProjectConfig): void {
  switch (project.executionMode) {
    case ExecutionMode.SEQUENTIAL:
      processSequentialPhase(project);
      break;
    case ExecutionMode.ASYNC_PARALLEL:
      processParallelPhase(project);
      break;
    case ExecutionMode.FEEDBACK_LOOP:
      // 修改为兼容的状态检查，默认处理
      processFeedbackLoop(project);
      break;
  }
}

// 顺序执行模式：策划→美术→音乐→技术→测试
function processSequentialPhase(project: GameProjectConfig): void {
  console.log(`执行顺序模式逻辑: ${project.projectId}`);
  
	if (project.status === "initialized" || project.status === "planning") {
    // 初始化后直接进入策划阶段
		project.status = "planning";
    sendPlanningTask(project);
	} else if (project.status?.includes("planning") && project.gdd) {
    // 策划完成，进入美术阶段
		project.status = "art";
    sendArtTask(project);
	} else if (project.status === "art" && project.assets.art.length > 0) {
    // 美术完成，进入音乐阶段
		project.status = "music";
    sendMusicTask(project);
	} else if (project.status === "music" && project.assets.music.length > 0) {
    // 音乐完成，进入技术阶段
		project.status = "tech";
    sendTechTask(project);
	} else if (project.status === "tech" && project.assets.code) {
    // 技术完成，进入测试阶段
		project.status = "testing";
    sendTestTask(project);
	} else if (project.status === "testing" && project.testReports.length > 0) {
    // 测试完成，检查是否成功
    const lastReport = project.testReports[project.testReports.length - 1];
    try {
      // 尝试读取报告内容
			const reportContent = fs.readFileSync(
				path.join(projectsDir, project.projectId, "reports", lastReport),
				"utf8",
			);
      const testReport: TestReport = JSON.parse(reportContent);
      
      if (testReport.testsFailed === 0) {
				project.status = "completed";
        console.log(`项目 ${project.projectId} 顺序模式执行完成！`);
      } else {
				project.status = "failed";
        console.log(`项目 ${project.projectId} 测试失败，顺序模式执行终止。`);
      }
    } catch (error) {
			console.error("读取测试报告失败:", error);
			project.status = "failed";
    }
  }
  
  projectManager.updateProject(project);
  broadcastProjectStatus(project);
}

// 异步并行模式：策划→(美术+音乐并行)→技术→测试
function processParallelPhase(project: GameProjectConfig): void {
  console.log(`执行并行模式逻辑: ${project.projectId}`);
  
	if (project.status === "initialized") {
    // 初始化后进入策划阶段
		project.status = "planning";
    sendPlanningTask(project);
	} else if (project.status === "planning" && project.gdd) {
    // 策划完成，同时启动美术和音乐任务
		project.status = "art"; // 主状态设为art，同时并行执行music
    sendArtTask(project);
    sendMusicTask(project);
  } else if (
		(project.status === "art" || project.status === "music") &&
    project.assets.art.length > 0 && 
    project.assets.music.length > 0
  ) {
    // 美术和音乐都完成后，进入技术阶段
		project.status = "tech";
    sendTechTask(project);
	} else if (project.status === "tech" && project.assets.code) {
    // 技术完成，进入测试阶段
		project.status = "testing";
    sendTestTask(project);
	} else if (project.status === "testing" && project.testReports.length > 0) {
    // 测试完成
    const lastReport = project.testReports[project.testReports.length - 1];
    try {
			const reportContent = fs.readFileSync(
				path.join(projectsDir, project.projectId, "reports", lastReport),
				"utf8",
			);
      const testReport: TestReport = JSON.parse(reportContent);
      
      if (testReport.testsFailed === 0) {
				project.status = "completed";
        console.log(`项目 ${project.projectId} 并行模式执行完成！`);
      } else {
        // 在反馈循环模式外，并行模式直接标记为失败
        if (project.executionMode !== ExecutionMode.FEEDBACK_LOOP) {
					project.status = "failed";
          console.log(`项目 ${project.projectId} 测试失败。`);
        } else {
          // 在反馈循环模式下，进入反馈状态
					project.status = "planning"; // 修改为有效的状态
          console.log(`项目 ${project.projectId} 进入反馈循环。`);
        }
      }
    } catch (error) {
			console.error("读取测试报告失败:", error);
			project.status = "failed";
    }
  }
  
  projectManager.updateProject(project);
  broadcastProjectStatus(project);
}

// 反馈循环模式：基于测试结果进行迭代优化
function processFeedbackLoop(project: GameProjectConfig): void {
  console.log(`执行反馈循环逻辑: ${project.projectId}`);
  
  if (!project.testReports || project.testReports.length === 0) {
		console.error("没有测试报告，无法执行反馈循环");
    return;
  }
  
  const lastReport = project.testReports[project.testReports.length - 1];
  let designIssues = false;
  let technicalIssues = false;
  
  try {
    // 读取最新测试报告
		const reportPath = path.join(
			projectsDir,
			project.projectId,
			"reports",
			lastReport,
		);
		const reportContent = fs.readFileSync(reportPath, "utf8");
    const testReport: TestReport = JSON.parse(reportContent);
    
    // 分析测试报告中的问题
		for (const issue of testReport.issues) {
			if (issue.category === "gameplay" && issue.severity === "critical") {
        designIssues = true;
      } else if (
				issue.category === "performance" ||
				issue.category === "crash" ||
				issue.severity === "major"
      ) {
        technicalIssues = true;
      }
		}
  } catch (error) {
		console.error("读取或分析测试报告失败:", error);
    return;
  }
  
  // 根据问题类型决定反馈方向
  if (designIssues) {
    // 需要策划Agent修正设计
    console.log(`触发策划反馈: 项目 ${project.projectId} 存在严重游戏性问题`);
		project.status = "planning";
    
    // 发送带有反馈信息的策划任务
    const feedbackMessage: AgentMessage = {
      messageId: uuidv4(),
			senderId: "a2a-server",
			receiverId: "planning-agent",
      projectId: project.projectId,
      type: MessageType.FEEDBACK,
      content: {
        isFeedback: true,
        testReportPath: lastReport,
				issues: ["游戏性问题需要修正"],
      },
      timestamp: new Date().toISOString(),
			requiresAck: true,
    };
    
		const planningAgent = activeAgents.get("planning-agent");
    if (planningAgent && planningAgent.readyState === WebSocket.OPEN) {
      planningAgent.send(JSON.stringify(feedbackMessage));
      // 清除后续阶段数据，准备重新设计
      project.assets.art = [];
      project.assets.music = [];
			project.assets.code = "";
      // 保留测试报告用于参考
    }
  } else if (technicalIssues) {
    // 需要技术Agent修复问题
    console.log(`触发技术反馈: 项目 ${project.projectId} 存在技术问题`);
		project.status = "tech";
    
    const feedbackMessage: AgentMessage = {
      messageId: uuidv4(),
			senderId: "a2a-server",
			receiverId: "tech-agent",
      projectId: project.projectId,
      type: MessageType.FEEDBACK,
      content: {
        isFeedback: true,
        testReportPath: lastReport,
				issues: ["技术问题需要修复"],
      },
      timestamp: new Date().toISOString(),
			requiresAck: true,
    };
    
		const techAgent = activeAgents.get("tech-agent");
    if (techAgent && techAgent.readyState === WebSocket.OPEN) {
      techAgent.send(JSON.stringify(feedbackMessage));
      // 清除测试报告，准备重新测试
      project.testReports = [];
    }
  } else {
    // 没有严重问题，可以完成
		project.status = "completed";
    console.log(`项目 ${project.projectId} 通过反馈循环，已完成！`);
  }
  
  projectManager.updateProject(project);
  broadcastProjectStatus(project);
}

// 获取执行模式描述
function getModeDescription(mode: ExecutionMode): string {
  switch (mode) {
    case ExecutionMode.SEQUENTIAL:
			return "顺序执行模式（适合简单项目，确保依赖正确）";
    case ExecutionMode.ASYNC_PARALLEL:
			return "异步并行模式（提高效率，美术和音乐并行执行）";
    case ExecutionMode.FEEDBACK_LOOP:
			return "反馈循环模式（持续优化版本，自动修正问题）";
    default:
			return "默认执行模式";
  }
}

function hasExecutionRecord(projectId: string): boolean {
	return !!executionManager.getExecutionByProject(projectId);
}

function stageConfigFor(projectId: string, stageId: string) {
	return executionManager.attachStageConfig(projectId, stageId);
}

function markStageStatus(
	projectId: string,
	stageId: string,
	status: "running" | "completed" | "failed" | "paused",
) {
	if (hasExecutionRecord(projectId)) {
		executionManager.updateStageStatus(projectId, stageId, status);
	}
}

function recordStageArtifact(
	projectId: string,
	stageId: string,
	url: string,
	metadata?: JsonRecord,
) {
	if (hasExecutionRecord(projectId)) {
		executionManager.addStageArtifact(projectId, stageId, url, metadata);
	}
}

function sendControlMessage(
	project: GameProjectConfig,
	stageId: string | undefined,
	action: "pause" | "resume" | "abort",
	payload?: JsonRecord,
) {
	if (!hasExecutionRecord(project.projectId)) return;
	const resolvedStageId =
		stageId || executionManager.getRunningStage(project.projectId)?.stageId;
	if (!resolvedStageId) return;

	const stageConfig = stageConfigFor(project.projectId, resolvedStageId);
	const targetAgentId = stageConfig?.agentId || `${resolvedStageId}-agent`;
	if (!targetAgentId) return;

	const targetAgent = activeAgents.get(targetAgentId);
	if (!targetAgent || targetAgent.readyState !== WebSocket.OPEN) return;

	const controlMessage: AgentMessage = {
		messageId: uuidv4(),
		senderId: "a2a-server",
		receiverId: targetAgentId,
		projectId: project.projectId,
		type: MessageType.CONTROL,
		content: {
			action,
			stageId: resolvedStageId,
			updates: payload,
			stageConfig,
		} as unknown as JsonValue,
		timestamp: new Date().toISOString(),
		requiresAck: true,
	};

	targetAgent.send(JSON.stringify(controlMessage));
}

// 发送策划任务
function sendPlanningTask(project: GameProjectConfig): void {
	if (executionManager.hasPendingClarification(project.projectId)) {
		console.log(
			`[orchestrator] 仍有澄清问题待回答，延迟策划阶段: ${project.projectId}`,
		);
		return;
	}
	const stageConfig = stageConfigFor(project.projectId, "planning");
	markStageStatus(project.projectId, "planning", "running");
  const planningMessage: AgentMessage = {
    messageId: uuidv4(),
		senderId: "a2a-server",
		receiverId: "planning-agent",
    projectId: project.projectId,
    type: MessageType.USER_INPUT,
    content: { 
      project,
      userInput: project.userInput,
			executionMode: project.executionMode,
			stageConfig,
    } as unknown as JsonValue,
    timestamp: new Date().toISOString(),
		requiresAck: true,
  };
  
	const planningAgent = activeAgents.get("planning-agent");
  if (planningAgent && planningAgent.readyState === WebSocket.OPEN) {
    planningAgent.send(JSON.stringify(planningMessage));
    console.log(`已发送策划任务到 Planning Agent: ${project.projectId}`);
  } else {
		console.warn("Planning Agent 未连接，任务等待中");
  }
}

// 发送美术任务
function sendArtTask(project: GameProjectConfig): void {
	if (executionManager.hasPendingClarification(project.projectId)) {
		console.log(
			`[orchestrator] 仍有澄清问题待回答，延迟美术阶段: ${project.projectId}`,
		);
		return;
	}
  if (!project.gdd) {
		console.error("缺少GDD，无法创建美术任务");
    return;
  }
	const stageConfig = stageConfigFor(project.projectId, "art");
	markStageStatus(project.projectId, "art", "running");
  
  const artMessage: AgentMessage = {
    messageId: uuidv4(),
		senderId: "a2a-server",
		receiverId: "art-agent",
    projectId: project.projectId,
    type: MessageType.GDD_UPDATE,
    content: {
      project,
			gdd: project.gdd,
			stageConfig,
    } as unknown as JsonValue,
    timestamp: new Date().toISOString(),
		requiresAck: true,
  };
  
	const artAgent = activeAgents.get("art-agent");
  if (artAgent && artAgent.readyState === WebSocket.OPEN) {
    artAgent.send(JSON.stringify(artMessage));
    console.log(`已发送美术任务到 Art Agent: ${project.projectId}`);
  }
}

// 发送音乐任务
function sendMusicTask(project: GameProjectConfig): void {
	if (executionManager.hasPendingClarification(project.projectId)) {
		console.log(
			`[orchestrator] 仍有澄清问题待回答，延迟音乐阶段: ${project.projectId}`,
		);
		return;
	}
  if (!project.gdd) {
		console.error("缺少GDD，无法创建音乐任务");
    return;
  }
	const stageConfig = stageConfigFor(project.projectId, "music");
	markStageStatus(project.projectId, "music", "running");
  
  const musicMessage: AgentMessage = {
    messageId: uuidv4(),
		senderId: "a2a-server",
		receiverId: "music-agent",
    projectId: project.projectId,
    type: MessageType.GDD_UPDATE,
    content: {
      project,
			gdd: project.gdd,
			stageConfig,
    } as unknown as JsonValue,
    timestamp: new Date().toISOString(),
		requiresAck: true,
  };
  
	const musicAgent = activeAgents.get("music-agent");
  if (musicAgent && musicAgent.readyState === WebSocket.OPEN) {
    musicAgent.send(JSON.stringify(musicMessage));
    console.log(`已发送音乐任务到 Music Agent: ${project.projectId}`);
  }
}

// 发送架构任务
function sendArchitectureTask(project: GameProjectConfig): void {
	if (executionManager.hasPendingClarification(project.projectId)) {
		console.log(
			`[orchestrator] 仍有澄清问题待回答，延迟架构阶段: ${project.projectId}`,
		);
		return;
	}
  if (!project.gdd) {
		console.error("缺少GDD，无法创建架构任务");
    return;
  }
	const stageConfig = stageConfigFor(project.projectId, "architecture");
	markStageStatus(project.projectId, "architecture", "running");
  
  const architectureMessage: AgentMessage = {
    messageId: uuidv4(),
		senderId: "a2a-server",
		receiverId: "architecture-agent",
    projectId: project.projectId,
    type: MessageType.GDD_UPDATE,
    content: {
      project,
			gdd: project.gdd,
			artAssets: project.assets.art,
			musicAssets: project.assets.music,
			stageConfig,
    } as unknown as JsonValue,
    timestamp: new Date().toISOString(),
		requiresAck: true,
  };
  
	const architectureAgent = activeAgents.get("architecture-agent");
  if (architectureAgent && architectureAgent.readyState === WebSocket.OPEN) {
    architectureAgent.send(JSON.stringify(architectureMessage));
    console.log(`已发送架构任务到 Architecture Agent: ${project.projectId}`);
  }
}

// 发送技术任务
function sendTechTask(project: GameProjectConfig): void {
	if (executionManager.hasPendingClarification(project.projectId)) {
		console.log(
			`[orchestrator] 仍有澄清问题待回答，延迟技术阶段: ${project.projectId}`,
		);
		return;
	}
	const stageConfig = stageConfigFor(project.projectId, "tech");
	markStageStatus(project.projectId, "tech", "running");
  const techMessage: AgentMessage = {
    messageId: uuidv4(),
		senderId: "a2a-server",
		receiverId: "tech-agent",
    projectId: project.projectId,
    type: MessageType.ASSET_UPDATE,
    content: {
      project,
      artAssets: project.assets.art,
			musicAssets: project.assets.music,
			stageConfig,
    } as unknown as JsonValue,
    timestamp: new Date().toISOString(),
		requiresAck: true,
  };
  
	const techAgent = activeAgents.get("tech-agent");
  if (techAgent && techAgent.readyState === WebSocket.OPEN) {
    techAgent.send(JSON.stringify(techMessage));
    console.log(`已发送技术任务到 Tech Agent: ${project.projectId}`);
  }
}

// 发送测试任务
function sendTestTask(project: GameProjectConfig): void {
	if (executionManager.hasPendingClarification(project.projectId)) {
		console.log(
			`[orchestrator] 仍有澄清问题待回答，延迟测试阶段: ${project.projectId}`,
		);
		return;
	}
	const stageConfig = stageConfigFor(project.projectId, "test");
	markStageStatus(project.projectId, "test", "running");
  const testMessage: AgentMessage = {
    messageId: uuidv4(),
		senderId: "a2a-server",
		receiverId: "test-agent",
    projectId: project.projectId,
    type: MessageType.STATUS_UPDATE,
    content: {
      project,
			buildResult: project.assets.code,
			stageConfig,
    } as unknown as JsonValue,
    timestamp: new Date().toISOString(),
		requiresAck: true,
  };
  
	const testAgent = activeAgents.get("test-agent");
  if (testAgent && testAgent.readyState === WebSocket.OPEN) {
    testAgent.send(JSON.stringify(testMessage));
    console.log(`已发送测试任务到 Test Agent: ${project.projectId}`);
  }
}

const PREVIEW_PREFIX = "preview-";

function isPreviewProject(projectId: string) {
	return projectId.startsWith(PREVIEW_PREFIX);
}

function ensureUserInput(userInput?: UserInput): UserInput {
	const fallback: UserInput = {
		gameGenre: { primary: "rpg" },
		gameType: "rpg",
		dimension: "3d",
		artStyle: "realistic",
		gameMode: "singleplayer",
		projectName: userInput?.projectName,
		additionalRequirements: userInput?.additionalRequirements,
		resourceFiles: userInput?.resourceFiles,
	};
	const merged: UserInput = {
		...fallback,
		...(userInput || {}),
	};
	if (!merged.gameGenre) {
		merged.gameGenre = { primary: (merged.gameType as GameGenre) || "rpg" };
	} else if (!merged.gameGenre.primary) {
		merged.gameGenre.primary =
			(merged.gameType as GameGenre | undefined) || "rpg";
	}
	if (!merged.gameType) {
		merged.gameType = merged.gameGenre.primary;
	}
	return merged;
}

function buildPreviewStageConfig(
	stageId: StagePreviewRequest["stageId"],
	overrides?: Partial<StageConfig>,
): StageConfig {
	// 从配置文件获取默认模型
	let defaultModel = "preview-default-model"; // fallback值
	try {
		// 将stageId映射到agentId
		const agentIdMap: Record<string, string> = {
			planning: "planning",
			art: "art",
			music: "music",
			tech: "tech",
			test: "test",
		};
		const agentId = agentIdMap[stageId];
		if (agentId) {
			const config = getAgentModelConfig(agentId as any);
			if ("model" in config) {
				defaultModel = config.model;
			}
		}
	} catch (error) {
		console.warn(`[Config] 无法从配置文件读取${stageId}的默认模型，使用fallback`);
	}

	// 🔥 关键：标准化模型名（特别是deepseek系列）
	let rawModel =
		overrides?.model ||
		process.env[`DEFAULT_MODEL_${stageId.toUpperCase()}`] ||
		defaultModel;

	const finalModel = normalizeModel(rawModel);

	if (rawModel !== finalModel) {
		console.log(`[Preview] 模型名映射: ${rawModel} → ${finalModel}`);
	}

	return {
		stageId,
		agentId: overrides?.agentId || `${stageId}-agent`,
		model: finalModel,
		knowledgeBase: overrides?.knowledgeBase,
		mode: overrides?.mode || "llm+kb",
		tools: overrides?.tools,
		mcp: overrides?.mcp,
		resources: overrides?.resources,
		expectedArtifacts: overrides?.expectedArtifacts,
	};
}

function validatePreviewRequest(payload: StagePreviewRequest) {
	switch (payload.stageId) {
		case "planning":
			if (!payload.userInput) {
				throw new Error("策划预览需要提供 userInput");
			}
			break;
		case "art":
		case "music":
			if (!payload.gdd) {
				throw new Error("美术/音乐预览需要提供 GDD");
			}
			break;
		case "tech":
			if (!payload.gdd || !payload.assets?.art || !payload.assets?.music) {
				throw new Error("技术预览需要提供 GDD 以及美术/音乐资源");
			}
			break;
		case "test":
			if (!payload.assets?.code) {
				throw new Error("测试预览需要提供构建包或代码路径");
			}
			break;
		default:
			throw new Error("不支持的预览阶段");
	}
}

function cleanupPreviewResources(projectId: string) {
	projectManager.deleteProject(projectId);
	const projectPath = path.join(projectsDir, `${projectId}.json`);
	fs.remove(projectPath).catch((err) => {
		console.warn(`移除预览临时文件失败 ${projectPath}`, err);
	});
}

function resolvePreviewSession(projectId: string, payload: ArtifactMessage) {
	const session = previewSessions.get(projectId);
	if (!session) {
		return false;
	}
	if (session.stageId !== payload.stageId) {
		return false;
	}
	if (session.timeout) {
		clearTimeout(session.timeout);
	}
	previewSessions.delete(projectId);
	session.resolve(payload);
	cleanupPreviewResources(projectId);
	return true;
}

function rejectPreviewSession(projectId: string, error: Error) {
	const session = previewSessions.get(projectId);
	if (!session) return;
	if (session.timeout) {
		clearTimeout(session.timeout);
	}
	previewSessions.delete(projectId);
	session.reject(error);
	cleanupPreviewResources(projectId);
}

function runPreviewStage(
	project: GameProjectConfig,
	stageConfig: StageConfig,
	payload: StagePreviewRequest,
): Promise<{
	projectId: string;
	stageId: string;
	artifacts?: AgentArtifact[];
	status?: string;
}> {
	return new Promise((resolve, reject) => {
		if (previewSessions.has(project.projectId)) {
			previewSessions.delete(project.projectId);
		}

		// 如果 PREVIEW_TIMEOUT_MS 为 0，表示无限等待（不设置超时）
		let timeout: NodeJS.Timeout | null = null;
		if (PREVIEW_TIMEOUT_MS > 0) {
			timeout = setTimeout(() => {
				rejectPreviewSession(project.projectId, new Error("预览超时"));
			}, PREVIEW_TIMEOUT_MS);
			console.log(`[Preview] 设置超时: ${PREVIEW_TIMEOUT_MS}ms (${PREVIEW_TIMEOUT_MS / 60000} 分钟)`);
		} else {
			console.log(`[Preview] 无超时限制 - 将一直等待 Agent 完成任务`);
		}

		previewSessions.set(project.projectId, {
			stageId: stageConfig.stageId,
			resolve: (artifactMessage) => {
				resolve({
					projectId: project.projectId,
					stageId: stageConfig.stageId,
					artifacts: artifactMessage.artifacts,
					status: artifactMessage.status,
				});
			},
			reject,
			timeout,
		});

		switch (stageConfig.stageId) {
			case "planning":
				project.userInput = ensureUserInput(payload.userInput);
				projectManager.updateProject(project);
				sendPlanningTask(project);
				break;
			case "architecture":
				if (!payload.gdd) {
					rejectPreviewSession(
						project.projectId,
						new Error("缺少GDD，无法生成架构文档"),
					);
					break;
				}
				project.gdd = payload.gdd as GDD;
				if (payload.assets) {
					project.assets.art = payload.assets.art || [];
					project.assets.music = payload.assets.music || [];
				}
				saveProject(project);
				sendArchitectureTask(project);
				break;
			case "art":
				if (!payload.gdd) {
					rejectPreviewSession(
						project.projectId,
						new Error("缺少GDD，无法生成美术资源"),
					);
					break;
				}
				project.gdd = payload.gdd as GDD;
				saveProject(project);
				sendArtTask(project);
				break;
			case "music":
				if (!payload.gdd) {
					rejectPreviewSession(
						project.projectId,
						new Error("缺少GDD，无法生成音乐资源"),
					);
					break;
				}
				project.gdd = payload.gdd as GDD;
				saveProject(project);
				sendMusicTask(project);
				break;
			case "tech":
				if (!payload.gdd || !payload.assets) {
					rejectPreviewSession(
						project.projectId,
						new Error("缺少GDD或资源，无法进行技术构建"),
					);
					break;
				}
				project.gdd = payload.gdd as GDD;
				project.assets.art = payload.assets.art || [];
				project.assets.music = payload.assets.music || [];
				saveProject(project);
				sendTechTask(project);
				break;
			case "test":
				if (!payload.assets?.code) {
					rejectPreviewSession(
						project.projectId,
						new Error("缺少构建资源，无法测试"),
					);
					break;
				}
				project.assets.code = payload.assets.code;
				saveProject(project);
				sendTestTask(project);
				break;
			default:
				rejectPreviewSession(project.projectId, new Error("未知阶段"));
		}
	});
}

// 清理旧数据
function cleanupOldData(): void {
  // 清理完成超过24小时的项目数据
  const now = Date.now();
  const allProjects = projectManager.getAllProjects();
  for (const project of allProjects) {
		if (project.status === "completed" && project.updatedAt) {
      const updatedTime = new Date(project.updatedAt).getTime();
      if (now - updatedTime > 24 * 60 * 60 * 1000) {
        // 在实际应用中，这里应该删除对应的文件
        console.log(`清理过期项目: ${project.projectId}`);
      }
    }
  }
}

// 广播项目状态
function broadcastProjectStatus(project: GameProjectConfig) {
  const statusMessage: AgentMessage = {
    messageId: uuidv4(),
		senderId: "a2a-server",
		receiverId: "broadcast",
    projectId: project.projectId,
    type: MessageType.STATUS_UPDATE,
    content: { projectStatus: project.status, project } as unknown as JsonValue,
    timestamp: new Date().toISOString(),
		requiresAck: false,
  };
  
  const messageStr = JSON.stringify(statusMessage);
  
  activeAgents.forEach((ws, agentId) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(messageStr);
    }
  });
}

// REST API端点

// 🔥 新增：适配 game-factory 的 Agent Preview API
// game-factory 调用: POST /workflows/agents/:agentId/preview 或 POST /api/agents/:agentId/preview
const handleAgentPreview = async (req: express.Request, res: express.Response) => {
	const requestId = uuidv4().slice(0, 8);
	try {
		console.log(`\n========== [Agent Preview API - ${requestId}] 开始 ==========`);
		console.log(`[Agent Preview API - ${requestId}] 收到请求: ${req.method} ${req.path}`);
		console.log(`[Agent Preview API - ${requestId}] agentId 参数:`, req.params.agentId);
		console.log(`[Agent Preview API - ${requestId}] 请求体:`, JSON.stringify(req.body, null, 2));

		const agentId = Number.parseInt(req.params.agentId);
		console.log(`[Agent Preview API - ${requestId}] 解析后的 agentId: ${agentId}`);

		// 🔥 agentId 到 stageId 的映射（根据 game-factory 的 agents 表）
		const agentIdToStageId: Record<number, "planning" | "art" | "music" | "tech" | "test"> = {
			1: "planning",   // Planning Agent
			2: "planning",   // 或者根据实际 game-factory agents 表配置
			3: "art",        // Art Agent
			4: "music",      // Music Agent
			5: "tech",       // Tech Agent
			6: "test",       // Test Agent
		};

		const stageId = agentIdToStageId[agentId];
		if (!stageId) {
			return res.status(400).json({
				success: false,
				message: `未知的 agentId: ${agentId}。有效值: ${Object.keys(agentIdToStageId).join(", ")}`,
			});
		}

		// 构建完整的 preview request（合并 stageId）
		const previewRequest = {
			stageId,
			...req.body,
		};

		console.log(`[Agent Preview - ${requestId}] agentId=${agentId} → stageId=${stageId}`);

		// 调用原有的 preview 逻辑
		const rawParsed = PreviewRequestSchema.safeParse(previewRequest);
		if (!rawParsed.success) {
			console.error(`[Agent Preview - ${requestId}] 验证失败:`, rawParsed.error);
			return res.status(400).json({
				success: false,
				message: "请求参数验证失败",
				details: rawParsed.error.flatten(),
			});
		}

		// 规范化为统一格式
		const parsed = normalizePreviewRequest(rawParsed.data);

		// 先确保 userInput 有默认值
		parsed.userInput = ensureUserInput(parsed.userInput);

		// 再进行验证
		validatePreviewRequest(parsed as any);

		const userInput = parsed.userInput;
		const projectId = `${PREVIEW_PREFIX}${uuidv4()}`;
		const projectName =
			parsed.project?.projectName ||
			`Preview-${stageId}-${projectId.slice(-6)}`;

		const project = projectManager.createProject(
			projectId,
			projectName,
			userInput,
			ExecutionMode.SEQUENTIAL,
		);
		project.cloudProvider = parsed.cloudProvider || "aliyun";

		if (parsed.gdd) {
			project.gdd = parsed.gdd as GDD;
		}
		if (parsed.assets?.art) {
			project.assets.art = parsed.assets.art;
		}
		if (parsed.assets?.music) {
			project.assets.music = parsed.assets.music;
		}
		if (parsed.assets?.code) {
			project.assets.code = parsed.assets.code;
		}

		projectManager.updateProject(project);

		const stageConfig = buildPreviewStageConfig(
			stageId,
			parsed.stageConfig as any,
		);

		executionManager.createExecution(
			{
				workflowId: "preview",
				executionMode: ExecutionMode.SEQUENTIAL,
				cloudProvider: project.cloudProvider || "aliyun",
				project: {
					projectName,
					gameGenre: userInput.gameGenre,
					gameType: userInput.gameGenre?.primary,
					dimension: userInput.dimension,
					artStyle: userInput.artStyle,
					gameMode: userInput.gameMode,
					additionalRequirements: userInput.additionalRequirements,
				},
				stages: [stageConfig],
			},
			projectId,
		);

		const result = await runPreviewStage(project, stageConfig, parsed as any);

		console.log(`[Agent Preview - ${requestId}] 预览执行成功`);
		console.log(`========== [Agent Preview API - ${requestId}] 结束 ==========\n`);
		res.json({ success: true, data: result });
	} catch (error) {
		console.error(`[Agent Preview - ${requestId}] Agent预览失败`, error);
		console.log(`========== [Agent Preview API - ${requestId}] 失败结束 ==========\n`);
		res.status(400).json({
			success: false,
			message: error instanceof Error ? error.message : "Agent预览失败",
		});
	}
};

// 注册两个路由，支持 game-factory 的不同调用方式
app.post("/workflows/agents/:agentId/preview", handleAgentPreview);
app.post("/api/agents/:agentId/preview", handleAgentPreview);

// 获取所有项目
app.post("/api/executions/preview", async (req, res) => {
	const requestId = uuidv4().slice(0, 8);
	try {
		console.log(`\n========== [Executions Preview API - ${requestId}] 开始 ==========`);
		console.log(`[Executions Preview API - ${requestId}] 收到请求: ${req.method} ${req.path}`);
		console.log(`[Executions Preview API - ${requestId}] 请求体:`, JSON.stringify(req.body, null, 2));

		// 先验证请求格式（支持两种格式）
		const rawParsed = PreviewRequestSchema.parse(req.body);

		// 规范化为统一格式
		const parsed = normalizePreviewRequest(rawParsed);
		console.log(`[Executions Preview API - ${requestId}] 规范化后的数据:`, JSON.stringify(parsed, null, 2));

		// 先确保 userInput 有默认值
		parsed.userInput = ensureUserInput(parsed.userInput);
		console.log(`[Executions Preview API - ${requestId}] 填充默认值后的 userInput:`, JSON.stringify(parsed.userInput, null, 2));

		// 再进行验证
		validatePreviewRequest(parsed as any);

		const userInput = parsed.userInput;
		const projectId = `${PREVIEW_PREFIX}${uuidv4()}`;
		const projectName =
			parsed.project?.projectName ||
			`Preview-${parsed.stageId}-${projectId.slice(-6)}`;

		const project = projectManager.createProject(
			projectId,
			projectName,
			userInput,
			ExecutionMode.SEQUENTIAL,
		);
		project.cloudProvider = parsed.cloudProvider || "aliyun";

		if (parsed.gdd) {
			project.gdd = parsed.gdd as GDD;
		}
		if (parsed.assets?.art) {
			project.assets.art = parsed.assets.art;
		}
		if (parsed.assets?.music) {
			project.assets.music = parsed.assets.music;
		}
		if (parsed.assets?.code) {
			project.assets.code = parsed.assets.code;
		}

		projectManager.updateProject(project);

		const stageConfig = buildPreviewStageConfig(
			parsed.stageId,
			parsed.stageConfig as any,
		);

		executionManager.createExecution(
			{
				workflowId: "preview",
				executionMode: ExecutionMode.SEQUENTIAL,
				cloudProvider: project.cloudProvider || "aliyun",
				project: {
					projectName,
					gameGenre: userInput.gameGenre,
					gameType: userInput.gameGenre?.primary,
					dimension: userInput.dimension,
					artStyle: userInput.artStyle,
					gameMode: userInput.gameMode,
					additionalRequirements: userInput.additionalRequirements,
				},
				stages: [stageConfig],
			},
			projectId,
		);

		// 如果是异步模式，立即返回任务ID
		if (parsed.async) {
			const taskId = parsed.taskId || uuidv4();

			// 创建任务状态
			taskStateManager.createTask(
				taskId,
				projectId,
				parsed.stageId,
				parsed.callbackUrl,
			);

			console.log(`[Executions Preview API - ${requestId}] 异步模式，任务ID: ${taskId}`);
			console.log(`========== [Executions Preview API - ${requestId}] 异步任务已创建 ==========\n`);

			// 立即返回任务信息
			res.json({
				success: true,
				async: true,
				data: {
					taskId,
					projectId,
					stageId: parsed.stageId,
					status: "pending",
				},
			});

			// 在后台异步执行
			(async () => {
				try {
					taskStateManager.updateTaskStatus(taskId, TaskStatus.RUNNING);
					const result = await runPreviewStage(project, stageConfig, parsed as any);
					taskStateManager.updateTaskStatus(taskId, TaskStatus.COMPLETED);
					taskStateManager.setTaskResult(taskId, result);
					console.log(`[异步任务 ${taskId}] 执行成功`);
				} catch (error) {
					taskStateManager.updateTaskStatus(
						taskId,
						TaskStatus.FAILED,
						error instanceof Error ? error.message : "执行失败",
					);
					console.error(`[异步任务 ${taskId}] 执行失败:`, error);
				}
			})();

			return;
		}

		// 同步模式：等待执行完成
		const result = await runPreviewStage(project, stageConfig, parsed as any);

		console.log(`[Executions Preview API - ${requestId}] 预览执行成功`);
		console.log(`========== [Executions Preview API - ${requestId}] 结束 ==========\n`);
		res.json({ success: true, data: result });
	} catch (error) {
		console.error(`[Executions Preview API - ${requestId}] 执行预览失败`, error);
		console.log(`========== [Executions Preview API - ${requestId}] 失败结束 ==========\n`);
		res.status(400).json({
			success: false,
			message: error instanceof Error ? error.message : "执行预览失败",
		});
	}
});

app.post("/api/executions", (req, res) => {
	const parsed = ExecutionRequestSchema.safeParse(req.body);
	if (!parsed.success) {
		return res
			.status(400)
			.json({ error: "invalid_request", details: parsed.error.flatten() });
	}

	const data = parsed.data as ExecutionRequest;

	// 🔥 优先使用 game-factory 的 projectId（games.id）
	// 如果没有传递，才自动生成（向后兼容）
	const projectId = data.projectId || uuidv4();

	if (!data.projectId) {
		console.warn(
			"⚠️ ExecutionRequest 缺少 projectId。" +
			"建议 game-factory 传递 games.id 作为 projectId 以保持一致性。"
		);
	} else {
		console.log(
			`✅ 使用 game-factory 的 projectId: ${data.projectId} (games.id)`
		);
	}

	const userInput = ensureUserInput({
		gameGenre: data.project.gameGenre,
		gameType: data.project.gameGenre?.primary,
		dimension: data.project.dimension,
		artStyle: data.project.artStyle,
		gameMode: data.project.gameMode,
		projectName: data.project.projectName,
		additionalRequirements: data.project.additionalRequirements,
	});

	const inputValidation = UserInputSchema.safeParse(userInput);
	if (!inputValidation.success) {
		return res.status(400).json({
			error: "invalid_project",
			details: inputValidation.error.flatten(),
		});
	}

	const project = projectManager.createProject(
		projectId,
		data.project.projectName,
		userInput,
		data.executionMode,
	);
	project.executionConfig = {
		workflowId: data.workflowId,
		cloudProvider: data.cloudProvider,
		callbacks: data.callbacks,
		stages: data.stages,
	};
	project.cloudProvider = data.cloudProvider;
	saveProject(project);
	const projectDir = path.join(projectsDir, projectId);
	fs.mkdirSync(projectDir, { recursive: true });
	fs.mkdirSync(path.join(projectDir, "assets", "art"), { recursive: true });
	fs.mkdirSync(path.join(projectDir, "assets", "music"), { recursive: true });
	fs.mkdirSync(path.join(projectDir, "assets", "code"), { recursive: true });
	fs.mkdirSync(path.join(projectDir, "assets", "uploads"), { recursive: true });
	fs.mkdirSync(path.join(projectDir, "reports"), { recursive: true });
	fs.mkdirSync(path.join(projectDir, "memories"), { recursive: true });

	const executionRecord = executionManager.createExecution(data, projectId);
	const briefingQuestions = instructionOrchestrator.analyzeUserBrief(project);

	if (briefingQuestions.length > 0) {
		executionManager.addClarificationQuestions(projectId, briefingQuestions);
		executionManager.updateExecutionStatus(
			projectId,
			"awaiting_clarification",
			{ reason: "instruction_clarification" },
		);
	} else {
		executionManager.updateExecutionStatus(projectId, "running", {
			workflowId: data.workflowId,
		});
		sendPlanningTask(project);
	}

	res.status(201).json({
		executionId: executionRecord.executionId,
		projectId,
		workflowId: data.workflowId,
		status: executionRecord.status,
	});
});

app.get("/api/executions/:executionId", (req, res) => {
	const execution = executionManager.getExecutionById(req.params.executionId);
	if (!execution) {
		return res.status(404).json({ error: "execution_not_found" });
	}
	res.json(execution);
});

app.get("/api/executions/:executionId/events", (req, res) => {
	const execution = executionManager.getExecutionById(req.params.executionId);
	if (!execution) {
		return res.status(404).json({ error: "execution_not_found" });
	}

	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.flushHeaders?.();

	const push = (event: { type: string; payload: unknown }) => {
		res.write(`event: ${event.type}\n`);
		res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
	};

	const cleanup = executionManager.registerEventStream(
		execution.executionId,
		push,
	);
	push({ type: "snapshot", payload: execution });

	req.on("close", () => {
		cleanup();
		res.end();
	});
});

const ClarificationResponseSchema = z.object({
	responses: z
		.array(
			z.object({
				questionId: z.string(),
				answer: z.string().min(1),
			}),
		)
		.min(1),
});

app.get("/api/executions/:executionId/clarifications", (req, res) => {
	const execution = executionManager.getExecutionById(req.params.executionId);
	if (!execution) {
		return res.status(404).json({ error: "execution_not_found" });
	}
	res.json(
		execution.clarification ?? {
			status: "idle",
			questions: [],
			conversation: [],
		},
	);
});

app.post("/api/executions/:executionId/clarifications", (req, res) => {
	const execution = executionManager.getExecutionById(req.params.executionId);
	if (!execution) {
		return res.status(404).json({ error: "execution_not_found" });
	}
	const project = projectManager.getProject(execution.projectId);
	if (!project) {
		return res.status(404).json({ error: "project_not_found" });
	}

	const parsed = ClarificationResponseSchema.safeParse(req.body);
	if (!parsed.success) {
		return res
			.status(400)
			.json({ error: "invalid_request", details: parsed.error.flatten() });
	}

	executionManager.recordClarificationResponses(
		project.projectId,
		parsed.data.responses,
	);
	const clarification = executionManager.getClarification(
		execution.executionId,
	);

	if (clarification) {
		const answers = parsed.data.responses.map((response) => {
			const question = clarification.questions.find(
				(item) => item.questionId === response.questionId,
			);
			return { category: question?.category, answer: response.answer };
		});
		project.userInput = instructionOrchestrator.mergeAnswers(
			project.userInput,
			answers,
		);
		saveProject(project);
	}

	if (clarification?.status === "resolved") {
		executionManager.updateExecutionStatus(project.projectId, "running");
		const planningStage = executionManager.getExecutionByProject(
			project.projectId,
		)?.stages?.planning;
		if (planningStage?.status === "pending") {
			sendPlanningTask(project);
		}
	}

	res.json({
		status: clarification?.status ?? "idle",
		clarification: clarification ?? {
			status: "idle",
			questions: [],
			conversation: [],
		},
	});
});

const ExecutionPatchSchema = z.object({
	action: z.enum(["pause", "resume", "abort", "update_requirements"]),
	stageId: z.string().optional(),
	updates: z.unknown().optional(),
});

app.patch("/api/executions/:executionId", (req, res) => {
	const execution = executionManager.getExecutionById(req.params.executionId);
	if (!execution) {
		return res.status(404).json({ error: "execution_not_found" });
	}

	const parsed = ExecutionPatchSchema.safeParse(req.body);
	if (!parsed.success) {
		return res
			.status(400)
			.json({ error: "invalid_request", details: parsed.error.flatten() });
	}

	const payload = parsed.data;
	const project = projectManager.getProject(execution.projectId);
	if (!project) {
		return res.status(404).json({ error: "project_not_found" });
	}

	switch (payload.action) {
		case "pause":
			executionManager.updateExecutionStatus(project.projectId, "paused");
			sendControlMessage(project, payload.stageId, "pause", payload.updates as JsonRecord);
			break;
		case "resume":
			executionManager.updateExecutionStatus(project.projectId, "running");
			sendControlMessage(project, payload.stageId, "resume", payload.updates as JsonRecord);
			break;
		case "abort":
			executionManager.updateExecutionStatus(project.projectId, "aborted");
			sendControlMessage(project, payload.stageId, "abort", payload.updates as JsonRecord);
			break;
		case "update_requirements":
			executionManager.updateExecutionConfig(
				execution.executionId,
				payload.updates || {},
			);
			break;
	}

	res.json({
		status: executionManager.getExecutionById(execution.executionId)?.status,
	});
});

app.post("/api/resources/upload-url", async (req, res) => {
	const schema = z.object({
		provider: z.enum(["aliyun", "gcp"]).default("aliyun"),
		key: z.string(),
		contentType: z.string().optional(),
	});
	const parsed = schema.safeParse(req.body);
	if (!parsed.success) {
		return res
			.status(400)
			.json({ error: "invalid_request", details: parsed.error.flatten() });
	}

	const { provider, key, contentType } = parsed.data;
	const result = await storageService.getSignedUploadUrl(
		provider,
		key,
		contentType,
	);
	res.json(result);
});

app.post("/api/resources", (req, res) => {
	const schema = z.object({
		executionId: z.string(),
		stageId: z.string(),
		type: z.string(),
		url: z.string().url(),
	});
	const parsed = schema.safeParse(req.body);
	if (!parsed.success) {
		return res
			.status(400)
			.json({ error: "invalid_request", details: parsed.error.flatten() });
	}

	executionManager.registerExternalResource(parsed.data.executionId, {
		stageId: parsed.data.stageId,
		type: parsed.data.type,
		url: parsed.data.url,
	});

	res.status(201).json({ registered: true });
});

app.get("/api/executions/:executionId/stages/:stageId", (req, res) => {
	const context = executionManager.getStageContext(
		req.params.executionId,
		req.params.stageId,
	);
	if (!context) {
		return res.status(404).json({ error: "stage_not_found" });
	}
	res.json(context);
});

const StageActionSchema = z.object({
	notes: z.string().optional(),
	overrides: StageConfigSchema.partial().optional(),
	resources: z
		.array(
			z.object({
				type: z.string(),
				url: z.string().url(),
			}),
		)
		.optional(),
});

app.post("/api/executions/:executionId/stages/:stageId/pause", (req, res) => {
	const execution = executionManager.getExecutionById(req.params.executionId);
	if (!execution) return res.status(404).json({ error: "execution_not_found" });
	const project = projectManager.getProject(execution.projectId);
	if (!project) return res.status(404).json({ error: "project_not_found" });

	executionManager.updateExecutionStatus(project.projectId, "paused");
	executionManager.updateStageStatus(
		project.projectId,
		req.params.stageId,
		"paused",
	);
	sendControlMessage(project, req.params.stageId, "pause", req.body || {});
	res.json({ status: "paused" });
});

app.post("/api/executions/:executionId/stages/:stageId/resume", (req, res) => {
	const execution = executionManager.getExecutionById(req.params.executionId);
	if (!execution) return res.status(404).json({ error: "execution_not_found" });
	const project = projectManager.getProject(execution.projectId);
	if (!project) return res.status(404).json({ error: "project_not_found" });

	executionManager.updateExecutionStatus(project.projectId, "running");
	executionManager.updateStageStatus(
		project.projectId,
		req.params.stageId,
		"running",
	);
	sendControlMessage(project, req.params.stageId, "resume", req.body || {});
	res.json({ status: "running" });
});

app.post("/api/executions/:executionId/stages/:stageId/updates", (req, res) => {
	const execution = executionManager.getExecutionById(req.params.executionId);
	if (!execution) return res.status(404).json({ error: "execution_not_found" });

	const parsed = StageActionSchema.safeParse(req.body);
	if (!parsed.success) {
		return res
			.status(400)
			.json({ error: "invalid_request", details: parsed.error.flatten() });
	}

	executionManager.applyStageUpdates(
		req.params.executionId,
		req.params.stageId,
		{
			updatedAt: new Date().toISOString(),
			...parsed.data,
		} as any,
	);

	res.json({ updated: true });
});

app.get("/api/projects", (req, res) => {
  const projectList = projectManager.getAllProjects();
  res.json(projectList);
});

// 获取单个项目
app.get("/api/projects/:projectId", (req, res) => {
  const project = projectManager.getProject(req.params.projectId);
  if (project) {
    res.json(project);
  } else {
		res.status(404).json({ error: "项目不存在" });
  }
});

// 创建新项目 - 支持三种执行模式选择
app.post("/api/projects", (req, res) => {
  try {
		const {
			projectName,
			userInput,
			executionMode = ExecutionMode.SEQUENTIAL,
		} = req.body;
    
    if (!projectName || !userInput) {
			return res.status(400).json({ error: "缺少必要参数" });
		}

		// 验证用户输入（包括2D/3D兼容性）
		try {
			UserInputSchema.parse(userInput);
		} catch (validationError) {
			const details =
				validationError instanceof z.ZodError
					? validationError.errors
					: (validationError as Error).message;
			return res.status(400).json({
				error: "用户输入验证失败",
				details,
			});
    }
    
    // 验证执行模式
		const mode =
			ExecutionMode[executionMode as keyof typeof ExecutionMode] ||
			ExecutionMode.SEQUENTIAL;
    
    const projectId = uuidv4();
    
    // 使用项目管理器创建项目
		const project = projectManager.createProject(
			projectId,
			projectName,
			userInput,
			mode,
		);
    
    // 创建项目目录结构
    const projectDir = path.join(projectsDir, projectId);
    fs.mkdirSync(projectDir, { recursive: true });
		fs.mkdirSync(path.join(projectDir, "assets", "art"), { recursive: true });
		fs.mkdirSync(path.join(projectDir, "assets", "music"), { recursive: true });
		fs.mkdirSync(path.join(projectDir, "assets", "code"), { recursive: true });
		fs.mkdirSync(path.join(projectDir, "assets", "uploads"), {
			recursive: true,
		}); // 用户上传的资源
		fs.mkdirSync(path.join(projectDir, "reports"), { recursive: true });
		fs.mkdirSync(path.join(projectDir, "memories"), { recursive: true }); // 用于Mem0存储
    
    // 保存项目配置到文件
    fs.writeFileSync(
			path.join(projectDir, "project-config.json"),
			JSON.stringify(project, null, 2),
    );
    
    // 记录执行模式选择
    console.log(`创建项目 ${projectId} - ${projectName}，执行模式: ${mode}`);
    
    // 根据执行模式发送第一个任务
    sendPlanningTask(project);
    
    res.status(201).json({
      projectId,
      projectName,
      executionMode: mode,
			status: "initialized",
			message: `项目创建成功，正在启动${getModeDescription(mode)}`,
    });
  } catch (error) {
		console.error("创建项目失败:", error);
		res
			.status(500)
			.json({ error: "创建项目失败", details: (error as Error).message });
	}
});

// 上传资源文件
app.post(
	"/api/projects/:projectId/upload",
	upload.array("files", 10),
	(req, res) => {
		try {
			const { projectId } = req.params;
			const project = projectManager.getProject(projectId);

			if (!project) {
				return res.status(404).json({ error: "项目不存在" });
			}

			if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
				return res.status(400).json({ error: "没有上传文件" });
			}

			const filesInput = req.files;
			const files: Express.Multer.File[] = Array.isArray(filesInput)
				? filesInput
				: filesInput
					? Object.values(filesInput).flat()
					: [];
			const uploadedFiles: UploadedFileInfo[] = [];

			for (const file of files) {
				const uploadDir = path.join(
					projectsDir,
					projectId,
					"assets",
					"uploads",
				);
				const destPath = path.join(uploadDir, file.originalname);

				fs.moveSync(file.path, destPath);

				uploadedFiles.push({
					filename: file.originalname,
					path: destPath,
					size: file.size,
					mimetype: file.mimetype,
				});
			}

			// 更新项目配置，记录上传的资源
			if (!project.userInput.resourceFiles) {
				project.userInput.resourceFiles = [];
			}

			for (const file of uploadedFiles) {
				project.userInput.resourceFiles?.push({
					filename: file.filename,
					type: file.mimetype.startsWith("image/")
						? "image"
						: file.mimetype.startsWith("audio/")
							? "audio"
							: file.mimetype.includes("3d")
								? "3d"
								: "document",
					purpose: "user_uploaded",
					path: file.path,
				});
			}

			projectManager.updateProject(project);

			res.status(200).json({
				message: "文件上传成功",
				files: uploadedFiles,
			});
		} catch (error) {
			console.error("文件上传失败:", error);
			res
				.status(500)
				.json({ error: "文件上传失败", details: (error as Error).message });
		}
	},
);

// 导出项目为ZIP
app.get("/api/projects/:projectId/export", async (req, res) => {
	try {
		const { projectId } = req.params;
		const { format = "zip" } = req.query;

		const project = projectManager.getProject(projectId);
		if (!project) {
			return res.status(404).json({ error: "项目不存在" });
		}

		if (project.status !== "completed") {
			return res.status(400).json({ error: "项目尚未完成，无法导出" });
		}

		const projectDir = path.join(projectsDir, projectId);
		const gameDir = path.join(projectDir, "game");

		if (!fs.existsSync(gameDir)) {
			return res.status(404).json({ error: "游戏构建目录不存在" });
		}

		if (format === "zip") {
			// 创建ZIP文件
			const zipPath = path.join(
				projectsDir,
				projectId,
				`${project.projectName}_${projectId}.zip`,
			);
			const output = fs.createWriteStream(zipPath);
			const archive = archiver("zip", { zlib: { level: 9 } });

			output.on("close", () => {
				console.log(`ZIP文件已创建: ${zipPath} (${archive.pointer()} bytes)`);
				res.download(zipPath, `${project.projectName}.zip`, (err) => {
					if (err) {
						console.error("下载ZIP文件失败:", err);
					} else {
						// 可选：下载后删除临时文件
						// fs.unlinkSync(zipPath);
					}
				});
			});

			archive.on("error", (err) => {
				console.error("创建ZIP文件失败:", err);
				res
					.status(500)
					.json({ error: "创建ZIP文件失败", details: err.message });
			});

			archive.pipe(output);

			// 添加游戏目录中的所有文件
			archive.directory(gameDir, false);

			// 添加项目配置文件
			const configPath = path.join(projectDir, "project-config.json");
			if (fs.existsSync(configPath)) {
				archive.file(configPath, { name: "project-config.json" });
			}

			await archive.finalize();
		} else {
			res.status(400).json({ error: "不支持的导出格式，仅支持zip" });
		}
	} catch (error) {
		console.error("导出项目失败:", error);
		res
			.status(500)
			.json({ error: "导出项目失败", details: (error as Error).message });
	}
});

// ==================== 任务状态管理API ====================

// 存储 SSE 连接
const sseClients = new Map<string, Express.Response[]>();

/**
 * SSE 端点 - 订阅任务状态更新（实时推送）
 * GET /api/tasks/:taskId/events
 *
 * 使用方式：
 * const eventSource = new EventSource(`http://localhost:8080/api/tasks/${taskId}/events`);
 * eventSource.onmessage = (event) => {
 *   const data = JSON.parse(event.data);
 *   console.log('任务状态:', data.task);
 * };
 */
app.get("/api/tasks/:taskId/events", (req, res) => {
	const { taskId } = req.params;

	// 设置 SSE 响应头
	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.flushHeaders();

	// 添加到客户端列表
	if (!sseClients.has(taskId)) {
		sseClients.set(taskId, []);
	}
	const clients = sseClients.get(taskId)!;
	clients.push(res);

	console.log(`[SSE] 客户端订阅任务: ${taskId}, 当前订阅数: ${clients.length}`);

	// 立即发送当前状态（避免前端等待第一次更新）
	const task = taskStateManager.getTask(taskId);
	if (task) {
		const eventData = JSON.stringify({
			type: "initial",
			task: {
				taskId: task.taskId,
				projectId: task.projectId,
				stageId: task.stageId,
				status: task.status,
				progress: task.progress,
				startTime: task.startTime,
				completeTime: task.completeTime,
				errorMessage: task.errorMessage,
			},
		});
		res.write(`data: ${eventData}\n\n`);
	} else {
		res.write(`data: ${JSON.stringify({ type: "error", message: "任务不存在" })}\n\n`);
		res.end();
		return;
	}

	// 客户端断开连接时清理
	req.on("close", () => {
		const clients = sseClients.get(taskId);
		if (clients) {
			const index = clients.indexOf(res);
			if (index > -1) {
				clients.splice(index, 1);
			}
			if (clients.length === 0) {
				sseClients.delete(taskId);
			}
			console.log(`[SSE] 客户端断开任务: ${taskId}, 剩余订阅数: ${clients.length}`);
		}
	});
});

/**
 * 广播任务状态更新到所有订阅的 SSE 客户端
 */
function broadcastTaskUpdate(taskId: string, task: any) {
	const clients = sseClients.get(taskId);
	if (!clients || clients.length === 0) {
		return;
	}

	const eventData = JSON.stringify({
		type: "update",
		task: {
			taskId: task.taskId,
			projectId: task.projectId,
			stageId: task.stageId,
			status: task.status,
			progress: task.progress,
			startTime: task.startTime,
			completeTime: task.completeTime,
			resultData: task.resultData,
			errorMessage: task.errorMessage,
		},
	});

	// 推送给所有订阅的客户端
	clients.forEach((client, index) => {
		try {
			client.write(`data: ${eventData}\n\n`);
		} catch (error) {
			console.error(`[SSE] 推送失败，移除客户端 ${index}:`, error);
			clients.splice(index, 1);
		}
	});

	console.log(`[SSE] 任务 ${taskId} 状态已推送给 ${clients.length} 个客户端`);
}

// 监听 TaskStateManager 的事件，自动推送给 SSE 客户端
taskStateManager.on("taskUpdate", (taskId: string, task: any) => {
	broadcastTaskUpdate(taskId, task);
});

/**
 * 获取任务状态（用于手动刷新）
 * GET /api/tasks/:taskId/status
 */
app.get("/api/tasks/:taskId/status", (req, res) => {
	try {
		const { taskId } = req.params;
		const task = taskStateManager.getTask(taskId);

		if (!task) {
			return res.status(404).json({
				success: false,
				message: "任务不存在",
			});
		}

		res.json({
			success: true,
			data: {
				taskId: task.taskId,
				projectId: task.projectId,
				stageId: task.stageId,
				status: task.status,
				progress: task.progress,
				startTime: task.startTime,
				completeTime: task.completeTime,
				errorMessage: task.errorMessage,
			},
		});
	} catch (error) {
		console.error("获取任务状态失败:", error);
		res.status(500).json({
			success: false,
			message: "获取任务状态失败",
			error: (error as Error).message,
		});
	}
});

/**
 * 获取任务结果
 * GET /api/tasks/:taskId/result
 */
app.get("/api/tasks/:taskId/result", (req, res) => {
	try {
		const { taskId } = req.params;
		const task = taskStateManager.getTask(taskId);

		if (!task) {
			return res.status(404).json({
				success: false,
				message: "任务不存在",
			});
		}

		if (task.status !== TaskStatus.COMPLETED) {
			return res.status(400).json({
				success: false,
				message: "任务尚未完成",
				status: task.status,
				progress: task.progress,
			});
		}

		res.json({
			success: true,
			data: {
				taskId: task.taskId,
				projectId: task.projectId,
				stageId: task.stageId,
				resultData: task.resultData,
				completeTime: task.completeTime,
			},
		});
	} catch (error) {
		console.error("获取任务结果失败:", error);
		res.status(500).json({
			success: false,
			message: "获取任务结果失败",
			error: (error as Error).message,
		});
	}
});

/**
 * 通过 projectId 获取任务状态
 * GET /api/preview/:projectId/status
 */
app.get("/api/preview/:projectId/status", (req, res) => {
	try {
		const { projectId } = req.params;
		const task = taskStateManager.getTaskByProjectId(projectId);

		if (!task) {
			return res.status(404).json({
				success: false,
				message: "任务不存在",
			});
		}

		res.json({
			success: true,
			data: {
				taskId: task.taskId,
				projectId: task.projectId,
				stageId: task.stageId,
				status: task.status,
				progress: task.progress,
				startTime: task.startTime,
				completeTime: task.completeTime,
				resultData: task.resultData,
				errorMessage: task.errorMessage,
			},
		});
	} catch (error) {
		console.error("获取预览状态失败:", error);
		res.status(500).json({
			success: false,
			message: "获取预览状态失败",
			error: (error as Error).message,
		});
	}
});

// 启动服务器
const PORT = process.env.A2A_PORT || 8080;
server.listen(PORT, () => {
  console.log(`A2A服务器启动在 http://localhost:${PORT}`);
	console.log("WebSocket服务器就绪");
  
  // 加载现有项目
  loadProjects();
});
