import type { BrowserContext } from "playwright";
import { submitCalendlyBooking } from "@/services/calendly-booking-automation";
import { submitContactForm } from "@/services/contact-form-automation";
import { submitGenericBookingWidget } from "@/services/generic-booking-widget-automation";
import { submitHubSpotBooking } from "@/services/hubspot-booking-automation";
import { discoverSubmissionTargets } from "@/services/submission-target-discovery";
import type {
  BookingPreferences,
  DiscoveredSubmissionTarget,
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
  return {
    websiteUrl: target.url,
    status: "failed",
    errorMessage: error instanceof Error ? error.message : "Unknown target automation error.",
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
    return submitContactForm({
      websiteUrl: target.url,
      leadData,
      submit: liveSubmit,
      browserContext,
      skipPersist: true,
      userId,
      timeoutMs
    });
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
  deadlineAt
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
}): Promise<MultiTargetRunResult> {
  const attempts: MultiTargetAttemptResult[] = [];
  let consecutiveFailures = 0;
  let targetSucceeded = false;
  let timedOut = false;
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
        attempts.length >= MAX_TARGET_ATTEMPTS_PER_WEBSITE ||
        consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ||
        timedOut || (deadlineAt !== undefined && Date.now() >= deadlineAt)
      ) break;
      const key = `${target.targetType}:${target.url}`;
      if (attemptedKeys.has(key)) continue;
      const remainingMs = deadlineAt === undefined ? timeoutMs : deadlineAt - Date.now();
      if (remainingMs <= 0) break;
      attemptedKeys.add(key);
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
        result = failedResult(target, error);
      }
      const attempt = { target, result, startedAt, completedAt: new Date() };
      attempts.push(attempt);
      consecutiveFailures = isSuccessful(result) ? 0 : consecutiveFailures + 1;
      await callbacks.onAttemptFinished?.(attempt);
      if (isSuccessful(result)) {
        targetSucceeded = true;
        break;
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

  const discovery = await discoverSubmissionTargets({
    websiteUrl,
    timeoutMs: Math.max(1000, Math.min(timeoutMs, discoveryRemainingMs)),
    browserContext,
    maxNavigationLinks: 6,
    maxFallbackPaths: 3
  });
  await callbacks.onTargetsDiscovered?.(discovery.targets, discovery.reason);
  const discoveredContactTargets = discovery.targets.filter(
    (target) => target.targetType === "contact_form"
  );
  const bookingFallbackTargets = [...orderedCachedTargets, ...discovery.targets]
    .filter((target) => target.targetType !== "contact_form")
    .sort((a, b) => a.executionOrder - b.executionOrder || b.confidence - a.confidence);
  await executeTargets(discoveredContactTargets);
  if (!targetSucceeded) await executeTargets(bookingFallbackTargets);

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
        : discovery.reason,
    checkedUrls: Array.from(new Set([
      ...orderedCachedTargets.map((target) => target.url),
      ...discovery.checkedUrls
    ])),
    targets,
    attempts
  };
}
