import express from "express";
import multer from "multer";
import { userAssetService } from "../../services/UserAssetService";

const router = express.Router();

// 配置 multer
const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 200 * 1024 * 1024, // 200MB
	},
});

/**
 * 上传用户资产
 * POST /api/user-assets/upload
 */
router.post("/upload", upload.single("file"), async (req, res) => {
	try {
		const { projectId, assetType, description, tags, cloudProvider } =
			req.body;
		const file = req.file;

		if (!file) {
			return res.status(400).json({
				success: false,
				message: "未提供文件",
			});
		}

		if (!projectId || !assetType) {
			return res.status(400).json({
				success: false,
				message: "缺少必要参数: projectId, assetType",
			});
		}

		const metadata = await userAssetService.uploadAsset(projectId, file, {
			assetType,
			uploadedBy: "user",
			description,
			tags: tags ? JSON.parse(tags) : [],
			cloudProvider: cloudProvider || "aliyun",
			autoUploadToCloud: true,
		});

		res.json({
			success: true,
			data: metadata,
		});
	} catch (error) {
		console.error("资产上传失败", error);
		res.status(500).json({
			success: false,
			message: error instanceof Error ? error.message : "上传失败",
		});
	}
});

/**
 * 获取项目资产列表
 * GET /api/user-assets?projectId=xxx&agentId=xxx&assetType=xxx
 */
router.get("/", async (req, res) => {
	try {
		const { projectId, agentId, assetType } = req.query;

		if (!projectId) {
			return res.status(400).json({
				success: false,
				message: "缺少参数: projectId",
			});
		}

		let assets;
		if (agentId) {
			assets = userAssetService.getAssetsForAgent(
				projectId as string,
				agentId as string,
			);
		} else {
			assets = userAssetService.getProjectAssets(
				projectId as string,
				assetType as any,
			);
		}

		res.json({
			success: true,
			data: { assets },
		});
	} catch (error) {
		console.error("获取资产列表失败", error);
		res.status(500).json({
			success: false,
			message: error instanceof Error ? error.message : "获取失败",
		});
	}
});

/**
 * 删除资产
 * DELETE /api/user-assets/:assetId
 */
router.delete("/:assetId", async (req, res) => {
	try {
		const { assetId } = req.params;

		const success = await userAssetService.deleteAsset(assetId);

		if (success) {
			res.json({
				success: true,
				message: "删除成功",
			});
		} else {
			res.status(404).json({
				success: false,
				message: "资产不存在或删除失败",
			});
		}
	} catch (error) {
		console.error("删除资产失败", error);
		res.status(500).json({
			success: false,
			message: error instanceof Error ? error.message : "删除失败",
		});
	}
});

/**
 * 批量同步资产到云端
 * POST /api/user-assets/sync
 */
router.post("/sync", async (req, res) => {
	try {
		const { projectId, localDir, cloudProvider } = req.body;

		if (!projectId || !localDir) {
			return res.status(400).json({
				success: false,
				message: "缺少必要参数: projectId, localDir",
			});
		}

		const results = await userAssetService.syncLocalAssetsToCloud(
			projectId,
			localDir,
			cloudProvider || "aliyun",
		);

		res.json({
			success: true,
			data: {
				synced: results.length,
				results,
			},
		});
	} catch (error) {
		console.error("资产同步失败", error);
		res.status(500).json({
			success: false,
			message: error instanceof Error ? error.message : "同步失败",
		});
	}
});

export default router;
