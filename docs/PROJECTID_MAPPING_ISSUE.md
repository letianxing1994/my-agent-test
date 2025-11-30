# projectId 传递问题分析

## 🔴 当前存在的问题

### 问题 1：projectId 重复生成

**当前流程**：
```
game-factory
  └─ 创建项目（projects 表）
      └─ 生成 game-factory 的 projectId = 123 (数据库自增 ID)
      └─ 发送 WorkflowTaskMessage 到 Kafka
          └─ payload.project.projectName = "魔法世界冒险"
          └─ ❌ 没有传递 projectId!

workflowConsumer
  └─ 接收任务，调用 POST /api/executions
      └─ body = { ...payload, userId, companyId }
          └─ ❌ 仍然没有 projectId!

A2A Server (src/a2a-server/index.ts:1731)
  └─ const projectId = uuidv4();  ← 🔥 自己生成了新的 projectId!
      └─ my-agent-test 的 projectId = "abc-def-123-456"
```

**结果**：
- ❌ game-factory 的 projectId = `123`
- ❌ my-agent-test 的 projectId = `"abc-def-123-456"`
- ❌ **两个系统的 projectId 不一致！**

### 问题 2：无法关联

**game-factory 的困境**：
```typescript
// game-factory 数据库
projects 表:
  id: 123
  name: "魔法世界冒险"
  created_at: "2025-11-30"

// game-factory 想查询执行状态
// ❌ 但是不知道 my-agent-test 的 projectId!
const response = await fetch(`/api/executions?projectId=???`);
```

**my-agent-test 的困境**：
```typescript
// my-agent-test 的 ExecutionRecord
{
  executionId: "exec-001",
  projectId: "abc-def-123-456",  // ← my-agent-test 生成的
  userId: 456,
  // ❌ 不知道 game-factory 的 projectId = 123!
}
```

---

## ✅ 解决方案

### 方案 A：game-factory 传递 projectId（推荐）

**修改 ExecutionRequest**：
```typescript
export interface ExecutionRequest {
  workflowId: string;
  executionMode: ExecutionMode;

  // 🔥 新增：从 game-factory 接收
  userId?: number;
  companyId?: number;
  projectId?: string;  // ← 🔥 game-factory 的项目 ID

  project: {
    projectName: string;
    // ...
  };
  stages: StageConfig[];
}
```

**game-factory 发送**：
```typescript
// game-factory: workflowBuilder.ts
const project = await db.projects.create({
  name: "魔法世界冒险",
  company_id: 456,
  owner_id: 123
});
// project.id = 123

const executionRequest: ExecutionRequest = {
  workflowId: "sequential-game-dev",
  userId: 123,
  companyId: 456,
  projectId: project.id.toString(),  // 🔥 传递 game-factory 的项目 ID
  project: {
    projectName: "魔法世界冒险",
    // ...
  }
};

await kafka.send({
  topic: 'workflow-tasks',
  messages: [{
    value: JSON.stringify({
      jobId: uuidv4(),
      companyId: 456,
      ownerId: 123,
      payload: executionRequest
    })
  }]
});
```

**my-agent-test 使用**：
```typescript
// src/a2a-server/index.ts:1722
app.post("/api/executions", (req, res) => {
  const data = req.body as ExecutionRequest;

  // 🔥 使用 game-factory 的 projectId，而不是生成新的
  const projectId = data.projectId || uuidv4();

  const project = projectManager.createProject(
    projectId,  // ← 使用 game-factory 的 ID
    data.project.projectName,
    userInput,
    data.executionMode
  );

  // ...
});
```

**优势**：
- ✅ 统一的 projectId
- ✅ game-factory 可以用自己的 projectId 查询状态
- ✅ 无需额外映射

---

### 方案 B：建立映射关系（备选）

如果必须让 my-agent-test 生成自己的 projectId，则需要建立映射：

```typescript
export interface ExecutionRecord {
  executionId: string;
  projectId: string;              // my-agent-test 的 projectId
  userId?: number;
  companyId?: number;

  // 🔥 新增：映射关系
  externalProjectId?: string;     // game-factory 的 projectId
  externalSystem?: "game-factory"; // 来源系统

  // ...
}
```

**查询接口**：
```typescript
// A2A Server 提供两种查询方式
app.get("/api/executions/:id", (req, res) => {
  // 查询 my-agent-test 的 projectId
});

app.get("/api/executions/by-external/:externalProjectId", (req, res) => {
  // 查询 game-factory 的 projectId
  const record = executionManager.findByExternalProjectId(
    req.params.externalProjectId
  );
});
```

**缺点**：
- ⚠️ 增加复杂度
- ⚠️ 需要维护映射关系
- ⚠️ 可能出现不一致

---

## 🎯 推荐的完整方案

### 1. 更新类型定义

```typescript
// src/types.ts
export interface ExecutionRequest {
  workflowId: string;
  executionMode: ExecutionMode;
  cloudProvider: "aliyun" | "gcp";

  // 核心标识（从 game-factory 接收）
  userId?: number;           // 用户 ID
  companyId?: number;        // 公司 ID
  projectId?: string;        // 🔥 game-factory 的项目 ID（推荐传递）

  project: {
    projectName: string;
    gameGenre?: GameGenreSelection;
    // ...
  };
  stages: StageConfig[];
}

export interface ExecutionRecord {
  executionId: string;
  projectId: string;         // 项目 ID（来自 game-factory）
  userId?: number;
  companyId?: number;
  // ...
}
```

### 2. 更新 A2A Server

```typescript
// src/a2a-server/index.ts:1722
app.post("/api/executions", (req, res) => {
  const data = req.body as ExecutionRequest;

  // 🔥 优先使用 game-factory 的 projectId
  const projectId = data.projectId || uuidv4();

  if (!data.projectId) {
    console.warn(
      "⚠️ ExecutionRequest 缺少 projectId，自动生成。" +
      "建议 game-factory 传递项目 ID 以保持一致性。"
    );
  }

  // 创建项目
  const project = projectManager.createProject(
    projectId,
    data.project.projectName,
    userInput,
    data.executionMode
  );

  // 创建 ExecutionRecord
  const execution = executionManager.createExecution({
    ...data,
    userId: data.userId,
    companyId: data.companyId,
    projectId: projectId  // 使用统一的 projectId
  });

  res.json({
    executionId: execution.executionId,
    projectId: projectId,  // 返回给 game-factory
    workflowId: data.workflowId,
    status: execution.status
  });
});
```

### 3. game-factory 集成示例

```typescript
// game-factory: services/workflowService.ts
async function createGameProject(
  userId: number,
  companyId: number,
  projectData: ProjectInput
) {
  // 1. 在 game-factory 数据库创建项目
  const project = await db.projects.create({
    name: projectData.name,
    company_id: companyId,
    owner_id: userId,
    status: 'pending'
  });

  // 2. 构建 ExecutionRequest
  const executionRequest: ExecutionRequest = {
    workflowId: "sequential-game-dev",
    executionMode: "sequential",
    cloudProvider: "aliyun",

    // 🔥 传递核心标识
    userId: userId,
    companyId: companyId,
    projectId: project.id.toString(),  // 🔥 关键：传递项目 ID

    project: {
      projectName: projectData.name,
      gameGenre: projectData.genre,
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
      key: project.id.toString(),
      value: JSON.stringify({
        jobId: uuidv4(),
        companyId: companyId,
        ownerId: userId,
        payload: executionRequest
      } as WorkflowTaskMessage)
    }]
  });

  // 4. 保存映射关系（可选，用于快速查询）
  await db.project_executions.create({
    project_id: project.id,
    // execution_id 会在收到 workflow-results 时更新
  });

  return project;
}

// 查询项目状态
async function getProjectStatus(projectId: number) {
  // 可以直接用 game-factory 的 projectId 查询
  const response = await fetch(
    `http://my-agent-test:8090/api/executions?projectId=${projectId}`
  );
  return response.json();
}
```

---

## 📊 数据流对比

### ❌ 当前（有问题）

```
game-factory (projectId = 123)
  ↓
Kafka (jobId, companyId, ownerId)
  ↓
my-agent-test 生成新 projectId = uuid
  ↓
无法关联 123 ↔ uuid
```

### ✅ 推荐方案

```
game-factory (projectId = 123)
  ↓
Kafka (jobId, companyId, ownerId, projectId = "123")
  ↓
my-agent-test 使用 projectId = "123"
  ↓
统一的 projectId = "123"
  ↓
文件路径：./data/users/456/projects/123/gdd.md
云存储：users/456/projects/123/artifacts/...
```

---

## 总结

你的疑问**完全正确**！

### 必须传递的字段

```typescript
interface WorkflowTaskMessage {
  jobId: string;
  companyId: number;     // ✅ 必须（元数据）
  ownerId: number;       // ✅ 必须（路径维度）
  payload: {
    userId: number;      // = ownerId
    companyId: number;   // = companyId
    projectId: string;   // ✅ 🔥 必须！（路径维度）
  }
}
```

### 原因

1. **userId（ownerId）** - 数据隔离、权限控制
2. **projectId** - **关联两个系统的项目**、文件路径构建
3. **companyId** - 统计、审计（元数据）

**projectId 是绝对必要的**，否则无法建立 game-factory 和 my-agent-test 之间的关联！

---

需要我帮你实现这个改进吗？
