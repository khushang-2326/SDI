import path from "node:path";
import type { BrowserContext } from "playwright";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { acquireContext, releaseContext } from "@/lib/browserPool";
import { runMultiTargetAutomation } from "@/services/multi-target-automation";
import {
  isProxyAuthenticationFailure,
  PROXY_407_MESSAGE,
  redactProxyDetails
} from "@/services/proxy-helper";
import { classifyErrorTaxonomy } from "@/services/error-taxonomy";
import { splitFullName } from "@/services/field-classifier";
import type { AutomationResult } from "@/app/(dashboard)/automation/actions";
import type { SubmitContactFormResult } from "@/types/automation";

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

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

export function clearActiveWorkers(jobId?: string): void {
  if (jobId) {
    activeWorkerRegistry.delete(jobId);
  } else {
    activeWorkerRegistry.clear();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resultCompleted(result: AutomationResult | SubmitContactFormResult): boolean {
  if (result.status === "success") {
    return (result as any).submissionOutcome === "VERIFIED_SUCCESS" || (result as any).submissionOutcome === undefined;
  }
  return result.status === "dry_run_ready_to_book";
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
      job: { userId, status: { in: ["Running", "Paused"] } }
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
    where: { id: jobId, status: { in: ["Running", "Paused"] } },
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

  let finalScreenshot: string | null = null;
  let context: BrowserContext | null = null;
  let targetUrlForScreenshot = "";

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
    targetUrlForScreenshot = website.websiteUrl;
    const payloadFields = new Map(payload.fields);
    const showBrowser = payloadFields.get("showBrowser") === "on";

    updateWorkerStatus("Step 1/5: Loading website...", website.websiteUrl);
    await prisma.submissionResult.updateMany({
      where: { id: resultId, job: { userId, status: "Running" } },
      data: {
        message: `[${workerId}] [website_load] Loading website...`
      }
    }).catch(() => undefined);
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

    context = await acquireContext({
      headless: !showBrowser,
      userId,
      startupTimeoutMs: Math.min(20_000, config.worker.totalTargetTimeoutMs)
    });
      const targetIds = new Map<string, string>();
      const attemptIds = new Map<string, string>();
      const key = (target: { targetType: string; url: string }) => `${target.targetType}:${target.url}`;

      const rawFullName = (payloadFields.get("fullName") || payloadFields.get("name") || "").trim();
      const nameParts = splitFullName(rawFullName);
      const firstName = (payloadFields.get("firstName") || nameParts.firstName || "").trim();
      const lastName = (payloadFields.get("lastName") || nameParts.lastName || "").trim();

      const multiTargetRun = runMultiTargetAutomation({
        websiteUrl: website.websiteUrl,
        leadData: {
          fullName: rawFullName,
          firstName,
          lastName,
          email: (payloadFields.get("email") || "").trim(),
          mobile: (payloadFields.get("mobile") || payloadFields.get("mobileNumber") || payloadFields.get("phone") || "").trim(),
          phone: (payloadFields.get("phone") || payloadFields.get("mobile") || payloadFields.get("mobileNumber") || "").trim(),
          city: (payloadFields.get("city") || "").trim() || "New York",
          state: (payloadFields.get("state") || "").trim() || "New York",
          country: (payloadFields.get("country") || "").trim() || "United States",
          address: (payloadFields.get("address") || "").trim(),
          message: (payloadFields.get("message") || payloadFields.get("inquiry") || "").trim(),
          companyName: (payloadFields.get("companyName") || payloadFields.get("company") || "").trim(),
          website: (payloadFields.get("website") || payloadFields.get("websiteUrl") || "").trim(),
          websiteUrl: (payloadFields.get("websiteUrl") || payloadFields.get("website") || "").trim(),
          jobTitle: (payloadFields.get("jobTitle") || payloadFields.get("role") || "").trim(),
          subject: (payloadFields.get("subject") || "").trim()
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
          onProgress: async (step, detail, ssPath) => {
            if (ssPath) finalScreenshot = ssPath;
            updateWorkerStatus(`[${step}] ${detail}`, website.websiteUrl);
            await prisma.submissionResult.updateMany({
              where: { id: resultId, status: "Running", job: { userId, status: "Running" } },
              data: {
                message: `[${workerId}] [${step}] ${redactProxyDetails(detail)}`,
                ...(ssPath ? { screenshotPath: ssPath } : {})
              }
            }).catch(() => undefined);
          },
          onTargetsDiscovered: async (targets, reason) => {
            updateWorkerStatus("[form_found] Form target discovered", targets[0]?.url);
            if (targets[0]?.screenshotPath) finalScreenshot = targets[0].screenshotPath;
            await prisma.submissionResult.updateMany({
              where: { id: resultId, status: "Running", job: { userId, status: "Running" } },
              data: {
                message: `[${workerId}] [form_found] ${redactProxyDetails(reason)}`,
                targetType: targets[0]?.targetType ?? null,
                resolvedUrl: targets[0]?.url ?? null,
                ...(targets[0]?.screenshotPath ? { screenshotPath: targets[0].screenshotPath } : {})
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
            updateWorkerStatus(`[fill_form] Filling ${target.targetType}`, target.url);
            await prisma.submissionResult.updateMany({
              where: { id: resultId, status: "Running", job: { userId, status: "Running" } },
              data: {
                message: `[${workerId}] [fill_form] Filling ${target.targetType}...`
              }
            }).catch(() => undefined);
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
            updateWorkerStatus(`[submit_form] Submitting & verifying ${attempt.target.targetType}`, attempt.target.url);
            if (attempt.result.screenshotPath) finalScreenshot = attempt.result.screenshotPath;
            await prisma.submissionResult.updateMany({
              where: { id: resultId, status: "Running", job: { userId, status: "Running" } },
              data: {
                message: `[${workerId}] [submit_form] Finished ${attempt.target.targetType} with status ${attempt.result.status}`,
                ...(attempt.result.screenshotPath ? { screenshotPath: attempt.result.screenshotPath } : {})
              }
            }).catch(() => undefined);
            const attemptId = attemptIds.get(key(attempt.target));
            if (!attemptId) return;
            const successful = resultCompleted(attempt.result);
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
        config.worker.totalTargetTimeoutMs + 2000,
        `Target ${website.websiteUrl}`
      );

      const successes = run.attempts.filter((a) =>
        resultCompleted(a.result)
      );
      const anySuccessful = successes.length > 0;
      // Requirement: Show ONLY the screenshot representing the successful submission for successes
      const successScreenshot = successes.find((a) => a.result.screenshotPath)?.result.screenshotPath ?? null;
      const failureScreenshot = run.attempts.map((a) => a.result.screenshotPath).filter(Boolean).at(-1) ?? run.screenshotPath ?? finalScreenshot ?? null;
      finalScreenshot = anySuccessful ? successScreenshot : failureScreenshot;
      const lastAttempt = run.attempts.at(-1);

      // Determine explicit status classification and true message
      let finalStatus = anySuccessful ? "Completed" : "Failed";
      let finalMessage = "";

      if (anySuccessful) {
        finalMessage = run.discoveryReason.includes("Proxy fallback")
          ? `[${workerId}] ${run.discoveryReason}`
          : `[${workerId}] Successfully submitted contact target`;
      } else {
        const attemptErr = lastAttempt?.result?.errorMessage || "";
        const combinedErr = attemptErr || run.discoveryReason || "Target execution failed";
        finalStatus = classifyErrorTaxonomy(combinedErr, null);
        finalMessage = `[${workerId}] ${combinedErr}`;
      }

      await prisma.submissionResult.updateMany({
        where: { id: resultId, job: { userId, status: "Running" } },
        data: {
          status: finalStatus,
          message: redactProxyDetails(finalMessage),
          screenshotPath: finalScreenshot,
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
  } catch (error) {
    const isProxy = isProxyAuthenticationFailure(error);
    const rawError = isProxy
      ? PROXY_407_MESSAGE
      : error instanceof Error
        ? error.message
        : "Target automation failed";

    const failureStatus = classifyErrorTaxonomy(rawError, null);
    console.warn(`[${workerId}] Error on target ${resultId}: ${rawError} (Status: ${failureStatus})`);

    if (!finalScreenshot && context) {
      try {
        const openPages = context.pages();
        const activePage = openPages.at(-1);
        if (activePage && !activePage.isClosed()) {
          const slug = targetUrlForScreenshot ? slugify(targetUrlForScreenshot) : "target";
          const fileName = `${Date.now()}-${slug}-failure.png`;
          const absolutePath = path.join(process.cwd(), "public", "screenshots", fileName);
          await activePage.screenshot({ path: absolutePath, fullPage: false, timeout: 3000 }).catch(() => null);
          finalScreenshot = `/screenshots/${fileName}`;
        }
      } catch {}
    }

    await prisma.submissionResult.updateMany({
      where: { id: resultId },
      data: {
        status: failureStatus,
        message: `[${workerId}] ${redactProxyDetails(rawError)}`,
        ...(finalScreenshot ? { screenshotPath: finalScreenshot } : {}),
        submittedAt: new Date()
      }
    });
  } finally {
    if (context) {
      await releaseContext(context).catch(() => undefined);
    }
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
    // Check if parent job was cancelled or paused
    const parent = await prisma.submissionJob.findUnique({
      where: { id: jobId },
      select: { status: true }
    });

    if (!parent || (parent.status !== "Running" && parent.status !== "Paused")) {
      console.log(`[${workerId}] Parent job status is ${parent?.status ?? "missing"}; exiting worker loop.`);
      break;
    }

    // Handle Paused state: worker stays alive, sleeps, and checks again without claiming new targets
    if (parent.status === "Paused") {
      const jobWorkers = activeWorkerRegistry.get(jobId);
      if (jobWorkers) {
        jobWorkers.set(workerId, {
          workerId,
          status: "idle",
          currentTargetId: null,
          currentTargetUrl: null,
          currentStep: "Paused by user",
          startedAt: null,
          lastHeartbeatAt: new Date().toISOString()
        });
      }
      await delay(1000);
      continue;
    }

    // Atomic claim attempt
    const resultId = await atomicClaimTarget(jobId, workerId, userId);

    if (!resultId) {
      // Check whether ANY unfinished targets remain in the entire job
      const remainingUnfinished = await prisma.submissionResult.count({
        where: { jobId, status: { in: ["Pending", "Discovering", "Running"] } }
      });

      if (remainingUnfinished === 0) {
        console.log(`[${workerId}] All targets completed for job ${jobId}; worker finished cleanly.`);
        break;
      }

      // Other workers are still busy processing active targets, or stale items may be recovered.
      // Idle briefly and check again.
      await delay(1000 + Math.random() * 500);
      continue;
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
  const workerCount = Math.max(1, Math.min(16, options.workerCount ?? config.worker.maxWorkers));

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

  // Background watchdog timer for recovering stale items and keeping parent job heartbeat fresh
  const watchdog = setInterval(() => {
    void recoverStaleTargets(jobId, userId);
    void prisma.submissionJob.updateMany({
      where: { id: jobId, status: { in: ["Running", "Paused"] } },
      data: { updatedAt: new Date() }
    }).catch(() => undefined);
  }, 10_000);

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
