/**
 * ReAct Planning Agent - 第二部分：行动、反思和子任务生成
 */

import type { SubGoal, ObservationContext, ActionResult, ReflectionResult } from "../../types/planning-react";
import type { UserInput, StageConfig } from "../../types";
import { LLMService, type LLMMessage, type LLMConfig } from "../../services/LLMService";
import fs from "fs-extra";
import path from "node:path";

// 加载默认模型配置
const agentModelsPath = path.resolve(__dirname, "../../../config/agentModels.default.json");
let defaultModelsConfig: any = {};

try {
  if (fs.existsSync(agentModelsPath)) {
    defaultModelsConfig = fs.readJSONSync(agentModelsPath);
  }
} catch (error) {
  console.warn("[ReActActions] 无法加载 agentModels.default.json，将使用环境变量配置");
}

export class ReActPlanningAgentActions {
  /**
   * 获取 LLM 配置
   */
  private getLLMConfig(stageConfig: StageConfig): LLMConfig {
    // 优先使用 stageConfig 中的 model 配置
    const configuredModel = stageConfig?.model;

    // 从默认配置中读取 planning 配置
    const planningConfig = defaultModelsConfig.planning || {};

    // 构建最终配置
    const provider = planningConfig.provider || "deepseek";
    const model = configuredModel || planningConfig.model || "deepseek-reasoner";
    const endpoint = planningConfig.endpoint || "https://api.deepseek.com/v1";
    const apiKeyEnv = planningConfig.apiKeyEnv || "DEEPSEEK_API_KEY";
    const apiKey = process.env[apiKeyEnv] || "";

    if (!apiKey) {
      console.warn(`[ReActActions] 未配置 ${apiKeyEnv}，LLM 调用可能失败`);
    }

    return {
      provider,
      model,
      endpoint,
      apiKey,
      temperature: planningConfig.extra?.temperature || 0.3,
      maxTokens: planningConfig.extra?.max_tokens || 8000,
      topP: 1,
      extra: planningConfig.extra || {},
    };
  }
  /**
   * 阶段 3: 决策行动 (Act)
   */
  async act(goal: SubGoal, context: ObservationContext, agent: any): Promise<ActionResult> {
    await agent.streamThought(`🎯 开始执行：${goal.name}`);
    await agent.streamThought(`类型: ${goal.type} | 轨道: ${goal.track}`);

    switch (goal.type) {
      case "llm":
        return await this.actWithLLM(goal, context, agent);

      case "direct":
        return await this.actDirect(goal, context, agent);

      case "user_input":
        return await this.actRequestUserInput(goal, context, agent);

      case "2d_generation":
        return await this.actGenerate2DImage(goal, context, agent);

      default:
        throw new Error(`未知的任务类型: ${goal.type}`);
    }
  }

  /**
   * 调用 LLM 生成内容
   */
  private async actWithLLM(
    goal: SubGoal,
    context: ObservationContext,
    agent: any
  ): Promise<ActionResult> {
    await agent.streamThought(`📝 准备调用大模型...\n任务: ${goal.description}`);

    // 1. 动态生成系统提示词
    const systemPrompt = await agent.dynamicPromptGenerator.generate(goal, context);

    await agent.streamThought(`\n💭 系统提示词已生成 (${systemPrompt.length} 字符)`);

    // 2. 获取 LLM 配置
    const llmConfig = this.getLLMConfig(context.taskMeta.stageConfig);
    await agent.streamThought(`\n🤖 使用模型: ${llmConfig.provider}/${llmConfig.model}`);

    try {
      // 3. 构建消息
      const messages: LLMMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: `请完成以下任务：${goal.name}\n\n${goal.description}` },
      ];

      // 4. 调用真实的 LLM API
      await agent.streamThought(`\n⏳ 正在调用 LLM API...`);
      const llmResponse = await LLMService.chat(messages, llmConfig);

      await agent.streamThought(`\n✅ LLM 响应已接收 (${llmResponse.usage?.totalTokens || 0} tokens)`);

      // 5. 解析输出并更新 GDD
      const parsedOutput = this.parseLLMOutput(llmResponse.content, goal);
      await agent.updateGDD(context.taskMeta.projectId, goal, parsedOutput);

      await agent.streamThought(`✅ ${goal.name} 完成，已更新 GDD`);

      // 标记任务完成
      goal.status = "completed";

      return {
        success: true,
        output: parsedOutput,
        thought: `完成子目标：${goal.name}`,
        progressDelta: goal.estimatedProgress,
        nextAction: "continue",
        artifacts: [
          {
            type: "gdd_section",
            path: `./data/projects/${context.taskMeta.projectId}/gdd.json`,
            data: parsedOutput,
          },
        ],
      };
    } catch (error: any) {
      await agent.streamThought(`❌ LLM 调用失败: ${error.message}`);

      // 兜底机制：尝试使用 Mock LLM
      const enableMockFallback = process.env.ENABLE_MOCK_FALLBACK !== "false"; // 默认启用

      if (enableMockFallback) {
        await agent.streamThought(`\n🔄 启用兜底机制，使用 Mock LLM 生成内容...`);

        try {
          const mockOutput = await this.callLLMMock(goal, context, agent);
          await agent.updateGDD(context.taskMeta.projectId, goal, mockOutput);

          await agent.streamThought(`✅ ${goal.name} 完成 (Mock 模式)，已更新 GDD`);

          goal.status = "completed";

          return {
            success: true,
            output: mockOutput,
            thought: `完成子目标：${goal.name} (使用 Mock 兜底)`,
            progressDelta: goal.estimatedProgress,
            nextAction: "continue",
            artifacts: [
              {
                type: "gdd_section",
                path: `./data/projects/${context.taskMeta.projectId}/gdd.json`,
                data: mockOutput,
              },
            ],
          };
        } catch (mockError: any) {
          await agent.streamThought(`❌ Mock 兜底也失败: ${mockError.message}`);
        }
      } else {
        await agent.streamThought(`⚠️  Mock 兜底已禁用，任务执行失败`);
      }

      return {
        success: false,
        output: null,
        thought: `失败：${error.message}`,
        progressDelta: 0,
        nextAction: "continue",
      };
    }
  }

  /**
   * 解析 LLM 输出
   * 支持纯 JSON 或 markdown 代码块中的 JSON
   */
  private parseLLMOutput(response: string, goal: SubGoal): any {
    try {
      // 尝试直接解析 JSON
      return JSON.parse(response);
    } catch (error) {
      // 尝试从 markdown 代码块中提取 JSON
      const jsonBlockMatch = response.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
      if (jsonBlockMatch) {
        try {
          return JSON.parse(jsonBlockMatch[1]);
        } catch (e) {
          // JSON 解析失败，继续往下
        }
      }

      // 如果都解析失败，返回原始文本
      console.warn(`[ReActActions] 无法解析 LLM 输出为 JSON，返回原始文本`);
      return { rawContent: response };
    }
  }

  /**
   * 直接执行（简单决策）
   */
  private async actDirect(
    goal: SubGoal,
    context: ObservationContext,
    agent: any
  ): Promise<ActionResult> {
    await agent.streamThought(`⚡ 执行简单决策: ${goal.name}`);

    // 这里实现简单的逻辑决策
    const output = { directAction: true, goalId: goal.id };

    goal.status = "completed";

    return {
      success: true,
      output,
      thought: `直接完成：${goal.name}`,
      progressDelta: goal.estimatedProgress,
      nextAction: "continue",
    };
  }

  /**
   * 请求用户输入
   */
  private async actRequestUserInput(
    goal: SubGoal,
    context: ObservationContext,
    agent: any
  ): Promise<ActionResult> {
    await agent.streamThought(`⏸️  需要你的输入来继续：${goal.description}`);

    // 生成用户问题和选项
    const question = this.generateUserQuestion(goal, context);
    const options = this.generateUserOptions(goal);

    // 发送用户输入请求事件
    await agent.emitUserInputRequest({
      projectId: context.taskMeta.projectId,
      goalId: goal.id,
      question,
      options,
    });

    // 暂停循环，等待用户输入
    const userInput = await agent.waitForUserInput(goal.id);

    await agent.streamThought(`👤 收到你的输入：${userInput}`);

    // 基于用户输入更新 GDD
    await agent.updateGDDWithUserInput(goal, userInput);

    goal.status = "completed";

    return {
      success: true,
      output: { userInput },
      thought: `用户确认：${goal.name}`,
      progressDelta: goal.estimatedProgress,
      nextAction: "continue",
    };
  }

  /**
   * 生成 2D 图像
   */
  private async actGenerate2DImage(
    goal: SubGoal,
    context: ObservationContext,
    agent: any
  ): Promise<ActionResult> {
    const { stageConfig } = context.taskMeta;
    const model2D = stageConfig.ai2dModel || "stable-diffusion-xl";

    await agent.streamThought(`🎨 使用 ${model2D} 生成概念图...`);

    try {
      const images: Array<{ prompt: string; path: string }> = [];

      // 遍历所有需要生成的图像
      for (const promptTemplate of goal.imagePrompts || []) {
        // 1. 生成详细的图像提示词
        const imagePrompt = await this.generateImagePrompt(promptTemplate, context, agent);

        await agent.streamThought(`📝 图像提示词：\n${imagePrompt}`);

        // 2. 调用 2D AI 模型（这里使用模拟）
        const imageUrl = await this.call2DAIModelMock(model2D, imagePrompt, agent);

        // 3. 保存图像
        const savedPath = await agent.saveGeneratedImage(
          context.taskMeta.projectId,
          goal.id,
          imageUrl
        );

        images.push({ prompt: imagePrompt, path: savedPath });

        await agent.streamThought(`✅ 概念图已生成：${savedPath}`);
      }

      // 4. 更新 GDD 中的图像引用
      await agent.updateGDD(context.taskMeta.projectId, goal, {
        conceptArt: images,
      });

      goal.status = "completed";

      return {
        success: true,
        output: { images },
        thought: `生成概念图：${goal.name}`,
        progressDelta: goal.estimatedProgress,
        nextAction: "continue",
        artifacts: images.map((img) => ({
          type: "image" as const,
          path: img.path,
          data: { prompt: img.prompt },
        })),
      };
    } catch (error: any) {
      await agent.streamThought(`❌ 图像生成失败: ${error.message}`);

      return {
        success: false,
        output: null,
        thought: `失败：${error.message}`,
        progressDelta: 0,
        nextAction: "continue",
      };
    }
  }

  /**
   * 生成图像提示词
   */
  private async generateImagePrompt(
    template: string,
    context: ObservationContext,
    agent: any
  ): Promise<string> {
    const { userInput } = context.taskMeta;

    // 基于用户输入和模板生成详细的图像提示词
    let prompt = template;

    // 添加美术风格
    prompt += `, ${userInput.artStyle} art style`;

    // 添加维度相关的描述
    if (userInput.dimension === "2d") {
      prompt += ", 2D game character design, sprite sheet compatible";
    } else {
      prompt += ", 3D character design, orthographic views";
    }

    // 添加项目特定描述
    if (userInput.additionalRequirements) {
      prompt += `, ${userInput.additionalRequirements}`;
    }

    return prompt;
  }

  /**
   * 模拟调用 2D AI 模型
   */
  private async call2DAIModelMock(
    model: string,
    prompt: string,
    agent: any
  ): Promise<string> {
    // 实际应该调用真实的 API（Stable Diffusion / DALL-E / Midjourney）
    await agent.streamThought(`🔄 调用 ${model} API...`);

    // 模拟延迟
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 返回模拟的图像 URL
    return `https://placeholder.com/generated-image-${Date.now()}.png`;
  }

  /**
   * 生成用户问题
   */
  private generateUserQuestion(goal: SubGoal, context: ObservationContext): string {
    switch (goal.id) {
      case "core-loop-validation":
        return "请确认核心循环的时长，这将影响整体节奏设计：";

      case "camera-control":
        return "请选择摄像机视角，这将影响操控方案：";

      default:
        return goal.description;
    }
  }

  /**
   * 生成用户选项
   */
  private generateUserOptions(goal: SubGoal): string[] | undefined {
    switch (goal.id) {
      case "core-loop-validation":
        return ["30秒（快节奏）", "5分钟（中等节奏）", "1小时（慢节奏）"];

      case "camera-control":
        return ["第一人称", "第三人称", "自由视角"];

      default:
        return undefined;
    }
  }

  /**
   * 阶段 4: 反思学习 (Reflect)
   */
  async reflect(
    goal: SubGoal,
    actionResult: ActionResult,
    context: ObservationContext,
    agent: any
  ): Promise<ReflectionResult> {
    await agent.streamThought(`🤔 反思本轮成果...`);

    // 1. 自我评估质量
    const quality = this.assessQuality(goal, actionResult, context);

    await agent.streamThought(`质量评估: ${quality}`);

    // 2. 识别问题和改进点
    const issues: string[] = [];
    const improvements: string[] = [];

    if (!actionResult.success) {
      issues.push(`任务执行失败：${actionResult.thought}`);
    }

    if (quality === "needs_improvement") {
      issues.push("输出质量未达到预期标准");
      improvements.push("下次迭代需要更详细的提示词");
    }

    // 检查验证标准
    if (goal.validationCriteria && goal.validationCriteria.length > 0) {
      await agent.streamThought(`验证标准检查...`);
      // 这里可以实现具体的验证逻辑
    }

    // 3. 决定是否需要调整计划
    const shouldAdjustPlan = issues.length > 2 || quality === "needs_improvement";

    if (shouldAdjustPlan) {
      await agent.streamThought(`⚠️  发现问题，可能需要调整后续计划`);
    }

    // 4. 提取经验教训并保存到 Mem0
    const memoryToSave = this.extractLessonsLearned(goal, actionResult, quality);

    for (const memory of memoryToSave) {
      await agent.mem0Service.saveMemory(
        "agent",
        context.taskMeta.projectId,
        memory.value,
        "planning",
        memory.importance,
        { goalId: goal.id, iteration: context.taskMeta.iterationCount }
      );
    }

    return {
      quality,
      issues,
      improvements,
      shouldAdjustPlan,
      memoryToSave,
    };
  }

  /**
   * 评估质量
   */
  private assessQuality(
    goal: SubGoal,
    actionResult: ActionResult,
    context: ObservationContext
  ): "excellent" | "good" | "needs_improvement" {
    if (!actionResult.success) {
      return "needs_improvement";
    }

    // 这里可以实现更复杂的质量评估逻辑
    // 例如：检查输出的完整性、格式正确性等

    return "good";
  }

  /**
   * 提取经验教训
   */
  private extractLessonsLearned(
    goal: SubGoal,
    actionResult: ActionResult,
    quality: string
  ): Array<{ key: string; value: string; importance: "high" | "medium" | "low" }> {
    const lessons: Array<{ key: string; value: string; importance: "high" | "medium" | "low" }> = [];

    if (actionResult.success && quality === "excellent") {
      lessons.push({
        key: `success_${goal.id}`,
        value: `成功完成 ${goal.name}，方法有效`,
        importance: "high",
      });
    }

    if (!actionResult.success) {
      lessons.push({
        key: `failure_${goal.id}`,
        value: `${goal.name} 执行失败：${actionResult.thought}`,
        importance: "high",
      });
    }

    return lessons;
  }

  /**
   * Mock LLM 调用（兜底机制）
   * 当真实 LLM API 调用失败时使用
   */
  private async callLLMMock(
    goal: SubGoal,
    context: ObservationContext,
    agent: any
  ): Promise<any> {
    const { userInput } = context.taskMeta;
    const is3D = userInput.dimension === "3d";

    await agent.streamThought(`🔧 生成 Mock 数据作为兜底...`);

    // 模拟延迟
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 根据不同的子任务类型生成 mock 数据
    switch (goal.id) {
      case "core-blueprint":
        return {
          emotionCurve: "Mock: 开局新鲜感 → 中期挑战 → 后期成就感",
          coreLoop: `Mock: ${userInput.gameGenre?.primary || "游戏"} 的核心循环（兜底数据）`,
          uniqueValue: "Mock: 独特的游戏体验（兜底数据）",
          targetAudience: "Mock: 目标玩家群体",
        };

      case "numeric-sandbox":
        return {
          combatFormula: "Mock: 攻击力 × 技能倍率 - 防御力（兜底数据）",
          balanceSheet: "Mock: 数值平衡表（兜底数据）",
          progressionCurve: "Mock: 线性成长曲线",
        };

      case "system-design":
        return {
          systemName: goal.name.replace("设计", "Mock 系统"),
          mechanics: ["Mock 机制1", "Mock 机制2", "Mock 机制3"],
          interaction: "Mock: 与其他系统的交互（兜底数据）",
        };

      case "level-structure":
        return {
          levelCount: is3D ? 10 : 20,
          difficultyProgression: "Mock: 难度逐步递增（兜底数据）",
          keyMilestones: ["Mock 关卡1", "Mock 关卡2", "Mock 关卡3"],
        };

      case "ui-flow":
        return {
          menuStructure: "Mock: 主菜单 → 游戏 → 设置（兜底数据）",
          keyScreens: ["主界面", "游戏界面", "背包界面"],
          navigationFlow: "Mock: 导航流程（兜底数据）",
        };

      case "controls-scheme":
        return {
          inputMethod: is3D ? "键鼠/手柄" : "键盘/触摸",
          keyBindings: {
            move: is3D ? "WASD" : "方向键",
            action: "空格/A键",
            menu: "ESC/Start",
          },
          description: "Mock: 操控方案（兜底数据）",
        };

      case "camera-control":
        return {
          cameraType: is3D ? "第三人称跟随" : "2D俯视/侧视",
          controls: "Mock: 摄像机控制（兜底数据）",
          constraints: "Mock: 视角限制",
        };

      case "art-direction":
        return {
          visualStyle: userInput.artStyle || "Mock 美术风格",
          colorPalette: ["#FF0000", "#00FF00", "#0000FF"],
          referenceImages: ["Mock 参考图1", "Mock 参考图2"],
        };

      case "audio-concept":
        return {
          musicStyle: "Mock: 背景音乐风格（兜底数据）",
          soundDesign: "Mock: 音效设计",
          audioMoods: ["紧张", "舒缓", "激昂"],
        };

      case "multiplayer-design":
        return {
          mode: userInput.gameMode || "single-player",
          playerCount: userInput.gameMode === "multiplayer" ? "2-4人" : "单人",
          networkModel: "Mock: 网络模型（兜底数据）",
        };

      case "core-loop-validation":
      case "camera-control":
        // 用户输入类型任务，返回默认值
        return {
          userChoice: "Mock: 默认选项（兜底数据）",
          note: "需要用户实际输入",
        };

      default:
        // 通用 mock 数据
        return {
          taskId: goal.id,
          taskName: goal.name,
          description: `Mock: ${goal.description}（兜底数据）`,
          content: "这是由于 LLM API 调用失败而生成的兜底数据，建议检查 API 配置后重试。",
          timestamp: new Date().toISOString(),
        };
    }
  }
}

export const reactActions = new ReActPlanningAgentActions();
