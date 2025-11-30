# 完整工作流测试指南

## 📋 概述

完整工作流模拟 **game-factory → Kafka → my-agent-test** 的生产环境流程，涉及多个服务和多个 Agent 协作。

```
┌─────────────────┐
│  game-factory   │  发送任务到 Kafka
└────────┬────────┘
         │
         ↓
    ┌─────────┐
    │  Kafka  │  workflow-tasks topic
    └────┬────┘
         │
         ↓
┌─────────────────────┐
│ workflow-consumer   │  消费任务，调用 A2A Server
└─────────┬───────────┘
          │
          ↓
    ┌──────────────┐
    │  A2A Server  │  调度 Agent 执行
    └──────┬───────┘
           │
           ├─ WebSocket ─→ Planning Agent
           ├─ WebSocket ─→ Art Agent
           ├─ WebSocket ─→ Music Agent
           ├─ WebSocket ─→ Tech Agent
           └─ WebSocket ─→ Test Agent
```

---

## 🚀 启动步骤

### 步骤 1：准备外部依赖

#### 1.1 启动 Kafka + ZooKeeper

**方式 A：使用 Docker Compose（推荐）**

创建 `docker-compose.kafka.yml`：

```yaml
version: '3.8'

services:
  zookeeper:
    image: confluentinc/cp-zookeeper:latest
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
      ZOOKEEPER_TICK_TIME: 2000
    ports:
      - "2181:2181"
    volumes:
      - zookeeper-data:/var/lib/zookeeper/data
      - zookeeper-logs:/var/lib/zookeeper/log

  kafka:
    image: confluentinc/cp-kafka:latest
    depends_on:
      - zookeeper
    ports:
      - "9092:9092"
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
    volumes:
      - kafka-data:/var/lib/kafka/data

volumes:
  zookeeper-data:
  zookeeper-logs:
  kafka-data:
```

启动：
```bash
docker-compose -f docker-compose.kafka.yml up -d
```

验证：
```bash
docker ps | grep kafka
# 应该看到 zookeeper 和 kafka 两个容器在运行
```

**方式 B：本地安装 Kafka**

```bash
# 下载 Kafka
wget https://downloads.apache.org/kafka/3.6.0/kafka_2.13-3.6.0.tgz
tar -xzf kafka_2.13-3.6.0.tgz
cd kafka_2.13-3.6.0

# 启动 ZooKeeper
bin/zookeeper-server-start.sh config/zookeeper.properties &

# 启动 Kafka
bin/kafka-server-start.sh config/server.properties &
```

#### 1.2 创建 Kafka Topics

```bash
# 使用 Docker 方式
docker exec -it <kafka-container-id> kafka-topics \
  --create --topic workflow-tasks \
  --bootstrap-server localhost:9092 \
  --partitions 3 \
  --replication-factor 1

docker exec -it <kafka-container-id> kafka-topics \
  --create --topic workflow-results \
  --bootstrap-server localhost:9092 \
  --partitions 3 \
  --replication-factor 1

docker exec -it <kafka-container-id> kafka-topics \
  --create --topic agent-events \
  --bootstrap-server localhost:9092 \
  --partitions 3 \
  --replication-factor 1

# 或者使用本地 Kafka
bin/kafka-topics.sh --create --topic workflow-tasks --bootstrap-server localhost:9092
bin/kafka-topics.sh --create --topic workflow-results --bootstrap-server localhost:9092
bin/kafka-topics.sh --create --topic agent-events --bootstrap-server localhost:9092
```

验证：
```bash
# Docker 方式
docker exec -it <kafka-container-id> kafka-topics \
  --list --bootstrap-server localhost:9092

# 本地方式
bin/kafka-topics.sh --list --bootstrap-server localhost:9092

# 应该看到：
# workflow-tasks
# workflow-results
# agent-events
```

#### 1.3 启动 MySQL（可选）

```yaml
# docker-compose.mysql.yml
version: '3.8'

services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: root123
      MYSQL_DATABASE: my_agent_test
    ports:
      - "3306:3306"
    volumes:
      - mysql-data:/var/lib/mysql

volumes:
  mysql-data:
```

```bash
docker-compose -f docker-compose.mysql.yml up -d
```

#### 1.4 启动 Redis（可选）

```bash
docker run -d -p 6379:6379 --name redis redis:alpine
```

---

### 步骤 2：配置环境变量

确保 `.env` 文件包含所有必需的配置：

```bash
# A2A Server
A2A_PORT=8080
A2A_SERVER_URL=ws://localhost:8080

# Kafka
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=my-agent-test
KAFKA_GROUP_ID=workflow-consumer-group

# MySQL（可选）
MYSQL_URL=mysql://root:root123@localhost:3306/my_agent_test

# Redis（可选）
REDIS_URL=redis://localhost:6379

# AI 模型
OPENAI_API_KEY=sk-...
# 或其他模型
DEEPSEEK_API_KEY=sk-...
QWEN_API_KEY=sk-...

# 云存储（可选，用于资源上传）
OSS_REGION=oss-cn-hangzhou
OSS_ACCESS_KEY_ID=...
OSS_ACCESS_KEY_SECRET=...
OSS_BUCKET=my-agent-test

# 预览超时
PREVIEW_TIMEOUT_MS=120000
```

---

### 步骤 3：启动 my-agent-test 服务

**推荐启动顺序**：

#### 终端 1：A2A Server（核心调度）
```bash
npm run start:a2a-server
```

**成功日志**：
```
A2A服务器启动在 http://localhost:8080
WebSocket服务器就绪
已加载 0 个项目
```

#### 终端 2：Workflow Consumer（Kafka 消费者）
```bash
npm run start:workflow-consumer
```

**成功日志**：
```
Workflow Consumer 启动成功
Kafka Connected
订阅 topic: workflow-tasks
等待任务...
```

#### 终端 3-7：启动所有 Agent

```bash
# 终端 3
npm run start:planning-agent

# 终端 4
npm run start:art-agent

# 终端 5
npm run start:music-agent

# 终端 6
npm run start:tech-agent

# 终端 7
npm run start:test-agent
```

**每个 Agent 成功日志**：
```
[Agent Name] Agent 正在连接到 A2A 服务器...
已连接到 A2A 服务器
[Agent Name] Agent 已注册，AgentID: [agent-id]
成功连接到A2A服务器
```

---

### 步骤 4：启动 game-factory（可选）

如果需要从 game-factory 发送真实任务：

```bash
cd ../game-factory

# 安装依赖
npm install

# 启动后端
npm run dev

# 或启动前后端
npm run start:all
```

---

## 🧪 测试完整工作流

### 方式一：通过 game-factory 发送任务

在 game-factory 的前端或 API 中创建游戏项目，系统会自动：

1. 在 `games` 表创建游戏记录
2. 发送 `WorkflowTaskMessage` 到 Kafka `workflow-tasks` topic
3. workflow-consumer 消费任务并调用 my-agent-test
4. Agents 依次执行任务

### 方式二：直接调用 my-agent-test API（绕过 Kafka）

```bash
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
      "gameGenre": { "primary": "rpg", "subGenre": "arpg" },
      "dimension": "3d",
      "artStyle": "anime",
      "gameMode": "singleplayer",
      "additionalRequirements": "需要魔法系统和装备系统"
    },
    "stages": [
      {
        "stageId": "planning",
        "agentId": "planning-agent",
        "model": "gpt-4",
        "mode": "llm+kb",
        "planningFocus": {
          "narrative": true,
          "numeric": true,
          "systemDesign": {
            "growth": true,
            "equipment": true,
            "combat": true
          }
        }
      },
      {
        "stageId": "art",
        "agentId": "art-agent",
        "model": "gpt-4",
        "mode": "llm+kb"
      },
      {
        "stageId": "music",
        "agentId": "music-agent",
        "model": "gpt-4",
        "mode": "llm+kb"
      },
      {
        "stageId": "tech",
        "agentId": "tech-agent",
        "model": "gpt-4",
        "mode": "llm+kb"
      },
      {
        "stageId": "test",
        "agentId": "test-agent",
        "model": "gpt-4",
        "mode": "llm+kb"
      }
    ]
  }'
```

**响应**：
```json
{
  "executionId": "exec-abc-123",
  "projectId": "789",
  "workflowId": "sequential-game-dev",
  "status": "running"
}
```

### 方式三：模拟 Kafka 消息（测试 workflow-consumer）

```bash
# 使用 kafka-console-producer 发送消息
docker exec -it <kafka-container-id> kafka-console-producer \
  --topic workflow-tasks \
  --bootstrap-server localhost:9092

# 然后输入 JSON（一行）：
{"jobId":"job-123","companyId":456,"ownerId":123,"enqueuedAt":"2025-11-30T10:00:00Z","payload":{"workflowId":"sequential-game-dev","executionMode":"sequential","cloudProvider":"aliyun","userId":123,"companyId":456,"projectId":"789","project":{"projectName":"魔法世界冒险","gameGenre":{"primary":"rpg"},"dimension":"3d","artStyle":"anime","gameMode":"singleplayer"},"stages":[{"stageId":"planning","agentId":"planning-agent","model":"gpt-4","mode":"llm+kb"}]}}
```

---

## 📊 监控执行过程

### 1. 查看 Execution 状态

```bash
# 获取执行详情
curl http://localhost:8080/api/executions/<executionId>
```

**响应示例**：
```json
{
  "executionId": "exec-abc-123",
  "projectId": "789",
  "userId": 123,
  "companyId": 456,
  "status": "running",
  "stages": {
    "planning": {
      "status": "completed",
      "startedAt": "2025-11-30T10:00:00Z",
      "completedAt": "2025-11-30T10:02:00Z",
      "artifacts": ["./data/users/123/projects/789/gdd.md"]
    },
    "art": {
      "status": "running",
      "startedAt": "2025-11-30T10:02:05Z"
    }
  }
}
```

### 2. 订阅 SSE 事件流

```bash
curl -N http://localhost:8080/api/executions/<executionId>/events
```

**事件示例**：
```
event: snapshot
data: {"executionId":"exec-abc-123","status":"running",...}

event: stage_started
data: {"stageId":"planning","timestamp":"2025-11-30T10:00:00Z"}

event: stage_completed
data: {"stageId":"planning","artifacts":[...],"timestamp":"2025-11-30T10:02:00Z"}

event: stage_started
data: {"stageId":"art","timestamp":"2025-11-30T10:02:05Z"}
```

### 3. 查看 Kafka 消息

```bash
# 查看 workflow-tasks 消息
docker exec -it <kafka-container-id> kafka-console-consumer \
  --topic workflow-tasks \
  --from-beginning \
  --bootstrap-server localhost:9092

# 查看 workflow-results 消息
docker exec -it <kafka-container-id> kafka-console-consumer \
  --topic workflow-results \
  --from-beginning \
  --bootstrap-server localhost:9092
```

### 4. 查看生成的文件

```bash
# 查看项目目录
ls -la ./data/users/123/projects/789/

# 应该看到：
# gdd.md          ← Planning Agent 生成的 GDD
# gdd.json        ← 兼容性 JSON
# assets/         ← 资源目录
#   art/          ← 美术资源
#   music/        ← 音乐资源
#   code/         ← 代码包
# reports/        ← 测试报告
```

---

## 🔍 常见问题

### 问题 1：Kafka 连接失败

**错误**：
```
KafkaJSConnectionError: Failed to connect to seed broker
```

**解决**：
1. 确认 Kafka 容器正在运行：`docker ps | grep kafka`
2. 检查 `.env` 中的 `KAFKA_BROKERS` 配置
3. 检查防火墙是否阻止 9092 端口

### 问题 2：workflow-consumer 无法消费消息

**错误**：`No messages received`

**检查**：
1. Topic 是否存在？
   ```bash
   docker exec -it <kafka-container-id> kafka-topics --list --bootstrap-server localhost:9092
   ```
2. Consumer Group 是否正常？
3. 发送测试消息验证

### 问题 3：Agent 连接失败

**错误**：`WebSocket connection failed`

**解决**：
1. 确认 A2A Server 已启动
2. 检查 `.env` 中的 `A2A_SERVER_URL`
3. 查看 A2A Server 日志，看是否有连接请求

### 问题 4：Execution 一直处于 awaiting_clarification

**原因**：Instruction Orchestrator 检测到需求不完整

**解决**：
```bash
# 查看需要澄清的问题
curl http://localhost:8080/api/executions/<executionId>/clarifications

# 回答问题
curl -X POST http://localhost:8080/api/executions/<executionId>/clarifications \
  -H "Content-Type: application/json" \
  -d '{
    "responses": [
      {"questionId": "q1", "answer": "ARPG"},
      {"questionId": "q2", "answer": "魔法、装备、成长"}
    ]
  }'
```

### 问题 5：某个 Agent 没有响应

**检查**：
1. Agent 进程是否在运行？
2. Agent 是否已连接到 A2A Server？（查看 A2A Server 日志）
3. Agent 日志是否有错误？

**调试**：
```bash
# 查看 A2A Server 中已连接的 Agent
curl http://localhost:8080/api/agents
```

---

## 📋 服务启动清单

打印并勾选：

### 外部依赖
- [ ] Kafka 容器运行中
- [ ] ZooKeeper 容器运行中
- [ ] Kafka Topics 已创建（workflow-tasks, workflow-results, agent-events）
- [ ] MySQL 运行中（可选）
- [ ] Redis 运行中（可选）

### my-agent-test 服务
- [ ] A2A Server 启动（端口 8080）
- [ ] Workflow Consumer 启动
- [ ] Planning Agent 已连接
- [ ] Art Agent 已连接
- [ ] Music Agent 已连接
- [ ] Tech Agent 已连接
- [ ] Test Agent 已连接

### 环境配置
- [ ] `.env` 文件配置完整
- [ ] AI API Key 已配置
- [ ] Kafka Brokers 地址正确
- [ ] 云存储配置（如果需要上传资源）

### game-factory（可选）
- [ ] game-factory backend 启动
- [ ] game-factory frontend 启动
- [ ] 数据库已初始化

---

## 🎯 最小测试集（不含 game-factory）

如果只想测试 my-agent-test 的完整工作流，最少需要：

1. **外部依赖**（1 个）：
   - Kafka + ZooKeeper（Docker Compose）

2. **my-agent-test 服务**（7 个）：
   - A2A Server
   - Workflow Consumer
   - Planning Agent
   - Art Agent
   - Music Agent
   - Tech Agent
   - Test Agent

**快速启动脚本**：

```bash
# start-all.sh
#!/bin/bash

echo "🚀 启动完整工作流测试环境"

# 1. 启动 Kafka
echo "📦 启动 Kafka + ZooKeeper..."
docker-compose -f docker-compose.kafka.yml up -d

# 等待 Kafka 就绪
sleep 10

# 2. 创建 Topics
echo "📋 创建 Kafka Topics..."
docker exec -it $(docker ps -qf "name=kafka") kafka-topics \
  --create --if-not-exists --topic workflow-tasks --bootstrap-server localhost:9092
docker exec -it $(docker ps -qf "name=kafka") kafka-topics \
  --create --if-not-exists --topic workflow-results --bootstrap-server localhost:9092

# 3. 启动服务（在新终端中）
echo "🖥️  启动服务（请在新终端中执行）："
echo "  终端 1: npm run start:a2a-server"
echo "  终端 2: npm run start:workflow-consumer"
echo "  终端 3: npm run start:planning-agent"
echo "  终端 4: npm run start:art-agent"
echo "  终端 5: npm run start:music-agent"
echo "  终端 6: npm run start:tech-agent"
echo "  终端 7: npm run start:test-agent"

echo "✅ Kafka 已启动，请在不同终端中启动 my-agent-test 服务"
```

---

## 📚 相关文档

- [单 Agent 测试指南](./PLANNING_AGENT_TEST_GUIDE.md) - 单独测试某个 Agent
- [工作流图表](./WORKFLOW_DIAGRAMS.md) - 可视化流程
- [projectId 实现指南](./PROJECTID_IMPLEMENTATION.md) - game-factory 集成
- [架构文档](./architecture-distributed.md) - 系统架构详解

---

*最后更新：2025-11-30*
