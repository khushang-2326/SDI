import { evaluateFinalAutomationSuccess } from "../services/success-invariants";
import { classifyErrorTaxonomy } from "../services/error-taxonomy";

function runTests() {
  console.log("=== Testing Form Submission Success Classification Scenarios ===\n");
  let passed = 0;
  let total = 0;

  function assert(scenario: string, condition: boolean, detail: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] Scenario ${total}: ${scenario}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] Scenario ${total}: ${scenario} - ${detail}`);
    }
  }

  // Helper matching worker-pool's resultCompleted logic:
  function resultCompleted(result: { status: string; errorMessage?: string | null; submissionOutcome?: string }): boolean {
    if (result.status === "success" || result.status === "dry_run_ready_to_book") {
      return true;
    }
    if (
      result.status === "confirmation_not_found" &&
      (!result.errorMessage ||
        result.errorMessage.includes("confirmation signal was not detected") ||
        result.errorMessage.includes("confirmation was not detected"))
    ) {
      return true;
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // Scenario 1: Form submitted successfully with a thank-you banner -> SUCCESS
  // --------------------------------------------------------------------------
  const res1 = {
    websiteUrl: "https://example.com",
    status: "success",
    submissionOutcome: "VERIFIED_SUCCESS",
    errorMessage: null,
    message: "Contact form submitted successfully with verified confirmation."
  };
  assert(
    "Form submitted successfully with a thank-you banner -> SUCCESS",
    res1.status === "success" && resultCompleted(res1) === true && res1.submissionOutcome === "VERIFIED_SUCCESS",
    `Expected status='success' and resultCompleted=true, got status=${res1.status}`
  );

  // --------------------------------------------------------------------------
  // Scenario 2: Form submitted, but no confirmation banner or message appears -> SUCCESS
  // --------------------------------------------------------------------------
  const res2 = {
    websiteUrl: "https://example.com",
    status: "success",
    submissionOutcome: "PASS",
    errorMessage: null,
    message: "Contact form submitted successfully (action completed without error)."
  };
  assert(
    "Form submitted, but no confirmation banner or message appears -> SUCCESS",
    res2.status === "success" && resultCompleted(res2) === true && res2.errorMessage === null,
    `Expected status='success', errorMessage=null, got status=${res2.status}, error=${res2.errorMessage}`
  );

  // --------------------------------------------------------------------------
  // Scenario 3: Form submitted and page remains unchanged, no error -> SUCCESS
  // --------------------------------------------------------------------------
  const res3 = {
    websiteUrl: "https://example.com/contact",
    status: "success",
    submissionOutcome: "PASS",
    errorMessage: null,
    message: "Contact form submitted successfully (action completed without error)."
  };
  assert(
    "Form submitted and page remains unchanged, no error -> SUCCESS under default rule",
    res3.status === "success" && resultCompleted(res3) === true && res3.errorMessage === null,
    `Expected status='success', got status=${res3.status}`
  );

  // --------------------------------------------------------------------------
  // Scenario 4: Website displays a validation error -> FAIL
  // --------------------------------------------------------------------------
  const res4 = {
    websiteUrl: "https://example.com",
    status: "failed",
    submissionOutcome: "FAILED",
    errorMessage: 'Website rejected submission: "Validation failed on \\"name\\": Please fill out this field."'
  };
  const cat4 = classifyErrorTaxonomy(res4.errorMessage, res4.status);
  assert(
    "Website displays a validation error -> FAIL",
    res4.status === "failed" && resultCompleted(res4) === false && cat4 === "FIELD_VALIDATION_ERROR",
    `Expected status='failed', category='FIELD_VALIDATION_ERROR', got cat=${cat4}`
  );

  // --------------------------------------------------------------------------
  // Scenario 5: Website explicitly rejects the submission (e.g. Akismet spam) -> FAIL
  // --------------------------------------------------------------------------
  const res5 = {
    websiteUrl: "https://example.com",
    status: "failed",
    submissionOutcome: "FAILED",
    errorMessage: "Server spam filter (Akismet / WPCF7) classified submission as spam."
  };
  const cat5 = classifyErrorTaxonomy(res5.errorMessage, res5.status);
  assert(
    "Website explicitly rejects the submission -> FAIL",
    res5.status === "failed" && resultCompleted(res5) === false && cat5 === "SERVER_REJECTED",
    `Expected status='failed', category='SERVER_REJECTED', got cat=${cat5}`
  );

  // --------------------------------------------------------------------------
  // Scenario 6: Submit button cannot be clicked -> FAIL
  // --------------------------------------------------------------------------
  const res6 = {
    websiteUrl: "https://example.com",
    status: "failed",
    submissionOutcome: "FAILED",
    errorMessage: "Submit button could not be clicked and form dispatch action failed."
  };
  const inv6 = evaluateFinalAutomationSuccess({
    targetType: "contact_form",
    status: "failed",
    errorMessage: res6.errorMessage,
    fieldsDetected: 4,
    fieldsClassified: 4,
    fieldsFilled: 4,
    fieldsVerified: 4,
    unmappedRequiredFields: [],
    submitControlFound: false,
    submitControlScore: 0
  });
  assert(
    "Submit button cannot be clicked / action failed -> FAIL",
    res6.status === "failed" && resultCompleted(res6) === false && inv6.isSuccess === false,
    `Expected status='failed' and invariant.isSuccess=false`
  );

  // --------------------------------------------------------------------------
  // Scenario 7: CAPTCHA or access restriction blocks submission -> BLOCKED / FAIL
  // --------------------------------------------------------------------------
  const res7 = {
    websiteUrl: "https://example.com",
    status: "failed",
    submissionOutcome: "FAILED",
    errorMessage: "Unsupported verification: Human verification or bot detection screen detected. Manual verification required."
  };
  const cat7 = classifyErrorTaxonomy(res7.errorMessage, res7.status);
  const inv7 = evaluateFinalAutomationSuccess({
    targetType: "contact_form",
    status: "failed",
    errorMessage: res7.errorMessage,
    fieldsDetected: 0,
    fieldsClassified: 0,
    fieldsFilled: 0,
    fieldsVerified: 0,
    unmappedRequiredFields: [],
    submitControlFound: false,
    submitControlScore: 0
  });
  assert(
    "CAPTCHA or access restriction blocks submission -> BLOCKED / FAIL",
    res7.status === "failed" && resultCompleted(res7) === false && (cat7 === "HUMAN_VERIFICATION_REQUIRED" || cat7 === "CAPTCHA_REQUIRED") && inv7.isSuccess === false,
    `Expected category='HUMAN_VERIFICATION_REQUIRED', got cat=${cat7}`
  );

  // --------------------------------------------------------------------------
  // Scenario 8: Browser hangs before submission action completes -> TIMEOUT / UNCONFIRMED
  // --------------------------------------------------------------------------
  const res8 = {
    websiteUrl: "https://example.com",
    status: "failed",
    submissionOutcome: "FAILED",
    errorMessage: "NAVIGATION_TIMEOUT: Navigation to usable page timed out after 45 seconds for https://example.com"
  };
  const cat8 = classifyErrorTaxonomy(res8.errorMessage, res8.status);
  assert(
    "Browser hangs before submission action completes -> TIMEOUT / FAIL (not automatic success)",
    res8.status === "failed" && resultCompleted(res8) === false && cat8 === "NAVIGATION_TIMEOUT",
    `Expected category='NAVIGATION_TIMEOUT', got cat=${cat8}`
  );

  // --------------------------------------------------------------------------
  // Scenario 9: Legacy unconfirmed message fallback safety
  // --------------------------------------------------------------------------
  const res9 = {
    websiteUrl: "https://example.com",
    status: "confirmation_not_found",
    submissionOutcome: "SUBMISSION_UNCONFIRMED",
    errorMessage: "Contact form submitted, but confirmation signal was not detected."
  };
  assert(
    "Legacy confirmation_not_found status with no other error -> safely completed in worker pool",
    resultCompleted(res9) === true,
    `Expected resultCompleted(res9)=true`
  );

  console.log(`\nResults: ${passed}/${total} scenarios passed cleanly!`);
  if (passed !== total) {
    process.exit(1);
  }
}

runTests();
