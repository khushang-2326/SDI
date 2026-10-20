import http from "http";
import { chromium } from "playwright";
import { navigateForDiscovery, discoverSubmissionTargets } from "../services/submission-target-discovery";
import { submitContactForm } from "../services/contact-form-automation";

import { getChromiumExecutablePath } from "../services/browser-executable";

async function runTests() {
  console.log("=== STARTING 25-SECOND NAVIGATION & FORM-DISCOVERY RULE TEST ===");

  const PORT = 48991;
  const hangingSockets: any[] = [];

  const server = http.createServer((req, res) => {
    const url = req.url || "";
    console.log(`[TEST-SERVER] Request received: ${url}`);

    if (url === "/case1-usable-fast") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Case 1: Fast Usable Page with Hanging Background Assets</title>
          <!-- Async analytics/tracker script that never completes -->
          <script async src="/hanging-analytics.js"></script>
          <script>
            // Background analytics beacon
            fetch('/hanging-api').catch(() => {});
          </script>
        </head>
        <body>
          <header>
            <nav>
              <a href="/case1-usable-fast/contact">Contact Us in Header</a>
            </nav>
          </header>
          <main>
            <h1>Fast Usable Page</h1>
            <p>This page renders usable DOM elements immediately, but has stuck background network requests.</p>
            <form id="contact-form" action="/case1-usable-fast/submit" method="POST">
              <label for="name">Name</label>
              <input type="text" id="name" name="name" required />
              <label for="email">Email</label>
              <input type="email" id="email" name="email" required />
              <label for="message">Message</label>
              <textarea id="message" name="message" required></textarea>
              <button type="submit" id="submit-btn">Send Message</button>
            </form>
            <!-- Hanging image and video that never finish loading -->
            <img src="/hanging-image.png" alt="Slow background tracker" />
            <video src="/hanging-video.mp4" autoplay loop></video>
          </main>
          <footer>
            <a href="/case1-usable-fast/footer-reach-us">Reach Us in Footer</a>
          </footer>
        </body>
        </html>
      `);
      res.end();
    } else if (url === "/case2-unusable-hanging") {
      // Sends headers but never sends body / DOM, simulating an unresponsive / un-renderable host
      res.writeHead(200, { "Content-Type": "text/html" });
      // Keep socket open without sending any usable DOM elements
      hangingSockets.push(res);
    } else if (url.startsWith("/hanging-")) {
      // Never end the response to simulate hanging network assets (images/trackers/ads)
      hangingSockets.push(res);
    } else if (url === "/case3-priority") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.write(`
        <!DOCTYPE html>
        <html>
        <head><title>Case 3: Priority Test</title></head>
        <body>
          <header>
            <nav>
              <a href="/case3-priority/header-contact">Contact Us via Header</a>
            </nav>
          </header>
          <main>
            <h1>Company Home</h1>
            <p>Welcome to our company website. Here is substantive content about our services and offerings.</p>
            <a href="/case3-priority/body-contact">Contact Us via Body</a>
          </main>
          <footer>
            <a href="/case3-priority/footer-contact">Contact Us via Footer</a>
          </footer>
        </body>
        </html>
      `);
      res.end();
    } else if (url.startsWith("/case3-priority/")) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.write(`
        <!DOCTYPE html>
        <html>
        <head><title>Contact Page</title></head>
        <body>
          <h1>Contact Us</h1>
          <form id="contact-form" action="/case3-priority/submit" method="POST">
            <input type="text" name="name" required />
            <input type="email" name="email" required />
            <textarea name="message" required></textarea>
            <button type="submit">Submit</button>
          </form>
        </body>
        </html>
      `);
      res.end();
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  await new Promise<void>((resolve) => server.listen(PORT, () => resolve()));
  console.log(`[TEST-SERVER] Listening on http://localhost:${PORT}`);

  const execPath = await getChromiumExecutablePath();
  const browser = await chromium.launch({
    headless: true,
    executablePath: execPath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const context = await browser.newContext();

  try {
    // -------------------------------------------------------------
    // TEST CASE 1: Page becomes usable before 25s (with hanging assets)
    // -------------------------------------------------------------
    console.log("\n>>> RUNNING TEST CASE 1: Page becomes usable before 25s");
    const tCase1Start = Date.now();
    const case1Page = await context.newPage();

    const case1Result = await navigateForDiscovery(
      case1Page,
      `http://localhost:${PORT}/case1-usable-fast`,
      25000,
      "any"
    );
    const case1Elapsed = Date.now() - tCase1Start;
    console.log(`Case 1 navigation result: success=${case1Result.success}, readinessState=${case1Result.readinessState}, elapsed=${case1Elapsed}ms`);

    if (!case1Result.success || case1Elapsed >= 25000) {
      throw new Error(`TEST CASE 1 FAILED: Expected page to become usable fast (<25s), took ${case1Elapsed}ms`);
    }
    console.log(`✓ TEST CASE 1 (Navigation) PASSED: Page became usable in ${case1Elapsed}ms without waiting for hanging assets.`);

    // Test form discovery on Case 1
    console.log("\n>>> RUNNING TEST CASE 1 Form Discovery (Fast-Path & Search Priority):");
    const case1Discovery = await discoverSubmissionTargets({
      websiteUrl: `http://localhost:${PORT}/case1-usable-fast`,
      browserContext: context,
      timeoutMs: 25000
    });
    console.log(`Case 1 Discovery Result: targets=${case1Discovery.targets.length}, reason="${case1Discovery.reason}"`);
    if (case1Discovery.targets.length === 0) {
      throw new Error(`TEST CASE 1 FAILED: Expected inline form to be discovered immediately.`);
    }
    console.log(`✓ TEST CASE 1 (Form Discovery) PASSED: Form discovered successfully via fast-path.`);
    await case1Page.close();

    // -------------------------------------------------------------
    // TEST CASE 2: Page remains unusable beyond 25s
    // -------------------------------------------------------------
    console.log("\n>>> RUNNING TEST CASE 2: Page remains unusable beyond 25s");
    const tCase2Start = Date.now();
    const case2Page = await context.newPage();

    const case2Result = await navigateForDiscovery(
      case2Page,
      `http://localhost:${PORT}/case2-unusable-hanging`,
      25000,
      "any"
    );
    const case2Elapsed = Date.now() - tCase2Start;
    console.log(`Case 2 navigation result: success=${case2Result.success}, timedOut=${case2Result.timedOut}, readinessState=${case2Result.readinessState}, elapsed=${case2Elapsed}ms`);

    if (case2Result.success || !case2Result.timedOut || case2Result.readinessState !== "NAVIGATION_TIMEOUT") {
      throw new Error(`TEST CASE 2 FAILED: Expected NAVIGATION_TIMEOUT, got success=${case2Result.success}`);
    }
    if (case2Elapsed < 24000 || case2Elapsed > 27000) {
      throw new Error(`TEST CASE 2 FAILED: Expected timeout at ~25000ms, elapsed=${case2Elapsed}ms`);
    }
    console.log(`✓ TEST CASE 2 (Navigation Timeout) PASSED: Navigation properly aborted at 25s and reported NAVIGATION_TIMEOUT.`);
    await case2Page.close();

    // -------------------------------------------------------------
    // TEST CASE 3: Strict Search Priority (Header -> Footer -> Body)
    // -------------------------------------------------------------
    console.log("\n>>> RUNNING TEST CASE 3: Strict Search Priority (Header -> Footer -> Body)");
    const case3Discovery = await discoverSubmissionTargets({
      websiteUrl: `http://localhost:${PORT}/case3-priority`,
      browserContext: context,
      timeoutMs: 25000
    });
    console.log(`Case 3 Discovery Result: targets=${case3Discovery.targets.length}, primary=${case3Discovery.targets[0]?.url}`);
    if (case3Discovery.targets.length === 0 || !case3Discovery.targets[0]?.url.includes("header-contact")) {
      throw new Error(`TEST CASE 3 FAILED: Expected Header candidate to be searched and discovered first, got: ${case3Discovery.targets[0]?.url}`);
    }
    console.log(`✓ TEST CASE 3 (Strict Priority) PASSED: Header candidate took precedence over Footer and Body.`);

    console.log("\n=== ALL 25-SECOND NAVIGATION & FORM DISCOVERY RULE TESTS PASSED ===");
  } finally {
    for (const res of hangingSockets) {
      try { res.destroy(); } catch {}
    }
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
    console.log("[TEST-SERVER] Server stopped.");
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
