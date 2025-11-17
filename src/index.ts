import "dotenv/config";
import path from "node:path";
import fs from "fs-extra";

// 导入共享类型
import { ExecutionMode, GameProjectConfig } from "./types";

// 确保必要的目录存在
function ensureDirectories() {
	const dirs = [
		"./data/projects",
		"./data/assets/images",
		"./data/assets/audio",
		"./data/assets/code",
		"./data/reports",
		"./data/knowledge-base",
	];

	for (const dir of dirs) {
		fs.ensureDirSync(dir);
		console.log(`确保目录存在: ${dir}`);
	}
}

// 初始化知识库（示例）
function initKnowledgeBase() {
	const kbDir = "./data/knowledge-base";

	// 这里可以放置一些示例代码或游戏开发相关文档
	const sampleDoc = `# 游戏开发知识库示例

## Unity 基础
- 场景管理
- 角色控制器
- 物理系统

## Three.js 基础
- 场景、相机、渲染器
- 几何体和材质
- 动画系统
`;

	fs.writeFileSync(path.join(kbDir, "sample-docs.md"), sampleDoc);
	console.log("初始化知识库完成");
}

// 主程序入口
async function main() {
	console.log("=== 游戏开发Agent系统启动 ===");

	// 确保目录结构
	ensureDirectories();

	// 初始化知识库
	initKnowledgeBase();

	console.log("\n系统已成功初始化！");
	console.log("使用以下命令启动各个组件：");
	console.log("  - A2A服务器: npm run start:a2a-server");
	console.log("  - 策划Agent: npm run start:planning-agent");
	console.log("  - 美术Agent: npm run start:art-agent");
	console.log("  - 音乐Agent: npm run start:music-agent");
	console.log("  - 技术Agent: npm run start:tech-agent");
	console.log("  - 测试Agent: npm run start:test-agent");
}

// 启动程序
main().catch((error) => {
	console.error("启动失败:", error);
	process.exit(1);
});
