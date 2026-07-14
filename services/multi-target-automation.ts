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
  browserContext
}: {
  target: DiscoveredSubmissionTarget;
  leadData: LeadData;
  bookingPreferences: BookingPreferences;
  liveSubmit: boolean;
  browserContext: BrowserContext;
}) {
  if (target.targetType === "calendly") {
    return submitCalendlyBooking({
      websiteUrl: target.url,
      leadData,
      bookingPreferences,
      liveSubmit,
      browserContext,
      skipPersist: true
    });
  }
  if (target.targetType === "contact_form") {
    return submitContactForm({
      websiteUrl: target.url,
      leadData,
      submit: liveSubmit,
      browserContext,
      skipPersist: true
    });
  }
  if (target.targetType === "hubspot_booking") {
    return submitHubSpotBooking({
      websiteUrl: target.url,
      leadData,
      bookingPreferences,
      liveSubmit,
      browserContext,
      skipPersist: true
    });
  }
  return submitGenericBookingWidget({
    websiteUrl: target.url,
    leadData,
    bookingPreferences,
    liveSubmit,
    browserContext,
    skipPersist: true
  });
}

export async function runMultiTargetAutomation({
  websiteUrl,
  leadData,
  bookingPreferences,
  liveSubmit,
  browserContext,
  timeoutMs,
  callbacks = {}
}: {
  websiteUrl: string;
  leadData: LeadData;
  bookingPreferences: BookingPreferences;
  liveSubmit: boolean;
  browserContext: BrowserContext;
  timeoutMs: number;
  callbacks?: MultiTargetCallbacks;
}): Promise<MultiTargetRunResult> {
  const discovery = await discoverSubmissionTargets({
    websiteUrl,
    timeoutMs,
    browserContext,
    maxNavigationLinks: 12,
    maxFallbackPaths: 6
  });
  await callbacks.onTargetsDiscovered?.(discovery.targets, discovery.reason);

  const attempts: MultiTargetAttemptResult[] = [];
  for (const target of discovery.targets) {
    const startedAt = new Date();
    await callbacks.onAttemptStarted?.(target);
    let result: SubmitContactFormResult;
    try {
      result = await executeTarget({ target, leadData, bookingPreferences, liveSubmit, browserContext });
    } catch (error) {
      result = failedResult(target, error);
    }
    const attempt = { target, result, startedAt, completedAt: new Date() };
    attempts.push(attempt);
    await callbacks.onAttemptFinished?.(attempt);
  }

  return {
    discoveryReason: discovery.reason,
    checkedUrls: discovery.checkedUrls,
    targets: discovery.targets,
    attempts
  };
}
