# WebSocket 连接问题诊断 - 修复总结

## 🎯 已完成的工作

### 1. ✅ 增强 WebSocket 通信日志

**Planning Agent (ReActPlanningAgent.ts)**:
- 添加连接建立日志，包括服务器URL
- 添加 WebSocket readyState 状态显示
- 添加注册消息发送确认
- 添加消息接收日志（显示前100字符）

**A2A Server (a2a-server/index.ts)**:
- 添加 WebSocket 连接建立日志
- 添加原始消息内容日志（前200字符）
- 添加消息解析后的详细信息（类型、发送者、接收者）
- 添加注册检测和处理过程日志
- 添加 Agent 列表和数量的实时显示

### 2. ✅ 完全移除前端轮询机制

**PreviewTaskDetail.tsx**:
- 页面加载时只调用一次API获取初始状态
- 使用SSE订阅实时状态更新
- SSE失败时显示警告，**不会降级到轮询**
- 添加手动"刷新状态"按钮

**previewTasks.ts**:
- 保留 `pollPreviewTaskStatus` 仅用于手动刷新
- 增加默认轮询间隔从2秒到5秒
- 添加429错误处理（延长到15秒）
- 添加网络错误检测（停止轮询）

### 3. ✅ 添加SSE实时推送

**game-factory backend (routes/previewTasks.ts)**:
- 新增 `/api/preview-tasks/:taskId/events` SSE代理端点
- 从 my-agent-test 的 A2A Server 代理SSE数据流
- 验证任务所有权
- 处理连接失败和错误情况

**game-factory frontend (services/previewTasks.ts)**:
- 新增 `subscribePreviewTaskStatus()` 函数
- 使用 EventSource API 订阅SSE
- 处理initial、update、error等事件类型
- 提供清理函数关闭SSE连接

### 4. ✅ 更新启动指南

创建并更新 `启动指南.md`，包含：
- 问题分析（Planning Agent未连接、轮询导致崩溃）
- 正确启动步骤
- 验证系统正常工作的检查点
- WebSocket连接诊断详细步骤
- 预期日志输出示例
- 常见问题排查

## 🔍 当前问题分析

**症状**：
```
Planning Agent 日志显示:
[ReAct Planning Agent] ✅ 注册消息已发送到A2A服务器

A2A Server 日志显示:
[A2A Server] 📊 当前活跃Agent数量: 0
[A2A Server] 📋 活跃Agent列表: 无
```

**可能原因**：
1. WebSocket 消息未到达 A2A Server
2. 消息格式不匹配
3. 启动顺序问题（Planning Agent 先启动）
4. 端口/网络配置问题
5. WebSocket 连接状态问题

## 📋 下一步诊断步骤

### 步骤1: 停止所有服务

在所有正在运行的终端中按 `Ctrl+C` 停止服务。

### 步骤2: 按正确顺序重启服务

**终端1 - 启动 A2A Server**:
```bash
cd E:\NodeProject\my-agent-test
npm run start:a2a-server
```

**等待看到**:
```
A2A服务器启动在 http://localhost:8080
WebSocket服务器就绪
```

**终端2 - 启动 Planning Agent**:
```bash
cd E:\NodeProject\my-agent-test
npm run start:planning-agent
```

**预期看到（Planning Agent）**:
```
[ReAct Planning Agent] 🔄 正在连接到 A2A 服务器: ws://localhost:8080
[ReAct Planning Agent] ✅ WebSocket连接已建立
[ReAct Planning Agent] 📡 WebSocket readyState: 1 (1=OPEN)
[ReAct Planning Agent] 🔄 正在注册到A2A服务器，Agent ID: planning-agent
[ReAct Planning Agent] ✅ 注册消息已发送到A2A服务器 (MessageType: STATUS_UPDATE, Action: register)
```

**预期看到（A2A Server - 在终端1）**:
```
[A2A Server] 🔌 新的WebSocket连接已建立
[A2A Server] 📨 收到WebSocket原始消息: {"messageId":"xxx","senderId":"planning-agent",...
[A2A Server] 📦 解析后的消息类型: STATUS_UPDATE, 发送者: planning-agent, 接收者: a2a-server
[A2A Server] 🎯 检测到注册消息！准备注册 Agent: planning-agent
[A2A Server] ✅ Agent planning-agent 已注册成功
[A2A Server] 📊 当前活跃Agent列表: planning-agent
[A2A Server] 📤 已向 planning-agent 发送注册确认
```

### 步骤3: 对比日志，找出问题

检查哪些日志**没有出现**，这将精确定位问题：

| 如果缺少这条日志 | 说明问题是 | 可能的解决方案 |
|--------------|----------|------------|
| `[A2A Server] 🔌 新的WebSocket连接已建立` | WebSocket连接未建立 | 检查端口8080是否被占用，检查防火墙 |
| `[A2A Server] 📨 收到WebSocket原始消息` | 消息未到达服务器 | 检查网络连接，检查WebSocket协议 |
| `[A2A Server] 📦 解析后的消息类型: STATUS_UPDATE` | 消息格式错误 | 检查消息JSON格式 |
| `[A2A Server] 🎯 检测到注册消息！` | 注册逻辑未触发 | 检查 `action: "register"` 字段 |
| `[ReAct Planning Agent] 📡 WebSocket readyState: 1` | 连接未完全建立 | Planning Agent发送消息时连接未就绪 |

### 步骤4: 启动 game-factory (在 Planning Agent 注册成功后)

**终端3 - game-factory Backend**:
```bash
cd E:\NodeProject\game-factory\backend
npm start
```

**终端4 - game-factory Frontend**:
```bash
cd E:\NodeProject\game-factory\frontend
npm run dev
```

### 步骤5: 测试预览功能

1. 打开浏览器访问 game-factory frontend
2. 创建新的 Agent 预览任务
3. 观察三个终端的日志输出

**预期看到（当点击"试运行"时）**:

**A2A Server**:
```
[A2A Server] 🎯 准备发送策划任务，ProjectID: preview-xxx
[A2A Server] 📊 当前活跃Agent数量: 1
[A2A Server] 📋 活跃Agent列表: planning-agent
[A2A Server] 🔍 查找planning-agent: 找到
[A2A Server] 🔌 WebSocket状态: OPEN
[A2A Server] ✅ 已发送策划任务到 Planning Agent: preview-xxx
```

**Planning Agent**:
```
[ReAct Planning Agent] 📨 收到消息: USER_INPUT 来自: a2a-server, ProjectID: preview-xxx
[ReAct Planning Agent] 🎯 收到USER_INPUT任务，准备执行ReAct循环
```

## 🎨 前端 SSE 验证

打开浏览器开发者工具（F12），观察：

**Console 标签**:
```
[PreviewTaskDetail] 尝试订阅SSE实时更新
```

**Network 标签**:
- 应该只有 **1 次** API 请求到 `/api/preview-tasks/:taskId`
- 应该有 **1 个持续的** EventSource 连接到 `/api/preview-tasks/:taskId/events`
- **不应该有任何轮询请求**

**如果 SSE 失败**:
- Console 会显示: `[PreviewTaskDetail] SSE连接失败，请手动刷新页面获取最新状态`
- 页面顶部会显示黄色警告
- **不会自动轮询，不会导致429错误**

## 📝 如果问题仍然存在

请提供以下信息：

1. **A2A Server 的完整启动日志**（从启动到接收预览任务的所有日志）
2. **Planning Agent 的完整启动日志**（从启动到注册的所有日志）
3. **哪些预期日志出现了，哪些没有出现**
4. **任何错误或警告信息**

## 🔧 快速检查清单

- [ ] A2A Server 已启动并显示 "WebSocket服务器就绪"
- [ ] Planning Agent 已启动并显示 "WebSocket连接已建立"
- [ ] A2A Server 显示 "当前活跃Agent列表: planning-agent"
- [ ] 点击预览时 A2A Server 显示 "查找planning-agent: 找到"
- [ ] 前端页面加载时只有1次API请求（不是连续请求）
- [ ] 浏览器 Network 标签显示 EventSource 连接
- [ ] 没有任何 429 错误

## 🎉 成功标志

当一切正常工作时，你会看到：

1. Planning Agent 启动后立即在 A2A Server 看到注册成功
2. 点击"试运行"后 Planning Agent 立即收到任务并开始执行
3. 前端页面实时更新进度（通过SSE）
4. 没有任何轮询请求
5. 没有任何 429 错误

---

**编译状态**: ✅ 所有项目已成功编译
**修改文件**:
- `my-agent-test/src/a2a-server/index.ts`
- `my-agent-test/src/agents/planning/ReActPlanningAgent.ts`
- `game-factory/backend/src/routes/previewTasks.ts`
- `game-factory/frontend/src/services/previewTasks.ts`
- `game-factory/frontend/src/pages/PreviewTaskDetail.tsx`
- `my-agent-test/启动指南.md`
