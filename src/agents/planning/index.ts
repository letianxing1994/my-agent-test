/**
 * ReAct Planning Agent - Entry Point
 */

export { ReActPlanningAgent } from "./ReActPlanningAgent";
export { ReActPlanningAgentActions, reactActions } from "./ReActActions";
export { DynamicPromptGenerator, dynamicPromptGenerator } from "./DynamicPromptGenerator";

// 启动 Planning Agent
import { ReActPlanningAgent } from "./ReActPlanningAgent";

const planningAgent = new ReActPlanningAgent();

// 连接到 A2A 服务器
planningAgent.connect().catch((error) => {
  console.error("[Planning Agent] 启动失败:", error);
  process.exit(1);
});

console.log("[Planning Agent] 正在启动...");

export default planningAgent;
