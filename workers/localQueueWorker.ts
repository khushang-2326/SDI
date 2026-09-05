import { prisma } from "@/lib/prisma";
import { config, validateConfig } from "@/lib/config";
import { runParallelWorkerPool, recoverStaleTargets } from "@/services/worker-pool";

let shuttingDown = false;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorkerDaemon() {
  validateConfig();
  console.log(`[Local Worker Daemon] Starting with MAX_WORKERS=${config.worker.maxWorkers}...`);

  while (!shuttingDown) {
    try {
      const activeJob = await prisma.submissionJob.findFirst({
        where: { status: "Running" },
        orderBy: { createdAt: "asc" },
        select: { id: true, userId: true }
      });

      if (!activeJob) {
        await delay(1500);
        continue;
      }

      await recoverStaleTargets(activeJob.id, activeJob.userId);

      const pendingCount = await prisma.submissionResult.count({
        where: { jobId: activeJob.id, status: "Pending" }
      });

      if (pendingCount > 0) {
        await runParallelWorkerPool({
          jobId: activeJob.id,
          userId: activeJob.userId,
          workerCount: config.worker.maxWorkers
        });
      } else {
        await delay(1000);
      }
    } catch (err) {
      if (!shuttingDown) {
        console.error("[Local Worker Daemon] Loop error:", err);
        await delay(2000);
      }
    }
  }

  await prisma.$disconnect();
  console.log("[Local Worker Daemon] Exited cleanly.");
}

process.once("SIGINT", () => {
  console.log("[Local Worker Daemon] SIGINT received; shutting down...");
  shuttingDown = true;
});

process.once("SIGTERM", () => {
  console.log("[Local Worker Daemon] SIGTERM received; shutting down...");
  shuttingDown = true;
});

void runWorkerDaemon().catch(async (error) => {
  console.error("[Local Worker Daemon] Fatal error:", error);
  await prisma.$disconnect();
  process.exitCode = 1;
});

