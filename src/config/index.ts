import fs from "node:fs";
import path from "node:path";

type CloudProvider = "aliyun" | "gcp";

export interface CloudConfig {
	aliyun: {
		oss: {
			endpoint: string;
			bucket: string;
			accessKeyId: string;
			accessKeySecret: string;
		};
		mysql: string;
		redis: string;
		kafka: string;
		logging: {
			slsProject: string;
			slsEndpoint: string;
		};
	};
	gcp: {
		gcs: {
			bucket: string;
			credentials: string;
		};
		mysql: string;
		redis: string;
		pubsub: string;
		logging: {
			sink: string;
		};
	};
}

let cachedConfig: CloudConfig | null = null;

export function loadCloudConfig(): CloudConfig {
	if (cachedConfig) {
		return cachedConfig;
	}

	const configPath =
		process.env.CLOUD_CONFIG_PATH ||
		path.resolve(process.cwd(), "config", "cloud.default.json");

	const raw = fs.readFileSync(configPath, "utf-8");
	cachedConfig = JSON.parse(raw) as CloudConfig;
	return cachedConfig;
}

export function getProviderConfig<T extends CloudProvider>(
	provider: T,
): CloudConfig[T] {
	const config = loadCloudConfig();
	return config[provider];
}
