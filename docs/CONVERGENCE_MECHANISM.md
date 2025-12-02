# ReAct Agent 收敛机制设计文档

**问题**: 如何保证 Agent 一定能收敛，避免无限循环？
**更新时间**: 2025-12-02

---

## 🎯 核心问题

在 ReAct Agent 的循环式执行中，如果终极目标一直达不到，会导致：
1. **成本失控**: 无限调用 LLM API
2. **时间失控**: 任务永远无法完成
3. **资源浪费**: 服务器负载过高

---

## 🔍 当前实现的收敛机制

### 1. 最大迭代次数限制 ✅

**实现**: `maxIterations = 50`

```typescript
while (!goalAchieved && this.iterationCount < this.maxIterations) {
  // 执行 ReAct 循环
}
```

**优点**:
- ✅ 硬性上限，保证一定会停止
- ✅ 实现简单

**缺点**:
- ❌ 50 次迭代仍然很多（50 次 LLM 调用）
- ❌ 没有考虑失败模式（可能前 10 次就已经明显失败了）
- ❌ 对于简单任务可能浪费（9个子任务可能 10-15 次迭代就够了）

### 2. 子任务完成检查 ✅

**实现**:
```typescript
if (plan.remainingSubGoals.length === 0 && plan.currentSubGoal.status === "completed") {
  goalAchieved = true;
}
```

**优点**:
- ✅ 明确的成功条件
- ✅ 与任务数量对应（2D: 9个，3D: 10个）

**缺点**:
- ❌ 如果某个子任务一直失败怎么办？

### 3. 错误恢复机制 ⚠️

**实现**:
```typescript
catch (error) {
  if (this.iterationCount < this.maxIterations) {
    await this.streamThought("🔄 尝试继续...");
    continue;
  } else {
    break;
  }
}
```

**问题**:
- ❌ 简单的 continue 可能导致死循环（同样的错误反复出现）
- ❌ 没有区分可恢复错误和不可恢复错误

---

## 🚫 缺失的关键收敛机制

### 1. 总执行时间限制 ❌

**问题**: 即使有 50 次迭代限制，如果每次 LLM 调用很慢，总时间仍可能很长

**建议**:
```typescript
private maxExecutionTime = 30 * 60 * 1000; // 30 分钟
private startTime: Date | null = null;

// 在循环中检查
const elapsedTime = Date.now() - this.startTime.getTime();
if (elapsedTime > this.maxExecutionTime) {
  await this.streamThought(`⏰ 达到最大执行时间 (${this.maxExecutionTime / 60000} 分钟)`);
  break;
}
```

### 2. 连续失败次数限制 ❌

**问题**: 如果同一个子任务连续失败 3 次，说明有系统性问题，应该提前终止

**建议**:
```typescript
private maxConsecutiveFailures = 3;
private consecutiveFailures = 0;

// 在 act 之后
if (actionResult.success) {
  this.consecutiveFailures = 0;
} else {
  this.consecutiveFailures++;
  if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
    await this.streamThought(`❌ 连续失败 ${this.maxConsecutiveFailures} 次，任务终止`);
    break;
  }
}
```

### 3. 进度停滞检测 ❌

**问题**: 如果连续 5 次迭代进度都没有变化，说明卡住了

**建议**:
```typescript
private stagnationThreshold = 5;
private lastProgress = 0;
private stagnationCount = 0;

// 在循环中
const currentProgress = this.calculateProgress();
if (currentProgress === this.lastProgress) {
  this.stagnationCount++;
  if (this.stagnationCount >= this.stagnationThreshold) {
    await this.streamThought(`⚠️  进度停滞 ${this.stagnationThreshold} 次，任务终止`);
    break;
  }
} else {
  this.stagnationCount = 0;
  this.lastProgress = currentProgress;
}
```

### 4. 质量阈值检测 ❌

**问题**: 如果连续多次反思质量都是 "needs_improvement"，应该调整策略或终止

**建议**:
```typescript
private maxPoorQualityCount = 5;
private poorQualityCount = 0;

// 在 reflect 之后
if (reflectionResult.quality === "needs_improvement") {
  this.poorQualityCount++;
  if (this.poorQualityCount >= this.maxPoorQualityCount) {
    await this.streamThought(`⚠️  质量一直不佳，建议人工介入`);
    // 可以选择终止或请求用户输入
  }
}
```

### 5. Token 消耗监控 ❌

**问题**: 控制 LLM API 成本

**建议**:
```typescript
private maxTokenBudget = 100000; // 10万 tokens
private tokenUsed = 0;

// 在 LLM 调用后
this.tokenUsed += llmResponse.usage?.totalTokens || 0;
if (this.tokenUsed > this.maxTokenBudget) {
  await this.streamThought(`💰 Token 预算耗尽 (${this.tokenUsed}/${this.maxTokenBudget})`);
  break;
}
```

---

## 🏆 业界最佳实践

### 1. AutoGPT / BabyAGI 的做法

**多层收敛保障**:
```python
# AutoGPT
MAX_ITERATIONS = 25  # 更保守的迭代次数
MAX_COST = 5.0       # 最大成本（美元）
MAX_TIME = 1800      # 30 分钟
```

**关键特点**:
- ✅ 多维度限制（迭代、成本、时间）
- ✅ 用户可以随时中断
- ✅ 每次迭代前显示预估成本

### 2. LangChain Agent 的做法

**早停机制** (Early Stopping):
```python
class AgentExecutor:
    max_iterations = 15
    max_execution_time = 300  # 5 分钟

    def run(self):
        # 每次迭代检查多个条件
        if self.should_stop():
            return "Agent stopped due to..."
```

**关键特点**:
- ✅ 提供多种停止策略（force, generate）
- ✅ 支持自定义停止条件
- ✅ 详细的停止原因日志

### 3. Langroid 的做法

**分层目标系统**:
```python
# 主目标
main_goal = "生成完整的游戏策划文档"

# 子目标（每个有独立的收敛条件）
sub_goals = [
    Goal("核心设计", max_attempts=3),
    Goal("数值平衡", max_attempts=3),
    ...
]
```

**关键特点**:
- ✅ 每个子目标独立收敛
- ✅ 子目标失败不影响其他子目标
- ✅ 支持跳过失败的非关键子目标

### 4. Microsoft Semantic Kernel 的做法

**断路器模式** (Circuit Breaker):
```csharp
public class AgentCircuitBreaker {
    private int failureThreshold = 3;
    private TimeSpan timeout = TimeSpan.FromMinutes(5);

    // 失败次数达到阈值时，短时间内拒绝所有请求
    // 避免浪费资源在明显失败的任务上
}
```

**关键特点**:
- ✅ 快速失败（Fail Fast）
- ✅ 保护下游服务（LLM API）
- ✅ 自动恢复机制

---

## 💡 推荐的增强方案

### 方案 1: 多层收敛保障（推荐）

```typescript
export interface ConvergenceConfig {
  maxIterations: number;           // 最大迭代次数: 50
  maxExecutionTime: number;         // 最大执行时间: 30分钟
  maxConsecutiveFailures: number;   // 最大连续失败: 3次
  stagnationThreshold: number;      // 进度停滞阈值: 5次
  maxTokenBudget: number;           // Token 预算: 100,000
  maxPoorQualityCount: number;      // 最大低质量次数: 5次
}

export class EnhancedReActPlanningAgent {
  private config: ConvergenceConfig = {
    maxIterations: 50,
    maxExecutionTime: 30 * 60 * 1000,
    maxConsecutiveFailures: 3,
    stagnationThreshold: 5,
    maxTokenBudget: 100000,
    maxPoorQualityCount: 5,
  };

  // 追踪指标
  private consecutiveFailures = 0;
  private stagnationCount = 0;
  private lastProgress = 0;
  private tokenUsed = 0;
  private poorQualityCount = 0;

  private async executeReActLoop(): Promise<void> {
    let goalAchieved = false;

    while (!goalAchieved && this.iterationCount < this.config.maxIterations) {
      this.iterationCount++;

      // 检查所有收敛条件
      const shouldStop = await this.checkConvergence();
      if (shouldStop) {
        break;
      }

      // 执行 ReAct 循环...
    }
  }

  private async checkConvergence(): Promise<boolean> {
    // 1. 检查执行时间
    const elapsed = Date.now() - this.startTime.getTime();
    if (elapsed > this.config.maxExecutionTime) {
      await this.streamThought(`⏰ 达到最大执行时间 (${this.config.maxExecutionTime / 60000} 分钟)`);
      return true;
    }

    // 2. 检查连续失败
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      await this.streamThought(`❌ 连续失败 ${this.config.maxConsecutiveFailures} 次，任务终止`);
      return true;
    }

    // 3. 检查进度停滞
    const currentProgress = this.calculateProgress();
    if (currentProgress === this.lastProgress) {
      this.stagnationCount++;
      if (this.stagnationCount >= this.config.stagnationThreshold) {
        await this.streamThought(`⚠️  进度停滞 ${this.config.stagnationThreshold} 次`);
        // 可以尝试调整策略，而不是直接终止
        return await this.handleStagnation();
      }
    } else {
      this.stagnationCount = 0;
      this.lastProgress = currentProgress;
    }

    // 4. 检查 Token 预算
    if (this.tokenUsed > this.config.maxTokenBudget) {
      await this.streamThought(`💰 Token 预算耗尽 (${this.tokenUsed}/${this.config.maxTokenBudget})`);
      return true;
    }

    // 5. 检查质量趋势
    if (this.poorQualityCount >= this.config.maxPoorQualityCount) {
      await this.streamThought(`⚠️  质量持续不佳，建议人工介入`);
      // 触发用户输入请求
      await this.requestUserIntervention();
      return false; // 不终止，等待用户输入
    }

    return false;
  }

  private async handleStagnation(): Promise<boolean> {
    // 策略 1: 请求用户输入
    await this.streamThought("🤔 进度停滞，请确认是否需要调整目标或提供更多信息");
    await this.requestUserInput({
      question: "当前进度停滞，是否需要调整策略？",
      options: ["继续尝试", "跳过当前任务", "终止执行"]
    });
    return false; // 等待用户决定

    // 策略 2: 降低质量要求
    // 策略 3: 使用 Mock 兜底
  }
}
```

### 方案 2: 自适应迭代限制

根据任务复杂度动态调整最大迭代次数：

```typescript
private calculateMaxIterations(subGoals: SubGoal[]): number {
  const baseIterations = subGoals.length * 1.5; // 每个子任务平均 1.5 次迭代
  const bufferIterations = 5; // 额外的缓冲
  return Math.ceil(baseIterations + bufferIterations);
}

// 2D 游戏: 9 * 1.5 + 5 = 18.5 → 19 次
// 3D 游戏: 10 * 1.5 + 5 = 20 次
```

### 方案 3: 子任务级别的失败处理

允许跳过非关键子任务：

```typescript
export interface SubGoal {
  // ... 现有字段
  critical: boolean;        // 是否为关键任务
  maxRetries: number;       // 最大重试次数
  skipOnFailure: boolean;   // 失败后是否可跳过
}

// 在执行时
if (!actionResult.success) {
  goal.retryCount++;

  if (goal.retryCount >= goal.maxRetries) {
    if (goal.critical) {
      // 关键任务失败，终止整个流程
      throw new Error(`关键任务失败: ${goal.name}`);
    } else if (goal.skipOnFailure) {
      // 非关键任务失败，跳过
      await this.streamThought(`⚠️  任务 ${goal.name} 失败，已跳过`);
      goal.status = "skipped";
    }
  }
}
```

---

## 📊 收敛指标监控

建议记录以下指标用于优化：

```typescript
export interface ConvergenceMetrics {
  totalIterations: number;
  successfulIterations: number;
  failedIterations: number;
  totalExecutionTime: number;
  totalTokensUsed: number;
  averageIterationTime: number;
  stagnationEvents: number;
  convergenceReason: ConvergenceReason;
}

export enum ConvergenceReason {
  GOAL_ACHIEVED = "goal_achieved",
  MAX_ITERATIONS = "max_iterations",
  MAX_TIME = "max_time",
  CONSECUTIVE_FAILURES = "consecutive_failures",
  STAGNATION = "stagnation",
  TOKEN_BUDGET = "token_budget",
  USER_INTERVENTION = "user_intervention",
}
```

---

## 🎯 实施建议

### 阶段 1: 立即实施（高优先级）

1. ✅ **降低 maxIterations 到 25**
   - 当前 50 次太多
   - 9-10 个子任务，25 次迭代足够

2. ✅ **添加总执行时间限制**
   - 设置为 30 分钟
   - 防止长时间卡住

3. ✅ **添加连续失败检测**
   - 连续失败 3 次则终止
   - 快速失败，避免浪费资源

### 阶段 2: 短期优化（中优先级）

4. ✅ **添加进度停滞检测**
   - 检测进度是否变化
   - 触发用户输入请求

5. ✅ **Token 预算监控**
   - 记录 Token 使用
   - 接近预算时警告

### 阶段 3: 长期完善（低优先级）

6. ✅ **自适应迭代限制**
   - 根据任务复杂度调整
   - 简单任务用更少迭代

7. ✅ **子任务失败处理**
   - 区分关键/非关键任务
   - 支持跳过失败的非关键任务

---

## 📝 配置示例

### 开发环境配置（宽松）

```typescript
{
  maxIterations: 30,
  maxExecutionTime: 45 * 60 * 1000,  // 45 分钟
  maxConsecutiveFailures: 5,
  stagnationThreshold: 7,
  maxTokenBudget: 150000,
  maxPoorQualityCount: 7,
}
```

### 生产环境配置（严格）

```typescript
{
  maxIterations: 20,
  maxExecutionTime: 20 * 60 * 1000,  // 20 分钟
  maxConsecutiveFailures: 3,
  stagnationThreshold: 5,
  maxTokenBudget: 80000,
  maxPoorQualityCount: 5,
}
```

### 测试环境配置（最严格）

```typescript
{
  maxIterations: 15,
  maxExecutionTime: 10 * 60 * 1000,  // 10 分钟
  maxConsecutiveFailures: 2,
  stagnationThreshold: 3,
  maxTokenBudget: 50000,
  maxPoorQualityCount: 3,
}
```

---

## 🔍 监控和告警

建议添加以下监控指标：

```typescript
// 告警规则
if (metrics.convergenceReason !== ConvergenceReason.GOAL_ACHIEVED) {
  // 发送告警: 任务未正常完成
  logger.warn(`Task ${projectId} converged abnormally: ${metrics.convergenceReason}`);
}

if (metrics.totalTokensUsed > config.maxTokenBudget * 0.8) {
  // 发送告警: Token 使用接近预算
  logger.warn(`Task ${projectId} using high tokens: ${metrics.totalTokensUsed}`);
}

if (metrics.totalExecutionTime > config.maxExecutionTime * 0.8) {
  // 发送告警: 执行时间过长
  logger.warn(`Task ${projectId} taking too long: ${metrics.totalExecutionTime}ms`);
}
```

---

## 🎉 总结

### 当前问题

- ❌ 仅有迭代次数限制（50 次太多）
- ❌ 缺少时间、失败、停滞等维度的保障
- ❌ 成本和质量无监控

### 推荐方案

- ✅ 多层收敛保障（迭代、时间、失败、停滞、Token、质量）
- ✅ 降低 maxIterations 到 20-25
- ✅ 添加用户干预机制
- ✅ 详细的收敛指标监控

### 参考业界实践

- AutoGPT: 多维度限制
- LangChain: 早停机制
- Langroid: 分层目标
- Semantic Kernel: 断路器模式

---

**下一步**: 实施阶段 1 的高优先级改进
**预估工作量**: 2-3 小时
**预期效果**: 避免 90% 的无限循环问题

**文档版本**: v1.0
**最后更新**: 2025-12-02
