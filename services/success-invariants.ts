import { AuthoritativeTaxonomyCategory } from "../types/automation";

export interface SuccessInvariantInput {
  targetType: "contact_form" | "booking_widget" | "calendly" | "hubspot_booking" | "not_found" | "error";
  status: string;
  errorMessage?: string | null;
  discoveryReason?: string | null;
  fieldsDetected: number;
  fieldsClassified: number;
  fieldsFilled: number;
  fieldsVerified: number;
  unmappedRequiredFields: string[];
  submitControlFound: boolean;
  submitControlScore: number;
  bookingStateConfirmed?: boolean;
  bookingProvider?: string | null;
  bookingContainerDetected?: boolean;
  bookingState?: string | null;
  interactiveCalendarDetected?: boolean;
  availableSlotState?: "available" | "none" | "unmounted" | "blocked";
  requiredInteractionState?: "ready" | "pending" | "failed";
  closeInitiator?: "deadline" | "cleanup" | "manual" | "crash" | "unknown";
  closeReason?: string;
  isDeadlineTimeout?: boolean;
  securityGateDetected?: string | null;
  httpStatus?: number | null;
  isOperatingHoursOnly?: boolean;
}

export interface SuccessInvariantResult {
  isSuccess: boolean;
  isEligible: boolean;
  taxonomyCategory: AuthoritativeTaxonomyCategory;
  failureReason: string | null;
  diagnostics: {
    passedChecks: string[];
    failedChecks: string[];
  };
}

export const MIN_VALID_SUBMIT_SCORE = 20;

export function evaluateFinalAutomationSuccess(input: SuccessInvariantInput): SuccessInvariantResult {
  const passedChecks: string[] = [];
  const failedChecks: string[] = [];
  const combinedError = `${input.errorMessage || ""} ${input.discoveryReason || ""}`.toLowerCase();

  // 1. Check Security Gates (CAPTCHA / Human Verification)
  if (
    input.securityGateDetected ||
    combinedError.includes("captcha") ||
    combinedError.includes("turnstile") ||
    combinedError.includes("recaptcha") ||
    combinedError.includes("hcaptcha") ||
    combinedError.includes("friendly captcha") ||
    combinedError.includes("mtcaptcha") ||
    combinedError.includes("human verification") ||
    combinedError.includes("robot challenge")
  ) {
    failedChecks.push("Security challenge / CAPTCHA detected");
    return {
      isSuccess: false,
      isEligible: false,
      taxonomyCategory: "INELIGIBLE_CAPTCHA_HUMAN_VERIFICATION",
      failureReason: input.securityGateDetected || input.errorMessage || "CAPTCHA or human verification challenge encountered",
      diagnostics: { passedChecks, failedChecks }
    };
  }

  // 2. Check WAF / HTTP 403
  if (
    input.httpStatus === 403 ||
    combinedError.includes("403") ||
    combinedError.includes("forbidden") ||
    combinedError.includes("waf") ||
    combinedError.includes("access denied") ||
    combinedError.includes("blocked access")
  ) {
    failedChecks.push("HTTP 403 / Edge WAF block detected");
    return {
      isSuccess: false,
      isEligible: false,
      taxonomyCategory: "INELIGIBLE_WAF_BLOCKED",
      failureReason: input.errorMessage || "Edge HTTP 403 Forbidden or WAF access denial",
      diagnostics: { passedChecks, failedChecks }
    };
  }

  // 3. Operating Hours False Positive
  if (input.isOperatingHoursOnly || combinedError.includes("operating hours") || combinedError.includes("business hours only")) {
    failedChecks.push("Operating hours footer link is not a booking scheduler");
    return {
      isSuccess: false,
      isEligible: false,
      taxonomyCategory: "INELIGIBLE_GENUINE_NO_PUBLIC_FORM",
      failureReason: "Operating hours text is not an actionable booking mechanism",
      diagnostics: { passedChecks, failedChecks }
    };
  }

  // 4. Zero Calendar Inventory (Requires mounted booking container/calendar; unmounted is an automation failure)
  const isZeroSlotError = (
    combinedError.includes("no available slots") ||
    combinedError.includes("zero available") ||
    combinedError.includes("no time slots") ||
    combinedError.includes("zero_calendar_inventory") ||
    input.availableSlotState === "none"
  );
  if (isZeroSlotError) {
    const isUnmounted = (
      input.bookingContainerDetected === false ||
      combinedError.includes("did not render") ||
      combinedError.includes("not found") ||
      combinedError.includes("not accessible") ||
      input.bookingState === "BOOKING_CONTAINER_MOUNTING" ||
      input.bookingState === "BOOKING_FAILED"
    );
    if (!isUnmounted && (input.bookingContainerDetected || input.interactiveCalendarDetected || input.bookingState === "BOOKING_NO_INVENTORY")) {
      failedChecks.push("Scheduler container mounted but host calendar has 0 available slots");
      return {
        isSuccess: false,
        isEligible: false,
        taxonomyCategory: "INELIGIBLE_ZERO_CALENDAR_INVENTORY",
        failureReason: "Booking widget loaded but host calendar has zero available slots",
        diagnostics: { passedChecks, failedChecks }
      };
    }
    // If container failed to mount or render, it is a genuine automation failure, NOT ineligible
    failedChecks.push("Booking widget was detected but container failed to mount or render interactive slots");
    return {
      isSuccess: false,
      isEligible: true,
      taxonomyCategory: "FAILURE_BOOKING_WIDGET",
      failureReason: input.errorMessage || "Booking widget was detected but container failed to mount or render interactive slots",
      diagnostics: { passedChecks, failedChecks }
    };
  }

  // 5. Expired / Invalid Booking URL
  if (combinedError.includes("expired") || combinedError.includes("stale month") || combinedError.includes("invalid booking url")) {
    failedChecks.push("User booking URL is expired or invalid");
    return {
      isSuccess: false,
      isEligible: false,
      taxonomyCategory: "INELIGIBLE_INVALID_OR_EXPIRED_INPUT_URL",
      failureReason: "User-provided booking URL is expired or invalid",
      diagnostics: { passedChecks, failedChecks }
    };
  }

  // 6. Genuine No Public Form
  if (
    combinedError.includes("mailto:") ||
    combinedError.includes("tel:") ||
    combinedError.includes("genuine no web form") ||
    combinedError.includes("client portal only") ||
    combinedError.includes("phone-only")
  ) {
    failedChecks.push("Positive proof of phone/email-only contact or client portal login");
    return {
      isSuccess: false,
      isEligible: false,
      taxonomyCategory: "INELIGIBLE_GENUINE_NO_PUBLIC_FORM",
      failureReason: input.errorMessage || "Positive evidence of direct phone/email or client portal only",
      diagnostics: { passedChecks, failedChecks }
    };
  }

  // 7. Deadline Timeouts (Must take precedence over generic closed-context messages)
  const isDeadlineFired = (
    input.closeInitiator === "deadline" ||
    input.isDeadlineTimeout ||
    combinedError.includes("exceeded overall deadline budget") ||
    combinedError.includes("overall deadline budget") ||
    combinedError.includes("deadline budget") ||
    combinedError.includes("exceeded attempt budget")
  );
  if (isDeadlineFired) {
    failedChecks.push("Automation exceeded overall deadline budget");
    return {
      isSuccess: false,
      isEligible: true,
      taxonomyCategory: "FAILURE_NAVIGATION_TIMEOUT",
      failureReason: input.errorMessage || "Target execution exceeded overall deadline budget",
      diagnostics: { passedChecks, failedChecks }
    };
  }

  // 8. Genuine Context / Browser Failures (Process crash, disconnect, not deadline closure)
  if (
    input.closeInitiator === "crash" ||
    combinedError.includes("browser has disconnected") ||
    combinedError.includes("crash") ||
    (
      (combinedError.includes("target page, context or browser has been closed") ||
       combinedError.includes("browser context was closed") ||
       combinedError.includes("context closed") ||
       combinedError.includes("session closed")) &&
      input.closeInitiator !== "cleanup" &&
      input.closeInitiator !== "deadline"
    )
  ) {
    failedChecks.push("Browser process or context crashed unexpectedly");
    return {
      isSuccess: false,
      isEligible: true,
      taxonomyCategory: "FAILURE_BROWSER",
      failureReason: input.errorMessage || "Browser page or context closed unexpectedly during execution",
      diagnostics: { passedChecks, failedChecks }
    };
  }

  // 9. Navigation Timeouts
  if (
    combinedError.includes("timeout") &&
    (combinedError.includes("navigation") || combinedError.includes("page.goto") || combinedError.includes("load budget"))
  ) {
    failedChecks.push("Navigation timed out");
    return {
      isSuccess: false,
      isEligible: true,
      taxonomyCategory: "FAILURE_NAVIGATION_TIMEOUT",
      failureReason: input.errorMessage || "Page navigation or candidate load exceeded timeout limit",
      diagnostics: { passedChecks, failedChecks }
    };
  }

  // 10. Contact Destination Discovery Failure
  if (
    input.targetType === "not_found" ||
    combinedError.includes("budget limit") ||
    combinedError.includes("target discovery exceeded") ||
    combinedError.includes("no contact candidate")
  ) {
    failedChecks.push("Contact destination was not located within discovery budget");
    return {
      isSuccess: false,
      isEligible: true,
      taxonomyCategory: "FAILURE_CONTACT_DESTINATION_NOT_FOUND",
      failureReason: input.errorMessage || input.discoveryReason || "Failed to locate contact destination within budget",
      diagnostics: { passedChecks, failedChecks }
    };
  }

  // =========================================================================
  // SPECIFIC WORKFLOW VALIDATION: BOOKING WIDGET vs CONTACT FORM
  // =========================================================================

  if (input.targetType === "booking_widget" || input.targetType === "calendly" || input.targetType === "hubspot_booking") {
    // Booking Widget Validation (Priority 2: Do NOT require email/phone at discovery)
    const validBookingStates = ["success", "completed", "dry_run_ready_to_book", "booking_widget_found"];
    const statusLower = (input.status || "").toLowerCase();

    if (!validBookingStates.includes(statusLower) && !input.bookingStateConfirmed) {
      failedChecks.push(`Booking status '${input.status}' does not satisfy valid interactive booking state`);
      return {
        isSuccess: false,
        isEligible: true,
        taxonomyCategory: "FAILURE_BOOKING_WIDGET",
        failureReason: input.errorMessage || `Booking widget failed to mount or reach interactive slot state (status: ${input.status})`,
        diagnostics: { passedChecks, failedChecks }
      };
    }

    passedChecks.push("Booking widget container detected and reached interactive state");
    return {
      isSuccess: true,
      isEligible: true,
      taxonomyCategory: "SUCCESS_BOOKING_WIDGET",
      failureReason: null,
      diagnostics: { passedChecks, failedChecks }
    };
  }

  // CONTACT FORM VALIDATION (Priority 1: Strict Invariants)
  const statusLower = (input.status || "").toLowerCase();
  const isDryRunReady = ["success", "completed", "dry_run_ready_to_book"].includes(statusLower);

  // Invariant 1: fieldsDetected must be > 0 (Eliminates the zero-field false success!)
  if (input.fieldsDetected === 0) {
    failedChecks.push("Invariant failed: 0 form fields detected on candidate page");
    return {
      isSuccess: false,
      isEligible: true,
      taxonomyCategory: "FAILURE_FORM_NOT_DETECTED",
      failureReason: "Page topology contained 0 meaningful form fields (generic buttons/links do not constitute a form)",
      diagnostics: { passedChecks, failedChecks }
    };
  }
  passedChecks.push(`Meaningful fields detected: ${input.fieldsDetected}`);

  // Invariant 2: At least one field must be classified
  if (input.fieldsClassified === 0) {
    failedChecks.push(`Invariant failed: ${input.fieldsDetected} fields detected but 0 could be semantically classified`);
    return {
      isSuccess: false,
      isEligible: true,
      taxonomyCategory: "FAILURE_FORM_FIELD_MAPPING",
      failureReason: "Form inputs detected but semantic field classification failed to map any field",
      diagnostics: { passedChecks, failedChecks }
    };
  }
  passedChecks.push(`Fields classified: ${input.fieldsClassified}`);

  // Invariant 3: Required fields must be mapped
  if (input.unmappedRequiredFields && input.unmappedRequiredFields.length > 0) {
    failedChecks.push(`Invariant failed: required fields unmapped: [${input.unmappedRequiredFields.join(", ")}]`);
    return {
      isSuccess: false,
      isEligible: true,
      taxonomyCategory: "FAILURE_REQUIRED_FIELD",
      failureReason: `Required form field(s) were not mapped: ${input.unmappedRequiredFields.join(", ")}`,
      diagnostics: { passedChecks, failedChecks }
    };
  }
  passedChecks.push("All required fields are mapped");

  // Invariant 4: At least one field filled and verified in DOM readback
  if (input.fieldsFilled === 0 || input.fieldsVerified === 0) {
    failedChecks.push(`Invariant failed: fields filled (${input.fieldsFilled}) or verified (${input.fieldsVerified}) is 0`);
    return {
      isSuccess: false,
      isEligible: true,
      taxonomyCategory: "FAILURE_FORM_FIELD_MAPPING",
      failureReason: "Form fields failed DOM readback verification after dispatching synthetic fill events",
      diagnostics: { passedChecks, failedChecks }
    };
  }
  passedChecks.push(`Fields filled (${input.fieldsFilled}) and DOM readback verified (${input.fieldsVerified})`);

  // Invariant 5: Valid submit/action control must belong to form and have valid score
  if (!input.submitControlFound || input.submitControlScore < MIN_VALID_SUBMIT_SCORE) {
    failedChecks.push(`Invariant failed: valid submit control missing or score too low (${input.submitControlScore})`);
    return {
      isSuccess: false,
      isEligible: true,
      taxonomyCategory: "FAILURE_SUBMIT_CONTROL",
      failureReason: `No valid submit control associated with form (found: ${input.submitControlFound}, score: ${input.submitControlScore})`,
      diagnostics: { passedChecks, failedChecks }
    };
  }
  passedChecks.push(`Valid submit control discovered with score: ${input.submitControlScore}`);

  // Invariant 6: Status must be dry_run_ready_to_book or success
  if (!isDryRunReady) {
    failedChecks.push(`Invariant failed: final state '${input.status}' is not dry_run_ready_to_book`);
    return {
      isSuccess: false,
      isEligible: true,
      taxonomyCategory: "FAILURE_OTHER",
      failureReason: input.errorMessage || `Workflow failed to reach dry_run_ready_to_book (status: ${input.status})`,
      diagnostics: { passedChecks, failedChecks }
    };
  }
  passedChecks.push(`Final workflow state: ${input.status}`);

  // ALL INVARIANTS PASSED!
  return {
    isSuccess: true,
    isEligible: true,
    taxonomyCategory: "SUCCESS_CONTACT_FORM",
    failureReason: null,
    diagnostics: { passedChecks, failedChecks }
  };
}
