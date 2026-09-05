import type { BrowserContext } from "playwright";
import { acquireContext, releaseContext } from "@/lib/browserPool";
import { submitCalendlyBooking } from "@/services/calendly-booking-automation";
import { submitContactForm } from "@/services/contact-form-automation";
import { submitGenericBookingWidget } from "@/services/generic-booking-widget-automation";
import { submitHubSpotBooking } from "@/services/hubspot-booking-automation";
import { discoverSubmissionTargets } from "@/services/submission-target-discovery";
import {
  isProxyAuthenticationFailure,
  ProxyAuthenticationError,
  PROXY_407_MESSAGE,
  redactProxyDetails
} from "@/services/proxy-helper";
import type {
  BookingPreferences,
  DiscoveredSubmissionTarget,
  DiscoverSubmissionTargetsResult,
  LeadData,
  SubmitContactFormResult
} from "@/types/automation";

export type MultiTargetAttemptResult = {
  target: DiscoveredSubmissionTarget;
  result: SubmitContactFormResult;
  startedAt: Date;
  completedAt: Date;
};

export type MultiTargetRunResult = {
  discoveryReason: string;
  checkedUrls: string[];
  targets: DiscoveredSubmissionTarget[];
  attempts: MultiTargetAttemptResult[];
};

export type MultiTargetCallbacks = {
  onTargetsDiscovered?: (targets: DiscoveredSubmissionTarget[], reason: string) => Promise<void>;
  onAttemptStarted?: (target: DiscoveredSubmissionTarget) => Promise<void>;
  onAttemptFinished?: (attempt: MultiTargetAttemptResult) => Promise<void>;
};

const MAX_TARGET_ATTEMPTS_PER_WEBSITE = 5;
const MAX_CONSECUTIVE_FAILURES = 3;

function isCalendlyEventTarget(target: DiscoveredSubmissionTarget) {
  if (target.targetType !== "calendly") return true;
  try {
    const url = new URL(target.url);
    return url.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

function failedResult(target: DiscoveredSubmissionTarget, error: unknown): SubmitContactFormResult {
  const isProxy = isProxyAuthenticationFailure(error);
  const rawMessage = isProxy
    ? PROXY_407_MESSAGE
    : error instanceof Error
      ? error.message
      : "Unknown target automation error.";
  return {
    websiteUrl: target.url,
    status: "failed",
    errorMessage: redactProxyDetails(rawMessage),
    screenshotPath: target.screenshotPath,
    screenshotPaths: target.screenshotPath ? [target.screenshotPath] : [],
    submittedAt: new Date(),
    filledFields: [],
    skippedFields: []
  };
}

async function executeTarget({
  target,
  leadData,
  bookingPreferences,
  liveSubmit,
  browserContext,
  userId,
  timeoutMs
}: {
  target: DiscoveredSubmissionTarget;
  leadData: LeadData;
  bookingPreferences: BookingPreferences;
  liveSubmit: boolean;
  browserContext: BrowserContext;
  userId?: string;
  timeoutMs: number;
}) {
  if (target.targetType === "calendly") {
    return submitCalendlyBooking({
      websiteUrl: target.url,
      leadData,
      bookingPreferences,
      liveSubmit,
      browserContext,
      skipPersist: true,
      timeoutMs
    });
  }
  if (target.targetType === "contact_form") {
    const contactResult = await submitContactForm({
      websiteUrl: target.url,
      leadData,
      submit: liveSubmit,
      browserContext,
      skipPersist: true,
      userId,
      timeoutMs
    });
    // A URL can be labelled "contact" while rendering an inline booking
    // scheduler. Continue through the generic scheduler rather than treating
    // the detection result itself as a failed target.
    if (contactResult.status === "booking_widget_found") {
      return submitGenericBookingWidget({
        websiteUrl: target.url,
        leadData,
        bookingPreferences,
        liveSubmit,
        browserContext,
        skipPersist: true,
        timeoutMs
      });
    }
    return contactResult;
  }
  if (target.targetType === "hubspot_booking") {
    return submitHubSpotBooking({
      websiteUrl: target.url,
      leadData,
      bookingPreferences,
      liveSubmit,
      browserContext,
      skipPersist: true,
      timeoutMs
    });
  }
  return submitGenericBookingWidget({
    websiteUrl: target.url,
    leadData,
    bookingPreferences,
    liveSubmit,
    browserContext,
    skipPersist: true,
    timeoutMs
  });
}

export async function runMultiTargetAutomation({
  websiteUrl,
  leadData,
  bookingPreferences,
  liveSubmit,
  browserContext,
  timeoutMs,
  cachedTargets = [],
  callbacks = {},
  userId,
  deadlineAt,
  headless = true,
  isDirectRetry = false
}: {
  websiteUrl: string;
  leadData: LeadData;
  bookingPreferences: BookingPreferences;
  liveSubmit: boolean;
  browserContext: BrowserContext;
  timeoutMs: number;
  cachedTargets?: DiscoveredSubmissionTarget[];
  callbacks?: MultiTargetCallbacks;
  userId?: string;
  deadlineAt?: number;
  headless?: boolean;
  isDirectRetry?: boolean;
}): Promise<MultiTargetRunResult> {
  const attempts: MultiTargetAttemptResult[] = [];
  let consecutiveFailures = 0;
  let targetSucceeded = false;
  let timedOut = false;
  let encounteredProxyFailure = false;
  const attemptedKeys = new Set<string>();
  const deadlineTimer = deadlineAt === undefined
    ? undefined
    : setTimeout(() => {
        timedOut = true;
        // This context belongs to the current website run. Closing it is the
        // only reliable way to interrupt Playwright waits at the deadline.
        void browserContext.close().catch(() => undefined);
      }, Math.max(0, deadlineAt - Date.now()));
  const stopDeadlineTimer = () => {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  };
  const isSuccessful = (result: SubmitContactFormResult) =>
    ["success", "dry_run_ready_to_book"].includes(result.status);

  async function executeTargets(targets: DiscoveredSubmissionTarget[]) {
    for (const target of targets) {
      if (
        targetSucceeded ||
        encounteredProxyFailure ||
        attempts.length >= MAX_TARGET_ATTEMPTS_PER_WEBSITE ||
        consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ||
        timedOut || (deadlineAt !== undefined && Date.now() >= deadlineAt)
      ) break;
      let normalizedKey = `${target.targetType}:${target.url}`;
      try {
        const u = new URL(target.url);
        u.hash = "";
        const cleanPath = u.pathname.replace(/\/+$/, "");
        normalizedKey = `${target.targetType}:${u.origin}${cleanPath}`;
      } catch {
        // fallback to raw
      }
      if (attemptedKeys.has(normalizedKey)) continue;
      const remainingMs = deadlineAt === undefined ? timeoutMs : deadlineAt - Date.now();
      if (remainingMs <= 0) break;
      attemptedKeys.add(normalizedKey);
      const startedAt = new Date();
      await callbacks.onAttemptStarted?.(target);
      let result: SubmitContactFormResult;
      try {
        result = await executeTarget({
          target,
          leadData,
          bookingPreferences,
          liveSubmit,
          browserContext,
          userId,
          timeoutMs: Math.max(1000, Math.min(timeoutMs, remainingMs))
        });
      } catch (error) {
        if (isProxyAuthenticationFailure(error)) {
          encounteredProxyFailure = true;
        }
        result = failedResult(target, error);
      }
      if (isProxyAuthenticationFailure(result.errorMessage)) {
        encounteredProxyFailure = true;
      }
      if (result.websiteUrl) {
        try {
          const ru = new URL(result.websiteUrl);
          ru.hash = "";
          attemptedKeys.add(`${target.targetType}:${ru.origin}${ru.pathname.replace(/\/+$/, "")}`);
        } catch {
          // ignore
        }
      }
      const attempt = { target, result, startedAt, completedAt: new Date() };
      attempts.push(attempt);
      consecutiveFailures = isSuccessful(result) ? 0 : consecutiveFailures + 1;
      await callbacks.onAttemptFinished?.(attempt);
      if (isSuccessful(result)) {
        targetSucceeded = true;
        break;
      }
      if (encounteredProxyFailure) break;
    }
  }

  // Helper to run the 1-shot direct retry when proxy 407 / gateway failure happens
  async function triggerDirectRetry(_reasonForRetry: string): Promise<MultiTargetRunResult> {
    stopDeadlineTimer();
    let directContext: BrowserContext | null = null;
    try {
      directContext = await acquireContext({
        headless: headless ?? true,
        userId,
        disableProxy: true,
        bandwidthSaver: false,
        startupTimeoutMs: Math.min(20_000, timeoutMs)
      });
      const directRun = await runMultiTargetAutomation({
        websiteUrl,
        leadData,
        bookingPreferences,
        liveSubmit,
        browserContext: directContext,
        timeoutMs,
        cachedTargets,
        callbacks,
        userId,
        deadlineAt: deadlineAt !== undefined ? Math.max(Date.now() + 15000, deadlineAt) : undefined,
        headless,
        isDirectRetry: true
      });
      const directHasSuccess = directRun.attempts.some((a) => isSuccessful(a.result));
      if (directHasSuccess) {
        directRun.discoveryReason = [
          "Proxy fallback: resolved via direct connection",
          directRun.discoveryReason
        ].filter(Boolean).join("; ");
      }
      return directRun;
    } finally {
      if (directContext) {
        await releaseContext(directContext).catch(() => undefined);
      }
    }
  }

  const orderedCachedTargets = cachedTargets.filter(isCalendlyEventTarget).sort(
    (a, b) => a.executionOrder - b.executionOrder || b.confidence - a.confidence
  );
  if (orderedCachedTargets.length > 0) {
    await callbacks.onTargetsDiscovered?.(orderedCachedTargets, "Using cached submission targets.");
    const cachedContactTargets = orderedCachedTargets.filter(
      (target) => target.targetType === "contact_form"
    );
    await executeTargets(cachedContactTargets);
    if (encounteredProxyFailure && !isDirectRetry) {
      return triggerDirectRetry("Cached target encountered proxy authentication failure.");
    }
    if (targetSucceeded) {
      stopDeadlineTimer();
      return {
        discoveryReason: "A cached normal contact form succeeded; booking targets were skipped.",
        checkedUrls: cachedContactTargets.map((target) => target.url),
        targets: orderedCachedTargets,
        attempts
      };
    }
    consecutiveFailures = 0;
  }

  const discoveryRemainingMs = deadlineAt === undefined ? timeoutMs : deadlineAt - Date.now();
  if (timedOut || discoveryRemainingMs <= 0) {
    stopDeadlineTimer();
    return {
      discoveryReason: "Website automation exceeded its time limit before target discovery completed.",
      checkedUrls: orderedCachedTargets.map((target) => target.url),
      targets: orderedCachedTargets,
      attempts
    };
  }

  let discovery: DiscoverSubmissionTargetsResult;
  try {
    discovery = await discoverSubmissionTargets({
      websiteUrl,
      timeoutMs: Math.max(1000, Math.min(timeoutMs, discoveryRemainingMs)),
      browserContext,
      maxNavigationLinks: 6,
      maxFallbackPaths: 3
    });
    if (isProxyAuthenticationFailure(discovery.reason)) {
      encounteredProxyFailure = true;
    }
  } catch (discoveryErr) {
    if (isProxyAuthenticationFailure(discoveryErr)) {
      encounteredProxyFailure = true;
    }
    discovery = {
      websiteUrl,
      targets: [],
      checkedUrls: [websiteUrl],
      reason: isProxyAuthenticationFailure(discoveryErr)
        ? PROXY_407_MESSAGE
        : redactProxyDetails(discoveryErr instanceof Error ? discoveryErr.message : "Target discovery failed"),
      screenshotPath: null
    };
  }

  if (encounteredProxyFailure && !isDirectRetry) {
    return triggerDirectRetry(discovery.reason);
  }

  await callbacks.onTargetsDiscovered?.(discovery.targets, discovery.reason);
  const discoveredContactTargets = discovery.targets.filter(
    (target) => target.targetType === "contact_form"
  );
  const bookingFallbackTargets = [...orderedCachedTargets, ...discovery.targets]
    .filter((target) => target.targetType !== "contact_form")
    .sort((a, b) => a.executionOrder - b.executionOrder || b.confidence - a.confidence);
  await executeTargets(discoveredContactTargets);
  if (encounteredProxyFailure && !isDirectRetry) {
    return triggerDirectRetry("Target execution encountered proxy authentication failure.");
  }
  if (!targetSucceeded && !encounteredProxyFailure) {
    await executeTargets(bookingFallbackTargets);
    if (encounteredProxyFailure && !isDirectRetry) {
      return triggerDirectRetry("Target execution encountered proxy authentication failure.");
    }
  }

  const targets = Array.from(
    new Map(
      [...orderedCachedTargets, ...discovery.targets].map((target) => [
        `${target.targetType}:${target.url}`,
        target
      ])
    ).values()
  ).sort((a, b) => a.executionOrder - b.executionOrder || b.confidence - a.confidence);

  stopDeadlineTimer();
  return {
    discoveryReason: targetSucceeded
      ? `${discovery.reason} The first successful target was used and remaining targets were skipped.`
      : timedOut
        ? "Website automation exceeded its time limit."
        : redactProxyDetails(discovery.reason),
    checkedUrls: Array.from(new Set([
      ...orderedCachedTargets.map((target) => target.url),
      ...discovery.checkedUrls
    ])),
    targets,
    attempts
  };
}
