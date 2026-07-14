import { Queue, type ConnectionOptions } from "bullmq";
import { config } from "@/lib/config";

export function getRedisConnection(): ConnectionOptions {
  return {
    url: config.redisUrl,
    connectTimeout: 5000,
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(attempt * 1000, 5000)
  };
}

let automationQueue: Queue | null = null;

export function getAutomationQueue() {
  if (!automationQueue) {
    automationQueue = new Queue("automation-queue", {
      connection: getRedisConnection()
    });
  }
  return automationQueue;
}
