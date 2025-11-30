# projectId 传递实现完成

## ✅ 实现概览

已成功实现 game-factory 和 my-agent-test 之间的 projectId 统一传递，确保两个系统使用相同的游戏项目标识符。

**核心映射关系**：
```
game-factory.games.id → my-agent-test.projectId
```

---

## 🔧 已完成的修改

### 1. 类型定义更新 (`src/types.ts`)

#### ExecutionRequest (lines 282-303)
```typescript
export interface ExecutionRequest {
  workflowId: string;
  executionMode: ExecutionMode;
  cloudProvider: "aliyun" | "gcp";

  // 🔥 核心标识（从 game-factory 接收）
  userId?: number;           // 用户 ID（从 WorkflowTaskMessage.ownerId = companies.owner_id）
  companyId?: number;        // 公司 ID（从 WorkflowTaskMessage.companyId = games.company_id）
  projectId?: string;        // 🔥 游戏项目 ID（从 game-factory.games.id，必须传递以保持一致性）

  project: {
    projectName: string;
    gameGenre?: GameGenreSelection;
    dimension: UserInput["dimension"];
    artStyle: UserInput["artStyle"];
    gameMode: UserInput["gameMode"];
    additionalRequirements?: string;
  };
  stages: StageConfig[];
  callbacks?: ExecutionConfig["callbacks"];
}
```

#### ExecutionRecord (lines 366-416)
```typescript
export interface ExecutionRecord {
  executionId: string;
  projectId: string;         // 项目 ID（来自 game-factory.games.id）

  // 🔥 核心隔离维度（用于路径构建和数据隔离）
  userId?: number;           // 用户 ID（来自 game-factory.companies.owner_id，可选用于向后兼容）
  companyId?: number;        // 公司 ID（来自 game-factory.games.company_id，元数据）

  workflowId: string;
  cloudProvider: "aliyun" | "gcp";
  status: ...;
  // ...
}
```

### 2. A2A Server 更新 (`src/a2a-server/index.ts`)

**POST /api/executions** (lines 1722-1810)
```typescript
app.post("/api/executions", (req, res) => {
  const parsed = ExecutionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_request", details: parsed.error.flatten() });
  }

  const data = parsed.data as ExecutionRequest;

  // 🔥 优先使用 game-factory 的 projectId（games.id）
  // 如果没有传递，才自动生成（向后兼容）
  const projectId = data.projectId || uuidv4();

  if (!data.projectId) {
    console.warn(
      "⚠️ ExecutionRequest 缺少 projectId。" +
      "建议 game-factory 传递 games.id 作为 projectId 以保持一致性。"
    );
  } else {
    console.log(
      `✅ 使用 game-factory 的 projectId: ${data.projectId} (games.id)`
    );
  }

  // 创建项目
  const project = projectManager.createProject(
    projectId,  // ← 使用 game-factory 的 games.id
    data.project.projectName,
    userInput,
    data.executionMode
  );

  // ...
});
```

### 3. ExecutionManager 更新 (`src/orchestrator/ExecutionManager.ts`)

**createExecution 方法** (lines 78-95)
```typescript
const record: ExecutionRecord = {
  executionId,
  projectId,

  // 🔥 保存 game-factory 的核心标识（用于路径构建和数据隔离）
  userId: request.userId,      // 来自 companies.owner_id
  companyId: request.companyId, // 来自 games.company_id

  workflowId: request.workflowId,
  cloudProvider: request.cloudProvider,
  executionMode: request.executionMode,
  status: "pending",
  config,
  stages,
  resources: [],
  clarification: {
    status: "idle",
    questions: [],
    conversation: [],
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

this.executions.set(executionId, record);
this.projectExecutionMap.set(projectId, executionId);
```

### 4. WorkflowConsumer 验证 (`src/workers/workflowConsumer.ts`)

**startExecution 方法** (lines 98-126)
```typescript
async function startExecution(
  task: WorkflowTaskMessage,
): Promise<ExecutionStartResponse> {
  console.log(
    `[Job ${task.jobId}] Starting execution for company ${task.companyId}, owner ${task.ownerId}`,
  );

  // 🔥 将 userId 和 companyId 传递给 A2A Server
  // projectId 通过 ...task.payload 自动传递
  const payload = {
    ...task.payload,            // ← 包含 projectId（来自 game-factory）
    userId: task.ownerId,       // 🔥 用户ID
    companyId: task.companyId,  // 🔥 公司ID
  };

  const response = await fetch(`${API_BASE}/executions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`startExecution failed: ${response.status} ${text}`);
  }

  return (await response.json()) as ExecutionStartResponse;
}
```

---

## 📊 数据流图

### ✅ 改进后的流程

```
game-factory
  ↓
  CREATE games (id = 789, name = "魔法世界冒险", company_id = 456)
  ↓
  发送 WorkflowTaskMessage 到 Kafka
  {
    jobId: "...",
    companyId: 456,            // ← games.company_id
    ownerId: 123,              // ← companies.owner_id
    payload: {
      workflowId: "...",
      projectId: "789",        // 🔥 games.id (字符串)
      project: {
        projectName: "魔法世界冒险",  // ← games.name
        ...
      }
    }
  }
  ↓
workflowConsumer
  ↓
  调用 POST /api/executions
  {
    ...payload,              // ← 包含 projectId: "789"
    userId: 123,             // ← ownerId
    companyId: 456           // ← companyId
  }
  ↓
A2A Server
  ↓
  const projectId = data.projectId || uuidv4();
  // projectId = "789" ✅
  ↓
  创建 ExecutionRecord
  {
    executionId: "exec-001",
    projectId: "789",        // 🔥 使用 games.id
    userId: 123,
    companyId: 456,
    ...
  }
  ↓
文件路径
  ./data/users/123/projects/789/gdd.md
                ↑            ↑
           companies.   games.id
            owner_id
```

---

## 🎯 game-factory 集成指南

### 发送执行请求

```typescript
// game-factory: services/workflowService.ts

async function createGameProject(
  userId: number,
  companyId: number,
  projectData: ProjectInput
) {
  // 1. 在 game-factory 数据库创建游戏
  const game = await db.games.create({
    name: projectData.name,
    company_id: companyId,
    genre: projectData.genre,
    development_status: 'developing'
  });

  // 2. 构建 ExecutionRequest
  const executionRequest: ExecutionRequest = {
    workflowId: "sequential-game-dev",
    executionMode: "sequential",
    cloudProvider: "aliyun",

    // 🔥 传递核心标识
    userId: userId,
    companyId: companyId,
    projectId: game.id.toString(),  // 🔥 关键：games.id 作为字符串

    project: {
      projectName: projectData.name,
      gameGenre: { primary: projectData.genre },
      dimension: projectData.dimension,
      artStyle: projectData.artStyle,
      gameMode: projectData.gameMode
    },
    stages: buildStages(projectData)
  };

  // 3. 发送到 Kafka
  await kafka.send({
    topic: 'workflow-tasks',
    messages: [{
      key: game.id.toString(),
      value: JSON.stringify({
        jobId: uuidv4(),
        companyId: companyId,
        ownerId: userId,
        payload: executionRequest  // ← 包含 projectId
      } as WorkflowTaskMessage)
    }]
  });

  return game;
}
```

### 查询执行状态

```typescript
// game-factory 可以直接使用 games.id 查询
async function getGameDevelopmentStatus(gameId: number) {
  const response = await fetch(
    `http://my-agent-test:8090/api/executions?projectId=${gameId}`
  );
  return response.json();
}
```

---

## 🔍 验证清单

### my-agent-test 端

- [x] ExecutionRequest 类型包含 `projectId?: string`
- [x] ExecutionRecord 保存 `userId`, `companyId`, `projectId`
- [x] A2A Server 优先使用 `data.projectId` 而不是生成新 UUID
- [x] ExecutionManager 保存完整的标识信息
- [x] WorkflowConsumer 通过 `...task.payload` 传递 projectId

### game-factory 端（待实现）

- [ ] 创建游戏后获取 `games.id`
- [ ] 在 WorkflowTaskMessage.payload 中包含 `projectId: games.id.toString()`
- [ ] 使用 games.id 查询执行状态
- [ ] 测试完整流程：创建游戏 → 发送任务 → 查询状态

---

## 📝 日志示例

### 成功场景

```
[A2A Server] ✅ 使用 game-factory 的 projectId: 789 (games.id)
[A2A Server] 创建项目 789 - 魔法世界冒险，执行模式: sequential
[ExecutionManager] 创建 ExecutionRecord { executionId: "exec-001", projectId: "789", userId: 123, companyId: 456 }
[PathService] GDD 路径: ./data/users/123/projects/789/gdd.md
```

### 兼容性场景（projectId 未传递）

```
[A2A Server] ⚠️ ExecutionRequest 缺少 projectId。建议 game-factory 传递 games.id 作为 projectId 以保持一致性。
[A2A Server] 自动生成 projectId: abc-def-123-456
[A2A Server] 创建项目 abc-def-123-456 - 魔法世界冒险，执行模式: sequential
```

---

## 🚀 下一步

1. **game-factory 集成**：
   - 更新 workflow builder 以包含 `projectId: games.id.toString()`
   - 测试完整的创建 → 执行 → 查询流程

2. **数据迁移**（可选）：
   - 如果有现有数据，创建迁移脚本将旧路径迁移到新路径
   - `./data/projects/{projectId}/` → `./data/users/{userId}/projects/{projectId}/`

3. **监控**：
   - 监控日志，确保 projectId 传递正常
   - 统计缺少 projectId 的请求比例

---

**实现完成时间**：2025-11-30

**相关文档**：
- [GAME_PROJECT_MAPPING.md](./GAME_PROJECT_MAPPING.md) - 数据映射关系
- [PROJECTID_MAPPING_ISSUE.md](./PROJECTID_MAPPING_ISSUE.md) - 问题分析
- [PERSISTENCE_KEY_DESIGN.md](./PERSISTENCE_KEY_DESIGN.md) - 持久化设计
