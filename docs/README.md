# my-agent-test 文档导航

## 📖 核心架构文档

### 1. [分布式架构设计](./architecture-distributed.md)
- 多 Agent 协作架构
- REST + WebSocket + SSE 通信
- 云存储集成 (OSS/GCS)
- 暂停/恢复机制

**适用场景**：了解整体系统架构

---

### 2. [工作流图表](./WORKFLOW_DIAGRAMS.md)
- 执行模式流程图
- 消息流转图
- 暂停/恢复流程

**适用场景**：可视化理解系统流程

---

## 🔧 功能集成文档

### 3. [MCP 工具集成](./MCP_INTEGRATION.md)
- 本地工具集成（Blender/Unity）
- MCP 协议使用
- 资源同步服务

**适用场景**：集成本地创作工具

---

### 4. [Agent 参数兼容性](./AGENT_PARAMS_COMPATIBILITY.md)
- game-factory → my-agent-test 参数映射
- agentMeta 使用说明
- planningFocus 配置

**适用场景**：配置 Agent 行为和能力

---

## 🚀 最新改进

### 5. [GDD Markdown 格式升级](./GDD_MARKDOWN_UPGRADE.md)
- ✅ **新功能**：Markdown + YAML Frontmatter 作为主存储格式
- 从 JSON 到 Markdown 的改进理由
- 使用方法和测试步骤
- 向后兼容策略

**适用场景**：了解 GDD 格式升级

---

### 6. [持久化键设计](./PERSISTENCE_KEY_DESIGN.md)
- ✅ **新功能**：userId + projectId 作为主键
- 多租户数据隔离设计
- 本地/云存储路径规范
- PathService API 使用

**适用场景**：了解数据存储和权限隔离

---

### 7. [projectId 映射关系](./GAME_PROJECT_MAPPING.md)
- ✅ **核心映射**：game-factory.games.id = my-agent-test.projectId
- 数据流图和术语对照
- 文件路径映射规则

**适用场景**：理解两个系统的数据关联

---

### 8. [projectId 实现指南](./PROJECTID_IMPLEMENTATION.md)
- ✅ **实现完成**：统一 projectId 传递
- game-factory 集成指南
- 完整数据流和验证清单

**适用场景**：game-factory 开发者集成参考

---

### 9. [game-factory Agent Preview API 适配](./GAME_FACTORY_AGENT_PREVIEW_API.md)
- ✅ **新增**：支持 game-factory 的 `/workflows/agents/:agentId/preview` 调用
- agentId 到 stageId 映射配置
- 请求格式和故障排查

**适用场景**：解决 game-factory 调用 Agent 预览接口的问题

---

## 🎯 快速开始

### 方式一：单 Agent 测试（推荐用于开发）

**适用场景**：测试单个 Agent 的功能，快速迭代

**需要启动**：仅 2 个服务（A2A Server + 目标 Agent）

```bash
# 1. 启动服务
npm run start:a2a-server       # A2A Server
npm run start:planning-agent   # Planning Agent

# 2. 发送测试请求
curl -X POST http://localhost:8080/api/executions/preview \
  -H "Content-Type: application/json" \
  -d '{
    "stageId": "planning",
    "userInput": {
      "projectName": "测试游戏",
      "gameGenre": { "primary": "rpg" },
      "dimension": "3d"
    }
  }'

# 3. 查看生成的 GDD
cat ./data/projects/preview-*/gdd.md
```

**详细指南**：[单 Agent 测试指南](./PLANNING_AGENT_TEST_GUIDE.md)

---

### 方式二：完整工作流测试（用于集成测试）

**适用场景**：测试多 Agent 协作、Kafka 消息队列、完整工作流

**需要启动**：外部依赖 + 7 个 my-agent-test 服务

```bash
# Windows PowerShell
.\start-full-workflow.ps1

# Linux/Mac
bash start-full-workflow.sh
```

**详细指南**：[完整工作流测试指南](./FULL_WORKFLOW_TEST_GUIDE.md)

---

## 📁 文档结构

```
docs/
├── README.md                              ← 本文档（导航）
├── architecture-distributed.md             ← 核心架构
├── WORKFLOW_DIAGRAMS.md                    ← 流程图表
├── MCP_INTEGRATION.md                      ← MCP 集成
├── AGENT_PARAMS_COMPATIBILITY.md           ← 参数映射
├── GDD_MARKDOWN_UPGRADE.md                 ← GDD 格式升级
├── PERSISTENCE_KEY_DESIGN.md               ← 持久化设计
├── GAME_PROJECT_MAPPING.md                 ← projectId 映射关系
├── PROJECTID_IMPLEMENTATION.md             ← projectId 实现指南
├── PROJECTID_MAPPING_ISSUE.md              ← projectId 问题分析
├── PLANNING_AGENT_TEST_GUIDE.md            ← 单 Agent 测试指南
├── FULL_WORKFLOW_TEST_GUIDE.md             ← 完整工作流测试指南
└── GAME_FACTORY_AGENT_PREVIEW_API.md       ← game-factory Agent Preview 适配
```

---

## 🔗 相关链接

- **源码**: `../src/`
- **配置**: `../config/`
- **模板**: `../src/templates/`

---

*文档最后更新：2025-11-30*
