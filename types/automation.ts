export type LeadData = {
  fullName: string;
  email: string;
  mobile?: string;
  mobileNumber?: string;
  address?: string;
  message?: string;
  companyName?: string;
};

export type StageTimingMetrics = {
  navigationMs: number;
  readinessMs: number;
  discoveryMs?: number;
  formLoadingMs?: number;
  fieldDetectionMs?: number;
  fieldFillingMs?: number;
  submitDiscoveryMs?: number;
  totalMs: number;
};

export type AuthoritativeClassification =
  | "SUCCESS"
  | "CAPTCHA"
  | "HUMAN_VERIFICATION"
  | "HTTP_403"
  | "DNS_NETWORK"
  | "GENUINE_NO_FORM"
  | "ZERO_CALENDAR_INVENTORY"
  | "EXPIRED_INVALID_BOOKING_URL"
  | "NAVIGATION_TIMEOUT"
  | "PAGE_READY_TIMEOUT"
  | "AUTOMATION_FAILURE"
  | "OTHER";

export type AuthoritativeTaxonomyCategory =
  | "SUCCESS_CONTACT_FORM"
  | "SUCCESS_BOOKING_WIDGET"
  | "INELIGIBLE_CAPTCHA_HUMAN_VERIFICATION"
  | "INELIGIBLE_WAF_BLOCKED"
  | "INELIGIBLE_GENUINE_NO_PUBLIC_FORM"
  | "INELIGIBLE_ZERO_CALENDAR_INVENTORY"
  | "INELIGIBLE_INVALID_OR_EXPIRED_INPUT_URL"
  | "FAILURE_CONTACT_DESTINATION_NOT_FOUND"
  | "FAILURE_FORM_NOT_DETECTED"
  | "FAILURE_FORM_FIELD_MAPPING"
  | "FAILURE_REQUIRED_FIELD"
  | "FAILURE_SUBMIT_CONTROL"
  | "FAILURE_BOOKING_WIDGET"
  | "FAILURE_NAVIGATION_TIMEOUT"
  | "FAILURE_PAGE_READINESS"
  | "FAILURE_BROWSER"
  | "FAILURE_OTHER";

export type SubmitContactFormInput = {
  websiteUrl: string;
  leadData: LeadData;
  headless?: boolean;
  submit?: boolean;
  timeoutMs?: number;
};

export type SubmitContactFormResult = {
  websiteUrl: string;
  status:
    | "success"
    | "failed"
    | "booking_widget_found"
    | "dry_run_ready_to_book"
    | "no_available_slots"
    | "iframe_not_accessible"
    | "confirmation_not_found";
  errorMessage: string | null;
  message?: string | null;
  screenshotPath: string | null;
  submittedAt: Date;
  filledFields: string[];
  skippedFields: string[];
  bookingWidgetReason?: string | null;
  screenshotPaths?: string[];
  selectedDate?: string | null;
  selectedTime?: string | null;
  fieldsDetectedCount?: number;
  fieldsClassifiedCount?: number;
  filledFieldsCount?: number;
  verifiedFieldsCount?: number;
  unmappedRequiredFields?: string[];
  unmappedOptionalFields?: string[];
  fieldVerificationItems?: Array<{
    fieldIndex: number;
    fieldType: string;
    mappedSource: string;
    confidence: number;
    evidence: string[];
    filled: boolean;
    verified: boolean;
    finalValue?: string;
  }>;
  stageTiming?: StageTimingMetrics;
  submitCandidateCount?: number;
  rejectedCandidateCount?: number;
  selectedCandidateInfo?: {
    tagName: string;
    type?: string;
    text: string;
    score: number;
  } | null;
  bookingProvider?: string | null;
  bookingContainerDetected?: boolean;
  bookingState?: "BOOKING_PROVIDER_FOUND" | "BOOKING_CONTAINER_MOUNTING" | "BOOKING_READY" | "BOOKING_NO_INVENTORY" | "BOOKING_BLOCKED" | "BOOKING_FAILED";
  interactiveCalendarDetected?: boolean;
  availableSlotState?: "available" | "none" | "unmounted" | "blocked";
  requiredInteractionState?: "ready" | "pending" | "failed";
};

export type SuccessInvariantContactProof = {
  inputTargetId: number;
  inputRootUrl: string;
  inputHostname: string;
  finalTargetUrl: string;
  targetType: "contact_form";
  fieldsDetected: number;
  fieldsClassified: number;
  fieldsFilled: number;
  fieldsVerified: number;
  requiredFieldsCount: number;
  unmappedRequiredFields: string[];
  submitControlFound: boolean;
  submitControlScore: number;
  successInvariantPassed: boolean;
  finalStatus: string;
};

export type SuccessInvariantBookingProof = {
  inputTargetId: number;
  inputRootUrl: string;
  inputHostname: string;
  providerHostname: string;
  providerUrl?: string;
  finalTargetUrl: string;
  targetType: "booking_widget" | "calendly" | "hubspot_booking";
  bookingProvider: string;
  bookingContainerDetected: boolean;
  bookingState: "BOOKING_PROVIDER_FOUND" | "BOOKING_CONTAINER_MOUNTING" | "BOOKING_READY" | "BOOKING_NO_INVENTORY" | "BOOKING_BLOCKED" | "BOOKING_FAILED";
  interactiveCalendarDetected: boolean;
  availableSlotState: string;
  requiredInteractionState: string;
  successInvariantPassed: boolean;
  finalStatus: string;
};

export type AdaptiveNavigationMetrics = {
  domContentLoaded?: number;
  firstInteractive?: number;
  hydrationReady?: number;
  candidateDiscoveryStart?: number;
  candidateDiscoveryEnd?: number;
  totalNavigationTime?: number;
};

export type BrowserLifecycleDiagnostic = {
  targetId: string | number;
  workerId?: string;
  contextId: string;
  pageId?: string;
  stage?: string;
  closeInitiator?: "deadline" | "cleanup" | "manual" | "crash" | "unknown";
  closeReason?: string;
};

export type BookingPreferences = {
  preferredDate?: string;
  preferredTime?: string;
  timezone?: string;
  fallbackToFirstAvailableSlot?: boolean;
};

export type SubmitCalendlyBookingInput = {
  websiteUrl: string;
  leadData: LeadData;
  bookingPreferences?: BookingPreferences;
  liveSubmit?: boolean;
  headless?: boolean;
  timeoutMs?: number;
};

export type SubmissionTargetType =
  | "calendly"
  | "hubspot_booking"
  | "booking_widget"
  | "contact_form"
  | "not_found";

export type DiscoverSubmissionTargetInput = {
  websiteUrl: string;
  headless?: boolean;
  timeoutMs?: number;
  maxNavigationLinks?: number;
  maxFallbackPaths?: number;
};

export type DiscoverSubmissionTargetResult = {
  websiteUrl: string;
  discoveredUrl: string | null;
  targetType: SubmissionTargetType;
  confidence: number;
  reason: string;
  checkedUrls: string[];
  screenshotPath: string | null;
};

export type DiscoveredSubmissionTarget = {
  targetType: Exclude<SubmissionTargetType, "not_found">;
  url: string;
  executionOrder: number;
  confidence: number;
  reason: string;
  screenshotPath: string | null;
  metadata?: Record<string, unknown>;
};

export type DiscoverSubmissionTargetsResult = {
  websiteUrl: string;
  targets: DiscoveredSubmissionTarget[];
  checkedUrls: string[];
  reason: string;
  screenshotPath: string | null;
};

