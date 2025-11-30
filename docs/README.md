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

## 🎯 快速开始

### 单 Agent 测试

```bash
# 1. 启动服务
npm run start:a2a-server       # A2A Server
npm run start:planning-agent   # Planning Agent

# 2. 发送测试请求
curl -X POST http://localhost:8090/api/executions/preview \
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

### 完整工作流测试

查看 [工作流图表](./WORKFLOW_DIAGRAMS.md) 了解完整流程。

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
└── PROJECTID_MAPPING_ISSUE.md              ← projectId 问题分析
```

---

## 🔗 相关链接

- **源码**: `../src/`
- **配置**: `../config/`
- **模板**: `../src/templates/`

---

*文档最后更新：2025-11-30*
