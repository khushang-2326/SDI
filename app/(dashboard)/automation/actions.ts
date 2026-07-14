"use server";

import { submitCalendlyBooking } from "@/services/calendly-booking-automation";
import { submitContactForm } from "@/services/contact-form-automation";
import { submitGenericBookingWidget } from "@/services/generic-booking-widget-automation";
import { submitHubSpotBooking } from "@/services/hubspot-booking-automation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { discoverSubmissionTarget } from "@/services/submission-target-discovery";
import { SubmitContactFormResult } from "@/types/automation";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "@/lib/config";
import { getAutomationQueue } from "@/queue/client";
import { acquireContext, releaseContext } from "@/lib/browserPool";
import { runMultiTargetAutomation } from "@/services/multi-target-automation";

export type AutomationResult = {
    websiteUrl: string;
    resolvedUrl: string;
    discoveryReason: string | null;
    targetType: string | null;
    status: SubmitContactFormResult["status"];
    errorMessage: string | null;
    screenshotPath: string | null;
    screenshotPaths: string[];
    selectedDate: string | null;
    selectedTime: string | null;
    filledFields: string[];
    skippedFields: string[];
    submittedAt: string;
    attempts?: AutomationAttemptResult[];
};

export type AutomationAttemptResult = {
  id: string;
  targetType: string;
  targetUrl: string;
  executionOrder: number;
  status: string;
  message: string | null;
  errorMessage: string | null;
  screenshotPath: string | null;
  screenshotPaths: string[];
  startedAt: string | null;
  completedAt: string | null;
};

export type AutomationRunnerState = {
  result: AutomationResult | null;
  results?: AutomationResult[];
};

export type BackgroundAutomationJob = { id: string; userId: string; status: "running" | "completed" | "cancelled"; createdAt: string; items: Array<{ id: string; name: string; url: string; status: "waiting" | "discovering" | "completed" | "failed" | "cancelled"; detail: string; result?: AutomationResult }> };

const globalForLocalAutomation = globalThis as typeof globalThis & {
  localAutomationLocks?: Map<string, Promise<void>>;
};
const localAutomationLocks =
  globalForLocalAutomation.localAutomationLocks ?? new Map<string, Promise<void>>();
globalForLocalAutomation.localAutomationLocks = localAutomationLocks;

function mapDbStatusToBackground(status: string): "running" | "completed" | "cancelled" {
  if (status === "Pending" || status === "Running" || status === "Discovering") return "running";
  if (status === "Cancelled") return "cancelled";
  return "completed";
}

function mapResultStatusToBackground(status: string): "waiting" | "discovering" | "completed" | "failed" | "cancelled" {
  if (status === "Pending") return "waiting";
  if (status === "Discovering" || status === "Running") return "discovering";
  if (status === "Completed") return "completed";
  if (status === "Cancelled") return "cancelled";
  return "failed";
}

async function mapJobToBackgroundJob(dbJob: any): Promise<BackgroundAutomationJob> {
  const proofPath = (screenshotPath: string | null) => {
    if (!screenshotPath?.startsWith("/screenshots/")) return screenshotPath;
    const fileName = screenshotPath.split("/").at(-1);
    return fileName ? `/proof/${encodeURIComponent(fileName)}` : screenshotPath;
  };

  return {
    id: dbJob.id,
    userId: dbJob.userId,
    status: mapDbStatusToBackground(dbJob.status),
    createdAt: dbJob.createdAt.toISOString(),
    items: dbJob.results.map((res: any) => ({
      id: res.targetWebsite.id,
      name: res.targetWebsite.websiteName,
      url: res.targetWebsite.websiteUrl,
      status: mapResultStatusToBackground(res.status),
      detail: res.message || res.status,
      result: res.status === "Completed" || res.status === "Failed" ? {
        websiteUrl: res.targetWebsite.websiteUrl,
        resolvedUrl: res.targetWebsite.contactPageUrl || res.targetWebsite.websiteUrl,
        discoveryReason: res.message,
        targetType: null,
        status: res.status === "Completed" ? "success" : "failed",
        errorMessage: res.status === "Failed" ? res.message : null,
        screenshotPath: proofPath(res.screenshotPath),
        screenshotPaths: res.screenshotPath ? [proofPath(res.screenshotPath)].filter(Boolean) as string[] : [],
        selectedDate: null,
        selectedTime: null,
        filledFields: [],
        skippedFields: [],
        submittedAt: res.submittedAt ? res.submittedAt.toISOString() : res.createdAt.toISOString(),
        attempts: (res.attempts ?? []).map((attempt: any) => ({
          id: attempt.id,
          targetType: attempt.targetType,
          targetUrl: attempt.targetUrl,
          executionOrder: attempt.executionOrder,
          status: attempt.status,
          message: attempt.message,
          errorMessage: attempt.errorMessage,
          screenshotPath: proofPath(attempt.screenshotPath),
          screenshotPaths: JSON.parse(attempt.screenshotPaths || "[]").map(proofPath),
          startedAt: attempt.startedAt?.toISOString() ?? null,
          completedAt: attempt.completedAt?.toISOString() ?? null
        }))
      } : undefined
    }))
  };
}

export async function startBackgroundAutomationAction(formData: FormData) {
  const user = await requireUser();
  const requestedIds = JSON.parse(readText(formData, "websiteIds") || "[]") as string[];
  const websites = await prisma.targetWebsite.findMany({
    where: { userId: user.id, id: { in: requestedIds }, status: "active" },
    orderBy: { createdAt: "asc" }
  });

  if (websites.length === 0) {
    throw new Error("No active websites were selected for this automation run.");
  }

  const fields = Array.from(formData.entries()).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  const fieldsMap = new Map(fields);

  // Find or create Lead
  const leadDataForSave = {
    fullName: fieldsMap.get("fullName") || "Demo Lead",
    mobileNumber: fieldsMap.get("mobile") || fieldsMap.get("mobileNumber") || "",
    email: fieldsMap.get("email") || "demo@lead-auto-submitter.local",
    address: fieldsMap.get("address") || "",
    message: fieldsMap.get("message") || "",
    companyName: fieldsMap.get("companyName") || "",
    userId: user.id
  };

  const existingLead = await prisma.lead.findFirst({
    where: { userId: user.id, email: leadDataForSave.email }
  });

  const lead = existingLead
    ? await prisma.lead.update({ where: { id: existingLead.id }, data: leadDataForSave })
    : await prisma.lead.create({ data: leadDataForSave });

  // Create Parent SubmissionJob
  const job = await prisma.submissionJob.create({
    data: {
      status: "Running",
      startedAt: new Date(),
      userId: user.id,
      leadId: lead.id
    }
  });

  const liveSubmit = fields.some(([key, value]) => key === "liveSubmit" && value === "on");
  await prisma.jobLog.create({
    data: {
      jobId: job.id,
      level: "system",
      message: "automation-payload",
      details: JSON.stringify({ fields, liveSubmit })
    }
  });

  const results = [];
  const automationQueue = config.queueProvider === "redis" ? getAutomationQueue() : null;
  // For each website, create SubmissionResult and push to BullMQ queue
  try {
    for (const web of websites) {
      const resRecord = await prisma.submissionResult.create({
        data: {
          jobId: job.id,
          leadId: lead.id,
          targetWebsiteId: web.id,
          status: "Pending"
        },
        include: {
          targetWebsite: true
        }
      });

      results.push(resRecord);

      if (automationQueue) {
        await automationQueue.add(
          "submit",
          {
            parentJobId: job.id,
            resultId: resRecord.id,
            userId: user.id,
            leadId: lead.id,
            targetWebsiteId: web.id,
            fields,
            liveSubmit
          },
          {
            jobId: resRecord.id,
            attempts: config.worker.maxRetries + 1,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: 100,
            removeOnFail: 200
          }
        );
      }
    }
  } catch (error) {
    await Promise.all(
      results.map(async (result) => {
        if (!automationQueue) return;
        await automationQueue
          .getJob(result.id)
          .then((queuedJob) => queuedJob?.remove())
          .catch(() => undefined);
      })
    );
    await prisma.submissionResult.updateMany({
      where: { jobId: job.id, status: "Pending" },
      data: { status: "Failed", message: "Unable to connect to the background queue" }
    });
    await prisma.submissionJob.update({
      where: { id: job.id },
      data: { status: "Failed", completedAt: new Date() }
    });
    throw new Error(
      config.queueProvider === "redis"
        ? `Unable to queue this automation run. Confirm Redis is running at ${config.redisUrl}.`
        : "Unable to create this local automation run.",
      { cause: error }
    );
  }

  const mappedJob = await mapJobToBackgroundJob({
    ...job,
    results
  });

  return mappedJob;
}

export async function cancelBackgroundAutomationAction(jobId: string) {
  const user = await requireUser();
  const job = await prisma.submissionJob.findFirst({
    where: { id: jobId, userId: user.id },
    include: { results: { include: { targetWebsite: true, attempts: { orderBy: { executionOrder: "asc" } } } } }
  });
  if (!job || job.status === "Cancelled") {
    return job ? mapJobToBackgroundJob(job) : null;
  }

  // SQLite is the source of truth for cancellation. Do not wait for Redis here:
  // the worker checks the parent status before processing and before submission.
  await prisma.$transaction([
    prisma.submissionJob.update({
      where: { id: jobId },
      data: { status: "Cancelled", completedAt: new Date() }
    }),
    prisma.submissionResult.updateMany({
      where: { jobId, status: { in: ["Pending", "Discovering", "Running"] } },
      data: { status: "Cancelled", message: "Cancelled by user" }
    })
  ]);

  const updatedJob = await prisma.submissionJob.findFirst({
    where: { id: jobId },
    include: { results: { include: { targetWebsite: true, attempts: { orderBy: { executionOrder: "asc" } } } } }
  });

  return updatedJob ? mapJobToBackgroundJob(updatedJob) : null;
}

export async function resetBackgroundAutomationAction(jobId: string) {
  const user = await requireUser();
  const job = await prisma.submissionJob.findFirst({
    where: { id: jobId, userId: user.id }
  });
  if (!job || job.status === "Pending" || job.status === "Running") return false;

  const deleted = await prisma.submissionJob.deleteMany({
    where: {
      id: jobId,
      userId: user.id,
      status: { in: ["Completed", "Failed", "Cancelled"] }
    }
  });

  return deleted.count > 0;
}

export async function getBackgroundAutomationAction(jobId?: string) {
  const user = await requireUser();
  if (jobId) {
    const dbJob = await prisma.submissionJob.findFirst({
      where: { id: jobId, userId: user.id },
      include: {
        results: {
          include: {
            targetWebsite: true,
            attempts: { orderBy: { executionOrder: "asc" } }
          }
        }
      }
    });
    if (!dbJob) return null;
    return mapJobToBackgroundJob(dbJob);
  }

  const staleBefore = new Date(Date.now() - 30 * 60 * 1000);
  const staleJobs = await prisma.submissionJob.findMany({
    where: { userId: user.id, status: "Running", updatedAt: { lt: staleBefore } },
    select: { id: true }
  });

  if (staleJobs.length > 0) {
    const staleJobIds = staleJobs.map((job) => job.id);
    await prisma.$transaction([
      prisma.submissionJob.updateMany({
        where: { id: { in: staleJobIds }, userId: user.id, status: "Running" },
        data: { status: "Cancelled", completedAt: new Date() }
      }),
      prisma.submissionResult.updateMany({
        where: {
          jobId: { in: staleJobIds },
          status: { in: ["Pending", "Discovering", "Running"] }
        },
        data: { status: "Cancelled", message: "Stale run cleared automatically" }
      })
    ]);
  }

  const dbJob = await prisma.submissionJob.findFirst({
    where: { userId: user.id, status: "Running" },
    orderBy: { createdAt: "desc" },
    include: {
      results: {
        include: {
          targetWebsite: true,
          attempts: { orderBy: { executionOrder: "asc" } }
        }
      }
    }
  });
  if (!dbJob) return null;
  return mapJobToBackgroundJob(dbJob);
}

function localResultCompleted(result: AutomationResult) {
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

async function completeLocalParentJob(jobId: string) {
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

async function processLocalQueueResult(userId: string, resultId: string) {
  const claimed = await prisma.submissionResult.updateMany({
    where: { id: resultId, status: "Pending", job: { userId, status: "Running" } },
    data: { status: "Discovering", message: "Starting local automation" }
  });
  if (claimed.count === 0) return;

  const record = await prisma.submissionResult.findUnique({
    where: { id: resultId },
    include: { job: true }
  });
  if (!record) return;

  try {
    const payloadLog = await prisma.jobLog.findFirst({
      where: { jobId: record.jobId, message: "automation-payload" },
      orderBy: { createdAt: "desc" }
    });
    if (!payloadLog?.details) throw new Error("Automation payload is missing.");

    const payload = JSON.parse(payloadLog.details) as {
      fields: Array<[string, string]>;
      liveSubmit: boolean;
    };
    const payloadFields = new Map(payload.fields);

    if ((payloadFields.get("automationType") || "auto") === "auto") {
      const website = await prisma.targetWebsite.findFirst({
        where: { id: record.targetWebsiteId, userId }
      });
      if (!website) throw new Error("Target website record not found.");
      const context = await acquireContext();
      try {
        const targetIds = new Map<string, string>();
        const attemptIds = new Map<string, string>();
        const key = (target: { targetType: string; url: string }) => `${target.targetType}:${target.url}`;
        const run = await runMultiTargetAutomation({
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
          callbacks: {
            onTargetsDiscovered: async (targets, reason) => {
              await prisma.submissionResult.update({
                where: { id: resultId },
                data: { status: "Discovering", message: reason }
              });
              for (const target of targets) {
                const saved = await prisma.discoveredSubmissionTarget.upsert({
                  where: { targetWebsiteId_targetType_url: {
                    targetWebsiteId: website.id,
                    targetType: target.targetType,
                    url: target.url
                  } },
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
              const attempt = await prisma.submissionAttempt.create({
                data: {
                  submissionResultId: resultId,
                  discoveredTargetId: targetIds.get(key(target)),
                  targetType: target.targetType,
                  targetUrl: target.url,
                  executionOrder: target.executionOrder,
                  status: "Running",
                  startedAt: new Date(),
                  metadata: JSON.stringify({ reason: target.reason })
                }
              });
              attemptIds.set(key(target), attempt.id);
              await prisma.submissionAttemptLog.create({
                data: { attemptId: attempt.id, message: `Started ${target.targetType} automation` }
              });
            },
            onAttemptFinished: async (attempt) => {
              const attemptId = attemptIds.get(key(attempt.target));
              if (!attemptId) return;
              const successful = ["success", "dry_run_ready_to_book"].includes(attempt.result.status);
              await prisma.submissionAttempt.update({
                where: { id: attemptId },
                data: {
                  status: successful ? "Completed" : "Failed",
                  message: attempt.result.status,
                  errorMessage: attempt.result.errorMessage,
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
                  message: `Finished ${attempt.target.targetType} with status ${attempt.result.status}`,
                  details: attempt.result.errorMessage
                }
              });
              await prisma.automationTransaction.create({
                data: {
                  userId,
                  websiteUrl: website.websiteUrl,
                  resolvedUrl: attempt.target.url,
                  targetType: attempt.target.targetType,
                  status: attempt.result.status,
                  errorMessage: attempt.result.errorMessage,
                  screenshotPath: attempt.result.screenshotPath,
                  liveSubmit: payload.liveSubmit
                }
              });
            }
          }
        });
        if (run.targets.length === 0) throw new Error(run.discoveryReason);
        const successes = run.attempts.filter((attempt) =>
          ["success", "dry_run_ready_to_book"].includes(attempt.result.status)
        );
        const allSuccessful = successes.length === run.attempts.length;
        await prisma.submissionResult.update({
          where: { id: resultId },
          data: {
            status: allSuccessful ? "Completed" : "Failed",
            message: `${successes.length}/${run.attempts.length} targets completed successfully`,
            screenshotPath: run.attempts.map((attempt) => attempt.result.screenshotPath).filter(Boolean).at(-1) ?? null,
            submittedAt: new Date()
          }
        });
        await prisma.targetWebsite.update({
          where: { id: website.id },
          data: {
            contactPageUrl: run.targets[0]?.url ?? website.contactPageUrl,
            notes: [website.notes, run.discoveryReason].filter(Boolean).join("\n")
          }
        });
        return;
      } finally {
        await releaseContext(context);
      }
    }

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
      runSingleAutomationAction(userId, formData),
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
    const saved = await prisma.submissionResult.updateMany({
      where: { id: resultId, job: { status: "Running" } },
      data: {
        status: localResultCompleted(result) ? "Completed" : "Failed",
        message: result.errorMessage || result.discoveryReason || result.status,
        screenshotPath: result.screenshotPath,
        submittedAt: new Date(result.submittedAt)
      }
    });
    if (saved.count > 0) await storeTransaction(userId, result, payload.liveSubmit);
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
    await completeLocalParentJob(record.jobId);
  }
}

export async function processLocalBackgroundAutomationAction(jobId: string) {
  const user = await requireUser();
  if (config.queueProvider === "local" && !localAutomationLocks.has(jobId)) {
    const processing = (async () => {
      const activeResult = await prisma.submissionResult.findFirst({
        where: {
          jobId,
          status: { in: ["Discovering", "Running"] },
          job: { userId: user.id, status: "Running" }
        },
        select: { id: true }
      });
      if (activeResult) {
        // An active item without this process's lock was interrupted by a server restart.
        await prisma.submissionResult.updateMany({
          where: {
            id: activeResult.id,
            status: { in: ["Discovering", "Running"] },
            job: { userId: user.id, status: "Running" }
          },
          data: { status: "Pending", message: "Recovered after an interrupted automation run" }
        });
      }

      const nextResult = await prisma.submissionResult.findFirst({
        where: { jobId, status: "Pending", job: { userId: user.id, status: "Running" } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true }
      });
      if (nextResult) await processLocalQueueResult(user.id, nextResult.id);
    })();

    localAutomationLocks.set(jobId, processing);
    try {
      await processing;
    } finally {
      if (localAutomationLocks.get(jobId) === processing) {
        localAutomationLocks.delete(jobId);
      }
    }
  }

  const job = await prisma.submissionJob.findFirst({
    where: { id: jobId, userId: user.id },
    include: { results: { include: { targetWebsite: true, attempts: { orderBy: { executionOrder: "asc" } } } } }
  });
  return job ? mapJobToBackgroundJob(job) : null;
}

function readText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function serializeResult(
  result: SubmitContactFormResult,
  details: {
    resolvedUrl: string;
    discoveryReason?: string | null;
    targetType?: string | null;
  }
) {
  const proofPath = (screenshotPath: string | null) => {
    if (!screenshotPath?.startsWith("/screenshots/")) return screenshotPath;
    const fileName = screenshotPath.split("/").at(-1);
    return fileName ? `/proof/${encodeURIComponent(fileName)}` : screenshotPath;
  };

  return {
    websiteUrl: result.websiteUrl,
    resolvedUrl: details.resolvedUrl,
    discoveryReason: details.discoveryReason ?? null,
    targetType: details.targetType ?? null,
    status: result.status,
    errorMessage: result.errorMessage,
    screenshotPath: proofPath(result.screenshotPath),
    screenshotPaths: (result.screenshotPaths ?? (result.screenshotPath ? [result.screenshotPath] : []))
      .map(proofPath)
      .filter((screenshotPath): screenshotPath is string => Boolean(screenshotPath)),
    selectedDate: result.selectedDate ?? null,
    selectedTime: result.selectedTime ?? null,
    filledFields: result.filledFields,
    skippedFields: result.skippedFields,
    submittedAt: result.submittedAt.toISOString()
  };
}

export async function storeTransaction(userId: string, result: AutomationResult, liveSubmit: boolean) {
  await prisma.automationTransaction.create({ data: { userId, websiteUrl: result.websiteUrl, resolvedUrl: result.resolvedUrl, targetType: result.targetType, status: result.status, errorMessage: result.errorMessage, screenshotPath: result.screenshotPath, liveSubmit } });
}

export async function runAutomationAction(
  _previousState: AutomationRunnerState,
  formData: FormData
): Promise<AutomationRunnerState> {
  const user = await requireUser();
  const selectedWebsiteId = readText(formData, "websiteId");

  if (selectedWebsiteId === "__all_uploaded__") {
    const websites = await prisma.targetWebsite.findMany({
      where: { userId: user.id, status: "active" },
      orderBy: { createdAt: "asc" },
      select: { id: true, websiteUrl: true }
    });
    const results: AutomationResult[] = [];

    for (const website of websites) {
      const websiteFormData = new FormData();
      for (const [key, value] of formData.entries()) websiteFormData.append(key, value);
      websiteFormData.set("websiteId", website.id);
      websiteFormData.set("websiteUrl", "");

      try {
        const state = await runSingleAutomationAction(user.id, websiteFormData);
        if (state.result) { results.push(state.result); await storeTransaction(user.id, state.result, formData.get("liveSubmit") === "on").catch(() => undefined); }
      } catch (error) {
        results.push({
          websiteUrl: website.websiteUrl,
          resolvedUrl: website.websiteUrl,
          discoveryReason: null,
          targetType: null,
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Automation failed.",
          screenshotPath: null,
          screenshotPaths: [],
          selectedDate: null,
          selectedTime: null,
          filledFields: [],
          skippedFields: [],
          submittedAt: new Date().toISOString()
        });
      }
    }

    if (results.length === 0) {
      const result: AutomationResult = {
        websiteUrl: "",
        resolvedUrl: "",
        discoveryReason: null,
        targetType: null,
        status: "failed",
        errorMessage: "No active uploaded websites are available. Upload an Excel file first.",
        screenshotPath: null,
        screenshotPaths: [],
        selectedDate: null,
        selectedTime: null,
        filledFields: [],
        skippedFields: [],
        submittedAt: new Date().toISOString()
      };
      return { result, results: [result] };
    }

    return { result: results[results.length - 1], results };
  }

  const state = await runSingleAutomationAction(user.id, formData);
  if (state.result) await storeTransaction(user.id, state.result, formData.get("liveSubmit") === "on").catch(() => undefined);
  return state;
}

export async function runSingleAutomationAction(
  userId: string,
  formData: FormData
): Promise<AutomationRunnerState> {
  const selectedWebsiteId = readText(formData, "websiteId");
  const manualWebsiteUrl = readText(formData, "websiteUrl");
  let websiteUrl = manualWebsiteUrl;
  let automationType = readText(formData, "automationType") || "auto";
  let discoveryReason: string | null = null;
  let targetType: string | null = automationType;
  const liveSubmit = formData.get("liveSubmit") === "on";
  const showBrowser = formData.get("showBrowser") === "on";
  const leadData = {
    fullName: readText(formData, "fullName"),
    email: readText(formData, "email"),
    mobile: readText(formData, "mobile"),
    address: readText(formData, "address"),
    message: readText(formData, "message"),
    companyName: readText(formData, "companyName")
  };

  const selectedWebsite = selectedWebsiteId
      ? await prisma.targetWebsite.findFirst({
        where: { id: selectedWebsiteId, userId }
      })
    : null;

  if (selectedWebsite) {
    websiteUrl = selectedWebsite.contactPageUrl || selectedWebsite.websiteUrl;
  }

  if (!websiteUrl || !leadData.fullName || !leadData.email) {
    return {
      result: {
        websiteUrl,
        resolvedUrl: websiteUrl,
        discoveryReason: null,
        targetType: null,
        status: "failed",
        errorMessage: "Website URL, full name, and email are required.",
        screenshotPath: null,
        screenshotPaths: [],
        selectedDate: null,
        selectedTime: null,
        filledFields: [],
        skippedFields: [],
        submittedAt: new Date().toISOString()
      }
    };
  }

  if (automationType === "auto") {
    const savedNotes = selectedWebsite?.notes?.toLowerCase() ?? "";
    const cachedTargetIsHomepage = Boolean(
      selectedWebsite?.contactPageUrl &&
      selectedWebsite.contactPageUrl.replace(/\/$/, "") === selectedWebsite.websiteUrl.replace(/\/$/, "")
    );
    const shouldRediscoverCachedHomepageBooking =
      cachedTargetIsHomepage && (savedNotes.includes("calendly") || savedNotes.includes("booking"));

    if (selectedWebsite?.contactPageUrl && !shouldRediscoverCachedHomepageBooking) {
      discoveryReason = "Using saved discovered contact/booking URL.";
      const isCalendlyUrl = selectedWebsite.contactPageUrl.toLowerCase().includes("calendly");
      const isHubSpotUrl = selectedWebsite.contactPageUrl.toLowerCase().includes("meetings.hubspot.com");
      const notes = selectedWebsite.notes?.toLowerCase() ?? "";
      automationType =
        isHubSpotUrl || notes.includes("hubspot")
          ? "hubspot"
          : isCalendlyUrl || notes.includes("calendly")
            ? "calendly"
            : notes.includes("booking_widget")
              ? "booking"
            : "contact";
      targetType = automationType;
    } else {
      const discovery = await discoverSubmissionTarget({
        websiteUrl,
        headless: !showBrowser,
        timeoutMs: 8000,
        maxNavigationLinks: 10,
        maxFallbackPaths: 6
      });

      discoveryReason = discovery.reason;
      targetType = discovery.targetType;

      if (!discovery.discoveredUrl) {
        return {
          result: {
            websiteUrl,
            resolvedUrl: websiteUrl,
            discoveryReason,
            targetType,
            status: "failed",
            errorMessage: discovery.reason,
            screenshotPath: discovery.screenshotPath,
            screenshotPaths: discovery.screenshotPath ? [discovery.screenshotPath] : [],
            selectedDate: null,
            selectedTime: null,
            filledFields: [],
            skippedFields: [],
            submittedAt: new Date().toISOString()
          }
        };
      }

      websiteUrl = discovery.discoveredUrl;
      automationType =
        discovery.targetType === "contact_form"
          ? "contact"
          : discovery.targetType === "hubspot_booking"
            ? "hubspot"
            : discovery.targetType === "booking_widget"
              ? "booking"
            : "calendly";

      if (selectedWebsite) {
        await prisma.targetWebsite.update({
          where: { id: selectedWebsite.id },
          data: {
            contactPageUrl: discovery.discoveredUrl,
            notes: [selectedWebsite.notes, `Discovered ${discovery.targetType}: ${discovery.reason}`]
              .filter(Boolean)
              .join("\n")
          }
        });
      }
    }
  }

  const bookingPreferences = {
    preferredDate: readText(formData, "preferredDate"),
    preferredTime: readText(formData, "preferredTime"),
    timezone: readText(formData, "timezone"),
    fallbackToFirstAvailableSlot: true
  };

  let result =
    automationType === "contact"
      ? await submitContactForm({
          websiteUrl,
          leadData,
          submit: liveSubmit,
          headless: !showBrowser
        })
      : automationType === "hubspot"
        ? await submitHubSpotBooking({
            websiteUrl,
            leadData,
            liveSubmit,
            headless: !showBrowser,
            bookingPreferences
          })
        : automationType === "booking"
          ? await submitGenericBookingWidget({
              websiteUrl,
              leadData,
              liveSubmit,
              headless: !showBrowser,
              bookingPreferences
            })
        : await submitCalendlyBooking({
            websiteUrl,
            leadData,
            liveSubmit,
            headless: !showBrowser,
            bookingPreferences
          });

  if (
    automationType === "contact" &&
    result.status === "booking_widget_found" &&
    result.bookingWidgetReason?.toLowerCase().includes("calendly")
  ) {
    discoveryReason = [discoveryReason, result.bookingWidgetReason]
      .filter(Boolean)
      .join("; ");
    targetType = "calendly";
    result = await submitCalendlyBooking({
      websiteUrl,
      leadData,
      liveSubmit,
      headless: !showBrowser,
      bookingPreferences
    });

    if (selectedWebsite) {
      await prisma.targetWebsite.update({
        where: { id: selectedWebsite.id },
        data: {
          notes: [selectedWebsite.notes, "Discovered calendly: contact page embeds Calendly"]
            .filter(Boolean)
            .join("\n")
        }
      });
    }
  }

  const serialized = serializeResult(result, {
      resolvedUrl: websiteUrl,
      discoveryReason,
      targetType
    });
  return { result: serialized };
}
