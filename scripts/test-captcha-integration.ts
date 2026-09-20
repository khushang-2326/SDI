import http from "node:http";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable";
import { detectUnsupportedVerification } from "../services/verification-detector";
import { detectCaptchaChallenge } from "../services/captcha/captcha-detector";
import { applyCaptchaSolutionToPage } from "../services/captcha/controlled-page-adapter";
import { handleCaptchaSolvingForTarget, getActiveCaptchaTask } from "../services/captcha/captcha-orchestrator";
import {
  isAuthorizedCaptchaTestTarget,
  registerAuthorizedCaptchaTestHost,
  clearAuthorizedCaptchaTestHosts
} from "../services/captcha/test-environment";
import { MockSolver } from "../services/captcha/mock-solver";
import { SolverFactory } from "../services/captcha/solver-factory";
import { evaluateFinalAutomationSuccess } from "../services/success-invariants";
import { submitContactForm } from "../services/contact-form-automation";
import { prisma } from "../lib/prisma";
import type { LeadData } from "../types/automation";

let server: http.Server;
let serverPort: number;
let serverBaseUrl: string;

const HTML_RECAPTCHA_FORM = `
<!DOCTYPE html>
<html>
<head><title>Controlled Test Page - reCAPTCHA</title></head>
<body>
  <h2>Contact Support (Authorized Test Environment)</h2>
  <form id="contact-form" action="/submit" method="POST" onsubmit="return handleFormSubmit(event)">
    <label for="fullName">Full Name</label>
    <input type="text" id="fullName" name="fullName" required />

    <label for="email">Email</label>
    <input type="email" id="email" name="email" required />

    <label for="message">Message</label>
    <textarea id="message" name="message" required></textarea>

    <!-- reCAPTCHA Container -->
    <div class="g-recaptcha" data-sitekey="6Le-test-sitekey-recaptcha-v2" data-callback="onRecaptchaSuccess" style="display:block; width:304px; height:78px; margin: 10px 0; border:1px solid #ccc;">
      reCAPTCHA v2 Widget Placeholder
    </div>
    <textarea id="g-recaptcha-response" name="g-recaptcha-response" style="display:none;"></textarea>

    <button type="submit" id="submit-btn">Send Message</button>
  </form>
  <div id="status-message"></div>

  <script>
    let captchaSolved = false;
    function onRecaptchaSuccess(token) {
      captchaSolved = true;
      document.getElementById("status-message").innerText = "reCAPTCHA Verified: " + token;
    }
    function handleFormSubmit(e) {
      e.preventDefault();
      const token = document.getElementById("g-recaptcha-response").value;
      if (!token && !captchaSolved) {
        document.getElementById("status-message").innerText = "Error: Please complete the CAPTCHA.";
        return false;
      }
      document.body.innerHTML = '<div class="success-alert">Thank you! Your message has been sent successfully.</div>';
      return false;
    }
  </script>
</body>
</html>
`;

const HTML_HCAPTCHA_FORM = `
<!DOCTYPE html>
<html>
<head><title>Controlled Test Page - hCaptcha</title></head>
<body>
  <h2>Contact Sales (Authorized Test Environment)</h2>
  <form id="hcaptcha-form" action="/submit" method="POST" onsubmit="return handleHSubmit(event)">
    <label for="name">Name</label>
    <input type="text" id="name" name="name" required />

    <label for="email">Email</label>
    <input type="email" id="email" name="email" required />

    <label for="message">Message</label>
    <textarea id="message" name="message" required></textarea>

    <!-- hCaptcha Container -->
    <div class="h-captcha" data-sitekey="hcap-test-sitekey-12345" data-callback="onHCaptchaSuccess" style="display:block; width:304px; height:78px; margin: 10px 0; border:1px solid #ccc;">
      hCaptcha Widget Placeholder
    </div>
    <textarea name="h-captcha-response" id="h-captcha-response" style="display:none;"></textarea>

    <button type="submit" id="submit-btn">Submit Inquiry</button>
  </form>
  <div id="h-status"></div>

  <script>
    let hSolved = false;
    function onHCaptchaSuccess(token) {
      hSolved = true;
      document.getElementById("h-status").innerText = "hCaptcha Verified: " + token;
    }
    function handleHSubmit(e) {
      e.preventDefault();
      const token = document.getElementById("h-captcha-response").value;
      if (!token && !hSolved) {
        document.getElementById("h-status").innerText = "Error: Please complete hCaptcha.";
        return false;
      }
      document.body.innerHTML = '<div class="success-alert">Thank you! Your message has been sent successfully.</div>';
      return false;
    }
  </script>
</body>
</html>
`;

const HTML_TURNSTILE_FORM = `
<!DOCTYPE html>
<html>
<head><title>Controlled Test Page - Cloudflare Turnstile</title></head>
<body>
  <h2>Contact Us (Authorized Test Environment)</h2>
  <form id="turnstile-form" action="/submit" method="POST" onsubmit="return handleTurnstileSubmit(event)">
    <label for="fullName">Full Name</label>
    <input type="text" id="fullName" name="fullName" required />

    <label for="email">Email</label>
    <input type="email" id="email" name="email" required />

    <label for="message">Message</label>
    <textarea id="message" name="message" required></textarea>

    <!-- Turnstile Container -->
    <div class="cf-turnstile" data-sitekey="0x4AAAAAAATestTurnstileKey" data-callback="onTurnstileSuccess" style="display:block; width:300px; height:65px; margin: 10px 0; border:1px solid #ccc;">
      Turnstile Widget Placeholder
    </div>
    <input type="hidden" name="cf-turnstile-response" id="cf-turnstile-response" />

    <button type="submit" id="submit-btn">Send Message</button>
  </form>

  <script>
    let turnstileSolved = false;
    function onTurnstileSuccess(token) {
      turnstileSolved = true;
    }
    function handleTurnstileSubmit(e) {
      e.preventDefault();
      const token = document.getElementById("cf-turnstile-response").value;
      if (!token && !turnstileSolved) {
        return false;
      }
      document.body.innerHTML = '<div class="confirmation-box">Thank you! Your message has been sent successfully.</div>';
      return false;
    }
  </script>
</body>
</html>
`;

function startLocalTestServer(): Promise<number> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const url = req.url || "/";
      res.writeHead(200, { "Content-Type": "text/html" });
      if (url.includes("/hcaptcha")) {
        res.end(HTML_HCAPTCHA_FORM);
      } else if (url.includes("/turnstile")) {
        res.end(HTML_TURNSTILE_FORM);
      } else {
        res.end(HTML_RECAPTCHA_FORM);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as any;
      resolve(address.port);
    });
  });
}

const testLead: LeadData = {
  fullName: "Sarah Connor",
  email: "sarah.connor@example.com",
  mobile: "+14155552672",
  message: "Hello, this is a test lead for CAPTCHA integration testing.",
  companyName: "Cyberdyne Systems"
};

let passedCount = 0;
let failedCount = 0;

function assert(description: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`  ✓ [PASS] ${description}`);
    passedCount++;
  } else {
    console.error(`  ✗ [FAIL] ${description} ${details ? `(${details})` : ""}`);
    failedCount++;
  }
}

async function runCaptchaIntegrationTests() {
  console.log("================================================================");
  console.log("SDI CAPTCHA INTEGRATION TEST SUITE (CONTROLLED ENVIRONMENT)");
  console.log("================================================================\n");

  serverPort = await startLocalTestServer();
  serverBaseUrl = `http://127.0.0.1:${serverPort}`;
  console.log(`Local test server listening at: ${serverBaseUrl}\n`);

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: await getChromiumExecutablePath(),
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    // -------------------------------------------------------------
    // Test 1: Test Environment Protection & Domain Authorization
    // -------------------------------------------------------------
    console.log("Test 1: Test Environment Protection & Authorization");
    {
      const localAllowed = isAuthorizedCaptchaTestTarget("http://127.0.0.1:3000/contact");
      const localhostAllowed = isAuthorizedCaptchaTestTarget("http://localhost:8080/form");
      const mockDomainAllowed = isAuthorizedCaptchaTestTarget("http://mock-captcha.test/page");
      const arbitraryProductionRejected = isAuthorizedCaptchaTestTarget("https://arbitrary-production-target.com/contact");
      const clientDomainRejected = isAuthorizedCaptchaTestTarget("https://real-client-business.com/");

      assert("127.0.0.1 is authorized test target", localAllowed);
      assert("localhost is authorized test target", localhostAllowed);
      assert("mock-captcha.test is authorized test target", mockDomainAllowed);
      assert("Arbitrary production target is strictly rejected", !arbitraryProductionRejected);
      assert("Client production domain is strictly rejected", !clientDomainRejected);

      // Register dynamic host
      registerAuthorizedCaptchaTestHost("authorized-staging.local");
      assert("Registered staging host is authorized", isAuthorizedCaptchaTestTarget("http://authorized-staging.local/test"));
      clearAuthorizedCaptchaTestHosts();
      assert("Cleared staging host is no longer authorized", !isAuthorizedCaptchaTestTarget("http://authorized-staging.local/test"));
    }
    console.log();

    // -------------------------------------------------------------
    // Test 2: CAPTCHA Challenge Detection across Variants
    // -------------------------------------------------------------
    console.log("Test 2: CAPTCHA Challenge Detection across Variants");
    {
      const context = await browser.newContext();
      const page = await context.newPage();

      // 2a. reCAPTCHA v2 detection
      await page.goto(`${serverBaseUrl}/recaptcha`);
      const recaptchaChallenge = await detectCaptchaChallenge(page, `${serverBaseUrl}/recaptcha`);
      assert("reCAPTCHA v2 challenge detected", Boolean(recaptchaChallenge && recaptchaChallenge.type === "recaptcha_v2"));
      assert("reCAPTCHA siteKey extracted correctly", recaptchaChallenge?.siteKey === "6Le-test-sitekey-recaptcha-v2");
      assert("reCAPTCHA callback extracted", recaptchaChallenge?.callbackName === "onRecaptchaSuccess");

      // 2b. hCaptcha detection
      await page.goto(`${serverBaseUrl}/hcaptcha`);
      const hcaptchaChallenge = await detectCaptchaChallenge(page, `${serverBaseUrl}/hcaptcha`);
      assert("hCaptcha challenge detected", Boolean(hcaptchaChallenge && hcaptchaChallenge.type === "hcaptcha"));
      assert("hCaptcha siteKey extracted correctly", hcaptchaChallenge?.siteKey === "hcap-test-sitekey-12345");
      assert("hCaptcha callback extracted", hcaptchaChallenge?.callbackName === "onHCaptchaSuccess");

      // 2c. Turnstile detection
      await page.goto(`${serverBaseUrl}/turnstile`);
      const turnstileChallenge = await detectCaptchaChallenge(page, `${serverBaseUrl}/turnstile`);
      assert("Turnstile challenge detected", Boolean(turnstileChallenge && turnstileChallenge.type === "turnstile"));
      assert("Turnstile siteKey extracted correctly", turnstileChallenge?.siteKey === "0x4AAAAAAATestTurnstileKey");
      assert("Turnstile callback extracted", turnstileChallenge?.callbackName === "onTurnstileSuccess");

      await page.close();
      await context.close();
    }
    console.log();

    // -------------------------------------------------------------
    // Test 3: Provider Task Creation & Single-Target Isolation
    // -------------------------------------------------------------
    console.log("Test 3: Provider Task Creation, Polling & Target Isolation");
    {
      const mockSolver = new MockSolver("test-key");
      let createdTaskId = "";
      mockSolver.setMockBehavior({ delayMs: 50 });

      const solveResult = await mockSolver.solveReCaptcha(
        "test-sitekey-123",
        "http://127.0.0.1/test",
        "v2",
        undefined,
        {
          onTaskCreated: (id) => {
            createdTaskId = id;
          }
        }
      );

      assert("Task ID generated on task creation", Boolean(createdTaskId && createdTaskId.startsWith("mock-task-")));
      assert("Solver returned matching task ID", solveResult.taskId === createdTaskId);
      assert("Solver returned valid non-empty token", solveResult.token.includes("test-sitekey-123"));
    }
    console.log();

    // -------------------------------------------------------------
    // Test 4: Controlled Test-Page Adapter Injection & Callback Trigger
    // -------------------------------------------------------------
    console.log("Test 4: Controlled Test-Page Adapter Injection");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${serverBaseUrl}/recaptcha`);

      const challenge = await detectCaptchaChallenge(page, `${serverBaseUrl}/recaptcha`);
      if (!challenge) throw new Error("Challenge detection failed");

      const adapterResult = await applyCaptchaSolutionToPage(page, challenge, {
        token: "test-verified-token-xyz-123"
      });

      assert("Adapter successfully applied solution", adapterResult.applied);
      assert("Adapter injected into g-recaptcha-response", adapterResult.details.includes("g-recaptcha-response"));

      // Verify DOM value in page
      const domToken = await page.inputValue("#g-recaptcha-response").catch(() => "");
      const statusText = await page.innerText("#status-message").catch(() => "");

      assert("DOM textarea received token", domToken === "test-verified-token-xyz-123");
      assert("Page callback window.onRecaptchaSuccess executed", statusText.includes("test-verified-token-xyz-123"));

      await page.close();
      await context.close();
    }
    console.log();

    // -------------------------------------------------------------
    // Test 5: Provider Failure Handling (Graceful Catch & Status)
    // -------------------------------------------------------------
    console.log("Test 5: Provider Failure Handling");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${serverBaseUrl}/recaptcha`);

      MockSolver.setDefaultBehavior({
        shouldFail: true,
        failReason: "Simulated 2Captcha insufficient funds error"
      });

      const orchestratorResult = await handleCaptchaSolvingForTarget({
        page,
        websiteUrl: `${serverBaseUrl}/recaptcha`,
        preferredProvider: "mock",
        apiKey: "test-key",
        timeoutMs: 5000
      });

      assert("Orchestrator reported failed solve", !orchestratorResult.solved);
      assert("State transitioned to FAILED", orchestratorResult.state === "FAILED");
      assert("Error message contains failure reason", Boolean(orchestratorResult.errorMessage?.includes("insufficient funds")));

      // Reset mock solver behavior
      MockSolver.resetDefaultBehavior();
      await page.close();
      await context.close();
    }
    console.log();

    // -------------------------------------------------------------
    // Test 6: Bounded Timeout & Cancellation Handling
    // -------------------------------------------------------------
    console.log("Test 6: Bounded Timeout Handling");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${serverBaseUrl}/recaptcha`);

      MockSolver.setDefaultBehavior({
        shouldTimeout: true
      });

      const orchestratorResult = await handleCaptchaSolvingForTarget({
        page,
        websiteUrl: `${serverBaseUrl}/recaptcha`,
        preferredProvider: "mock",
        apiKey: "test-key",
        timeoutMs: 1000
      });

      assert("Orchestrator timed out cleanly", !orchestratorResult.solved);
      assert("State transitioned to TIMEOUT", orchestratorResult.state === "TIMEOUT");

      // Reset mock solver behavior
      MockSolver.resetDefaultBehavior();
      await page.close();
      await context.close();
    }
    console.log();

    // -------------------------------------------------------------
    // Test 7: Missing API Key Handling
    // -------------------------------------------------------------
    console.log("Test 7: Missing API Key & Provider Fallback");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${serverBaseUrl}/recaptcha`);

      // TwoCaptcha solver without API key
      const twoCaptchaSolver = SolverFactory.getSolver("2captcha", "");
      const validation = await twoCaptchaSolver.validateKey();
      assert("TwoCaptchaSolver rejects empty key on validation", Boolean(!validation.success && validation.message?.includes("missing")));

      await page.close();
      await context.close();
    }
    console.log();

    // -------------------------------------------------------------
    // Test 8: Unauthorized Target Rejection (Production Protection)
    // -------------------------------------------------------------
    console.log("Test 8: Unauthorized Target Rejection (Production Protection)");
    {
      const context = await browser.newContext();
      const page = await context.newPage();

      const prodUrl = "https://unauthorized-production-domain.com/contact";
      const orchestratorResult = await handleCaptchaSolvingForTarget({
        page,
        websiteUrl: prodUrl,
        timeoutMs: 5000
      });

      assert("Automated solving strictly rejected for production domain", !orchestratorResult.solved);
      assert("State set to UNAUTHORIZED", orchestratorResult.state === "UNAUTHORIZED");
      assert("Reason specifies unauthorized environment", Boolean(orchestratorResult.reason?.includes("not an authorized")));

      await page.close();
      await context.close();
    }
    console.log();

    // -------------------------------------------------------------
    // Test 9: End-to-End Automation with CAPTCHA Solve on Test Page
    // -------------------------------------------------------------
    console.log("Test 9: End-to-End Automation on Controlled Test Page");
    {
      MockSolver.resetDefaultBehavior();
      const context = await browser.newContext();
      const targetUrl = `${serverBaseUrl}/recaptcha`;

      const result = await submitContactForm({
        websiteUrl: targetUrl,
        leadData: testLead,
        submit: true,
        browserContext: context,
        skipPersist: true,
        timeoutMs: 15000
      });

      if (result.status !== "success") {
        console.error("  [Test 9 Debug] Error message:", result.errorMessage);
      }

      assert("submitContactForm completed successfully", result.status === "success", result.errorMessage || undefined);
      assert("Form fields detected", (result.fieldsDetectedCount ?? 0) >= 3);
      assert("Form fields filled", (result.filledFieldsCount ?? 0) >= 3);
      assert("Form fields verified", (result.verifiedFieldsCount ?? 0) >= 3);
      assert("No unmapped required fields", (result.unmappedRequiredFields ?? []).length === 0);

      await context.close();
    }
    console.log();

    // -------------------------------------------------------------
    // Test 10: Authoritative Central Success Invariant Verification
    // -------------------------------------------------------------
    console.log("Test 10: Authoritative Central Success Invariant Verification");
    {
      // Valid solved form run
      const validRun = evaluateFinalAutomationSuccess({
        targetType: "contact_form",
        status: "success",
        fieldsDetected: 3,
        fieldsClassified: 3,
        fieldsFilled: 3,
        fieldsVerified: 3,
        unmappedRequiredFields: [],
        submitControlFound: true,
        submitControlScore: 100,
        errorMessage: null,
        discoveryReason: null
      });

      assert("Solved & confirmed submission passes success invariant", validRun.isSuccess && validRun.taxonomyCategory === "SUCCESS_CONTACT_FORM");

      // Unsolved CAPTCHA on arbitrary production site -> INELIGIBLE_CAPTCHA_HUMAN_VERIFICATION
      const unsolvedCaptchaRun = evaluateFinalAutomationSuccess({
        targetType: "contact_form",
        status: "failed",
        fieldsDetected: 0,
        fieldsClassified: 0,
        fieldsFilled: 0,
        fieldsVerified: 0,
        unmappedRequiredFields: [],
        submitControlFound: false,
        submitControlScore: 0,
        errorMessage: "Unsupported verification: reCAPTCHA detected. Manual verification required.",
        discoveryReason: null
      });

      assert("Unsolved production CAPTCHA correctly categorised as INELIGIBLE", !unsolvedCaptchaRun.isSuccess && unsolvedCaptchaRun.taxonomyCategory === "INELIGIBLE_CAPTCHA_HUMAN_VERIFICATION");
    }
    console.log();

    // -------------------------------------------------------------
    // Test 11: BrowserContext Isolation & Resource Cleanup
    // -------------------------------------------------------------
    console.log("Test 11: Concurrent Target & BrowserContext Isolation");
    {
      MockSolver.resetDefaultBehavior();
      const context1 = await browser.newContext();
      const context2 = await browser.newContext();

      const [res1, res2] = await Promise.all([
        submitContactForm({
          websiteUrl: `${serverBaseUrl}/recaptcha`,
          leadData: { ...testLead, fullName: "Worker 1 Lead" },
          submit: true,
          browserContext: context1,
          skipPersist: true,
          timeoutMs: 15000
        }),
        submitContactForm({
          websiteUrl: `${serverBaseUrl}/hcaptcha`,
          leadData: { ...testLead, fullName: "Worker 2 Lead" },
          submit: true,
          browserContext: context2,
          skipPersist: true,
          timeoutMs: 15000
        })
      ]);

      if (res1.status !== "success") console.error("  [Worker 1 Debug] Error:", res1.errorMessage);
      if (res2.status !== "success") console.error("  [Worker 2 Debug] Error:", res2.errorMessage);

      assert("Worker 1 finished successfully in isolated context", res1.status === "success", res1.errorMessage || undefined);
      assert("Worker 2 finished successfully in isolated context", res2.status === "success", res2.errorMessage || undefined);

      await context1.close();
      await context2.close();
    }
    console.log();

  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (server) server.close();
  }

  console.log("================================================================");
  console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("================================================================");

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

void runCaptchaIntegrationTests().finally(async () => {
  await prisma.$disconnect().catch(() => undefined);
});
