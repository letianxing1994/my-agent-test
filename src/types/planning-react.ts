/**
 * ReAct Planning Agent 类型定义
 * 基于《全能游戏策划GDD工作体系指南》的双轨制体系
 */

export interface SubGoal {
  id: string;
  name: string;
  description: string;
  type: 'llm' | 'direct' | 'user_input' | '2d_generation';
  relatedGDDSections: string[];
  dependencies: string[];
  status: 'pending' | 'in_progress' | 'completed';
  estimatedProgress: number;
  track: 'private_sandbox' | 'interface_docs'; // 双轨制标记
  validationCriteria?: string[]; // 验证标准
  imagePrompts?: string[]; // 2D图像生成提示词
  details?: Record<string, any>; // 额外详情
}

export interface ObservationContext {
  // 当前 GDD 状态
  currentGDD: {
    sandbox?: Record<string, any>; // 私人沙盒内容
    interface?: Record<string, any>; // 对外接口文档
  };
  completedSections: string[];
  pendingSections: string[];

  // 外部输入
  externalInputs: {
    userFeedback?: string;
    otherAgentMessages?: any[];
  };

  // 历史记录
  previousIterations: IterationRecord[];

  // 用户上传的资源
  uploadedResources?: Array<{
    filename: string;
    type: 'image' | 'audio' | '3d' | 'document';
    purpose: string;
    path: string;
  }>;

  // 已处理的概念图（用于Observe阶段）
  uploadedConceptImages?: Array<{
    filename: string;
    type: 'image';
    purpose: string;
    path: string;
  }>;

  // 任务元信息
  taskMeta: {
    projectId: string;
    userId: number; // 新增：用户ID
    userInput: any;
    stageConfig: any;
    cloudProvider: 'aliyun' | 'gcp'; // 新增：云服务商
    iterationCount: number;
    startTime: Date;
    currentPlan?: GoalPlan;
  };
}

export interface GoalPlan {
  finalGoal: string;
  currentSubGoal: SubGoal;
  remainingSubGoals: SubGoal[];
  adjustmentReason?: string;
}

export interface ActionResult {
  success: boolean;
  output: any;
  thought: string;
  progressDelta: number;
  nextAction?: 'continue' | 'await_user_input' | 'complete';
  artifacts?: {
    type: 'gdd_section' | 'image' | 'validation_report';
    path: string;
    data: any;
  }[];
}

export interface ReflectionResult {
  quality: 'excellent' | 'good' | 'needs_improvement';
  issues: string[];
  improvements: string[];
  shouldAdjustPlan: boolean;
  memoryToSave: Array<{
    key: string;
    value: string;
    importance: 'high' | 'medium' | 'low';
  }>;
}

export interface IterationRecord {
  iterationNumber: number;
  goal: SubGoal;
  actionResult: ActionResult;
  reflectionResult: ReflectionResult;
  timestamp: Date;
  duration: number; // 毫秒
}

export interface ThoughtStreamEvent {
  type: 'thought' | 'llm_output' | 'goal_update' | 'progress_update' | 'artifact_created';
  content: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}

export interface UserInputRequest {
  goalId: string;
  question: string;
  options?: string[];
  context?: Record<string, any>;
}
