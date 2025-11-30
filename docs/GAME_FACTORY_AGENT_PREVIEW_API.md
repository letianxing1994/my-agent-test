# game-factory Agent Preview API 适配指南

## 🔗 API 端点映射

### game-factory 调用
```
POST /workflows/agents/:agentId/preview
```

### my-agent-test 支持
```
POST /workflows/agents/:agentId/preview  ← 🔥 新增适配端点
POST /api/agents/:agentId/preview        ← 备用端点
POST /api/executions/preview             ← 原有端点（需要 stageId）
```

---

## 🗺️ agentId 到 stageId 映射

my-agent-test 需要知道 game-factory 的 `agents.id` 对应哪个 `stageId`。

### 默认映射（在 src/a2a-server/index.ts 中配置）

```typescript
const agentIdToStageId: Record<number, "planning" | "art" | "music" | "tech" | "test"> = {
  1: "planning",   // Planning Agent
  2: "planning",   // 如果 game-factory agentId=2 也是 Planning Agent
  3: "art",        // Art Agent
  4: "music",      // Music Agent
  5: "tech",       // Tech Agent
  6: "test",       // Test Agent
};
```

### 🔧 如何配置映射

**步骤 1**：查询 game-factory 的 agents 表

```sql
-- 在 game-factory 数据库执行
SELECT id, name, role FROM agents;
```

**示例结果**：
```
id | name              | role
---|-------------------|------------
1  | 策划大师          | planning
2  | 资深策划          | planning
3  | 美术总监          | art
4  | 音乐制作人        | music
5  | 技术架构师        | tech
6  | QA 工程师         | test
```

**步骤 2**：更新 my-agent-test 的映射

编辑 `src/a2a-server/index.ts`，找到 `agentIdToStageId` 配置：

```typescript
const agentIdToStageId: Record<number, "planning" | "art" | "music" | "tech" | "test"> = {
  1: "planning",   // 对应 game-factory agents.id=1
  2: "planning",   // 对应 game-factory agents.id=2
  3: "art",        // 对应 game-factory agents.id=3
  4: "music",      // 对应 game-factory agents.id=4
  5: "tech",       // 对应 game-factory agents.id=5
  6: "test",       // 对应 game-factory agents.id=6
};
```

**步骤 3**：重启 A2A Server

```bash
# 停止当前运行的 A2A Server（Ctrl+C）
# 重新启动
npm run start:a2a-server
```

---

## 📝 请求格式

### game-factory 发送的请求

```http
POST /workflows/agents/2/preview HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{
  "userInput": {
    "projectName": "魔法世界冒险",
    "gameGenre": {
      "primary": "rpg",
      "subGenre": "arpg"
    },
    "dimension": "3d",
    "artStyle": "anime",
    "gameMode": "singleplayer",
    "additionalRequirements": "需要魔法系统和装备系统"
  },
  "project": {
    "projectName": "魔法世界冒险"
  },
  "stageConfig": {
    "planningFocus": {
      "narrative": true,
      "numeric": true,
      "systemDesign": {
        "growth": true,
        "equipment": true,
        "combat": true
      }
    }
  }
}
```

**注意**：
- ❌ 请求体中**不需要**包含 `stageId`
- ✅ my-agent-test 会根据 URL 中的 `agentId` 自动映射到 `stageId`

### my-agent-test 处理流程

```
1. 接收请求: POST /workflows/agents/2/preview
2. 提取 agentId: 2
3. 映射 stageId: agentIdToStageId[2] = "planning"
4. 构建完整请求: { stageId: "planning", ...req.body }
5. 调用 Planning Agent 执行
6. 返回结果
```

---

## ✅ 响应格式

### 成功响应

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

### 错误响应

#### 1. 未知的 agentId

```json
{
  "success": false,
  "message": "未知的 agentId: 99。有效值: 1, 2, 3, 4, 5, 6"
}
```

**解决**：检查 game-factory 发送的 agentId 是否在映射表中。

#### 2. userInput 验证失败

```json
{
  "success": false,
  "message": "请求参数验证失败",
  "details": {
    "fieldErrors": {
      "userInput": {
        "dimension": ["Required"]
      }
    }
  }
}
```

**解决**：确保 game-factory 发送完整的 userInput 字段。

#### 3. Agent 未连接

```json
{
  "success": false,
  "message": "预览超时"
}
```

**解决**：
1. 确认目标 Agent 已启动（如 `npm run start:planning-agent`）
2. 检查 Agent 是否已连接到 A2A Server

---

## 🧪 测试

### 使用 curl 测试

```bash
curl -X POST http://localhost:8080/workflows/agents/2/preview \
  -H "Content-Type: application/json" \
  -d '{
    "userInput": {
      "projectName": "测试游戏",
      "gameGenre": { "primary": "rpg" },
      "dimension": "3d",
      "artStyle": "anime",
      "gameMode": "singleplayer"
    }
  }'
```

### 预期日志（A2A Server）

```
[Agent Preview] agentId=2 → stageId=planning
Planning Agent 收到任务...
✅ GDD 已生成
```

---

## 🔄 与原有 API 的对比

| 特性 | `/workflows/agents/:agentId/preview` | `/api/executions/preview` |
|------|-------------------------------------|---------------------------|
| **适用场景** | game-factory 集成 | 直接测试 my-agent-test |
| **agentId** | 从 URL 提取 | 不支持 |
| **stageId** | 自动映射 | 必需在请求体中 |
| **响应格式** | 相同 | 相同 |
| **兼容性** | game-factory 友好 | 原生 API |

---

## 🛠️ 故障排查

### 问题 1：agentId 映射错误

**症状**：Planning Agent 没有响应，但 Art Agent 收到了任务

**原因**：agentId 映射配置错误

**解决**：
1. 查看 A2A Server 日志，确认映射结果
   ```
   [Agent Preview] agentId=2 → stageId=art  ← 错误！应该是 planning
   ```
2. 更新 `agentIdToStageId` 配置
3. 重启 A2A Server

### 问题 2：game-factory 收到 400 错误

**症状**：`{"success":false,"message":"请求参数验证失败"}`

**原因**：game-factory 发送的 userInput 不完整

**解决**：检查 game-factory 发送的请求体，确保包含：
- `userInput.gameGenre` 或 `userInput.gameType`
- `userInput.dimension`
- `userInput.artStyle`
- `userInput.gameMode`

### 问题 3：超时

**症状**：2 分钟后返回 `{"success":false,"message":"预览超时"}`

**原因**：
1. 目标 Agent 未启动
2. AI 模型 API 调用失败
3. 网络问题

**解决**：
1. 确认 Agent 已启动并连接
2. 检查 `.env` 中的 AI API Key
3. 查看 Agent 终端日志

---

## 📋 配置清单

部署前检查：

- [ ] 查询 game-factory 的 `agents` 表，获取 id 和 role 映射
- [ ] 更新 `src/a2a-server/index.ts` 中的 `agentIdToStageId` 配置
- [ ] 重启 A2A Server
- [ ] 启动对应的 Agent（如 Planning Agent）
- [ ] 使用 curl 测试 `/workflows/agents/:agentId/preview` 端点
- [ ] 在 game-factory 前端测试"试运行"功能

---

## 🎯 最佳实践

1. **配置外部化**：建议将 agentId 映射移到 `.env` 或配置文件
2. **动态查询**：如果 game-factory 提供 API 查询 agents 表，可以动态获取映射
3. **错误处理**：详细记录映射过程，方便排查问题
4. **版本兼容**：保留原有的 `/api/executions/preview` 端点，支持直接测试

---

*文档更新时间：2025-11-30*
