import "dotenv/config";
import path from "node:path";
import archiver from "archiver";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import { WebSocket } from "ws";

// 导入共享类型
import {
	type AgentArtifact,
	type AgentMessage,
	type GDD,
	MessageType,
	type StageConfig,
} from "../../types";

// 导入服务
import { knowledgeBaseService } from "../../services/KnowledgeBaseService";
import { mem0Service } from "../../services/Mem0Service";
import { storageService } from "../../services/storage/StorageService";

const LARGE_FILE_THRESHOLD =
	Number(process.env.LARGE_UPLOAD_THRESHOLD_MB || "200") * 1024 * 1024;
const MULTIPART_CHUNK_SIZE =
	Number(process.env.MULTIPART_CHUNK_SIZE_MB || "32") * 1024 * 1024;

type CloudProvider = "aliyun" | "gcp";

interface ResourceReference {
	id: string;
	filePath: string;
	type: "art" | "audio";
	description?: string;
	provider?: CloudProvider;
	metadata?: Record<string, unknown>;
	remoteUrl?: string;
}

interface ResourceUpdatePayload {
	resourceType?: "art" | "audio";
	resources?: Array<
		Partial<ResourceReference> & {
			url?: string;
			metadata?: Record<string, unknown>;
		}
	>;
	artAssets?: string[];
	musicAssets?: string[];
	stageConfig?: StageConfig;
	project?: { cloudProvider?: CloudProvider };
	gdd?: GDD;
}

interface BuildSummary {
	projectId: string;
	buildId: string;
	engine?: string;
	buildTime: string;
	status: "success" | "failed";
	outputPath: string;
	buildType: "dev" | "prod";
	resourcesCount: { art: number; audio: number };
	packagePath?: string;
	remoteUrl?: string;
	provider?: CloudProvider;
	uploadMetadata?: Record<string, unknown>;
}

interface ControlMessagePayload {
	action?: "pause" | "resume" | "abort";
	notes?: string;
}

interface FeedbackPayload {
	description?: string;
	[key: string]: unknown;
}

interface GDDPayload {
	gdd?: GDD;
	project?: { cloudProvider?: CloudProvider };
	stageConfig?: StageConfig;
}

// 模拟AI模型调用（用于生成代码）
class AIModel {
	// 生成游戏代码的方法（模拟）
	async generateGameCode(
		gdd: GDD,
		engine: string,
		artResources: ResourceReference[],
	): Promise<{ [key: string]: string }> {
		console.log(`[模型调用] 为 ${engine} 引擎生成游戏代码`);

		const integrationManifest = this.composeAssetManifest(artResources);

		const coreModules = this.generateEngineTemplates(
			engine,
			gdd,
			integrationManifest,
		);

		return {
			...coreModules,
			"src/systems/PhysicsSystem.ts": this.generatePhysicsModule(gdd),
			"src/tools/ResourceBinder.ts":
				this.generateResourceBinder(integrationManifest),
			"src/config/assetManifest.ts": `export default ${JSON.stringify(
				integrationManifest,
				null,
				2,
			)};`,
		};
	}

	private generateEngineTemplates(
		engine: string,
		gdd: GDD,
		manifest: Record<string, unknown>,
	) {
		switch (engine.toLowerCase()) {
			case "unity":
				return this.generateUnityCode(gdd, manifest);
			case "godot":
				return this.generateGodotCode(gdd, manifest);
			case "three.js":
				return this.generateThreeJsCode(gdd, manifest);
			case "pixijs":
				return this.generatePixiJsCode(gdd, manifest);
			default:
				return this.generateBasicCode(gdd, manifest, engine);
		}
	}

	// 生成Unity代码（模拟）
	private generateUnityCode(
		gdd: GDD,
		manifest: Record<string, unknown>,
	): { [key: string]: string } {
		return {
			"Assets/Scripts/GameManager.cs": `using UnityEngine;\nusing System.Collections.Generic;\n\npublic class GameManager : MonoBehaviour\n{\n    public AssetRegistry Registry { get; private set; }\n\n    void Start()\n    {\n        Registry = new AssetRegistry();\n        Registry.LoadManifest("${gdd.projectName}_manifest");\n        Debug.Log("游戏启动: ${gdd.projectName}");\n        SceneAssembler.BuildScene(Registry);\n    }\n}\n`,
			"Assets/Scripts/PlayerController.cs": `using UnityEngine;\n\npublic class PlayerController : MonoBehaviour\n{\n    public float moveSpeed = 5.0f;\n    \n    void Update()\n    {\n        float horizontal = Input.GetAxis("Horizontal");\n        float vertical = Input.GetAxis("Vertical");\n        \n        transform.position += new Vector3(horizontal, 0, vertical) * moveSpeed * Time.deltaTime;\n    }\n}`,
			"Assets/Scripts/AssetRegistry.cs": `using UnityEngine;\nusing System.Collections.Generic;\n\npublic class AssetRegistry\n{\n    private Dictionary<string, string> _map = new Dictionary<string, string>();\n\n    public void LoadManifest(string name)\n    {\n        // 这里模拟从JSON加载资产映射关系\n        _map.Clear();\n        _map["character_main"] = "Assets/Art/Characters/MainCharacter.glb";\n    }\n\n    public string Resolve(string key)\n    {\n        return _map.ContainsKey(key) ? _map[key] : string.Empty;\n    }\n}`,
			"Assets/Scenes/MainScene.unity": `// Unity场景文件 (模拟)\nSceneInfo: {\n  name: "MainScene",\n  objects: ["Player", "Camera", "Light"]\n}`,
		};
	}

	// 生成Godot代码（模拟）
	private generateGodotCode(
		gdd: GDD,
		manifest: Record<string, unknown>,
	): { [key: string]: string } {
		return {
			"res://scripts/GameManager.gd": `extends Node\n\nfunc _ready():\n    print("游戏启动: ${gdd.projectName}")\n    # 初始化游戏系统\n\nfunc _process(delta):\n    # 游戏主循环\n    pass`,
			"res://scripts/Player.gd": `extends KinematicBody2D\n\nvar speed = 200\n\nfunc _physics_process(delta):\n    var velocity = Vector2()\n    \n    if Input.is_action_pressed("ui_right"):\n        velocity.x += 1\n    if Input.is_action_pressed("ui_left"):\n        velocity.x -= 1\n    if Input.is_action_pressed("ui_down"):\n        velocity.y += 1\n    if Input.is_action_pressed("ui_up"):\n        velocity.y -= 1\n    \n    velocity = velocity.normalized() * speed\n    move_and_slide(velocity)`,
			"res://scenes/MainScene.tscn": `# Godot场景文件 (模拟)\n[gd_scene load_steps=2 format=2]\n\n[node name="GameManager" type="Node"]\nscript = ExtResource( 1 )\n\n[ext_resource path="res://scripts/GameManager.gd" type="Script" id=1]`,
		};
	}

	// 生成Three.js代码（模拟）
	private generateThreeJsCode(
		gdd: GDD,
		manifest: Record<string, unknown>,
	): { [key: string]: string } {
		return {
			"src/main.js": `import * as THREE from 'three';\nimport { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';\nimport manifest from './config/assetManifest';\nimport { loadGLTF } from './tools/ResourceBinder';\n\nconst scene = new THREE.Scene();\nconst camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);\nconst renderer = new THREE.WebGLRenderer();\nrenderer.setSize(window.innerWidth, window.innerHeight);\ndocument.body.appendChild(renderer.domElement);\n\nconst controls = new OrbitControls(camera, renderer.domElement);\n\nasync function spawnHero() {\n    const heroAsset = manifest.characters?.[0];\n    if (!heroAsset) return;\n    const mesh = await loadGLTF(heroAsset.path);\n    scene.add(mesh);\n}\n\nasync function spawnEnvironment() {\n    const envAsset = manifest.environments?.[0];\n    if (!envAsset) return;\n    const env = await loadGLTF(envAsset.path);\n    scene.add(env);\n}\n\ncamera.position.z = 5;\n\nasync function bootstrap() {\n    await spawnHero();\n    await spawnEnvironment();\n    animate();\n}\n\nfunction animate() {\n    requestAnimationFrame(animate);\n    controls.update();\n    renderer.render(scene, camera);\n}\n\nbootstrap();\nconsole.log(\"游戏启动: ${gdd.projectName}\");`,
			"index.html": `<!DOCTYPE html>\n<html>\n<head>\n    <meta charset="utf-8">\n    <title>${gdd.projectName}</title>\n    <style>\n        body { margin: 0; }\n        canvas { display: block; }\n    </style>\n</head>\n<body>\n    <script type="module" src="./src/main.js"></script>\n</body>\n</html>`,
		};
	}

	// 生成PixiJS代码（模拟）
	private generatePixiJsCode(
		gdd: GDD,
		manifest: Record<string, unknown>,
	): { [key: string]: string } {
		return {
			"src/main.js": `import * as PIXI from 'pixi.js';\nimport manifest from './config/assetManifest';\n\nconst app = new PIXI.Application({ width: 1280, height: 720, backgroundColor: 0x000000 });\ndocument.body.appendChild(app.view);\n\nasync function bootstrap() {\n    const uiAsset = manifest.ui?.[0];\n    if (uiAsset) {\n        const sprite = PIXI.Sprite.from(uiAsset.path);\n        sprite.x = app.screen.width / 2;\n        sprite.y = app.screen.height / 2;\n        sprite.anchor.set(0.5);\n        app.stage.addChild(sprite);\n    }\n\n    app.ticker.add((delta) => {\n        app.stage.rotation += 0.0005 * delta;\n    });\n}\n\nbootstrap();\nconsole.log(\"游戏启动: ${gdd.projectName}\");`,
			"index.html": `<!DOCTYPE html>\n<html>\n<head>\n    <meta charset="utf-8">\n    <title>${gdd.projectName}</title>\n    <style>\n        body { margin: 0; }\n        canvas { display: block; }\n    </style>\n</head>\n<body>\n    <script type="module" src="./src/main.js"></script>\n</body>\n</html>`,
		};
	}

	// 生成基础代码（默认）
	private generateBasicCode(
		gdd: GDD,
		manifest: Record<string, unknown>,
		engine: string,
	): { [key: string]: string } {
		return {
			"main.js": `// ${engine} 游戏代码 (模拟)\nimport assetManifest from './config/assetManifest';\nconsole.log("游戏启动: ${gdd.projectName}");\nconsole.log("可用资源: ", assetManifest);\n\nfunction gameLoop() {\n    requestAnimationFrame(gameLoop);\n}\n\ngameLoop();`,
		};
	}

	private generatePhysicsModule(gdd: GDD) {
		return `export class PhysicsSystem {
	constructor() {
		this.gravity = ${gdd.dimension === "3d" ? "new Vector3(0, -9.81, 0)" : "new Vector2(0, -9.81)"};
		this.colliderMap = new Map();
	}

	registerCollider(id, config) {
		this.colliderMap.set(id, config);
	}

	resolve() {
		// TODO: integrate real physics engine
	}
}`;
	}

	private generateResourceBinder(manifest: Record<string, unknown>) {
		return `import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const loader = new GLTFLoader();

export async function loadGLTF(path) {
	return new Promise((resolve, reject) => {
		loader.load(
			path,
			(gltf) => resolve(gltf.scene),
			undefined,
			(error) => reject(error),
		);
	});
}

export function resolveByTag(tag) {
	return ${JSON.stringify(manifest, null, 2)}[tag] || null;
}`;
	}

	public composeAssetManifest(artResources: ResourceReference[]) {
		const manifest: Record<string, unknown> = {
			characters: [],
			environments: [],
			textures: [],
			materials: [],
			animations: [],
			ui: [],
		};

		for (const resource of artResources) {
			const metadata = resource.metadata || {};
			const entry = {
				id: resource.id,
				path: resource.remoteUrl || resource.filePath,
				type: metadata.resourceType || resource.type,
				format: metadata.format,
				usage: metadata.usage,
				description: resource.description,
			};

			switch (metadata.resourceType || resource.type) {
				case "character":
					manifest.characters.push(entry);
					break;
				case "environment":
					manifest.environments.push(entry);
					break;
				case "texture":
					manifest.textures.push(entry);
					break;
				case "material":
					manifest.materials.push(entry);
					break;
				case "animation":
					manifest.animations.push(entry);
					break;
				default:
					manifest.ui.push(entry);
					break;
			}
		}

		return manifest;
	}

	// 分析技术需求
	analyzeTechnicalRequirements(gdd: GDD): {
		engine: string;
		dependencies: string[];
	} {
		console.log("[模型调用] 分析技术需求");

		// 如果GDD中已经指定了引擎，则使用指定的引擎
		if (gdd.technicalRequirements?.engine) {
			return {
				engine: gdd.technicalRequirements.engine,
				dependencies: this.getEngineDependencies(
					gdd.technicalRequirements.engine,
				),
			};
		}

		// 根据游戏类型和维度选择合适的引擎
		let engine: string;

		if (gdd.dimension === "3d") {
			// 3D游戏优先使用Unity或Three.js
			engine =
				(gdd.primaryGenre ?? gdd.gameType) === "rpg" ||
				(gdd.primaryGenre ?? gdd.gameType) === "moba"
					? "Unity"
					: "Three.js";
		} else {
			// 2D游戏优先使用Godot或PixiJS
			engine =
				(gdd.primaryGenre ?? gdd.gameType) === "rpg" ? "Godot" : "PixiJS";
		}

		return {
			engine,
			dependencies: this.getEngineDependencies(engine),
		};
	}

	// 获取引擎依赖
	private getEngineDependencies(engine: string): string[] {
		switch (engine.toLowerCase()) {
			case "unity":
				return ["Unity Engine", "C#"];
			case "godot":
				return ["Godot Engine", "GDScript"];
			case "three.js":
				return ["three", "three/examples/jsm/controls/OrbitControls"];
			case "pixijs":
				return ["pixi.js"];
			default:
				return [];
		}
	}
}

interface TechProjectState {
	gdd?: GDD;
	artResources: ResourceReference[];
	audioResources: ResourceReference[];
	engine?: string;
	cloudProvider?: CloudProvider;
	stageConfig?: StageConfig;
}

// Tech Agent类
class TechAgent {
	private ws: WebSocket | null = null;
	private aiModel: AIModel;
	private agentId = "tech-agent";
	private serverUrl: string;
	private projects: Map<string, TechProjectState> = new Map();
	private pausedProjects: Set<string> = new Set();
	private stageConfigs: Map<string, StageConfig | undefined> = new Map();
	private uploadProgress: Map<string, number> = new Map();

	constructor() {
		this.aiModel = new AIModel();
		this.serverUrl = process.env.A2A_SERVER_URL || "ws://localhost:8080";
	}

	// 连接到A2A服务器
	async connect() {
		try {
			this.ws = new WebSocket(this.serverUrl);

			this.ws.on("open", () => {
				console.log("已连接到A2A服务器");
				this.register();
			});

			this.ws.on("message", (message: string) => {
				this.handleMessage(message);
			});

			this.ws.on("close", () => {
				console.log("与A2A服务器的连接已关闭");
				// 尝试重连
				setTimeout(() => this.connect(), 5000);
			});

			this.ws.on("error", (error) => {
				console.error("WebSocket错误:", error);
			});
		} catch (error) {
			console.error("连接失败:", error);
			setTimeout(() => this.connect(), 5000);
		}
	}

	// 注册Agent
	private register() {
		if (!this.ws) return;

		const registerMessage: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId: "",
			type: MessageType.STATUS_UPDATE,
			content: { action: "register", name: "技术Agent", version: "1.0.0" },
			timestamp: new Date().toISOString(),
			requiresAck: true,
		};

		this.ws.send(JSON.stringify(registerMessage));
	}

	// 处理接收到的消息
	private async handleMessage(message: string) {
		try {
			const data = JSON.parse(message) as AgentMessage;

			console.log(`收到消息: ${data.type} 来自: ${data.senderId}`);

			switch (data.type) {
				case MessageType.GDD_UPDATE:
					await this.processGDD(data.projectId, data.content);
					break;

				case MessageType.ASSET_UPDATE: {
					await this.processResourceUpdate(data.projectId, data.content);
					// 检查是否所有资源都已准备好，如果是则开始构建
					const project = this.projects.get(data.projectId);
					if (
						project &&
						project.artResources.length > 0 &&
						project.audioResources.length > 0
					) {
						await this.buildProject(data.projectId);
					}
					break;
				}

				case MessageType.COMPLETION:
					// 处理构建请求
					if (data.content?.action === "build") {
						await this.buildProject(data.projectId);
					}
					break;

				case MessageType.STATUS_UPDATE:
					this.handleStatusUpdate(data.content);
					break;

				case MessageType.FEEDBACK:
					await this.processFeedback(data.projectId, data.content);
					break;

				case MessageType.CONTROL:
					await this.handleControlMessage(data.projectId, data.content);
					break;

				default:
					console.log(`未知消息类型: ${data.type}`);
			}
		} catch (error) {
			console.error("处理消息失败:", error);
		}
	}

	// 处理GDD
	private async processGDD(projectId: string, payload: GDD | GDDPayload) {
		console.log(`开始处理项目 ${projectId} 的技术需求`);
		const payloadData = payload as GDDPayload;
		const gdd: GDD = payloadData.gdd || (payload as GDD);
		const projectMeta = payloadData.project;
		const cloudProvider: CloudProvider = projectMeta?.cloudProvider || "aliyun";

		// 分析技术需求
		const { engine, dependencies } =
			this.aiModel.analyzeTechnicalRequirements(gdd);

		const primaryGenre = gdd.primaryGenre ?? gdd.gameType;
		// 从知识库搜索游戏类型相关代码示例
		const codeExamples = await knowledgeBaseService.searchCodeExamples(
			primaryGenre.toUpperCase(),
		);
		console.log(
			`从知识库获取了 ${codeExamples.length} 个游戏类型 ${primaryGenre} 的代码示例`,
		);

		// 获取引擎指南
		const engineGuide = await knowledgeBaseService.getEngineGuide(engine);
		if (engineGuide) {
			console.log(`成功获取 ${engine} 引擎指南`);
		}

		// 存储项目信息
		this.projects.set(projectId, {
			gdd,
			artResources: [],
			audioResources: [],
			engine,
			cloudProvider,
		});

		// 保存重要技术决策到Mem0（高优先级）
		await mem0Service.saveMemory(
			"system",
			projectId,
			`为项目 ${projectId} 分析技术需求并选择了 ${engine} 引擎，游戏类型: ${primaryGenre}，维度: ${gdd.dimension}`,
			"technical",
			"high",
			{
				engine,
				dependencies,
				gameType: primaryGenre,
				dimension: gdd.dimension,
				analyzedAt: new Date().toISOString(),
			},
		);

		// 保存游戏类型开发经验到Mem0
		await mem0Service.saveMemory(
			"system",
			"tech_guidelines",
			`游戏类型 ${primaryGenre} 在 ${engine} 引擎下的开发指南: ${engineGuide || "暂无详细指南"}`,
			"technical",
			"medium",
		);

		console.log(`项目 ${projectId} 技术分析完成，选择引擎: ${engine}`);
	}

	// 处理资源更新
	private async processResourceUpdate(
		projectId: string,
		content: ResourceUpdatePayload,
	) {
		const project = this.projects.get(projectId) || {
			gdd: content.gdd,
			artResources: [],
			audioResources: [],
			engine: content.stageConfig?.model,
			cloudProvider: content.project?.cloudProvider || "aliyun",
		};

		if (content.project?.cloudProvider) {
			project.cloudProvider = content.project.cloudProvider;
		}

		if (content.stageConfig) {
			this.stageConfigs.set(projectId, content.stageConfig);
			project.stageConfig = content.stageConfig;
		}

		if (Array.isArray(content.resources) && content.resourceType) {
			const resourceType = content.resourceType;
			const normalized = content.resources
				.map((resource) =>
					this.normalizeResourceReference(resource, resourceType),
				)
				.filter(
					(resource): resource is ResourceReference => resource !== undefined,
				);
			if (resourceType === "art") {
				project.artResources = normalized;
				console.log(`项目 ${projectId} 收到 ${normalized.length} 个美术资源`);
			} else {
				project.audioResources = normalized;
				console.log(`项目 ${projectId} 收到 ${normalized.length} 个音频资源`);
			}
		}

		if (Array.isArray(content.artAssets)) {
			project.artResources = content.artAssets.map((filePath) => ({
				id: uuidv4(),
				filePath,
				type: "art" as const,
				remoteUrl: filePath,
			}));
		}

		if (Array.isArray(content.musicAssets)) {
			project.audioResources = content.musicAssets.map((filePath) => ({
				id: uuidv4(),
				filePath,
				type: "audio" as const,
				remoteUrl: filePath,
			}));
		}

		this.projects.set(projectId, project);
	}

	// 构建项目
	private async buildProject(projectId: string) {
		console.log(`开始构建项目: ${projectId}`);

		const project = this.projects.get(projectId);
		if (!project) {
			console.error(`找不到项目: ${projectId}`);
			return;
		}

		if (this.pausedProjects.has(projectId)) {
			this.sendCheckpoint(
				projectId,
				path.resolve(`./data/projects/${projectId}/game`),
				"构建已暂停",
			);
			return;
		}

		const manifest = this.aiModel.composeAssetManifest(project.artResources);

		// 生成游戏代码
		const codeFiles = await this.aiModel.generateGameCode(
			project.gdd,
			project.engine,
			project.artResources,
		);

		// 创建项目目录
		const projectDir = path.resolve(`./data/projects/${projectId}/game`);
		fs.emptyDirSync(projectDir);

		// 保存代码文件
		for (const [filePath, content] of Object.entries(codeFiles)) {
			const fullPath = path.join(projectDir, filePath);
			fs.ensureDirSync(path.dirname(fullPath));
			fs.writeFileSync(fullPath, content);
		}

		// 写入资产清单
		const manifestDir = path.join(projectDir, "assets");
		fs.ensureDirSync(manifestDir);
		fs.writeJSONSync(path.join(manifestDir, "manifest.json"), manifest, {
			spaces: 2,
		});

		// 复制资源文件
		await this.copyResources(projectId, project);

		if (this.pausedProjects.has(projectId)) {
			this.sendCheckpoint(projectId, projectDir, "构建被暂停");
			return;
		}

		// 创建构建结果
		const build: BuildSummary = {
			projectId,
			buildId: uuidv4(),
			engine: project.engine,
			buildTime: new Date().toISOString(),
			status: "success",
			outputPath: projectDir,
			buildType: "dev",
			resourcesCount: {
				art: project.artResources.length,
				audio: project.audioResources.length,
			},
		};

		// 保存构建信息
		fs.writeJSONSync(path.join(projectDir, "build-info.json"), build, {
			spaces: 2,
		});

		const provider = project.cloudProvider || "aliyun";
		const packagePath = await this.packageBuild(
			projectId,
			projectDir,
			build.buildId,
		);
		const uploadResult = await this.uploadBuildArtifact(
			projectId,
			build.buildId,
			packagePath,
			provider,
		);
		build.packagePath = packagePath;
		build.remoteUrl = uploadResult.url;
		build.provider = uploadResult.provider;
		build.uploadMetadata = uploadResult.metadata;

		// 保存构建信息到Mem0
		await mem0Service.saveMemory(
			"system",
			projectId,
			`项目 ${projectId} 构建完成，构建ID: ${build.buildId}，引擎: ${project.engine}，状态: ${build.status}`,
			"technical",
			"medium",
			{
				buildId: build.buildId,
				engine: project.engine,
				buildTime: build.buildTime,
				status: build.status,
				resourcesCount: build.resourcesCount,
			},
		);

		// 发送构建完成消息
		this.sendBuildComplete(projectId, build);
		this.sendArtifactUpdate(projectId, build);

		console.log(`项目 ${projectId} 构建完成，输出目录: ${projectDir}`);
	}

	private normalizeResourceReference(
		resource: Partial<ResourceReference> & { url?: string },
		defaultType: "art" | "audio",
	): ResourceReference | undefined {
		const filePath = resource.filePath || resource.url;
		if (!filePath) {
			return undefined;
		}
		return {
			id: resource.id || uuidv4(),
			filePath,
			type: resource.type || defaultType,
			description: resource.description,
			provider: resource.provider,
			metadata: resource.metadata,
			remoteUrl: resource.url,
		};
	}

	// 复制资源文件到游戏项目
	private async copyResources(projectId: string, project: TechProjectState) {
		const projectDir = path.resolve(`./data/projects/${projectId}/game`);
		const artBase = path.join(projectDir, "assets", "art");
		const audioBase = path.join(projectDir, "assets", "audio");

		for (const resource of project.artResources) {
			const fileName = this.resolveResourceBasename(resource);
			const destPath = path.join(
				artBase,
				this.resolveArtFolder(resource),
				fileName,
			);
			fs.ensureDirSync(path.dirname(destPath));
			if (fs.existsSync(resource.filePath)) {
				fs.copyFileSync(resource.filePath, destPath);
			} else if (resource.remoteUrl) {
				fs.writeFileSync(`${destPath}.url`, resource.remoteUrl);
			}
		}

		for (const resource of project.audioResources) {
			const fileName = this.resolveResourceBasename(resource);
			const destPath = path.join(audioBase, fileName);
			fs.ensureDirSync(path.dirname(destPath));
			if (fs.existsSync(resource.filePath)) {
				fs.copyFileSync(resource.filePath, destPath);
			} else if (resource.remoteUrl) {
				fs.writeFileSync(`${destPath}.url`, resource.remoteUrl);
			}
		}
	}

	private resolveArtFolder(resource: ResourceReference) {
		const type = (resource.metadata?.resourceType || resource.type).toString();
		switch (type) {
			case "character":
				return "characters";
			case "environment":
				return "environments";
			case "texture":
				return "textures";
			case "material":
				return "materials";
			case "animation":
				return "animations";
			default:
				return "misc";
		}
	}

	private resolveResourceBasename(resource: ResourceReference) {
		const raw = resource.remoteUrl || resource.filePath;
		if (!raw) return resource.id;
		try {
			const url = new URL(raw);
			return path.basename(url.pathname);
		} catch {
			return path.basename(raw);
		}
	}

	// 处理反馈
	private async processFeedback(projectId: string, feedback: FeedbackPayload) {
		console.log(`收到项目 ${projectId} 的技术反馈，开始修正`);

		const project = this.projects.get(projectId);
		if (!project) {
			console.error(`找不到项目: ${projectId}`);
			return;
		}

		// 根据反馈更新代码（简化处理）
		console.log(`根据反馈更新代码: ${feedback.description ?? "未提供描述"}`);

		// 重新构建项目
		await this.buildProject(projectId);
	}

	// 处理状态更新
	private handleStatusUpdate(content: unknown) {
		console.log("状态更新:", content);
	}

	// 发送构建完成消息
	private sendBuildComplete(projectId: string, build: BuildSummary) {
		if (!this.ws) return;

		const message: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId,
			type: MessageType.COMPLETION,
			content: build,
			timestamp: new Date().toISOString(),
			requiresAck: true,
		};

		this.ws.send(JSON.stringify(message));
	}

	// 发送状态更新
	private sendStatusUpdate(projectId: string, status: string) {
		if (!this.ws) return;

		const message: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId,
			type: MessageType.STATUS_UPDATE,
			content: { status },
			timestamp: new Date().toISOString(),
			requiresAck: false,
		};

		this.ws.send(JSON.stringify(message));
	}

	private sendCheckpoint(projectId: string, buildPath: string, notes?: string) {
		if (!this.ws) return;
		const artifacts: AgentArtifact[] = [
			{
				artifactId: uuidv4(),
				stageId: "tech",
				type: "code",
				format: "directory",
				url: buildPath,
				source: "pipeline",
				description: "当前构建输出",
			},
		];

		const message: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId,
			type: MessageType.ASSET_UPDATE,
			content: {
				stageId: "tech",
				status: "paused",
				artifacts,
				checkpoint: {
					artifacts,
					notes,
				},
			},
			timestamp: new Date().toISOString(),
			requiresAck: true,
		};
		this.ws.send(JSON.stringify(message));
	}

	private async packageBuild(
		projectId: string,
		sourceDir: string,
		buildId: string,
	): Promise<string> {
		const packageDir = path.resolve(`./data/projects/${projectId}/packages`);
		fs.ensureDirSync(packageDir);
		const zipPath = path.join(packageDir, `${buildId}.zip`);

		await new Promise<void>((resolve, reject) => {
			const output = fs.createWriteStream(zipPath);
			const archive = archiver("zip", { zlib: { level: 9 } });
			output.on("close", () => resolve());
			output.on("error", reject);
			archive.on("error", reject);
			archive.directory(sourceDir, false);
			archive.pipe(output);
			archive.finalize();
		});

		return zipPath;
	}

	private async uploadBuildArtifact(
		projectId: string,
		buildId: string,
		filePath: string,
		provider: CloudProvider,
	) {
		const key = `${projectId}/builds/${path.basename(filePath)}`;
		const stats = await fs.stat(filePath);
		const metadata = { buildId, projectId };
		if (stats.size > LARGE_FILE_THRESHOLD) {
			return storageService.uploadMultipart(provider, key, filePath, {
				chunkSize: MULTIPART_CHUNK_SIZE,
				metadata,
				onProgress: ({ uploadedBytes, totalBytes }) => {
					const fraction = totalBytes ? uploadedBytes / totalBytes : 1;
					this.emitUploadProgress(projectId, buildId, fraction);
				},
			});
		}

		return storageService.upload(provider, key, filePath, metadata);
	}

	private emitUploadProgress(
		projectId: string,
		buildId: string,
		fraction: number,
	) {
		const key = `${projectId}:${buildId}`;
		const prev = this.uploadProgress.get(key) || 0;
		if (fraction < 1 && fraction - prev < 0.1) {
			return;
		}
		this.uploadProgress.set(key, fraction);
		console.log(
			`[TechAgent] 构建上传进度 ${projectId}/${buildId}: ${(fraction * 100).toFixed(1)}%`,
		);
	}

	private sendArtifactUpdate(projectId: string, build: BuildSummary) {
		if (!this.ws) return;
		const artifacts: AgentArtifact[] = [
			{
				artifactId: build.buildId,
				stageId: "tech",
				type: "code",
				format: "archive",
				url: build.remoteUrl || build.outputPath,
				source: "pipeline",
				description: `构建 ${build.buildId}`,
				metadata: {
					...build,
					provider: build.provider,
				},
			},
		];

		const message: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId,
			type: MessageType.ASSET_UPDATE,
			content: {
				stageId: "tech",
				status: "completed",
				artifacts,
			},
			timestamp: new Date().toISOString(),
			requiresAck: true,
		};
		this.ws.send(JSON.stringify(message));
	}

	private async handleControlMessage(
		projectId: string,
		content: ControlMessagePayload,
	) {
		const action = content.action;
		switch (action) {
			case "pause":
				this.pausedProjects.add(projectId);
				this.sendCheckpoint(
					projectId,
					path.resolve(`./data/projects/${projectId}/game`),
					content.notes,
				);
				break;
			case "resume":
				this.pausedProjects.delete(projectId);
				await this.buildProject(projectId);
				break;
			case "abort":
				this.pausedProjects.delete(projectId);
				break;
		}
	}
}

// 启动Tech Agent
console.log("=== Tech Agent 启动 ===");
const agent = new TechAgent();
agent.connect();

// 优雅关闭
process.on("SIGTERM", () => {
	console.log("正在关闭Tech Agent...");
	process.exit(0);
});

process.on("SIGINT", () => {
	console.log("正在关闭Tech Agent...");
	process.exit(0);
});
