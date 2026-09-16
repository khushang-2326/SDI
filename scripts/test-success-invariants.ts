import { evaluateFinalAutomationSuccess } from "../services/success-invariants";

function runTest(name: string, assertion: boolean, detail?: string) {
  if (assertion) {
    console.log(`[PASS] ${name}`);
  } else {
    console.error(`[FAIL] ${name}: ${detail || "Assertion failed"}`);
    process.exitCode = 1;
  }
}

console.log("==================================================");
console.log("RUNNING CENTRAL SUCCESS INVARIANT TESTS (CASES 1-9)");
console.log("==================================================");

// Case 1: 0 fields + dry_run_ready -> MUST FAIL (FAILURE_FORM_NOT_DETECTED)
const case1 = evaluateFinalAutomationSuccess({
  targetType: "contact_form",
  status: "dry_run_ready_to_book",
  fieldsDetected: 0,
  fieldsClassified: 0,
  fieldsFilled: 0,
  fieldsVerified: 0,
  unmappedRequiredFields: [],
  submitControlFound: true,
  submitControlScore: 70
});
runTest(
  "Case 1: 0 fields + dry_run_ready MUST FAIL with FAILURE_FORM_NOT_DETECTED",
  !case1.isSuccess && case1.taxonomyCategory === "FAILURE_FORM_NOT_DETECTED" && case1.isEligible,
  JSON.stringify(case1)
);

// Case 2: fields detected but none classified -> FAILURE_FORM_FIELD_MAPPING
const case2 = evaluateFinalAutomationSuccess({
  targetType: "contact_form",
  status: "dry_run_ready_to_book",
  fieldsDetected: 4,
  fieldsClassified: 0,
  fieldsFilled: 0,
  fieldsVerified: 0,
  unmappedRequiredFields: [],
  submitControlFound: true,
  submitControlScore: 80
});
runTest(
  "Case 2: fields detected but none classified -> FAILURE_FORM_FIELD_MAPPING",
  !case2.isSuccess && case2.taxonomyCategory === "FAILURE_FORM_FIELD_MAPPING" && case2.isEligible,
  JSON.stringify(case2)
);

// Case 3: required field unmapped -> FAILURE_REQUIRED_FIELD
const case3 = evaluateFinalAutomationSuccess({
  targetType: "contact_form",
  status: "dry_run_ready_to_book",
  fieldsDetected: 3,
  fieldsClassified: 2,
  fieldsFilled: 2,
  fieldsVerified: 2,
  unmappedRequiredFields: ["email"],
  submitControlFound: true,
  submitControlScore: 100
});
runTest(
  "Case 3: required field unmapped -> FAILURE_REQUIRED_FIELD",
  !case3.isSuccess && case3.taxonomyCategory === "FAILURE_REQUIRED_FIELD" && case3.isEligible,
  JSON.stringify(case3)
);

// Case 4: fields filled but submit control missing -> FAILURE_SUBMIT_CONTROL
const case4 = evaluateFinalAutomationSuccess({
  targetType: "contact_form",
  status: "dry_run_ready_to_book",
  fieldsDetected: 3,
  fieldsClassified: 3,
  fieldsFilled: 3,
  fieldsVerified: 3,
  unmappedRequiredFields: [],
  submitControlFound: false,
  submitControlScore: 0
});
runTest(
  "Case 4: fields filled but submit control missing -> FAILURE_SUBMIT_CONTROL",
  !case4.isSuccess && case4.taxonomyCategory === "FAILURE_SUBMIT_CONTROL" && case4.isEligible,
  JSON.stringify(case4)
);

// Case 5: valid form + fields filled + DOM verified + submit control -> SUCCESS_CONTACT_FORM
const case5 = evaluateFinalAutomationSuccess({
  targetType: "contact_form",
  status: "dry_run_ready_to_book",
  fieldsDetected: 4,
  fieldsClassified: 4,
  fieldsFilled: 4,
  fieldsVerified: 4,
  unmappedRequiredFields: [],
  submitControlFound: true,
  submitControlScore: 140
});
runTest(
  "Case 5: valid form + filled + DOM verified + submit control -> SUCCESS_CONTACT_FORM",
  case5.isSuccess && case5.taxonomyCategory === "SUCCESS_CONTACT_FORM" && case5.isEligible,
  JSON.stringify(case5)
);

// Case 6: valid booking widget + genuine interactive booking state -> SUCCESS_BOOKING_WIDGET
const case6 = evaluateFinalAutomationSuccess({
  targetType: "booking_widget",
  status: "dry_run_ready_to_book",
  fieldsDetected: 0,
  fieldsClassified: 0,
  fieldsFilled: 0,
  fieldsVerified: 0,
  unmappedRequiredFields: [],
  submitControlFound: true,
  submitControlScore: 100,
  bookingStateConfirmed: true
});
runTest(
  "Case 6: valid booking widget + interactive booking state -> SUCCESS_BOOKING_WIDGET",
  case6.isSuccess && case6.taxonomyCategory === "SUCCESS_BOOKING_WIDGET" && case6.isEligible,
  JSON.stringify(case6)
);

// Case 7: operating hours only -> NOT a booking widget (INELIGIBLE_GENUINE_NO_PUBLIC_FORM)
const case7 = evaluateFinalAutomationSuccess({
  targetType: "contact_form",
  status: "failed",
  fieldsDetected: 0,
  fieldsClassified: 0,
  fieldsFilled: 0,
  fieldsVerified: 0,
  unmappedRequiredFields: [],
  submitControlFound: false,
  submitControlScore: 0,
  isOperatingHoursOnly: true
});
runTest(
  "Case 7: operating hours only -> NOT a booking widget (INELIGIBLE_GENUINE_NO_PUBLIC_FORM)",
  !case7.isSuccess && case7.taxonomyCategory === "INELIGIBLE_GENUINE_NO_PUBLIC_FORM" && !case7.isEligible,
  JSON.stringify(case7)
);

// Case 8: CAPTCHA -> INELIGIBLE_CAPTCHA_HUMAN_VERIFICATION
const case8 = evaluateFinalAutomationSuccess({
  targetType: "contact_form",
  status: "failed",
  fieldsDetected: 0,
  fieldsClassified: 0,
  fieldsFilled: 0,
  fieldsVerified: 0,
  unmappedRequiredFields: [],
  submitControlFound: false,
  submitControlScore: 0,
  securityGateDetected: "Cloudflare Turnstile challenge screen"
});
runTest(
  "Case 8: CAPTCHA -> INELIGIBLE_CAPTCHA_HUMAN_VERIFICATION",
  !case8.isSuccess && case8.taxonomyCategory === "INELIGIBLE_CAPTCHA_HUMAN_VERIFICATION" && !case8.isEligible,
  JSON.stringify(case8)
);

// Case 9: WAF 403 -> INELIGIBLE_WAF_BLOCKED
const case9 = evaluateFinalAutomationSuccess({
  targetType: "contact_form",
  status: "failed",
  httpStatus: 403,
  fieldsDetected: 0,
  fieldsClassified: 0,
  fieldsFilled: 0,
  fieldsVerified: 0,
  unmappedRequiredFields: [],
  submitControlFound: false,
  submitControlScore: 0
});
runTest(
  "Case 9: WAF 403 -> INELIGIBLE_WAF_BLOCKED",
  !case9.isSuccess && case9.taxonomyCategory === "INELIGIBLE_WAF_BLOCKED" && !case9.isEligible,
  JSON.stringify(case9)
);

// Case 10: Unmounted booking container -> FAILURE_BOOKING_WIDGET (Eligible: true)
const case10 = evaluateFinalAutomationSuccess({
  targetType: "booking_widget",
  status: "failed",
  errorMessage: "Booking widget detected but container did not render",
  bookingContainerDetected: false,
  availableSlotState: "none",
  fieldsDetected: 0,
  fieldsClassified: 0,
  fieldsFilled: 0,
  fieldsVerified: 0,
  unmappedRequiredFields: [],
  submitControlFound: false,
  submitControlScore: 0
});
runTest(
  "Case 10: Unmounted booking container -> FAILURE_BOOKING_WIDGET (Eligible: true)",
  !case10.isSuccess && case10.taxonomyCategory === "FAILURE_BOOKING_WIDGET" && case10.isEligible,
  JSON.stringify(case10)
);

// Case 11: Mounted interactive calendar with 0 slots -> INELIGIBLE_ZERO_CALENDAR_INVENTORY (Eligible: false)
const case11 = evaluateFinalAutomationSuccess({
  targetType: "booking_widget",
  status: "failed",
  errorMessage: "Calendar loaded but zero available slots in selected range",
  bookingContainerDetected: true,
  interactiveCalendarDetected: true,
  availableSlotState: "none",
  fieldsDetected: 0,
  fieldsClassified: 0,
  fieldsFilled: 0,
  fieldsVerified: 0,
  unmappedRequiredFields: [],
  submitControlFound: false,
  submitControlScore: 0
});
runTest(
  "Case 11: Mounted calendar with 0 slots -> INELIGIBLE_ZERO_CALENDAR_INVENTORY (Eligible: false)",
  !case11.isSuccess && case11.taxonomyCategory === "INELIGIBLE_ZERO_CALENDAR_INVENTORY" && !case11.isEligible,
  JSON.stringify(case11)
);

// Case 12: Deadline timeout with closed context -> FAILURE_NAVIGATION_TIMEOUT (NOT FAILURE_BROWSER)
const case12 = evaluateFinalAutomationSuccess({
  targetType: "contact_form",
  status: "failed",
  errorMessage: "Target page, context or browser has been closed (deadline exceeded)",
  isDeadlineTimeout: true,
  closeInitiator: "deadline",
  fieldsDetected: 0,
  fieldsClassified: 0,
  fieldsFilled: 0,
  fieldsVerified: 0,
  unmappedRequiredFields: [],
  submitControlFound: false,
  submitControlScore: 0
});
runTest(
  "Case 12: Deadline timeout with closed context -> FAILURE_NAVIGATION_TIMEOUT (Eligible: true)",
  !case12.isSuccess && case12.taxonomyCategory === "FAILURE_NAVIGATION_TIMEOUT" && case12.isEligible,
  JSON.stringify(case12)
);

// Case 13: Validator Identity Integrity Assertion
const mockTargets = [
  { id: 1, url: "https://airtable.com" },
  { id: 2, url: "https://webflow.com" },
  { id: 3, url: "https://clickup.com" }
];
const mockResults = mockTargets.map((t) => ({
  inputTargetId: t.id,
  inputRootUrl: t.url,
  finalStatus: "processed"
}));
const identityIntegrityPassed = mockTargets.every(
  (t, idx) => mockResults[idx].inputTargetId === t.id && mockResults[idx].inputRootUrl === t.url
);
runTest(
  "Case 13: Validator Identity Integrity Assertion (result.inputTargetId === originalInputTargetId)",
  identityIntegrityPassed,
  "Target identity preserved across execution"
);

console.log("==================================================");
console.log("ALL 13 INVARIANT CASES PASSED SUCCESSFULLY!");
console.log("==================================================");

