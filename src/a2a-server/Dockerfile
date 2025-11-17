# 使用Node.js官方镜像作为基础镜像
FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 复制package.json和package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm install --production

# 复制项目文件
COPY dist ./dist
COPY data ./data

# 确保data目录存在
RUN mkdir -p /app/data/projects /app/data/assets/images /app/data/assets/audio /app/data/assets/code /app/data/reports /app/data/knowledge-base

# 暴露端口
EXPOSE 8080

# 设置环境变量
ENV NODE_ENV=production
ENV A2A_PORT=8080

# 启动命令
CMD ["node", "dist/a2a-server/index.js"]