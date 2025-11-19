# 📦 my-agent-test 部署指南

## 一、本地开发环境

### 1.1 前置依赖

```bash
Node.js >= 20.19.0
npm >= 10.x
```

### 1.2 快速启动

```bash
# 1. 克隆项目
git clone <repository-url>
cd my-agent-test

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp env.example .env

# 4. 编辑 .env 文件
# 必填配置：
PORT=3000                                    # A2A Server 端口
DEEPSEEK_API_KEY=sk-xxx                      # DeepSeek API Key (策划 Agent)
OPENAI_API_KEY=sk-xxx                        # OpenAI API Key (2D 美术/音乐)
MESHY_API_KEY=msy_xxx                        # Meshy API Key (3D 美术)
ANTHROPIC_API_KEY=sk-ant-xxx                 # Anthropic API Key (技术/测试)

# 云存储配置（二选一）：
ALIYUN_OSS_REGION=oss-cn-shanghai
ALIYUN_OSS_ACCESS_KEY_ID=xxx
ALIYUN_OSS_ACCESS_KEY_SECRET=xxx
ALIYUN_OSS_BUCKET=my-game-assets

# 或使用 GCP：
GCP_PROJECT_ID=my-project
GCP_STORAGE_BUCKET=my-game-assets
GCP_KEY_FILE=./gcp-service-account.json

# 5. 启动服务
npm start
# 服务运行在 http://localhost:3000
```

### 1.3 验证部署

```bash
# 健康检查
curl http://localhost:3000/health

# 测试 Agent 配置
curl http://localhost:3000/api/agent-test/configs
```

---

## 二、Docker 单机部署

### 2.1 使用 Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  my-agent-test:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - MESHY_API_KEY=${MESHY_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - ALIYUN_OSS_REGION=${ALIYUN_OSS_REGION}
      - ALIYUN_OSS_ACCESS_KEY_ID=${ALIYUN_OSS_ACCESS_KEY_ID}
      - ALIYUN_OSS_ACCESS_KEY_SECRET=${ALIYUN_OSS_ACCESS_KEY_SECRET}
      - ALIYUN_OSS_BUCKET=${ALIYUN_OSS_BUCKET}
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

```bash
# 启动
docker-compose up -d

# 查看日志
docker-compose logs -f my-agent-test

# 停止
docker-compose down
```

### 2.2 直接使用 Docker

```bash
# 构建镜像
docker build -t my-agent-test:latest .

# 运行容器
docker run -d \
  --name my-agent-test \
  -p 3000:3000 \
  -e PORT=3000 \
  -e DEEPSEEK_API_KEY=sk-xxx \
  -e OPENAI_API_KEY=sk-xxx \
  -e MESHY_API_KEY=msy_xxx \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -e ALIYUN_OSS_REGION=oss-cn-shanghai \
  -e ALIYUN_OSS_ACCESS_KEY_ID=xxx \
  -e ALIYUN_OSS_ACCESS_KEY_SECRET=xxx \
  -e ALIYUN_OSS_BUCKET=my-game-assets \
  -v $(pwd)/data:/app/data \
  my-agent-test:latest

# 查看日志
docker logs -f my-agent-test
```

---

## 三、分布式部署（Kafka 集群）

### 3.1 架构说明

```
┌─────────────┐      Kafka        ┌──────────────┐
│ game-factory│ ──────────────►   │ my-agent-test│
│  (Producer) │                    │  (Consumer)  │
└─────────────┘                    └──────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
              ┌─────▼─────┐         ┌────▼────┐          ┌────▼────┐
              │  Planning │         │   Art   │          │  Music  │
              │   Agent   │         │  Agent  │          │  Agent  │
              └───────────┘         └─────────┘          └─────────┘
```

### 3.2 部署步骤

**Step 1: 部署 Kafka 集群**

```bash
# 使用 docker-compose 快速部署 Kafka + Zookeeper
# 在项目根目录创建 docker-compose-kafka.yml
docker-compose -f docker-compose-kafka.yml up -d
```

**Step 2: 部署 Worker 节点**

```bash
# 构建 Worker 镜像
cd deploy/workers

# Planning Agent
docker build -f planning/Dockerfile -t my-agent-test-planning ..
docker run -d --name planning-agent \
  -e KAFKA_BROKERS=kafka:9092 \
  -e AGENT_TYPE=planning \
  my-agent-test-planning

# Art Agent (2D)
docker run -d --name art-agent-2d \
  -e KAFKA_BROKERS=kafka:9092 \
  -e AGENT_TYPE=art \
  -e AGENT_DIMENSION=2d \
  my-agent-test-art

# Art Agent (3D)
docker run -d --name art-agent-3d \
  -e KAFKA_BROKERS=kafka:9092 \
  -e AGENT_TYPE=art \
  -e AGENT_DIMENSION=3d \
  my-agent-test-art

# Music Agent
docker run -d --name music-agent \
  -e KAFKA_BROKERS=kafka:9092 \
  -e AGENT_TYPE=music \
  my-agent-test-music

# Tech Agent
docker run -d --name tech-agent \
  -e KAFKA_BROKERS=kafka:9092 \
  -e AGENT_TYPE=tech \
  my-agent-test-tech

# Test Agent
docker run -d --name test-agent \
  -e KAFKA_BROKERS=kafka:9092 \
  -e AGENT_TYPE=test \
  my-agent-test-test
```

**Step 3: 验证集群**

```bash
# 查看 Kafka topics
docker exec -it kafka kafka-topics.sh --list --bootstrap-server localhost:9092

# 查看 consumer groups
docker exec -it kafka kafka-consumer-groups.sh --list --bootstrap-server localhost:9092

# 监控消息
docker exec -it kafka kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic workflow-tasks \
  --from-beginning
```

---

## 四、配置说明

### 4.1 Agent 模型配置

编辑 `config/agentModels.default.json`：

```json
{
  "planning": {
    "provider": "deepseek",
    "model": "deepseek-r1",
    "systemPrompt": "你是游戏策划专家..."
  },
  "art": {
    "2d": {
      "provider": "openai",
      "model": "dall-e-3",
      "systemPrompt": "你是2D美术设计师..."
    },
    "3d": {
      "provider": "meshy",
      "model": "meshy-4",
      "fallback": {
        "provider": "openai",
        "model": "dall-e-3"
      },
      "systemPrompt": "你是3D美术设计师..."
    }
  },
  "music": {
    "provider": "openai",
    "model": "gpt-4o",
    "systemPrompt": "你是音频设计师..."
  },
  "tech": {
    "provider": "anthropic",
    "model": "claude-sonnet-4.5",
    "systemPrompt": "你是游戏开发工程师..."
  },
  "test": {
    "provider": "anthropic",
    "model": "claude-sonnet-4.5",
    "systemPrompt": "你是QA测试工程师..."
  }
}
```

**关键说明：**
- **美术 Agent 2D/3D 分离**：2D 游戏仅需 DALL-E-3 生成精灵图；3D 游戏需要 Meshy-4 生成模型 + DALL-E-3 生成贴图
- **fallback 机制**：当 Meshy API 失败时，自动降级到 DALL-E-3

### 4.2 云存储配置

**Aliyun OSS:**

```env
ALIYUN_OSS_REGION=oss-cn-shanghai
ALIYUN_OSS_ACCESS_KEY_ID=LTAI5xxx
ALIYUN_OSS_ACCESS_KEY_SECRET=xxx
ALIYUN_OSS_BUCKET=my-game-assets
```

**Google Cloud Storage:**

```env
GCP_PROJECT_ID=my-project-123456
GCP_STORAGE_BUCKET=my-game-assets
GCP_KEY_FILE=./gcp-service-account.json
```

### 4.3 执行模式配置

在 `config/cloud.default.json` 中配置默认云服务商：

```json
{
  "defaultProvider": "aliyun",
  "providers": {
    "aliyun": {
      "enabled": true,
      "maxFileSize": 5368709120
    },
    "gcp": {
      "enabled": false,
      "maxFileSize": 5368709120
    }
  }
}
```

---

## 五、监控与日志

### 5.1 日志查看

```bash
# 本地开发
npm start  # 日志输出到控制台

# Docker
docker logs -f my-agent-test

# 生产环境建议使用日志聚合
# - ELK Stack (Elasticsearch + Logstash + Kibana)
# - Loki + Grafana
```

### 5.2 性能监控

```bash
# 安装 PM2
npm install -g pm2

# 使用 PM2 启动
pm2 start npm --name "my-agent-test" -- start

# 查看监控
pm2 monit

# 查看日志
pm2 logs my-agent-test
```

---

## 六、故障排查

### 6.1 常见问题

**问题 1: API Key 无效**

```bash
# 症状：Agent 执行失败，返回 401 错误
# 解决：检查 .env 中的 API Key 是否正确
curl -H "Authorization: Bearer $OPENAI_API_KEY" https://api.openai.com/v1/models
```

**问题 2: 云存储上传失败**

```bash
# 症状：文件上传后返回 403 或 404
# 解决：检查 OSS Bucket 权限和跨域配置
# Aliyun OSS 控制台 -> Bucket -> 权限管理 -> 跨域设置
```

**问题 3: Kafka 连接失败**

```bash
# 症状：Consumer 无法启动，报 ECONNREFUSED
# 解决：检查 Kafka broker 地址
docker exec -it kafka kafka-broker-api-versions.sh --bootstrap-server localhost:9092
```

**问题 4: 美术 Agent 2D/3D 配置错误**

```bash
# 症状：创建 3D 游戏但美术 Agent 只生成 2D 图片
# 解决：确保前端传递 dimension 参数
# 检查 game-factory 的 agents 表是否有 dimension 字段
# 检查 agentModels.default.json 是否正确配置 art.2d 和 art.3d
```

### 6.2 调试模式

```bash
# 启用详细日志
export DEBUG=my-agent-test:*
npm start

# 测试单个 Agent
curl -X POST http://localhost:3000/api/agent-test/test \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "art",
    "dimension": "3d",
    "testInput": {
      "prompt": "生成一个中世纪骑士3D模型",
      "style": "realistic"
    }
  }'
```

---

## 七、安全建议

### 7.1 生产环境配置

```bash
# 1. 使用 HTTPS
# 在 Nginx 或 Load Balancer 配置 SSL 证书

# 2. 限制 API 访问
# 配置防火墙规则，仅允许 game-factory IP 访问

# 3. 使用密钥管理服务
# AWS Secrets Manager / Azure Key Vault / Aliyun KMS
# 避免在代码中硬编码 API Key

# 4. 启用 Rate Limiting
# 在 Nginx 或应用层配置请求限流
```

### 7.2 备份策略

```bash
# 定期备份配置文件和数据目录
tar -czf my-agent-test-backup-$(date +%Y%m%d).tar.gz \
  config/ \
  data/assets/ \
  data/knowledge-base/ \
  .env

# 上传到对象存储
aws s3 cp my-agent-test-backup-*.tar.gz s3://my-backups/
```

---

## 八、升级指南

### 8.1 版本更新

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 更新依赖
npm install

# 3. 检查配置变更
diff config/agentModels.default.json config/agentModels.default.json.new

# 4. 重新构建
npm run build

# 5. 重启服务
pm2 restart my-agent-test
# 或
docker-compose restart my-agent-test
```

### 8.2 数据迁移

```bash
# 如有配置格式变更，运行迁移脚本
node scripts/migrate-config.js

# 备份旧配置
cp config/agentModels.default.json config/agentModels.default.json.backup
```

---

## 九、联系与支持

- **文档**: [docs/architecture.md](docs/architecture.md)
- **Issues**: GitHub Issues
- **Discussion**: GitHub Discussions
