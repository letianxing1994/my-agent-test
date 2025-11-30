# 持久化维度设计分析与改进方案

## 当前问题分析

### 问题 1：缺少用户隔离

**当前实现**：
```typescript
// 本地存储
./data/projects/{projectId}/gdd.md
./data/projects/{projectId}/art/...

// 云存储（StorageService）
key: "projects/{projectId}/artifacts/..."
```

**问题**：
- ❌ 没有用户（userId）隔离
- ❌ 多用户环境下数据会混在一起
- ❌ 无法按用户统计资源使用
- ❌ 权限控制缺失

### 问题 2：game-factory 数据被忽略

**game-factory 发送的数据**：
```typescript
interface WorkflowTaskMessage {
  jobId: string;
  companyId: number;       // ← 被忽略
  ownerId: number;         // ← 被忽略
  enqueuedAt: string;
  payload: ExecutionRequest;
}
```

**当前处理**：
```typescript
// src/workers/workflowConsumer.ts:100-120
async function startExecution(task: WorkflowTaskMessage) {
  const response = await fetch(`${API_BASE}/executions`, {
    method: 'POST',
    body: JSON.stringify(task.payload)  // ← companyId, ownerId 丢失！
  });
}
```

### 问题 3：ExecutionRecord 缺少关键字段

**当前 ExecutionRecord**：
```typescript
interface ExecutionRecord {
  executionId: string;
  projectId: string;       // ← 只有这个
  workflowId: string;
  cloudProvider: "aliyun" | "gcp";
  status: ...
  stages: ...
}
```

**缺少**：
- ❌ `userId` / `ownerId` - 无法追溯创建者
- ❌ `companyId` - 无法按公司统计
- ❌ 无法实现多租户隔离

---

## 数据模型分析

### game-factory 的层级关系

```
用户（User）
  └─ 拥有 1 个公司（Company）
      ├─ 有多个员工（Agent员工）
      └─ 创建多个项目（Project）
          └─ 生成产物（GDD, 美术, 音乐, 代码）
```

### 关键维度分析

| 维度 | 是否必需 | 理由 |
|------|---------|------|
| **userId (ownerId)** | ✅ **必需** | • 数据隔离（多租户）<br>• 权限控制<br>• 成本分摊<br>• 安全审计 |
| **projectId** | ✅ **必需** | • 项目唯一标识<br>• 产物归属 |
| **companyId** | ⚠️ **可选（元数据）** | • 一个用户只有一个公司 → 可通过 userId 推导<br>• 但保留便于统计和追溯 |
| **agentId** | ⚠️ **可选（元数据）** | • 产物归属于项目，不按智能体划分<br>• 但保留便于追溯"谁生成的" |

---

## 推荐方案

### 方案：userId + projectId 作为主键

#### 1. 持久化路径设计

**本地存储**：
```
./data/users/{userId}/projects/{projectId}/
├── gdd.md
├── gdd.json
├── art/
│   ├── character_001.fbx
│   └── environment_001.png
├── music/
│   └── bgm_001.wav
├── code/
│   └── game.zip
└── reports/
    └── test_report_001.json
```

**云存储（OSS/GCS）**：
```
bucket://gamedev-artifacts/
└── users/{userId}/
    └── projects/{projectId}/
        ├── artifacts/
        │   ├── gdd.md
        │   ├── art/...
        │   └── music/...
        └── outputs/
            └── builds/...
```

**优势**：
- ✅ 用户数据完全隔离
- ✅ 便于权限控制（只能访问自己的 userId 路径）
- ✅ 成本分摊清晰（按 userId 统计云存储用量）
- ✅ 数据备份/迁移方便（按 userId 打包）

#### 2. 数据结构更新

**ExecutionRecord 新增字段**：
```typescript
export interface ExecutionRecord {
  executionId: string;

  // 🔥 新增：核心隔离维度
  userId: number;              // 用户ID（主键之一）
  projectId: string;           // 项目ID（主键之一）

  // 🔥 新增：元数据维度
  companyId: number;           // 公司ID（元数据，便于追溯）

  // 原有字段
  workflowId: string;
  cloudProvider: "aliyun" | "gcp";
  status: ...;
  stages: StageRecord[];       // ← 每个 stage 也记录 agentId
  ...
}

export interface StageRecord {
  stageId: string;
  agentId: string;             // ← 记录哪个智能体执行的
  agentMeta?: {
    specialization?: string;
    extraTraits?: string;
  };
  status: ...;
  artifacts: AgentArtifact[];
  ...
}
```

**WorkflowTaskMessage 使用**：
```typescript
// src/workers/workflowConsumer.ts
async function startExecution(task: WorkflowTaskMessage) {
  const response = await fetch(`${API_BASE}/executions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...task.payload,
      userId: task.ownerId,        // 🔥 传递用户ID
      companyId: task.companyId,   // 🔥 传递公司ID
    })
  });
}
```

#### 3. 路径构建服务

**新增：PathService**：
```typescript
// src/services/PathService.ts
export class PathService {
  /**
   * 获取用户项目的本地路径
   */
  static getLocalProjectPath(userId: number, projectId: string): string {
    return path.resolve(`./data/users/${userId}/projects/${projectId}`);
  }

  /**
   * 获取用户项目的云存储路径
   */
  static getCloudProjectPath(userId: number, projectId: string): string {
    return `users/${userId}/projects/${projectId}`;
  }

  /**
   * 获取 GDD 路径
   */
  static getGDDPath(userId: number, projectId: string): string {
    return path.join(
      this.getLocalProjectPath(userId, projectId),
      'gdd.md'
    );
  }

  /**
   * 获取美术资源路径
   */
  static getArtPath(userId: number, projectId: string): string {
    return path.join(
      this.getLocalProjectPath(userId, projectId),
      'art'
    );
  }

  /**
   * 获取云存储 key
   */
  static getCloudKey(
    userId: number,
    projectId: string,
    artifactPath: string
  ): string {
    return `${this.getCloudProjectPath(userId, projectId)}/artifacts/${artifactPath}`;
  }
}
```

---

## companyId 和 agentId 的处理

### 建议：作为元数据保留，不作为路径

**原因**：
1. **companyId**：
   - 一个用户只有一个公司（根据你的描述）
   - 可以通过 `userId` 推导
   - 但保留在 `ExecutionRecord` 中便于统计和追溯

2. **agentId**：
   - 产物归属于**项目**，不归属于**智能体**
   - 但需要记录"哪个智能体生成的"（用于审计、反馈）
   - 保留在 `StageRecord.agentId` 中

**存储方式**：
```typescript
// ExecutionRecord（数据库/JSON）
{
  executionId: "exec-001",
  userId: 123,                    // ← 路径维度
  projectId: "proj-001",          // ← 路径维度
  companyId: 456,                 // ← 元数据（不在路径中）
  stages: [
    {
      stageId: "planning",
      agentId: "agent-789",       // ← 元数据（不在路径中）
      artifacts: [...]
    }
  ]
}

// 文件路径
./data/users/123/projects/proj-001/gdd.md
                ↑              ↑
             userId        projectId
```

### 何时需要 companyId 和 agentId？

**查询场景**：
1. **按公司统计资源**：
   ```sql
   SELECT SUM(storage_size)
   FROM executions
   WHERE companyId = 456;
   ```

2. **查询某个智能体的表现**：
   ```sql
   SELECT * FROM stages
   WHERE agentId = 'agent-789'
   AND status = 'completed';
   ```

3. **审计追溯**：
   - "这个 GDD 是哪个智能体生成的？" → `StageRecord.agentId`
   - "这个项目属于哪个公司？" → `ExecutionRecord.companyId`

---

## 向后兼容策略

### 迁移路径

**阶段 1：添加字段（不破坏现有逻辑）**
```typescript
interface ExecutionRecord {
  executionId: string;
  projectId: string;
  userId?: number;           // ← 可选，向后兼容
  companyId?: number;        // ← 可选，向后兼容
  // ...
}
```

**阶段 2：路径适配（双模式支持）**
```typescript
class PathService {
  static getGDDPath(projectId: string, userId?: number): string {
    if (userId) {
      // 新路径：users/{userId}/projects/{projectId}
      return path.resolve(`./data/users/${userId}/projects/${projectId}/gdd.md`);
    } else {
      // 旧路径：projects/{projectId}（兼容）
      return path.resolve(`./data/projects/${projectId}/gdd.md`);
    }
  }
}
```

**阶段 3：全面迁移**
- 将旧数据迁移到新路径
- 移除兼容代码

---

## 实现优先级

### P0（必须）
- ✅ 更新 `ExecutionRecord` 添加 `userId`, `companyId`
- ✅ 更新 `workflowConsumer` 传递 `ownerId`, `companyId`
- ✅ 创建 `PathService` 统一路径管理
- ✅ 更新所有 Agent 使用新路径

### P1（重要）
- ⏳ 更新 `StorageService.upload()` 使用 userId 前缀
- ⏳ 更新 `GDDMarkdownService` 使用新路径
- ⏳ 添加权限检查（防止跨用户访问）

### P2（优化）
- ⏳ 数据迁移工具（旧路径 → 新路径）
- ⏳ 按 userId 统计存储用量
- ⏳ 按 companyId 生成报表

---

## 安全考虑

### 权限隔离

```typescript
// API 层添加权限检查
app.get('/api/executions/:executionId', async (req, res) => {
  const { executionId } = req.params;
  const requestUserId = req.user.id;  // 从 JWT/Session 获取

  const execution = await executionManager.getExecution(executionId);

  // 🔒 权限检查
  if (execution.userId !== requestUserId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.json(execution);
});
```

### 路径注入防护

```typescript
class PathService {
  private static validateUserId(userId: number): void {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error('Invalid userId');
    }
  }

  private static validateProjectId(projectId: string): void {
    // 防止路径遍历攻击
    if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
      throw new Error('Invalid projectId');
    }
  }

  static getLocalProjectPath(userId: number, projectId: string): string {
    this.validateUserId(userId);
    this.validateProjectId(projectId);
    return path.resolve(`./data/users/${userId}/projects/${projectId}`);
  }
}
```

---

## 总结

### 推荐方案

✅ **主键**：`userId + projectId`
- 路径：`./data/users/{userId}/projects/{projectId}/`
- 云存储：`users/{userId}/projects/{projectId}/artifacts/`

✅ **元数据**：`companyId, agentId`
- 保留在 ExecutionRecord / StageRecord 中
- 不作为路径的一部分
- 用于统计、追溯、审计

✅ **理由**：
1. 一个用户只有一个公司 → companyId 可通过 userId 推导
2. 产物归属于项目 → agentId 不影响路径结构
3. 数据隔离清晰 → 防止跨用户访问
4. 成本分摊简单 → 按 userId 统计云存储用量

---

*文档生成时间：2025-11-30*
