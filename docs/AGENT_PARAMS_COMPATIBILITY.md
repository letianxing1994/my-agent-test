# Agent参数兼容性文档

## 概述

本文档说明 `game-factory` 和 `my-agent-test` 之间的agent参数映射关系。

## 架构说明

- **game-factory**: 前端+后端系统，管理公司、员工(agents)、项目和工作流
- **my-agent-test**: Agent执行系统，接收工作流请求并执行策划/美术/技术等任务

## 数据流向

```
game-factory (agents表) 
    → workflowBuilder.buildExecutionRequest()
    → HTTP POST /api/workflow/execute
    → my-agent-test (a2a-server)
    → Planning/Art/Tech/Test/Music Agents
```

## Agent字段映射

### game-factory agents表结构 (2025-11-19更新)

| 字段名 | 类型 | 说明 | 实际作用 |
|--------|------|------|---------|
| `id` | bigint | 主键 | 唯一标识 |
| `name` | varchar(100) | 员工名称 | 显示用 |
| `type` | varchar(20) | 员工类型 | `planner`/`artist`/`developer`/`tester`/`music` |
| `dimension` | varchar(10) | 维度 | **仅美术**：`2d`或`3d`（影响资产生成） |
| `ai_model` | varchar(50) | AI模型 | **核心**：`DeepSeek-R1`/`GPT-5`/`Claude-Sonnet-4.5`/`DALL-E-3`/`Meshy-4`等 |
| `specialization` | varchar(100) | 专业方向 | **核心**：策划=游戏类型(RPG/MOBA)，美术=风格(realistic/cartoon)，技术=架构(singleplayer/multiplayer) |
| `extra_traits` | text | 额外特点 | **核心**：影响系统提示词，如"擅长C++性能优化"、"精通像素艺术" |
| `owner_id` | bigint | 所有者用户ID | 关联users表 |
| `company_id` | bigint | 所属公司ID | 关联companies表 |
| `status` | varchar(20) | 状态 | `employed`/`available` |

### my-agent-test StageConfig接口

```typescript
export interface StageConfig {
  stageId: string;
  agentId: string;
  model: string;  // 从 ai_model 映射而来
  knowledgeBase?: string;
  mode: "llm+kb" | "llm+custom-kb" | "mcp-local" | "hybrid";
  tools?: JsonRecord;
  mcp?: { endpoint: string; token?: string };
  resources?: Array<{ type: string; url: string; metadata?: JsonRecord }>;
  outputFormats?: string[];
  expectedArtifacts?: Array<{ type: string; format?: string }>;
  planningFocus?: PlanningFocusConfig;
  
  // 新增：agent元数据
  agentMeta?: {
    dimension?: string;       // 从 dimension 映射
    specialization?: string;  // 从 specialization 映射
    extraTraits?: string;     // 从 extra_traits 映射
  };
}
```

## 参数映射逻辑

### 1. workflowBuilder.ts (game-factory)

```typescript
const stageConfig: StageConfigInput = {
  stageId: stage.stageId,
  agentId: stage.agentId,
  model: assignedEmployee?.ai_model || process.env.DEFAULT_MODEL,
  // ... 其他配置 ...
  
  // 传递agent特性
  agentMeta: assignedEmployee ? {
    dimension: assignedEmployee.dimension,           // agents.dimension
    specialization: assignedEmployee.specialization, // agents.specialization
    extraTraits: assignedEmployee.extra_traits,      // agents.extra_traits
  } : undefined,
};
```

### 2. Planning Agent使用

#### specialization → 游戏类型偏好
- `specialization: "rpg"` → 擅长RPG游戏策划，强化剧情/成长系统设计
- `specialization: "moba"` → 擅长MOBA游戏，强化英雄平衡/对抗设计
- `specialization: "slg"` → 擅长策略游戏，强化数值/经济系统设计

#### extraTraits → 系统提示词增强
- `"擅长数值平衡"` → AI模型生成时强调数值系统
- `"精通叙事设计"` → 强化故事分支和角色弧光设计

```typescript
// planning/index.ts
async generateGDD(userInput: UserInput, agentMeta?: StageConfig['agentMeta']) {
  if (agentMeta?.specialization) {
    console.log(`[模型提示] 策划专精于 ${agentMeta.specialization} 类型游戏设计`);
    // 根据specialization调整GDD生成策略
  }
  if (agentMeta?.extraTraits) {
    console.log(`[模型提示] 额外专长: ${agentMeta.extraTraits}`);
    // 将extraTraits加入AI模型的system prompt
  }
}
```

### 3. Art Agent使用

#### dimension → 2D/3D资产生成
- `dimension: "2d"` → 生成PNG/SVG等2D资产
- `dimension: "3d"` → 生成GLB/FBX等3D模型

#### specialization → 美术风格偏好
- `specialization: "realistic"` → 写实风格
- `specialization: "cartoon"` → 卡通风格
- `specialization: "pixel"` → 像素风格
- `specialization: "anime"` → 动漫风格

#### extraTraits → 美术技能增强
- `"精通PBR材质制作"` → 强化材质细节
- `"擅长角色建模"` → 优先处理角色资产

```typescript
// art/index.ts
async processGDD(projectId: string, gdd: GDD, stageConfig?: StageConfig) {
  const agentMeta = stageConfig?.agentMeta;
  const dimension = agentMeta?.dimension || gdd.dimension; // 优先使用agent的dimension
  const artStylePreference = agentMeta?.specialization;    // 风格偏好
  
  console.log(`美术Agent维度: ${dimension}`);
  console.log(`美术Agent风格专长: ${artStylePreference || '通用'}`);
  
  // 根据dimension和specialization生成对应类型和风格的资产
  const artRequirements = this.aiModel.analyzeArtRequirements(gdd, agentMeta);
}
```

### 4. Tech Agent使用

#### specialization → 技术架构偏好
- `specialization: "singleplayer"` → 单机游戏架构（简化，无网络层）
- `specialization: "multiplayer"` → 多人游戏架构（服务器/客户端分离）
- `specialization: "mobile"` → 移动端优化架构
- `specialization: "web"` → Web游戏架构（Three.js/PixiJS）

#### extraTraits → 技术专长
- `"擅长C++性能优化"` → 倾向使用原生引擎
- `"精通网络同步"` → 强化multiplayer架构设计
- `"熟悉WebGL"` → 倾向Three.js/Babylon.js

```typescript
// tech/index.ts
analyzeTechnicalRequirements(gdd: GDD, agentMeta?: StageConfig['agentMeta']) {
  const isMultiplayerFocused = agentMeta?.specialization === 'multiplayer';
  
  if (agentMeta?.specialization) {
    console.log(`[模型提示] 技术Agent专精 ${agentMeta.specialization} 架构`);
  }
  
  // 根据specialization选择合适的引擎和架构
  // multiplayer → 倾向Unity/Unreal（带网络支持）
  // web → 倾向Three.js/PixiJS
}
```

## 完整示例

### 示例1：创建一个RPG策划Agent

**game-factory前端创建：**
```typescript
{
  name: "王策划",
  type: "planner",
  ai_model: "DeepSeek-R1",           // 使用DeepSeek模型
  specialization: "rpg",              // 专精RPG游戏
  extra_traits: "擅长数值平衡和成长系统设计", // 额外专长
  company_id: 123
}
```

**传递到my-agent-test：**
```json
{
  "stageId": "planning",
  "agentId": "planning-agent",
  "model": "DeepSeek-R1",
  "agentMeta": {
    "specialization": "rpg",
    "extraTraits": "擅长数值平衡和成长系统设计"
  }
}
```

**Planning Agent处理：**
- AI模型选用DeepSeek-R1
- 生成GDD时强化RPG元素（装备系统、成长曲线、技能树）
- System prompt包含"擅长数值平衡和成长系统设计"

### 示例2：创建一个3D写实美术Agent

**game-factory前端创建：**
```typescript
{
  name: "李美工",
  type: "artist",
  dimension: "3d",                    // 3D美术
  ai_model: "Meshy-4",                // 使用Meshy 3D模型生成
  specialization: "realistic",        // 写实风格
  extra_traits: "精通PBR材质和高精度建模",
  company_id: 123
}
```

**传递到my-agent-test：**
```json
{
  "stageId": "art",
  "agentId": "art-agent",
  "model": "Meshy-4",
  "agentMeta": {
    "dimension": "3d",
    "specialization": "realistic",
    "extraTraits": "精通PBR材质和高精度建模"
  }
}
```

**Art Agent处理：**
- 使用Meshy-4生成3D模型（GLB格式）
- 生成写实风格资产（高多边形、PBR材质）
- 资产类型优先级：character.glb, environment.glb, texture.exr

### 示例3：创建一个多人游戏技术Agent

**game-factory前端创建：**
```typescript
{
  name: "张工程师",
  type: "developer",
  ai_model: "GPT-5",                  // 使用GPT-5生成代码
  specialization: "multiplayer",      // 专精多人游戏
  extra_traits: "擅长网络同步和服务器架构",
  company_id: 123
}
```

**传递到my-agent-test：**
```json
{
  "stageId": "tech",
  "agentId": "tech-agent",
  "model": "GPT-5",
  "agentMeta": {
    "specialization": "multiplayer",
    "extraTraits": "擅长网络同步和服务器架构"
  }
}
```

**Tech Agent处理：**
- 使用GPT-5生成游戏代码
- 选择支持多人的引擎（Unity/Unreal优先）
- 代码架构包含：服务器/客户端分离、状态同步、匹配系统

## 字段验证规则

### ai_model可选值（按agent类型）

#### Planning Agent (type: planner)
- `DeepSeek-R1` - 推理能力强，适合复杂系统设计
- `GPT-5` - 通用能力强，适合创意策划
- `Claude-Sonnet-4.5` - 逻辑严谨，适合数值设计

#### Art Agent (type: artist)
- `DALL-E-3` - 2D图像生成
- `Midjourney` - 2D概念设计
- `Stable Diffusion` - 2D通用生成
- `Meshy-4` - 3D模型生成
- `Luma AI` - 3D场景生成

#### Tech Agent (type: developer)
- `GPT-5` - 通用代码生成
- `Claude-Sonnet-4.5` - 代码质量高
- `Qwen-Coder` - 代码专精模型

#### Test/Music Agent
- `GPT-4` / `Claude` 等通用模型

### specialization可选值

#### Planner (type: planner)
- `rpg` - 角色扮演游戏
- `moba` - 多人在线战术竞技
- `slg` - 策略游戏
- `shooter` - 射击游戏
- `card` - 卡牌游戏
- `sandbox` - 沙盒游戏
- `casual` - 休闲游戏

#### Artist (type: artist)
- `realistic` - 写实风格
- `cartoon` - 卡通风格
- `pixel` - 像素风格
- `anime` - 动漫风格
- `lowpoly` - 低多边形风格

#### Developer (type: developer)
- `singleplayer` - 单机游戏架构
- `multiplayer` - 多人游戏架构
- `mobile` - 移动端架构
- `web` - Web游戏架构
- `vr` - VR游戏架构

### dimension可选值（仅artist类型）
- `2d` - 2D美术资产
- `3d` - 3D美术资产

## 兼容性检查清单

### ✅ 已完成
1. ✅ game-factory agents表结构更新（移除冗余字段，保留核心字段）
2. ✅ game-factory workflowBuilder传递agentMeta
3. ✅ my-agent-test StageConfig接口添加agentMeta字段
4. ✅ Planning Agent使用agentMeta.specialization和extraTraits
5. ✅ Art Agent使用agentMeta.dimension和specialization
6. ✅ Tech Agent使用agentMeta.specialization

### 🔄 待测试
1. ⏳ 端到端测试：创建agent → 启动workflow → 验证参数正确传递
2. ⏳ 验证ai_model字段正确覆盖默认模型
3. ⏳ 验证specialization影响实际生成结果
4. ⏳ 验证extraTraits正确加入AI system prompt

### 📝 建议优化
1. 在game-factory前端添加ai_model下拉选择（根据agent type动态显示可选模型）
2. 在game-factory前端添加specialization下拉选择（根据agent type动态显示可选方向）
3. 在my-agent-test中实现真实的模型切换逻辑（目前是模拟）
4. 添加agentMeta参数验证和默认值处理

## 版本历史

- **v1.0** (2025-11-19): 初始版本，定义game-factory和my-agent-test的参数映射关系
