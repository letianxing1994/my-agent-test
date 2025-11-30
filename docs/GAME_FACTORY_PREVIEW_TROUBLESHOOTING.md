# game-factory Agent Preview 问题诊断指南

## 🔍 诊断步骤

### 步骤 1：确认 A2A Server 已重启

**问题**：tsx watch 可能没有重新加载代码

**解决**：
```bash
# 停止当前的 A2A Server（按 Ctrl+C）
# 重新启动
npm run start:a2a-server
```

**验证成功日志**：
```
A2A服务器启动在 http://localhost:8080
WebSocket服务器就绪
已加载 0 个项目
```

---

### 步骤 2：检查 game-factory 调用的 URL

**在 game-factory 前端查看网络请求**：

1. 打开浏览器开发者工具（F12）
2. 切换到 **Network** 标签
3. 点击"试运行"按钮
4. 查看发送的请求

**需要确认的信息**：

| 检查项 | 预期值 | 实际值 |
|--------|--------|--------|
| 请求 URL | `http://localhost:8080/workflows/agents/2/preview` | ? |
| 请求方法 | `POST` | ? |
| Content-Type | `application/json` | ? |

**示例截图位置**：

![Network 标签](network-tab-example.png)

---

### 步骤 3：检查 A2A Server 日志

**重启 A2A Server 后，点击"试运行"，查看终端日志。**

#### ✅ 成功的日志（调用新端点）

```
[Agent Preview API] 收到请求: POST /workflows/agents/2/preview
[Agent Preview API] agentId 参数: 2
[Agent Preview API] 请求体: {
  "userInput": { ... }
}
[Agent Preview API] 解析后的 agentId: 2
[Agent Preview] agentId=2 → stageId=planning
```

#### ❌ 错误的日志（调用旧端点）

```
[原有 Preview API] 收到请求: POST /api/executions/preview
[原有 Preview API] 请求体: {
  "userInput": { ... }
  // ❌ 没有 stageId！
}
执行预览失败 ZodError: [
  {
    "expected": "'planning' | 'art' | 'music' | 'tech' | 'test'",
    "received": "undefined",
    "code": "invalid_type",
    "path": [ "stageId" ],
    "message": "Required"
  }
]
```

---

### 步骤 4：根据日志判断问题

#### 情况 A：看到 `[Agent Preview API] 收到请求`

**说明**：新端点工作正常，但其他地方有问题

**可能原因**：
1. agentId 映射配置错误
2. userInput 验证失败
3. Agent 未连接

**排查**：查看后续日志中的具体错误

#### 情况 B：看到 `[原有 Preview API] 收到请求`

**说明**：game-factory 调用的是旧端点

**原因**：game-factory 的 API URL 配置不正确

**解决方法**：检查 game-factory 代码中的 API 调用

---

## 🔧 game-factory 端修复

### 检查 game-factory 的 API 调用代码

**需要检查的文件**：
```
game-factory/
├── frontend/
│   └── src/
│       └── services/
│           └── workflowService.ts  ← 可能在这里
│       └── api/
│           └── agents.ts           ← 或者在这里
└── backend/
    └── routes/
        └── workflows.ts             ← 或者在这里
```

**查找关键字**：
```bash
cd game-factory
grep -r "preview" --include="*.ts" --include="*.js"
grep -r "agents.*preview" --include="*.ts" --include="*.js"
```

### 正确的调用方式

**✅ 正确**：
```typescript
// game-factory/frontend/src/services/workflowService.ts
export async function previewAgent(agentId: number, params: any) {
  const response = await fetch(
    `http://localhost:8080/workflows/agents/${agentId}/preview`,  // ✅ 正确
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    }
  );
  return response.json();
}
```

**❌ 错误**：
```typescript
// 错误的调用方式
const response = await fetch(
  `http://localhost:8080/api/executions/preview`,  // ❌ 错误！缺少 agentId
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // stageId: ???  ← 没有传 stageId
      userInput: { ... }
    })
  }
);
```

---

## 🧪 快速测试

### 测试 1：使用 curl 测试新端点

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

**预期响应**：
```json
{
  "success": true,
  "data": { ... }
}
```

**预期日志（A2A Server）**：
```
[Agent Preview API] 收到请求: POST /workflows/agents/2/preview
[Agent Preview API] agentId 参数: 2
[Agent Preview] agentId=2 → stageId=planning
```

### 测试 2：使用 PowerShell 测试

```powershell
$body = @{
    userInput = @{
        projectName = "测试游戏"
        gameGenre = @{
            primary = "rpg"
        }
        dimension = "3d"
        artStyle = "anime"
        gameMode = "singleplayer"
    }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri "http://localhost:8080/workflows/agents/2/preview" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body
```

---

## 📋 问题诊断表

请填写以下信息：

| 检查项 | 结果 | 备注 |
|--------|------|------|
| A2A Server 已重启？ | ☐ 是 ☐ 否 | 必须重启才能加载新代码 |
| Planning Agent 已连接？ | ☐ 是 ☐ 否 | 查看 A2A Server 日志 |
| game-factory 调用的 URL | | 从浏览器 Network 标签复制 |
| A2A Server 显示哪个日志？ | ☐ Agent Preview API ☐ 原有 Preview API | 判断问题根源 |
| curl 测试是否成功？ | ☐ 是 ☐ 否 | 验证新端点是否工作 |

---

## 🚨 常见问题

### 问题 1：A2A Server 重启后仍然报错

**可能原因**：game-factory 调用的是旧端点

**解决**：
1. 查看 A2A Server 日志，确认收到的请求路径
2. 如果是 `/api/executions/preview`，则需要修改 game-factory 代码

### 问题 2：curl 测试成功，但 game-factory 仍然失败

**可能原因**：game-factory 的 API URL 配置不对

**解决**：
1. 检查 game-factory 的环境变量或配置文件
2. 搜索 game-factory 代码中的 API 调用
3. 确保使用 `/workflows/agents/${agentId}/preview`

### 问题 3：看到 "未知的 agentId" 错误

**错误示例**：
```json
{
  "success": false,
  "message": "未知的 agentId: 99"
}
```

**解决**：更新 my-agent-test 的 agentId 映射配置

---

## 📞 需要提供的调试信息

如果问题仍未解决，请提供以下信息：

1. **A2A Server 完整日志**（从"试运行"点击后的所有输出）
2. **浏览器 Network 标签截图**（显示请求 URL 和请求体）
3. **game-factory 的 API 调用代码**（发送预览请求的代码）

---

*诊断指南 - 最后更新：2025-11-30*
