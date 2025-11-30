# Agent 异步预览任务系统 - 完整文档

## 系统架构

```
┌─────────────────┐      1. 创建任务        ┌──────────────────┐
│  Game-Factory   │ ─────────────────────> │  Game-Factory    │
│  Frontend       │                         │  Backend         │
│                 │ <───────────────────── │  (/api/preview-  │
└─────────────────┘   返回 taskId          │   tasks)         │
        │                                   └──────────────────┘
        │                                            │
        │  2. 轮询查询任务状态                       │ 3. 调用异步预览
        │     /api/preview-tasks/:taskId            │    (async=true)
        │                                            ↓
        ↓                                   ┌──────────────────┐
  ┌──────────┐                             │  My-Agent-Test   │
  │  定时刷新  │                             │  A2A Server      │
  │  进度条   │ <─────────────────────────  │                  │
  └──────────┘   4. 回调状态更新            │  - 创建任务状态  │
                    /api/preview-tasks/     │  - 执行Agent     │
                    :taskId/callback        │  - 更新进度      │
                                            │  - 回调通知      │
                                            └──────────────────┘
                                                     │
                                                     ↓
                                            ┌──────────────────┐
                                            │  Planning Agent  │
                                            │  (执行中更新进度) │
                                            │  10% → 30% → ... │
                                            └──────────────────┘
```

## 数据库表结构

### agent_preview_tasks 表

```sql
CREATE TABLE IF NOT EXISTS `agent_preview_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '任务ID',
  `task_id` VARCHAR(64) NOT NULL COMMENT '任务唯一标识（UUID）',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `agent_id` INT NOT NULL COMMENT 'Agent ID (对应 agents 表)',
  `task_name` VARCHAR(255) NOT NULL COMMENT '任务名称（用户输入）',
  `game_id` BIGINT UNSIGNED NULL COMMENT '关联的游戏项目ID（可选）',
  `status` ENUM('pending', 'running', 'completed', 'failed') NOT NULL DEFAULT 'pending' COMMENT '任务状态',
  `progress` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '进度百分比 (0-100)',
  `stage_id` VARCHAR(50) NULL COMMENT 'Stage ID (planning/art/music/tech/test)',
  `start_time` DATETIME NULL COMMENT '开始时间',
  `complete_time` DATETIME NULL COMMENT '完成时间',
  `result_data` JSON NULL COMMENT '任务结果数据（包含产物信息）',
  `error_message` TEXT NULL COMMENT '错误信息（失败时）',
  `config` JSON NULL COMMENT '任务配置（stage config, user input等）',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_id` (`task_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_agent_id` (`agent_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_user_status` (`user_id`, `status`),
  KEY `idx_game_id` (`game_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Agent预览任务表';
```

## API 文档

### Game-Factory Backend APIs

#### 1. 创建异步预览任务

**接口**: `POST /api/preview-tasks`

**请求头**:
```
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:
```json
{
  "agentId": 2,
  "taskName": "测试策划Agent生成GDD",
  "gameId": 123,  // 可选
  "project": {
    "projectName": "我的RPG游戏",
    "description": "一个3D开放世界RPG游戏"
  },
  "cloudProvider": "aliyun",
  "stageConfig": {
    "model": "deepseek-r1",
    "mode": "llm+kb"
  },
  "userInput": {
    "dimension": "3d",
    "artStyle": "realistic",
    "gameMode": "singleplayer"
  }
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "taskId": "task_1234567890_abc123",
    "status": "running",
    "agentId": 2,
    "stageId": "planning",
    "message": "任务已创建并开始执行"
  }
}
```

#### 2. 获取任务列表

**接口**: `GET /api/preview-tasks`

**查询参数**:
- `status`: pending | running | completed | failed (可选)
- `limit`: 每页数量，默认20
- `offset`: 偏移量，默认0

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "task_id": "task_1234567890_abc123",
      "user_id": 1,
      "agent_id": 2,
      "agent_name": "策划Agent",
      "task_name": "测试策划Agent生成GDD",
      "status": "completed",
      "progress": 100,
      "stage_id": "planning",
      "start_time": "2025-01-15 10:00:00",
      "complete_time": "2025-01-15 10:05:00",
      "result_data": {
        "artifactType": "gdd",
        "artifactUrl": "/data/projects/xxx/gdd.md"
      },
      "created_at": "2025-01-15 09:59:00"
    }
  ]
}
```

#### 3. 获取任务详情

**接口**: `GET /api/preview-tasks/:taskId`

**响应**: 与任务列表中单个项目相同

#### 4. 接收状态回调（内部接口）

**接口**: `POST /api/preview-tasks/:taskId/callback`

**请求体**:
```json
{
  "status": "running",
  "progress": 50,
  "resultData": {
    "artifactType": "gdd"
  },
  "errorMessage": null
}
```

### My-Agent-Test APIs

#### 1. 异步执行预览

**接口**: `POST /api/executions/preview`

**请求体**:
```json
{
  "stage": {
    "stageId": "planning",
    "model": "deepseek-r1",
    "mode": "llm+kb"
  },
  "project": {
    "projectName": "测试项目",
    "description": "测试描述"
  },
  "cloudProvider": "aliyun",
  "async": true,  // 启用异步模式
  "taskId": "task_1234567890_abc123",  // game-factory 生成的任务ID
  "callbackUrl": "http://localhost:3000/api/preview-tasks/task_1234567890_abc123/callback"
}
```

**响应**:
```json
{
  "success": true,
  "async": true,
  "data": {
    "taskId": "task_1234567890_abc123",
    "projectId": "preview-xxx-yyy-zzz",
    "stageId": "planning",
    "status": "pending"
  }
}
```

#### 2. 查询任务状态

**接口**: `GET /api/tasks/:taskId/status`

**响应**:
```json
{
  "success": true,
  "data": {
    "taskId": "task_1234567890_abc123",
    "projectId": "preview-xxx-yyy-zzz",
    "stageId": "planning",
    "status": "running",
    "progress": 70,
    "startTime": "2025-01-15T10:00:00.000Z",
    "errorMessage": null
  }
}
```

#### 3. 获取任务结果

**接口**: `GET /api/tasks/:taskId/result`

**响应**:
```json
{
  "success": true,
  "data": {
    "taskId": "task_1234567890_abc123",
    "projectId": "preview-xxx-yyy-zzz",
    "stageId": "planning",
    "resultData": {
      "artifactType": "gdd",
      "gdd": { ... }
    },
    "completeTime": "2025-01-15T10:05:00.000Z"
  }
}
```

## 测试步骤

### 前置准备

1. **启动 MySQL 数据库**
```bash
# 确认 MySQL 容器正在运行
docker ps | grep mysql
```

2. **启动 My-Agent-Test**
```bash
cd /e/NodeProject/my-agent-test
npm run dev
# 应该在 http://localhost:8080 启动
```

3. **启动 Game-Factory Backend**
```bash
cd /e/NodeProject/game-factory/backend
npm run dev
# 应该在 http://localhost:3000 启动
```

4. **启动 Planning Agent**
```bash
cd /e/NodeProject/my-agent-test
npx tsx src/agents/planning/index.ts
```

### 测试场景 1：创建异步任务

```bash
# 1. 登录获取 token（假设你已经有用户）
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "password"
  }'

# 保存返回的 token

# 2. 创建异步预览任务
curl -X POST http://localhost:3000/api/preview-tasks \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": 2,
    "taskName": "测试策划Agent",
    "project": {
      "projectName": "测试RPG游戏",
      "description": "创建一个3D开放世界RPG游戏"
    },
    "cloudProvider": "aliyun"
  }'

# 应该返回 taskId，例如：task_1234567890_abc123
```

### 测试场景 2：查询任务进度

```bash
# 持续查询任务状态（替换 YOUR_TOKEN 和 TASK_ID）
while true; do
  curl -X GET http://localhost:3000/api/preview-tasks/TASK_ID \
    -H "Authorization: Bearer YOUR_TOKEN"
  echo ""
  sleep 5
done
```

### 测试场景 3：查看任务列表

```bash
# 查看所有任务
curl -X GET http://localhost:3000/api/preview-tasks \
  -H "Authorization: Bearer YOUR_TOKEN"

# 只查看运行中的任务
curl -X GET "http://localhost:3000/api/preview-tasks?status=running" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 预期结果

1. **任务创建后**:
   - status: `running`
   - progress: `0`

2. **Planning Agent 执行过程中**:
   - 10%: 开始处理
   - 30%: 知识库搜索完成
   - 70%: GDD生成完成
   - 90%: GDD保存完成
   - 100%: 全部完成

3. **任务完成后**:
   - status: `completed`
   - progress: `100`
   - result_data: 包含 GDD 文件路径和内容

4. **game-factory 数据库中**:
   - agent_preview_tasks 表有对应记录
   - 状态和进度实时更新

## 前端集成建议

### 1. 创建任务界面

```typescript
// 在 Agent 详情页添加"试运行"按钮
async function handlePreview() {
  const taskName = prompt("请输入任务名称:");
  if (!taskName) return;

  const response = await fetch('/api/preview-tasks', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      agentId: agent.id,
      taskName,
      project: {
        projectName: "测试项目",
        description: "用户描述"
      }
    })
  });

  const { data } = await response.json();
  // 跳转到任务进度页面
  router.push(`/preview-tasks/${data.taskId}`);
}
```

### 2. 任务进度页面

```typescript
// 任务进度组件
function TaskProgress({ taskId }) {
  const [task, setTask] = useState(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      const response = await fetch(`/api/preview-tasks/${taskId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const { data } = await response.json();
      setTask(data);

      // 如果完成或失败，停止轮询
      if (data.status === 'completed' || data.status === 'failed') {
        clearInterval(interval);
      }
    }, 2000); // 每2秒刷新一次

    return () => clearInterval(interval);
  }, [taskId]);

  return (
    <div>
      <h2>{task?.task_name}</h2>
      <ProgressBar percent={task?.progress || 0} />
      <div>状态: {task?.status}</div>
      {task?.status === 'completed' && (
        <button onClick={() => viewResult(task.result_data)}>
          查看结果
        </button>
      )}
    </div>
  );
}
```

### 3. 任务列表页面

```typescript
// 显示用户所有的试运行任务
function TaskList() {
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    fetch('/api/preview-tasks', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(({ data }) => setTasks(data));
  }, []);

  return (
    <table>
      <thead>
        <tr>
          <th>任务名称</th>
          <th>Agent</th>
          <th>状态</th>
          <th>进度</th>
          <th>创建时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map(task => (
          <tr key={task.id}>
            <td>{task.task_name}</td>
            <td>{task.agent_name}</td>
            <td>
              <StatusBadge status={task.status} />
            </td>
            <td>{task.progress}%</td>
            <td>{formatDate(task.created_at)}</td>
            <td>
              <Link to={`/preview-tasks/${task.task_id}`}>查看</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

## 故障排查

### 问题 1: 任务一直处于 pending 状态

**原因**:
- My-Agent-Test 服务未启动
- Planning Agent 未启动
- 网络连接问题

**解决**:
```bash
# 检查服务状态
curl http://localhost:8080/health
curl http://localhost:3000/health

# 检查 Planning Agent 是否在运行
ps aux | grep planning
```

### 问题 2: 回调失败

**原因**: game-factory backend URL 配置错误

**解决**:
```bash
# 检查 game-factory .env 文件
cat /e/NodeProject/game-factory/backend/.env | grep BACKEND_URL

# 应该设置为
BACKEND_URL=http://localhost:3000
```

### 问题 3: 数据库连接失败

**解决**:
```bash
# 检查数据库是否可连接
docker exec mysql mysql -uroot -p'4215628@Tim' mydb -e "SELECT 1;"

# 检查表是否存在
docker exec mysql mysql -uroot -p'4215628@Tim' mydb -e "SHOW TABLES LIKE 'agent_preview_tasks';"
```

## 总结

✅ 已完成功能：
1. 数据库表创建 ✓
2. My-Agent-Test 异步执行支持 ✓
3. My-Agent-Test 状态查询API ✓
4. Planning Agent 进度更新 ✓
5. Game-Factory 任务管理API ✓
6. 状态回调机制 ✓

📝 需要前端实现：
1. 试运行按钮（输入任务名称）
2. 任务进度页面（进度条+状态）
3. 任务列表页面（历史记录）
4. 结果查看页面（展示GDD等产物）

🔄 工作流程：
1. 用户点击"试运行" → 输入任务名称 → 调用 `/api/preview-tasks`
2. 后端返回 taskId → 前端跳转到进度页面
3. 前端每2秒轮询 `/api/preview-tasks/:taskId` 获取进度
4. 任务完成后，显示"查看结果"按钮
5. 点击查看结果，展示生成的GDD等产物
