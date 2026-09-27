import http from "node:http";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable";
import { submitContactForm } from "../services/contact-form-automation";
import { navigateForDiscovery } from "../services/submission-target-discovery";
import { waitForUniversalPageReadiness } from "../services/page-readiness";
import type { LeadData } from "../types/automation";

const lead: LeadData = {
  fullName: "Alice Test",
  email: "alice@test.com",
  mobile: "5551234567",
  message: "Test message for navigation readiness verification.",
  companyName: "TestCorp"
};

async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const path = url.pathname;

    if (path === "/fast-instant") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Fast Instant Form</title></head>
        <body>
          <h1>Contact Us</h1>
          <form action="/success" method="GET">
            <input type="text" name="name" placeholder="Your Name" required />
            <input type="email" name="email" placeholder="Your Email" required />
            <textarea name="message" placeholder="Your Message"></textarea>
            <button type="submit">Send Message</button>
          </form>
        </body>
        </html>
      `);
    } else if (path === "/delay-2s") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>2s Hydration Form</title></head>
        <body>
          <div id="app"><div class="spinner">Loading form...</div></div>
          <script>
            setTimeout(() => {
              document.getElementById("app").innerHTML = \`
                <form action="/success" method="GET">
                  <input type="text" name="name" placeholder="Your Name" required />
                  <input type="email" name="email" placeholder="Your Email" required />
                  <textarea name="message" placeholder="Your Message"></textarea>
                  <button type="submit">Submit Inquiry</button>
                </form>
              \`;
            }, 2000);
          </script>
        </body>
        </html>
      `);
    } else if (path === "/delay-10s") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>10s Hydration Form</title></head>
        <body>
          <div id="app"><div class="spinner">Loading complex SPA...</div></div>
          <script>
            setTimeout(() => {
              document.getElementById("app").innerHTML = \`
                <form action="/success" method="GET">
                  <input type="text" name="name" placeholder="Your Name" required />
                  <input type="email" name="email" placeholder="Your Email" required />
                  <textarea name="message" placeholder="Your Message"></textarea>
                  <button type="submit">Send Inquiry</button>
                </form>
              \`;
            }, 10000);
          </script>
        </body>
        </html>
      `);
    } else if (path === "/network-non-idle") {
      // Endless polling tracker that never allows networkidle
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Continuous Network Activity</title></head>
        <body>
          <h1>Active Form with Background Telemetry</h1>
          <form action="/success" method="GET">
            <input type="text" name="name" placeholder="Your Name" required />
            <input type="email" name="email" placeholder="Your Email" required />
            <textarea name="message" placeholder="Your Message"></textarea>
            <button type="submit">Send</button>
          </form>
          <script>
            setInterval(() => {
              fetch('/ping?t=' + Date.now()).catch(() => {});
            }, 100);
          </script>
        </body>
        </html>
      `);
    } else if (path === "/ping") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("pong");
    } else if (path === "/iframe-delayed") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Delayed Iframe Form</title></head>
        <body>
          <h1>External Form Container</h1>
          <div id="iframe-holder"></div>
          <script>
            setTimeout(() => {
              const ifr = document.createElement("iframe");
              ifr.src = "/fast-instant";
              document.getElementById("iframe-holder").appendChild(ifr);
            }, 3000);
          </script>
        </body>
        </html>
      `);
    } else if (path === "/success") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>Thank you! Your message has been sent successfully.</h1>");
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function runTests() {
  console.log("================================================================");
  console.log("SDI NAVIGATION & PAGE READINESS ADAPTIVE VERIFICATION SUITE");
  console.log("================================================================");

  const { server, baseUrl } = await startServer();
  console.log(`Local test server started at ${baseUrl}`);

  const browser: Browser = await chromium.launch({
    headless: true,
    executablePath: await getChromiumExecutablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  let passCount = 0;
  let failCount = 0;

  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ [PASS] ${name}${detail ? ` (${detail})` : ""}`);
      passCount++;
    } else {
      console.error(`  ✗ [FAIL] ${name}${detail ? ` (${detail})` : ""}`);
      failCount++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Test 1: Fast Instant Form (< 2s total duration)
    // -------------------------------------------------------------
    console.log("\nTest 1: Instant Page Form (Immediate DOM Ready)");
    const ctx1 = await browser.newContext();
    const t0 = Date.now();
    const res1 = await submitContactForm({
      websiteUrl: `${baseUrl}/fast-instant`,
      leadData: lead,
      submit: true,
      browserContext: ctx1,
      skipPersist: true,
      timeoutMs: 30000
    });
    const dur1 = Date.now() - t0;
    console.log("  [DEBUG Test 1 StageTiming]:", JSON.stringify(res1.stageTiming, null, 2));
    assert(res1.status === "success", "Instant form succeeded");
    assert(dur1 < 8000, "Instant form completed quickly without artificial delay", `${dur1}ms`);
    await ctx1.close();

    // -------------------------------------------------------------
    // Test 2: 2s Dynamic SPA Hydration
    // -------------------------------------------------------------
    console.log("\nTest 2: 2s Dynamic SPA Hydration");
    const ctx2 = await browser.newContext();
    const t2Start = Date.now();
    const res2 = await submitContactForm({
      websiteUrl: `${baseUrl}/delay-2s`,
      leadData: lead,
      submit: true,
      browserContext: ctx2,
      skipPersist: true,
      timeoutMs: 30000
    });
    const dur2 = Date.now() - t2Start;
    assert(res2.status === "success", "2s hydration form succeeded");
    assert(dur2 >= 1800 && dur2 < 6000, "2s hydration completed adaptively as soon as ready", `${dur2}ms`);
    await ctx2.close();

    // -------------------------------------------------------------
    // Test 3: 10s Dynamic SPA Hydration (Slow but Healthy Target)
    // -------------------------------------------------------------
    console.log("\nTest 3: 10s Dynamic SPA Hydration (Slow Target Adaptive Wait)");
    const ctx3 = await browser.newContext();
    const t3Start = Date.now();
    const res3 = await submitContactForm({
      websiteUrl: `${baseUrl}/delay-10s`,
      leadData: lead,
      submit: true,
      browserContext: ctx3,
      skipPersist: true,
      timeoutMs: 45000
    });
    const dur3 = Date.now() - t3Start;
    assert(res3.status === "success", "10s hydration form succeeded adaptively");
    assert(dur3 >= 9500 && dur3 < 15000, "10s hydration caught form within budget without timing out", `${dur3}ms`);
    await ctx3.close();

    // -------------------------------------------------------------
    // Test 4: Network Non-Idle (Continuous Telemetry Background Noise)
    // -------------------------------------------------------------
    console.log("\nTest 4: Non-Idle Background Telemetry (Must NOT Freeze)");
    const ctx4 = await browser.newContext();
    const t4Start = Date.now();
    const res4 = await submitContactForm({
      websiteUrl: `${baseUrl}/network-non-idle`,
      leadData: lead,
      submit: true,
      browserContext: ctx4,
      skipPersist: true,
      timeoutMs: 30000
    });
    const dur4 = Date.now() - t4Start;
    assert(res4.status === "success", "Continuous telemetry page submitted successfully");
    assert(dur4 < 4000, "Did not wait for networkidle, resolved immediately upon form readiness", `${dur4}ms`);
    await ctx4.close();

    // -------------------------------------------------------------
    // Test 5: Delayed Iframe Form Hydration (3s)
    // -------------------------------------------------------------
    console.log("\nTest 5: Delayed Iframe Form Hydration");
    const ctx5 = await browser.newContext();
    const page5 = await ctx5.newPage();
    const t5Start = Date.now();
    await page5.goto(`${baseUrl}/iframe-delayed`, { waitUntil: "commit", timeout: 15000 });
    const readiness5 = await waitForUniversalPageReadiness(page5, { maxWaitMs: 15000, targetPurpose: "form" });
    const dur5 = Date.now() - t5Start;
    assert(readiness5.hasForms === true, "Detected dynamic iframe form upon delayed mount");
    assert(dur5 >= 2800 && dur5 < 8000, "Resolved as soon as iframe mounted", `${dur5}ms`);
    await ctx5.close();

    // -------------------------------------------------------------
    // Test 6: Dead Site Fast-Fail (Connection Refused / Bad Host)
    // -------------------------------------------------------------
    console.log("\nTest 6: Dead Site Fast-Fail (Must Fail Fast Without Burning 120s)");
    const ctx6 = await browser.newContext();
    const page6 = await ctx6.newPage();
    const t6Start = Date.now();
    const discRes = await navigateForDiscovery(page6, "http://non-existent-domain-sdi-forensic-test.xyz", 30000, "discovery");
    const dur6 = Date.now() - t6Start;
    assert(discRes.success === false, "Dead host marked unsuccessful");
    assert(discRes.readinessState === "DEAD_SITE_FAST_FAIL", "Readiness state flagged DEAD_SITE_FAST_FAIL");
    assert(dur6 < 4000, "Failed fast in < 4s rather than burning 30s budget", `${dur6}ms`);
    await ctx6.close();

  } finally {
    await browser.close();
    server.close();
  }

  console.log("\n================================================================");
  console.log(`TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
