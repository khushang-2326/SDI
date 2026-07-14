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
    concurrency: positiveInteger(process.env.WORKER_CONCURRENCY, 1, 8),
    maxRetries: nonNegativeInteger(process.env.MAX_RETRIES, 3, 10),
    timeoutMs: positiveInteger(process.env.AUTOMATION_TIMEOUT, 45000, 180000),
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
