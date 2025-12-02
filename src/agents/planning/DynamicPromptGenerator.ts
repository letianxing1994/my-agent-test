/**
 * 动态提示词生成器
 * 根据当前任务状态、GDD 产物、历史迭代等动态生成 LLM 系统提示词
 * 基于《全能游戏策划GDD工作体系指南》的双轨制体系
 */

import type { SubGoal, ObservationContext } from "../../types/planning-react";
import { mem0Service } from "../../services/Mem0Service";

export class DynamicPromptGenerator {
  /**
   * 生成动态系统提示词
   */
  async generate(goal: SubGoal, context: ObservationContext): Promise<string> {
    const { userInput, stageConfig } = context.taskMeta;
    const is3D = userInput.dimension === "3d";

    // 1. 角色定位
    const roleDefinition = this.buildRoleDefinition(stageConfig);

    // 2. 状态感知
    const stateAwareness = this.buildStateAwareness(context);

    // 3. 目标驱动
    const goalGuidance = this.buildGoalGuidance(goal, context);

    // 4. 任务分解与追踪
    const taskTracking = this.buildTaskTracking(context);

    // 5. 反射与学习机制
    const learningContext = await this.buildLearningContext(context);

    // 6. 输出格式要求
    const outputFormat = this.buildOutputFormat(goal, is3D);

    return `
${roleDefinition}

${stateAwareness}

${goalGuidance}

${taskTracking}

${learningContext}

${outputFormat}
    `.trim();
  }

  /**
   * 构建角色定位
   */
  private buildRoleDefinition(config: any): string {
    const specialization = config.agentMeta?.specialization || "全能型";
    const extraTraits = config.agentMeta?.extraTraits || "";

    return `
# 你的角色定位

你是一位资深的游戏策划专家，专精于 **${specialization}** 游戏设计。

你的角色不是"文档撰写者"，而是：
- **设计系统架构师**：构建可验证的数学模型与关卡原型
- **信息萃取工程师**：从动态原型中提炼精准协作需求
- **团队接口定义者**：建立清晰稳定的跨专业沟通协议

${extraTraits ? `你的额外专长包括：${extraTraits}` : ""}

你的工作遵循 **双轨制体系**：
1. **私人沙盒（设计实验室）**：快速迭代、探索验证
   - 情绪体验曲线：设计玩家情绪的峰谷节奏
   - 核心循环验证：确保核心玩法循环的流畅性
   - 数值沙盒：验证战斗、经济、成长系统的平衡性
   - 关卡白盒：测试关卡动线和节奏

2. **对外接口文档（协作契约）**：稳定交付、精准沟通
   - 美术需求包：清晰的视觉规格和参考
   - 程序技术规格：明确的 API 和数据结构
   - 音频需求矩阵：完整的音频触发条件和风格描述
    `.trim();
  }

  /**
   * 构建状态感知
   */
  private buildStateAwareness(context: ObservationContext): string {
    const { currentGDD, completedSections, pendingSections } = context;

    const gddSummary = this.summarizeGDD(currentGDD);

    return `
# 当前项目状态感知

## 已完成的 GDD 章节
${completedSections.length > 0 ? completedSections.map(s => `- ✅ ${s}`).join("\n") : "- 暂无"}

## 待完成的 GDD 章节
${pendingSections.length > 0 ? pendingSections.map(s => `- ⏳ ${s}`).join("\n") : "- 全部完成"}

## 当前 GDD 内容摘要
\`\`\`json
${JSON.stringify(gddSummary, null, 2)}
\`\`\`

## 外部输入
${context.externalInputs.userFeedback ? `- 用户反馈：${context.externalInputs.userFeedback}` : "- 暂无用户反馈"}
${context.externalInputs.otherAgentMessages?.length ? `- 其他 Agent 消息：${context.externalInputs.otherAgentMessages.length} 条` : ""}
    `.trim();
  }

  /**
   * 构建目标驱动
   */
  private buildGoalGuidance(goal: SubGoal, context: ObservationContext): string {
    const { userInput } = context.taskMeta;

    return `
# 当前子目标

**目标名称**：${goal.name}
**目标描述**：${goal.description}
**关联 GDD 章节**：${goal.relatedGDDSections.join(", ")}
**工作轨道**：${goal.track === "private_sandbox" ? "私人沙盒（设计实验室）" : "对外接口文档（协作契约）"}

## 用户需求上下文
- **项目名称**：${userInput.projectName}
- **游戏类型**：${userInput.gameGenre.primary}${userInput.gameGenre.subGenre ? ` (${userInput.gameGenre.subGenre})` : ""}
- **游戏维度**：${userInput.dimension === "2d" ? "2D" : "3D"}
- **美术风格**：${userInput.artStyle}
- **游戏模式**：${userInput.gameMode}
- **附加需求**：${userInput.additionalRequirements || "无"}

## 你的任务
${this.getGoalSpecificInstructions(goal, context)}

${goal.validationCriteria && goal.validationCriteria.length > 0 ? `
## 验证标准（必须满足）
${goal.validationCriteria.map(c => `- ${c}`).join("\n")}
` : ""}
    `.trim();
  }

  /**
   * 获取子任务特定指导
   */
  private getGoalSpecificInstructions(goal: SubGoal, context: ObservationContext): string {
    const is3D = context.taskMeta.userInput.dimension === "3d";

    switch (goal.id) {
      case "core-blueprint":
        return `
请设计游戏的核心设计蓝图：

1. **情绪体验曲线**
   - 绘制 0-30 分钟的情绪体验曲线图
   - 标注每个情绪峰值对应的玩法事件（如首次战斗、首个BOSS、剧情转折）
   - 定义平静期与高潮期的时长比例（建议 6:4）

2. **核心循环验证图**
   - 提炼核心玩法循环（30秒/5分钟/1小时）
   - 确保循环的每个环节都有明确的游戏系统对应
   - 验证循环的流畅性和重复可玩性

3. **叙事分支思维导图**
   - 设计主线任务和支线任务的分支结构
   - 标注关键决策点和分支条件
   - 确保叙事与玩法的融合
        `.trim();

      case "numeric-sandbox":
        return `
请设计数值沙盒与平衡验证：

1. **战斗计算表**
   - 伤害公式：基础伤害 × (1 - 减伤率) × 暴击倍率
   - 减伤率公式：目标防御力 / (目标防御力 + 100 × 攻击者等级)
   - 验证：小怪战斗时长 3-5 秒，BOSS 战斗时长 60-90 秒

2. **经济平衡表**
   - 主要货币：名称、获取途径、消耗途径
   - 货币流入流出比例：确保通胀率 < 5%/小时
   - 价格体系：装备、道具、服务的定价策略

3. **成长曲线表**
   - 升级所需经验值：建议使用指数增长曲线（y = a × x^b）
   - 属性增长幅度：每级增长 8-12%
   - 平滑度检查：避免断崖式增长（相邻等级增长率变化 < 20%）

输出格式：使用表格或 JSON 结构，便于程序读取和验证。
        `.trim();

      case "level-whitebox":
        return `
请设计关卡白盒与动线验证：

1. **关卡几何**
   - 绘制关卡平面图（使用坐标或文字描述）
   - 标注出生点、目标点、资源点、敌人刷新点
   - 定义关卡尺寸和空间布局

2. **动线测试**
   - 主路径：玩家自然流动无死路
   - 支路探索：奖励明确，回程便捷
   - 避免迷宫感：视觉引导清晰

3. **节奏测试**
   - 战斗段落：占比 ${is3D ? "40%" : "35%"}，持续时间 ${is3D ? "2-5 分钟" : "1-3 分钟"}
   - 探索段落：占比 ${is3D ? "40%" : "45%"}，持续时间 ${is3D ? "3-8 分钟" : "2-6 分钟"}
   - 叙事段落：占比 20%，持续时间 1-2 分钟
   - 确保节奏符合情绪体验曲线

输出格式：关卡平面图（文字描述或坐标） + 动线测试报告 + 节奏测试数据。
        `.trim();

      case "2d-art-requirements":
        return `
请为美术团队准备 2D 美术需求包：

1. **角色需求**
   - 角色设定：背景故事、性格特征、功能定位
   - 视觉描述：体型、服装、配色、特征细节
   - 技术规格：
     * 画布尺寸：1024x1024（主角）、512x512（配角）
     * 图层结构：基础层/装备层/特效层
     * 关键帧数：待机 4 帧、移动 6 帧、攻击 8 帧
     * 导出格式：PNG 序列帧（带 Alpha 通道）

2. **场景需求**
   - 场景类型：森林、城镇、地牢等
   - 分层示意：背景层/中景层/前景层/交互层
   - 视差滚动参数：各层滚动速度比例（如 0.3 / 0.6 / 1.0）
   - 技术规格：
     * 单屏尺寸：1920x1080
     * 拼接方式：无缝循环或固定场景
     * 导出格式：PNG（分层）

3. **UI 需求**
   - UI 元素清单：血条、技能栏、背包、对话框等
   - 尺寸与位置：适配 1920x1080 分辨率
   - 交互状态：正常/悬停/按下/禁用

4. **特效需求**
   - 特效类型：攻击特效、治疗特效、环境特效
   - 帧数与时长：建议 8-12 帧，0.3-0.5 秒
   - 导出格式：PNG 序列帧或雪碧图

注意：提供清晰的视觉参考描述，便于后续调用 2D AI 模型生成概念图。
        `.trim();

      case "3d-art-requirements":
        return `
请为美术团队准备 3D 美术需求包：

1. **角色建模规格**
   - 三视图概念（正/侧/背）：提供详细的文字描述
   - 多边形预算：
     * 高模（用于烘焙法线）：不限
     * 游戏低模：7,500 三角面（必须）
     * LOD1：3,500 三角面（10 米外）
     * LOD2：1,500 三角面（30 米外）
   - 拓扑要求：四边形为主，避免三角面和五边形
   - UV 展开：单张 UV，利用率 > 80%
   - 贴图规格（PBR 流程）：
     * Base Color：2048x2048（带 Alpha）
     * Normal Map：2048x2048
     * Roughness：2048x2048
     * Metallic：2048x2048
   - 骨骼与绑定：
     * 骨骼数量：≤ 120 根
     * 权重：每个顶点最多 4 根骨骼
   - 导出格式：FBX 2020，Y-up，1 单位 = 1 厘米

2. **场景模块化套件**
   - 模块清单：地板、墙壁、柱子、楼梯、装饰物等
   - 网格对齐：1 米网格对齐，便于关卡拼接
   - 多边形预算：单个模块 < 500 三角面
   - 贴图复用：使用材质球系统，减少贴图数量

3. **光照氛围参考**
   - 主光源：方向、颜色、强度
   - 补充光：环境光、点光源、聚光灯
   - 特效光：魔法光、火焰光、霓虹光
   - 氛围描述：明亮/阴暗、温暖/冷峻、现实/魔幻

注意：提供详细的三视图描述，便于后续调用 2D AI 模型生成三视图概念图。
        `.trim();

      case "2d-character-concepts":
      case "3d-character-orthographic":
        return `
本子任务会调用 2D AI 模型生成概念图，你无需输出图像本身。

你的任务是：
1. 基于前置任务（美术需求包）中的角色描述
2. 生成详细的图像提示词（英文）
3. 生成视觉描述（中文，供人类阅读）

输出格式示例：
\`\`\`json
{
  "characterConcepts": [
    {
      "name": "主角骑士",
      "imagePrompt": "A brave knight character design, full body, front view, medieval armor with blue cape, holding sword and shield, heroic pose, ${context.taskMeta.userInput.artStyle} art style, 2D game character, white background",
      "visualDescription": "勇敢的骑士，身穿蓝色披风的中世纪盔甲，手持剑盾，英雄姿态"
    },
    {
      "name": "敌人哥布林",
      "imagePrompt": "A goblin enemy character design, full body, front view, green skin, tattered clothes, holding crude weapon, menacing expression, ${context.taskMeta.userInput.artStyle} art style, 2D game character, white background",
      "visualDescription": "绿皮肤的哥布林，破烂的衣服，手持简陋武器，凶狠的表情"
    }
  ]
}
\`\`\`

注意：
- imagePrompt 必须是英文，尽可能详细
- 包含美术风格：${context.taskMeta.userInput.artStyle}
- 包含维度：${is3D ? "3D orthographic views" : "2D sprite"}
- 背景：white background（便于后期处理）
        `.trim();

      case "tech-specs":
        return `
请为程序团队准备技术规格书：

1. **战斗系统 API**
   - 伤害计算接口：\`calculateDamage(attacker, target)\`
   - 状态效果接口：\`applyStatusEffect(target, effect)\`
   - 战斗流程：攻击判定 → 伤害计算 → 动画播放 → 结果反馈

2. **经济系统流向**
   - 货币获取事件：击杀敌人、完成任务、出售物品
   - 货币消耗事件：购买装备、升级技能、修理装备
   - 数据表结构：商店表、价格表、掉落表

3. **数据表配置**
   - 装备表：ID、名称、属性、价格、掉落来源
   - 技能表：ID、名称、效果、冷却时间、消耗
   - 敌人表：ID、名称、生命值、攻击力、掉落物

4. **关卡脚本需求**
   - 触发器系统：进入区域触发事件
   - 对话系统：NPC 对话、任务对话
   - 任务系统：任务接取、进度追踪、任务完成

输出格式：使用伪代码或 JSON Schema，便于程序理解和实现。
        `.trim();

      case "audio-requirements":
        return `
请为音频团队准备音频需求矩阵：

1. **音乐需求**
   | 场景/事件 | 风格 | 时长 | 循环 | 参考 |
   |----------|------|------|------|------|
   | 主菜单 | 史诗/宏大 | 2 分钟 | 是 | Skyrim 主题曲 |
   | 战斗音乐 | 紧张/激昂 | 1.5 分钟 | 是 | Dark Souls 战斗音乐 |
   | 探索音乐 | 舒缓/神秘 | 3 分钟 | 是 | Zelda 探索音乐 |

2. **音效需求**
   | 事件 | 描述 | 时长 | 格式 | 备注 |
   |------|------|------|------|------|
   | 攻击命中 | 金属碰撞声 | 0.2s | WAV | 需要 3 个变体 |
   | 受伤 | 痛苦呻吟 | 0.3s | WAV | 男/女角色分别录制 |
   | 技能释放 | 魔法音效 | 0.5s | WAV | 配合特效 |

3. **UI 音频需求**
   | 交互 | 描述 | 时长 | 格式 |
   |------|------|------|------|
   | 按钮点击 | 清脆的点击音 | 0.1s | WAV |
   | 悬停 | 轻微提示音 | 0.05s | WAV |
   | 确认 | 肯定的音效 | 0.2s | WAV |

4. **语音需求**（如有）
   - 角色语音：主角、NPC、旁白
   - 录音要求：音质清晰，无底噪
   - 格式：WAV，48kHz，16-bit

${is3D ? `
5. **3D 空间音频参数**
   - 最大听觉距离：50 米
   - 衰减曲线：对数衰减
   - 多普勒效应：轻微启用
   - 遮挡系统：墙壁遮挡降低 50% 音量
` : ""}

输出格式：使用表格或结构化 JSON，包含触发条件、技术规格、参考风格。
        `.trim();

      case "visual-style-guide":
      case "lighting-material":
        return `
请定义视觉风格锁定文件：

1. **色彩体系**
   - 主色调：${context.taskMeta.userInput.artStyle} 风格的主要颜色
   - 辅助色调：补充和强调的颜色
   - 禁用色调：避免使用的颜色（与主题冲突）

2. **光照原则**
   - 主光源：方向、颜色温度、强度
   - 补充光：环境光、反射光
   - 特效光：魔法光、火焰光

${is3D ? `
3. **PBR 材质语言**
   - 金属材质：Metallic = 1.0, Roughness = 0.2-0.4
   - 布料材质：Metallic = 0.0, Roughness = 0.7-0.9
   - 石材材质：Metallic = 0.0, Roughness = 0.5-0.7
   - 魔法材质：自发光 + 折射效果
` : `
3. **材质语言**
   - 金属质感：高光、反射
   - 布料质感：柔和、纹理
   - 石材质感：粗糙、阴影
`}

4. **反关键词列表**（避免出现的视觉元素）
   - 禁止的风格：例如避免赛博朋克元素（如果是奇幻风格）
   - 禁止的色调：例如避免高饱和度霓虹色（如果是写实风格）
   - 禁止的元素：例如避免现代科技元素（如果是中世纪风格）

输出格式：清晰的文字描述 + 色值代码（Hex） + 示例图像提示词。
        `.trim();

      case "performance-budget":
        return `
请制定 3D 游戏的性能预算与 LOD 策略：

1. **多边形预算**
   - 角色模型：
     * 主角：7,500 三角面（LOD0）
     * 重要 NPC：5,000 三角面（LOD0）
     * 普通敌人：3,000 三角面（LOD0）
   - 场景模型：
     * 单屏可见三角面总数：< 150,000
     * 单个场景模块：< 500 三角面

2. **LOD 层级策略**
   - LOD0（0-10 米）：原始精度，7,500 三角面
   - LOD1（10-30 米）：降低 50%，3,500 三角面
   - LOD2（30-50 米）：降低 80%，1,500 三角面
   - LOD3（50 米以上）：简化到 500 三角面或使用 Billboard

3. **贴图预算**
   - 角色贴图：2048x2048（主角），1024x1024（配角）
   - 场景贴图：2048x2048（地形），1024x1024（模块）
   - 特效贴图：512x512（粒子效果）
   - 总显存占用：< 2GB

4. **Draw Call 预算**
   - 目标：< 500 Draw Calls/帧
   - 优化策略：
     * 合批渲染：相同材质的物体合并
     * 遮挡剔除：视野外物体不渲染
     * 实例化渲染：大量相同物体使用实例化

5. **帧率目标**
   - 目标平台：PC / Console / Mobile
   - 目标帧率：60 FPS（PC/Console），30 FPS（Mobile）
   - 最低配置：确保低配设备稳定运行

输出格式：数值表格 + 优化策略说明。
        `.trim();

      case "3d-world-architecture":
      case "camera-control":
        return `
请设计 3D 世界架构与摄像机系统：

1. **3D 世界架构**
   - 世界尺寸：长 × 宽 × 高（单位：米）
   - 区域划分：森林区、城镇区、地牢区等
   - 空间层次：地面层、空中层、地下层

2. **关卡白盒几何**
   - 主路径：玩家前进的主要路线
   - 支路探索：隐藏区域和奖励区域
   - 垂直空间：爬升、跳跃、飞行路径

3. **摄像机视角与操控**
${goal.id === "camera-control" ? `
   （本任务需要用户确认摄像机视角，系统会暂停等待用户输入）

   可选方案：
   - 第一人称：玩家视角，沉浸感强，适合射击/恐怖游戏
   - 第三人称：角色后方，平衡沉浸感和空间感，适合动作游戏
   - 自由视角：可旋转缩放，适合策略/模拟游戏

   操控方案：
   - 鼠标/右摇杆：旋转视角
   - WASD/左摇杆：移动角色
   - 鼠标滚轮：缩放距离（第三人称）
` : `
   - 摄像机类型：第一人称 / 第三人称 / 自由视角
   - 跟随参数：距离、高度、角度
   - 碰撞处理：遇到障碍物时的应对策略
   - 平滑过渡：移动和旋转的平滑曲线
`}

4. **玩家移动路径**
   - 移动速度：行走 4 m/s，跑步 8 m/s
   - 跳跃高度：2 米
   - 爬升能力：楼梯、斜坡、梯子

输出格式：空间布局描述 + 摄像机参数表 + 操控映射表。
        `.trim();

      case "combat-numeric":
        return `
请设计 3D 游戏的战斗系统与数值平衡：

1. **战斗计算公式**
   - 物理伤害：(攻击力 - 防御力) × 技能倍率 × 暴击倍率
   - 魔法伤害：魔法攻击力 × (1 - 魔法抗性) × 技能倍率
   - 暴击系统：暴击率、暴击倍率（建议 1.5-2.0）
   - 护甲穿透：百分比穿透或固定穿透

2. **技能系统**
   - 技能分类：主动技能、被动技能、终极技能
   - 技能消耗：MP、能量、冷却时间
   - 技能效果：伤害、治疗、控制、增益、减益

3. **装备系统**
   - 装备槽位：武器、头盔、护甲、手套、鞋子、饰品
   - 装备品质：普通、优秀、稀有、史诗、传说
   - 装备属性：基础属性 + 随机属性

4. **成长曲线**
   - 等级上限：建议 50-100 级
   - 升级所需经验：指数增长（y = 100 × 1.1^x）
   - 属性增长：每级增长 8-12%
   - 技能点分配：每级获得 2-3 点技能点

5. **战斗时长控制**
   - 小怪战斗：3-5 秒（单体），8-12 秒（群体）
   - 精英怪战斗：15-30 秒
   - BOSS 战斗：60-120 秒
   - 平衡验证：DPS × 战斗时长 ≈ 敌人生命值

输出格式：公式表 + 数值表 + 验证报告。
        `.trim();

      default:
        return `
请完成 **${goal.name}** 的设计内容。

确保输出：
1. 清晰明确，便于团队理解和执行
2. 符合行业标准和最佳实践
3. 考虑后续团队成员（美术、程序、音频）的使用场景
4. 提供足够的细节和参考信息
        `.trim();
    }
  }

  /**
   * 构建任务分解与追踪
   */
  private buildTaskTracking(context: ObservationContext): string {
    const currentPlan = context.taskMeta.currentPlan;
    if (!currentPlan) {
      return "";
    }

    const allSubGoals = [currentPlan.currentSubGoal, ...currentPlan.remainingSubGoals];

    const totalProgress = allSubGoals.reduce((sum, g) => sum + g.estimatedProgress, 0);
    const completedProgress = allSubGoals
      .filter(g => g.status === "completed")
      .reduce((sum, g) => sum + g.estimatedProgress, 0);
    const overallProgress = Math.round((completedProgress / totalProgress) * 100);

    return `
# 任务分解与追踪

## 总体进度
- 迭代次数：${context.taskMeta.iterationCount}
- 当前进度：${overallProgress}%

## 子任务列表
${allSubGoals.map((g, i) => {
  const statusIcon = g.status === "completed" ? "✅" : g.status === "in_progress" ? "🔄" : "⏳";
  const trackLabel = g.track === "private_sandbox" ? "沙盒" : "接口";
  return `${i + 1}. ${statusIcon} ${g.name} (${g.estimatedProgress}%, ${trackLabel})`;
}).join("\n")}
    `.trim();
  }

  /**
   * 构建反射与学习机制
   */
  private async buildLearningContext(context: ObservationContext): Promise<string> {
    // 从 Mem0 中加载相关的历史经验
    try {
      const memories = await mem0Service.getMemoriesByCategory(
        context.taskMeta.projectId,
        "design"
      );

      if (!memories || memories.length === 0) {
        return `
# 反射与学习机制

暂无历史经验可参考，这是你的第一次尝试。请确保：
1. 输出内容详实、具有可执行性
2. 符合游戏行业标准和最佳实践
3. 考虑后续团队成员（美术、程序、音频）的使用场景
        `.trim();
      }

      // 取前 5 条记忆
      const recentMemories = memories.slice(0, 5);

      return `
# 反射与学习机制

## 历史经验参考
${recentMemories.map((m, i) => `${i + 1}. ${m.content}`).join("\n")}

请基于这些经验：
1. 避免重复已知的错误
2. 应用验证过的成功模式
3. 持续优化设计质量
      `.trim();
    } catch (error) {
      console.warn("[DynamicPromptGenerator] 加载 Mem0 记忆失败:", error);
      return `
# 反射与学习机制

（长期记忆系统暂时不可用）

请确保：
1. 输出内容详实、具有可执行性
2. 符合游戏行业标准和最佳实践
3. 考虑后续团队成员（美术、程序、音频）的使用场景
      `.trim();
    }
  }

  /**
   * 构建输出格式要求
   */
  private buildOutputFormat(goal: SubGoal, is3D: boolean): string {
    const section = goal.relatedGDDSections[0] || "output";

    return `
# 输出格式要求

请以 **结构化 JSON** 格式输出，便于系统解析和更新 GDD：

\`\`\`json
{
  "${section}": {
    // 你的设计内容
  }
}
\`\`\`

${goal.type === "2d_generation" ? `
**特别注意**：由于本子目标涉及图像生成，请在输出中包含：
- \`imagePrompt\`: 用于生成概念图的详细提示词（英文）
- \`visualDescription\`: 视觉描述（中文，供人类阅读）

示例：
\`\`\`json
{
  "${section}": {
    "characterConcepts": [
      {
        "name": "主角",
        "imagePrompt": "A hero character design...",
        "visualDescription": "勇敢的英雄..."
      }
    ]
  }
}
\`\`\`
` : ""}

确保输出：
1. **格式规范**：标准 JSON 格式，易于程序解析
2. **内容详实**：提供足够的细节和参考信息
3. **可执行性强**：便于美术、程序、音频团队直接使用
4. **行业标准**：符合游戏行业的专业标准

${goal.validationCriteria && goal.validationCriteria.length > 0 ? `
**验证标准**（必须在输出中体现）：
${goal.validationCriteria.map(c => `- ${c}`).join("\n")}
` : ""}
    `.trim();
  }

  /**
   * 总结 GDD 内容
   */
  private summarizeGDD(gdd: any): any {
    const summary: any = {};

    if (gdd.sandbox && Object.keys(gdd.sandbox).length > 0) {
      summary.sandbox = Object.keys(gdd.sandbox).map(key => ({
        section: key,
        hasContent: !!gdd.sandbox[key],
      }));
    }

    if (gdd.interface && Object.keys(gdd.interface).length > 0) {
      summary.interface = Object.keys(gdd.interface).map(key => ({
        section: key,
        hasContent: !!gdd.interface[key],
      }));
    }

    return summary;
  }
}

export const dynamicPromptGenerator = new DynamicPromptGenerator();
