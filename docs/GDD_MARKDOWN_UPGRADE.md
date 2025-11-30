# GDD Markdown 格式升级指南

## 概述

Planning Agent 已升级为使用 **Markdown + YAML Frontmatter** 作为 GDD 的主存储格式。

## 主要改进

### 🎯 架构变化

#### 之前（JSON 格式）
```json
{
  "projectId": "proj-001",
  "projectName": "魔法世界冒险",
  "coreConcept": "一款 3D ARPG 游戏...",
  "gameplayMechanics": [...]
}
```

**问题**：
- ❌ 人类难以阅读和编辑
- ❌ 缺少富文本支持（表格、代码块）
- ❌ Git diff 不友好
- ❌ 无法直接用于文档评审

#### 现在（Markdown + YAML Frontmatter）
```markdown
---
projectId: "proj-001"
projectName: "魔法世界冒险"
gameType: "rpg"
createdAt: "2025-11-30T10:00:00Z"
---

# 游戏设计文档

## 1. 核心概念

一款 3D ARPG 游戏，玩家扮演魔法学徒...

## 2. 核心玩法机制

### 2.1 魔法战斗系统

| 元素 | 克制 | 特性 |
|------|------|------|
| 火   | 冰   | 持续伤害 |
...
```

**优势**：
- ✅ 人类友好：易于阅读、编辑、评审
- ✅ 富文本支持：表格、代码块、列表、图表
- ✅ Git 友好：diff 清晰可读
- ✅ 版本控制：Markdown 天然适合版本管理
- ✅ 双格式输出：同时生成 JSON（向后兼容）
- ✅ AI 自然输出：模型天然生成 Markdown

---

## 技术实现

### 1. 新增组件

#### **GDDMarkdownService** (`src/services/GDDMarkdownService.ts`)

核心功能：
- `saveGDD(projectId, gdd, markdown)` - 保存 Markdown + YAML frontmatter
- `readGDD(projectId)` - 读取并解析为 GDD 对象
- `extractStructuredData(markdown)` - 从 Markdown 提取结构化数据
- `exportToHTML(projectId)` - 导出为 HTML（用于预览）

#### **AIModel.generateGDDMarkdown()** (`src/agents/planning/index.ts:618-720`)

新的主要生成方法：
- 输入：`userInput, agentMeta, planningFocus`
- 输出：完整的 Markdown 格式 GDD
- 智能提示词构建：根据 `agentMeta.specialization` 和 `planningFocus` 动态调整
- 参考示例：使用 `src/templates/gdd-example.md` 作为格式参考

### 2. 文件结构变化

#### 项目目录结构

```
./data/projects/{projectId}/
├── gdd.md              ← 🔥 主存储格式（Markdown）
├── gdd.json            ← 向后兼容（JSON）
└── gdd.metadata.json   ← 可选（额外元数据）
```

#### Artifact 返回格式

Planning Agent 现在返回两个 artifacts：

```typescript
[
  {
    artifactId: "...",
    stageId: "planning",
    type: "document",
    format: "gdd.md",                    // 主要格式
    url: "./data/projects/.../gdd.md",
    source: "llm",
    metadata: {
      format: "markdown",
      purpose: "human-readable",
      hasYAMLFrontmatter: true
    }
  },
  {
    artifactId: "...",
    stageId: "planning",
    type: "document",
    format: "gdd.json",                  // 兼容格式
    url: "./data/projects/.../gdd.json",
    source: "llm",
    metadata: {
      format: "json",
      purpose: "machine-readable"
    }
  }
]
```

---

## 使用方法

### 测试单 Agent (Planning Agent)

#### 1. 安装依赖

```bash
cd E:\NodeProject\my-agent-test
npm install gray-matter
```

#### 2. 启动服务

```bash
# 终端 1：启动 A2A Server
npm run start:a2a-server

# 终端 2：启动 Planning Agent
npm run start:planning-agent
```

#### 3. 发送测试请求

```bash
curl -X POST http://localhost:8090/api/executions/preview \
  -H "Content-Type: application/json" \
  -d '{
    "stageId": "planning",
    "userInput": {
      "projectName": "魔法世界冒险",
      "gameGenre": {
        "primary": "rpg",
        "subGenre": "action_rpg"
      },
      "dimension": "3d",
      "artStyle": "realistic",
      "gameMode": "singleplayer",
      "additionalRequirements": "需要魔法系统、装备系统、公会系统"
    },
    "stageConfig": {
      "stageId": "planning",
      "model": "deepseek-r1",
      "agentMeta": {
        "specialization": "rpg-design",
        "extraTraits": "economy-balancing,social-system-design"
      },
      "planningFocus": {
        "narrative": true,
        "numeric": true,
        "systemDesign": {
          "growth": true,
          "equipment": true,
          "social": true,
          "combat": true
        }
      }
    }
  }'
```

#### 4. 查看生成的 GDD

```bash
# 查看 Markdown 格式（主要格式，人类阅读）
cat ./data/projects/preview-{projectId}/gdd.md

# 查看 JSON 格式（兼容格式，程序处理）
cat ./data/projects/preview-{projectId}/gdd.json
```

---

## 参数说明

### 🔥 planningFocus 如何影响 Markdown 输出

| planningFocus 字段 | Markdown 中的体现 |
|-------------------|------------------|
| `narrative: true` | 添加详细的 **"## 9. 故事节拍"** 章节 |
| `numeric: true` | 添加详细的 **"## 10. 数值设计"** 章节（包含公式和计算） |
| `levelDesign: true` | 扩展 **"## 4. 关卡设计"** 章节（关卡蓝图、难度曲线） |
| `systemDesign.growth` | 扩展 **"## 11. 系统设计"** 中的成长系统 |
| `systemDesign.equipment` | 扩展装备系统（强化、套装、词缀） |
| `systemDesign.combat` | 扩展战斗系统（技能、连招、平衡） |
| `systemDesign.social` | 扩展社交系统（好友、公会、排行榜） |

### 🔥 agentMeta 如何影响提示词

```typescript
agentMeta: {
  specialization: "rpg-design",     // → "你专精于 rpg-design 类型的游戏设计"
  extraTraits: "economy-balancing"  // → "你的额外专长包括：economy-balancing"
}
```

这些参数会注入到 AI 提示词中，影响生成的 GDD 质量和专业性。

---

## 向后兼容性

### 其他 Agent 如何读取 GDD

#### 方式 1：优先读取 Markdown（推荐）

```typescript
import { GDDMarkdownService } from "../services/GDDMarkdownService";

// Art Agent, Music Agent, Tech Agent
const { gdd, markdown } = await GDDMarkdownService.readGDD(projectId);

// 可以读取 Markdown 原文（包含富文本）
console.log(markdown);

// 也可以使用解析后的结构化数据
console.log(gdd.artRequirements);
```

#### 方式 2：降级到 JSON（兼容旧代码）

```typescript
import fs from "fs-extra";

// 旧代码仍然可以工作（Planning Agent 同时生成 JSON）
const gdd = fs.readJSONSync(`./data/projects/${projectId}/gdd.json`);
```

---

## 下一步工作

### ✅ 已完成
1. ✅ 创建 Markdown 模板和示例
2. ✅ 实现 GDDMarkdownService（解析、保存）
3. ✅ 更新 Planning Agent 生成 Markdown
4. ✅ 双格式输出（Markdown + JSON）
5. ✅ 更新 Artifact 返回格式

### 🚧 待完成
1. ⏳ 更新其他 Agents（Art, Music, Tech）读取 Markdown
2. ⏳ 更新 A2A Server 的 artifact 处理逻辑
3. ⏳ 添加 PDF/HTML 导出功能（用于文档评审）
4. ⏳ 集成真实 AI API（替换 mock 生成）
5. ⏳ 添加 Markdown 编辑器集成（game-factory 前端）

---

## 示例输出

查看完整示例：
- **模板参考**：`src/templates/gdd-example.md`
- **生成示例**：运行测试后查看 `./data/projects/preview-{id}/gdd.md`

---

## 常见问题

### Q: 为什么还保留 JSON 格式？

A: 向后兼容。现有的其他 Agents（Art, Music, Tech）仍然依赖 JSON 解析。我们会逐步迁移它们使用 `GDDMarkdownService`。

### Q: 如何自定义 Markdown 模板？

A: 修改 `src/templates/gdd-example.md`，AI 会参考这个模板生成 GDD。

### Q: 支持图片和图表吗？

A: 当前 Markdown 支持图片链接（`![alt](url)`）。图表可以使用 Mermaid 语法（需要额外配置渲染）。

### Q: 如何导出为 PDF？

A: 调用 `GDDMarkdownService.exportToHTML(projectId)`，然后使用 Puppeteer 或其他工具将 HTML 转为 PDF。

---

*本文档由 Claude Code 协助生成 | 最后更新: 2025-11-30*
