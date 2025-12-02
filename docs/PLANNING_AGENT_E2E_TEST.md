# 策划 Agent 预运行端到端测试指南

**测试范围**: game-factory (Web) → my-agent-test (Planning Agent)
**测试时间**: 预计 15-20 分钟
**更新日期**: 2025-12-02

---

## 📋 测试目标

验证从前端 Web 界面触发策划 Agent 预运行，到后端 Planning Agent 完整执行并返回结果的完整流程。

---

## 🏗️ 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│  完整测试链路                                                 │
└──────────────────────────────────────────────────────────────┘

用户浏览器 (http://localhost:3001)
    │
    ├─ 前端 React 应用 (game-factory/frontend)
    │   └─ 订阅 SSE: http://localhost:8080/api/executions/:id/events
    │
    ├─ 后端 API (game-factory/backend, port 4000)
    │   └─ POST /api/agents/:agentId/preview → my-agent-test
    │
    └─ A2A Server (my-agent-test, port 8080)
        └─ ReAct Planning Agent
            ├─ 真实 LLM API 调用 (DeepSeek/OpenAI/Claude)
            ├─ GDD 生成和存储
            └─ SSE 推送思考流
```

---

## 🚀 服务启动步骤

### 前置条件

1. **Node.js 版本**: 18.x 或以上
2. **MySQL 数据库**: 已安装并运行
3. **API Keys**: 已配置 LLM API Key（DeepSeek/OpenAI/Claude）

### 步骤 1: 启动 MySQL 数据库

```bash
# 方式 1: 如果使用 Docker
docker-compose up -d mysql

# 方式 2: 如果本地安装了 MySQL
# Windows: 在服务中启动 MySQL
# macOS/Linux:
sudo service mysql start
# 或
mysql.server start
```

**验证**:
```bash
mysql -u root -p -e "SELECT 1"
# 应该显示连接成功
```

---

### 步骤 2: 启动 game-factory 后端 (端口 4000)

```bash
# 打开终端 1
cd E:\NodeProject\game-factory\backend

# 检查环境变量
cat .env | grep PORT
# 应该看到 PORT=4000

# 安装依赖（首次运行）
npm install

# 启动开发服务器
npm run dev
```

**验证成功标志**:
```
Server running on port 4000
Database connected successfully
✓ MySQL 连接成功
✓ Redis 连接成功 (可选)
```

**如果启动失败**:
- 检查 MySQL 是否运行
- 检查 `.env` 配置是否正确
- 检查端口 4000 是否被占用: `netstat -ano | findstr :4000`

---

### 步骤 3: 启动 my-agent-test A2A Server (端口 8080)

```bash
# 打开终端 2
cd E:\NodeProject\my-agent-test

# 检查环境变量
cat .env | grep -E "API_KEY|A2A_PORT|ENABLE_MOCK_FALLBACK"

# 确认 LLM API Key 已配置
# DEEPSEEK_API_KEY=sk-...
# OPENAI_API_KEY=sk-proj-...
# A2A_PORT=8080
# ENABLE_MOCK_FALLBACK=true

# 启动 A2A Server
npm run start:a2a-server
```

**验证成功标志**:
```
[A2A Server] 服务器运行在 http://localhost:8080
[A2A Server] WebSocket 服务器就绪
[A2A Server] 已加载 X 个项目
```

**如果启动失败**:
- 检查端口 8080 是否被占用: `netstat -ano | findstr :8080`
- 检查 TypeScript 编译是否通过: `npx tsc --noEmit`
- 检查 API Key 是否配置

---

### 步骤 4: 启动 game-factory 前端 (端口 3001)

```bash
# 打开终端 3
cd E:\NodeProject\game-factory\frontend

# 检查 vite.config.ts 中的代理配置
# 确保 proxy target 指向正确的后端地址

# 安装依赖（首次运行）
npm install

# 启动开发服务器
npm run dev
```

**验证成功标志**:
```
VITE v4.x.x  ready in xxx ms

➜  Local:   http://localhost:3001/
➜  Network: use --host to expose
```

**浏览器验证**:
- 打开 http://localhost:3001
- 应该看到 game-factory 主界面
- 检查浏览器控制台，确认没有网络错误

---

### 步骤 5: 验证服务间连通性

在**终端 4**中执行以下测试：

#### 5.1 测试 A2A Server 健康状态
```bash
curl http://localhost:8080/health
# 预期输出: {"status":"ok"}
```

#### 5.2 测试 game-factory backend 健康状态
```bash
curl http://localhost:4000/api/health
# 预期输出: {"status":"ok", "database":"connected"}
```

#### 5.3 测试 backend → A2A Server 连通性
```bash
# 从 game-factory backend 触发预运行
curl -X POST http://localhost:4000/api/agents/planning/preview \
  -H "Content-Type: application/json" \
  -d '{
    "userInput": {
      "projectName": "测试项目",
      "dimension": "2d",
      "gameGenre": {"primary": "RPG"},
      "artStyle": "pixel art",
      "gameMode": "single-player"
    }
  }'

# 预期输出:
# {
#   "success": true,
#   "taskId": "task-xxxxx",
#   "message": "预运行任务已创建"
# }
```

---

## 🧪 完整测试流程

### 测试用例 1: 2D RPG 游戏预运行（推荐首次测试）

#### 1. 登录 game-factory

1. 打开浏览器访问: http://localhost:3001
2. 如果需要登录，使用测试账号登录
3. 进入"公司管理"或"员工管理"页面

#### 2. 创建测试公司（如果还没有）

1. 点击"创建公司"
2. 填写公司信息：
   - 公司名称: 测试游戏公司
   - 描述: 用于策划 Agent 测试
3. 保存

#### 3. 创建策划员工（如果还没有）

1. 在公司详情页，点击"添加员工"
2. 选择职位: **Planner (策划)**
3. 填写员工信息：
   - 名称: 测试策划师
   - 技能等级: 5
4. 保存

#### 4. 触发策划 Agent 预运行

1. 进入"游戏项目"页面
2. 点击"创建新项目"或选择现有项目
3. 在项目编辑页面，找到"策划阶段"
4. 点击"预运行" (Preview) 按钮
5. 在弹出的对话框中填写：
   ```
   项目名称: 测试2D RPG
   游戏维度: 2D
   游戏类型: RPG
   美术风格: pixel art
   游戏模式: single-player
   ```
6. 点击"开始预运行"

#### 5. 实时观察执行过程

**前端界面应该显示**:
- ✅ SSE 连接成功
- ✅ 实时思考流输出（如下）

**预期的思考流输出**:
```
🤖 使用模型: deepseek/deepseek-reasoner
🚀 开始执行 ReAct 循环式策划任务
项目: 测试2D RPG
类型: 2d RPG

📊 观察当前状态...
当前项目为空，开始从零开始策划

🎯 生成子目标...
├─ 核心设计蓝图 (10%)
├─ 数值沙盒 (8%)
├─ 战斗系统设计 (10%)
...

🎯 开始执行：核心设计蓝图
类型: llm | 轨道: Track_1

📝 准备调用大模型...
任务: 设计游戏的核心设计蓝图

💭 系统提示词已生成 (3542 字符)

⏳ 正在调用 LLM API...

✅ LLM 响应已接收 (2341 tokens)

✅ 核心设计蓝图 完成，已更新 GDD
```

**如果看到 Mock 兜底**:
```
❌ LLM 调用失败: API key is invalid
🔄 启用兜底机制，使用 Mock LLM 生成内容...
🔧 生成 Mock 数据作为兜底...
✅ 核心设计蓝图 完成 (Mock 模式)，已更新 GDD
```
这说明真实 LLM API 调用失败，使用了 Mock 兜底数据。

#### 6. 查看任务进度

- 进度条应该实时更新（0% → 10% → 20% → ... → 100%）
- 每完成一个子任务，进度增加
- 总共 9 个子任务（2D 游戏）

#### 7. 查看生成结果

任务完成后（约 5-10 分钟，取决于 LLM 响应速度）：

1. **前端界面显示**:
   - ✅ 任务状态: completed
   - ✅ 进度: 100%
   - ✅ 显示"查看 GDD"按钮

2. **点击"查看 GDD"**:
   - 应该显示完整的游戏策划文档
   - 包含所有 9 个章节的内容

3. **后端验证 - 查看生成的 GDD 文件**:
   ```bash
   # 在终端 4 中执行
   cd E:\NodeProject\my-agent-test

   # 查找最新生成的项目
   ls -lt data/projects/ | head -5

   # 查看 GDD 内容（假设项目 ID 为 test-2d-rpg-001）
   cat data/projects/test-2d-rpg-001/gdd.json | head -50
   ```

   **预期内容**:
   ```json
   {
     "projectId": "test-2d-rpg-001",
     "projectName": "测试2D RPG",
     "dimension": "2d",
     "gameGenre": {"primary": "RPG"},
     "sections": {
       "core-blueprint": {
         "emotionCurve": "...",
         "coreLoop": "...",
         "uniqueValue": "..."
       },
       "numeric-sandbox": {
         "combatFormula": "...",
         ...
       },
       ...
     }
   }
   ```

---

### 测试用例 2: 3D 动作游戏预运行（可选）

重复上述步骤，但在步骤 4 中填写：
```
项目名称: 测试3D动作游戏
游戏维度: 3D
游戏类型: Action
美术风格: realistic
游戏模式: multiplayer
```

**预期差异**:
- 子任务数量: 10 个（多了"摄像机控制"）
- 关卡数量: 少于 2D（通常 10 个关卡 vs 20 个）
- 操控方案: 键鼠/手柄

---

## ✅ 验证清单

### 服务启动验证

- [ ] MySQL 数据库运行正常
- [ ] game-factory backend 启动成功 (4000)
- [ ] my-agent-test A2A Server 启动成功 (8080)
- [ ] game-factory frontend 启动成功 (3001)
- [ ] 浏览器可以访问前端界面

### 连通性验证

- [ ] A2A Server 健康检查通过
- [ ] game-factory backend 健康检查通过
- [ ] backend 可以调用 A2A Server API

### 功能验证

- [ ] 可以创建公司和策划员工
- [ ] 可以触发策划 Agent 预运行
- [ ] SSE 连接成功，实时接收思考流
- [ ] LLM API 调用成功（或 Mock 兜底生效）
- [ ] 进度实时更新
- [ ] 任务成功完成（状态: completed）
- [ ] GDD 文件成功生成
- [ ] GDD 内容完整且合理（不全是 Mock 数据）

### 性能验证

- [ ] 任务执行时间: 5-15 分钟（取决于 LLM 响应速度）
- [ ] SSE 推送延迟: < 1 秒
- [ ] 前端界面响应流畅，无卡顿
- [ ] 网络请求数量: 1 次初始请求 + 1 个 SSE 连接（无轮询）

---

## 🐛 常见问题和解决方案

### 问题 1: A2A Server 启动失败

**症状**:
```
Error: listen EADDRINUSE: address already in use :::8080
```

**原因**: 端口 8080 被占用

**解决**:
```bash
# Windows
netstat -ano | findstr :8080
taskkill /PID <PID> /F

# 或者修改 .env 中的端口
A2A_PORT=8081
```

---

### 问题 2: LLM API 调用失败

**症状**:
```
❌ LLM 调用失败: API key is invalid
🔄 启用兜底机制，使用 Mock LLM 生成内容...
```

**原因**: API Key 未配置或无效

**解决**:
1. 检查 `.env` 文件:
   ```bash
   cat .env | grep API_KEY
   ```
2. 确认 API Key 有效且有余额
3. 重启 A2A Server

**如果暂时无法解决**:
- Mock 兜底机制会自动生效，任务仍可完成
- 生成的内容会带有 "Mock:" 前缀
- 后续可以使用真实 API Key 重新生成

---

### 问题 3: 前端无法连接到后端

**症状**: 浏览器控制台显示网络错误

**解决**:
1. 检查 `game-factory/frontend/vite.config.ts` 中的代理配置:
   ```typescript
   server: {
     port: 3001,
     proxy: {
       '/api': {
         target: 'http://localhost:4000',  // 确保指向正确的后端端口
         changeOrigin: true,
       }
     }
   }
   ```
2. 重启前端服务

---

### 问题 4: SSE 连接失败

**症状**: 前端无法接收实时思考流

**解决**:
1. 检查浏览器控制台，查看 SSE 连接状态
2. 检查 A2A Server 日志，确认 SSE 端点可访问
3. 测试 SSE 连接:
   ```bash
   curl -N http://localhost:8080/api/executions/test-001/events
   ```
4. 检查防火墙或代理设置

---

### 问题 5: 任务执行时间过长

**症状**: 任务执行超过 20 分钟仍未完成

**可能原因**:
- LLM API 响应慢
- 网络问题
- 代码死循环（不太可能）

**解决**:
1. 查看 A2A Server 日志，检查是否卡在某个步骤
2. 检查网络连接
3. 考虑切换到更快的 LLM 模型（如 `gpt-4o`）

---

### 问题 6: 前端一直轮询导致 429 错误

**症状**: 浏览器控制台显示大量 429 Too Many Requests 错误

**原因**: 前端代码中可能还有旧的轮询逻辑

**解决**:
1. 检查前端代码中是否有 `setInterval`:
   ```bash
   cd E:\NodeProject\game-factory\frontend
   grep -r "setInterval.*preview" src/
   grep -r "setInterval.*status" src/
   ```
2. 删除所有轮询代码，改用 SSE 订阅:
   ```typescript
   // ❌ 删除这些
   useEffect(() => {
     const intervalId = setInterval(async () => {
       await fetch(`/api/preview/${projectId}/status`);
     }, 2000);
     return () => clearInterval(intervalId);
   }, [projectId]);

   // ✅ 使用这些
   useEffect(() => {
     const eventSource = new EventSource(`/api/executions/${executionId}/events`);
     eventSource.onmessage = (event) => {
       // 处理实时更新
     };
     return () => eventSource.close();
   }, [executionId]);
   ```

---

## 📊 性能基准

### 正常性能指标

| 指标 | 2D 游戏 | 3D 游戏 |
|------|---------|---------|
| **子任务数量** | 9 个 | 10 个 |
| **执行时间** | 5-12 分钟 | 6-15 分钟 |
| **LLM 调用次数** | 9 次 | 10 次 |
| **总 Token 消耗** | 18,000-27,000 | 20,000-30,000 |
| **网络请求数** | 1 初始 + 1 SSE | 1 初始 + 1 SSE |
| **SSE 推送消息数** | 50-100 条 | 60-120 条 |

### 异常指标（需要调查）

| 指标 | 异常值 | 可能原因 |
|------|--------|----------|
| **执行时间** | > 20 分钟 | LLM API 慢/网络问题 |
| **网络请求数** | > 10 个 | 存在轮询逻辑 |
| **错误率** | > 10% | API Key 问题/配置错误 |
| **SSE 断连次数** | > 2 次 | 网络不稳定 |

---

## 🔍 调试技巧

### 1. 查看实时日志

**A2A Server 日志**:
```bash
cd E:\NodeProject\my-agent-test
npm run start:a2a-server
# 日志会实时输出到控制台
```

**game-factory backend 日志**:
```bash
cd E:\NodeProject\game-factory\backend
npm run dev
# 日志会实时输出到控制台
```

### 2. 使用浏览器开发者工具

1. 打开浏览器开发者工具 (F12)
2. 切换到 **Network** 标签
3. 筛选 **WS** (WebSocket) 或 **EventStream**
4. 查看 SSE 连接状态和消息

### 3. 手动测试 API

```bash
# 手动触发预运行
curl -X POST http://localhost:8080/api/executions/preview \
  -H "Content-Type: application/json" \
  -d '{
    "stageId": "planning",
    "projectId": "manual-test-001",
    "userInput": {
      "projectName": "手动测试项目",
      "dimension": "2d",
      "gameGenre": {"primary": "RPG"},
      "artStyle": "pixel art",
      "gameMode": "single-player"
    },
    "stageConfig": {}
  }'

# 订阅 SSE
curl -N http://localhost:8080/api/executions/manual-test-001/events

# 查看任务状态
curl http://localhost:8080/api/preview/manual-test-001/status
```

### 4. 查看生成的文件

```bash
# 查看所有项目
ls -la data/projects/

# 查看特定项目的 GDD
cat data/projects/test-2d-rpg-001/gdd.json | json_pp

# 查看项目元数据
cat data/projects/test-2d-rpg-001/metadata.json | json_pp
```

---

## 📝 测试报告模板

测试完成后，请填写以下报告：

```markdown
## 测试报告 - 策划 Agent 预运行测试

**测试日期**: 2025-12-02
**测试人员**: [您的名字]
**测试环境**: Windows 11 / macOS / Linux

### 服务启动情况
- [ ] MySQL 数据库: ✅ / ❌
- [ ] game-factory backend: ✅ / ❌
- [ ] my-agent-test A2A Server: ✅ / ❌
- [ ] game-factory frontend: ✅ / ❌

### 测试结果
- **测试用例 1 (2D RPG)**: ✅ / ❌
  - 执行时间: ___ 分钟
  - LLM 模型: deepseek-reasoner / gpt-4o / mock
  - 是否使用 Mock 兜底: 是 / 否
  - GDD 质量: 优秀 / 良好 / 一般 / 差

- **测试用例 2 (3D Action)**: ✅ / ❌ / 未测试
  - 执行时间: ___ 分钟
  - LLM 模型: deepseek-reasoner / gpt-4o / mock
  - 是否使用 Mock 兜底: 是 / 否
  - GDD 质量: 优秀 / 良好 / 一般 / 差

### 遇到的问题
1. [描述问题]
2. [描述问题]

### 改进建议
1. [建议]
2. [建议]

### 总体评价
[您的评价]
```

---

## 📚 相关文档

- **快速测试指南**: `QUICK_START_TESTING.md` - 5 分钟快速测试
- **完整测试计划**: `TESTING_PLAN.md` - 详细的测试用例
- **前端集成指南**: `FRONTEND_INTEGRATION_GUIDE.md` - React/Vue 集成
- **LLM 集成说明**: `LLM_INTEGRATION.md` - 真实 LLM 调用
- **Mock 兜底机制**: `LLM_MOCK_FALLBACK.md` - 容错机制
- **SSE 推送架构**: `SSE_PUSH_ARCHITECTURE.md` - 实时推送原理
- **后端同步报告**: `BACKEND_SYNC_REPORT.md` - Go vs Node.js 对比

---

## ✅ 测试完成标志

当您看到以下所有标志时，说明测试成功：

1. ✅ 所有 4 个服务都成功启动
2. ✅ 前端界面可以正常访问
3. ✅ 可以触发策划 Agent 预运行
4. ✅ SSE 实时接收思考流，无轮询请求
5. ✅ 任务成功完成（status: completed, progress: 100%）
6. ✅ GDD 文件成功生成且内容合理
7. ✅ 无 429 错误或其他网络错误

---

**测试文档版本**: v1.0
**最后更新**: 2025-12-02
**维护者**: Claude Code

如有问题，请参考故障排除章节或查阅相关文档。
