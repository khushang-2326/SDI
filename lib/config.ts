function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function nonNegativeInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, maximum);
}

export const config = {
  databaseUrl: process.env.DATABASE_URL || "",
  queueProvider: process.env.QUEUE_PROVIDER === "redis" ? "redis" : "local",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  authSecret: process.env.AUTH_SECRET || "development-only-change-me",
  storage: {
    provider: process.env.STORAGE_PROVIDER || "local", // local, s3, r2, supabase
    bucketName: process.env.AWS_BUCKET_NAME || process.env.R2_BUCKET_NAME || "",
    region: process.env.AWS_REGION || "us-east-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    endpoint: process.env.AWS_ENDPOINT_URL || "", // For Custom S3 (like Cloudflare R2)
  },
  worker: {
    maxWorkers: positiveInteger(process.env.MAX_WORKERS ?? process.env.WORKER_CONCURRENCY, 4, 12),
    concurrency: positiveInteger(process.env.MAX_WORKERS ?? process.env.WORKER_CONCURRENCY, 4, 12),
    maxRetries: nonNegativeInteger(process.env.MAX_RETRIES, 3, 10),
    navigationTimeoutMs: positiveInteger(process.env.NAVIGATION_TIMEOUT_MS, 25000, 60000),
    actionTimeoutMs: positiveInteger(process.env.ACTION_TIMEOUT_MS, 12000, 30000),
    discoveryTimeoutMs: positiveInteger(process.env.DISCOVERY_TIMEOUT_MS, 45000, 120000),
    totalTargetTimeoutMs: positiveInteger(process.env.TOTAL_TARGET_TIMEOUT_MS ?? process.env.AUTOMATION_TIMEOUT, 120000, 300000),
    timeoutMs: positiveInteger(process.env.TOTAL_TARGET_TIMEOUT_MS ?? process.env.AUTOMATION_TIMEOUT, 90000, 300000),
    websiteTimeoutMs: positiveInteger(process.env.WEBSITE_TIMEOUT ?? process.env.TOTAL_TARGET_TIMEOUT_MS, 120000, 300000),
    heartbeatIntervalMs: positiveInteger(process.env.HEARTBEAT_INTERVAL_MS, 12000, 30000),
    staleHeartbeatThresholdMs: positiveInteger(process.env.STALE_HEARTBEAT_THRESHOLD_MS, 60000, 180000),
  },
  proxy: {
    enabled: process.env.PROXY_ENABLED === "true",
    protocol: (process.env.PROXY_PROTOCOL as "http" | "https" | "socks5") || "http",
    host: process.env.PROXY_HOST || "",
    port: positiveInteger(process.env.PROXY_PORT, 10000, 65535),
    username: process.env.PROXY_USERNAME || "",
    password: process.env.PROXY_PASSWORD || "",
    bandwidthSaver: process.env.PROXY_BANDWIDTH_SAVER !== "false"
  }
};

export function validateConfig() {
  if (!config.databaseUrl) {
    console.warn("WARNING: DATABASE_URL is not set.");
  }
  if (config.storage.provider !== "local") {
    if (!config.storage.bucketName) {
      throw new Error("Missing AWS_BUCKET_NAME or R2_BUCKET_NAME for cloud storage provider.");
    }
    if (!config.storage.accessKeyId || !config.storage.secretAccessKey) {
      throw new Error("Missing credentials (AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY) for cloud storage provider.");
    }
  }
}
