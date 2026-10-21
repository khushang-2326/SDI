export type ErrorTaxonomyCategory =
  | "NAVIGATION_TIMEOUT"
  | "EXECUTION_DEADLINE_EXCEEDED"
  | "FORM_NOT_FOUND"
  | "REQUIRED_FIELD_UNMAPPED"
  | "FIELD_VALIDATION_ERROR"
  | "DROPDOWN_SELECTION_FAILED"
  | "SUBMIT_BUTTON_DISABLED"
  | "CAPTCHA_REQUIRED"
  | "CAPTCHA_INVALID"
  | "HUMAN_VERIFICATION_REQUIRED"
  | "HTTP_403"
  | "RATE_LIMITED"
  | "NETWORK_DNS_ERROR"
  | "NETWORK_CONNECTION_ERROR"
  | "INVALID_URL"
  | "NO_AVAILABLE_SLOT"
  | "SUBMISSION_UNCONFIRMED"
  | "SERVER_REJECTED"
  | "BROWSER_OR_AUTOMATION_ERROR"
  | "UNKNOWN_ERROR";

export interface TaxonomyDetail {
  category: ErrorTaxonomyCategory;
  displayName: string;
  stage: "DNS_LOOKUP" | "NAVIGATION" | "DISCOVERY" | "FORM_FILLING" | "PRE_SUBMIT_VALIDATION" | "SUBMISSION" | "CONFIRMATION" | "SYSTEM";
  isRetryable: boolean;
  isExternalBlocker: boolean;
  recommendedAction: string;
  legacyCategory: "NAVIGATION_TIMEOUT" | "FORM_NOT_FOUND" | "NETWORK_ERROR" | "HUMAN_VERIFICATION" | "CAPTCHA" | "HTTP_403" | "SUBMISSION_FAILED" | "OTHER";
}

export const ERROR_TAXONOMY_MAP: Record<ErrorTaxonomyCategory, TaxonomyDetail> = {
  NAVIGATION_TIMEOUT: {
    category: "NAVIGATION_TIMEOUT",
    displayName: "Navigation Timeout",
    stage: "NAVIGATION",
    isRetryable: true,
    isExternalBlocker: false,
    recommendedAction: "Check target website availability or adjust page load milestones (e.g. domcontentloaded vs networkidle).",
    legacyCategory: "NAVIGATION_TIMEOUT"
  },
  EXECUTION_DEADLINE_EXCEEDED: {
    category: "EXECUTION_DEADLINE_EXCEEDED",
    displayName: "Execution Deadline Exceeded",
    stage: "DISCOVERY",
    isRetryable: true,
    isExternalBlocker: false,
    recommendedAction: "Target discovery or multi-attempt budget was exhausted. Use direct fast-path navigation.",
    legacyCategory: "NAVIGATION_TIMEOUT"
  },
  FORM_NOT_FOUND: {
    category: "FORM_NOT_FOUND",
    displayName: "Form Not Found",
    stage: "DISCOVERY",
    isRetryable: false,
    isExternalBlocker: true,
    recommendedAction: "Verify if website has a public contact form or only client portal / direct email.",
    legacyCategory: "FORM_NOT_FOUND"
  },
  REQUIRED_FIELD_UNMAPPED: {
    category: "REQUIRED_FIELD_UNMAPPED",
    displayName: "Required Field Unmapped",
    stage: "FORM_FILLING",
    isRetryable: false,
    isExternalBlocker: false,
    recommendedAction: "Domain-specific required input could not be safely mapped to generic lead data.",
    legacyCategory: "OTHER"
  },
  FIELD_VALIDATION_ERROR: {
    category: "FIELD_VALIDATION_ERROR",
    displayName: "Field Validation Error",
    stage: "PRE_SUBMIT_VALIDATION",
    isRetryable: false,
    isExternalBlocker: false,
    recommendedAction: "Form input failed browser or framework validation constraint. Inspect field formatting.",
    legacyCategory: "OTHER"
  },
  DROPDOWN_SELECTION_FAILED: {
    category: "DROPDOWN_SELECTION_FAILED",
    displayName: "Dropdown Selection Failed",
    stage: "FORM_FILLING",
    isRetryable: false,
    isExternalBlocker: false,
    recommendedAction: "Required dropdown remained on placeholder option. Ensure non-placeholder option is chosen.",
    legacyCategory: "OTHER"
  },
  SUBMIT_BUTTON_DISABLED: {
    category: "SUBMIT_BUTTON_DISABLED",
    displayName: "Submit Button Disabled",
    stage: "SUBMISSION",
    isRetryable: false,
    isExternalBlocker: false,
    recommendedAction: "Submit button had disabled attribute after filling. Ensure reactive events (input/change/blur) fire.",
    legacyCategory: "OTHER"
  },
  CAPTCHA_REQUIRED: {
    category: "CAPTCHA_REQUIRED",
    displayName: "CAPTCHA Challenge Active",
    stage: "FORM_FILLING",
    isRetryable: false,
    isExternalBlocker: true,
    recommendedAction: "Interactive reCAPTCHA/hCaptcha/Turnstile challenge detected. Manual review required.",
    legacyCategory: "CAPTCHA"
  },
  CAPTCHA_INVALID: {
    category: "CAPTCHA_INVALID",
    displayName: "CAPTCHA Token Rejected",
    stage: "SUBMISSION",
    isRetryable: false,
    isExternalBlocker: true,
    recommendedAction: "Website backend rejected CAPTCHA token or inline verification code.",
    legacyCategory: "CAPTCHA"
  },
  HUMAN_VERIFICATION_REQUIRED: {
    category: "HUMAN_VERIFICATION_REQUIRED",
    displayName: "Human Verification Screen",
    stage: "NAVIGATION",
    isRetryable: false,
    isExternalBlocker: true,
    recommendedAction: "Cloudflare Managed Challenge or bot detection screen detected. Automation halted safely.",
    legacyCategory: "HUMAN_VERIFICATION"
  },
  HTTP_403: {
    category: "HTTP_403",
    displayName: "HTTP 403 Forbidden / WAF",
    stage: "NAVIGATION",
    isRetryable: false,
    isExternalBlocker: true,
    recommendedAction: "Edge WAF (Cloudflare/AWS/Akamai) blocked access from current datacenter IP.",
    legacyCategory: "HTTP_403"
  },
  RATE_LIMITED: {
    category: "RATE_LIMITED",
    displayName: "HTTP 429 Rate Limited",
    stage: "NAVIGATION",
    isRetryable: true,
    isExternalBlocker: true,
    recommendedAction: "Target web server returned HTTP 429 Too Many Requests. Delay and retry.",
    legacyCategory: "OTHER"
  },
  NETWORK_DNS_ERROR: {
    category: "NETWORK_DNS_ERROR",
    displayName: "DNS Resolution Error",
    stage: "DNS_LOOKUP",
    isRetryable: false,
    isExternalBlocker: true,
    recommendedAction: "Domain name does not exist or has expired DNS records (net::ERR_NAME_NOT_RESOLVED).",
    legacyCategory: "NETWORK_ERROR"
  },
  NETWORK_CONNECTION_ERROR: {
    category: "NETWORK_CONNECTION_ERROR",
    displayName: "Network Connection Error",
    stage: "NAVIGATION",
    isRetryable: true,
    isExternalBlocker: true,
    recommendedAction: "Target host refused TCP connection or reset socket (ERR_CONNECTION_REFUSED/RESET).",
    legacyCategory: "NETWORK_ERROR"
  },
  INVALID_URL: {
    category: "INVALID_URL",
    displayName: "Invalid Target URL",
    stage: "DNS_LOOKUP",
    isRetryable: false,
    isExternalBlocker: false,
    recommendedAction: "Input URL syntax in spreadsheet is invalid or points to an unsupported scheme.",
    legacyCategory: "OTHER"
  },
  NO_AVAILABLE_SLOT: {
    category: "NO_AVAILABLE_SLOT",
    displayName: "No Available Booking Slots",
    stage: "FORM_FILLING",
    isRetryable: false,
    isExternalBlocker: true,
    recommendedAction: "Embedded calendar scheduler has zero available dates/time slots for booking.",
    legacyCategory: "OTHER"
  },
  SUBMISSION_UNCONFIRMED: {
    category: "SUBMISSION_UNCONFIRMED",
    displayName: "Submission Unconfirmed",
    stage: "CONFIRMATION",
    isRetryable: false,
    isExternalBlocker: false,
    recommendedAction: "Submit button was clicked without error, but no explicit confirmation text/URL was detected.",
    legacyCategory: "SUBMISSION_FAILED"
  },
  SERVER_REJECTED: {
    category: "SERVER_REJECTED",
    displayName: "Server-Side Rejection",
    stage: "SUBMISSION",
    isRetryable: false,
    isExternalBlocker: true,
    recommendedAction: "Website backend (Akismet, CleanTalk, SMTP gateway) rejected submission payload.",
    legacyCategory: "OTHER"
  },
  BROWSER_OR_AUTOMATION_ERROR: {
    category: "BROWSER_OR_AUTOMATION_ERROR",
    displayName: "Browser or Worker Error",
    stage: "SYSTEM",
    isRetryable: true,
    isExternalBlocker: false,
    recommendedAction: "Browser process crashed or internal invariant gate rejected page topology.",
    legacyCategory: "OTHER"
  },
  UNKNOWN_ERROR: {
    category: "UNKNOWN_ERROR",
    displayName: "Unclassified Error",
    stage: "SYSTEM",
    isRetryable: false,
    isExternalBlocker: false,
    recommendedAction: "Inspect attempt execution logs and screenshot proof for diagnostic context.",
    legacyCategory: "OTHER"
  }
};

export function classifyErrorTaxonomy(
  detail: string | null | undefined,
  status?: string | null
): ErrorTaxonomyCategory {
  const d = (detail || "").toLowerCase();
  const s = (status || "").toLowerCase();
  const combined = `${d} ${s}`.trim();

  // 1. DNS Resolution Failures (Permanent dead domains)
  if (
    combined.includes("err_name_not_resolved") ||
    combined.includes("enotfound") ||
    combined.includes("dns_unresolvable") ||
    (combined.includes("dns") && combined.includes("unresolv"))
  ) {
    return "NETWORK_DNS_ERROR";
  }

  // 2. Connection Failures (Refused, Reset, Network abort)
  if (
    combined.includes("err_connection_refused") ||
    combined.includes("err_connection_reset") ||
    combined.includes("err_connection_closed") ||
    combined.includes("econnrefused") ||
    combined.includes("econnreset") ||
    combined.includes("net::err_failed")
  ) {
    return "NETWORK_CONNECTION_ERROR";
  }

  // 3. Invalid URLs (Malformed URL syntax in input dataset)
  if (
    combined.includes("invalid url") ||
    combined.includes("url parsing failed") ||
    combined.includes("unsupported protocol scheme") ||
    combined.includes("unsupported_scheme") ||
    combined.includes("empty_row")
  ) {
    return "INVALID_URL";
  }

  // 4. Rate Limiting (HTTP 429)
  if (
    combined.includes("429") ||
    combined.includes("rate limit") ||
    combined.includes("too many requests")
  ) {
    return "RATE_LIMITED";
  }

  // 5. HTTP 403 Forbidden / Edge WAF
  if (
    combined.includes("403") ||
    combined.includes("forbidden") ||
    combined.includes("waf blocked") ||
    combined.includes("access denied") ||
    combined.includes("blocked access")
  ) {
    return "HTTP_403";
  }

  // 6. Human Verification / Cloudflare Managed Challenge
  if (
    combined.includes("human verification") ||
    combined.includes("robot challenge") ||
    combined.includes("bot detection screen") ||
    combined.includes("cloudflare managed verification") ||
    combined.includes("cf-turnstile-wrapper") ||
    combined.includes("challenge-running") ||
    (combined.includes("cloudflare") && combined.includes("challenge"))
  ) {
    return "HUMAN_VERIFICATION_REQUIRED";
  }

  // 7. CAPTCHA Rejected / Invalid Code
  if (
    combined.includes("error_captcha_unsolvable") ||
    combined.includes("captcha was invalid") ||
    combined.includes("code is incorrect") ||
    combined.includes("captcha field cannot be blank") ||
    combined.includes("recaptcha verification failed")
  ) {
    return "CAPTCHA_INVALID";
  }

  // 8. CAPTCHA Required / Challenge Active
  if (
    combined.includes("captcha") ||
    combined.includes("recaptcha") ||
    combined.includes("hcaptcha") ||
    combined.includes("turnstile") ||
    combined.includes("friendly captcha")
  ) {
    return "CAPTCHA_REQUIRED";
  }

  // 9. Zero Calendar Inventory (Booking Schedulers with 0 slots)
  if (
    combined.includes("no date with available time slots") ||
    combined.includes("no_available_slots") ||
    combined.includes("booking_widget_empty") ||
    combined.includes("zero available slots") ||
    combined.includes("zero_calendar_inventory") ||
    combined.includes("no available hubspot time slots")
  ) {
    return "NO_AVAILABLE_SLOT";
  }

  // 10. Dropdown Selection Failed
  if (
    combined.includes("please select an item in the list") ||
    combined.includes("required dropdown") ||
    combined.includes("dropdown_selection_failed") ||
    combined.includes("select an item")
  ) {
    return "DROPDOWN_SELECTION_FAILED";
  }

  // 11. Submit Button Disabled
  if (
    combined.includes("submit button disabled") ||
    combined.includes("disabled after filling") ||
    combined.includes("submit button is disabled")
  ) {
    return "SUBMIT_BUTTON_DISABLED";
  }

  // 12. Unmapped Required Fields (Safety Invariant Gate)
  if (
    combined.includes("required_field_unmapped") ||
    combined.includes("missing required field(s)")
  ) {
    return "REQUIRED_FIELD_UNMAPPED";
  }

  // 13. Server-Side Spam Filter / Mail Server Failure
  if (
    combined.includes("server spam filter") ||
    combined.includes("akismet") ||
    combined.includes("cleantalk") ||
    combined.includes("server anti-spam") ||
    combined.includes("smtp connection error") ||
    combined.includes("server mail delivery failed") ||
    combined.includes("seem like spam") ||
    combined.includes("spam protection check could not be completed")
  ) {
    return "SERVER_REJECTED";
  }

  // 14. Field Validation Errors (HTML5 / Framework Constraint Validation)
  if (
    combined.includes("validation failed on") ||
    combined.includes("browser validation failed on") ||
    combined.includes("please fill out this field") ||
    combined.includes("please match the requested format") ||
    combined.includes("the field is required") ||
    combined.includes("validation_before_submission_failed") ||
    combined.includes("invalid or incomplete required field") ||
    combined.includes("validation_error")
  ) {
    return "FIELD_VALIDATION_ERROR";
  }

  // 15. Form Not Found / Submit Button Missing
  if (
    combined.includes("no supported contact form") ||
    combined.includes("no form detected") ||
    combined.includes("no visible submit button found") ||
    combined.includes("submit button not found") ||
    combined.includes("failure_form_not_detected") ||
    combined.includes("next step button was not found") ||
    combined.includes("no supported") ||
    combined.includes("submit_button_not_found")
  ) {
    return "FORM_NOT_FOUND";
  }

  // 16. Execution Deadline / Worker Budget Exceeded (Internal Timeout)
  if (
    combined.includes("exceeded attempt budget limit") ||
    combined.includes("exceeded overall deadline budget") ||
    combined.includes("target discovery exceeded overall budget") ||
    combined.includes("website automation exceeded its time limit") ||
    combined.includes("overall deadline budget") ||
    combined.includes("attempt budget limit") ||
    combined.includes("budget exceeded") ||
    combined.includes("maximum automation time limit") ||
    combined.includes("exceeded 120s limit") ||
    combined.includes("exceeded 300s limit") ||
    (combined.includes("exceeded") && combined.includes("budget")) ||
    (combined.includes("budget") && combined.includes("limit"))
  ) {
    return "EXECUTION_DEADLINE_EXCEEDED";
  }

  // 17. Navigation Timeout (True Playwright network navigation timeout)
  if (
    combined.includes("navigation timeout") ||
    combined.includes("page.goto: timeout") ||
    combined.includes("navigation to") ||
    combined.includes("timed out after") ||
    combined.includes("timeout") ||
    combined.includes("timed out")
  ) {
    return "NAVIGATION_TIMEOUT";
  }

  // 18. Submission Unconfirmed
  if (
    combined.includes("confirmation was not detected") ||
    combined.includes("booking was submitted but confirmation was not detected") ||
    combined.includes("final hubspot confirmation was not detected") ||
    combined.includes("submission_unconfirmed") ||
    combined.includes("submit clicked, but") ||
    combined.includes("no success message")
  ) {
    return "SUBMISSION_UNCONFIRMED";
  }

  // 19. Browser Process / Context Crash
  if (
    combined.includes("target page, context or browser has been closed") ||
    combined.includes("browser context was closed") ||
    combined.includes("browser has disconnected") ||
    combined.includes("invariant_gate_rejected") ||
    combined.includes("failure_browser")
  ) {
    return "BROWSER_OR_AUTOMATION_ERROR";
  }

  return "UNKNOWN_ERROR";
}

const FALLBACK_TAXONOMY_DETAIL: TaxonomyDetail = {
  category: "UNKNOWN_ERROR",
  displayName: "Unclassified Error",
  stage: "SYSTEM",
  isRetryable: false,
  isExternalBlocker: false,
  recommendedAction: "Inspect attempt execution logs and screenshot proof for diagnostic context.",
  legacyCategory: "OTHER"
};

export function getTaxonomyDetail(cat: ErrorTaxonomyCategory): TaxonomyDetail {
  return (ERROR_TAXONOMY_MAP && ERROR_TAXONOMY_MAP[cat]) || ERROR_TAXONOMY_MAP.UNKNOWN_ERROR || FALLBACK_TAXONOMY_DETAIL;
}

export function classifyLegacyCategory(
  detail: string | null | undefined,
  status?: string | null
): "NAVIGATION_TIMEOUT" | "FORM_NOT_FOUND" | "NETWORK_ERROR" | "HUMAN_VERIFICATION" | "CAPTCHA" | "HTTP_403" | "SUBMISSION_FAILED" | "OTHER" {
  const cat = classifyErrorTaxonomy(detail, status);
  return getTaxonomyDetail(cat).legacyCategory;
}

export function computeTaxonomyCounts(
  items?: Array<{ detail?: string | null; status?: string | null }> | null
): Record<ErrorTaxonomyCategory, number> {
  const counts: Record<ErrorTaxonomyCategory, number> = {
    NAVIGATION_TIMEOUT: 0,
    EXECUTION_DEADLINE_EXCEEDED: 0,
    FORM_NOT_FOUND: 0,
    REQUIRED_FIELD_UNMAPPED: 0,
    FIELD_VALIDATION_ERROR: 0,
    DROPDOWN_SELECTION_FAILED: 0,
    SUBMIT_BUTTON_DISABLED: 0,
    CAPTCHA_REQUIRED: 0,
    CAPTCHA_INVALID: 0,
    HUMAN_VERIFICATION_REQUIRED: 0,
    HTTP_403: 0,
    RATE_LIMITED: 0,
    NETWORK_DNS_ERROR: 0,
    NETWORK_CONNECTION_ERROR: 0,
    INVALID_URL: 0,
    NO_AVAILABLE_SLOT: 0,
    SUBMISSION_UNCONFIRMED: 0,
    SERVER_REJECTED: 0,
    BROWSER_OR_AUTOMATION_ERROR: 0,
    UNKNOWN_ERROR: 0
  };

  if (!Array.isArray(items)) return counts;

  for (const item of items) {
    if (!item) continue;
    const cat = classifyErrorTaxonomy(item.detail, item.status);
    if (cat in counts) {
      counts[cat]++;
    } else {
      counts.UNKNOWN_ERROR++;
    }
  }

  return counts;
}

export function computeLegacyCategoryCounts(
  items: Array<{ detail?: string | null; status?: string | null }>
): Record<string, number> {
  const counts: Record<string, number> = {
    NAVIGATION_TIMEOUT: 0,
    FORM_NOT_FOUND: 0,
    NETWORK_ERROR: 0,
    HUMAN_VERIFICATION: 0,
    CAPTCHA: 0,
    HTTP_403: 0,
    SUBMISSION_FAILED: 0,
    OTHER: 0
  };

  for (const item of items) {
    const legacy = classifyLegacyCategory(item.detail, item.status);
    counts[legacy]++;
  }

  return counts;
}

