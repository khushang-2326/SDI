import { Worker, type Job } from "bullmq";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { config, validateConfig } from "@/lib/config";
import { getRedisConnection } from "@/queue/client";
import { acquireContext, closePool, releaseContext } from "@/lib/browserPool";
import { uploadScreenshot } from "@/lib/storage";
import { JobLogger } from "@/lib/logger";

// Import automations
import { discoverSubmissionTarget } from "@/services/submission-target-discovery";
import { submitContactForm } from "@/services/contact-form-automation";
import { submitHubSpotBooking } from "@/services/hubspot-booking-automation";
import { submitCalendlyBooking } from "@/services/calendly-booking-automation";
import { submitGenericBookingWidget } from "@/services/generic-booking-widget-automation";
import { runMultiTargetAutomation } from "@/services/multi-target-automation";

type AutomationJobData = {
  parentJobId: string;
  resultId: string;
  userId: string;
  leadId: string;
  targetWebsiteId: string;
  fields: Array<[string, string]>;
  liveSubmit: boolean;
};

validateConfig();

const worker = new Worker(
  "automation-queue",
  async (job: Job<AutomationJobData>) => {
    const { parentJobId, resultId, userId, leadId, targetWebsiteId, fields, liveSubmit } = job.data;
    const logger = new JobLogger(resultId);
    
    await logger.info(`Starting automation job for website ${targetWebsiteId}`, {
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? 1
    });

    const parentJob = await prisma.submissionJob.findFirst({
      where: { id: parentJobId, userId },
      select: { status: true }
    });

    if (!parentJob || parentJob.status !== "Running") {
      await prisma.submissionResult.updateMany({
        where: { id: resultId },
        data: {
          status: parentJob?.status === "Cancelled" ? "Cancelled" : "Failed",
          message: parentJob?.status === "Cancelled"
            ? "Cancelled before processing"
            : "Parent job is no longer active"
        }
      });
      return;
    }
    
    // Update status in DB
    await prisma.submissionResult.update({
      where: { id: resultId },
      data: { status: "Running", message: "Starting browser session..." }
    });

    const fieldsMap = new Map(fields);
    const leadData = {
      fullName: fieldsMap.get("fullName") || "",
      email: fieldsMap.get("email") || "",
      mobile: fieldsMap.get("mobile") || fieldsMap.get("mobileNumber") || "",
      address: fieldsMap.get("address") || "",
      message: fieldsMap.get("message") || "",
      companyName: fieldsMap.get("companyName") || ""
    };

    const bookingPreferences = {
      preferredDate: fieldsMap.get("preferredDate"),
      preferredTime: fieldsMap.get("preferredTime"),
      timezone: fieldsMap.get("timezone"),
      fallbackToFirstAvailableSlot: true
    };

    let context = null;
    try {
      // 1. Get website info
      const website = await prisma.targetWebsite.findFirst({
        where: { id: targetWebsiteId, userId }
      });

      if (!website) {
        throw new Error("Target website record not found.");
      }

      let websiteUrl = website.contactPageUrl || website.websiteUrl;
      let automationType = fieldsMap.get("automationType") || "auto";
      let discoveryReason: string | null = null;
      let targetType: string | null = automationType;

      // 2. Acquire browser context
      context = await acquireContext();
      await logger.info("Browser context acquired.");

      if (automationType === "auto") {
        const attemptIds = new Map<string, string>();
        const targetIds = new Map<string, string>();
        const targetKey = (target: { targetType: string; url: string }) => `${target.targetType}:${target.url}`;

        const multiRun = await runMultiTargetAutomation({
          websiteUrl: website.websiteUrl,
          leadData,
          bookingPreferences,
          liveSubmit,
          browserContext: context,
          timeoutMs: config.worker.timeoutMs,
          callbacks: {
            onTargetsDiscovered: async (targets, reason) => {
              await logger.info(reason, { targetCount: targets.length });
              await prisma.submissionResult.update({
                where: { id: resultId },
                data: { status: "Discovering", message: reason }
              });
              for (const target of targets) {
                const savedTarget = await prisma.discoveredSubmissionTarget.upsert({
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
                targetIds.set(targetKey(target), savedTarget.id);
              }
            },
            onAttemptStarted: async (target) => {
              const attempt = await prisma.submissionAttempt.create({
                data: {
                  submissionResultId: resultId,
                  discoveredTargetId: targetIds.get(targetKey(target)),
                  targetType: target.targetType,
                  targetUrl: target.url,
                  executionOrder: target.executionOrder,
                  status: "Running",
                  startedAt: new Date(),
                  metadata: JSON.stringify({ reason: target.reason })
                }
              });
              attemptIds.set(targetKey(target), attempt.id);
              await prisma.submissionAttemptLog.create({
                data: { attemptId: attempt.id, level: "info", message: `Started ${target.targetType} automation` }
              });
            },
            onAttemptFinished: async (attempt) => {
              const attemptId = attemptIds.get(targetKey(attempt.target));
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
                  liveSubmit
                }
              });
            }
          }
        });

        if (multiRun.targets.length === 0) throw new Error(multiRun.discoveryReason);
        const successfulAttempts = multiRun.attempts.filter((attempt) =>
          ["success", "dry_run_ready_to_book"].includes(attempt.result.status)
        );
        const allSuccessful = successfulAttempts.length === multiRun.attempts.length;
        const latestScreenshot = multiRun.attempts.map((attempt) => attempt.result.screenshotPath).filter(Boolean).at(-1) ?? null;
        await prisma.submissionResult.update({
          where: { id: resultId },
          data: {
            status: allSuccessful ? "Completed" : "Failed",
            message: `${successfulAttempts.length}/${multiRun.attempts.length} targets completed successfully`,
            screenshotPath: latestScreenshot,
            submittedAt: new Date()
          }
        });
        await prisma.targetWebsite.update({
          where: { id: website.id },
          data: {
            contactPageUrl: multiRun.targets[0]?.url ?? website.contactPageUrl,
            notes: [website.notes, multiRun.discoveryReason].filter(Boolean).join("\n")
          }
        });
        await logger.info(`Multi-target run finished: ${successfulAttempts.length}/${multiRun.attempts.length} successful`);
        return;
      }

      // 3. Discovery Phase
      if (automationType === "auto") {
        await logger.info("Starting target website discovery...", { websiteUrl });
        await prisma.submissionResult.update({
          where: { id: resultId },
          data: { status: "Discovering", message: "Discovering submission target..." }
        });

        const discovery = await discoverSubmissionTarget({
          websiteUrl,
          headless: true,
          timeoutMs: config.worker.timeoutMs,
          browserContext: context
        });

        discoveryReason = discovery.reason;
        targetType = discovery.targetType;

        if (!discovery.discoveredUrl) {
          throw new Error(`Discovery failed: ${discovery.reason}`);
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

        // Save discovered contact URL back to website
        await prisma.targetWebsite.update({
          where: { id: website.id },
          data: {
            contactPageUrl: discovery.discoveredUrl,
            notes: [website.notes, `Discovered ${discovery.targetType}: ${discovery.reason}`]
              .filter(Boolean)
              .join("\n")
          }
        });

        await logger.info(`Target discovered: ${automationType} form at ${websiteUrl}`);
      }

      // 4. Submission Phase
      const cancellationCheck = await prisma.submissionJob.findUnique({
        where: { id: parentJobId },
        select: { status: true }
      });

      if (cancellationCheck?.status === "Cancelled") {
        await prisma.submissionResult.update({
          where: { id: resultId },
          data: { status: "Cancelled", message: "Cancelled before submission" }
        });
        return;
      }

      await logger.info(`Starting form filling and submission using ${automationType} engine...`);
      await prisma.submissionResult.update({
        where: { id: resultId },
        data: { status: "Running", message: `Executing ${automationType} submission...` }
      });

      const result =
        automationType === "contact"
          ? await submitContactForm({
              websiteUrl,
              leadData,
              submit: liveSubmit,
              headless: true,
              browserContext: context,
              skipPersist: true
            })
          : automationType === "hubspot"
            ? await submitHubSpotBooking({
                websiteUrl,
                leadData,
                liveSubmit,
                headless: true,
                bookingPreferences,
                browserContext: context,
                skipPersist: true
              })
            : automationType === "booking"
              ? await submitGenericBookingWidget({
                  websiteUrl,
                  leadData,
                  liveSubmit,
                  headless: true,
                  bookingPreferences,
                  browserContext: context,
                  skipPersist: true
                })
            : await submitCalendlyBooking({
                websiteUrl,
                leadData,
                liveSubmit,
                headless: true,
                bookingPreferences,
                browserContext: context,
                skipPersist: true
              });

      // 5. Upload screenshots if available
      let screenshotUrl = result.screenshotPath;
      if (screenshotUrl && !screenshotUrl.startsWith("http")) {
        try {
          const uniqueName = path.basename(screenshotUrl);
          await logger.info("Uploading screenshot to cloud storage...", { uniqueName });
          screenshotUrl = await uploadScreenshot(screenshotUrl, uniqueName);
          await logger.info("Screenshot uploaded successfully.", { screenshotUrl });
        } catch (storageErr) {
          await logger.warn("Failed to upload screenshot to cloud storage. Kept local path.", storageErr);
        }
      }

      const isSuccess = result.status === "success";

      // 6. Save result to DB
      await prisma.submissionResult.update({
        where: { id: resultId },
        data: {
          status: isSuccess ? "Completed" : "Failed",
          message: result.errorMessage || discoveryReason || result.status,
          screenshotPath: screenshotUrl,
          submittedAt: new Date(result.submittedAt)
        }
      });

      // Log transaction
      await prisma.automationTransaction.create({
        data: {
          userId,
          websiteUrl: result.websiteUrl,
          resolvedUrl: websiteUrl,
          targetType: targetType || automationType,
          status: result.status,
          errorMessage: result.errorMessage,
          screenshotPath: screenshotUrl,
          liveSubmit
        }
      });

      await logger.info(`Job completed with status: ${result.status}`);

    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : "Unknown execution error";
      const maxAttempts = job.opts.attempts ?? 1;
      const willRetry = job.attemptsMade + 1 < maxAttempts;
      await logger.error(willRetry ? `Attempt failed; retrying: ${errMsg}` : `Job failed: ${errMsg}`);
      
      await prisma.submissionResult.update({
        where: { id: resultId },
        data: {
          status: willRetry ? "Pending" : "Failed",
          message: willRetry
            ? `Attempt ${job.attemptsMade + 1} failed; waiting to retry: ${errMsg}`
            : errMsg
        }
      });
      
      throw error;
    } finally {
      if (context) {
        await releaseContext(context);
        await logger.info("Browser context released.");
      }
      
      // Update parent job status if all results are done
      await checkAndCompleteParentJob(parentJobId);
    }
  },
  {
    connection: getRedisConnection(),
    concurrency: config.worker.concurrency
  }
);

async function checkAndCompleteParentJob(parentJobId: string) {
  const parentJob = await prisma.submissionJob.findUnique({
    where: { id: parentJobId },
    select: { status: true }
  });

  if (!parentJob || parentJob.status === "Cancelled") return;

  const pendingResults = await prisma.submissionResult.count({
    where: { jobId: parentJobId, status: { in: ["Pending", "Discovering", "Running"] } }
  });

  if (pendingResults === 0) {
    const failedResults = await prisma.submissionResult.count({
      where: { jobId: parentJobId, status: "Failed" }
    });

    const status = failedResults > 0 ? "Failed" : "Completed";

    await prisma.submissionJob.updateMany({
      where: { id: parentJobId, status: "Running" },
      data: {
        status,
        completedAt: new Date()
      }
    });
  }
}

worker.on("ready", () => {
  console.log(
    `[BullMQ Worker] Ready and listening for jobs on "automation-queue" with concurrency ${config.worker.concurrency}`
  );
});

let lastConnectionErrorAt = 0;
worker.on("error", (error) => {
  const now = Date.now();
  if (now - lastConnectionErrorAt < 30000) return;
  lastConnectionErrorAt = now;
  console.error("[BullMQ Worker] Redis or worker error:", error);
});

let isShuttingDown = false;
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[BullMQ Worker] ${signal} received; finishing active work...`);
  await worker.close();
  await closePool();
  await prisma.$disconnect();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

export default worker;
