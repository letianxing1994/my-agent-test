import { v4 as uuidv4 } from "uuid";
import type {
	AgentArtifact,
	ClarificationQuestion,
	GameGenre,
	GameProjectConfig,
	JsonRecord,
	UserInput,
} from "../types";

interface StageSummaryResult {
	summary: string;
	followUps: ClarificationQuestion[];
}

const FUZZY_TOKENS = [
	"随便",
	"差不多",
	"看着办",
	"类似",
	"大概",
	"随意",
	"whatever",
];

function createQuestion(
	category: string,
	content: string,
	stageId?: string,
	context?: JsonRecord,
): ClarificationQuestion {
	return {
		questionId: uuidv4(),
		category,
		question: content,
		stageId,
		context,
		status: "open",
		createdAt: new Date().toISOString(),
	};
}

const DEFAULT_GENRE: GameGenre = "rpg";

function resolvePrimaryGenre(userInput?: UserInput): GameGenre {
	return (
		(userInput?.gameGenre?.primary as GameGenre | undefined) ??
		(userInput?.gameType as GameGenre | undefined) ??
		DEFAULT_GENRE
	);
}

export class InstructionOrchestrator {
	analyzeUserBrief(project: GameProjectConfig): ClarificationQuestion[] {
		const { userInput } = project;
		const questions: ClarificationQuestion[] = [];
		const additional = userInput.additionalRequirements?.trim() || "";
		const primaryGenre = resolvePrimaryGenre(userInput);

		if (!userInput.projectName || userInput.projectName.length < 2) {
			questions.push(
				createQuestion(
					"project_name",
					"请为该项目提供一个更具体的代号或暂定名称，方便团队沟通。",
				),
			);
		}

		if (additional.length < 30) {
			questions.push(
				createQuestion(
					"core_fantasy",
					"能否描述一下玩家的核心体验或玩法循环？例如：核心目标、独特系统、通关方式。",
				),
			);
		}

		if (FUZZY_TOKENS.some((token) => additional.includes(token))) {
			questions.push(
				createQuestion(
					"constraints",
					"关于附加说明中提到的“随意/类似”部分，是否可以列举 1-2 个参考作品或明确禁止/必须的元素？",
				),
			);
		}

		if (userInput.gameMode === "multiplayer") {
			questions.push(
				createQuestion(
					"player_scale",
					"联机模式下期望的同时在线玩家规模、匹配方式或社交功能有哪些要求？",
				),
			);
		}

		if (
			userInput.dimension === "3d" &&
			!project.userInput.resourceFiles?.length
		) {
			questions.push(
				createQuestion(
					"art_references",
					"是否有偏好的 3D 参考资源（角色、场景、镜头）或希望避免的视觉风格？",
				),
			);
		}

		if (
			userInput.gameGenre?.hybrid &&
			userInput.gameGenre.hybrid.length > 0 &&
			userInput.gameGenre.hybrid.length !== 2
		) {
			questions.push(
				createQuestion(
					"hybrid_scope",
					"已选择跨类型玩法，请说明期望的混合方式（例如前期RPG，后期卡牌构筑）？",
				),
			);
		}

		if (primaryGenre === "card" && !additional.includes("卡池")) {
			questions.push(
				createQuestion(
					"card_expectation",
					"卡牌玩法需要的构筑/收集目标是什么？是否有必须出现的卡组主题？",
				),
			);
		}

		return questions;
	}

	summarizeStage(
		stageId: string,
		artifacts: AgentArtifact[],
		status?: string,
	): StageSummaryResult {
		const count = artifacts.length;
		const summary = `[${stageId.toUpperCase()}] 阶段${
			status === "completed" ? "已完成" : "更新"
		}，生成 ${count} 个产物。`;

		const followUps: ClarificationQuestion[] = [];
		if (count === 0 && status === "completed") {
			followUps.push(
				createQuestion(
					`${stageId}_output`,
					`当前 ${stageId} 阶段未产出可用资源，请补充更具体的指导或上传参考素材？`,
					stageId,
				),
			);
		}

		return { summary, followUps };
	}

	mergeAnswers(
		userInput: UserInput,
		answers: Array<{ category?: string; answer: string }>,
	) {
		const base = userInput.additionalRequirements || "";
		const appended = answers
			.map(
				(answer) =>
					`[${answer.category || "clarification"}] ${answer.answer.trim()}`,
			)
			.join("\n");
		return {
			...userInput,
			additionalRequirements: `${base}\n${appended}`.trim(),
		};
	}
}

export const instructionOrchestrator = new InstructionOrchestrator();
