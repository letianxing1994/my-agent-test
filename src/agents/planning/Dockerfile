# 使用Node.js 20作为基础镜像
FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 设置时区（可选）
RUN apk --no-cache add tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone && \
    apk del tzdata

# 安装依赖
COPY package*.json ./
RUN npm install --production

# 复制应用代码
COPY dist/agents/planning ./dist/agents/planning
COPY dist/types.js ./dist/types.js

# 创建数据目录（用于存储项目文件）
RUN mkdir -p /app/data/projects

# 设置环境变量
ENV NODE_ENV=production
ENV A2A_SERVER_URL=ws://a2a-server:8080

# 运行应用
CMD ["node", "dist/agents/planning/index.js"]