import http from "http";
import { submitContactForm } from "../services/contact-form-automation";

async function runSuccessRulesTestSuite() {
  console.log("=== Testing New Success / Failure Rules Suite ===");

  let currentHtml = "";
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(currentHtml);
  });

  const PORT = 45892;
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", () => resolve()));
  console.log(`Local test fixture server listening on http://127.0.0.1:${PORT}`);

  const testLeadData = {
    fullName: "John Doe",
    email: "john@example.com",
    mobile: "2125550199",
    companyName: "Acme Corp",
    message: "Inquiry about your services."
  };

  try {
    // -------------------------------------------------------------
    // Scenario 1: Submit clicked, NO success message, NO error detected -> PASS
    // -------------------------------------------------------------
    console.log("\n--- Scenario 1: Submit clicked, NO success message, NO error ---");
    currentHtml = `
      <!DOCTYPE html>
      <html>
      <body>
        <form id="f1" action="javascript:void(0)" onsubmit="/* does not show message */">
          <input type="text" name="name" required />
          <input type="email" name="email" required />
          <textarea name="message"></textarea>
          <button type="submit" id="btn-submit">Submit Form</button>
        </form>
      </body>
      </html>
    `;

    const res1 = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${PORT}/no-msg`,
      leadData: testLeadData,
      headless: true,
      submit: true,
      skipPersist: true
    });

    console.log("Scenario 1 Result:", {
      status: res1.status,
      message: res1.message,
      errorMessage: res1.errorMessage
    });

    if (res1.status !== "success") {
      throw new Error(`Scenario 1 failed! Expected 'success' but got '${res1.status}' with error: ${res1.errorMessage}`);
    }
    console.log("✅ Scenario 1 PASSED: Marked as PASS even without a success message!");

    // -------------------------------------------------------------
    // Scenario 2: Submit clicked, explicit success message displayed -> PASS
    // -------------------------------------------------------------
    console.log("\n--- Scenario 2: Submit clicked, explicit success message displayed ---");
    currentHtml = `
      <!DOCTYPE html>
      <html>
      <body>
        <div id="wrapper">
          <form id="f2" action="javascript:void(0)" onsubmit="document.getElementById('msg').style.display='block'; return false;">
            <input type="text" name="name" required />
            <input type="email" name="email" required />
            <textarea name="message"></textarea>
            <button type="submit" id="btn-submit">Submit Form</button>
          </form>
          <div id="msg" class="alert-success" style="display:none">Thank you! Your message has been sent.</div>
        </div>
      </body>
      </html>
    `;

    const res2 = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${PORT}/with-msg`,
      leadData: testLeadData,
      headless: true,
      submit: true,
      skipPersist: true
    });

    console.log("Scenario 2 Result:", {
      status: res2.status,
      message: res2.message,
      errorMessage: res2.errorMessage
    });

    if (res2.status !== "success") {
      throw new Error(`Scenario 2 failed! Expected 'success' but got '${res2.status}' with error: ${res2.errorMessage}`);
    }
    console.log("✅ Scenario 2 PASSED: Marked as PASS with verified success confirmation!");

    // -------------------------------------------------------------
    // Scenario 3: Form displays a validation or submission error -> FAIL
    // -------------------------------------------------------------
    console.log("\n--- Scenario 3: Form displays a validation or submission error ---");
    currentHtml = `
      <!DOCTYPE html>
      <html>
      <body>
        <div id="wrapper">
          <form id="f3" action="javascript:void(0)" onsubmit="document.getElementById('err').style.display='block'; return false;">
            <input type="text" name="name" required />
            <input type="email" name="email" required />
            <textarea name="message"></textarea>
            <button type="submit" id="btn-submit">Submit Form</button>
          </form>
          <div id="err" class="alert-danger error-message" style="display:none">Error: Submission failed, please try again.</div>
        </div>
      </body>
      </html>
    `;

    const res3 = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${PORT}/error`,
      leadData: testLeadData,
      headless: true,
      submit: true,
      skipPersist: true
    });

    console.log("Scenario 3 Result:", {
      status: res3.status,
      errorMessage: res3.errorMessage
    });

    if (res3.status !== "failed" || !res3.errorMessage?.includes("Website rejected submission")) {
      throw new Error(`Scenario 3 failed! Expected status='failed' with error message but got status='${res3.status}'`);
    }
    console.log("✅ Scenario 3 PASSED: Properly marked as FAIL when on-page error is displayed!");

    // -------------------------------------------------------------
    // Scenario 4: Submit button missing / cannot be clicked -> FAIL
    // -------------------------------------------------------------
    console.log("\n--- Scenario 4: Submit button missing / cannot be clicked ---");
    currentHtml = `
      <!DOCTYPE html>
      <html>
      <body>
        <div>Just a header, no submit button anywhere.</div>
      </body>
      </html>
    `;

    const res4 = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${PORT}/no-submit`,
      leadData: testLeadData,
      headless: true,
      submit: true,
      skipPersist: true
    });

    console.log("Scenario 4 Result:", {
      status: res4.status,
      errorMessage: res4.errorMessage
    });

    if (res4.status !== "failed" || !res4.errorMessage?.includes("submit button")) {
      throw new Error(`Scenario 4 failed! Expected status='failed' with submit button error but got status='${res4.status}'`);
    }
    console.log("✅ Scenario 4 PASSED: Properly marked as FAIL when submit button cannot be clicked!");

    console.log("\n========================================================");
    console.log("🎉 ALL 4 SUCCESS / FAILURE SCENARIOS VALIDATED 100% SUCCESSFULLY!");
    console.log("========================================================");
  } finally {
    server.close();
  }
}

runSuccessRulesTestSuite().catch(err => {
  console.error("Test Suite Fatal Error:", err);
  process.exit(1);
});
