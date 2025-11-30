-- 创建 agent 预览任务表
-- 用于记录用户的 agent 试运行任务，支持异步执行和进度追踪

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
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Agent预览任务表';

-- 创建索引以优化查询
CREATE INDEX `idx_user_status` ON `agent_preview_tasks` (`user_id`, `status`);
CREATE INDEX `idx_game_id` ON `agent_preview_tasks` (`game_id`);
