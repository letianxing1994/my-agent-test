# 用户游戏描述在提示词中的位置分析

## 📍 核心发现

用户的游戏描述通过 `userInput.additionalRequirements` 字段传入，在提示词的 **第 687 行** 生效。

---

## 🔍 完整的提示词结构

### 1. 系统角色设定
```
你是一位资深的游戏策划专家，擅长设计各类游戏的核心玩法和系统架构。
```

### 2. 用户需求部分（第 680-688 行）
```markdown
## 用户需求

- **项目名称**: ${userInput.projectName || "待定"}
- **游戏类型**: ${primaryGenre}${subGenre ? ` (${subGenre})` : ""}
- **游戏维度**: ${userInput.dimension}              (2d/3d)
- **美术风格**: ${userInput.artStyle}               (realistic/cartoon/pixel/anime/abstract)
- **游戏模式**: ${userInput.gameMode}               (singleplayer/multiplayer)
- **附加需求**: ${userInput.additionalRequirements || "无"}  ← 👈 用户描述在这里！
${focusPrompt}                                      ← planningFocus 配置（可选）
```

### 3. 输出要求
- 格式要求
- 结构要求
- 内容深度要求
- 专业性要求
- 表格和格式要求

### 4. 参考示例
- 包含完整的 GDD Markdown 示例模板

---

## 📊 数据流向图

```
┌──────────────────────┐
│  用户在前端输入       │
│  "创建一个开放世界   │
│   RPG，包含魔法系统" │
└─────────┬────────────┘
          │
          ↓
┌──────────────────────────────┐
│  Game-Factory Backend        │
│  POST /api/preview-tasks     │
│  {                           │
│    project: {                │
│      description: "..."  ←─┐ │
│    }                        │ │
│  }                          │ │
└─────────┬───────────────────┘ │
          │                     │
          ↓                     │
┌──────────────────────────────┐│
│  My-Agent-Test               ││
│  POST /api/executions/preview││
│  {                           ││
│    userInput: {              ││
│      additionalRequirements  ││  ← 映射
│    }                         ││
│  }                           ││
└─────────┬────────────────────┘│
          │                     │
          ↓                     │
┌──────────────────────────────┐│
│  Planning Agent              ││
│  generateGDDMarkdown()       ││
│                              ││
│  构建提示词（第 687 行）：   ││
│  - **附加需求**: ${...}  ←──┘
│                              │
│  调用 LLM (DeepSeek/GPT)     │
└─────────┬────────────────────┘
          │
          ↓
┌──────────────────────┐
│  生成的 GDD 文档      │
│  (Markdown 格式)     │
└──────────────────────┘
```

---

## 💡 当前位置的特点

### ✅ 优势
1. **位置合理**：在所有基础参数（类型、维度、风格）之后
2. **命名清晰**："附加需求"这个标签很直观
3. **可选字段**：如果用户不填，默认为"无"

### ⚠️ 潜在问题
1. **权重较低**：排在最后一项，可能被 LLM 忽略
2. **标签不够突出**："附加需求"可能让 LLM 认为是次要信息
3. **没有强调**：没有用粗体、大写或其他方式强调重要性

---

## 🔧 优化建议

### 方案 1：提升位置和权重（推荐）

将用户描述移到更靠前的位置，并增强其重要性：

```typescript
// planning/index.ts:676-688
const prompt = `你是一位资深的游戏策划专家，擅长设计各类游戏的核心玩法和系统架构。${specializationPrompt}

请根据以下用户需求，生成一份完整的游戏设计文档（GDD），以 **Markdown 格式** 输出。

## 用户需求

- **项目名称**: ${userInput.projectName || "待定"}
- **游戏类型**: ${primaryGenre}${subGenre ? ` (${subGenre})` : ""}
- **游戏维度**: ${userInput.dimension}
- **美术风格**: ${userInput.artStyle}
- **游戏模式**: ${userInput.gameMode}

${userInput.additionalRequirements ? `### 🎯 核心设计要求（重点关注）

${userInput.additionalRequirements}

请特别注意：上述核心设计要求是用户最关心的部分，必须在GDD中详细体现和落实。

` : ''}${focusPrompt}
...
```

**改进点**：
- ✅ 用 `###` 标题单独突出
- ✅ 使用 🎯 emoji 增加视觉突出
- ✅ 添加"核心设计要求"标签，强调重要性
- ✅ 在下方补充一句强调语句

---

### 方案 2：在系统提示词中强调

在最开始的系统角色设定中就强调用户描述的重要性：

```typescript
const prompt = `你是一位资深的游戏策划专家，擅长设计各类游戏的核心玩法和系统架构。${specializationPrompt}

**重要提示**：用户会在"附加需求"或"核心设计要求"部分提供关键的设计描述，这些描述必须作为GDD设计的核心依据，优先级最高。

请根据以下用户需求，生成一份完整的游戏设计文档（GDD），以 **Markdown 格式** 输出。
...
```

---

### 方案 3：结构化用户描述

如果用户描述很长或包含多个要点，可以进行结构化处理：

```typescript
// 在构建提示词前，解析 additionalRequirements
let userRequirementsPrompt = '';
if (userInput.additionalRequirements) {
  const requirements = userInput.additionalRequirements
    .split(/[。\n]/)
    .filter(r => r.trim())
    .map((req, i) => `${i + 1}. ${req.trim()}`)
    .join('\n');

  userRequirementsPrompt = `
### 📋 用户核心设计需求

${requirements}

**设计重点**：以上每一条需求都必须在GDD的对应章节中详细阐述，确保可执行性和可实现性。
`;
}

const prompt = `...
## 用户需求

- **项目名称**: ${userInput.projectName || "待定"}
- **游戏类型**: ${primaryGenre}${subGenre ? ` (${subGenre})` : ""}
- **游戏维度**: ${userInput.dimension}
- **美术风格**: ${userInput.artStyle}
- **游戏模式**: ${userInput.gameMode}
${userRequirementsPrompt}
${focusPrompt}
...
`;
```

**效果示例**：
```markdown
### 📋 用户核心设计需求

1. 创建一个3D开放世界RPG游戏
2. 包含丰富的魔法系统，支持多种元素组合
3. 装备系统要有深度，包括随机属性和套装效果
4. 多分支剧情，玩家选择影响结局

**设计重点**：以上每一条需求都必须在GDD的对应章节中详细阐述，确保可执行性和可实现性。
```

---

### 方案 4：双重强调（最强）

同时在开头和需求部分强调：

```typescript
const prompt = `你是一位资深的游戏策划专家，擅长设计各类游戏的核心玩法和系统架构。${specializationPrompt}

**📢 关键提示**：本次设计的核心要求将在"用户核心设计需求"部分明确说明，这些要求是GDD设计的最高优先级，必须深入体现在文档的各个章节中。

请根据以下用户需求，生成一份完整的游戏设计文档（GDD），以 **Markdown 格式** 输出。

## 用户需求

### 基础配置
- **项目名称**: ${userInput.projectName || "待定"}
- **游戏类型**: ${primaryGenre}${subGenre ? ` (${subGenre})` : ""}
- **游戏维度**: ${userInput.dimension}
- **美术风格**: ${userInput.artStyle}
- **游戏模式**: ${userInput.gameMode}

${userInput.additionalRequirements ? `### 🎯 用户核心设计需求（最高优先级）

${userInput.additionalRequirements}

**⚠️ 重要说明**：
- 上述需求是用户最关心的核心内容
- 必须在GDD的"核心玩法"、"系统设计"等章节中详细展开
- 确保每条需求都有对应的具体设计方案
- 避免泛泛而谈，要有可执行的实现细节

` : ''}${focusPrompt}
...
```

---

## 📈 推荐实施方案

根据你的需求复杂度选择：

| 方案 | 适用场景 | 实施难度 | 效果提升 |
|------|---------|---------|----------|
| **方案 1** | 用户描述通常较短（1-2句） | ⭐ 简单 | ⭐⭐⭐ 中等 |
| **方案 2** | 想快速见效，改动最小 | ⭐ 简单 | ⭐⭐ 较小 |
| **方案 3** | 用户描述较长，包含多个要点 | ⭐⭐ 中等 | ⭐⭐⭐⭐ 较大 |
| **方案 4** | 用户描述非常重要，必须严格遵守 | ⭐⭐ 中等 | ⭐⭐⭐⭐⭐ 最大 |

**我的建议**：优先尝试 **方案 4**（双重强调），如果觉得太啰嗦，再回退到 **方案 1**。

---

## 🧪 测试建议

修改后，用以下测试案例验证效果：

### 测试用例 1：具体功能描述
```json
{
  "additionalRequirements": "创建一个魔法主题的RPG游戏，包含5种元素系统（火、水、土、风、雷），玩家可以组合不同元素产生协同效果。装备系统支持随机词缀和套装加成。"
}
```

**预期**：GDD 中应该有详细的：
- 5 种元素的具体设计
- 元素组合机制和效果表
- 装备系统的词缀池设计
- 套装系统的完整设计

---

### 测试用例 2：玩法特色描述
```json
{
  "additionalRequirements": "希望游戏有独特的时间循环机制，玩家可以回到过去改变历史，但每次循环会产生不同的蝴蝶效应。"
}
```

**预期**：GDD 中应该有：
- 时间循环系统的核心机制
- 历史分支的设计
- 蝴蝶效应的规则和示例
- 相关的UI和交互设计

---

### 测试用例 3：世界观描述
```json
{
  "additionalRequirements": "背景设定在蒸汽朋克风格的浮空岛屿世界，各个岛屿之间通过飞艇连接，玩家扮演飞艇船长探索未知领域。"
}
```

**预期**：GDD 中应该有：
- 蒸汽朋克风格的具体视觉描述
- 浮空岛屿的世界设计
- 飞艇系统的详细机制
- 探索玩法的设计

---

## 🔗 相关文件

- **提示词构建**: `src/agents/planning/index.ts:676-721`
- **用户输入类型**: `src/types.ts:75-115`
- **前端接口**: `game-factory/backend/src/routes/previewTasks.ts`

---

## ✅ 总结

1. **当前位置**：`userInput.additionalRequirements` → 提示词第 687 行
2. **当前标签**："附加需求"
3. **优化方向**：提升权重、增强视觉突出、添加强调说明
4. **推荐方案**：方案 4（双重强调）或方案 1（提升位置）
