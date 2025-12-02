# 策划 Agent 测试 - 快速启动卡

**一张纸搞定所有启动命令** 📋

---

## 🚀 快速启动（按顺序执行）

### 1️⃣ MySQL 数据库
```bash
# Docker 方式
docker-compose up -d mysql

# 或本地服务
# Windows: 服务管理器启动 MySQL
# Mac/Linux: sudo service mysql start
```

### 2️⃣ game-factory 后端 (端口 4000)
```bash
cd E:\NodeProject\game-factory\backend
npm run dev
```
**成功标志**: `Server running on port 4000` ✅

### 3️⃣ my-agent-test A2A Server (端口 8080)
```bash
cd E:\NodeProject\my-agent-test
npm run start:a2a-server
```
**成功标志**: `A2A服务器启动在 http://localhost:8080` ✅

### 4️⃣ game-factory 前端 (端口 3001)
```bash
cd E:\NodeProject\game-factory\frontend
npm run dev
```
**成功标志**: `Local: http://localhost:3001/` ✅

### 5️⃣ 打开浏览器
```
http://localhost:3001
```

---

## ✅ 快速验证

```bash
# 测试 A2A Server
curl http://localhost:8080/health

# 测试 backend
curl http://localhost:4000/api/health

# 测试 SSE 连接
curl -N http://localhost:8080/api/executions/test/events
```

---

## 🐛 快速故障排除

| 问题 | 解决方案 |
|------|----------|
| 端口被占用 | `netstat -ano \| findstr :端口号` 然后 `taskkill /PID xxx /F` |
| LLM API 失败 | 检查 `.env` 中的 `DEEPSEEK_API_KEY` 或使用 Mock 兜底 |
| 前端 429 错误 | 删除前端代码中的 `setInterval` 轮询逻辑 |
| SSE 连接失败 | 检查防火墙，确认 A2A Server 正常运行 |

---

## 📊 端口总览

| 服务 | 端口 | 用途 |
|------|------|------|
| MySQL | 3306 | 数据库 |
| game-factory backend | 4000 | API 服务 |
| game-factory frontend | 3001 | Web 界面 |
| my-agent-test A2A | 8080 | Agent 服务 |

---

## 🧪 测试步骤（5 分钟）

1. 打开浏览器: `http://localhost:3001`
2. 登录/创建公司
3. 添加策划员工 (Planner)
4. 创建游戏项目
5. 点击"预运行"按钮
6. 填写项目信息（2D RPG）
7. 观察实时思考流
8. 等待完成（5-10 分钟）
9. 查看生成的 GDD

---

## 📝 环境变量检查

### my-agent-test/.env
```env
DEEPSEEK_API_KEY=sk-...          # 必需
A2A_PORT=8080                    # 必需
ENABLE_MOCK_FALLBACK=true        # 推荐
```

### game-factory/backend/.env
```env
PORT=4000                        # 必需
DB_HOST=localhost                # 必需
DB_USER=root                     # 必需
DB_PASSWORD=your_password        # 必需
```

---

## 🎯 成功标志

- ✅ 4 个终端都在运行
- ✅ 浏览器可访问前端
- ✅ 可以触发预运行
- ✅ SSE 实时推送思考流
- ✅ 任务成功完成
- ✅ GDD 文件生成

---

**详细文档**: `PLANNING_AGENT_E2E_TEST.md`
