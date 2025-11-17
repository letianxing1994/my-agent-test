import { createWorkflowChain } from "@voltagent/core";
import { z } from "zod";
import { ExecutionMode, GDD, UserInput, UserInputSchema } from "../types";

// ==============================================================================
// 游戏开发工作流
// 支持三种执行模式：顺序执行、异步并行、反馈循环
// ==============================================================================

// 游戏开发工作流输入
export const gameDevWorkflowInput = z.object({
	projectId: z.string(),
	projectName: z.string(),
	userInput: UserInputSchema,
	executionMode: z.enum(["sequential", "async_parallel", "feedback_loop"]),
});

// 游戏开发工作流结果
export const gameDevWorkflowResult = z.object({
	projectId: z.string(),
	status: z.enum(["completed", "failed"]),
	gdd: z.unknown().optional(), // GDD类型
	assets: z.object({
		art: z.array(z.string()),
		music: z.array(z.string()),
		code: z.string(),
	}),
	testReports: z.array(z.string()),
});

// 顺序执行工作流：策划 → 美术 → 音乐 → 技术 → 测试
export const sequentialGameDevWorkflow = createWorkflowChain({
	id: "sequential-game-dev",
	name: "顺序执行游戏开发工作流",
	purpose: "按顺序执行游戏开发的各个阶段，确保依赖正确",
	input: gameDevWorkflowInput,
	result: gameDevWorkflowResult,
})
	// Step 1: 策划阶段 - 生成GDD
	.andThen({
		id: "planning-phase",
		execute: async ({ data }) => {
			console.log(`[工作流] 开始策划阶段 - 项目: ${data.projectName}`);
			// 这里应该调用Planning Agent
			// 实际实现中会通过A2A服务器发送消息给Planning Agent
			return {
				...data,
				phase: "planning",
				gdd: null, // 将由Planning Agent生成
			};
		},
	})
	// Step 2: 美术阶段
	.andThen({
		id: "art-phase",
		execute: async ({ data }) => {
			console.log(`[工作流] 开始美术阶段 - 项目: ${data.projectName}`);
			// 等待GDD完成后，调用Art Agent
			return {
				...data,
				phase: "art",
				assets: { art: [], music: [], code: "" },
			};
		},
	})
	// Step 3: 音乐阶段
	.andThen({
		id: "music-phase",
		execute: async ({ data }) => {
			console.log(`[工作流] 开始音乐阶段 - 项目: ${data.projectName}`);
			// 等待美术完成后，调用Music Agent
			return {
				...data,
				phase: "music",
			};
		},
	})
	// Step 4: 技术阶段
	.andThen({
		id: "tech-phase",
		execute: async ({ data }) => {
			console.log(`[工作流] 开始技术阶段 - 项目: ${data.projectName}`);
			// 等待美术和音乐都完成后，调用Tech Agent
			return {
				...data,
				phase: "tech",
			};
		},
	})
	// Step 5: 测试阶段
	.andThen({
		id: "test-phase",
		execute: async ({ data }) => {
			console.log(`[工作流] 开始测试阶段 - 项目: ${data.projectName}`);
			// 等待技术完成后，调用Test Agent
			return {
				...data,
				phase: "testing",
				status: "completed" as const,
			};
		},
	});

// 异步并行工作流：策划 → (美术+音乐并行) → 技术 → 测试
export const parallelGameDevWorkflow = createWorkflowChain({
	id: "parallel-game-dev",
	name: "异步并行游戏开发工作流",
	purpose: "美术和音乐并行执行，提高开发效率",
	input: gameDevWorkflowInput,
	result: gameDevWorkflowResult,
})
	// Step 1: 策划阶段
	.andThen({
		id: "planning-phase",
		execute: async ({ data }) => {
			console.log(`[工作流] 开始策划阶段 - 项目: ${data.projectName}`);
			return {
				...data,
				phase: "planning",
			};
		},
	})
	// Step 2: 美术和音乐并行执行
	.andThen({
		id: "art-and-music-parallel",
		execute: async ({ data }) => {
			console.log(
				`[工作流] 并行执行美术和音乐阶段 - 项目: ${data.projectName}`,
			);
			// 在实际实现中，这里会同时启动Art Agent和Music Agent
			// 等待两者都完成后才继续
			return {
				...data,
				phase: "art-music-parallel",
			};
		},
	})
	// Step 3: 技术阶段
	.andThen({
		id: "tech-phase",
		execute: async ({ data }) => {
			console.log(`[工作流] 开始技术阶段 - 项目: ${data.projectName}`);
			return {
				...data,
				phase: "tech",
			};
		},
	})
	// Step 4: 测试阶段
	.andThen({
		id: "test-phase",
		execute: async ({ data }) => {
			console.log(`[工作流] 开始测试阶段 - 项目: ${data.projectName}`);
			return {
				...data,
				phase: "testing",
				status: "completed" as const,
			};
		},
	});

// 反馈循环工作流：支持基于测试结果的迭代优化
export const feedbackLoopGameDevWorkflow = createWorkflowChain({
	id: "feedback-loop-game-dev",
	name: "反馈循环游戏开发工作流",
	purpose: "基于测试结果进行迭代优化，持续改进版本",
	input: gameDevWorkflowInput,
	result: gameDevWorkflowResult,
})
	// Step 1-5: 与并行工作流相同的步骤
	.andThen({
		id: "planning-phase",
		execute: async ({ data }) => {
			console.log(`[工作流] 开始策划阶段 - 项目: ${data.projectName}`);
			return { ...data, phase: "planning" };
		},
	})
	.andThen({
		id: "art-and-music-parallel",
		execute: async ({ data }) => {
			console.log(
				`[工作流] 并行执行美术和音乐阶段 - 项目: ${data.projectName}`,
			);
			return { ...data, phase: "art-music-parallel" };
		},
	})
	.andThen({
		id: "tech-phase",
		execute: async ({ data }) => {
			console.log(`[工作流] 开始技术阶段 - 项目: ${data.projectName}`);
			return { ...data, phase: "tech" };
		},
	})
	.andThen({
		id: "test-phase",
		execute: async ({ data }) => {
			console.log(`[工作流] 开始测试阶段 - 项目: ${data.projectName}`);
			return { ...data, phase: "testing" };
		},
	})
	// Step 6: 反馈循环 - 根据测试结果决定是否需要重新执行
	.andThen({
		id: "feedback-loop",
		resumeSchema: z.object({
			needsRedesign: z.boolean(),
			needsRefix: z.boolean(),
			issues: z.array(z.string()),
		}),
		execute: async ({ data, suspend, resumeData }) => {
			// 如果收到反馈数据，说明需要重新执行
			if (resumeData) {
				if (resumeData.needsRedesign) {
					console.log(
						`[工作流] 检测到设计问题，返回策划阶段 - 项目: ${data.projectName}`,
					);
					// 返回策划阶段重新设计
					return {
						...data,
						phase: "planning",
						feedbackIssues: resumeData.issues,
					};
				}
				if (resumeData.needsRefix) {
					console.log(
						`[工作流] 检测到技术问题，返回技术阶段 - 项目: ${data.projectName}`,
					);
					// 返回技术阶段修复问题
					return { ...data, phase: "tech", feedbackIssues: resumeData.issues };
				}
			}

			// 检查测试结果，如果有问题则暂停等待反馈
			// 在实际实现中，这里会检查测试报告
			const hasIssues = false; // 从测试报告获取

			if (hasIssues) {
				await suspend("测试发现问题，等待反馈决定下一步", {
					projectId: data.projectId,
					testReport: "test-report-id",
				});
			}

			// 没有问题，完成项目
			return {
				...data,
				status: "completed" as const,
			};
		},
	});

// 根据执行模式选择工作流
export function getGameDevWorkflow(executionMode: ExecutionMode) {
	switch (executionMode) {
		case ExecutionMode.SEQUENTIAL:
			return sequentialGameDevWorkflow;
		case ExecutionMode.ASYNC_PARALLEL:
			return parallelGameDevWorkflow;
		case ExecutionMode.FEEDBACK_LOOP:
			return feedbackLoopGameDevWorkflow;
		default:
			return sequentialGameDevWorkflow;
	}
}
