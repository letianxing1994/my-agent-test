#!/bin/bash

# 完整工作流启动脚本（Linux/Mac）

set -e

echo "🚀 启动 my-agent-test 完整工作流测试环境"
echo "================================================"

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker 未运行，请先启动 Docker${NC}"
    exit 1
fi

# 1. 启动外部依赖
echo -e "\n${GREEN}📦 步骤 1: 启动外部依赖（Kafka, MySQL, Redis）${NC}"
docker-compose up -d

# 等待服务就绪
echo -e "${YELLOW}⏳ 等待服务启动...${NC}"
sleep 15

# 检查服务健康状态
echo -e "\n${GREEN}🔍 检查服务健康状态${NC}"
docker-compose ps

# 2. 创建 Kafka Topics
echo -e "\n${GREEN}📋 步骤 2: 创建 Kafka Topics${NC}"

KAFKA_CONTAINER=$(docker ps -qf "name=my-agent-kafka")

if [ -z "$KAFKA_CONTAINER" ]; then
    echo -e "${RED}❌ Kafka 容器未找到${NC}"
    exit 1
fi

# 创建 topics
for topic in workflow-tasks workflow-results agent-events; do
    echo -e "  创建 topic: ${topic}"
    docker exec $KAFKA_CONTAINER kafka-topics \
        --create \
        --if-not-exists \
        --topic $topic \
        --bootstrap-server localhost:9092 \
        --partitions 3 \
        --replication-factor 1 2>/dev/null || true
done

# 验证 topics
echo -e "\n${GREEN}✅ 已创建的 Topics:${NC}"
docker exec $KAFKA_CONTAINER kafka-topics \
    --list \
    --bootstrap-server localhost:9092

# 3. 显示启动指令
echo -e "\n${GREEN}🖥️  步骤 3: 启动 my-agent-test 服务${NC}"
echo -e "${YELLOW}请在不同的终端中执行以下命令：${NC}"
echo ""
echo -e "${GREEN}终端 1 - A2A Server:${NC}"
echo "  npm run start:a2a-server"
echo ""
echo -e "${GREEN}终端 2 - Workflow Consumer:${NC}"
echo "  npm run start:workflow-consumer"
echo ""
echo -e "${GREEN}终端 3 - Planning Agent:${NC}"
echo "  npm run start:planning-agent"
echo ""
echo -e "${GREEN}终端 4 - Art Agent:${NC}"
echo "  npm run start:art-agent"
echo ""
echo -e "${GREEN}终端 5 - Music Agent:${NC}"
echo "  npm run start:music-agent"
echo ""
echo -e "${GREEN}终端 6 - Tech Agent:${NC}"
echo "  npm run start:tech-agent"
echo ""
echo -e "${GREEN}终端 7 - Test Agent:${NC}"
echo "  npm run start:test-agent"
echo ""

# 4. 显示测试命令
echo -e "\n${GREEN}🧪 步骤 4: 测试工作流${NC}"
echo -e "${YELLOW}所有服务启动后，运行：${NC}"
echo ""
echo "  curl -X POST http://localhost:8080/api/executions \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d @test-execution-request.json"
echo ""

# 5. 显示停止命令
echo -e "\n${GREEN}🛑 停止所有服务:${NC}"
echo "  docker-compose down"
echo ""

echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}✅ 外部依赖已启动，请启动 my-agent-test 服务${NC}"
echo -e "${GREEN}================================================${NC}"
