/**
 * ReAct Planning Agent - 第二部分：行动、反思和子任务生成
 */

import type { SubGoal, ObservationContext, ActionResult, ReflectionResult } from "../../types/planning-react";
import type { UserInput, StageConfig } from "../../types";

export class ReActPlanningAgentActions {
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

    // 1. 动态生成系统提示词（将在动态提示词生成器中实现）
    const systemPrompt = await agent.dynamicPromptGenerator.generate(goal, context);

    await agent.streamThought(`\n💭 系统提示词已生成 (${systemPrompt.length} 字符)`);

    // 2. 调用 LLM（流式输出）
    await agent.streamThought(`\n🤖 调用大模型生成 ${goal.name}...`);

    try {
      // 这里暂时使用模拟数据，实际应该调用真实的 LLM API
      const llmResponse = await this.callLLMMock(goal, context, agent);

      // 3. 解析输出并更新 GDD
      const parsedOutput = this.parseLLMOutput(llmResponse, goal);
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
   * 模拟 LLM 调用（实际应该调用真实 API）
   */
  private async callLLMMock(goal: SubGoal, context: ObservationContext, agent: any): Promise<string> {
    const { userInput } = context.taskMeta;

    // 根据不同的子任务生成不同的模拟内容
    switch (goal.id) {
      case "core-blueprint":
        return JSON.stringify({
          emotionCurve: {
            peaks: [
              { time: "00:05", event: "首个战斗", tension: 0.7 },
              { time: "00:15", event: "BOSS战", tension: 1.0 },
            ],
            calmPeriods: [
              { time: "00:00-00:03", description: "探索与教学" },
            ],
          },
          coreLoop: {
            duration: "5分钟",
            steps: [
              { step: "发现目标", system: "任务系统" },
              { step: "资源规划", system: "背包系统" },
              { step: "执行操作", system: "战斗系统" },
              { step: "结果反馈", system: "奖励系统" },
            ],
          },
          narrativeBranches: {
            mainQuests: ["序章", "第一章：初次相遇", "第二章：选择"],
            branchPoints: ["选择帮助村民或离开"],
          },
        });

      case "numeric-sandbox":
        return JSON.stringify({
          combatCalculation: {
            damageFormula: "最终伤害 = 基础伤害 × (1 - 减伤率) × 暴击倍率",
            reductionFormula: "减伤率 = 目标防御力 / (目标防御力 + 100 × 攻击者等级)",
          },
          economyBalance: {
            inflationRate: "4.2%/小时",
            mainCurrency: "金币",
            sources: ["任务奖励", "击杀敌人", "出售物品"],
            sinks: ["购买装备", "升级技能", "修理装备"],
          },
          progressionCurve: [
            { level: 1, xpRequired: 0, hp: 100 },
            { level: 2, xpRequired: 100, hp: 120 },
            { level: 3, xpRequired: 250, hp: 144 },
          ],
        });

      case "level-whitebox":
        return JSON.stringify({
          geometry: {
            spawn: { x: 0, y: 0, z: 0 },
            objectives: [
              { type: "enemy_spawn", x: 10, y: 0, z: 5, color: "red" },
              { type: "resource", x: 15, y: 0, z: 10, color: "green" },
            ],
          },
          flowTest: {
            result: "玩家自然流动无死路",
            score: 0.9,
          },
          rhythmTest: {
            combatRatio: 0.4,
            explorationRatio: 0.4,
            narrativeRatio: 0.2,
          },
        });

      default:
        return JSON.stringify({
          [goal.id]: {
            content: `Mock content for ${goal.name}`,
            generated: true,
          },
        });
    }
  }

  /**
   * 解析 LLM 输出
   */
  private parseLLMOutput(response: string, goal: SubGoal): any {
    try {
      return JSON.parse(response);
    } catch (error) {
      // 如果解析失败，返回原始文本
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
}

export const reactActions = new ReActPlanningAgentActions();
