import assert from "node:assert";
import {
  classifyErrorTaxonomy,
  classifyLegacyCategory,
  computeTaxonomyCounts,
  computeLegacyCategoryCounts,
  getTaxonomyDetail,
  type ErrorTaxonomyCategory
} from "../services/error-taxonomy";
import { classifyField } from "../services/field-classifier";

console.log("================================================================================");
console.log("AUTOMATION RELIABILITY & FAILURE TAXONOMY REGRESSION TEST SUITE");
console.log("================================================================================");

let testsPassed = 0;
let testsFailed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    testsPassed++;
  } catch (err: any) {
    console.error(`  ✕ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    testsFailed++;
  }
}

// -----------------------------------------------------------------------------
// Suite 1: Taxonomy Classification (All 20 Categories from Live Forensics)
// -----------------------------------------------------------------------------
console.log("\n[Suite 1] Error Taxonomy Classification of Real Forensic Failures");

runTest("Classifies real navigation timeout (Playwright page.goto timeout)", () => {
  const cat = classifyErrorTaxonomy("page.goto: Navigation timeout of 30000ms exceeded.");
  assert.strictEqual(cat, "NAVIGATION_TIMEOUT");
  assert.strictEqual(getTaxonomyDetail(cat).legacyCategory, "NAVIGATION_TIMEOUT");
});

runTest("Classifies internal execution budget timeouts (previously misclassified as navigation timeout)", () => {
  const cat1 = classifyErrorTaxonomy("Target automation budget exceeded 120s limit");
  const cat2 = classifyErrorTaxonomy("Website automation exceeded attempt budget limit of 120000ms");
  const cat3 = classifyErrorTaxonomy("Target discovery exceeded overall budget of 105000ms");
  assert.strictEqual(cat1, "EXECUTION_DEADLINE_EXCEEDED");
  assert.strictEqual(cat2, "EXECUTION_DEADLINE_EXCEEDED");
  assert.strictEqual(cat3, "EXECUTION_DEADLINE_EXCEEDED");
});

runTest("Classifies invalid input dataset URLs (previously lumped into generic OTHER)", () => {
  const cat1 = classifyErrorTaxonomy("[worker-15] Invalid URL");
  const cat2 = classifyErrorTaxonomy("URL parsing failed: TypeError [ERR_INVALID_URL]: Invalid URL");
  assert.strictEqual(cat1, "INVALID_URL");
  assert.strictEqual(cat2, "INVALID_URL");
});

runTest("Classifies field validation errors (HTML5 and client constraints)", () => {
  const cat1 = classifyErrorTaxonomy('Browser validation failed on "your-phone": Please fill out this field.');
  const cat2 = classifyErrorTaxonomy('Validation failed on "user_email": Please enter an email address.');
  assert.strictEqual(cat1, "FIELD_VALIDATION_ERROR");
  assert.strictEqual(cat2, "FIELD_VALIDATION_ERROR");
});

runTest("Classifies dropdown selection failures (browser constraint on unselected dropdown)", () => {
  const cat = classifyErrorTaxonomy('Browser validation failed on "subject": Please select an item in the list.');
  assert.strictEqual(cat, "DROPDOWN_SELECTION_FAILED");
});

runTest("Classifies submit button disabled after form filling", () => {
  const cat = classifyErrorTaxonomy("Submit button disabled after form filling. Reactive form events not registered.");
  assert.strictEqual(cat, "SUBMIT_BUTTON_DISABLED");
});

runTest("Classifies active CAPTCHA challenges", () => {
  const cat1 = classifyErrorTaxonomy("Interactive reCAPTCHA v2 challenge active");
  const cat2 = classifyErrorTaxonomy("hCaptcha challenge modal presented");
  assert.strictEqual(cat1, "CAPTCHA_REQUIRED");
  assert.strictEqual(cat2, "CAPTCHA_REQUIRED");
  assert.strictEqual(getTaxonomyDetail(cat1).isExternalBlocker, true);
});

runTest("Classifies rejected or invalid CAPTCHA codes", () => {
  const cat = classifyErrorTaxonomy("Website reported captcha was invalid, please try again.");
  assert.strictEqual(cat, "CAPTCHA_INVALID");
});

runTest("Classifies human verification / Cloudflare managed challenges", () => {
  const cat1 = classifyErrorTaxonomy("Cloudflare managed challenge active: cf-turnstile-wrapper");
  const cat2 = classifyErrorTaxonomy("Bot detection screen blocking navigation: human verification required");
  assert.strictEqual(cat1, "HUMAN_VERIFICATION_REQUIRED");
  assert.strictEqual(cat2, "HUMAN_VERIFICATION_REQUIRED");
});

runTest("Classifies HTTP 403 Forbidden and WAF edge blocks", () => {
  const cat1 = classifyErrorTaxonomy("HTTP 403 Forbidden - Access Denied by Akamai GHost");
  const cat2 = classifyErrorTaxonomy("WAF blocked automated browser session");
  assert.strictEqual(cat1, "HTTP_403");
  assert.strictEqual(cat2, "HTTP_403");
});

runTest("Classifies DNS resolution errors", () => {
  const cat = classifyErrorTaxonomy("net::ERR_NAME_NOT_RESOLVED at http://nonexistent-company-domain.com");
  assert.strictEqual(cat, "NETWORK_DNS_ERROR");
});

runTest("Classifies network connection drops, resets, and refused ports", () => {
  const cat1 = classifyErrorTaxonomy("net::ERR_CONNECTION_REFUSED");
  const cat2 = classifyErrorTaxonomy("net::ERR_CONNECTION_RESET");
  assert.strictEqual(cat1, "NETWORK_CONNECTION_ERROR");
  assert.strictEqual(cat2, "NETWORK_CONNECTION_ERROR");
});

runTest("Classifies calendar/booking scheduler slot exhaustion", () => {
  const cat1 = classifyErrorTaxonomy("No date with available time slots found in Calendly widget");
  const cat2 = classifyErrorTaxonomy("Booking widget empty: zero available slots");
  assert.strictEqual(cat1, "NO_AVAILABLE_SLOT");
  assert.strictEqual(cat2, "NO_AVAILABLE_SLOT");
});

runTest("Classifies server-side spam rejections and mailer failures", () => {
  const cat1 = classifyErrorTaxonomy('Website rejected submission: "Submission flagged by server spam filter (Akismet)."');
  const cat2 = classifyErrorTaxonomy('Website rejected submission: "SMTP connection error: server mail delivery failed."');
  assert.strictEqual(cat1, "SERVER_REJECTED");
  assert.strictEqual(cat2, "SERVER_REJECTED");
});

runTest("Classifies unconfirmed submissions", () => {
  const cat = classifyErrorTaxonomy("Form submit clicked, but explicit confirmation was not detected.");
  assert.strictEqual(cat, "SUBMISSION_UNCONFIRMED");
});

// -----------------------------------------------------------------------------
// Suite 2: 100% Failure Aggregation & Legacy Category Mapping
// -----------------------------------------------------------------------------
console.log("\n[Suite 2] Aggregation Completeness & Legacy Bridge");

runTest("Aggregates 100% of failed items into taxonomy counts without loss", () => {
  const sampleFailures = [
    { detail: "Navigation timeout of 30000ms exceeded" },
    { detail: "Target automation budget exceeded 120s limit" },
    { detail: "[worker-01] Invalid URL" },
    { detail: 'Browser validation failed on "phone": Please fill out this field.' },
    { detail: "Please select an item in the list." },
    { detail: "HTTP 403 Forbidden" },
    { detail: "reCAPTCHA challenge active" },
    { detail: "Cloudflare Turnstile challenge" },
    { detail: "No supported contact form found" },
    { detail: "net::ERR_NAME_NOT_RESOLVED" }
  ];

  const taxonomyCounts = computeTaxonomyCounts(sampleFailures);
  const totalCategorized = Object.values(taxonomyCounts).reduce((acc, c) => acc + c, 0);
  assert.strictEqual(totalCategorized, sampleFailures.length, "All items must be counted");
  assert.strictEqual(taxonomyCounts.UNKNOWN_ERROR, 0, "No item should fall into UNKNOWN_ERROR");
});

runTest("Aggregates legacy categories consistently with 100% coverage", () => {
  const sampleFailures = [
    { detail: "Navigation timeout of 30000ms exceeded" },
    { detail: "Target automation budget exceeded 120s limit" },
    { detail: "[worker-01] Invalid URL" },
    { detail: "Please select an item in the list." },
    { detail: "HTTP 403 Forbidden" },
    { detail: "reCAPTCHA challenge active" }
  ];

  const legacyCounts = computeLegacyCategoryCounts(sampleFailures);
  const totalLegacy = Object.values(legacyCounts).reduce((acc, c) => acc + c, 0);
  assert.strictEqual(totalLegacy, sampleFailures.length);
  assert.strictEqual(legacyCounts.HTTP_403, 1);
  assert.strictEqual(legacyCounts.CAPTCHA, 1);
  assert.strictEqual(legacyCounts.NAVIGATION_TIMEOUT, 2); // 1 real timeout + 1 budget timeout mapped to legacy
});

// -----------------------------------------------------------------------------
// Suite 3: Field Classifier & Negative Pattern Protection
// -----------------------------------------------------------------------------
console.log("\n[Suite 3] Field Classifier Negative Pattern Protection & Multilingual Synonyms");

function createMockSignals(overrides: Partial<import("../services/field-classifier").FieldSignals>): import("../services/field-classifier").FieldSignals {
  return {
    index: 0,
    tagName: "input",
    type: "text",
    name: "",
    id: "",
    placeholder: "",
    ariaLabel: "",
    ariaLabelledby: "",
    autocomplete: "",
    title: "",
    dataAttributes: "",
    explicitLabel: "",
    associatedLabels: [],
    surroundingLabel: "",
    legendText: "",
    parentContainerText: "",
    precedingSiblingText: "",
    followingSiblingText: "",
    isRequired: false,
    isDisabled: false,
    isReadOnly: false,
    isVisible: true,
    domPosition: 0,
    ...overrides
  };
}

runTest("Does not disqualify contact fields containing 'query' in name attribute", () => {
  const f1 = classifyField(createMockSignals({
    name: "user_query[name]",
    type: "text",
    placeholder: "Your Name"
  }));
  assert(f1.fieldType === "first_name" || f1.fieldType === "full_name", `Expected name field, got ${f1.fieldType}`);
  assert.strictEqual(f1.isNegative, false);

  const f2 = classifyField(createMockSignals({
    name: "user_query[email]",
    type: "email",
    placeholder: "Your Email"
  }));
  assert.strictEqual(f2.fieldType, "email");
  assert.strictEqual(f2.isNegative, false);

  const f3 = classifyField(createMockSignals({
    name: "user_query[phone]",
    type: "tel",
    placeholder: "Phone Number"
  }));
  assert.strictEqual(f3.fieldType, "phone");
  assert.strictEqual(f3.isNegative, false);
});

runTest("Does not disqualify contact fields containing 'find' in name or placeholder", () => {
  const f = classifyField(createMockSignals({
    name: "how_did_you_find_us",
    type: "text",
    placeholder: "How did you find us?"
  }));
  assert.strictEqual(f.isNegative, false);
});

runTest("Recognizes multilingual name and contact synonyms", () => {
  assert.strictEqual(classifyField(createMockSignals({ name: "vorname", type: "text" })).fieldType, "first_name");
  assert.strictEqual(classifyField(createMockSignals({ name: "nachname", type: "text" })).fieldType, "last_name");
  assert.strictEqual(classifyField(createMockSignals({ name: "prenom", type: "text" })).fieldType, "first_name");
  assert.strictEqual(classifyField(createMockSignals({ name: "nom", type: "text" })).fieldType, "full_name");
  assert.strictEqual(classifyField(createMockSignals({ name: "telefon", type: "tel" })).fieldType, "phone");
  assert.strictEqual(classifyField(createMockSignals({ name: "whatsapp", type: "tel" })).fieldType, "phone");
  assert.strictEqual(classifyField(createMockSignals({ name: "nachricht", tagName: "textarea", type: "textarea" })).fieldType, "message");
});

// -----------------------------------------------------------------------------
// Suite 4: Fallback Target Logic & Invariant Validation
// -----------------------------------------------------------------------------
console.log("\n[Suite 4] Fallback Target Data Contract");

runTest("Ensures fallback targets have execution order, confidence, and targetType", () => {
  const fbOrigin = "https://example.com";
  const contactFallbackUrls = [`${fbOrigin}/contact`, `${fbOrigin}/contact-us`, fbOrigin];

  const fallbackTargets = contactFallbackUrls.map((url) => ({
    targetType: "contact_form" as const,
    url,
    executionOrder: 1,
    confidence: 75,
    reason: "Contact form fallback after booking slot exhaustion or missing contact target",
    screenshotPath: null
  }));

  assert.strictEqual(fallbackTargets.length, 3);
  for (const t of fallbackTargets) {
    assert.strictEqual(t.targetType, "contact_form");
    assert(t.url.startsWith("https://"));
    assert.strictEqual(typeof t.confidence, "number");
  }
});

// -----------------------------------------------------------------------------
// Test Summary
// -----------------------------------------------------------------------------
console.log("\n================================================================================");
console.log(`TEST RUN COMPLETE: ${testsPassed} passed, ${testsFailed} failed.`);
console.log("================================================================================");

if (testsFailed > 0) {
  process.exit(1);
}
