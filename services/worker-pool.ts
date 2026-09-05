import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { acquireContext, releaseContext } from "@/lib/browserPool";
import { runMultiTargetAutomation } from "@/services/multi-target-automation";
import {
  isProxyAuthenticationFailure,
  PROXY_407_MESSAGE,
  redactProxyDetails
} from "@/services/proxy-helper";
import type { AutomationResult } from "@/app/(dashboard)/automation/actions";

export type StoredPayload = {
  fields: Array<[string, string]>;
  liveSubmit: boolean;
};

export type WorkerPoolOptions = {
  jobId: string;
  userId: string;
  workerCount?: number;
  onProgress?: (jobId: string) => void | Promise<void>;
};

export type WorkerStatusInfo = {
  workerId: string;
  status: "idle" | "running" | "completed";
  currentTargetId: string | null;
  currentTargetUrl: string | null;
  currentStep: string | null;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
};

// Global active worker state registry for live UI inspection
const activeWorkerRegistry = new Map<string, Map<string, WorkerStatusInfo>>();

export function getActiveWorkers(jobId: string): WorkerStatusInfo[] {
  const jobWorkers = activeWorkerRegistry.get(jobId);
  return jobWorkers ? Array.from(jobWorkers.values()) : [];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resultCompleted(result: AutomationResult): boolean {
  return ["success", "dry_run_ready_to_book"].includes(result.status);
}

async function withTargetTimeout<T>(operation: Promise<T>, timeoutMs: number, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${description} exceeded timeout limit of ${Math.round(timeoutMs / 1000)} seconds.`)),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Atomically claim the next pending target for a given worker.
 * Returns the target ID if successfully claimed, or null if another worker claimed it or none available.
 */
async function atomicClaimTarget(jobId: string, workerId: string, userId: string): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.submissionResult.findFirst({
      where: {
        jobId,
        status: "Pending",
        job: { userId, status: "Running" }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, targetWebsite: { select: { websiteUrl: true } } }
    });

    if (!candidate) return null;

    const updated = await tx.submissionResult.updateMany({
      where: {
        id: candidate.id,
        status: "Pending"
      },
      data: {
        status: "Running",
        workerId,
        claimedAt: new Date(),
        heartbeatAt: new Date(),
        message: `[${workerId}] Target claimed; preparing browser context`
      }
    });

    return updated.count === 1 ? candidate.id : null;
  });
}

/**
 * Periodically updates the heartbeat timestamp for an actively running target.
 */
function startHeartbeat(resultId: string, workerId: string, intervalMs: number): () => void {
  const timer = setInterval(async () => {
    try {
      await prisma.submissionResult.updateMany({
        where: { id: resultId, status: { in: ["Running", "Discovering"] }, workerId },
        data: { heartbeatAt: new Date() }
      });
    } catch {
      // Ignore transient database busy errors during heartbeat
    }
  }, intervalMs);

  return () => clearInterval(timer);
}

/**
 * Recovers stale targets whose heartbeat has expired without an active worker response.
 */
export async function recoverStaleTargets(jobId: string, userId: string): Promise<number> {
  const thresholdMs = config.worker.staleHeartbeatThresholdMs;
  const staleBefore = new Date(Date.now() - thresholdMs);

  const staleItems = await prisma.submissionResult.findMany({
    where: {
      jobId,
      status: { in: ["Running", "Discovering"] },
      heartbeatAt: { lt: staleBefore },
      job: { userId, status: "Running" }
    },
    select: { id: true, workerId: true }
  });

  if (staleItems.length === 0) return 0;

  const recovered = await prisma.submissionResult.updateMany({
    where: {
      id: { in: staleItems.map((item) => item.id) },
      status: { in: ["Running", "Discovering"] }
    },
    data: {
      status: "Pending",
      workerId: null,
      message: "Recovered stale target after worker timeout"
    }
  });

  if (recovered.count > 0) {
    console.log(`[WorkerPool] Recovered ${recovered.count} stale target(s) for job ${jobId}.`);
  }

  return recovered.count;
}

/**
 * Completes the parent SubmissionJob when all child targets reach a terminal state.
 */
async function finishParentJobIfComplete(jobId: string): Promise<void> {
  const parent = await prisma.submissionJob.findUnique({
    where: { id: jobId },
    select: { status: true }
  });

  if (!parent || parent.status === "Cancelled") return;

  const unfinished = await prisma.submissionResult.count({
    where: { jobId, status: { in: ["Pending", "Discovering", "Running"] } }
  });

  if (unfinished > 0) return;

  const results = await prisma.submissionResult.findMany({
    where: { jobId },
    select: { status: true }
  });

  const successCount = results.filter((r) => r.status === "Completed").length;
  const finalStatus = successCount > 0 ? "Completed" : "Failed";

  await prisma.submissionJob.updateMany({
    where: { id: jobId, status: "Running" },
    data: { status: finalStatus, completedAt: new Date() }
  });
}

/**
 * Executes the complete multi-target automation flow for a single claimed target.
 */
async function processSingleTarget(
  jobId: string,
  resultId: string,
  workerId: string,
  userId: string,
  payload: StoredPayload
): Promise<void> {
  const stopHeartbeat = startHeartbeat(resultId, workerId, config.worker.heartbeatIntervalMs);

  const updateWorkerStatus = (step: string, url?: string) => {
    const jobWorkers = activeWorkerRegistry.get(jobId);
    if (jobWorkers) {
      jobWorkers.set(workerId, {
        workerId,
        status: "running",
        currentTargetId: resultId,
        currentTargetUrl: url ?? jobWorkers.get(workerId)?.currentTargetUrl ?? null,
        currentStep: step,
        startedAt: jobWorkers.get(workerId)?.startedAt ?? new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString()
      });
    }
  };

  try {
    const record = await prisma.submissionResult.findUnique({
      where: { id: resultId },
      include: {
        job: true,
        targetWebsite: {
          include: { discoveredTargets: { orderBy: [{ executionOrder: "asc" }, { confidence: "desc" }] } }
        }
      }
    });

    if (!record || !record.targetWebsite) {
      throw new Error(`Target record not found for result ID: ${resultId}`);
    }

    const website = record.targetWebsite;
    const payloadFields = new Map(payload.fields);
    const showBrowser = payloadFields.get("showBrowser") === "on";

    updateWorkerStatus("Navigating & discovering target", website.websiteUrl);
    console.log(`[${workerId}] Processing target: ${website.websiteUrl} (Result: ${resultId})`);

    // Check parent cancellation
    const parentJob = await prisma.submissionJob.findUnique({
      where: { id: jobId },
      select: { status: true }
    });
    if (parentJob?.status === "Cancelled") {
      await prisma.submissionResult.update({
        where: { id: resultId },
        data: { status: "Cancelled", message: "Cancelled by user" }
      });
      return;
    }

    const context = await acquireContext({
      headless: !showBrowser,
      userId,
      startupTimeoutMs: Math.min(20_000, config.worker.totalTargetTimeoutMs)
    });

    try {
      const targetIds = new Map<string, string>();
      const attemptIds = new Map<string, string>();
      const key = (target: { targetType: string; url: string }) => `${target.targetType}:${target.url}`;

      const multiTargetRun = runMultiTargetAutomation({
        websiteUrl: website.websiteUrl,
        leadData: {
          fullName: payloadFields.get("fullName") || "",
          email: payloadFields.get("email") || "",
          mobile: payloadFields.get("mobile") || payloadFields.get("mobileNumber") || "",
          address: payloadFields.get("address") || "",
          message: payloadFields.get("message") || "",
          companyName: payloadFields.get("companyName") || ""
        },
        bookingPreferences: {
          preferredDate: payloadFields.get("preferredDate"),
          preferredTime: payloadFields.get("preferredTime"),
          timezone: payloadFields.get("timezone"),
          fallbackToFirstAvailableSlot: true
        },
        liveSubmit: payload.liveSubmit,
        browserContext: context,
        timeoutMs: config.worker.timeoutMs,
        deadlineAt: Date.now() + config.worker.totalTargetTimeoutMs,
        userId,
        headless: !showBrowser,
        cachedTargets: website.discoveredTargets.map((target) => ({
          targetType: target.targetType as "calendly" | "hubspot_booking" | "contact_form" | "booking_widget",
          url: target.url,
          executionOrder: target.targetType === "contact_form"
            ? 1
            : target.targetType === "calendly"
              ? 2
              : target.targetType === "hubspot_booking"
                ? 3
                : 4,
          confidence: target.confidence,
          reason: "Previously discovered target",
          screenshotPath: null
        })),
        callbacks: {
          onTargetsDiscovered: async (targets, reason) => {
            updateWorkerStatus("Form target discovered", targets[0]?.url);
            await prisma.submissionResult.updateMany({
              where: { id: resultId, status: "Running", job: { userId, status: "Running" } },
              data: {
                message: `[${workerId}] ${redactProxyDetails(reason)}`,
                targetType: targets[0]?.targetType ?? null,
                resolvedUrl: targets[0]?.url ?? null
              }
            });
            for (const target of targets) {
              const saved = await prisma.discoveredSubmissionTarget.upsert({
                where: {
                  targetWebsiteId_targetType_url: {
                    targetWebsiteId: website.id,
                    targetType: target.targetType,
                    url: target.url
                  }
                },
                create: {
                  targetWebsiteId: website.id,
                  targetType: target.targetType,
                  url: target.url,
                  executionOrder: target.executionOrder,
                  confidence: target.confidence,
                  metadata: JSON.stringify({ reason: target.reason, ...target.metadata })
                },
                update: {
                  executionOrder: target.executionOrder,
                  confidence: target.confidence,
                  metadata: JSON.stringify({ reason: target.reason, ...target.metadata })
                }
              });
              targetIds.set(key(target), saved.id);
            }
          },
          onAttemptStarted: async (target) => {
            updateWorkerStatus(`Filling ${target.targetType}`, target.url);
            const attempt = await prisma.submissionAttempt.create({
              data: {
                submissionResultId: resultId,
                discoveredTargetId: targetIds.get(key(target)),
                targetType: target.targetType,
                targetUrl: target.url,
                executionOrder: target.executionOrder,
                status: "Running",
                startedAt: new Date(),
                metadata: JSON.stringify({ reason: target.reason, workerId })
              }
            });
            attemptIds.set(key(target), attempt.id);
            await prisma.submissionAttemptLog.create({
              data: { attemptId: attempt.id, message: redactProxyDetails(`[${workerId}] Started ${target.targetType} automation`) }
            });
          },
          onAttemptFinished: async (attempt) => {
            updateWorkerStatus(`Submitting & verifying ${attempt.target.targetType}`, attempt.target.url);
            const attemptId = attemptIds.get(key(attempt.target));
            if (!attemptId) return;
            const successful = ["success", "dry_run_ready_to_book"].includes(attempt.result.status);
            await prisma.submissionAttempt.update({
              where: { id: attemptId },
              data: {
                status: successful ? "Completed" : "Failed",
                message: attempt.result.status,
                errorMessage: redactProxyDetails(attempt.result.errorMessage),
                screenshotPath: attempt.result.screenshotPath,
                screenshotPaths: JSON.stringify(attempt.result.screenshotPaths ?? []),
                submittedAt: attempt.result.submittedAt,
                completedAt: attempt.completedAt
              }
            });
            await prisma.submissionAttemptLog.create({
              data: {
                attemptId,
                level: successful ? "info" : "error",
                message: `[${workerId}] Finished ${attempt.target.targetType} with status ${attempt.result.status}`,
                details: redactProxyDetails(attempt.result.errorMessage)
              }
            });
            await prisma.automationTransaction.create({
              data: {
                userId,
                websiteUrl: website.websiteUrl,
                resolvedUrl: attempt.target.url,
                targetType: attempt.target.targetType,
                status: attempt.result.status,
                errorMessage: redactProxyDetails(attempt.result.errorMessage),
                screenshotPath: attempt.result.screenshotPath,
                liveSubmit: payload.liveSubmit
              }
            });
          }
        }
      });

      const run = await withTargetTimeout(
        multiTargetRun,
        config.worker.totalTargetTimeoutMs,
        `Target ${website.websiteUrl}`
      );

      if (run.targets.length === 0) {
        throw new Error(run.discoveryReason || "No valid submission target discovered");
      }

      const successes = run.attempts.filter((a) =>
        ["success", "dry_run_ready_to_book"].includes(a.result.status)
      );
      const anySuccessful = successes.length > 0;
      const lastScreenshot = run.attempts.map((a) => a.result.screenshotPath).filter(Boolean).at(-1) ?? null;
      const lastAttempt = run.attempts.at(-1);

      // Determine explicit status classification
      let finalStatus = anySuccessful ? "Completed" : "Failed";
      if (!anySuccessful && lastAttempt) {
        const err = (lastAttempt.result.errorMessage || "").toLowerCase();
        if (err.includes("403") || err.includes("forbidden")) {
          finalStatus = "Http_403";
        } else if (err.includes("captcha") || err.includes("cloudflare") || err.includes("turnstile")) {
          finalStatus = "Captcha_Required";
        }
      }

      await prisma.submissionResult.updateMany({
        where: { id: resultId, job: { userId, status: "Running" } },
        data: {
          status: finalStatus,
          message: redactProxyDetails(
            run.discoveryReason.includes("Proxy fallback")
              ? `[${workerId}] ${run.discoveryReason}`
              : `[${workerId}] ${successes.length}/${run.attempts.length} targets completed successfully`
          ),
          screenshotPath: lastScreenshot,
          targetType: run.targets[0]?.targetType ?? null,
          resolvedUrl: run.targets[0]?.url ?? null,
          submittedAt: new Date()
        }
      });

      await prisma.targetWebsite.update({
        where: { id: website.id },
        data: {
          contactPageUrl: run.targets[0]?.url ?? website.contactPageUrl,
          notes: [website.notes, redactProxyDetails(run.discoveryReason)].filter(Boolean).join("\n")
        }
      });

      console.log(`[${workerId}] Finished target ${website.websiteUrl} with status: ${finalStatus}`);
    } finally {
      await releaseContext(context);
    }
  } catch (error) {
    const isProxy = isProxyAuthenticationFailure(error);
    const rawError = isProxy
      ? PROXY_407_MESSAGE
      : error instanceof Error
        ? error.message
        : "Target automation failed";

    let failureStatus = "Failed";
    const errText = rawError.toLowerCase();
    if (errText.includes("exceeded timeout") || errText.includes("timed out")) {
      failureStatus = "Timeout";
    } else if (errText.includes("403") || errText.includes("forbidden")) {
      failureStatus = "Http_403";
    } else if (errText.includes("captcha") || errText.includes("challenge") || errText.includes("turnstile")) {
      failureStatus = "Captcha_Required";
    }

    console.warn(`[${workerId}] Error on target ${resultId}: ${rawError} (Status: ${failureStatus})`);

    await prisma.submissionResult.updateMany({
      where: { id: resultId },
      data: {
        status: failureStatus,
        message: `[${workerId}] ${redactProxyDetails(rawError)}`,
        submittedAt: new Date()
      }
    });
  } finally {
    stopHeartbeat();
    const jobWorkers = activeWorkerRegistry.get(jobId);
    if (jobWorkers) {
      jobWorkers.set(workerId, {
        workerId,
        status: "idle",
        currentTargetId: null,
        currentTargetUrl: null,
        currentStep: "Idle; waiting for next target",
        startedAt: null,
        lastHeartbeatAt: new Date().toISOString()
      });
    }
    await finishParentJobIfComplete(jobId);
  }
}

/**
 * Worker thread loop: continuously claims and processes pending targets until no pending targets remain.
 */
async function runWorkerLoop(
  jobId: string,
  workerId: string,
  userId: string,
  payload: StoredPayload,
  onProgress?: (jobId: string) => void | Promise<void>
): Promise<void> {
  console.log(`[${workerId}] Worker spawned and ready.`);

  while (true) {
    // Check if parent job was cancelled
    const parent = await prisma.submissionJob.findUnique({
      where: { id: jobId },
      select: { status: true }
    });

    if (!parent || parent.status !== "Running") {
      console.log(`[${workerId}] Parent job status is ${parent?.status ?? "missing"}; exiting worker loop.`);
      break;
    }

    // Atomic claim attempt
    const resultId = await atomicClaimTarget(jobId, workerId, userId);

    if (!resultId) {
      // MANDATORY CORRECTION 2: Check whether PENDING targets still exist before exiting
      const pendingCount = await prisma.submissionResult.count({
        where: { jobId, status: "Pending", job: { status: "Running" } }
      });

      if (pendingCount > 0) {
        // Race condition: another worker took the candidate; back off briefly and retry
        await delay(150 + Math.random() * 200);
        continue;
      }

      // No pending targets left
      console.log(`[${workerId}] Zero pending targets remaining in queue; worker finished.`);
      break;
    }

    // Process the claimed target
    await processSingleTarget(jobId, resultId, workerId, userId, payload);

    if (onProgress) {
      try {
        await onProgress(jobId);
      } catch {
        // Ignore progress callback errors
      }
    }
  }

  const jobWorkers = activeWorkerRegistry.get(jobId);
  if (jobWorkers) {
    jobWorkers.set(workerId, {
      workerId,
      status: "completed",
      currentTargetId: null,
      currentTargetUrl: null,
      currentStep: "Worker finished",
      startedAt: null,
      lastHeartbeatAt: new Date().toISOString()
    });
  }
}

/**
 * Main entry point: runs a parallel worker pool of N concurrent workers.
 */
export async function runParallelWorkerPool(options: WorkerPoolOptions): Promise<{
  jobId: string;
  workerCount: number;
  totalTargets: number;
}> {
  const { jobId, userId, onProgress } = options;
  const workerCount = Math.max(1, Math.min(12, options.workerCount ?? config.worker.maxWorkers));

  // Initialize registry for this job
  const jobWorkers = new Map<string, WorkerStatusInfo>();
  activeWorkerRegistry.set(jobId, jobWorkers);

  for (let i = 1; i <= workerCount; i++) {
    const workerId = `worker-${String(i).padStart(2, "0")}`;
    jobWorkers.set(workerId, {
      workerId,
      status: "idle",
      currentTargetId: null,
      currentTargetUrl: null,
      currentStep: "Initializing",
      startedAt: null,
      lastHeartbeatAt: new Date().toISOString()
    });
  }

  // Retrieve stored automation payload
  const payloadLog = await prisma.jobLog.findFirst({
    where: { jobId, message: "automation-payload" },
    orderBy: { createdAt: "desc" }
  });

  if (!payloadLog?.details) {
    throw new Error(`Automation payload log missing for job ${jobId}`);
  }

  const payload = JSON.parse(payloadLog.details) as StoredPayload;

  const totalTargets = await prisma.submissionResult.count({
    where: { jobId }
  });

  console.log(`[WorkerPool] Launching ${workerCount} concurrent workers for Job ${jobId} (${totalTargets} targets)...`);

  // Recover any stale targets from a previous interrupted run
  await recoverStaleTargets(jobId, userId);

  // Spawn concurrent worker loops
  const workerPromises = Array.from({ length: workerCount }, (_, idx) => {
    const workerId = `worker-${String(idx + 1).padStart(2, "0")}`;
    return runWorkerLoop(jobId, workerId, userId, payload, onProgress);
  });

  // Background watchdog timer for recovering stale items during execution
  const watchdog = setInterval(() => {
    void recoverStaleTargets(jobId, userId);
  }, 20_000);

  // Execute all workers concurrently
  try {
    await Promise.all(workerPromises);
  } finally {
    clearInterval(watchdog);
    await finishParentJobIfComplete(jobId);
    activeWorkerRegistry.delete(jobId);
    console.log(`[WorkerPool] Batch completed for Job ${jobId}.`);
  }

  return { jobId, workerCount, totalTargets };
}
