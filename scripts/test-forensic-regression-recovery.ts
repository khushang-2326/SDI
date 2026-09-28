import http from "node:http";
import { submitContactForm } from "../services/contact-form-automation";
import { LeadData } from "../types/automation";

let server: http.Server;
let port = 4100;

const mockLead: LeadData = {
  fullName: "Alice Smith",
  email: "alice@example.com",
  mobile: "2125550199",
  companyName: "Acme Corp",
  address: "123 Main St, New York, NY 10001",
  message: "I am interested in learning more about your services."
};

function createServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const url = req.url || "/";

      // 1. Monthly Budget select
      if (url === "/budget-select") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <label for="budget">Monthly Budget *</label>
              <select id="budget" name="wpforms[fields][9]" required>
                <option value="">Select a Budget</option>
                <option value="1k-3k">$1,000 - $3,000</option>
                <option value="3k-5k">$3,000 - $5,000</option>
              </select>
              <label for="msg">Message *</label><textarea id="msg" name="msg" required></textarea>
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 2. Budget text field
      if (url === "/budget-text") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <label for="budget">Project Budget *</label><input id="budget" name="budget" required />
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 3. Services of Interest select
      if (url === "/services-select") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <label for="service">Services Interested In *</label>
              <select id="service" name="services" required>
                <option value="">-- Choose One --</option>
                <option value="seo">SEO & Content Marketing</option>
                <option value="web">Web Design</option>
              </select>
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 4. Preferred Service text
      if (url === "/preferred-service") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <label for="pref_service">Preferred Service *</label><input id="pref_service" name="form_fields[field_fe05696]" required />
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 5. Where did you hear about us?
      if (url === "/hear-about-us") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <label for="source">Where did you hear about us?*</label><input id="source" name="form_fields[field_069cbfe]" required />
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 6. Industry select
      if (url === "/industry-select") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <label for="ind">Industry *</label>
              <select id="ind" name="input_6" required>
                <option value="">Please Select</option>
                <option value="tech">Technology</option>
                <option value="health">Healthcare</option>
              </select>
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 7. Company Name
      if (url === "/company-name") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <label for="company">Company Name *</label><input id="company" name="wpforms[fields][6]" required />
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 8. Contact Number
      if (url === "/contact-number") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <label for="phone">Contact No(Required) *</label><input id="phone" name="input_4" required />
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 9. Subject
      if (url === "/subject-field") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <label for="subj">Subject*</label><input id="subj" name="input_3" required />
              <label for="msg">How can we help you?*</label><textarea id="msg" name="input_4" required></textarea>
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 10. Last Name
      if (url === "/last-name") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="fname">First Name *</label><input id="fname" name="wpforms[fields][4]" required />
              <label for="lname">Last Name *</label><input id="lname" name="wpforms[fields][5]" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 11. Hidden required honeypot
      if (url === "/honeypot-hidden") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <div style="display: none;">
                <label for="hp">Leave this field blank *</label>
                <input id="hp" name="item_meta[25]" required />
              </div>
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 12. "leave this field blank" text
      if (url === "/honeypot-label") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <label for="hp">If you are human, leave this field blank.</label>
              <input id="hp" name="item_meta[25]" required />
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 13. "leave this field empty"
      if (url === "/honeypot-empty") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <label for="hp">Please leave this field empty.</label>
              <input id="hp" name="wimq5hknds5j" required />
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 14. Off-screen honeypot
      if (url === "/honeypot-offscreen") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <div style="position: absolute; left: -9999px;">
                <label for="hp">Honeypot</label>
                <input id="hp" name="gform_hp" required />
              </div>
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 15. Math challenge (should be rejected/detected as challenge, NOT filled as ordinary text)
      if (url === "/math-challenge") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <label for="quiz">3+4 = *</label><input id="quiz" name="nf-field-57-spam" required />
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 16. Unknown required field (e.g. "Passport number") -> MUST NOT be fabricated
      if (url === "/unknown-required") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <label for="ssn">Social Security or Passport Number *</label><input id="ssn" name="national_identity_doc" required />
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // 17. Trailing-slash redirect
      if (url === "/redirect-slash") {
        res.writeHead(301, { Location: "/redirect-slash/" });
        res.end();
        return;
      }
      if (url === "/redirect-slash/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <form action="/submit" method="POST">
              <label for="name">Name *</label><input id="name" name="name" required />
              <label for="email">Email *</label><input id="email" name="email" type="email" required />
              <button type="submit">Submit</button>
            </form>
          </body></html>
        `);
        return;
      }

      // Default submit endpoint
      if (url === "/submit") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><h1>Thank you! Your message has been sent successfully.</h1></body></html>`);
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    s.listen(port, () => resolve(s));
  });
}

async function runTests() {
  console.log("Starting test server on port", port);
  server = await createServer();

  let passed = 0;
  let failed = 0;

  async function testCase(name: string, fn: () => Promise<boolean>) {
    try {
      const ok = await fn();
      if (ok) {
        console.log(`[PASS] ${name}`);
        passed++;
      } else {
        console.error(`[FAIL] ${name} (returned false)`);
        failed++;
      }
    } catch (err: any) {
      console.error(`[FAIL] ${name}: ${err?.message}`);
      failed++;
    }
  }

  console.log("\n==================================================");
  console.log("1. FIELD SEMANTICS & CATEGORICAL RESOLUTION");
  console.log("==================================================");

  await testCase("1. Monthly Budget select", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/budget-select`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return (res.status === "success" || res.status === "dry_run_ready_to_book") && res.errorMessage === null;
  });

  await testCase("2. Budget text field", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/budget-text`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return (res.status === "success" || res.status === "dry_run_ready_to_book") && res.errorMessage === null;
  });

  await testCase("3. Services of Interest select", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/services-select`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return (res.status === "success" || res.status === "dry_run_ready_to_book") && res.errorMessage === null;
  });

  await testCase("4. Preferred Service text", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/preferred-service`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return (res.status === "success" || res.status === "dry_run_ready_to_book") && res.errorMessage === null;
  });

  await testCase("5. Where did you hear about us? text", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/hear-about-us`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return (res.status === "success" || res.status === "dry_run_ready_to_book") && res.errorMessage === null;
  });

  await testCase("6. Industry select", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/industry-select`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return (res.status === "success" || res.status === "dry_run_ready_to_book") && res.errorMessage === null;
  });

  await testCase("7. Company Name input", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/company-name`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return (res.status === "success" || res.status === "dry_run_ready_to_book") && res.errorMessage === null;
  });

  await testCase("8. Contact Number input", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/contact-number`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return (res.status === "success" || res.status === "dry_run_ready_to_book") && res.errorMessage === null;
  });

  await testCase("9. Subject and textarea input", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/subject-field`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return (res.status === "success" || res.status === "dry_run_ready_to_book") && res.errorMessage === null;
  });

  await testCase("10. Last Name input", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/last-name`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return (res.status === "success" || res.status === "dry_run_ready_to_book") && res.errorMessage === null;
  });

  console.log("\n==================================================");
  console.log("2. HONEYPOT & ANTI-SPAM PROTECTION");
  console.log("==================================================");

  await testCase("11. Hidden required honeypot (must succeed without filling honeypot)", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/honeypot-hidden`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return (res.status === "success" || res.status === "dry_run_ready_to_book") && res.errorMessage === null;
  });

  await testCase("12. 'leave this field blank' honeypot", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/honeypot-label`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return (res.status === "success" || res.status === "dry_run_ready_to_book") && res.errorMessage === null;
  });

  await testCase("13. 'Please leave this field empty' honeypot", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/honeypot-empty`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return (res.status === "success" || res.status === "dry_run_ready_to_book") && res.errorMessage === null;
  });

  await testCase("14. Off-screen CSS honeypot", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/honeypot-offscreen`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return (res.status === "success" || res.status === "dry_run_ready_to_book") && res.errorMessage === null;
  });

  await testCase("15. Math challenge remains protected (fails REQUIRED_FIELD_UNMAPPED, not fabricated)", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/math-challenge`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return res.status === "failed" && (res.errorMessage || "").includes("REQUIRED_FIELD_UNMAPPED");
  });

  await testCase("16. Unknown required field NOT fabricated (fails REQUIRED_FIELD_UNMAPPED)", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/unknown-required`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return res.status === "failed" && (res.errorMessage || "").includes("REQUIRED_FIELD_UNMAPPED");
  });

  console.log("\n==================================================");
  console.log("3. REDIRECTS & DISCOVERY RESILIENCE");
  console.log("==================================================");

  await testCase("17. Trailing slash redirect navigation", async () => {
    const res = await submitContactForm({
      websiteUrl: `http://127.0.0.1:${port}/redirect-slash`,
      leadData: mockLead,
      headless: true,
      submit: false,
      timeoutMs: 10000
    });
    return (res.status === "success" || res.status === "dry_run_ready_to_book") && res.errorMessage === null;
  });

  server.close();

  console.log("\n==================================================");
  console.log(`TOTAL: ${passed} / ${passed + failed} PASS (${((passed / (passed + failed)) * 100).toFixed(1)}%)`);
  console.log("==================================================");

  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error("Test suite threw uncaught error:", e);
  process.exit(1);
});
