import { prisma } from "@/lib/prisma";
import { config, validateConfig } from "@/lib/config";
import {
  runSingleAutomationAction,
  storeTransaction,
  type AutomationResult
} from "@/app/(dashboard)/automation/actions";

type StoredPayload = {
  fields: Array<[string, string]>;
  liveSubmit: boolean;
};

let shuttingDown = false;

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function resultCompleted(result: AutomationResult) {
  return ["success", "dry_run_ready_to_book"].includes(result.status);
}

async function withAutomationTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Website automation exceeded ${Math.round(timeoutMs / 1000)} seconds.`)),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function finishParentJob(jobId: string) {
  const parent = await prisma.submissionJob.findUnique({
    where: { id: jobId },
    select: { status: true }
  });
  if (!parent || parent.status === "Cancelled") return;

  const unfinished = await prisma.submissionResult.count({
    where: { jobId, status: { in: ["Pending", "Discovering", "Running"] } }
  });
  if (unfinished > 0) return;

  const failed = await prisma.submissionResult.count({ where: { jobId, status: "Failed" } });
  await prisma.submissionJob.updateMany({
    where: { id: jobId, status: "Running" },
    data: { status: failed > 0 ? "Failed" : "Completed", completedAt: new Date() }
  });
}

async function processResult(resultId: string) {
  const claimed = await prisma.submissionResult.updateMany({
    where: { id: resultId, status: "Pending", job: { status: "Running" } },
    data: { status: "Discovering", message: "Local worker started" }
  });
  if (claimed.count === 0) return;

  const record = await prisma.submissionResult.findUnique({
    where: { id: resultId },
    include: { job: true, lead: true, targetWebsite: true }
  });
  if (!record) return;

  try {
    const payloadLog = await prisma.jobLog.findFirst({
      where: { jobId: record.jobId, message: "automation-payload" },
      orderBy: { createdAt: "desc" }
    });
    if (!payloadLog?.details) throw new Error("Automation payload is missing.");

    const payload = JSON.parse(payloadLog.details) as StoredPayload;
    const formData = new FormData();
    for (const [key, value] of payload.fields) formData.append(key, value);
    formData.set("websiteId", record.targetWebsiteId);
    formData.set("websiteUrl", "");

    await prisma.submissionResult.update({
      where: { id: resultId },
      data: { status: "Running", message: "Running local Playwright automation" }
    });

    const perWebsiteTimeoutMs = Math.max(90_000, config.worker.timeoutMs * 3);
    const state = await withAutomationTimeout(
      runSingleAutomationAction(record.job.userId, formData),
      perWebsiteTimeoutMs
    );
    if (!state.result) throw new Error("Automation returned no result.");

    const parent = await prisma.submissionJob.findUnique({
      where: { id: record.jobId },
      select: { status: true }
    });
    if (parent?.status === "Cancelled") {
      await prisma.submissionResult.update({
        where: { id: resultId },
        data: { status: "Cancelled", message: "Cancelled by user" }
      });
      return;
    }

    const result = state.result;
    const completed = resultCompleted(result);
    const saved = await prisma.submissionResult.updateMany({
      where: { id: resultId, job: { status: "Running" } },
      data: {
        status: completed ? "Completed" : "Failed",
        message: result.errorMessage || result.discoveryReason || result.status,
        screenshotPath: result.screenshotPath,
        submittedAt: new Date(result.submittedAt)
      }
    });
    if (saved.count > 0) await storeTransaction(record.job.userId, result, payload.liveSubmit);
  } catch (error) {
    const parent = await prisma.submissionJob.findUnique({
      where: { id: record.jobId },
      select: { status: true }
    });
    await prisma.submissionResult.update({
      where: { id: resultId },
      data: {
        status: parent?.status === "Cancelled" ? "Cancelled" : "Failed",
        message: error instanceof Error ? error.message : "Local automation failed"
      }
    });
  } finally {
    await finishParentJob(record.jobId);
  }
}

async function runWorker() {
  validateConfig();
  const recovered = await prisma.submissionResult.updateMany({
    where: {
      status: { in: ["Discovering", "Running"] },
      job: { status: "Running" }
    },
    data: { status: "Pending", message: "Recovered after local worker restart" }
  });
  console.log(
    `[Local Worker] Ready; polling SQLite with concurrency ${config.worker.concurrency}` +
      (recovered.count > 0 ? `; recovered ${recovered.count} interrupted item(s)` : "")
  );

  while (!shuttingDown) {
    const active = await prisma.submissionResult.findFirst({
      where: { status: { in: ["Discovering", "Running"] }, job: { status: "Running" } },
      select: { id: true }
    });
    if (active) {
      await delay(1000);
      continue;
    }

    const pending = await prisma.submissionResult.findMany({
      where: { status: "Pending", job: { status: "Running" } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 1,
      select: { id: true }
    });

    if (pending.length === 0) {
      await delay(1000);
      continue;
    }

    await processResult(pending[0].id);
  }

  await prisma.$disconnect();
}

process.once("SIGINT", () => { shuttingDown = true; });
process.once("SIGTERM", () => { shuttingDown = true; });

void runWorker().catch(async (error) => {
  console.error("[Local Worker] Fatal error:", error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
