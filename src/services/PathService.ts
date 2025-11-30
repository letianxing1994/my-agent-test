import path from "node:path";

/**
 * PathService - 统一管理持久化路径
 *
 * 核心设计原则：
 * - 主键：userId + projectId
 * - 本地路径：./data/users/{userId}/projects/{projectId}/
 * - 云存储路径：users/{userId}/projects/{projectId}/
 * - companyId, agentId 作为元数据，不在路径中
 */
export class PathService {
	/**
	 * 验证 userId 有效性（防止注入攻击）
	 */
	private static validateUserId(userId: number): void {
		if (!Number.isInteger(userId) || userId <= 0) {
			throw new Error(`Invalid userId: ${userId}`);
		}
	}

	/**
	 * 验证 projectId 有效性（防止路径遍历攻击）
	 */
	private static validateProjectId(projectId: string): void {
		if (!projectId || typeof projectId !== "string") {
			throw new Error("projectId is required");
		}
		// 只允许字母、数字、下划线、连字符
		if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
			throw new Error(`Invalid projectId: ${projectId}`);
		}
	}

	/**
	 * 获取用户项目的本地根路径
	 *
	 * @param userId - 用户ID
	 * @param projectId - 项目ID
	 * @returns ./data/users/{userId}/projects/{projectId}
	 */
	static getLocalProjectPath(userId: number, projectId: string): string {
		this.validateUserId(userId);
		this.validateProjectId(projectId);
		return path.resolve(`./data/users/${userId}/projects/${projectId}`);
	}

	/**
	 * 获取用户项目的云存储路径前缀
	 *
	 * @param userId - 用户ID
	 * @param projectId - 项目ID
	 * @returns users/{userId}/projects/{projectId}
	 */
	static getCloudProjectPath(userId: number, projectId: string): string {
		this.validateUserId(userId);
		this.validateProjectId(projectId);
		return `users/${userId}/projects/${projectId}`;
	}

	/**
	 * 获取 GDD Markdown 文件路径
	 *
	 * @param userId - 用户ID
	 * @param projectId - 项目ID
	 * @returns ./data/users/{userId}/projects/{projectId}/gdd.md
	 */
	static getGDDPath(userId: number, projectId: string): string {
		return path.join(this.getLocalProjectPath(userId, projectId), "gdd.md");
	}

	/**
	 * 获取 GDD JSON 文件路径（兼容）
	 *
	 * @param userId - 用户ID
	 * @param projectId - 项目ID
	 * @returns ./data/users/{userId}/projects/{projectId}/gdd.json
	 */
	static getGDDJsonPath(userId: number, projectId: string): string {
		return path.join(this.getLocalProjectPath(userId, projectId), "gdd.json");
	}

	/**
	 * 获取美术资源目录路径
	 *
	 * @param userId - 用户ID
	 * @param projectId - 项目ID
	 * @returns ./data/users/{userId}/projects/{projectId}/art
	 */
	static getArtPath(userId: number, projectId: string): string {
		return path.join(this.getLocalProjectPath(userId, projectId), "art");
	}

	/**
	 * 获取音乐资源目录路径
	 *
	 * @param userId - 用户ID
	 * @param projectId - 项目ID
	 * @returns ./data/users/{userId}/projects/{projectId}/music
	 */
	static getMusicPath(userId: number, projectId: string): string {
		return path.join(this.getLocalProjectPath(userId, projectId), "music");
	}

	/**
	 * 获取代码/构建目录路径
	 *
	 * @param userId - 用户ID
	 * @param projectId - 项目ID
	 * @returns ./data/users/{userId}/projects/{projectId}/code
	 */
	static getCodePath(userId: number, projectId: string): string {
		return path.join(this.getLocalProjectPath(userId, projectId), "code");
	}

	/**
	 * 获取测试报告目录路径
	 *
	 * @param userId - 用户ID
	 * @param projectId - 项目ID
	 * @returns ./data/users/{userId}/projects/{projectId}/reports
	 */
	static getReportsPath(userId: number, projectId: string): string {
		return path.join(this.getLocalProjectPath(userId, projectId), "reports");
	}

	/**
	 * 获取云存储 artifact key
	 *
	 * @param userId - 用户ID
	 * @param projectId - 项目ID
	 * @param artifactPath - artifact 相对路径（如 "art/character_001.fbx"）
	 * @returns users/{userId}/projects/{projectId}/artifacts/{artifactPath}
	 */
	static getCloudArtifactKey(
		userId: number,
		projectId: string,
		artifactPath: string,
	): string {
		return `${this.getCloudProjectPath(userId, projectId)}/artifacts/${artifactPath}`;
	}

	/**
	 * 获取云存储构建输出 key
	 *
	 * @param userId - 用户ID
	 * @param projectId - 项目ID
	 * @param buildName - 构建文件名（如 "game_v1.0.zip"）
	 * @returns users/{userId}/projects/{projectId}/outputs/builds/{buildName}
	 */
	static getCloudBuildKey(
		userId: number,
		projectId: string,
		buildName: string,
	): string {
		return `${this.getCloudProjectPath(userId, projectId)}/outputs/builds/${buildName}`;
	}

	/**
	 * 向后兼容：获取旧的项目路径（不带 userId）
	 *
	 * @param projectId - 项目ID
	 * @returns ./data/projects/{projectId}
	 * @deprecated 仅用于迁移期间的兼容
	 */
	static getLegacyProjectPath(projectId: string): string {
		this.validateProjectId(projectId);
		return path.resolve(`./data/projects/${projectId}`);
	}

	/**
	 * 检查项目路径是否使用新格式（包含 userId）
	 *
	 * @param userId - 用户ID（可选）
	 * @param projectId - 项目ID
	 * @returns 如果 userId 存在，返回新路径；否则返回旧路径
	 */
	static getProjectPath(
		projectId: string,
		userId?: number,
	): string {
		if (userId) {
			return this.getLocalProjectPath(userId, projectId);
		}
		return this.getLegacyProjectPath(projectId);
	}
}
