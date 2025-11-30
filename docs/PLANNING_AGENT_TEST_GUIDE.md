# Planning Agent 单独测试指南

## ✅ 需要启动的服务（仅2个）

```
┌─────────────────┐
│  A2A Server     │  ← 调度中心，监听 8080 端口
└────────┬────────┘
         │ WebSocket
         ↓
┌─────────────────┐
│ Planning Agent  │  ← 连接到 A2A Server，等待任务
└─────────────────┘
```

**不需要启动**：
- ❌ Kafka
- ❌ workflow-consumer
- ❌ MySQL/Redis（可选，仅用于持久化）
- ❌ 其他 Agent（art/music/tech/test）

---

## 🚀 启动步骤

### 步骤 1：检查环境变量

确保 `.env` 文件存在：

```bash
# .env 必需的变量
A2A_PORT=8080
A2A_SERVER_URL=ws://localhost:8080

# AI 模型配置（Planning Agent 需要）
OPENAI_API_KEY=sk-...
# 或者使用其他模型
DEEPSEEK_API_KEY=sk-...
QWEN_API_KEY=sk-...
```

### 步骤 2：启动 A2A Server

**终端 1**：
```bash
npm run start:a2a-server
```

**成功日志**：
```
A2A服务器启动在 http://localhost:8080
WebSocket服务器就绪
已加载 0 个项目
```

### 步骤 3：启动 Planning Agent

**终端 2**：
```bash
npm run start:planning-agent
```

**成功日志**：
```
Planning Agent 正在连接到 A2A 服务器...
已连接到 A2A 服务器
Planning Agent 已注册，AgentID: planning-agent
成功连接到A2A服务器
```

### 步骤 4：发送测试请求

#### Windows PowerShell：
```powershell
.\test-planning-preview.ps1
```

#### Linux/Mac Bash：
```bash
bash test-planning-preview.sh
```

#### 或者直接用 curl：
```bash
curl -X POST http://localhost:8080/api/executions/preview \
  -H "Content-Type: application/json" \
  -d @test-planning-request.json
```

---

## 📝 预期响应

### 成功响应：

```json
{
  "success": true,
  "data": {
    "projectId": "preview-abc-123-456",
    "stageId": "planning",
    "status": "completed",
    "artifacts": [
      {
        "artifactId": "...",
        "stageId": "planning",
        "type": "document",
        "format": "gdd",
        "url": "./data/projects/preview-abc-123-456/gdd.md",
        "source": "llm",
        "metadata": {
          "projectName": "魔法世界冒险"
        }
      }
    ]
  }
}
```

### 查看生成的 GDD：

```bash
# 查找最新的预览项目
ls ./data/projects/preview-*

# 查看 Markdown 格式的 GDD
cat ./data/projects/preview-abc-123-456/gdd.md

# 或者查看 JSON 格式（兼容性）
cat ./data/projects/preview-abc-123-456/gdd.json
```

---

## 🔍 故障排查

### 问题 1：A2A Server 启动失败

**错误**：`Error: listen EADDRINUSE: address already in use :::8080`

**解决**：
```bash
# Windows
netstat -ano | findstr :8080
taskkill /PID <进程ID> /F

# Linux/Mac
lsof -ti:8080 | xargs kill -9
```

### 问题 2：Planning Agent 无法连接

**错误**：`WebSocket connection failed`

**检查**：
1. A2A Server 是否已启动？
2. 端口是否正确？检查 `.env` 中的 `A2A_SERVER_URL`
3. 防火墙是否阻止了连接？

**调试**：
```bash
# 检查 A2A Server 是否监听
curl http://localhost:8080/api/projects
# 应该返回 []
```

### 问题 3：Preview API 超时

**错误**：`预览超时` 或无响应

**原因**：
- Planning Agent 没有启动
- AI 模型 API 没有配置或 Key 无效
- Planning Agent 生成 GDD 时出错

**检查日志**：
- 终端 1（A2A Server）：有没有收到 preview 请求？
- 终端 2（Planning Agent）：有没有收到任务？有没有报错？

**默认超时**：120 秒（可在 `.env` 中修改 `PREVIEW_TIMEOUT_MS`）

### 问题 4：AI 模型调用失败

**错误**：`AI model API error`

**检查**：
1. `.env` 中的 API Key 是否正确？
2. 网络是否能访问 AI 服务？
3. 是否有足够的配额/余额？

**临时解决**：
Planning Agent 目前使用 **mock 模式生成 GDD**（不调用真实 AI），如果 AI 调用失败，应该能看到 mock 数据。

---

## 🎯 测试参数说明

### userInput（必需）

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `projectName` | string | 项目名称 | "魔法世界冒险" |
| `gameGenre.primary` | enum | 主类型 | "rpg", "slg", "shooter" 等 |
| `gameGenre.subGenre` | enum | 子类型 | "arpg", "turn_based_rpg" 等 |
| `dimension` | enum | 维度 | "2d" 或 "3d" |
| `artStyle` | enum | 美术风格 | "realistic", "cartoon", "pixel", "anime" |
| `gameMode` | enum | 游戏模式 | "singleplayer" 或 "multiplayer" |
| `additionalRequirements` | string | 额外需求 | "需要魔法系统" |

### stageConfig.planningFocus（可选）

控制 Planning Agent 的生成重点：

| 字段 | 说明 | 影响 |
|------|------|------|
| `narrative` | 叙事/剧情 | 是否生成详细的故事线 |
| `numeric` | 数值系统 | 是否生成数值模型 |
| `levelDesign` | 关卡设计 | 是否生成关卡设计 |
| `systemDesign.growth` | 成长系统 | 角色/等级成长 |
| `systemDesign.equipment` | 装备系统 | 装备/道具设计 |
| `systemDesign.social` | 社交系统 | 好友/公会等 |
| `systemDesign.combat` | 战斗系统 | 战斗机制 |

**示例**：
```json
{
  "planningFocus": {
    "narrative": true,      // 重点生成剧情
    "numeric": false,       // 忽略数值系统
    "systemDesign": {
      "equipment": true,    // 生成装备系统
      "combat": true        // 生成战斗机制
    }
  }
}
```

---

## 🆚 方式二：使用完整工作流（不推荐用于单 Agent 测试）

如果你确实需要测试完整工作流（包括 Kafka 消息队列）：

### 需要启动的服务（5个）：

1. **Kafka + ZooKeeper**（外部服务）
2. **A2A Server**：`npm run start:a2a-server`
3. **Planning Agent**：`npm run start:planning-agent`
4. **Workflow Consumer**：`npm run start:workflow-consumer`
5. **MySQL/Redis**（可选）

### 测试命令：

```bash
# 发送到完整工作流
curl -X POST http://localhost:8080/api/executions \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "sequential-game-dev",
    "executionMode": "sequential",
    "cloudProvider": "aliyun",
    "userId": 123,
    "companyId": 456,
    "projectId": "789",
    "project": {
      "projectName": "魔法世界冒险",
      "gameGenre": { "primary": "rpg" },
      "dimension": "3d",
      "artStyle": "anime",
      "gameMode": "singleplayer"
    },
    "stages": [
      {
        "stageId": "planning",
        "agentId": "planning-agent",
        "model": "gpt-4",
        "mode": "llm+kb"
      }
    ]
  }'
```

**区别**：
- Preview API：立即返回结果，超时 120 秒
- 完整工作流：异步执行，需要轮询状态或订阅 SSE 事件

---

## 📊 快速对比

| 特性 | Preview API | 完整工作流 |
|------|------------|-----------|
| **启动服务** | 2 个 | 5+ 个 |
| **需要 Kafka** | ❌ | ✅ |
| **响应方式** | 同步返回 | 异步 SSE |
| **适用场景** | 单 Agent 测试 | 生产环境 |
| **推荐度** | ⭐⭐⭐⭐⭐ | ⭐⭐ |

---

## 🎓 总结

**测试单个 Planning Agent，你只需要：**

1. ✅ 启动 A2A Server：`npm run start:a2a-server`
2. ✅ 启动 Planning Agent：`npm run start:planning-agent`
3. ✅ 调用 Preview API：`.\test-planning-preview.ps1`
4. ✅ 查看结果：`cat ./data/projects/preview-*/gdd.md`

**不需要：**
- ❌ `npm run worker:workflow`（这个脚本不存在）
- ❌ `npm run start:workflow-consumer`（只有完整工作流才需要）
- ❌ Kafka
- ❌ 其他 Agent

---

*最后更新：2025-11-30*
