# 快速启动参考卡

## 🎯 启动方式对比

| 特性 | 单 Agent 测试 | 完整工作流 |
|------|------------|-----------|
| **适用场景** | 开发、快速迭代 | 集成测试、生产模拟 |
| **启动服务数** | 2 个 | 9+ 个 |
| **需要 Kafka** | ❌ | ✅ |
| **需要外部依赖** | ❌ | ✅ (Kafka, MySQL, Redis) |
| **启动时间** | < 30 秒 | 1-2 分钟 |
| **响应方式** | 同步返回 | 异步 SSE |
| **推荐度** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

---

## 🚀 单 Agent 测试（2 个服务）

### 启动服务

```bash
# 终端 1
npm run start:a2a-server

# 终端 2
npm run start:planning-agent
```

### 测试命令

**Windows PowerShell**:
```powershell
.\test-planning-preview.ps1
```

**Linux/Mac**:
```bash
bash test-planning-preview.sh
```

### 查看结果

```bash
ls ./data/projects/preview-*
cat ./data/projects/preview-xxxxxx/gdd.md
```

**详细指南**：[单 Agent 测试指南](./docs/PLANNING_AGENT_TEST_GUIDE.md)

---

## 🔥 完整工作流（9+ 个服务）

### 一键启动外部依赖

**Windows PowerShell**:
```powershell
.\start-full-workflow.ps1
```

**Linux/Mac**:
```bash
bash start-full-workflow.sh
```

### 手动启动 my-agent-test 服务

```bash
# 终端 1: A2A Server
npm run start:a2a-server

# 终端 2: Workflow Consumer
npm run start:workflow-consumer

# 终端 3-7: 各个 Agent
npm run start:planning-agent
npm run start:art-agent
npm run start:music-agent
npm run start:tech-agent
npm run start:test-agent
```

### 测试完整工作流

```bash
# 方式 1: 直接调用 API（绕过 Kafka）
curl -X POST http://localhost:8080/api/executions \
  -H "Content-Type: application/json" \
  -d @test-execution-request.json

# 方式 2: 通过 game-factory 发送任务
# (需要先启动 game-factory)
```

### 监控执行状态

```bash
# 查看状态
curl http://localhost:8080/api/executions/<executionId>

# 订阅事件流
curl -N http://localhost:8080/api/executions/<executionId>/events
```

**详细指南**：[完整工作流测试指南](./docs/FULL_WORKFLOW_TEST_GUIDE.md)

---

## 📋 服务清单

### 单 Agent 测试需要：

- [x] A2A Server (`npm run start:a2a-server`)
- [x] 目标 Agent (如 `npm run start:planning-agent`)

### 完整工作流需要：

**外部依赖**：
- [x] Kafka + ZooKeeper (Docker)
- [x] MySQL (可选)
- [x] Redis (可选)

**my-agent-test 服务**：
- [x] A2A Server
- [x] Workflow Consumer
- [x] Planning Agent
- [x] Art Agent
- [x] Music Agent
- [x] Tech Agent
- [x] Test Agent

---

## 🔧 常用命令

### Docker 管理

```bash
# 启动所有外部依赖
docker-compose up -d

# 查看运行状态
docker-compose ps

# 查看日志
docker-compose logs -f kafka

# 停止所有服务
docker-compose down

# 停止并删除数据
docker-compose down -v
```

### Kafka 管理

```bash
# 列出所有 Topics
docker exec -it my-agent-kafka kafka-topics \
  --list --bootstrap-server localhost:9092

# 查看消息
docker exec -it my-agent-kafka kafka-console-consumer \
  --topic workflow-tasks \
  --from-beginning \
  --bootstrap-server localhost:9092

# 发送测试消息
docker exec -it my-agent-kafka kafka-console-producer \
  --topic workflow-tasks \
  --bootstrap-server localhost:9092
```

### 项目管理

```bash
# 查看所有项目
curl http://localhost:8080/api/projects

# 查看特定项目
curl http://localhost:8080/api/projects/<projectId>

# 查看项目文件
ls -la ./data/users/<userId>/projects/<projectId>/
```

---

## 🆘 快速故障排查

### 问题：端口已被占用

```bash
# Windows
netstat -ano | findstr :8080
taskkill /PID <进程ID> /F

# Linux/Mac
lsof -ti:8080 | xargs kill -9
```

### 问题：Kafka 无法连接

```bash
# 检查容器状态
docker ps | grep kafka

# 重启 Kafka
docker-compose restart kafka

# 查看日志
docker-compose logs kafka
```

### 问题：Agent 无法连接到 A2A Server

1. 确认 A2A Server 已启动
2. 检查 `.env` 中的 `A2A_SERVER_URL`
3. 查看 A2A Server 终端日志

### 问题：Preview 超时

1. 确认目标 Agent 已启动
2. 检查 Agent 终端是否有错误
3. 增加超时时间（`.env` 中 `PREVIEW_TIMEOUT_MS`）

---

## 📚 相关文档

- [单 Agent 测试指南](./docs/PLANNING_AGENT_TEST_GUIDE.md)
- [完整工作流测试指南](./docs/FULL_WORKFLOW_TEST_GUIDE.md)
- [文档中心](./docs/README.md)
- [架构设计](./docs/architecture-distributed.md)

---

*快速参考 - 最后更新：2025-11-30*
