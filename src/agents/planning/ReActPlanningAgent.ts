/**
 * ReAct Planning Agent
 * 基于《全能游戏策划GDD工作体系指南》实现循环思考的智能策划Agent
 */

import "dotenv/config";
import path from "node:path";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import { WebSocket } from "ws";
import type {
  SubGoal,
  ObservationContext,
  GoalPlan,
  ActionResult,
  ReflectionResult,
  IterationRecord,
  ThoughtStreamEvent,
  UserInputRequest,
} from "../../types/planning-react";
import type {
  AgentMessage,
  MessageType,
  UserInput,
  StageConfig,
  GDD,
} from "../../types";
import { taskStateManager, TaskStatus } from "../../services/TaskStateManager";
import { mem0Service } from "../../services/Mem0Service";
import { knowledgeBaseService } from "../../services/KnowledgeBaseService";
import { dynamicPromptGenerator } from "./DynamicPromptGenerator";

export class ReActPlanningAgent {
  private ws: WebSocket | null = null;
  private agentId = "planning-agent";
  private serverUrl: string;

  // 当前执行状态
  private currentProjectId: string | null = null;
  private currentContext: ObservationContext | null = null;
  private currentPlan: GoalPlan | null = null;
  private iterationCount = 0;
  private startTime: Date | null = null;

  // 历史记录
  private iterationHistory: Map<string, IterationRecord[]> = new Map();

  // 用户输入等待队列
  private userInputQueue: Map<string, (input: string) => void> = new Map();

  // 配置
  private maxIterations = 25; // 最大迭代次数（降低以避免无限循环）
  private maxExecutionTime = 30 * 60 * 1000; // 最大执行时间：30分钟
  private maxConsecutiveFailures = 3; // 最大连续失败次数
  private stagnationThreshold = 5; // 进度停滞阈值
  private thoughtStreamEnabled = true; // 是否启用思考流

  // 收敛追踪
  private consecutiveFailures = 0;
  private stagnationCount = 0;
  private lastProgress = 0;

  constructor() {
    this.serverUrl = process.env.A2A_SERVER_URL || "ws://localhost:8080";
  }

  /**
   * 连接到 A2A 服务器
   */
  async connect() {
    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.on("open", () => {
        console.log("[ReAct Planning Agent] 已连接到A2A服务器");
        this.register();
      });

      this.ws.on("message", (message: string) => {
        this.handleMessage(message);
      });

      this.ws.on("close", () => {
        console.log("[ReAct Planning Agent] 与A2A服务器的连接已关闭");
        setTimeout(() => this.connect(), 5000);
      });

      this.ws.on("error", (error) => {
        console.error("[ReAct Planning Agent] WebSocket错误:", error);
      });
    } catch (error) {
      console.error("[ReAct Planning Agent] 连接失败:", error);
      setTimeout(() => this.connect(), 5000);
    }
  }

  /**
   * 注册 Agent
   */
  private register() {
    if (!this.ws) return;

    const registerMessage: AgentMessage = {
      messageId: uuidv4(),
      senderId: this.agentId,
      receiverId: "a2a-server",
      projectId: "",
      type: "STATUS_UPDATE" as MessageType,
      content: {
        action: "register",
        name: "ReAct Planning Agent",
        version: "2.0",
        capabilities: ["gdd-generation", "2d-image-generation", "validation"],
      },
      timestamp: new Date().toISOString(),
      requiresAck: true,
    };

    this.ws.send(JSON.stringify(registerMessage));
    console.log("[ReAct Planning Agent] 已注册到A2A服务器");
  }

  /**
   * 处理接收到的消息
   */
  private async handleMessage(message: string) {
    try {
      const data = JSON.parse(message) as AgentMessage;

      console.log(`[ReAct Planning Agent] 收到消息: ${data.type} 来自: ${data.senderId}`);

      switch (data.type) {
        case "USER_INPUT" as MessageType:
          if (data.content && typeof data.content === "object") {
            await this.startReActLoop(
              data.projectId,
              (data.content as any).userInput as UserInput,
              (data.content as any).stageConfig as StageConfig
            );
          }
          break;

        case "FEEDBACK" as MessageType:
          // 处理外部反馈
          if (this.currentProjectId === data.projectId && this.currentContext) {
            if (data.content && typeof data.content === "object") {
              this.currentContext.externalInputs.userFeedback = (data.content as any).notes;
            }
            await this.streamThought("📥 收到外部反馈，将在下轮迭代中考虑");
          }
          break;

        case "CONTROL" as MessageType:
          if (data.content) {
            await this.handleControlMessage(data.projectId, data.content);
          }
          break;

        default:
          console.log(`[ReAct Planning Agent] 未知消息类型: ${data.type}`);
      }
    } catch (error) {
      console.error("[ReAct Planning Agent] 处理消息失败:", error);
    }
  }

  /**
   * 启动 ReAct 循环
   */
  async startReActLoop(
    projectId: string,
    userInput: UserInput,
    stageConfig: StageConfig
  ): Promise<void> {
    this.currentProjectId = projectId;
    this.iterationCount = 0;
    this.startTime = new Date();

    // 重置收敛追踪变量
    this.consecutiveFailures = 0;
    this.stagnationCount = 0;
    this.lastProgress = 0;

    await this.streamThought(`🚀 开始执行 ReAct 循环式策划任务\n项目: ${userInput.projectName}\n类型: ${userInput.dimension} ${userInput.gameGenre?.primary || '未指定'}`);

    // 初始化上下文
    this.currentContext = {
      currentGDD: { sandbox: {}, interface: {} },
      completedSections: [],
      pendingSections: [],
      externalInputs: {},
      previousIterations: [],
      taskMeta: {
        projectId,
        userInput,
        stageConfig,
        iterationCount: 0,
        startTime: this.startTime,
      },
    };

    // 初始目标规划
    this.currentPlan = await this.initialGoalDecomposition(this.currentContext);

    await this.streamThought(
      `📋 目标规划完成\n` +
      `最终目标: ${this.currentPlan.finalGoal}\n` +
      `子任务数量: ${this.currentPlan.remainingSubGoals.length + 1}\n` +
      `当前子任务: ${this.currentPlan.currentSubGoal.name}`
    );

    // 更新任务状态
    taskStateManager.updateTaskStatus(projectId, TaskStatus.IN_PROGRESS, {
      phase: "planning",
      progress: 0,
    });

    // 开始循环
    await this.executeReActLoop();
  }

  /**
   * 执行 ReAct 循环主逻辑
   */
  private async executeReActLoop(): Promise<void> {
    if (!this.currentProjectId || !this.currentContext || !this.currentPlan) {
      throw new Error("未初始化 ReAct 循环");
    }

    let goalAchieved = false;

    while (!goalAchieved && this.iterationCount < this.maxIterations) {
      this.iterationCount++;
      this.currentContext.taskMeta.iterationCount = this.iterationCount;

      await this.streamThought(`\n\n━━━ 迭代 #${this.iterationCount} 开始 ━━━`);

      // 检查收敛条件
      const shouldStop = await this.checkConvergence();
      if (shouldStop.stop) {
        await this.streamThought(`⛔ 收敛检查失败: ${shouldStop.reason}`);
        break;
      }

      const iterationStart = Date.now();

      try {
        // 1. 观察感知 (Observe)
        await this.streamThought("👁️  阶段 1: 观察感知");
        const observation = await this.observe();

        // 2. 规划目标 (Plan)
        await this.streamThought("🎯 阶段 2: 规划目标");
        const plan = await this.plan(observation);
        this.currentPlan = plan;

        // 发送目标更新事件
        taskStateManager.emit("goalUpdate", {
          taskId: this.currentProjectId,
          goalName: plan.currentSubGoal.name,
        });

        // 3. 决策行动 (Act)
        await this.streamThought(`🎬 阶段 3: 执行行动 - ${plan.currentSubGoal.name}`);
        const actionResult = await this.act(plan.currentSubGoal, observation);

        // 4. 反思学习 (Reflect)
        await this.streamThought("🤔 阶段 4: 反思学习");
        const reflectionResult = await this.reflect(
          plan.currentSubGoal,
          actionResult,
          observation
        );

        // 记录本次迭代
        const iterationDuration = Date.now() - iterationStart;
        const iterationRecord: IterationRecord = {
          iterationNumber: this.iterationCount,
          goal: plan.currentSubGoal,
          actionResult,
          reflectionResult,
          timestamp: new Date(),
          duration: iterationDuration,
        };

        this.currentContext.previousIterations.push(iterationRecord);

        // 保存到历史记录
        const history = this.iterationHistory.get(this.currentProjectId) || [];
        history.push(iterationRecord);
        this.iterationHistory.set(this.currentProjectId, history);

        // 更新进度
        const currentProgress = this.calculateProgress();
        taskStateManager.updateTaskProgress(this.currentProjectId, currentProgress, {
          currentGoal: plan.currentSubGoal.name,
          iteration: this.iterationCount,
        });

        // 更新收敛追踪
        if (actionResult.success) {
          this.consecutiveFailures = 0; // 重置连续失败计数
        } else {
          this.consecutiveFailures++;
        }

        // 检查进度停滞
        if (currentProgress === this.lastProgress) {
          this.stagnationCount++;
        } else {
          this.stagnationCount = 0;
          this.lastProgress = currentProgress;
        }

        await this.streamThought(
          `✅ 迭代 #${this.iterationCount} 完成 (${iterationDuration}ms)\n` +
          `当前进度: ${currentProgress}%\n` +
          `质量评估: ${reflectionResult.quality}`
        );

        // 检查是否完成所有任务
        if (plan.remainingSubGoals.length === 0 && plan.currentSubGoal.status === "completed") {
          goalAchieved = true;
          await this.streamThought("🎉 所有子任务已完成！");
        }

        // 检查是否需要用户输入
        if (actionResult.nextAction === "await_user_input") {
          await this.streamThought("⏸️  等待用户输入...");
          break; // 暂停循环，等待用户输入后通过 resumeReActLoop 恢复
        }

      } catch (error: any) {
        console.error(`[ReAct Planning Agent] 迭代 #${this.iterationCount} 失败:`, error);
        await this.streamThought(`❌ 迭代失败: ${error.message}`);

        // 尝试恢复
        if (this.iterationCount < this.maxIterations) {
          await this.streamThought("🔄 尝试继续...");
          continue;
        } else {
          break;
        }
      }
    }

    // 循环结束
    if (goalAchieved) {
      await this.completeTask();
    } else if (this.iterationCount >= this.maxIterations) {
      await this.streamThought(`⚠️  达到最大迭代次数 (${this.maxIterations})，任务未完全完成`);
      await this.completeTask(false);
    }
  }

  /**
   * 阶段 1: 观察感知 (Observe)
   */
  private async observe(): Promise<ObservationContext> {
    if (!this.currentContext || !this.currentProjectId) {
      throw new Error("上下文未初始化");
    }

    // 1. 读取当前 GDD 产物
    const gddPath = path.resolve(`./data/projects/${this.currentProjectId}/gdd.json`);
    let currentGDD: any = { sandbox: {}, interface: {} };

    if (await fs.pathExists(gddPath)) {
      currentGDD = await fs.readJSON(gddPath);
    }

    // 2. 分析完成进度
    const completed: string[] = [];
    const pending: string[] = [];

    if (this.currentPlan) {
      const allGoals = [this.currentPlan.currentSubGoal, ...this.currentPlan.remainingSubGoals];

      for (const goal of allGoals) {
        if (goal.status === "completed") {
          completed.push(goal.name);
        } else {
          pending.push(goal.name);
        }
      }
    }

    // 3. 更新上下文
    this.currentContext.currentGDD = currentGDD;
    this.currentContext.completedSections = completed;
    this.currentContext.pendingSections = pending;

    await this.streamThought(
      `观察结果:\n` +
      `- 已完成: ${completed.length} 个任务\n` +
      `- 待完成: ${pending.length} 个任务\n` +
      `- GDD 章节数: ${Object.keys(currentGDD.sandbox || {}).length + Object.keys(currentGDD.interface || {}).length}`
    );

    return this.currentContext;
  }

  /**
   * 阶段 2: 规划目标 (Plan)
   */
  private async plan(observation: ObservationContext): Promise<GoalPlan> {
    // 第一次规划：已在 initialGoalDecomposition 中完成
    if (observation.taskMeta.iterationCount === 1) {
      return this.currentPlan!;
    }

    // 后续规划：检查当前任务是否完成，移动到下一个
    if (this.currentPlan!.currentSubGoal.status === "completed") {
      const remaining = this.currentPlan!.remainingSubGoals;

      if (remaining.length > 0) {
        const nextGoal = remaining[0];
        const newRemaining = remaining.slice(1);

        await this.streamThought(
          `切换子任务:\n` +
          `  完成: ${this.currentPlan!.currentSubGoal.name}\n` +
          `  开始: ${nextGoal.name}`
        );

        return {
          finalGoal: this.currentPlan!.finalGoal,
          currentSubGoal: { ...nextGoal, status: "in_progress" },
          remainingSubGoals: newRemaining,
        };
      }
    }

    // 保持当前任务
    return this.currentPlan!;
  }

  /**
   * 初始目标拆解
   */
  private async initialGoalDecomposition(context: ObservationContext): Promise<GoalPlan> {
    const { userInput, stageConfig } = context.taskMeta;
    const is3D = userInput.dimension === "3d";

    await this.streamThought(`🔍 分析游戏类型: ${is3D ? "3D" : "2D"} ${userInput.gameGenre.primary}`);

    // 根据 2D/3D 类型生成不同的子任务
    const subGoals = is3D
      ? this.generate3DGameSubGoals(userInput, stageConfig)
      : this.generate2DGameSubGoals(userInput, stageConfig);

    await this.streamThought(`📋 生成了 ${subGoals.length} 个子任务`);

    return {
      finalGoal: `生成完整的 ${userInput.projectName} GDD (${is3D ? "3D" : "2D"})`,
      currentSubGoal: { ...subGoals[0], status: "in_progress" },
      remainingSubGoals: subGoals.slice(1),
    };
  }

  /**
   * 生成 2D 游戏子目标（基于PDF文档的双轨制体系）
   */
  private generate2DGameSubGoals(input: UserInput, config: StageConfig): SubGoal[] {
    return [
      // ===== 阶段一：私人沙盒（设计实验室） =====

      // 1. 核心设计蓝图
      {
        id: "core-blueprint",
        name: "核心设计蓝图",
        description: "设计情绪体验曲线、核心循环验证图、叙事分支思维导图",
        type: "llm",
        relatedGDDSections: ["sandbox.coreBlueprint"],
        dependencies: [],
        status: "pending",
        estimatedProgress: 12,
        track: "private_sandbox",
      },

      // 2. 核心循环验证（用户确认）
      {
        id: "core-loop-validation",
        name: "核心循环时长确认",
        description: "确认核心循环时长（30秒/5分钟/1小时）",
        type: "user_input",
        relatedGDDSections: ["sandbox.coreLoop"],
        dependencies: ["core-blueprint"],
        status: "pending",
        estimatedProgress: 3,
        track: "private_sandbox",
      },

      // 3. 数值沙盒设计
      {
        id: "numeric-sandbox",
        name: "数值沙盒与平衡验证",
        description: "设计战斗计算表、经济平衡表、成长曲线表，验证平滑度和通胀率",
        type: "llm",
        relatedGDDSections: ["sandbox.numericModels"],
        dependencies: ["core-loop-validation"],
        status: "pending",
        estimatedProgress: 18,
        track: "private_sandbox",
        validationCriteria: [
          "升级曲线平滑度检查（无断崖式增长）",
          "经济系统通胀率<5%/小时",
          "战斗时长控制（小怪3-5秒，BOSS 60-90秒）",
        ],
      },

      // 4. 关卡白盒设计
      {
        id: "level-whitebox",
        name: "关卡地编白盒",
        description: "设计关卡几何、标注出生点/目标点/资源点，验证动线和节奏",
        type: "llm",
        relatedGDDSections: ["sandbox.levelWhitebox"],
        dependencies: ["core-blueprint", "numeric-sandbox"],
        status: "pending",
        estimatedProgress: 15,
        track: "private_sandbox",
        validationCriteria: [
          "动线测试：玩家自然流动无死路",
          "节奏测试：战斗/探索/叙事段落比例符合情绪曲线",
          "难度梯度：符合数值沙盒的预期挑战",
        ],
      },

      // ===== 阶段二：对外接口文档（协作契约） =====

      // 5. 2D美术需求包
      {
        id: "2d-art-requirements",
        name: "2D美术需求包",
        description: "生成角色需求（草图描述）、场景需求（白盒截图标注）、UI需求、特效需求",
        type: "llm",
        relatedGDDSections: ["interface.artBrief2D"],
        dependencies: ["core-blueprint", "level-whitebox"],
        status: "pending",
        estimatedProgress: 12,
        track: "interface_docs",
      },

      // 6. 2D角色概念图生成（AI生成）
      {
        id: "2d-character-concepts",
        name: "2D角色概念图",
        description: "使用2D AI模型生成主角和敌人的概念图",
        type: "2d_generation",
        relatedGDDSections: ["interface.artBrief2D.characterConcepts"],
        dependencies: ["2d-art-requirements"],
        status: "pending",
        estimatedProgress: 8,
        track: "interface_docs",
        imagePrompts: [
          "主角角色设计（1024x1024，分层：基础层/装备层/特效层）",
          "敌人角色设计（1024x1024）",
        ],
      },

      // 7. 程序技术规格书
      {
        id: "tech-specs",
        name: "程序技术规格书",
        description: "生成战斗系统API、经济系统流向、数据表配置、关卡脚本需求",
        type: "llm",
        relatedGDDSections: ["interface.techSpecs"],
        dependencies: ["numeric-sandbox", "level-whitebox"],
        status: "pending",
        estimatedProgress: 15,
        track: "interface_docs",
      },

      // 8. 音频需求矩阵
      {
        id: "audio-requirements",
        name: "音频需求矩阵",
        description: "生成音乐/音效/UI音频/语音需求，包含触发条件、参考风格、技术规格",
        type: "llm",
        relatedGDDSections: ["interface.audioMatrix"],
        dependencies: ["level-whitebox"],
        status: "pending",
        estimatedProgress: 10,
        track: "interface_docs",
      },

      // 9. 视觉风格锁定文件
      {
        id: "visual-style-guide",
        name: "视觉风格锁定文件",
        description: "定义色彩体系、光照原则、材质语言，生成反关键词列表",
        type: "llm",
        relatedGDDSections: ["interface.styleGuide"],
        dependencies: ["core-blueprint"],
        status: "pending",
        estimatedProgress: 7,
        track: "interface_docs",
      },
    ];
  }

  /**
   * 生成 3D 游戏子目标（基于PDF文档的双轨制体系）
   */
  private generate3DGameSubGoals(input: UserInput, config: StageConfig): SubGoal[] {
    return [
      // ===== 阶段一：私人沙盒（设计实验室） =====

      // 1. 核心设计蓝图
      {
        id: "core-blueprint",
        name: "核心设计蓝图",
        description: "设计情绪体验曲线、核心循环验证图、叙事分支思维导图",
        type: "llm",
        relatedGDDSections: ["sandbox.coreBlueprint"],
        dependencies: [],
        status: "pending",
        estimatedProgress: 10,
        track: "private_sandbox",
      },

      // 2. 3D世界架构与空间布局
      {
        id: "3d-world-architecture",
        name: "3D世界架构与空间布局",
        description: "设计3D世界架构、关卡白盒几何、摄像机视角和玩家移动路径",
        type: "llm",
        relatedGDDSections: ["sandbox.worldArchitecture"],
        dependencies: ["core-blueprint"],
        status: "pending",
        estimatedProgress: 15,
        track: "private_sandbox",
        validationCriteria: [
          "动线测试：玩家自然流动无死路",
          "节奏测试：战斗/探索/叙事段落比例符合情绪曲线",
          "性能基线：Draw Call < 500，帧率稳定60fps",
        ],
      },

      // 3. 摄像机系统与玩家操控（用户确认）
      {
        id: "camera-control",
        name: "摄像机系统与玩家操控",
        description: "确认摄像机视角（第一人称/第三人称/自由视角）和操控方案",
        type: "user_input",
        relatedGDDSections: ["sandbox.cameraSystem"],
        dependencies: ["3d-world-architecture"],
        status: "pending",
        estimatedProgress: 5,
        track: "private_sandbox",
      },

      // 4. 数值沙盒与战斗系统
      {
        id: "combat-numeric",
        name: "战斗系统与数值平衡",
        description: "设计战斗计算公式、技能系统、装备系统、成长曲线",
        type: "llm",
        relatedGDDSections: ["sandbox.combatSystem"],
        dependencies: ["camera-control"],
        status: "pending",
        estimatedProgress: 18,
        track: "private_sandbox",
        validationCriteria: [
          "升级曲线平滑度检查（无断崖式增长）",
          "经济系统通胀率<5%/小时",
          "战斗时长控制（小怪3-5秒，BOSS 60-90秒）",
        ],
      },

      // 5. 性能预算与LOD策略
      {
        id: "performance-budget",
        name: "性能预算与LOD策略",
        description: "制定多边形预算、LOD层级策略、内存占用预算",
        type: "llm",
        relatedGDDSections: ["sandbox.performanceBudget"],
        dependencies: ["3d-world-architecture"],
        status: "pending",
        estimatedProgress: 8,
        track: "private_sandbox",
        validationCriteria: [
          "游戏低模：7,500三角面（必须）",
          "LOD1：3,500三角面（10米外）",
          "LOD2：1,500三角面（30米外）",
          "Draw Call < 500，帧率稳定60fps",
        ],
      },

      // ===== 阶段二：对外接口文档（协作契约） =====

      // 6. 3D美术需求包
      {
        id: "3d-art-requirements",
        name: "3D美术需求包",
        description: "生成角色建模规格、场景模块化套件、光照氛围参考",
        type: "llm",
        relatedGDDSections: ["interface.artBrief3D"],
        dependencies: ["3d-world-architecture", "performance-budget"],
        status: "pending",
        estimatedProgress: 15,
        track: "interface_docs",
      },

      // 7. 3D角色三视图生成（AI生成）
      {
        id: "3d-character-orthographic",
        name: "3D角色三视图",
        description: "使用2D AI模型生成主角和敌人的三视图（正/侧/背）",
        type: "2d_generation",
        relatedGDDSections: ["interface.artBrief3D.characterConcepts"],
        dependencies: ["3d-art-requirements"],
        status: "pending",
        estimatedProgress: 10,
        track: "interface_docs",
        imagePrompts: [
          "主角角色三视图（正视/侧视/背视，包含装备细节）",
          "敌人角色三视图（正视/侧视/背视）",
        ],
      },

      // 8. 光照与材质系统
      {
        id: "lighting-material",
        name: "光照与PBR材质系统",
        description: "定义光照方案（主光源/补充光/特效光）、材质语言（金属/布料/石材/魔法）",
        type: "llm",
        relatedGDDSections: ["interface.lightingPlan", "interface.styleGuide"],
        dependencies: ["3d-world-architecture"],
        status: "pending",
        estimatedProgress: 10,
        track: "interface_docs",
      },

      // 9. 程序技术规格书
      {
        id: "tech-specs",
        name: "程序技术规格书",
        description: "生成战斗系统API、关卡脚本需求、数据表配置",
        type: "llm",
        relatedGDDSections: ["interface.techSpecs"],
        dependencies: ["combat-numeric", "3d-world-architecture"],
        status: "pending",
        estimatedProgress: 15,
        track: "interface_docs",
      },

      // 10. 音频需求矩阵
      {
        id: "audio-requirements",
        name: "音频需求矩阵",
        description: "生成音乐/音效/UI音频/语音需求，包含3D空间音频参数",
        type: "llm",
        relatedGDDSections: ["interface.audioMatrix"],
        dependencies: ["3d-world-architecture"],
        status: "pending",
        estimatedProgress: 9,
        track: "interface_docs",
      },
    ];
  }

  /**
   * 阶段 3: 决策行动 (Act) - 委托给 ReActActions
   */
  private async act(goal: SubGoal, context: ObservationContext): Promise<ActionResult> {
    const { reactActions } = await import("./ReActActions");
    return await reactActions.act(goal, context, this);
  }

  /**
   * 阶段 4: 反思学习 (Reflect) - 委托给 ReActActions
   */
  private async reflect(
    goal: SubGoal,
    actionResult: ActionResult,
    context: ObservationContext
  ): Promise<ReflectionResult> {
    const { reactActions } = await import("./ReActActions");
    return await reactActions.reflect(goal, actionResult, context, this);
  }

  /**
   * 流式发送思考过程
   */
  async streamThought(thought: string, metadata?: any): Promise<void> {
    if (!this.thoughtStreamEnabled || !this.currentProjectId) return;

    // 发送到 TaskStateManager 用于前端订阅
    taskStateManager.emit("thoughtStream", {
      taskId: this.currentProjectId,
      thought,
      metadata,
      timestamp: new Date(),
    });

    // 同时打印到控制台
    console.log(`[ReAct Thought] ${thought}`);
  }

  /**
   * 更新 GDD 文件
   */
  async updateGDD(projectId: string, goal: SubGoal, output: any): Promise<void> {
    const gddPath = path.resolve(`./data/projects/${projectId}/gdd.json`);

    // 确保目录存在
    await fs.ensureDir(path.dirname(gddPath));

    // 读取现有 GDD
    let gdd: any = { sandbox: {}, interface: {} };
    if (await fs.pathExists(gddPath)) {
      gdd = await fs.readJSON(gddPath);
    }

    // 根据轨道更新对应部分
    for (const section of goal.relatedGDDSections) {
      const parts = section.split(".");
      let current = gdd;

      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }

      // 更新最后一级
      const lastKey = parts[parts.length - 1];
      current[lastKey] = output;
    }

    // 保存 GDD
    await fs.writeJSON(gddPath, gdd, { spaces: 2 });

    await this.streamThought(`💾 已更新 GDD: ${goal.relatedGDDSections.join(", ")}`);
  }

  /**
   * 发送用户输入请求
   */
  async emitUserInputRequest(request: UserInputRequest): Promise<void> {
    if (!this.currentProjectId) return;

    taskStateManager.emit("userInputRequired", {
      taskId: this.currentProjectId,
      goalId: request.goalId,
      question: request.question,
      options: request.options,
    });

    // 更新任务状态为等待用户输入
    taskStateManager.updateTaskStatus(
      this.currentProjectId,
      TaskStatus.IN_PROGRESS,
      {
        awaitingUserInput: true,
        question: request.question,
      }
    );
  }

  /**
   * 等待用户输入
   */
  async waitForUserInput(goalId: string): Promise<string> {
    return new Promise((resolve) => {
      // 将 resolve 函数存储到队列中
      this.userInputQueue.set(goalId, resolve);

      // 监听用户输入事件
      const handler = (data: any) => {
        if (data.taskId === this.currentProjectId && data.goalId === goalId) {
          const resolver = this.userInputQueue.get(goalId);
          if (resolver) {
            resolver(data.input);
            this.userInputQueue.delete(goalId);
            taskStateManager.off("userInputReceived", handler);
          }
        }
      };

      taskStateManager.on("userInputReceived", handler);
    });
  }

  /**
   * 基于用户输入更新 GDD
   */
  async updateGDDWithUserInput(goal: SubGoal, userInput: string): Promise<void> {
    const output = {
      goalId: goal.id,
      userChoice: userInput,
      confirmedAt: new Date().toISOString(),
    };

    await this.updateGDD(this.currentProjectId!, goal, output);
  }

  /**
   * 保存生成的图像
   */
  async saveGeneratedImage(
    projectId: string,
    goalId: string,
    imageUrl: string
  ): Promise<string> {
    const imagesDir = path.resolve(`./data/projects/${projectId}/images`);
    await fs.ensureDir(imagesDir);

    const filename = `${goalId}_${Date.now()}.png`;
    const filePath = path.join(imagesDir, filename);

    // 实际应该从 imageUrl 下载图像并保存
    // 这里暂时创建一个占位符文件
    await fs.writeFile(filePath, `Mock image for ${goalId}`);

    return filePath;
  }

  /**
   * 计算当前进度百分比
   */
  private calculateProgress(): number {
    if (!this.currentPlan) return 0;

    const allGoals = [this.currentPlan.currentSubGoal, ...this.currentPlan.remainingSubGoals];
    const totalProgress = allGoals.reduce((sum, goal) => sum + goal.estimatedProgress, 0);

    let completedProgress = 0;
    for (const goal of allGoals) {
      if (goal.status === "completed") {
        completedProgress += goal.estimatedProgress;
      }
    }

    return Math.round((completedProgress / totalProgress) * 100);
  }

  /**
   * 完成任务
   */
  private async completeTask(success: boolean = true): Promise<void> {
    if (!this.currentProjectId || !this.currentContext) return;

    await this.streamThought(
      success
        ? `✅ 任务完成！共执行 ${this.iterationCount} 次迭代`
        : `⚠️  任务未完全完成，已执行 ${this.iterationCount} 次迭代`
    );

    // 保存最终 GDD
    const gddPath = path.resolve(`./data/projects/${this.currentProjectId}/gdd.json`);
    const finalGDD = this.currentContext.currentGDD;

    await fs.writeJSON(gddPath, finalGDD, { spaces: 2 });

    // 更新任务状态
    taskStateManager.updateTaskStatus(
      this.currentProjectId,
      success ? TaskStatus.COMPLETED : TaskStatus.FAILED,
      {
        finalGDD: gddPath,
        iterations: this.iterationCount,
        duration: Date.now() - (this.startTime?.getTime() || Date.now()),
      }
    );

    // 发送完成消息
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const completionMessage: AgentMessage = {
        messageId: uuidv4(),
        senderId: this.agentId,
        receiverId: "a2a-server",
        projectId: this.currentProjectId,
        type: "RESULT" as MessageType,
        content: {
          success,
          gddPath,
          iterations: this.iterationCount,
        },
        timestamp: new Date().toISOString(),
        requiresAck: false,
      };

      this.ws.send(JSON.stringify(completionMessage));
    }
  }

  /**
   * 处理控制消息（暂停、恢复、取消等）
   */
  private async handleControlMessage(projectId: string, content: any): Promise<void> {
    if (projectId !== this.currentProjectId) return;

    switch (content.action) {
      case "pause":
        await this.streamThought("⏸️  收到暂停指令");
        // 实现暂停逻辑
        break;

      case "resume":
        await this.streamThought("▶️  收到恢复指令");
        // 实现恢复逻辑
        break;

      case "cancel":
        await this.streamThought("🛑 收到取消指令");
        await this.completeTask(false);
        break;

      default:
        console.log(`[ReAct Planning Agent] 未知控制指令: ${content.action}`);
    }
  }

  /**
   * 收敛检查：防止无限循环
   */
  private async checkConvergence(): Promise<{ stop: boolean; reason: string }> {
    if (!this.startTime) {
      return { stop: false, reason: "" };
    }

    // 1. 检查执行时间
    const elapsed = Date.now() - this.startTime.getTime();
    if (elapsed > this.maxExecutionTime) {
      return {
        stop: true,
        reason: `达到最大执行时间 (${this.maxExecutionTime / 60000} 分钟)`,
      };
    }

    // 2. 检查连续失败次数
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      return {
        stop: true,
        reason: `连续失败 ${this.maxConsecutiveFailures} 次，可能存在系统性问题`,
      };
    }

    // 3. 检查进度停滞
    if (this.stagnationCount >= this.stagnationThreshold) {
      return {
        stop: true,
        reason: `进度停滞 ${this.stagnationThreshold} 次迭代，任务可能陷入死循环`,
      };
    }

    return { stop: false, reason: "" };
  }

  /**
   * 动态提示词生成器
   */
  public dynamicPromptGenerator = dynamicPromptGenerator;

  /**
   * Mem0 服务访问器
   */
  public mem0Service = mem0Service;
}
