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
};

export type AutomationRunnerState = {
  result: AutomationResult | null;
  results?: AutomationResult[];
};

export type BackgroundAutomationJob = { id: string; userId: string; status: "running" | "completed" | "cancelled"; createdAt: string; items: Array<{ id: string; name: string; url: string; status: "waiting" | "discovering" | "completed" | "failed" | "cancelled"; detail: string; result?: AutomationResult }> };
const JOB_DIR = path.join(process.cwd(), ".automation-jobs");
const cancelledJobs = new Set<string>();
async function saveBackgroundJob(job: BackgroundAutomationJob) { await fs.mkdir(JOB_DIR, { recursive: true }); await fs.writeFile(path.join(JOB_DIR, `${job.id}.json`), JSON.stringify(job)); }
async function readBackgroundJob(id: string) { return JSON.parse(await fs.readFile(path.join(JOB_DIR, `${id}.json`), "utf8")) as BackgroundAutomationJob; }

export async function startBackgroundAutomationAction(formData: FormData) {
  const user = await requireUser();
  const requestedIds = JSON.parse(readText(formData, "websiteIds") || "[]") as string[];
  const websites = await prisma.targetWebsite.findMany({ where: { userId: user.id, id: { in: requestedIds }, status: "active" }, orderBy: { createdAt: "asc" } });
  const job: BackgroundAutomationJob = { id: randomUUID(), userId: user.id, status: "running", createdAt: new Date().toISOString(), items: websites.map((website) => ({ id: website.id, name: website.websiteName, url: website.websiteUrl, status: "waiting", detail: "Waiting to start" })) };
  await saveBackgroundJob(job);
  const fields = Array.from(formData.entries()).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  void runBackgroundJob(job, fields);
  return job;
}

async function runBackgroundJob(job: BackgroundAutomationJob, fields: Array<[string, string]>) {
  for (const item of job.items) {
    if (cancelledJobs.has(job.id)) { job.status = "cancelled"; for (const pending of job.items) if (pending.status === "waiting") { pending.status = "cancelled"; pending.detail = "Cancelled by user"; } await saveBackgroundJob(job); return; }
    item.status = "discovering"; item.detail = "Opening website and finding contact/booking target"; await saveBackgroundJob(job);
    const data = new FormData(); for (const [key, value] of fields) data.append(key, value); data.set("websiteId", item.id); data.set("websiteUrl", "");
    try { const state = await runSingleAutomationAction(job.userId, data); if (state.result) { item.result = state.result; item.status = state.result.status === "failed" ? "failed" : "completed"; item.detail = state.result.errorMessage || state.result.discoveryReason || state.result.status; await storeTransaction(job.userId, state.result, data.get("liveSubmit") === "on").catch(() => undefined); } }
    catch (error) { item.status = "failed"; item.detail = error instanceof Error ? error.message : "Automation failed"; }
    await saveBackgroundJob(job);
    if (cancelledJobs.has(job.id)) { job.status = "cancelled"; for (const pending of job.items) if (pending.status === "waiting") { pending.status = "cancelled"; pending.detail = "Cancelled by user"; } await saveBackgroundJob(job); return; }
  }
  job.status = "completed"; await saveBackgroundJob(job);
}

export async function cancelBackgroundAutomationAction(jobId: string) {
  const user = await requireUser();
  const job = await readBackgroundJob(jobId).catch(() => null);
  if (!job || job.userId !== user.id || job.status !== "running") return job;
  cancelledJobs.add(jobId); job.status = "cancelled";
  for (const item of job.items) if (item.status === "waiting") { item.status = "cancelled"; item.detail = "Cancelled by user"; }
  await saveBackgroundJob(job); return job;
}

export async function resetBackgroundAutomationAction(jobId: string) {
  const user = await requireUser();
  const job = await readBackgroundJob(jobId).catch(() => null);
  if (!job || job.userId !== user.id || job.status === "running") return false;
  const files = await fs.readdir(JOB_DIR).catch(() => [] as string[]);
  for (const file of files) {
    const savedJob = await readBackgroundJob(file.replace(/\.json$/, "")).catch(() => null);
    if (savedJob?.userId === user.id && savedJob.status !== "running") {
      cancelledJobs.delete(savedJob.id);
      await fs.unlink(path.join(JOB_DIR, file)).catch(() => undefined);
    }
  }
  return true;
}

export async function getBackgroundAutomationAction(jobId?: string) {
  const user = await requireUser();
  if (jobId) { const job = await readBackgroundJob(jobId).catch(() => null); return job?.userId === user.id ? job : null; }
  const files = await fs.readdir(JOB_DIR).catch(() => [] as string[]); const jobs = await Promise.all(files.map((file) => readBackgroundJob(file.replace(/\.json$/, "")).catch(() => null)));
  return jobs.filter((job): job is BackgroundAutomationJob => Boolean(job && job.userId === user.id)).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
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
  return {
    websiteUrl: result.websiteUrl,
    resolvedUrl: details.resolvedUrl,
    discoveryReason: details.discoveryReason ?? null,
    targetType: details.targetType ?? null,
    status: result.status,
    errorMessage: result.errorMessage,
    screenshotPath: result.screenshotPath,
    screenshotPaths: result.screenshotPaths ?? (result.screenshotPath ? [result.screenshotPath] : []),
    selectedDate: result.selectedDate ?? null,
    selectedTime: result.selectedTime ?? null,
    filledFields: result.filledFields,
    skippedFields: result.skippedFields,
    submittedAt: result.submittedAt.toISOString()
  };
}

async function storeTransaction(userId: string, result: AutomationResult, liveSubmit: boolean) {
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

async function runSingleAutomationAction(
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

  const result =
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

  const serialized = serializeResult(result, {
      resolvedUrl: websiteUrl,
      discoveryReason,
      targetType
    });
  return { result: serialized };
}
