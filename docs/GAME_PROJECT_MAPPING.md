# game-factory 与 my-agent-test 数据映射关系

## ✅ 确认：project = game

### game-factory 数据结构

```sql
-- games 表（游戏项目表）
CREATE TABLE games (
  id INT AUTO_INCREMENT PRIMARY KEY,     -- 游戏 ID
  name VARCHAR(255) NOT NULL,            -- 游戏名称
  company_id INT NOT NULL,               -- 所属公司 ID
  genre VARCHAR(50),                     -- 游戏类型
  description TEXT,                      -- 游戏描述
  development_status VARCHAR(50),        -- 开发状态
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- companies 表（公司表）
CREATE TABLE companies (
  id INT AUTO_INCREMENT PRIMARY KEY,     -- 公司 ID
  name VARCHAR(255) NOT NULL,            -- 公司名称
  owner_id INT NOT NULL,                 -- 公司所有者（用户 ID）
  created_at TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);
```

### 关系图

```
User (用户)
  └─ owns Company (公司)
      └─ creates Games (游戏项目)
          └─ triggers Workflow (工作流)
              └─ executes in my-agent-test
```

---

## 🔑 关键映射关系

| game-factory | my-agent-test | 说明 |
|--------------|---------------|------|
| `users.id` | `ExecutionRecord.userId` | 用户 ID（游戏创建者） |
| `companies.id` | `ExecutionRecord.companyId` | 公司 ID（元数据） |
| **`games.id`** | **`ExecutionRecord.projectId`** | 🔥 游戏 ID（核心映射） |

### 示例

```typescript
// game-factory 创建游戏
const game = await db.execute(`
  INSERT INTO games (name, company_id, genre, description, development_status)
  VALUES ('魔法世界冒险', 456, 'rpg', '一款3D ARPG', 'developing')
`);
// game.insertId = 789

// 发送到 my-agent-test
const executionRequest = {
  userId: 123,              // ← companies.owner_id
  companyId: 456,           // ← games.company_id
  projectId: "789",         // ← 🔥 games.id (转为字符串)
  project: {
    projectName: "魔法世界冒险",  // ← games.name
    // ...
  }
};
```

---

## 📂 文件路径映射

### 本地存储

```
./data/users/{userId}/projects/{projectId}/
./data/users/123/projects/789/
            ↑            ↑
     companies.     games.id
      owner_id
```

### 云存储

```
users/{userId}/projects/{projectId}/artifacts/
users/123/projects/789/artifacts/gdd.md
      ↑            ↑
  companies.   games.id
   owner_id
```

---

## 🔄 完整数据流

### 创建游戏项目

```typescript
// game-factory: backend/src/routes/games.ts:104-149
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  const { title, company_id, genre, description } = req.body;

  // 1. 创建游戏记录
  const [result] = await connection.execute(
    `INSERT INTO games (name, company_id, genre, description, development_status)
     VALUES (?, ?, ?, ?, 'developing')`,
    [title, company_id, genre, description || null]
  );

  const gameId = result.insertId;  // ← 游戏 ID

  // 2. 发送 Kafka 消息
  await kafka.send({
    topic: 'workflow-tasks',
    messages: [{
      value: JSON.stringify({
        jobId: uuidv4(),
        companyId: company_id,
        ownerId: req.user.id,
        payload: {
          userId: req.user.id,         // ← 用户 ID
          companyId: company_id,       // ← 公司 ID
          projectId: gameId.toString(), // ← 🔥 游戏 ID
          project: {
            projectName: title,
            // ...
          }
        }
      })
    }]
  });
});
```

### my-agent-test 处理

```typescript
// my-agent-test: src/a2a-server/index.ts
app.post("/api/executions", (req, res) => {
  const data = req.body as ExecutionRequest;

  // 🔥 使用 game-factory 的 gameId 作为 projectId
  const projectId = data.projectId || uuidv4();

  // 创建项目（使用游戏 ID）
  const project = projectManager.createProject(
    projectId,  // ← games.id = "789"
    data.project.projectName,
    userInput,
    data.executionMode
  );

  // 文件保存路径
  const gddPath = PathService.getGDDPath(data.userId, projectId);
  // → ./data/users/123/projects/789/gdd.md
});
```

### 查询游戏状态

```typescript
// game-factory 查询执行状态
async function getGameDevelopmentStatus(gameId: number) {
  // 直接使用 gameId 查询
  const response = await fetch(
    `http://my-agent-test:8090/api/executions?projectId=${gameId}`
  );
  return response.json();
}
```

---

## 📋 术语对照

| game-factory | my-agent-test | 含义 |
|--------------|---------------|------|
| game (游戏) | project (项目) | 同一个概念 |
| games.id | projectId | 游戏/项目的唯一标识 |
| games.name | project.projectName | 游戏/项目名称 |
| games.company_id | companyId | 所属公司 |
| companies.owner_id | userId | 游戏创建者 |

---

## 总结

✅ **project 就是 game**
- game-factory 的 **games 表** = my-agent-test 的 **project 概念**
- games.id = projectId（核心映射）

✅ **三个必须传递的 ID**
1. `userId` (companies.owner_id) - 数据隔离
2. `projectId` (games.id) - 项目标识
3. `companyId` (games.company_id) - 元数据

✅ **文件路径**
- `./data/users/{userId}/projects/{projectId}/`
- userId = 用户 ID
- projectId = 游戏 ID

---

*文档更新时间：2025-11-30*
