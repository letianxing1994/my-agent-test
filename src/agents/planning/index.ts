/**
 * ReAct Planning Agent - Entry Point
 */

export { ReActPlanningAgent } from "./ReActPlanningAgent";
export { ReActPlanningAgentActions, reactActions } from "./ReActActions";
export { DynamicPromptGenerator, dynamicPromptGenerator } from "./DynamicPromptGenerator";

// 启动 Planning Agent
import { ReActPlanningAgent } from "./ReActPlanningAgent";

console.log("\n============================================");
console.log("🚀 [Planning Agent] 正在启动...");
console.log("============================================\n");

const planningAgent = new ReActPlanningAgent();

// 连接到 A2A 服务器
planningAgent.connect().catch((error) => {
  console.error("[Planning Agent] 启动失败:", error);
  process.exit(1);
});

console.log("[Planning Agent] 等待来自 A2A 服务器的任务消息...");
console.log("[Planning Agent] 服务器地址:", process.env.A2A_SERVER_URL || "ws://localhost:8080");

export default planningAgent;
