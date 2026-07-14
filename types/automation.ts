export type LeadData = {
  fullName: string;
  email: string;
  mobile?: string;
  mobileNumber?: string;
  address?: string;
  message?: string;
  companyName?: string;
};

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
  screenshotPath: string | null;
  submittedAt: Date;
  filledFields: string[];
  skippedFields: string[];
  bookingWidgetReason?: string | null;
  screenshotPaths?: string[];
  selectedDate?: string | null;
  selectedTime?: string | null;
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
