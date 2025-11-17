## GameDev Multi-Agent Architecture

> Status: Draft implementation design (placeholders marked with `TODO`).  
> Cloud targets: `aliyun` (OSS/RDS/Redis/Kafka) & `gcp` (GCS/CloudSQL/Memorystore/PubSub).

---

### 1. High-Level Topology

```
        ┌──────────────────────────────────────────────────┐
        │                 External Website                 │
        │  (REST + WebSocket/SSE + Webhook callbacks)      │
        └───────────────▲───────────────┬──────────────────┘
                        │               │
                REST / PATCH     Streaming status
                        │               │
                ┌───────┴───────────────▼────────────────┐
                │        Execution API Gateway           │
                │  (Express layer inside A2A server)     │
                └───────▲───────────────┬────────────────┘
                        │               │
         Config + WF    │               │  State snapshots
                        │               │  Redis / Cache
                        │               │
                ┌───────▼───────────────┴────────────────┐
                │     Orchestrator / Workflow Engine     │
                │  - Resolves workflow template          │
                │  - Expands stage configs               │
                │  - Publishes Agent messages (WS)       │
                └───────▲───────────────┬────────────────┘
                        │               │
                        │               │ WebSocket
                ┌───────▼───────────────┴───────────┐
                │           A2A Router             │
                │  - Agent registry (WS clients)   │
                │  - Control / pause / resume      │
                └───────▲────────┬────────────┬────┘
                        │        │            │
                        │        │            │
      ┌─────────────────┘   ┌────┴────┐   ┌───┴────┐
      │ Planning Agent WS   │ Art WS  │   │ Music  │ ... (Tech, Test, QA, Custom)
      │ + model adapters    │ + tool  │   │ etc.   │
      └────────────────────┴─────────┴────────────┘
```

---

### 2. External API (REST)

> Base URL: `https://<A2A_HOST>/api`

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/executions` | `POST` | Create execution request (workflow + agent configs + resources) |
| `/executions/{id}` | `GET` | Query execution status/metadata |
| `/executions/{id}` | `PATCH` | Control execution (pause/resume/abort/update requirements) |
| `/executions/{id}/events` | `GET` (SSE) | Stream progress/log events |
| `/executions/{id}/stages/{stageId}` | `GET` | Inspect stage context, checkpoints, user overrides |
| `/executions/{id}/stages/{stageId}/pause` | `POST` | Pause a specific stage并记录checkpoint |
| `/executions/{id}/stages/{stageId}/resume` | `POST` | Resume某阶段，可带新的stageConfig/resources |
| `/executions/{id}/stages/{stageId}/updates` | `POST` | 暂停期间上传idea文档/资源/notes |
| `/resources/upload-url` | `POST` | Get signed URL for OSS/GCS upload |
| `/resources` | `POST` | Register third-party resource URLs to inject |

#### 2.1 `POST /executions` Request Schema (simplified)

```jsonc
{
  "workflowId": "sequential-game-dev",
  "cloudProvider": "aliyun", // or "gcp"
  "executionMode": "sequential" | "async_parallel" | "feedback_loop",
  "callbacks": {
    "webhook": "https://3rd-party.tld/hooks/execution",
    "events": "ws" // optional websocket channel indicator
  },
  "stages": [
    {
      "id": "planning",
      "agent": "planning-agent",
      "model": "openai-gpt-4o", // enumerations
      "knowledgeBase": "default-kb",
      "mode": "llm+kb" | "mcp-local" | "hybrid",
      "mcp": {
        "endpoint": "mcp://127.0.0.1:7001",
        "token": "TODO-user-token"
      },
      "resources": [
        { "type": "gdd_template", "url": "oss://TODO-bucket/template.md" }
      ]
    },
    {
      "id": "art",
      "agent": "art-agent",
      "model": "aliyun-qwen-vl-max",
      "mode": "llm+default-kb",
      "tools": {
        "render": "cloud-llm",
        "fallback": "mcp",
        "mcp": {
          "endpoint": "mcp://user-blender-host:8899",
          "token": "TODO-mcp-token"
        }
      },
      "resources": [
        { "type": "user_upload", "url": "gcs://TODO-bucket/character_blueprint.png" }
      ]
    }
  ],
  "project": {
    "projectName": "ThirdParty_RPG_001",
    "gameType": "rpg",
    "dimension": "3d",
    "artStyle": "realistic",
    "gameMode": "singleplayer"
  }
}
```

`PATCH /executions/{id}` body:
```json
{
  "action": "pause" | "resume" | "abort" | "update_requirements",
  "stageId": "art",
  "updates": {
    "stages": [...],
    "resources": [...],
    "notes": "Add co-op mode"
  }
}
```

---

### 3. Workflow Resolution

1. **Retrieve Template**: Load `workflowId` or `executionMode` from `src/workflows/index.ts`.
2. **Override Stages**: Merge user-supplied stages (model/tool choices, resources).
3. **Persist Execution**: Insert into MySQL `executions` table (`execution_id`, `workflow_id`, `status`, `config_json`).
4. **Dispatch**: For each stage, orchestrator sends `AgentMessage` with stage config (model, resources, MCP info).
5. **Control Hooks**: `pause/resume/abort` map to `MessageType.CONTROL` for current stage agent.

---

### 4. Storage & Infrastructure

| Service | Aliyun Default | GCP Default | Notes |
| --- | --- | --- | --- |
| Object Storage | `oss://gamedev-artifacts` | `gs://gamedev-artifacts` | Provide signed URLs; store art/audio/code zips |
| Database | `mysql://user:TODO@aliyun-rds/gamedev` | `mysql://user:TODO@gcp-cloudsql/gamedev` | Tables: executions, stages, artifacts, logs |
| Cache | `redis://TODO-aliyun-cache` | `redis://TODO-gcp-redis` | Execution state, WS sessions |
| MQ / Events | `kafka://TODO-aliyun` | `pubsub://TODO-gcp` | Optional for async log streaming |
| Logs | Aliyun SLS project `gamedev-logs` | GCP Cloud Logging `projects/TODO/logs/gamedev` | Structured log JSON |

> TODO: create `config/cloud.default.json` per environment; current code will load placeholders.

Artifacts metadata structure (MySQL table `artifacts`):
```
artifacts(
  id BIGINT PK,
  execution_id VARCHAR(64),
  stage VARCHAR(32),
  type ENUM('gdd','art','music','code','report'),
  storage_provider ENUM('aliyun','gcp'),
  url TEXT,
  metadata JSON,
  created_at TIMESTAMP
)
```

---

### 5. Agent Message Contract

```ts
interface StageConfig {
  executionId: string;
  stageId: string;
  model: string;
  knowledgeBase: string;
  mode: 'llm+kb' | 'llm+custom-kb' | 'mcp-local' | 'hybrid';
  resources: Array<{ type: string; url: string; format?: string }>;
  expectedArtifacts?: Array<{ type: string; format?: string }>;
  tools?: Record<string, any>;
  mcp?: { endpoint: string; token?: string };
}

type AgentPayload = {
  config: StageConfig;
  project: GameProjectConfig;
  userInput: UserInput;
  checkpoint?: {
    resumeToken?: string;
    artifacts: AgentArtifact[];
    notes?: string;
  };
};
```

Messages:

| Type | Description |
| --- | --- |
| `CONFIG` | Sent before stage start to deliver StageConfig |
| `CONTROL` | `pause`, `resume`, `abort`, `update_resources` |
| `ASSET_UPDATE` | Agent replies with artifact info + storage metadata/ checkpoints |
| `LOG` | Optional streaming log chunk |
| `TEST_REPORT` | Specialized summary (mirrors ASSET_UPDATE artifacts) |

---

### 6. Pause / Resume Semantics

1. 第三方系统调用 `PATCH /executions/:id` (action=pause, stageId) 或 `POST /executions/:id/stages/:stageId/pause`。A2A 将 `MessageType.CONTROL { action:'pause' }` 转发给当前 Agent。
2. Agent 必须：
   - 停止当前任务；
   - 通过 `ASSET_UPDATE` 回传 `status:'paused'`，并在 `checkpoint.artifacts` 中列出中间产物（GDD 草稿、FBX、音频、构建输出、测试进度等）。
3. ExecutionManager 记录 checkpoint，`GET /executions/:id/stages/:stageId` 可以查看上下文、用户上传的补充资料。
4. 用户可在暂停期间调用 `/updates` 接口上传 idea 文档/资源，再次 `resume` 时这些内容会合并到 stageConfig。
5. 恢复时，A2A 重新发送 `CONTROL { action:'resume', updates:{ stageConfig overrides... } }`，Agent 根据 checkpoint + overrides 继续执行。

所有产物遵循统一的 `AgentArtifact` 结构：

```ts
interface AgentArtifact {
  artifactId: string;
  stageId: string;              // 'planning' | 'art' | 'music' | 'tech' | 'test'
  type: 'document' | 'instruction' | 'art' | 'audio' | 'code' | 'model' | 'test_report' | 'build';
  format: 'gdd.json' | 'fbx' | 'png' | 'wav' | 'zip' | ...;
  url: string;                  // OSS/GCS/MCP url
  source: 'llm' | 'mcp' | 'user_upload' | 'pipeline';
  description?: string;
  metadata?: Record<string, any>;
}
```

---

### 7. Logging & Monitoring

Use centralized `LogService`:

```ts
logService.info({
  executionId,
  stageId,
  agentId,
  event: 'stage_started',
  provider: cloudProvider,
  timestamp: Date.now(),
});
```

Outputs:
- stdout (local dev)
- JSON file `./logs/executions/<date>.log`
- Cloud sink (SLS/Cloud Logging) via SDK (TODO credentials).

---

### 7. Default Configuration File (placeholder)

Create `config/cloud.default.json`:

```json
{
  "aliyun": {
    "oss": {
      "endpoint": "https://oss-cn-hangzhou.aliyuncs.com",
      "bucket": "TODO-oss-bucket",
      "accessKeyId": "TODO",
      "accessKeySecret": "TODO"
    },
    "mysql": "mysql://TODO:TODO@aliyun-rds:3306/gamedev",
    "redis": "redis://TODO-redis:6379",
    "kafka": "kafka://TODO-aliyun:9092",
    "logging": {
      "slsProject": "gamedev-logs",
      "slsEndpoint": "https://cn-hangzhou.log.aliyuncs.com"
    }
  },
  "gcp": {
    "gcs": {
      "bucket": "TODO-gcs-bucket",
      "credentials": "/path/to/todo-gcp-key.json"
    },
    "mysql": "mysql://TODO:TODO@gcp-cloudsql:3306/gamedev",
    "redis": "redis://TODO-gcp-redis:6379",
    "pubsub": "projects/TODO/topics/gamedev-events",
    "logging": {
      "sink": "projects/TODO/logs/gamedev"
    }
  }
}
```

---

### 8. Why keep A2A server?

- Required for **distributed agents** (each runs in its own container, registers via WS).
- Provides consistent API endpoint for third-party integration.
- Workflow definitions (`src/workflows`) now serve as templates; actual execution still routed through A2A for messaging, pause/resume, and cloud uploads.
- VoltAgent workflow engine alone assumes in-process steps; using it as template plus A2A as router gives both clarity and compatibility.

---

### 9. Next Implementation Steps

1. **API layer**: add controllers for `/executions`, `/resources`, SSE endpoints.
2. **Execution repository**: MySQL models + Redis cache integration.
3. **Storage adapters**: implement OSS & GCS uploads (behind unified interface).
4. **Agent protocol update**: add CONFIG/CONTROL handling.
5. **Logging service**: integrate structured logger + cloud sink.
6. **UI hooks**: expose WebSocket channel for website dashboards (optional).

All TODO fields require secure secret management (Vault/KMS). Until provided, placeholders remain.

---

End of document.

