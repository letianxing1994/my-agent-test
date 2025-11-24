import "dotenv/config";
import path from "node:path";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import { WebSocket } from "ws";

// 导入共享类型
import {
	type AgentArtifact,
	type AgentMessage,
	type GDD,
	type JsonValue,
	MessageType,
	type StageConfig,
} from "../../types";

interface ArchitecturePayload {
	gdd?: GDD | string;
	artAssets?: string | string[];
	musicAssets?: string | string[];
	stageConfig?: StageConfig;
	project?: any;
	[key: string]: unknown;
}

interface ArchitectureDocument {
	projectId: string;
	projectName: string;
	techStack: {
		engine?: string; // 游戏引擎（Unity/UE5/Godot）
		graphicsAPI?: string; // 图形API（OpenGL/Vulkan/DirectX12）
		programmingLanguages: string[];
		frameworks: string[];
		libraries: string[];
		renderingBackend?: string; // 渲染后端说明
	};
	systemArchitecture: {
		clientArchitecture: string;
		serverArchitecture?: string;
		dataFlow: string;
		networkArchitecture?: string;
		renderingPipeline?: string; // 渲染管线架构
	};
	moduleDesign: {
		coreModules: Array<{
			name: string;
			responsibility: string;
			interfaces: string[];
		}>;
		dependencies: Record<string, string[]>;
	};
	performanceOptimization: {
		rendering: string[];
		memory: string[];
		network: string[];
		graphics?: string[]; // 图形渲染优化策略
	};
	graphicsArchitecture?: {
		renderingAPI: string; // OpenGL/Vulkan/DirectX12
		shaderLanguage: string; // GLSL/HLSL/SPIR-V
		pipelineDesign: string; // 渲染管线设计
		resourceManagement: string; // GPU资源管理
		memoryAllocation: string; // 显存分配策略
	};
	resourceIntegration: {
		artAssetsPipeline: string;
		audioAssetsPipeline: string;
		assetManagement: string;
	};
	toolchain: {
		buildSystem: string;
		versionControl: string;
		ci_cd: string;
	};
	createdAt: string;
	updatedAt: string;
}

class ArchitectureAgent {
	private ws: WebSocket | null = null;
	private dataDir: string;
	private stageId = "architecture";
	private agentId = "architecture-agent";
	private serverUrl: string;
	private projectsInProgress = new Map<string, boolean>();

	constructor() {
		this.dataDir = path.join(process.cwd(), "data", "projects");
		this.serverUrl = process.env.A2A_SERVER_URL || "ws://localhost:3100";
		fs.ensureDirSync(this.dataDir);
	}

	connect() {
		this.ws = new WebSocket(this.serverUrl);

		this.ws.on("open", () => {
			console.log(`[${this.agentId}] 已连接到 A2A 服务器`);
			this.register();
		});

		this.ws.on("message", (data: string) => {
			try {
				const message: AgentMessage = JSON.parse(data);
				this.handleMessage(message);
			} catch (error) {
				console.error(`[${this.agentId}] 解析消息失败:`, error);
			}
		});

		this.ws.on("close", () => {
			console.log(`[${this.agentId}] 连接已关闭，5秒后重连...`);
			setTimeout(() => this.connect(), 5000);
		});

		this.ws.on("error", (error) => {
			console.error(`[${this.agentId}] WebSocket错误:`, error);
		});
	}

	private register() {
		if (!this.ws) return;

		const registerMessage: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId: "",
			type: MessageType.STATUS_UPDATE,
			content: { action: "register" },
			timestamp: new Date().toISOString(),
			requiresAck: false,
		};

		this.ws.send(JSON.stringify(registerMessage));
	}

	private async handleMessage(message: AgentMessage) {
		console.log(`[${this.agentId}] 收到消息类型: ${message.type}`);

		if (message.type === MessageType.STATUS_UPDATE) {
			const content = message.content as { status?: string; action?: string };
			if (content.status === "connected") {
				console.log(`[${this.agentId}] 注册成功`);
			}
			if (content.action === "start") {
				// A2A server 发送了开始任务的指令
				await this.execute(message.projectId, message.content as ArchitecturePayload);
			}
			return;
		}

		if (message.type === MessageType.GDD_UPDATE) {
			// 收到 GDD 更新，开始执行架构设计
			await this.execute(message.projectId, message.content as ArchitecturePayload);
		}
	}

	private async execute(projectId: string, payload: ArchitecturePayload) {
		if (this.projectsInProgress.get(projectId)) {
			console.log(`[${this.agentId}] 项目 ${projectId} 正在处理中`);
			return;
		}

		this.projectsInProgress.set(projectId, true);

		try {
			console.log(`[${this.agentId}] 开始处理架构设计: ${projectId}`);
			this.sendStatusUpdate(projectId, "开始生成技术架构文档");

			// 解析 GDD
			let gdd: GDD;
			if (typeof payload.gdd === "string") {
				gdd = JSON.parse(payload.gdd);
			} else if (payload.gdd) {
				gdd = payload.gdd;
			} else if (payload.project?.gdd) {
				gdd = typeof payload.project.gdd === "string" 
					? JSON.parse(payload.project.gdd)
					: payload.project.gdd;
			} else {
				throw new Error("缺少 GDD 数据");
			}

			// 解析美术和音乐资源
			const artAssets = this.parseAssets(payload.artAssets || payload.project?.assets?.art);
			const musicAssets = this.parseAssets(payload.musicAssets || payload.project?.assets?.music);

			// 生成架构文档
			const architectureDoc = await this.generateArchitectureDocument(
				gdd,
				artAssets,
				musicAssets,
				payload.stageConfig?.agentMeta
			);

			// 保存架构文档
			const projectDir = path.join(this.dataDir, projectId);
			fs.ensureDirSync(projectDir);
			const docPath = path.join(projectDir, "architecture-document.json");
			await fs.writeFile(docPath, JSON.stringify(architectureDoc, null, 2));

			// 创建 artifact
			const artifact: AgentArtifact = {
				artifactId: uuidv4(),
				stageId: this.stageId,
				type: "document",
				format: "json",
				url: docPath,
				source: "llm",
				description: "技术架构设计文档",
				metadata: { projectId } as any,
			};

			// 发送完成消息
			this.sendCompletionMessage(projectId, artifact);

			console.log(`[${this.agentId}] 架构设计完成: ${projectId}`);
		} catch (error) {
			console.error(`[${this.agentId}] 处理失败:`, error);
			this.sendErrorMessage(projectId, (error as Error).message);
		} finally {
			this.projectsInProgress.delete(projectId);
		}
	}

	private parseAssets(assets: string | string[] | undefined): string[] {
		if (!assets) return [];
		if (typeof assets === "string") {
			try {
				return JSON.parse(assets);
			} catch {
				return [assets];
			}
		}
		return assets;
	}

	private async generateArchitectureDocument(
		gdd: GDD,
		artAssets?: string[],
		musicAssets?: string[],
		agentMeta?: StageConfig["agentMeta"]
	): Promise<ArchitectureDocument> {
		console.log(`[${this.agentId}] 生成架构文档...`);

		// 记录 agentMeta 信息
		if (agentMeta?.specialization) {
			console.log(`[模型提示] 架构师专精于 ${agentMeta.specialization}`);
		}
		if (agentMeta?.extraTraits) {
			console.log(`[模型提示] 额外专长: ${agentMeta.extraTraits}`);
		}

		// 根据 GDD 生成架构文档
		const baseArchitecture = this.getDefaultArchitecture(gdd, agentMeta);

		// 构建完整的架构文档
		const document: ArchitectureDocument = {
			projectId: gdd.projectId || uuidv4(),
			projectName: gdd.projectName || "未命名游戏",
			techStack: baseArchitecture.techStack || {
				engine: "Unity",
				programmingLanguages: ["C#"],
				frameworks: [],
				libraries: [],
			},
			systemArchitecture: baseArchitecture.systemArchitecture || {
				clientArchitecture: "单机客户端架构",
				dataFlow: "MVC 模式",
			},
			moduleDesign: baseArchitecture.moduleDesign || {
				coreModules: [],
				dependencies: {},
			},
			performanceOptimization: baseArchitecture.performanceOptimization || {
				rendering: [],
				memory: [],
				network: [],
			},
			...(baseArchitecture.graphicsArchitecture && {
				graphicsArchitecture: baseArchitecture.graphicsArchitecture,
			}),
			resourceIntegration: baseArchitecture.resourceIntegration || {
				artAssetsPipeline: "Unity Asset Pipeline",
				audioAssetsPipeline: "Unity Audio System",
				assetManagement: "Addressables System",
			},
			toolchain: baseArchitecture.toolchain || {
				buildSystem: "Unity Build",
				versionControl: "Git",
				ci_cd: "GitHub Actions",
			},
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		console.log(`[${this.agentId}] 架构文档生成完成`);
		return document;
	}

	private getDefaultArchitecture(gdd: GDD, agentMeta?: StageConfig["agentMeta"]): Partial<ArchitectureDocument> {
		const is3D = gdd.dimension === "3d";
		const specialization = agentMeta?.specialization;
		
		// 判断是引擎层还是图形API层
		const isGraphicsAPI = ['opengl', 'vulkan', 'directx12'].includes(specialization || '');
		const isEngine = ['unity', 'unreal', 'godot'].includes(specialization || '');
		
		if (isGraphicsAPI) {
			// 图形API原生架构
			return this.getGraphicsAPIArchitecture(gdd, specialization!);
		} else if (isEngine) {
			// 引擎架构
			return this.getEngineArchitecture(gdd, specialization!);
		} else {
			// 默认Unity引擎
			const engine = is3D ? "Unity" : "Unity 2D";
			return {
				techStack: {
					engine,
					programmingLanguages: ["C#"],
					frameworks: ["Unity"],
					libraries: ["TextMeshPro", "DOTween"],
				},
				systemArchitecture: {
					clientArchitecture: "单机客户端架构",
					dataFlow: "MVC 模式",
				},
				moduleDesign: {
					coreModules: [
						{
							name: "GameManager",
							responsibility: "游戏流程控制",
							interfaces: ["StartGame", "PauseGame", "EndGame"],
						},
						{
							name: "InputManager",
							responsibility: "输入处理",
							interfaces: ["GetInput", "RegisterListener"],
						},
						{
							name: "ResourceManager",
							responsibility: "资源管理",
							interfaces: ["LoadAsset", "UnloadAsset"],
						},
					],
					dependencies: {
						GameManager: ["InputManager", "ResourceManager"],
						InputManager: [],
						ResourceManager: [],
					},
				},
				performanceOptimization: {
					rendering: ["对象池", "LOD系统"],
					memory: ["资源异步加载", "及时卸载未使用资源"],
					network: [],
				},
				resourceIntegration: {
					artAssetsPipeline: "Unity Asset Pipeline",
					audioAssetsPipeline: "Unity Audio System",
					assetManagement: "Resources + Addressables",
				},
				toolchain: {
					buildSystem: "Unity Build System",
					versionControl: "Git",
					ci_cd: "Unity Cloud Build",
				},
			};
		}
	}

	private getEngineArchitecture(gdd: GDD, engine: string): Partial<ArchitectureDocument> {
		const is3D = gdd.dimension === "3d";
		const gameType = gdd.gameType || gdd.primaryGenre || "rpg";

		switch (engine) {
			case "unity":
				return {
					techStack: {
						engine: is3D ? "Unity 3D" : "Unity 2D",
						programmingLanguages: ["C#"],
						frameworks: ["Unity"],
						libraries: ["TextMeshPro", "DOTween", "UniTask", "Addressables"],
					},
					systemArchitecture: {
						clientArchitecture: "Unity组件系统架构 (ECS可选)",
						dataFlow: "事件驱动 + MVC模式",
						renderingPipeline: is3D ? "URP/HDRP" : "2D Renderer",
					},
					moduleDesign: {
						coreModules: [
							{ name: "GameManager", responsibility: "游戏流程控制", interfaces: ["Initialize", "StartGame", "PauseGame", "EndGame"] },
							{ name: "InputManager", responsibility: "输入处理", interfaces: ["GetInput", "RegisterListener", "UnregisterListener"] },
							{ name: "ResourceManager", responsibility: "资源管理", interfaces: ["LoadAsset", "UnloadAsset", "LoadScene"] },
							{ name: "UIManager", responsibility: "UI管理", interfaces: ["ShowPanel", "HidePanel", "UpdateUI"] },
							{ name: "AudioManager", responsibility: "音频管理", interfaces: ["PlaySound", "PlayMusic", "StopSound"] },
						],
						dependencies: {
							GameManager: ["InputManager", "ResourceManager", "UIManager"],
							InputManager: [],
							ResourceManager: [],
							UIManager: ["ResourceManager"],
							AudioManager: ["ResourceManager"],
						},
					},
					performanceOptimization: {
						rendering: ["对象池", "LOD系统", "遮挡剔除", "批处理"],
						memory: ["Addressables异步加载", "场景分段加载", "纹理压缩"],
						network: gameType.includes("multiplayer") ? ["状态同步", "预测回滚", "插值"] : [],
					},
					resourceIntegration: {
						artAssetsPipeline: "Unity Asset Pipeline + AssetBundle",
						audioAssetsPipeline: "Unity Audio System",
						assetManagement: "Addressables System",
					},
					toolchain: {
						buildSystem: "Unity Build System",
						versionControl: "Git + Git LFS",
						ci_cd: "Unity Cloud Build / GitHub Actions",
					},
				};

			case "unreal":
				return {
					techStack: {
						engine: "Unreal Engine 5",
						programmingLanguages: ["C++", "Blueprint"],
						frameworks: ["UE5"],
						libraries: ["Chaos Physics", "Niagara", "MetaHuman"],
					},
					systemArchitecture: {
						clientArchitecture: "UObject系统 + Actor-Component架构",
						dataFlow: "事件驱动 + 委托系统",
						renderingPipeline: "Nanite + Lumen",
					},
					moduleDesign: {
						coreModules: [
							{ name: "GameMode", responsibility: "游戏规则管理", interfaces: ["InitGame", "StartPlay", "EndPlay"] },
							{ name: "PlayerController", responsibility: "玩家输入控制", interfaces: ["SetupInputComponent", "ProcessInput"] },
							{ name: "GameInstance", responsibility: "全局游戏状态", interfaces: ["Init", "LoadLevel", "SaveGame"] },
							{ name: "AssetManager", responsibility: "资源管理", interfaces: ["LoadPrimaryAsset", "UnloadPrimaryAsset"] },
							{ name: "UIManager", responsibility: "UMG界面管理", interfaces: ["CreateWidget", "RemoveWidget"] },
						],
						dependencies: {
							GameMode: ["PlayerController", "AssetManager"],
							PlayerController: ["UIManager"],
							GameInstance: ["AssetManager"],
							AssetManager: [],
							UIManager: [],
						},
					},
					performanceOptimization: {
						rendering: ["Nanite虚拟几何", "Lumen全局光照", "LOD自动生成", "HLOD"],
						memory: ["流式加载", "资源异步加载", "纹理流送"],
						network: gameType.includes("multiplayer") ? ["复制图", "RPC", "网络预测"] : [],
					},
					resourceIntegration: {
						artAssetsPipeline: "UE5 Asset Pipeline + DataAsset",
						audioAssetsPipeline: "MetaSound System",
						assetManagement: "Asset Manager + Primary Asset System",
					},
					toolchain: {
						buildSystem: "UnrealBuildTool (UBT)",
						versionControl: "Git + Perforce",
						ci_cd: "Jenkins / GitHub Actions",
					},
				};

			case "godot":
				return {
					techStack: {
						engine: "Godot 4.x",
						programmingLanguages: ["GDScript", "C#"],
						frameworks: ["Godot"],
						libraries: ["GDNative", "C++ Modules"],
					},
					systemArchitecture: {
						clientArchitecture: "节点树架构",
						dataFlow: "信号-槽机制 + 场景树",
						renderingPipeline: is3D ? "Forward+ / Mobile" : "2D Renderer",
					},
					moduleDesign: {
						coreModules: [
							{ name: "GameManager", responsibility: "游戏流程控制", interfaces: ["_ready", "_process", "start_game"] },
							{ name: "InputHandler", responsibility: "输入处理", interfaces: ["_input", "_unhandled_input"] },
							{ name: "ResourceLoader", responsibility: "资源加载", interfaces: ["load_resource", "preload_resources"] },
							{ name: "UIController", responsibility: "UI控制", interfaces: ["show_menu", "hide_menu", "update_hud"] },
							{ name: "AudioController", responsibility: "音频控制", interfaces: ["play_sound", "play_music", "stop_all"] },
						],
						dependencies: {
							GameManager: ["InputHandler", "ResourceLoader", "UIController"],
							InputHandler: [],
							ResourceLoader: [],
							UIController: ["ResourceLoader"],
							AudioController: ["ResourceLoader"],
						},
					},
					performanceOptimization: {
						rendering: ["场景实例化", "MultiMesh批处理", "遮挡剔除", "LOD"],
						memory: ["资源预加载", "场景缓存", "纹理压缩"],
						network: gameType.includes("multiplayer") ? ["高级网络节点", "RPC", "状态同步"] : [],
					},
					resourceIntegration: {
						artAssetsPipeline: "Godot Import System",
						audioAssetsPipeline: "AudioStreamPlayer System",
						assetManagement: "Resource System + Preload",
					},
					toolchain: {
						buildSystem: "Godot Export System",
						versionControl: "Git",
						ci_cd: "GitHub Actions / GitLab CI",
					},
				};

			default:
				return this.getDefaultArchitecture(gdd);
		}
	}

	private getGraphicsAPIArchitecture(gdd: GDD, graphicsAPI: string): Partial<ArchitectureDocument> {
		const is3D = gdd.dimension === "3d";
		const gameType = gdd.gameType || gdd.primaryGenre || "rpg";

		const baseArchitecture = {
			techStack: {
				graphicsAPI: "",
				programmingLanguages: ["C++"],
				frameworks: [],
				libraries: [] as string[],
				renderingBackend: "原生图形API",
			},
			systemArchitecture: {
				clientArchitecture: "自定义引擎架构",
				dataFlow: "ECS (Entity-Component-System) 推荐",
				renderingPipeline: "",
			},
			moduleDesign: {
				coreModules: [
					{ name: "Application", responsibility: "应用程序生命周期管理", interfaces: ["Initialize", "Run", "Shutdown"] },
					{ name: "Window", responsibility: "窗口管理", interfaces: ["Create", "Update", "HandleEvents"] },
					{ name: "Renderer", responsibility: "渲染系统", interfaces: ["Initialize", "BeginFrame", "EndFrame", "Submit"] },
					{ name: "ResourceManager", responsibility: "GPU资源管理", interfaces: ["CreateBuffer", "CreateTexture", "CreateShader", "Destroy"] },
					{ name: "Scene", responsibility: "场景管理", interfaces: ["LoadScene", "Update", "Render"] },
					{ name: "InputSystem", responsibility: "输入处理", interfaces: ["PollEvents", "GetKeyState", "GetMousePosition"] },
					{ name: "AudioSystem", responsibility: "音频系统", interfaces: ["LoadSound", "PlaySound", "Update"] },
				],
				dependencies: {
					Application: ["Window", "Renderer", "Scene", "InputSystem", "AudioSystem"],
					Window: ["InputSystem"],
					Renderer: ["ResourceManager"],
					ResourceManager: [],
					Scene: ["Renderer", "ResourceManager"],
					InputSystem: [],
					AudioSystem: [],
				},
			},
			performanceOptimization: {
				rendering: ["frustum culling", "批量渲染", "实例化渲染"],
				memory: ["内存池", "GPU内存管理", "资源流送"],
				network: gameType.includes("multiplayer") ? ["状态同步", "预测回滚"] : [],
				graphics: [] as string[],
			},
			graphicsArchitecture: {
				renderingAPI: "",
				shaderLanguage: "",
				pipelineDesign: "",
				resourceManagement: "",
				memoryAllocation: "",
			},
			resourceIntegration: {
				artAssetsPipeline: "自定义资源加载器 + 格式转换",
				audioAssetsPipeline: "OpenAL / FMOD / 自定义音频引擎",
				assetManagement: "自定义资源管理系统",
			},
			toolchain: {
				buildSystem: "CMake / Premake",
				versionControl: "Git",
				ci_cd: "GitHub Actions / Jenkins",
			},
		};

		switch (graphicsAPI) {
			case "opengl":
				return {
					...baseArchitecture,
					techStack: {
						...baseArchitecture.techStack,
						graphicsAPI: "OpenGL 4.6 Core",
						libraries: ["GLFW", "GLAD/GLEW", "GLM", "stb_image", "Assimp", "Dear ImGui"],
					},
					systemArchitecture: {
						...baseArchitecture.systemArchitecture,
						renderingPipeline: is3D 
							? "Forward Rendering / Deferred Rendering"
							: "2D Sprite Batch Rendering",
					},
					performanceOptimization: {
						...baseArchitecture.performanceOptimization,
						graphics: [
							"VAO/VBO优化",
							"纹理图集",
							"Uniform Buffer Object",
							"实例化渲染 (glDrawArraysInstanced)",
							"多线程渲染 (Context Sharing)",
						],
					},
					graphicsArchitecture: {
						renderingAPI: "OpenGL 4.6 Core Profile",
						shaderLanguage: "GLSL 4.60",
						pipelineDesign: is3D
							? "前向渲染管线：顶点着色器 -> 几何着色器(可选) -> 片段着色器\n或延迟渲染：G-Buffer Pass -> Lighting Pass -> Post-Processing"
							: "2D渲染管线：Sprite Batching -> 合批渲染 -> Alpha混合",
						resourceManagement: "纹理单元管理 (16+单元)、缓冲区对象池、着色器程序缓存",
						memoryAllocation: "glBufferStorage (持久化映射)、双缓冲/三缓冲、显存池管理",
					},
				};

			case "vulkan":
				return {
					...baseArchitecture,
					techStack: {
						...baseArchitecture.techStack,
						graphicsAPI: "Vulkan 1.3",
						libraries: ["GLFW", "GLM", "VulkanMemoryAllocator (VMA)", "SPIRV-Cross", "shaderc", "Dear ImGui"],
					},
					systemArchitecture: {
						...baseArchitecture.systemArchitecture,
						renderingPipeline: is3D
							? "Deferred Rendering / Forward+ / Clustered Rendering"
							: "2D Sprite Batch with Vulkan",
					},
					performanceOptimization: {
						...baseArchitecture.performanceOptimization,
						graphics: [
							"Command Buffer复用",
							"Descriptor Set优化",
							"Push Constants高频更新",
							"多线程命令录制",
							"异步计算管线",
							"Bindless纹理",
						],
					},
					graphicsArchitecture: {
						renderingAPI: "Vulkan 1.3",
						shaderLanguage: "GLSL -> SPIR-V 或 HLSL -> SPIR-V",
						pipelineDesign: 
							"显式管线管理：\n" +
							"1. 图形管线：VkGraphicsPipeline (顶点输入 -> 着色器阶段 -> 光栅化 -> 混合)\n" +
							"2. 计算管线：VkComputePipeline (通用计算)\n" +
							"3. 渲染通道：VkRenderPass (Subpass依赖)\n" +
							"4. 帧缓冲：VkFramebuffer (Attachment管理)",
						resourceManagement: 
							"显式资源管理：\n" +
							"- VkBuffer / VkImage：GPU资源\n" +
							"- VkDeviceMemory：显存分配\n" +
							"- VkDescriptorSet：资源绑定\n" +
							"- VkSampler：采样器对象\n" +
							"- VMA内存分配器统一管理",
						memoryAllocation:
							"多层内存管理：\n" +
							"- 设备本地内存 (DEVICE_LOCAL)：GPU专用\n" +
							"- 主机可见内存 (HOST_VISIBLE)：CPU-GPU传输\n" +
							"- 分配策略：大块分配 + 子分配\n" +
							"- Staging Buffer：CPU -> GPU数据传输\n" +
							"- VMA自动内存碎片整理",
					},
				};

			case "directx12":
				return {
					...baseArchitecture,
					techStack: {
						...baseArchitecture.techStack,
						graphicsAPI: "DirectX 12",
						libraries: ["DirectXTK12", "DirectXMath", "DirectXTex", "D3D12MemoryAllocator", "Dear ImGui"],
					},
					systemArchitecture: {
						...baseArchitecture.systemArchitecture,
						renderingPipeline: is3D
							? "Deferred Rendering / Forward+ with DXR"
							: "2D Rendering with DirectX 12",
					},
					performanceOptimization: {
						...baseArchitecture.performanceOptimization,
						graphics: [
							"Command List Bundle复用",
							"Root Signature优化",
							"Descriptor Heap管理",
							"多线程命令录制",
							"ExecuteIndirect间接渲染",
							"光线追踪加速 (DXR)",
						],
					},
					graphicsArchitecture: {
						renderingAPI: "DirectX 12",
						shaderLanguage: "HLSL 6.x (Shader Model 6.x)",
						pipelineDesign:
							"PSO (Pipeline State Object) 管理：\n" +
							"1. 图形管线：D3D12_GRAPHICS_PIPELINE_STATE_DESC\n" +
							"2. 计算管线：D3D12_COMPUTE_PIPELINE_STATE_DESC\n" +
							"3. 光追管线：D3D12_STATE_OBJECT (DXR)\n" +
							"4. Root Signature：资源绑定布局\n" +
							"5. Render Target：多RT支持",
						resourceManagement:
							"显式资源管理：\n" +
							"- ID3D12Resource：统一资源接口\n" +
							"- ID3D12Heap：显存堆管理\n" +
							"- Descriptor Heap：视图描述符\n" +
							"  * CBV/SRV/UAV Heap (着色器可见)\n" +
							"  * RTV Heap (渲染目标)\n" +
							"  * DSV Heap (深度模板)\n" +
							"  * Sampler Heap (采样器)\n" +
							"- D3D12MA统一内存分配",
						memoryAllocation:
							"分层内存管理：\n" +
							"- Default Heap：GPU独占，高性能\n" +
							"- Upload Heap：CPU写入，GPU读取\n" +
							"- Readback Heap：GPU写入，CPU读取\n" +
							"- Custom Heap：自定义内存类型\n" +
							"- Committed Resource vs Placed Resource\n" +
							"- D3D12MA自动碎片管理",
					},
				};

			default:
				return baseArchitecture;
		}
	}

	private sendStatusUpdate(projectId: string, status: string) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

		const message: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId,
			type: MessageType.STATUS_UPDATE,
			content: { status, stageId: this.stageId },
			timestamp: new Date().toISOString(),
			requiresAck: false,
		};

		this.ws.send(JSON.stringify(message));
	}

	private sendCompletionMessage(projectId: string, artifact: AgentArtifact) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

		const message: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId,
			type: MessageType.COMPLETION,
			content: {
				stageId: this.stageId,
				status: "completed",
				artifact: artifact as unknown as JsonValue,
			},
			timestamp: new Date().toISOString(),
			requiresAck: true,
		};

		this.ws.send(JSON.stringify(message));
	}

	private sendErrorMessage(projectId: string, error: string) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

		const message: AgentMessage = {
			messageId: uuidv4(),
			senderId: this.agentId,
			receiverId: "a2a-server",
			projectId,
			type: MessageType.STATUS_UPDATE,
			content: {
				stageId: this.stageId,
				status: "error",
				error,
			},
			timestamp: new Date().toISOString(),
			requiresAck: false,
		};

		this.ws.send(JSON.stringify(message));
	}
}

// 启动 agent
const agent = new ArchitectureAgent();
agent.connect();

// 优雅关闭
process.on("SIGINT", () => {
	console.log("\n正在关闭 Architecture Agent...");
	process.exit(0);
});

process.on("SIGTERM", () => {
	console.log("\n正在关闭 Architecture Agent...");
	process.exit(0);
});
