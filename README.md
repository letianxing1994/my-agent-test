<div align="center">
  <h1>⚡ my-agent-test · AI 游戏开发多智能体系统</h1>
  <p>基于多智能体协作的游戏自动化开发核心引擎</p>
  
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.7.3-blue.svg)](https://www.typescriptlang.org/)
  [![Node.js](https://img.shields.io/badge/Node.js->=20.19.0-green.svg)](https://nodejs.org/)
  [![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com)
</div>

---

## 📖 快速导航

- **[文档中心](docs/README.md)** - 完整文档导航和快速开始
- **[架构设计](docs/architecture-distributed.md)** - 分布式多 Agent 架构
- **[最新改进](docs/README.md#🚀-最新改进)** - GDD Markdown 格式、持久化设计

---

## 1. 项目简介

`my-agent-test` 是 A2A（Agent-to-Agent）执行层，负责把上游（如 `game-factory`）提交的工作流打包成可独立调度的多智能体任务，并交付给策划 / 美术 / 音乐 / 技术 / QA Agents。系统内置：

- **三种执行模式**：`sequential`、`async_parallel`、`feedback_loop`
- **Instruction Orchestrator**：自动拆解模糊需求、生成澄清问题、等待老板反馈后再继续
- **Kafka + workflowConsumer**：把外部 API 与 Agent 集群解耦，支撑 10k 并发排队
- **暂停 / 恢复 / 重跑**：任意阶段可外部控制，同时生成 checkpoint 并广播 SSE
- **多云归档**：OSS (Aliyun) / GCS (GCP) 双栈上传、分片传输大体积 3D / 音频资产
- **mem0 + 知识库**：关键事件写入 mem0，Agent 查询 KnowledgeBase 获取行业经验
- **Agent Preview API**：允许 game-factory 单独试跑某个 Agent 并即时预览产物
- **🆕 用户素材上传**：支持上传现成素材，Agent 可引用使用
- **🆕 MCP 工具集成**：连接本地 DCC 工具和游戏引擎，自动同步输出
- **🆕 资源自动同步**：监控本地目录，智能上传到云端

架构与容量规划详见 `docs/architecture-distributed.md`。

## 2. 目录速览

```
my-agent-test/
├── src/
│   ├── a2a-server/          # REST + SSE + WebSocket 调度层
│   ├── orchestrator/        # ExecutionManager、InstructionOrchestrator、mem0桥
│   ├── agents/              # planning/art/music/tech/qa 单体 Agent
│   ├── services/
│   │   ├── StorageService.ts        # 云存储（OSS/GCS）
│   │   ├── UserAssetService.ts      # 🆕 用户素材上传
│   │   ├── MCPConnector.ts          # 🆕 MCP 本地工具集成
│   │   ├── ResourceSyncService.ts   # 🆕 资源自动同步
│   │   ├── KnowledgeBaseService.ts  # 知识库
│   │   └── Mem0Service.ts           # mem0 桥接
│   ├── workers/             # workflowConsumer(Kafka)
│   ├── workflows/           # Zod 定义+模板
│   └── tests/               # Jest/WS 集成测试
├── config/
│   ├── agentModels.default.json     # 模型配置
│   ├── cloud.default.json           # 云存储配置
│   └── mcp-tools.example.json       # 🆕 MCP 工具配置模板
├── docs/
│   ├── architecture.md              # 系统架构
│   ├── architecture-distributed.md  # 分布式部署
│   └── MCP_INTEGRATION.md           # MCP 集成指南
├── DEPLOYMENT.md            # 部署指南（本地/Docker/集群）
└── package.json
```

## 3. 运行前准备

| 依赖           | 说明                                                                 |
| -------------- | -------------------------------------------------------------------- |
| Node.js >= 20  | 使用 TS + tsx，需支持 `node:` 前缀 & fetch                           |
| Kafka          | `workflow-tasks` / `workflow-results` / `agent-events` topic          |
| MySQL / Redis  | 项目状态、缓存与 Clarification 记录                                  |
| 对象存储       | OSS (Aliyun) &/or GCS，可只启用一侧                                   |
| LLM API        | 各 Agent 可指向不同模型（OpenAI、qwen、私有 MCP 等）                 |

> 建议本地先通过 docker-compose 启动 Kafka + ZooKeeper、MySQL、Redis，或直接复用云服务。

## 4. 安装 & 环境变量

```bash
cp env.example .env             # 或按需自建
npm install
```

常用变量（按需新增）：

| 变量                           | 作用                                      |
| ------------------------------ | ----------------------------------------- |
| `A2A_PORT`                     | A2A HTTP / WS 服务端口（默认 8080）       |
| `KAFKA_BROKERS`                | 逗号分隔 broker 列表                      |
| `MYSQL_URL` / `REDIS_URL`      | 状态与缓存                                |
| `OSS_REGION/KEY/SECRET/BUCKET` | Aliyun OSS 凭据                           |
| `GCP_PROJECT/GCS_BUCKET/...`   | GCS 凭据                                  |
| `OPENAI_API_KEY` 等            | 各 Agent 模型 key，可在 `config/agentModels.default.json` 调整 |
| `MEM0_ENDPOINT`                | mem0 API（当前为 console mock，可替换）   |

## 5. 快速启动

### 🎯 方式一：单 Agent 测试（推荐用于开发）

**适用场景**：快速测试单个 Agent 功能

```bash
# 1. 启动 A2A Server
npm run start:a2a-server

# 2. 启动目标 Agent（如 Planning Agent）
npm run start:planning-agent

# 3. 发送测试请求
curl -X POST http://localhost:8080/api/executions/preview \
  -H "Content-Type: application/json" \
  -d @test-planning-preview.sh
```

**详细指南**：[单 Agent 测试指南](docs/PLANNING_AGENT_TEST_GUIDE.md)

---

### 🚀 方式二：完整工作流（用于集成测试）

**适用场景**：测试多 Agent 协作、Kafka 消息队列

```bash
# Windows PowerShell
.\start-full-workflow.ps1

# Linux/Mac
bash start-full-workflow.sh
```

**自动完成**：
- ✅ 启动 Kafka + ZooKeeper
- ✅ 启动 MySQL + Redis（可选）
- ✅ 创建必需的 Kafka Topics
- ✅ 提供启动所有服务的指令

**详细指南**：[完整工作流测试指南](docs/FULL_WORKFLOW_TEST_GUIDE.md)

---

> **提示**：更多启动选项和故障排查，请查看 [文档中心](docs/README.md)

## 6. 执行流程

1. `game-factory` 把公司任务打包后写入 `workflow-tasks`.
2. `workflowConsumer` 拉取任务 → 调用 `/api/executions` 建立 ExecutionRecord。
3. Instruction Orchestrator 检查 `gameGenre + userInput`。若信息不足：
   - Execution 状态置为 `awaiting_clarification`
   - SSE 推送 `clarification` 事件，等待老板回答
4. 计划阶段开始：Planning Agent 根据 `gameGenre` 生成 GDD，写入 OSS/GCS & mem0。
5. Art/Music 并发执行（在 async_parallel / feedback 模式），资源按元数据分类存 OSS/GCS。
6. Tech Agent 汇总 manifest、对接远端资源、输出代码压缩包 + build manifest。
7. Test Agent 拉取最新 build / manifest，跑自动化脚本生成报告，必要时触发反馈循环。
8. 任意阶段可通过 `/api/executions/:id/stages/:stageId/pause|resume|updates` 注入控制命令。

## 7. API & 工具

| 功能                       | 端点 / 文件                                   |
| -------------------------- | --------------------------------------------- |
| 创建执行                   | `POST /api/executions`                        |
| Clarification 读写         | `GET/POST /api/executions/:id/clarifications` |
| SSE 事件订阅               | `GET /api/executions/:id/events`              |
| Agent 试跑                 | `POST /api/executions/preview`                |
| Kafka Worker 健康检查      | `GET /worker/health`（见 `workflowConsumer`） |
| 部署配置                   | `deploy/workers/Dockerfile`                   |

详见 `docs/architecture-distributed.md` 中的时序 / 控制流图。

## 8. 开发 & 测试

```bash
npm run lint          # Biome
npm run typecheck
npm test              # Jest + WS 集成
npm run build         # tsdown -> dist
```

新增 Agent / 工具时，务必：

1. 在 `src/types.ts` 补齐消息/Artifact 类型。
2. 在 `ExecutionManager` 注册阶段状态 & Artifact 写入。
3. 在 `docs/architecture-distributed.md` 更新通信路径（便于 ops）。

## 9. 部署建议

- **最小集群**：A2A+WorkflowConsumer 两个节点（CPU 4C+，内存 16GB），每个 Agent 独立容器。
- **对象存储**：3D/音频走 OSS Multipart API，代码包建议 < 2GB。
- **监控**：Kafka consumer lag、Clarification backlog、Agent WS 心跳。
- **部署指南**：`DEPLOYMENT.md` 提供了完整的本地/Docker/分布式部署方案。

## 10. 常见问题

| 问题                                   | 处理方式                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------- |
| Kafka 持续积压                         | 调高 `workflowConsumer` 并发或增加更多 Agent 容器                          |
| Clarification 卡住                     | `ExecutionManager.hasPendingClarification` 返回 true 时，Planning 不会继续 |
| OSS/GCS 上传慢                         | 使用 `StorageService.uploadMultipart`，确保 `.env` 配置了分片大小          |
| Preview 结果迟迟不返回                | `PREVIEW_TIMEOUT_MS`（默认 120s）可调，或检查目标 Agent 是否已连上 A2A     |

---

现在可回到 `game-factory` 触发真实工作流，或直接使用 `POST /api/executions` 自行调度。提交到远端前请记得 `npm run lint` 与 `npm test`。祝开发顺利！🚀