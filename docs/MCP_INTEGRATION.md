# MCP 本地工具集成使用指南

## 概述

MCP (Model Context Protocol) 集成允许你将本地 DCC 工具（Blender、Maya、Photoshop 等）和游戏引擎（Unity、Unreal）与 my-agent-test 系统连接，实现：

1. **实时监控** - 自动检测工具输出的新文件
2. **自动上传** - 将本地生成的资源同步到云端
3. **Agent 协作** - 让 AI Agent 可以使用你在本地工具中创建的资源

## 功能特性

### 1. 用户资产上传服务 (UserAssetService)

允许用户上传现成的素材供 Agent 使用：

- **支持的资产类型**：
  - 策划文档 (planning_doc)
  - 美术概念图 (art_concept)
  - 纹理贴图 (art_texture)
  - 3D 模型 (art_model)
  - 动画文件 (art_animation)
  - 背景音乐 (audio_music)
  - 音效 (audio_sfx)
  - 源代码 (code_source)
  - 资源包 (code_asset)

### 2. MCP 连接器 (MCPConnector)

管理本地工具的连接和文件监控：

- **支持的工具**：
  - Blender (3D 建模)
  - Maya (3D 建模)
  - Photoshop (图像处理)
  - Unity (游戏引擎)
  - Unreal Engine (游戏引擎)
  - Reaper / Logic Pro (音频编辑)
  - VS Code (代码编辑)

### 3. 资源同步服务 (ResourceSyncService)

监控本地目录，自动同步到云端：

- 实时文件监控
- 智能文件过滤
- 失败重试机制
- 同步状态查询

## 快速开始

### 1. 配置 MCP 工具

复制配置模板：

```bash
cp config/mcp-tools.example.json config/mcp-tools.json
```

编辑 `config/mcp-tools.json`，配置你的工具路径：

```json
{
  "tools": [
    {
      "type": "blender",
      "name": "blender-main",
      "executablePath": "C:/Program Files/Blender Foundation/Blender 4.0/blender.exe",
      "workingDirectory": "./data/projects/your-project-id/blender",
      "autoSync": true,
      "watchPatterns": ["*.blend", "*.fbx", "*.obj", "*.gltf"]
    }
  ],
  "cloudProvider": "aliyun",
  "syncInterval": 60000
}
```

### 2. 在代码中使用

#### 注册 MCP 工具

```typescript
import { mcpConnector } from "./services/MCPConnector";

// 注册 Blender
mcpConnector.registerTool({
  type: "blender",
  name: "blender-main",
  executablePath: "C:/Program Files/Blender Foundation/Blender 4.0/blender.exe",
  workingDirectory: "./data/projects/project-123/blender",
  autoSync: true,
  watchPatterns: ["*.blend", "*.fbx", "*.obj", "*.gltf", "*.png"],
});

// 连接工具（如果需要 MCP 服务器）
await mcpConnector.connectTool("blender", "blender-main");

// 监听文件输出
mcpConnector.on("output", (event) => {
  console.log("新文件生成:", event.filePath);
});

// 监听上传完成
mcpConnector.on("uploaded", (event) => {
  console.log("已上传到云端:", event.cloudUrl);
});
```

#### 配置资源同步

```typescript
import { resourceSyncService } from "./services/ResourceSyncService";

// 添加项目同步配置
resourceSyncService.addSyncConfig({
  projectId: "project-123",
  localDirectory: "./data/projects/project-123/assets",
  cloudPrefix: "projects/project-123/assets",
  provider: "aliyun",
  autoSync: true,
  syncInterval: 60000, // 每分钟扫描一次
  watchPatterns: ["*.png", "*.jpg", "*.fbx", "*.wav"],
  excludePatterns: ["**/temp/**", "**/.DS_Store"],
  maxRetries: 3,
});

// 监听同步事件
resourceSyncService.on("taskCompleted", (task) => {
  console.log("同步完成:", task.cloudUrl);
});

// 查询同步状态
const stats = resourceSyncService.getSyncStats("project-123");
console.log("同步统计:", stats);
```

#### 上传用户资产

```typescript
import { userAssetService } from "./services/UserAssetService";

// 上传美术概念图
const metadata = await userAssetService.uploadAsset("project-123", {
  assetType: "art_concept",
  fileName: "character_design.png",
  fileBuffer: imageBuffer,
  description: "主角角色设计概念图",
  tags: ["character", "protagonist", "concept"],
  cloudProvider: "aliyun",
  autoUploadToCloud: true,
});

console.log("资产已保存:", metadata.localPath);
console.log("云端地址:", metadata.cloudUrl);

// 获取 Art Agent 可用的素材
const artAssets = userAssetService.getAssetsForAgent("project-123", "art-agent");
```

## 工作流程示例

### 场景 1: 美术师在 Blender 中创建模型

1. **配置 Blender MCP 工具**

```typescript
mcpConnector.registerTool({
  type: "blender",
  name: "blender-main",
  executablePath: "C:/Program Files/Blender/blender.exe",
  workingDirectory: "./data/projects/game-01/blender",
  autoSync: true,
  watchPatterns: ["*.fbx", "*.gltf"],
});
```

2. **美术师在 Blender 中工作**
   - 创建 3D 模型
   - 导出为 FBX/GLTF 格式

3. **自动同步流程**
   - MCP Connector 检测到新文件
   - 自动上传到云端 (Aliyun OSS)
   - 通知 Art Agent 和 Tech Agent 有新资源可用

4. **Agent 使用资源**
   - Art Agent 可以引用该模型
   - Tech Agent 可以将其集成到游戏中

### 场景 2: 上传现成的音效文件

```typescript
import fs from "fs-extra";

// 读取本地音效文件
const audioBuffer = await fs.readFile("./my-sfx/explosion.wav");

// 上传到系统
const asset = await userAssetService.uploadAsset("game-01", {
  assetType: "audio_sfx",
  fileName: "explosion.wav",
  fileBuffer: audioBuffer,
  description: "爆炸音效",
  tags: ["sfx", "explosion", "action"],
  cloudProvider: "aliyun",
});

// Music Agent 和 Tech Agent 现在可以使用这个音效
```

### 场景 3: 批量同步本地资源

```typescript
// 扫描并同步整个项目目录
await resourceSyncService.scanAndSync("game-01");

// 查看同步进度
const stats = resourceSyncService.getSyncStats("game-01");
console.log(`总计: ${stats.total}, 完成: ${stats.completed}, 失败: ${stats.failed}`);

// 重试失败的任务
resourceSyncService.retryFailedTasks("game-01");
```

## API 端点示例

如果需要通过 REST API 使用这些功能，可以在 A2A 服务器中添加路由：

```typescript
// src/a2a-server/index.ts

// 上传用户资产
app.post("/api/user-assets/upload", upload.single("file"), async (req, res) => {
  const { projectId, assetType, description, tags } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: "未提供文件" });
  }

  const metadata = await userAssetService.uploadAsset(projectId, {
    assetType,
    fileName: file.originalname,
    fileBuffer: file.buffer,
    description,
    tags: tags ? JSON.parse(tags) : [],
    cloudProvider: "aliyun",
  });

  res.json({ success: true, metadata });
});

// 获取项目资产
app.get("/api/user-assets/:projectId", (req, res) => {
  const { projectId } = req.params;
  const { assetType, agentId } = req.query;

  let assets;
  if (agentId) {
    assets = userAssetService.getAssetsForAgent(projectId, agentId as string);
  } else {
    assets = userAssetService.getProjectAssets(
      projectId,
      assetType as UserAssetType,
    );
  }

  res.json({ assets });
});

// MCP 工具状态
app.get("/api/mcp/tools/status", (req, res) => {
  const status = mcpConnector.getToolsStatus();
  res.json({ tools: status });
});

// 同步统计
app.get("/api/sync/stats/:projectId", (req, res) => {
  const { projectId } = req.params;
  const stats = resourceSyncService.getSyncStats(projectId);
  res.json(stats);
});
```

## 配置参考

### 环境变量

确保 `.env` 文件包含云存储配置：

```env
# Aliyun OSS
ALIYUN_OSS_REGION=oss-cn-hangzhou
ALIYUN_OSS_ACCESS_KEY_ID=your-key-id
ALIYUN_OSS_ACCESS_KEY_SECRET=your-key-secret
ALIYUN_OSS_BUCKET=your-bucket-name

# 或 Google Cloud Storage
GCP_GCS_PROJECT_ID=your-project-id
GCP_GCS_BUCKET=your-bucket-name
GCP_GCS_CREDENTIALS=base64-encoded-json-or-file-path
```

### 文件模式匹配

支持的通配符：
- `*` - 匹配任意字符（不包括路径分隔符）
- `**` - 匹配任意字符（包括路径分隔符）
- `?` - 匹配单个字符

示例：
- `*.png` - 所有 PNG 图片
- `**/*.fbx` - 任意子目录下的 FBX 文件
- `Assets/**/*.prefab` - Unity Assets 目录下所有 prefab

## 故障排查

### 文件未自动同步

1. 检查文件监控是否启用：`autoSync: true`
2. 检查文件是否匹配 `watchPatterns`
3. 检查文件是否被 `excludePatterns` 排除
4. 查看同步状态：`resourceSyncService.getProjectTasks(projectId)`

### 上传失败

1. 检查云存储配置是否正确
2. 检查网络连接
3. 查看失败任务：`resourceSyncService.getProjectTasks(projectId, "failed")`
4. 手动重试：`resourceSyncService.retryFailedTasks(projectId)`

### MCP 工具未连接

1. 检查工具可执行文件路径是否正确
2. 检查工作目录是否存在
3. 查看工具状态：`mcpConnector.getToolStatus(type, name)`

## 最佳实践

1. **目录结构**
   - 为每个项目创建独立的工作目录
   - 按工具类型组织文件夹：`blender/`, `unity/`, `audio/` 等

2. **文件命名**
   - 使用描述性文件名
   - 避免特殊字符和中文（云存储兼容性）
   - 包含版本号：`character_v1.fbx`, `character_v2.fbx`

3. **性能优化**
   - 设置合理的 `syncInterval`（不要太频繁）
   - 使用 `excludePatterns` 排除临时文件
   - 大文件使用 `uploadMultipart` 方法

4. **错误处理**
   - 监听 `taskFailed` 事件
   - 定期检查失败任务并重试
   - 设置合理的 `maxRetries`

## 与 game-factory 集成

在 game-factory 前端添加资产管理界面：

```typescript
// frontend/src/pages/AssetManager.tsx
import React, { useState, useEffect } from "react";
import axios from "axios";

export default function AssetManager() {
  const [assets, setAssets] = useState([]);
  const [syncStats, setSyncStats] = useState(null);

  useEffect(() => {
    loadAssets();
    loadSyncStats();
  }, []);

  const loadAssets = async () => {
    const res = await axios.get("/api/user-assets/project-123");
    setAssets(res.data.assets);
  };

  const loadSyncStats = async () => {
    const res = await axios.get("/api/sync/stats/project-123");
    setSyncStats(res.data);
  };

  const uploadAsset = async (file, assetType) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("projectId", "project-123");
    formData.append("assetType", assetType);

    await axios.post("/api/user-assets/upload", formData);
    loadAssets();
  };

  return (
    <div>
      <h1>资产管理</h1>

      {/* 上传表单 */}
      <div>
        <input type="file" onChange={(e) => uploadAsset(e.target.files[0], "art_texture")} />
      </div>

      {/* 同步统计 */}
      {syncStats && (
        <div>
          <p>总计: {syncStats.total}</p>
          <p>完成: {syncStats.completed}</p>
          <p>进行中: {syncStats.syncing}</p>
          <p>失败: {syncStats.failed}</p>
        </div>
      )}

      {/* 资产列表 */}
      <div>
        {assets.map((asset) => (
          <div key={asset.assetId}>
            <h3>{asset.fileName}</h3>
            <p>{asset.description}</p>
            <a href={asset.cloudUrl}>下载</a>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## 总结

通过 MCP 集成，你可以：

✅ 在本地 DCC 工具中自由创作
✅ 自动同步资源到云端
✅ 让 AI Agent 使用你的原创素材
✅ 实现人机协同的游戏开发工作流

这使得 my-agent-test 不仅能完全依赖 AI 生成内容，还能充分利用人类创作者的专业技能和创意！
