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
	type GameGenre,
	type JsonValue,
	MessageType,
	type PlanningFocusConfig,
	type StageConfig,
	type UserInput,
} from "../../types";

// 导入服务
import { LLMService } from "../../services/LLMService";
import { resolveModelRuntime } from "../../config/agentModels";
import { taskStateManager } from "../../services/TaskStateManager";

interface PlanningUserInputPayload {
	userInput: UserInput;
	stageConfig?: StageConfig;
	[key: string]: unknown;
}

interface FeedbackPayload {
	type?: string;
	notes?: string;
	[key: string]: unknown;
}

interface ControlMessagePayload {
	action?: "pause" | "resume" | "abort";
	notes?: string;
	updates?: {
		stageConfig?: {
			overrides?: Partial<UserInput>;
		};
	};
	[key: string]: unknown;
}

// 导入服务
import { knowledgeBaseService } from "../../services/KnowledgeBaseService";
import { mem0Service } from "../../services/Mem0Service";
import { GDDMarkdownService } from "../../services/GDDMarkdownService";

const DEFAULT_GENRE: GameGenre = "rpg";

function resolvePrimaryGenre(userInput?: UserInput): GameGenre {
	return (
		(userInput?.gameGenre?.primary as GameGenre | undefined) ??
		(userInput?.gameType as GameGenre | undefined) ??
		DEFAULT_GENRE
	);
}

function resolveSubGenre(userInput?: UserInput) {
	return userInput?.gameGenre?.subGenre;
}

function resolveHybridGenres(userInput?: UserInput): GameGenre[] {
	return userInput?.gameGenre?.hybrid ?? [];
}

// AI模型调用类 - 使用配置系统
class AIModel {
	async generateGDD(
		userInput: UserInput,
		agentMeta?: StageConfig['agentMeta'],
	): Promise<Partial<GDD>> {
		console.log("[模型调用] 生成游戏设计文档");
		const primaryGenre = resolvePrimaryGenre(userInput);
		const subGenre = resolveSubGenre(userInput);
		const hybridGenres = resolveHybridGenres(userInput);

		// 根据agentMeta调整生成策略
		if (agentMeta?.specialization) {
			console.log(
				`[模型提示] 策划专精于 ${agentMeta.specialization} 类型游戏设计`,
			);
		}
		if (agentMeta?.extraTraits) {
			console.log(
				`[模型提示] 额外专长: ${agentMeta.extraTraits}`,
			);
		}

		const codeExamples = await knowledgeBaseService.searchCodeExamples(
			primaryGenre.toUpperCase(),
		);
		console.log(
			`从知识库获取了 ${codeExamples.length} 个游戏类型 ${primaryGenre} 的代码示例`,
		);

		const designKnowledge = await knowledgeBaseService.searchByKeyword(
			`${primaryGenre}设计 ${userInput.dimension}游戏设计 ${userInput.artStyle}风格设计`,
		);
		console.log(`获取了 ${designKnowledge.length} 条 ${primaryGenre} 设计知识`);

		const gameTypeConfig: Record<
			string,
			{
				gameplayMechanics: Array<{
					name: string;
					description: string;
					implementationDetails: string;
				}>;
				engine: string;
			}
		> = {
			rpg: {
				gameplayMechanics: [
					{
						name: "角色成长",
						description: "玩家角色通过经验值升级，提升属性",
						implementationDetails: "设计属性系统、技能树、装备系统",
					},
					{
						name: "任务系统",
						description: "主线和支线任务推动剧情发展",
						implementationDetails: "创建任务管理器、任务状态跟踪、奖励系统",
					},
					{
						name: "探索玩法",
						description: "开放世界或关卡式探索",
						implementationDetails: "设计地图系统、区域解锁、隐藏内容",
					},
				],
				engine: userInput.dimension === "3d" ? "Unity" : "Godot",
			},
			slg: {
				gameplayMechanics: [
					{
						name: "资源管理",
						description: "收集和管理各类资源",
						implementationDetails: "设计资源系统、生产建筑、储存机制",
					},
					{
						name: "建筑升级",
						description: "建造和升级各种功能性建筑",
						implementationDetails: "创建建筑系统、升级树、建筑效果",
					},
					{
						name: "战略战斗",
						description: "军队指挥和战斗策略",
						implementationDetails: "设计战斗系统、兵种克制、阵型系统",
					},
				],
				engine: userInput.dimension === "3d" ? "Unity" : "PixiJS",
			},
			shooter: {
				gameplayMechanics: [
					{
						name: "射击机制",
						description: "精确的射击系统",
						implementationDetails: "设计弹道系统、后坐力、瞄准机制",
					},
					{
						name: "武器系统",
						description: "多样化的武器选择",
						implementationDetails: "创建武器属性、配件系统、弹药管理",
					},
					{
						name: "移动机制",
						description: "流畅的移动和掩体互动",
						implementationDetails: "设计角色移动、冲刺、蹲伏、掩体系统",
					},
				],
				engine: "Unity",
			},
			moba: {
				gameplayMechanics: [
					{
						name: "英雄系统",
						description: "选择不同技能和特性的英雄",
						implementationDetails: "设计英雄平衡、技能系统、成长曲线",
					},
					{
						name: "地图控制",
						description: "控制地图上的关键位置和资源",
						implementationDetails: "创建地图系统、视野机制、资源点",
					},
					{
						name: "团队对抗",
						description: "5v5或类似的团队战斗",
						implementationDetails: "设计战斗系统、胜利条件、匹配机制",
					},
				],
				engine: "Unity",
			},
			act: {
				gameplayMechanics: [
					{
						name: "动作连招",
						description: "高自由度的动作组合与反馈",
						implementationDetails: "设计连击表、硬直、精力资源",
					},
					{
						name: "敌人AI",
						description: "多样敌人行为与攻击模式",
						implementationDetails: "构建行为树、弱点系统、boss阶段",
					},
					{
						name: "场景交互",
						description: "利用场景机制增强动作体验",
						implementationDetails: "设计陷阱、互动物件、攀爬跳跃",
					},
				],
				engine: "Unity",
			},
			avg: {
				gameplayMechanics: [
					{
						name: "分支剧情",
						description: "多结局与分支选择",
						implementationDetails: "制作剧情树、好感度或分歧记录",
					},
					{
						name: "解谜互动",
						description: "场景互动或轻度解谜",
						implementationDetails: "设计交互点、证据管理、线索推理",
					},
					{
						name: "演出系统",
						description: "文本、立绘、语音的演出节奏",
						implementationDetails: "实现文本引擎、立绘切换、CV触发",
					},
				],
				engine: "Godot",
			},
			sim: {
				gameplayMechanics: [
					{
						name: "模拟循环",
						description: "真实或抽象的模拟系统",
						implementationDetails: "搭建核心模拟公式、参数校准",
					},
					{
						name: "管理自动化",
						description: "宏观管理或自动化玩法",
						implementationDetails: "设计建造、升级、生产链路",
					},
					{
						name: "事件系统",
						description: "随机事件或角色互动",
						implementationDetails: "构建事件池、角色需求、奖励惩罚",
					},
				],
				engine: "Godot",
			},
			ftg: {
				gameplayMechanics: [
					{
						name: "格斗系统",
						description: "帧数、判定、连段",
						implementationDetails: "设计帧表、优先级、输入缓冲",
					},
					{
						name: "角色差异",
						description: "角色定位与能力平衡",
						implementationDetails: "定义招式、强弱势、克制关系",
					},
					{
						name: "竞技模式",
						description: "本地/在线对战与训练",
						implementationDetails: "匹配机制、排行榜、教程模式",
					},
				],
				engine: "Unity",
			},
			rac: {
				gameplayMechanics: [
					{
						name: "驾驶体验",
						description: "物理与操控感",
						implementationDetails: "调校车辆物理、输入平衡、辅助系统",
					},
					{
						name: "赛道设计",
						description: "多样赛道与环境反馈",
						implementationDetails: "构建赛道编辑、动态天气、捷径",
					},
					{
						name: "竞速循环",
						description: "排行、升级、车辆收集",
						implementationDetails: "设计赛事解锁、车辆成长、奖励表",
					},
				],
				engine: "Unity",
			},
			sandbox: {
				gameplayMechanics: [
					{
						name: "开放世界",
						description: "自由探索与交互",
						implementationDetails: "构建模块化地图、事件系统",
					},
					{
						name: "建造创造",
						description: "玩家创造或修改世界",
						implementationDetails: "设计建造系统、资源约束、分享机制",
					},
					{
						name: "自治系统",
						description: "沙盒系统相互作用",
						implementationDetails: "实现生态循环、NPC行为、物理互动",
					},
				],
				engine: "Unity",
			},
			survival: {
				gameplayMechanics: [
					{
						name: "生存循环",
						description: "饥饿、健康、气候等生存指标",
						implementationDetails: "设计状态条、资源消耗、风险系统",
					},
					{
						name: "制作系统",
						description: "采集、合成、建造",
						implementationDetails: "配方系统、装备耐久、建造树",
					},
					{
						name: "威胁管理",
						description: "敌对生物或环境威胁",
						implementationDetails: "AI巡逻、事件驱动、难度曲线",
					},
				],
				engine: "Unity",
			},
			card: {
				gameplayMechanics: [
					{
						name: "卡牌循环",
						description: "抽牌、出牌、资源管理",
						implementationDetails: "构建卡牌池、能源系统、随机事件",
					},
					{
						name: "卡组构建",
						description: "卡组管理与成长",
						implementationDetails: "解锁卡牌、合成、元游戏 progression",
					},
					{
						name: "战斗规则",
						description: "PVE或PVP对战规则",
						implementationDetails: "设计胜负条件、回合结构、AI对手",
					},
				],
				engine: "Godot",
			},
			casual: {
				gameplayMechanics: [
					{
						name: "简单上手",
						description: "易于理解的游戏机制",
						implementationDetails: "设计简洁界面、简单规则、教程",
					},
					{
						name: "短期体验",
						description: "适合短时间游玩",
						implementationDetails: "创建快速匹配、简短关卡、自动保存",
					},
					{
						name: "轻松氛围",
						description: "愉快的游戏体验",
						implementationDetails: "设计简单音效、愉快视觉效果",
					},
				],
				engine: userInput.dimension === "3d" ? "Unity" : "PixiJS",
			},
			puzzle: {
				gameplayMechanics: [
					{
						name: "核心解谜机制",
						description: "游戏的主要解谜玩法",
						implementationDetails: "设计解谜逻辑、难度递增、提示系统",
					},
					{
						name: "关卡设计",
						description: "多样化的谜题设计",
						implementationDetails: "创建关卡编辑器、答案验证系统",
					},
					{
						name: "进度系统",
						description: "玩家的解谜进度",
						implementationDetails: "设计关卡解锁、进度保存",
					},
				],
				engine: userInput.dimension === "3d" ? "Unity" : "PixiJS",
			},
			rhythm: {
				gameplayMechanics: [
					{
						name: "谱面系统",
						description: "节奏与判定",
						implementationDetails: "制作谱面格式、判定窗口、同步逻辑",
					},
					{
						name: "反馈演出",
						description: "视觉/音频反馈",
						implementationDetails: "设计特效、音频时间轴、combo效果",
					},
					{
						name: "曲目/难度",
						description: "多难度与曲库成长",
						implementationDetails: "曲目解锁、难度调整、排行榜",
					},
				],
				engine: "Godot",
			},
			horror: {
				gameplayMechanics: [
					{
						name: "紧张氛围",
						description: "灯光、音效、脚本事件营造恐怖",
						implementationDetails: "场景事件触发、声音设计、视觉特效",
					},
					{
						name: "资源匮乏",
						description: "有限资源下的抉择",
						implementationDetails: "设计稀缺资源、背包限制、制作系统",
					},
					{
						name: "敌人/心理",
						description: "敌人追踪或心理恐惧",
						implementationDetails: "AI追逐、心理值系统、幻觉事件",
					},
				],
				engine: "Unity",
			},
			default: {
				gameplayMechanics: [
					{
						name: "基础玩法",
						description: "核心循环与反馈",
						implementationDetails: "设计基础循环与奖励反馈",
					},
					{
						name: "进阶机制",
						description: "增加游戏深度的机制",
						implementationDetails: "设计进阶玩法系统",
					},
				],
				engine: userInput.dimension === "3d" ? "Unity" : "PixiJS",
			},
		};
		gameTypeConfig.fps = gameTypeConfig.shooter;
		gameTypeConfig.sports = gameTypeConfig.sim;
		gameTypeConfig.platformer = gameTypeConfig.act;

		const config = gameTypeConfig[primaryGenre] || gameTypeConfig.default;

		const gddData = {
			coreConcept: `一款${userInput.dimension}的${userInput.artStyle === "realistic" ? "写实风格" : userInput.artStyle === "cartoon" ? "卡通风格" : "像素风格"}${userInput.gameMode === "multiplayer" ? "多人" : "单机"}${this.getGameTypeName(primaryGenre)}游戏`,
			gameType: primaryGenre,
			primaryGenre,
			subGenre: subGenre ?? undefined,
			hybridGenres: hybridGenres.length ? hybridGenres : undefined,
			dimension: userInput.dimension,
			artStyle: userInput.artStyle,
			gameMode: userInput.gameMode,
			gameplayMechanics: config.gameplayMechanics,
			characterDesigns:
				primaryGenre === "rpg"
					? [
							{
								name: "主角",
								type: "player" as const,
								description: "玩家控制的主要角色",
								attributes: { strength: 10, agility: 8, intelligence: 6 },
							},
							{
								name: "NPC向导",
								type: "npc" as const,
								description: "引导玩家的重要NPC",
								attributes: {},
							},
							{
								name: "第一个BOSS",
								type: "boss" as const,
								description: "游戏中的第一个主要挑战",
								attributes: { strength: 25, health: 200 },
							},
						]
					: undefined,
			artRequirements: [
				{
					type: "character" as const,
					description: `玩家角色，${userInput.artStyle}风格`,
					quantity: 1,
					priority: "high" as const,
				},
				{
					type: "environment" as const,
					description: `游戏主场景，${userInput.artStyle}风格`,
					quantity: 1,
					priority: "high" as const,
				},
				{
					type: "ui" as const,
					description: `游戏界面元素，${userInput.artStyle}风格`,
					quantity: 10,
					priority: "medium" as const,
				},
			],
			audioRequirements: [
				{
					type: "bgm" as const,
					description: "主菜单背景音乐",
					quantity: 1,
					priority: "high" as const,
				},
				{
					type: "bgm" as const,
					description: `游戏中背景音乐，根据${primaryGenre}风格创作`,
					quantity: 2,
					priority: "medium" as const,
				},
				{
					type: "sfx" as const,
					description: "基础游戏音效",
					quantity: 10,
					priority: "medium" as const,
				},
			],
			technicalRequirements: {
				engine: config.engine,
				targetPlatforms: [
					"PC",
					userInput.gameMode === "multiplayer" ? "Online" : "Offline",
				],
			},
		};

		await mem0Service.saveMemory(
			"system",
			"planning_guidelines",
			`为游戏类型 ${gddData.primaryGenre ?? gddData.gameType} 设计的核心概念和玩法机制`,
			"design",
			"high",
			{
				gameType: gddData.primaryGenre ?? gddData.gameType,
				dimension: gddData.dimension,
				artStyle: gddData.artStyle,
				conceptLength: gddData.coreConcept.length,
				mechanicsCount: gddData.gameplayMechanics.length,
			},
		);

		return gddData;
	}

	getGameTypeName(type: string): string {
		const names: { [key: string]: string } = {
			rpg: "角色扮演",
			slg: "策略",
			shooter: "射击",
			moba: "多人在线战术竞技",
			act: "动作冒险",
			avg: "冒险/视觉小说",
			sim: "模拟经营",
			ftg: "格斗",
			rac: "竞速",
			sandbox: "沙盒",
			survival: "生存",
			card: "卡牌",
			casual: "休闲",
			puzzle: "益智",
			rhythm: "音乐节奏",
			horror: "恐怖",
			platformer: "平台跳跃",
			sports: "体育竞技",
		};
		return names[type] || type;
	}

	async optimizeGDD(gdd: GDD, feedback: FeedbackPayload): Promise<GDD> {
		console.log("[模型调用] 根据反馈优化游戏设计文档");

		// 搜索知识库获取优化相关知识
		const optimizationKnowledge = await knowledgeBaseService.searchByKeyword(
			`${gdd.primaryGenre ?? gdd.gameType}游戏优化`,
		);
		console.log(`获取了 ${optimizationKnowledge.length} 条优化相关知识`);

		// 这里是模拟的GDD优化逻辑
		const optimizedGDD = {
			...gdd,
			gameplayMechanics: gdd.gameplayMechanics.map((mechanic) => ({
				...mechanic,
				implementationDetails: `${mechanic.implementationDetails} [已根据反馈优化]`,
			})),
			updatedAt: new Date().toISOString(),
		};

		// 保存优化经验到Mem0
		await mem0Service.saveMemory(
			"system",
			"optimization_guidelines",
			`针对 ${gdd.primaryGenre ?? gdd.gameType} 类型游戏的优化经验`,
			"design",
			"medium",
			{
				gameType: gdd.primaryGenre ?? gdd.gameType,
				feedbackType: feedback.type || "",
				optimizationTime: optimizedGDD.updatedAt,
			},
		);

		return optimizedGDD;
	}

	/**
	 * 生成 Markdown 格式的 GDD
	 * 这是新的主要生成方法，返回 Markdown 格式
	 */
	async generateGDDMarkdown(
		userInput: UserInput,
		agentMeta?: StageConfig['agentMeta'],
		planningFocus?: PlanningFocusConfig,
		stageConfig?: StageConfig,
	): Promise<string> {
		console.log("[模型调用] 生成 Markdown 格式的游戏设计文档");

		// 获取模型配置
		const modelConfig = resolveModelRuntime("planning", stageConfig);
		console.log(`[配置] Provider: ${modelConfig.provider}, Model: ${modelConfig.model}`);
		console.log(`[配置] Endpoint: ${modelConfig.endpoint}`);

		const primaryGenre = resolvePrimaryGenre(userInput);
		const subGenre = resolveSubGenre(userInput);

		// 读取示例模板作为参考
		const examplePath = path.resolve("./src/templates/gdd-example.md");
		let exampleGDD = "";
		if (fs.existsSync(examplePath)) {
			exampleGDD = fs.readFileSync(examplePath, "utf-8");
		}

		// 构建提示词
		let specializationPrompt = "";
		if (agentMeta?.specialization) {
			specializationPrompt = `\n你专精于 ${agentMeta.specialization} 类型的游戏设计。`;
		}
		if (agentMeta?.extraTraits) {
			specializationPrompt += `\n你的额外专长包括：${agentMeta.extraTraits}。`;
		}

		let focusPrompt = "";
		if (planningFocus) {
			const focuses: string[] = [];
			if (planningFocus.narrative) focuses.push("叙事设计（详细的故事节拍和角色弧光）");
			if (planningFocus.numeric) focuses.push("数值设计（详细的成长曲线和战斗公式）");
			if (planningFocus.levelDesign) focuses.push("关卡设计（详细的关卡结构和难度曲线）");
			if (planningFocus.systemDesign) {
				const systems: string[] = [];
				if (planningFocus.systemDesign.growth) systems.push("成长系统");
				if (planningFocus.systemDesign.equipment) systems.push("装备系统");
				if (planningFocus.systemDesign.combat) systems.push("战斗系统");
				if (planningFocus.systemDesign.social) systems.push("社交系统");
				if (systems.length > 0) {
					focuses.push(`系统设计（重点：${systems.join("、")}）`);
				}
			}
			if (focuses.length > 0) {
				focusPrompt = `\n\n本次设计需要重点关注以下方面：\n${focuses.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
			}
		}

		const prompt = `你是一位资深的游戏策划专家，擅长设计各类游戏的核心玩法和系统架构。${specializationPrompt}

请根据以下用户需求，生成一份完整的游戏设计文档（GDD），以 **Markdown 格式** 输出。

## 用户需求

- **项目名称**: ${userInput.projectName || "待定"}
- **游戏类型**: ${primaryGenre}${subGenre ? ` (${subGenre})` : ""}
- **游戏维度**: ${userInput.dimension}
- **美术风格**: ${userInput.artStyle}
- **游戏模式**: ${userInput.gameMode}
- **附加需求**: ${userInput.additionalRequirements || "无"}
${focusPrompt}

## 输出要求

1. **格式**: 使用 Markdown 格式，包含 YAML frontmatter（元数据）
2. **结构**: 参考以下示例文档的结构和格式
3. **内容深度**: 提供详细的设计细节，包括：
   - 核心概念和独特卖点
   - 详细的玩法机制（包含实现细节）
   - 角色设计（主角、NPC、敌人）
   - 关卡/世界设计
   - UI/UX 设计
   - 美术和音频需求（使用表格）
   - 技术需求和规格
4. **专业性**: 确保设计的合理性、可实现性和趣味性
5. **表格和格式**: 适当使用 Markdown 表格、代码块、列表等格式增强可读性

## 参考示例

以下是一个完整的 GDD Markdown 示例，请参考其格式和结构：

\`\`\`markdown
${exampleGDD}
\`\`\`

## 开始生成

请基于上述需求和示例，生成一份完整的游戏设计文档。确保：
1. 开头包含 YAML frontmatter（---包裹的元数据）
2. 结构清晰，章节完整
3. 内容详实，具有可执行性
4. 格式规范，易于阅读

直接输出 Markdown 内容，不要添加额外的解释：`;

		// 调用真实的 AI API 生成 Markdown
		console.log(`[LLM调用] 使用模型 ${modelConfig.model} 生成游戏设计文档`);

		try {
			const response = await LLMService.chat(
				[
					{
						role: "user",
						content: prompt,
					},
				],
				{
					provider: modelConfig.provider,
					model: modelConfig.model,
					endpoint: modelConfig.endpoint,
					apiKey: modelConfig.apiKey,
					maxTokens: (modelConfig.extra.max_tokens as number) || 8000,
					temperature: (modelConfig.extra.temperature as number) || 0.7,
					extra: modelConfig.extra,
				},
			);

			console.log(`[LLM成功] 生成了 ${response.content.length} 字符的GDD文档`);
			if (response.usage) {
				console.log(`[Token使用] 输入: ${response.usage.promptTokens}, 输出: ${response.usage.completionTokens}, 总计: ${response.usage.totalTokens}`);
			}

			return response.content;
		} catch (error) {
			console.error("[LLM错误] 调用失败，回退到模拟生成:", error);
			console.log("[提示] 请检查API密钥配置和网络连接");

			// 如果API调用失败，回退到模拟生成
			const markdown = this.generateMockMarkdown(userInput, agentMeta, planningFocus);
			return markdown;
		}
	}

	/**
	 * 模拟生成 Markdown（用于开发测试）
	 * 生产环境应该调用真实的 AI API
	 */
	private generateMockMarkdown(
		userInput: UserInput,
		agentMeta?: StageConfig['agentMeta'],
		planningFocus?: PlanningFocusConfig,
	): string {
		const primaryGenre = resolvePrimaryGenre(userInput);
		const subGenre = resolveSubGenre(userInput);
		const projectName = userInput.projectName || `${primaryGenre}游戏项目`;
		const now = new Date().toISOString();

		let markdown = `---
projectId: "auto-generated"
projectName: "${projectName}"
gameType: "${primaryGenre}"
primaryGenre: "${primaryGenre}"
${subGenre ? `subGenre: "${subGenre}"` : ''}
dimension: "${userInput.dimension}"
artStyle: "${userInput.artStyle}"
gameMode: "${userInput.gameMode}"
createdAt: "${now}"
updatedAt: "${now}"
---

# 游戏设计文档 (Game Design Document)

**项目名称**: ${projectName}
**游戏类型**: ${primaryGenre}${subGenre ? ` (${subGenre})` : ''}
**目标平台**: PC, Console
**创建日期**: ${new Date().toLocaleDateString('zh-CN')}

---

## 1. 核心概念 (Core Concept)

本游戏是一款${userInput.dimension}${primaryGenre}游戏，采用${userInput.artStyle}美术风格。
${userInput.additionalRequirements || '提供独特的游戏体验。'}

### 1.1 游戏类型
- **主要类型**: ${primaryGenre}
${subGenre ? `- **次要类型**: ${subGenre}` : ''}

### 1.2 美术风格
- **维度**: ${userInput.dimension}
- **美术风格**: ${userInput.artStyle}
- **游戏模式**: ${userInput.gameMode}

---

## 2. 核心玩法机制 (Gameplay Mechanics)

`;

		// 根据游戏类型添加机制
		const gameTypeConfig = this.getGameTypeConfig(primaryGenre, userInput);
		gameTypeConfig.gameplayMechanics.forEach((mechanic, idx) => {
			markdown += `### 2.${idx + 1} ${mechanic.name}

**描述**: ${mechanic.description}

**实现细节**:
${mechanic.implementationDetails}

---

`;
		});

		// 添加美术需求
		markdown += `## 6. 美术需求 (Art Requirements)

| 类型 | 描述 | 数量 | 优先级 |
|------|------|------|--------|
| character | 主角和主要角色 | 3 | high |
| character | NPC角色 | 5 | medium |
| environment | 场景资源 | 3 | high |
| ui | UI图标和界面 | 20 | medium |

---

`;

		// 添加音频需求
		markdown += `## 7. 音频需求 (Audio Requirements)

| 类型 | 描述 | 数量 | 优先级 |
|------|------|------|--------|
| bgm | 背景音乐 | 5 | high |
| sfx | 音效 | 15 | medium |

---

`;

		// 添加技术需求
		markdown += `## 8. 技术需求 (Technical Requirements)

**游戏引擎**: ${gameTypeConfig.engine}
**目标平台**: PC, Console
**性能要求**: 60 FPS @ 1080p

---

`;

		// 根据 planningFocus 添加额外章节
		if (planningFocus?.narrative) {
			markdown += `## 9. 故事节拍 (Story Beats)

### Act 1: 开始

游戏的起始阶段，介绍主角和世界观。

### Act 2: 发展

剧情逐渐深入，玩家面临更大挑战。

### Act 3: 高潮

最终决战和故事结局。

---

`;
		}

		if (planningFocus?.numeric) {
			markdown += `## 10. 数值设计 (Numeric Models)

### 10.1 角色成长系统

**关键指标**: 经验值曲线, 属性成长

**公式**:
\`\`\`
EXP(level) = 100 * level^1.5
HP(level) = 100 + 10 * level
\`\`\`

---

`;
		}

		markdown += `## 附录 (Appendix)

### 文档元数据
- **生成方式**: Planning Agent (AI-assisted)
- **最后更新**: ${now}

---

*本文档由 my-agent-test Planning Agent 生成*
`;

		return markdown;
	}

	/**
	 * 获取游戏类型配置（复用现有逻辑）
	 */
	private getGameTypeConfig(genre: GameGenre, userInput: UserInput): {
		gameplayMechanics: Array<{
			name: string;
			description: string;
			implementationDetails: string;
		}>;
		engine: string;
	} {
		const configs: Record<string, {
			gameplayMechanics: Array<{
				name: string;
				description: string;
				implementationDetails: string;
			}>;
			engine: string;
		}> = {
			rpg: {
				gameplayMechanics: [
					{
						name: "角色成长",
						description: "玩家角色通过经验值升级，提升属性",
						implementationDetails: "设计属性系统、技能树、装备系统",
					},
					{
						name: "任务系统",
						description: "主线和支线任务推动剧情发展",
						implementationDetails: "创建任务管理器、任务状态跟踪、奖励系统",
					},
				],
				engine: userInput.dimension === "3d" ? "Unity" : "Godot",
			},
			shooter: {
				gameplayMechanics: [
					{
						name: "射击机制",
						description: "精确的射击系统",
						implementationDetails: "设计弹道系统、后坐力、瞄准机制",
					},
				],
				engine: userInput.dimension === "3d" ? "Unreal Engine" : "Godot",
			},
		};

		return configs[genre] || configs.rpg;
	}
}

// Planning Agent类
class PlanningAgent {
	private ws: WebSocket | null = null;
	private aiModel: AIModel;
	private agentId = "planning-agent";
	private serverUrl: string;
	private pausedProjects: Set<string> = new Set();
	private stageContexts: Map<
		string,
		{ userInput: UserInput; stageConfig?: StageConfig }
	> = new Map();

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
			content: { action: "register", name: "策划Agent", version: "1.0.0" },
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
				case MessageType.USER_INPUT: {
					const payload = data.content as PlanningUserInputPayload;
					await this.processUserInput(
						data.projectId,
						payload.userInput,
						payload.stageConfig,
					);
					break;
				}

				case MessageType.FEEDBACK:
					await this.processFeedback(
						data.projectId,
						data.content as FeedbackPayload,
					);
					break;

				case MessageType.CONTROL:
					await this.handleControlMessage(
						data.projectId,
						data.content as ControlMessagePayload,
					);
					break;

				case MessageType.STATUS_UPDATE:
					this.handleStatusUpdate(data.content);
					break;

				default:
					console.log(`未知消息类型: ${data.type}`);
			}
		} catch (error) {
			console.error("处理消息失败:", error);
		}
	}

	// 处理用户输入
	private async processUserInput(
		projectId: string,
		userInput: UserInput,
		stageConfig?: StageConfig,
	) {
		console.log(`开始处理项目 ${projectId} 的用户输入`);
		this.stageContexts.set(projectId, { userInput, stageConfig });

		// 获取任务状态（如果存在）
		const task = taskStateManager.getTaskByProjectId(projectId);
		const primaryGenre = resolvePrimaryGenre(userInput);

		// 进度：10% - 开始处理
		if (task) {
			taskStateManager.updateTaskProgress(task.taskId, 10);
		}

		// 从agentMeta获取策划agent的专业方向和额外特点
		const agentMeta = stageConfig?.agentMeta;
		if (agentMeta) {
			console.log(`策划Agent专业方向: ${agentMeta.specialization || '通用'}`);
			if (agentMeta.extraTraits) {
				console.log(`额外特点: ${agentMeta.extraTraits}`);
			}
		}

		// 搜索知识库获取相关信息（结合specialization）
		const searchKeywords = [
			primaryGenre,
			userInput.dimension,
			'游戏设计',
			agentMeta?.specialization,
		]
			.filter(Boolean)
			.join(' ');
		const knowledgeResults = await knowledgeBaseService.searchByKeyword(searchKeywords);

		console.log(`获取到 ${knowledgeResults.length} 条知识库结果`);

		// 进度：30% - 知识库搜索完成
		if (task) {
			taskStateManager.updateTaskProgress(task.taskId, 30);
		}

		// 🔥 新方式：生成 Markdown 格式的 GDD
		console.log("🔥 使用新的 Markdown 格式生成 GDD");
		const gddMarkdown = await this.aiModel.generateGDDMarkdown(
			userInput,
			agentMeta,
			stageConfig?.planningFocus,
			stageConfig, // 传递 stageConfig 以获取模型配置
		);

		// 进度：70% - GDD生成完成
		if (task) {
			taskStateManager.updateTaskProgress(task.taskId, 70);
		}

		// 从 Markdown 提取结构化数据（用于向后兼容）
		const gddData = GDDMarkdownService.extractStructuredData(gddMarkdown);

		// 构建完整的 GDD 对象
		let gdd: Partial<GDD> = {
			projectId,
			projectName: userInput.projectName || `游戏项目_${projectId.slice(0, 8)}`,
			...gddData,
			gameType: resolvePrimaryGenre(userInput),
			primaryGenre: resolvePrimaryGenre(userInput),
			subGenre: resolveSubGenre(userInput),
			dimension: userInput.dimension,
			artStyle: userInput.artStyle,
			gameMode: userInput.gameMode,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		// 保存为 Markdown 格式（主存储格式）
		await GDDMarkdownService.saveGDD(projectId, gdd, gddMarkdown);
		console.log(`✅ GDD 已保存为 Markdown 格式: ./data/projects/${projectId}/gdd.md`);

		// 进度：90% - GDD保存完成
		if (task) {
			taskStateManager.updateTaskProgress(task.taskId, 90);
		}

		// 保存到Mem0（重要信息）
		await mem0Service.saveMemory(
			"system",
			projectId,
			`生成了游戏设计文档(GDD)，核心概念：${gdd.coreConcept || '创新游戏设计'}`,
			"design",
			"high",
			{
				coreConcept: gdd.coreConcept || "",
				keyMechanics: (gdd.gameplayMechanics?.map((m) => m.name) || []) as unknown as JsonValue,
				createdAt: gdd.createdAt || "",
			},
		);

		if (this.pausedProjects.has(projectId)) {
			this.sendCheckpoint(projectId, gdd as GDD);
			return;
		}

		// 发送GDD更新消息
		this.sendGDDUpdate(projectId, gdd as GDD);
		this.sendArtifactUpdate(projectId, gdd as GDD);

		// 进度：100% - 全部完成
		if (task) {
			taskStateManager.updateTaskProgress(task.taskId, 100);
		}

		console.log(`项目 ${projectId} 的GDD生成完成`);
	}
	private applyPlanningFocus(
		gdd: GDD,
		focus?: PlanningFocusConfig,
		userInput?: UserInput,
	): GDD {
		if (!focus) {
			return gdd;
		}

		const next: GDD = { ...gdd };

		if (focus.narrative) {
			next.storyBeats = this.buildNarrativeOutline(userInput);
		}

		if (focus.numeric) {
			next.numericModels = this.buildNumericModels(userInput);
		}

		if (focus.levelDesign) {
			const blueprints = this.buildLevelBlueprints(userInput);
			next.levelDesigns = [...(next.levelDesigns ?? []), ...blueprints];
		}

		if (focus.systemDesign) {
			const systemDesigns = this.buildSystemDesigns(
				focus.systemDesign,
				userInput,
			);
			if (systemDesigns.length > 0) {
				next.systemDesigns = [...(next.systemDesigns ?? []), ...systemDesigns];
			}
		}

		return next;
	}

	private buildNarrativeOutline(userInput?: UserInput) {
		const hero = userInput?.projectName || "主角";
		const genre = resolvePrimaryGenre(userInput);
		return [
			{
				act: "序章",
				summary: `${hero} 被卷入 ${genre || "冒险"} 的核心冲突，玩家了解世界规则。`,
			},
			{
				act: "发展",
				summary: "逐步解锁关键角色与场景，做出影响阵营或资源的选择。",
			},
			{
				act: "高潮",
				summary: "玩家面临重大抉择或Boss战，决定世界或团队的命运。",
			},
		];
	}

	private buildNumericModels(userInput?: UserInput) {
		const genre = resolvePrimaryGenre(userInput);
		return [
			{
				system: "经济/资源平衡",
				metrics: ["资源产出", "资源消耗", "成长曲线"],
				notes: `针对 ${genre ?? "游戏"} 设计的经济模型，确保中后期挑战`,
			},
			{
				system: "难度调优",
				metrics: ["敌人强度", "关卡通过率", "平均会话长度"],
				notes: "根据测试数据动态调整，以防止难度陡增或过于平坦。",
			},
		];
	}

	private buildLevelBlueprints(userInput?: UserInput) {
		const genre = resolvePrimaryGenre(userInput);
		return [
			{
				name: "引导关卡",
				description: "教授基础操控与核心循环。",
				objectives: ["学习移动/战斗", "掌握主要交互", "给出阶段性奖励"],
			},
			{
				name: "核心体验关",
				description: `突出 ${genre ?? "游戏"} 的独特机制。`,
				objectives: ["引入主要敌人或解密", "检验玩家对系统的理解"],
			},
		];
	}

	private buildSystemDesigns(
		systemFocus: PlanningFocusConfig["systemDesign"],
		userInput?: UserInput,
	) {
		if (!systemFocus) return [];
		const systems = [];
		if (systemFocus.growth) {
			systems.push({
				name: "角色成长系统",
				description: "经验、天赋或技能树驱动的能力提升。",
				components: ["经验获取", "属性加点", "突破/觉醒机制"],
			});
		}
		if (systemFocus.equipment) {
			systems.push({
				name: "装备循环",
				description: "装备掉落、强化与稀有度体系。",
				components: ["装备品质", "强化/洗练", "套装或羁绊效果"],
			});
		}
		if (systemFocus.social) {
			systems.push({
				name: "社交/公会系统",
				description: "支持合作、交易或异步互动的功能。",
				components: ["公会目标", "好友协助", "异步支援/排行榜"],
			});
		}
		if (systemFocus.combat) {
			systems.push({
				name: "战斗循环",
				description: `强调 ${resolvePrimaryGenre(userInput) ?? "游戏"} 的战斗节奏与反馈。`,
				components: ["技能冷却", "资源管理", "AI行为/难度阶梯"],
			});
		}
		return systems;
	}

	// 处理反馈
	private async processFeedback(projectId: string, feedback: FeedbackPayload) {
		console.log(`收到项目 ${projectId} 的反馈，开始优化`);

		// 读取现有GDD
		const gddPath = path.resolve(`./data/projects/${projectId}/gdd.json`);
		if (!fs.existsSync(gddPath)) {
			console.error("找不到GDD文件");
			return;
		}

		const gdd = fs.readJSONSync(gddPath) as GDD;

		// 优化GDD
		const optimizedGDD = await this.aiModel.optimizeGDD(gdd, feedback);

		// 保存优化后的GDD
		fs.writeJSONSync(gddPath, optimizedGDD, { spaces: 2 });

		// 更新Mem0
		await mem0Service.saveMemory(
			"system",
			projectId,
			"优化了游戏设计文档(GDD)，根据反馈进行了修正",
			"design",
			"high",
			{
				updatedAt: optimizedGDD.updatedAt,
				feedbackCount: 1,
			},
		);

		if (this.pausedProjects.has(projectId)) {
			this.sendCheckpoint(projectId, optimizedGDD, feedback?.notes);
			return;
		}

		// 发送更新后的GDD
		this.sendGDDUpdate(projectId, optimizedGDD);
		this.sendArtifactUpdate(projectId, optimizedGDD);

		console.log(`项目 ${projectId} 的GDD优化完成`);
	}

	// 处理状态更新
	private handleStatusUpdate(content: unknown) {
		console.log("状态更新:", content);
	}

	private async handleControlMessage(
		projectId: string,
		content: ControlMessagePayload,
	) {
		const action = content?.action;
		switch (action) {
			case "pause":
				this.pausedProjects.add(projectId);
				this.sendCheckpoint(
					projectId,
					this.readLatestGDD(projectId),
					content?.notes,
				);
				break;
			case "resume": {
				this.pausedProjects.delete(projectId);
				const ctx = this.stageContexts.get(projectId);
				if (ctx) {
					const overrides = content?.updates?.stageConfig?.overrides;
					const nextInput = overrides
						? { ...ctx.userInput, ...(overrides as Partial<UserInput>) }
						: ctx.userInput;
					await this.processUserInput(projectId, nextInput, ctx.stageConfig);
				}
				break;
			}
			case "abort":
				this.pausedProjects.delete(projectId);
				break;
		}
	}

	private readLatestGDD(projectId: string): GDD | undefined {
		const gddPath = path.resolve(`./data/projects/${projectId}/gdd.json`);
		if (fs.existsSync(gddPath)) {
			return fs.readJSONSync(gddPath) as GDD;
		}
		return undefined;
	}

	private sendCheckpoint(projectId: string, gdd?: GDD, notes?: string) {
		if (!this.ws) return;
		const artifacts: AgentArtifact[] = [];
		const gddPath = path.resolve(`./data/projects/${projectId}/gdd.json`);
		if (fs.existsSync(gddPath)) {
			artifacts.push({
				artifactId: uuidv4(),
				stageId: "planning",
				type: "document",
				format: "gdd.json",
				url: gddPath,
				source: "llm",
				description: "当前GDD",
			});
		}

		const message: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId,
			type: MessageType.ASSET_UPDATE,
			content: {
				stageId: "planning",
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

	private sendArtifactUpdate(projectId: string, gdd: GDD | Partial<GDD>) {
		if (!this.ws) return;

		const gddMdPath = path.resolve(`./data/projects/${projectId}/gdd.md`);
		const gddJsonPath = path.resolve(`./data/projects/${projectId}/gdd.json`);

		const artifacts: AgentArtifact[] = [
			// 主要格式：Markdown
			{
				artifactId: uuidv4(),
				stageId: "planning",
				type: "document",
				format: "gdd.md",
				url: gddMdPath,
				source: "llm",
				description: `${gdd.coreConcept || gdd.projectName || '游戏设计文档'} (Markdown 格式)`,
				metadata: {
					format: "markdown",
					purpose: "human-readable",
					hasYAMLFrontmatter: true,
				},
			},
			// 兼容格式：JSON
			{
				artifactId: uuidv4(),
				stageId: "planning",
				type: "document",
				format: "gdd.json",
				url: gddJsonPath,
				source: "llm",
				description: `${gdd.coreConcept || gdd.projectName || '游戏设计文档'} (JSON 格式 - 向后兼容)`,
				metadata: {
					format: "json",
					purpose: "machine-readable",
				},
			},
		];

		const message: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId,
			type: MessageType.ASSET_UPDATE,
			content: {
				stageId: "planning",
				status: "completed",
				artifacts,
			} as unknown as JsonValue,
			timestamp: new Date().toISOString(),
			requiresAck: true,
		};
		this.ws.send(JSON.stringify(message));
	}

	// 发送GDD更新
	private sendGDDUpdate(projectId: string, gdd: GDD) {
		if (!this.ws) return;

		const message: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId,
			type: MessageType.GDD_UPDATE,
			content: gdd as unknown as JsonValue,
			timestamp: new Date().toISOString(),
			requiresAck: true,
		};

		this.ws.send(JSON.stringify(message));
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

// 启动Planning Agent
console.log("=== Planning Agent 启动 ===");
const agent = new PlanningAgent();
agent.connect();

// 优雅关闭
process.on("SIGTERM", () => {
	console.log("正在关闭Planning Agent...");
	process.exit(0);
});

process.on("SIGINT", () => {
	console.log("正在关闭Planning Agent...");
	process.exit(0);
});
