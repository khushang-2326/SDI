import type { BrowserContext } from "playwright";
import { acquireContext, releaseContext, markContextClosed, getContextMetadata } from "@/lib/browserPool";
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
const MAX_ATTEMPT_TIMEOUT_MS = 90_000;

function isCalendlyEventTarget(target: DiscoveredSubmissionTarget) {
  if (target.targetType !== "calendly") return true;
  try {
    const url = new URL(target.url);
    return url.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

function withAttemptTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  onTimeout?: () => void | Promise<void>
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(async () => {
      try {
        if (onTimeout) await onTimeout();
      } catch {
        // ignore
      }
      reject(new Error(`${label} exceeded attempt budget limit of ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
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
        timeoutMs: Math.min(timeoutMs, 10_000)
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
  const bookingResult = await submitGenericBookingWidget({
    websiteUrl: target.url,
    leadData,
    bookingPreferences,
    liveSubmit,
    browserContext,
    skipPersist: true,
    timeoutMs
  });

  if (
    bookingResult.status !== "success" &&
    bookingResult.status !== "dry_run_ready_to_book" &&
    (bookingResult.errorMessage?.includes("did not render") || bookingResult.status === "booking_widget_found")
  ) {
    try {
      const contactFallback = await submitContactForm({
        websiteUrl: target.url,
        leadData,
        submit: liveSubmit,
        browserContext,
        skipPersist: true,
        userId,
        timeoutMs: Math.min(timeoutMs, 10000)
      });
      if (contactFallback.status === "success" || contactFallback.status === "dry_run_ready_to_book") {
        return contactFallback;
      }
    } catch {
      // Fallback failed, return original booking result
    }
  }

  return bookingResult;
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
  const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[TARGET_LIFECYCLE:${executionId}] TARGET_STARTED url=${websiteUrl}`);

  const attempts: MultiTargetAttemptResult[] = [];
  let consecutiveFailures = 0;
  let targetSucceeded = false;
  let timedOut = false;
  let encounteredProxyFailure = false;
  const attemptedKeys = new Set<string>();

  let deadlineTimerActive = deadlineAt !== undefined;
      const deadlineTimer = deadlineAt === undefined
        ? undefined
        : setTimeout(() => {
            if (!deadlineTimerActive) return;
            deadlineTimerActive = false;
            timedOut = true;
            console.log(`[TARGET_LIFECYCLE:${executionId}] DEADLINE_FIRED url=${websiteUrl}`);
            // This context belongs exclusively to this website run.
            markContextClosed(browserContext, "deadline", "overall deadline budget exceeded");
            void browserContext.close().catch(() => undefined);
          }, Math.max(0, deadlineAt - Date.now()));

  if (deadlineAt !== undefined) {
    console.log(`[TARGET_LIFECYCLE:${executionId}] DEADLINE_STARTED url=${websiteUrl} budgetMs=${Math.max(0, deadlineAt - Date.now())}`);
  }

  const stopDeadlineTimer = () => {
    if (!deadlineTimerActive) return;
    deadlineTimerActive = false;
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
      console.log(`[TARGET_LIFECYCLE:${executionId}] DEADLINE_STOPPED url=${websiteUrl}`);
    }
  };
  const isSuccessful = (result: SubmitContactFormResult) =>
    ["success", "dry_run_ready_to_book"].includes(result.status);

  try {

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
      if (remainingMs <= 1000) break;
      const attemptBudgetMs = Math.max(5000, Math.min(MAX_ATTEMPT_TIMEOUT_MS, remainingMs));
      attemptedKeys.add(normalizedKey);
      const startedAt = new Date();
      await callbacks.onAttemptStarted?.(target);
      let result: SubmitContactFormResult;
      let recoveryContext: BrowserContext | null = null;
      let activeContext = browserContext;

      console.log(`[TARGET_LIFECYCLE:${executionId}] STAGE_STARTED stage=${target.targetType} url=${target.url}`);
      try {
        result = await withAttemptTimeout(
          executeTarget({
            target,
            leadData,
            bookingPreferences,
            liveSubmit,
            browserContext: activeContext,
            userId,
            timeoutMs: attemptBudgetMs
          }),
          attemptBudgetMs + 1000,
          `Target ${target.url}`
        );
        console.log(`[TARGET_LIFECYCLE:${executionId}] STAGE_COMPLETED stage=${target.targetType} url=${target.url} status=${result.status}`);
      } catch (error) {
        const errStr = error instanceof Error ? error.message : String(error);
        const isClosedError = /target page, context or browser has been closed|target closed|browser has been closed/i.test(errStr);
        const remainingForRecovery = deadlineAt !== undefined ? deadlineAt - Date.now() : timeoutMs;

        if (timedOut || (deadlineAt !== undefined && Date.now() >= deadlineAt)) {
          const timeoutReason = `Website automation exceeded overall deadline budget of ${Math.round(timeoutMs / 1000)}s.`;
          result = failedResult(target, new Error(timeoutReason));
        } else if (isClosedError && !recoveryContext && remainingForRecovery > 10000) {
          console.warn(`[BROWSER-RECOVERY] Browser context closed unexpectedly on ${target.url}. Re-acquiring context and retrying stage once...`);
          try {
            recoveryContext = await acquireContext({
              headless: headless ?? true,
              userId,
              disableProxy: isDirectRetry,
              startupTimeoutMs: 10000
            });
            activeContext = recoveryContext;
            result = await withAttemptTimeout(
              executeTarget({
                target,
                leadData,
                bookingPreferences,
                liveSubmit,
                browserContext: activeContext,
                userId,
                timeoutMs: Math.min(attemptBudgetMs, remainingForRecovery - 3000)
              }),
              attemptBudgetMs + 1000,
              `Recovered Target ${target.url}`
            );
            console.log(`[BROWSER-RECOVERY] Successfully recovered ${target.url} after browser context crash.`);
            console.log(`[TARGET_LIFECYCLE:${executionId}] STAGE_COMPLETED stage=${target.targetType} url=${target.url} status=${result.status}`);
          } catch (recoveryErr) {
            console.warn(`[BROWSER-RECOVERY] Recovery attempt failed on ${target.url}:`, recoveryErr);
            result = failedResult(target, recoveryErr);
          }
        } else {
          if (isProxyAuthenticationFailure(error)) {
            encounteredProxyFailure = true;
          }
          result = failedResult(target, error);
        }
      } finally {
        if (recoveryContext) {
          await releaseContext(recoveryContext).catch(() => undefined);
        }
      }

      const ctxMeta = getContextMetadata(activeContext);
      if (
        result.status === "failed" &&
        (timedOut || ctxMeta?.closeInitiator === "deadline" || (deadlineAt !== undefined && Date.now() >= deadlineAt))
      ) {
        result.errorMessage = `Website automation exceeded overall deadline budget of ${Math.round(timeoutMs / 1000)}s.`;
      }

      const errLower = (result.errorMessage || "").toLowerCase();
      if (isProxyAuthenticationFailure(result.errorMessage)) {
        encounteredProxyFailure = true;
      } else if (!isDirectRetry && (errLower.includes("403") || errLower.includes("forbidden")) && !errLower.includes("turnstile") && !errLower.includes("challenge") && !errLower.includes("robot challenge")) {
        // Legitimate datacenter proxy IP block: server rejected proxy, allow direct connection retry
        console.log(`[PROXY-FALLBACK] Legitimate HTTP 403 detected on ${target.url}. Triggering direct connection fallback...`);
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

  async function triggerDirectRetry(_reasonForRetry: string): Promise<MultiTargetRunResult> {
    stopDeadlineTimer();
    const remainingDirectMs = deadlineAt !== undefined ? deadlineAt - Date.now() : timeoutMs;
    if (remainingDirectMs <= 5000) {
      return {
        discoveryReason: "Proxy fallback skipped: insufficient remaining time budget.",
        checkedUrls: [websiteUrl],
        targets: [],
        attempts
      };
    }
    let directContext: BrowserContext | null = null;
    try {
      directContext = await acquireContext({
        headless: headless ?? true,
        userId,
        disableProxy: true,
        bandwidthSaver: false,
        startupTimeoutMs: Math.min(10_000, remainingDirectMs)
      });
      const directRun = await runMultiTargetAutomation({
        websiteUrl,
        leadData,
        bookingPreferences,
        liveSubmit,
        browserContext: directContext,
        timeoutMs: Math.min(MAX_ATTEMPT_TIMEOUT_MS, remainingDirectMs),
        cachedTargets,
        callbacks,
        userId,
        deadlineAt: deadlineAt, // strictly adhere to the overall target deadline!
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

  const discoveryBudgetMs = Math.max(5000, Math.min(20_000, Math.floor(discoveryRemainingMs * 0.50)));

  let discovery: DiscoverSubmissionTargetsResult;
  try {
    discovery = await discoverSubmissionTargets({
      websiteUrl,
      timeoutMs: discoveryBudgetMs,
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
  } finally {
    stopDeadlineTimer();
    console.log(`[TARGET_LIFECYCLE:${executionId}] TARGET_COMPLETED url=${websiteUrl} attempts=${attempts.length} success=${targetSucceeded}`);
  }
}
