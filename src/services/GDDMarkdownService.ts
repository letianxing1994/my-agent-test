import fs from "fs-extra";
import path from "node:path";
import matter from "gray-matter";
import type { GDD } from "../types";

/**
 * GDD Markdown Service
 *
 * 负责 GDD 的 Markdown 格式存储、读取和解析
 * 采用 YAML Frontmatter + Markdown 作为主存储格式
 */
export class GDDMarkdownService {
	/**
	 * 从 Markdown 文件读取并解析为 GDD 对象
	 */
	static async readGDD(projectId: string): Promise<{
		gdd: Partial<GDD>;
		markdown: string;
		metadata: Record<string, unknown>;
	}> {
		const filePath = this.getGDDPath(projectId);

		if (!fs.existsSync(filePath)) {
			throw new Error(`GDD file not found: ${filePath}`);
		}

		const fileContent = fs.readFileSync(filePath, "utf-8");
		const { data, content } = matter(fileContent);

		// YAML frontmatter 包含结构化元数据
		const gdd: Partial<GDD> = {
			projectId: (data.projectId as string) || projectId,
			projectName: (data.projectName as string) || "",
			gameType: (data.gameType as string) || "",
			primaryGenre: data.primaryGenre as GDD["primaryGenre"],
			subGenre: data.subGenre as GDD["subGenre"],
			dimension: (data.dimension as string) || "3d",
			artStyle: (data.artStyle as string) || "",
			gameMode: (data.gameMode as string) || "singleplayer",
			createdAt: (data.createdAt as string) || new Date().toISOString(),
			updatedAt: (data.updatedAt as string) || new Date().toISOString(),
			// 从 frontmatter 提取其他字段
			hybridGenres: data.hybridGenres as GDD["hybridGenres"],
			coreConcept: data.coreConcept as string | undefined,
		};

		return {
			gdd,
			markdown: content.trim(),
			metadata: data,
		};
	}

	/**
	 * 保存 GDD 为 Markdown 格式
	 */
	static async saveGDD(
		projectId: string,
		gdd: Partial<GDD>,
		markdownContent: string,
	): Promise<void> {
		const filePath = this.getGDDPath(projectId);
		const dir = path.dirname(filePath);

		// 确保目录存在
		fs.ensureDirSync(dir);

		// 构建 YAML frontmatter
		const frontmatter: Record<string, unknown> = {
			projectId: gdd.projectId || projectId,
			projectName: gdd.projectName || "",
			gameType: gdd.gameType || "",
			primaryGenre: gdd.primaryGenre,
			subGenre: gdd.subGenre,
			dimension: gdd.dimension || "3d",
			artStyle: gdd.artStyle || "",
			gameMode: gdd.gameMode || "singleplayer",
			createdAt: gdd.createdAt || new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		// 添加可选字段
		if (gdd.hybridGenres?.length) {
			frontmatter.hybridGenres = gdd.hybridGenres;
		}
		if (gdd.coreConcept) {
			frontmatter.coreConcept = gdd.coreConcept;
		}

		// 使用 gray-matter 构建完整文件
		const fileContent = matter.stringify(markdownContent, frontmatter);

		// 保存文件
		fs.writeFileSync(filePath, fileContent, "utf-8");

		// 同时保存一份 JSON（用于兼容性和快速解析）
		await this.saveGDDJson(projectId, gdd);
	}

	/**
	 * 保存 JSON 格式（向后兼容）
	 */
	private static async saveGDDJson(
		projectId: string,
		gdd: Partial<GDD>,
	): Promise<void> {
		const jsonPath = this.getGDDPath(projectId).replace(".md", ".json");
		fs.writeJSONSync(jsonPath, gdd, { spaces: 2 });
	}

	/**
	 * 从 Markdown 内容提取结构化数据
	 * 使用简单的正则解析或 AI 辅助解析
	 */
	static extractStructuredData(markdown: string): Partial<GDD> {
		const extracted: Partial<GDD> = {};

		// 提取核心概念
		const coreConcept = this.extractSection(markdown, "## 1. 核心概念");
		if (coreConcept) {
			extracted.coreConcept = coreConcept
				.split("\n")
				.filter((line) => !line.startsWith("#") && line.trim())
				.join("\n")
				.trim();
		}

		// 提取玩法机制
		const mechanics = this.extractGameplayMechanics(markdown);
		if (mechanics.length > 0) {
			extracted.gameplayMechanics = mechanics;
		}

		// 提取美术需求表格
		const artReqs = this.extractTableData(
			markdown,
			"## 6. 美术需求",
			["type", "description", "quantity", "priority"],
		);
		if (artReqs.length > 0) {
			extracted.artRequirements = artReqs.map((row) => ({
				type: row.type as "character" | "environment" | "ui" | "icon",
				description: row.description,
				quantity: Number.parseInt(row.quantity, 10) || 1,
				priority: row.priority as "high" | "medium" | "low",
			}));
		}

		// 提取音频需求表格
		const audioReqs = this.extractTableData(
			markdown,
			"## 7. 音频需求",
			["type", "description", "quantity", "priority"],
		);
		if (audioReqs.length > 0) {
			extracted.audioRequirements = audioReqs.map((row) => ({
				type: row.type as "bgm" | "sfx",
				description: row.description,
				quantity: Number.parseInt(row.quantity, 10) || 1,
				priority: row.priority as "high" | "medium" | "low",
			}));
		}

		// 提取技术需求
		const techReqs = this.extractTechnicalRequirements(markdown);
		if (techReqs) {
			extracted.technicalRequirements = techReqs;
		}

		return extracted;
	}

	/**
	 * 提取指定章节的内容
	 */
	private static extractSection(markdown: string, header: string): string {
		const lines = markdown.split("\n");
		const startIdx = lines.findIndex((line) => line.trim().startsWith(header));

		if (startIdx === -1) return "";

		const endIdx = lines.findIndex(
			(line, idx) =>
				idx > startIdx && line.trim().startsWith("##") && !line.includes(header),
		);

		const sectionLines =
			endIdx === -1 ? lines.slice(startIdx + 1) : lines.slice(startIdx + 1, endIdx);

		return sectionLines.join("\n").trim();
	}

	/**
	 * 提取玩法机制
	 */
	private static extractGameplayMechanics(
		markdown: string,
	): Array<{ name: string; description: string; implementationDetails: string }> {
		const mechanicsSection = this.extractSection(markdown, "## 2. 核心玩法机制");
		if (!mechanicsSection) return [];

		const mechanics: Array<{
			name: string;
			description: string;
			implementationDetails: string;
		}> = [];
		const subsections = mechanicsSection.split(/### \d+\.\d+\s+/).filter(Boolean);

		for (const section of subsections) {
			const lines = section.split("\n");
			const name = lines[0]?.trim() || "";

			const descMatch = section.match(/\*\*描述\*\*:\s*(.+)/);
			const description = descMatch?.[1]?.trim() || "";

			const implMatch = section.match(/\*\*实现细节\*\*:\s*([\s\S]+?)(?=\n\n|\n###|$)/);
			const implementationDetails = implMatch?.[1]?.trim() || "";

			if (name) {
				mechanics.push({ name, description, implementationDetails });
			}
		}

		return mechanics;
	}

	/**
	 * 提取 Markdown 表格数据
	 */
	private static extractTableData(
		markdown: string,
		sectionHeader: string,
		columns: string[],
	): Array<Record<string, string>> {
		const section = this.extractSection(markdown, sectionHeader);
		if (!section) return [];

		const lines = section.split("\n");
		const tableLines = lines.filter(
			(line) => line.trim().startsWith("|") && !line.includes("---"),
		);

		if (tableLines.length < 2) return [];

		const rows: Array<Record<string, string>> = [];

		for (let i = 1; i < tableLines.length; i++) {
			const cells = tableLines[i]
				.split("|")
				.map((cell) => cell.trim())
				.filter(Boolean);

			if (cells.length === columns.length) {
				const row: Record<string, string> = {};
				for (let j = 0; j < columns.length; j++) {
					row[columns[j]] = cells[j];
				}
				rows.push(row);
			}
		}

		return rows;
	}

	/**
	 * 提取技术需求
	 */
	private static extractTechnicalRequirements(markdown: string): {
		engine: string;
		targetPlatforms: string[];
		performanceRequirements?: string;
	} | null {
		const section = this.extractSection(markdown, "## 8. 技术需求");
		if (!section) return null;

		const engineMatch = section.match(/\*\*游戏引擎\*\*:\s*(.+)/);
		const engine = engineMatch?.[1]?.trim() || "Unity";

		const platformMatch = section.match(/\*\*目标平台\*\*:\s*(.+)/);
		const platforms = platformMatch?.[1]?.split(",").map((p) => p.trim()) || ["PC"];

		const perfMatch = section.match(/\*\*性能要求\*\*:\s*([\s\S]+?)(?=\n\*\*|$)/);
		const performanceRequirements = perfMatch?.[1]?.trim();

		return {
			engine,
			targetPlatforms: platforms,
			performanceRequirements,
		};
	}

	/**
	 * 获取 GDD Markdown 文件路径
	 */
	private static getGDDPath(projectId: string): string {
		return path.resolve(`./data/projects/${projectId}/gdd.md`);
	}

	/**
	 * 检查 GDD 文件是否存在
	 */
	static exists(projectId: string): boolean {
		return fs.existsSync(this.getGDDPath(projectId));
	}

	/**
	 * 导出为 HTML（用于预览和文档评审）
	 */
	static async exportToHTML(projectId: string): Promise<string> {
		const { markdown, metadata } = await this.readGDD(projectId);

		// 简单的 Markdown 到 HTML 转换
		// 生产环境应使用 marked 或 markdown-it
		const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${metadata.projectName} - 游戏设计文档</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
        }
        h1, h2, h3 { color: #333; }
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        code { background-color: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
        pre { background-color: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
    </style>
</head>
<body>
    <div class="metadata">
        <p><strong>项目ID:</strong> ${metadata.projectId}</p>
        <p><strong>创建时间:</strong> ${metadata.createdAt}</p>
        <p><strong>最后更新:</strong> ${metadata.updatedAt}</p>
    </div>
    <hr>
    <pre>${markdown}</pre>
</body>
</html>
        `.trim();

		const htmlPath = this.getGDDPath(projectId).replace(".md", ".html");
		fs.writeFileSync(htmlPath, html, "utf-8");

		return htmlPath;
	}
}
