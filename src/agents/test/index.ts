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
	type GameProjectConfig,
	MessageType,
	type StageConfig,
	type TestReport,
} from "../../types";

interface TestTaskPayload {
	action?: string;
	stageConfig?: StageConfig;
	[key: string]: unknown;
}

interface TestExecutionResult {
	testCase: string;
	passed: boolean;
	duration: number;
	details: string;
}

interface TestControlMessagePayload {
	action?: "pause" | "resume" | "abort";
	notes?: string;
	updates?: {
		stageConfig?: StageConfig;
	};
}

// 导入服务
import { knowledgeBaseService } from "../../services/KnowledgeBaseService";
import { mem0Service } from "../../services/Mem0Service";

// 模拟AIModel类，用于生成测试用例和分析结果
class AIModel {
  private apiKey: string;
  
	constructor(apiKey = "mock-api-key") {
    this.apiKey = apiKey;
  }
  
  async generateTestCases(gdd: GDD): Promise<string[]> {
		console.log("AI模型: 基于GDD生成测试用例");
    
    // 分别调用searchByKeyword获取不同的知识
		const primaryGenre = gdd.primaryGenre ?? gdd.gameType;
    const gameTypeKnowledge = await knowledgeBaseService.searchByKeyword(
			`${primaryGenre}游戏测试用例`,
    );
    console.log(`获取了 ${gameTypeKnowledge.length} 条测试相关知识`);
    
    // 根据游戏类型和GDD内容生成模拟测试用例
    const testCases: string[] = [];
    
    // 基础游戏功能测试
		testCases.push("测试游戏启动和基础界面加载");
		testCases.push("测试玩家角色移动和交互功能");
    
    // 根据游戏类型添加特定测试用例
		if (primaryGenre === "rpg") {
			testCases.push("测试角色升级系统和属性变化");
			testCases.push("测试战斗系统和技能释放");
			testCases.push("测试任务系统和NPC交互");
		} else if (primaryGenre === "slg") {
			testCases.push("测试资源收集和管理系统");
			testCases.push("测试建筑建造和升级功能");
			testCases.push("测试部队训练和战斗系统");
		} else if (primaryGenre === "moba") {
			testCases.push("测试英雄选择和技能系统");
			testCases.push("测试地图导航和小兵AI");
			testCases.push("测试多人对战网络同步");
		} else if (primaryGenre === "sim" || primaryGenre === "rac") {
			testCases.push("测试玩家控制响应和物理引擎");
			testCases.push("测试比赛规则和计分系统");
			testCases.push("测试AI对手难度平衡");
    }
    
    // 测试游戏性和平衡性
		testCases.push("测试游戏难度平衡");
		testCases.push("测试UI响应和用户体验");
    
    // 测试技术性能
		testCases.push("测试帧率和性能优化");
		testCases.push("测试内存泄漏和资源管理");
    
    // 根据游戏类型生成不同的测试用例
		if (gdd.gameMode === "online") {
			testCases.push("测试网络连接稳定性");
			testCases.push("测试数据同步和一致性");
    }
    
    return testCases;
  }
  
	async analyzeTestResults(
		results: TestExecutionResult[],
	): Promise<TestReport> {
		console.log("AI模型: 分析测试结果并生成报告");
    
    // 模拟分析结果
    let passCount = 0;
    let failCount = 0;
    
    // 生成模拟测试报告
    const report: TestReport = {
      reportId: `test-report-${Date.now()}`,
			projectId: "mock-project-id",
      generatedAt: new Date().toISOString(),
			summary: "测试完成，发现部分问题需要修复",
      issues: [],
      testsRun: 0,
      testsPassed: 0,
			testsFailed: 0,
    };
    
    results.forEach((result, index) => {
			if (Math.random() > 0.3) {
				// 模拟70%的通过率
        passCount++;
      } else {
        failCount++;
        
        // 生成不同类型的错误
        const errorType = Math.floor(Math.random() * 3);
				let errorMsg = "";
        
        if (errorType === 0) {
          errorMsg = `功能错误: 测试用例${index + 1}未达到预期行为`;
        } else if (errorType === 1) {
          errorMsg = `性能问题: 测试用例${index + 1}出现帧率下降`;
        } else {
          errorMsg = `兼容性问题: 测试用例${index + 1}在某些环境下失败`;
        }
        
        // 错误信息直接添加到issues数组中
        report.issues.push({ 
          issueId: `issue-${index}`,
          description: errorMsg,
					severity: errorType === 0 ? "critical" : "major",
					category:
						errorType === 0
							? "gameplay"
							: errorType === 1
								? "performance"
								: "visual",
					suggestedFix: `请检查相关代码并修复: ${errorMsg}`,
        });
        
        // 添加详细问题到同一个issue中
        // 避免添加重复对象，直接修改上面添加的issue
      }
    });
    
    report.testsRun = passCount + failCount;
    report.testsPassed = passCount;
    report.testsFailed = failCount;
    
    // 更新报告摘要
    if (failCount === 0) {
			report.summary = "所有测试通过，项目可以发布";
    } else if (failCount < results.length * 0.2) {
			report.summary = "少量测试失败，修复后可以发布";
    } else {
			report.summary = "多项测试失败，需要全面修复";
    }
    
    return report;
  }
}

class TestAgent {
  private ws: WebSocket | null = null;
	private agentId = "test-agent";
  private aiModel: AIModel;
	private serverUrl: string;
	private projects: Map<string, { gdd?: GDD; project?: GameProjectConfig }> =
		new Map();
	private pausedProjects: Set<string> = new Set();
	private stageConfigs: Map<string, StageConfig | undefined> = new Map();
	private stageContexts: Map<string, { gdd?: GDD; stageConfig?: StageConfig }> =
		new Map();
  
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
			content: { action: "register", name: "测试Agent", version: "1.0.0" },
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
				case MessageType.STATUS_UPDATE:
					if ((data.content as TestTaskPayload)?.action === "test") {
						await this.processTestTask(
							data.projectId,
							data.content as TestTaskPayload,
						);
					} else {
						this.handleStatusUpdate(data.content);
					}
        break;

				case MessageType.GDD_UPDATE: {
					// 存储GDD
					const project = this.projects.get(data.projectId) || {};
					project.gdd = data.content as GDD;
					this.projects.set(data.projectId, project);
					console.log(`收到项目 ${data.projectId} 的GDD`);
        break;
				}

				case MessageType.CONTROL:
					await this.handleControlMessage(
						data.projectId,
						data.content as TestControlMessagePayload,
					);
        break;

      default:
					console.log(`未知消息类型: ${data.type}`);
			}
		} catch (error) {
			console.error("处理消息失败:", error);
    }
  }
  
	// 处理测试任务
	private async processTestTask(
		projectId: string,
		content: TestTaskPayload = {},
	): Promise<void> {
		console.log(`开始处理项目 ${projectId} 的测试任务`);
    
    try {
			const project = this.projects.get(projectId);
			if (!project || !project.gdd) {
				throw new Error("缺少项目数据或GDD");
      }
			const stageConfig = content.stageConfig;
			if (stageConfig) {
				this.stageConfigs.set(projectId, stageConfig);
			}
			this.stageContexts.set(projectId, { gdd: project.gdd, stageConfig });
      
      // 生成测试用例
			const testCases = await this.aiModel.generateTestCases(project.gdd);
			console.log(`生成了 ${testCases.length} 个测试用例`);

			if (this.pausedProjects.has(projectId)) {
				await this.sendCheckpoint(projectId, [], "等待用户操作");
				return;
			}
      
      // 执行测试
			const executionResult = await this.executeTests(projectId, testCases);
			if (executionResult.paused) {
				return;
			}
			const testResults = executionResult.results;
      
      // 分析测试结果
      const testReport = await this.aiModel.analyzeTestResults(testResults);
			testReport.projectId = projectId;
      
      // 保存测试报告
			await this.saveTestReport(projectId, testReport);
      
      // 将重要测试经验存储到Mem0
      await mem0Service.saveMemory(
				"system",
				projectId,
        `游戏测试结果: ${testReport.summary}`,
				"test",
				testReport.testsFailed > 0 ? "high" : "low",
        {
          testReportId: testReport.reportId,
          passedTests: testReport.testsPassed,
          failedTests: testReport.testsFailed,
          keyIssues: testReport.issues.slice(0, 3),
					timestamp: new Date().toISOString(),
				},
      );
      
      // 如果有失败的测试，保存错误信息到知识库
      if (testReport.testsFailed > 0) {
        await knowledgeBaseService.addKnowledgeEntry(
					`游戏测试错误模式: ${projectId}`,
					testReport.issues.map((issue) => issue.description).join("\n"),
					"test",
        );
      }
      
      // 发送测试报告回A2A服务器
			this.sendTestReport(projectId, testReport);
			this.sendArtifactUpdate(projectId, testReport, "completed");
      
			console.log(`项目 ${projectId} 的测试完成`);
    } catch (error) {
			console.error("测试任务执行失败:", error);
			this.sendTestError(projectId, (error as Error).message || String(error));
    }
  }
  
  // 执行测试
	private async executeTests(
		projectId: string,
		testCases: string[],
	): Promise<{ results: TestExecutionResult[]; paused: boolean }> {
		console.log("开始执行测试...");
    
		const results: TestExecutionResult[] = [];
		const projectPath = path.resolve(`./data/projects/${projectId}/game`);
    
    // 模拟测试执行过程
		for (const [index, testCase] of testCases.entries()) {
			if (this.pausedProjects.has(projectId)) {
				await this.sendCheckpoint(projectId, results, "用户暂停测试");
				return { results, paused: true };
			}
      console.log(`执行测试用例 ${index + 1}: ${testCase}`);
      
      // 模拟测试延迟
			await new Promise((resolve) => setTimeout(resolve, 100));
      
      // 检查项目文件结构是否正确
        if (fs.existsSync(projectPath)) {
          // 模拟文件检查结果
          results.push({
            testCase,
            passed: Math.random() > 0.3, // 70%通过率
            duration: Math.random() * 2 + 1, // 1-3秒
					details: `文件检查通过: ${projectPath}`,
          });
        } else {
          results.push({
            testCase,
            passed: false,
            duration: 0.1,
					details: `错误: 项目路径不存在: ${projectPath}`,
        });
      }
    }
    
		return { results, paused: false };
  }
  
  // 保存测试报告
	private async saveTestReport(
		projectId: string,
		report: TestReport,
	): Promise<void> {
		const reportDir = path.resolve(`./data/projects/${projectId}/reports`);
		fs.ensureDirSync(reportDir);
    
		const reportPath = path.join(reportDir, `${report.reportId}.json`);
		fs.writeJSONSync(reportPath, report, { spaces: 2 });
    console.log(`测试报告已保存到: ${reportPath}`);
  }
  
  // 发送测试报告
	private sendTestReport(projectId: string, report: TestReport): void {
		if (!this.ws) return;

		const message: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId,
			type: MessageType.TEST_REPORT,
			content: report,
			timestamp: new Date().toISOString(),
			requiresAck: true,
		};

		this.ws.send(JSON.stringify(message));
	}

	// 发送测试错误
	private sendTestError(projectId: string, error: string): void {
		if (!this.ws) return;

		const message: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId,
			type: MessageType.STATUS_UPDATE,
			content: { status: "error", error },
			timestamp: new Date().toISOString(),
			requiresAck: false,
		};

		this.ws.send(JSON.stringify(message));
    }

	private sendArtifactUpdate(
		projectId: string,
		report: TestReport,
		status: "completed" | "paused",
	) {
		if (!this.ws) return;
		const reportPath = path.resolve(
			`./data/projects/${projectId}/reports/${report.reportId}.json`,
		);
		const artifacts: AgentArtifact[] = [
			{
				artifactId: report.reportId,
				stageId: "test",
				type: "test_report",
				format: "json",
				url: reportPath,
				source: "pipeline",
				description: report.summary,
				metadata: {
					testsRun: report.testsRun,
					testsFailed: report.testsFailed,
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
				stageId: "test",
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
		results: TestExecutionResult[],
		notes?: string,
	) {
		const checkpointReport: TestReport = {
			reportId: `checkpoint-${Date.now()}`,
			projectId,
			testsRun: results.length,
			testsPassed: results.filter((r) => r.passed).length,
			testsFailed: results.filter((r) => !r.passed).length,
			issues: [],
			summary: notes || "测试阶段暂停",
			generatedAt: new Date().toISOString(),
		};
		await this.saveTestReport(projectId, checkpointReport);
		this.sendArtifactUpdate(projectId, checkpointReport, "paused");
	}

	private async handleControlMessage(
		projectId: string,
		content: TestControlMessagePayload = {},
	) {
		const action = content.action;
		switch (action) {
			case "pause":
				this.pausedProjects.add(projectId);
				await this.sendCheckpoint(projectId, [], content.notes);
				break;
			case "resume":
				this.pausedProjects.delete(projectId);
				await this.processTestTask(projectId, {
					id: "resume",
					name: "Resume Tests",
					stageConfig: content.updates?.stageConfig,
				});
				break;
			case "abort":
				this.pausedProjects.delete(projectId);
				break;
		}
	}

	// 处理状态更新
	private handleStatusUpdate(content: unknown) {
		console.log("状态更新:", content);
  }
}

// 启动Test Agent
console.log("=== Test Agent 启动 ===");
const agent = new TestAgent();
agent.connect();

// 优雅关闭
process.on("SIGTERM", () => {
	console.log("正在关闭Test Agent...");
	process.exit(0);
});

process.on("SIGINT", () => {
	console.log("正在关闭Test Agent...");
  process.exit(0);
});
