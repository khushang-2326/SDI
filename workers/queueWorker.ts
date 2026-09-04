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
import {
  isProxyAuthenticationFailure,
  ProxyAuthenticationError,
  PROXY_407_MESSAGE,
  redactProxyDetails
} from "@/services/proxy-helper";

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
    let website: any = null;
    let websiteUrl = "";
    try {
      // 1. Get website info
      website = await prisma.targetWebsite.findFirst({
        where: { id: targetWebsiteId, userId },
        include: { discoveredTargets: { orderBy: [{ executionOrder: "asc" }, { confidence: "desc" }] } }
      });

      if (!website) {
        throw new Error("Target website record not found.");
      }

      websiteUrl = website.contactPageUrl || website.websiteUrl;
      let automationType = fieldsMap.get("automationType") || "auto";
      let discoveryReason: string | null = null;
      let targetType: string | null = automationType;

      if (automationType === "direct_contact") {
        if (!website.contactPageUrl) {
          throw new Error("Direct contact mode requires contactPageUrl for this website.");
        }
        websiteUrl = website.contactPageUrl;
        automationType = "contact";
        targetType = "contact_form";
        discoveryReason = "Direct contact mode: opened only the supplied contact page URL.";
      }

      // 2. Acquire browser context
      context = await acquireContext({ userId });
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
          deadlineAt: Date.now() + config.worker.websiteTimeoutMs,
          cachedTargets: website.discoveredTargets.map((target: any) => ({
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
              await logger.info(redactProxyDetails(reason), { targetCount: targets.length });
              await prisma.submissionResult.update({
                where: { id: resultId },
                data: { status: "Discovering", message: redactProxyDetails(reason) }
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
                data: { attemptId: attempt.id, level: "info", message: redactProxyDetails(`Started ${target.targetType} automation`) }
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
                  message: `Finished ${attempt.target.targetType} with status ${attempt.result.status}`,
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
        const anySuccessful = successfulAttempts.length > 0;
        const latestScreenshot = multiRun.attempts.map((attempt) => attempt.result.screenshotPath).filter(Boolean).at(-1) ?? null;
        await prisma.submissionResult.update({
          where: { id: resultId },
          data: {
            status: anySuccessful ? "Completed" : "Failed",
            message: redactProxyDetails(
              multiRun.discoveryReason.includes("Proxy fallback")
                ? multiRun.discoveryReason
                : `${successfulAttempts.length}/${multiRun.attempts.length} targets completed successfully`
            ),
            screenshotPath: latestScreenshot,
            submittedAt: new Date()
          }
        });
        await prisma.targetWebsite.update({
          where: { id: website.id },
          data: {
            contactPageUrl: multiRun.targets[0]?.url ?? website.contactPageUrl,
            notes: [website.notes, redactProxyDetails(multiRun.discoveryReason)].filter(Boolean).join("\n")
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
              skipPersist: true,
              userId
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
          message: redactProxyDetails(result.errorMessage || discoveryReason || result.status),
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
          errorMessage: redactProxyDetails(result.errorMessage),
          screenshotPath: screenshotUrl,
          liveSubmit
        }
      });

      await logger.info(`Job completed with status: ${result.status}`);

    } catch (error: unknown) {
      const rawErrMsg = error instanceof Error ? error.message : "Unknown execution error";
      const errMsg = redactProxyDetails(rawErrMsg);
      const maxAttempts = job.opts.attempts ?? 1;
      const willRetry = job.attemptsMade + 1 < maxAttempts;
      await logger.error(willRetry ? `Attempt failed; retrying: ${errMsg}` : `Job failed: ${errMsg}`);
      
      let failureScreenshotUrl: string | null = null;
      try {
        let tempContext = context;
        let createdTemp = false;
        if (!tempContext) {
          tempContext = await acquireContext({ userId }).catch(() => null);
          createdTemp = !!tempContext;
        }
        if (tempContext) {
          const pages = tempContext.pages();
          const activePage = pages[0] || (await tempContext.newPage());
          const currentUrl = activePage.url();
          
          const targetUrl = websiteUrl || (website ? (website.contactPageUrl || website.websiteUrl) : null);
          if ((currentUrl === "about:blank" || !currentUrl) && targetUrl) {
            await activePage.goto(targetUrl, { waitUntil: "commit", timeout: 10000 }).catch(() => undefined);
          }
          
          const fs = await import("node:fs/promises");
          const path = await import("node:path");
          const SCREENSHOT_DIR = path.join(process.cwd(), "public", "screenshots");
          await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
          const fileName = `${Date.now()}-${(targetUrl || "unknown").replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 70)}-failure.png`;
          const absolutePath = path.join(SCREENSHOT_DIR, fileName);
          
          await activePage.screenshot({ path: absolutePath, fullPage: false }).catch(() => undefined);
          const localPath = `/screenshots/${fileName}`;
          
          try {
            failureScreenshotUrl = await uploadScreenshot(localPath, fileName);
          } catch {
            failureScreenshotUrl = localPath;
          }
          
          if (createdTemp) {
            await releaseContext(tempContext).catch(() => undefined);
          }
        }
      } catch (screenshotErr) {
        console.error("Failed to capture failure screenshot:", screenshotErr);
      }

      await prisma.submissionResult.update({
        where: { id: resultId },
        data: {
          status: willRetry ? "Pending" : "Failed",
          message: willRetry
            ? `Attempt ${job.attemptsMade + 1} failed; waiting to retry: ${errMsg}`
            : errMsg,
          screenshotPath: failureScreenshotUrl
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
