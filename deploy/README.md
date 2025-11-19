# Deploy 目录说明

## 目录结构

```
deploy/
└── workers/
    └── Dockerfile    # Workflow Consumer 容器镜像
```

## Dockerfile 用途

**workers/Dockerfile** - 用于构建 Workflow Consumer（Kafka 消费者）的容器镜像。

### 构建镜像

```bash
# 在项目根目录执行
docker build -f deploy/workers/Dockerfile -t my-agent-test-worker:latest .
```

### 运行容器

```bash
docker run -d \
  --name workflow-consumer \
  -e KAFKA_BROKERS=kafka:9092 \
  -e MYSQL_URL=mysql://user:pass@mysql:3306/dbname \
  -e REDIS_URL=redis://redis:6379 \
  my-agent-test-worker:latest
```

## 完整部署方案

详细的部署指南请参考：

- **[../DEPLOYMENT.md](../DEPLOYMENT.md)** - 完整的本地/Docker/分布式部署指南
- **[../docs/architecture-distributed.md](../docs/architecture-distributed.md)** - 分布式架构设计文档

包含：
- Docker Compose 配置
- Kubernetes 部署示例
- 多节点集群配置
- 负载均衡和高可用设置
