import http from "node:http";
import { chromium, type Browser } from "playwright";
import { detectUnsupportedVerification } from "../services/verification-detector";
import { getChromiumExecutablePath } from "../services/browser-executable";

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING VERIFICATION DETECTOR FALSE-POSITIVE TESTS");
  console.log("==================================================\n");

  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    if (url === "/normal-security-text") {
      res.writeHead(200);
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Acme Web Design - Contact Us</title></head>
        <body>
          <header><h1>Acme Web Design</h1></header>
          <main>
            <p>Welcome to Acme. We provide top-notch web design with utmost Security and reliability.</p>
            <form action="/submit" method="POST">
              <label>Name: <input type="text" name="name" /></label>
              <label>Email: <input type="email" name="email" /></label>
              <label>Message: <textarea name="message"></textarea></label>
              <button type="submit">Send Message</button>
            </form>
          </main>
          <footer>
            <p>Copyright © 2026 Acme Corp. Data Security and Privacy Policy.</p>
          </footer>
        </body>
        </html>
      `);
    } else if (url === "/normal-footer-security-policy") {
      res.writeHead(200);
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Digital Marketing Agency</title></head>
        <body>
          <h1>Contact Us</h1>
          <form id="contact-form">
            <input type="text" name="first_name" placeholder="First Name" />
            <input type="email" name="email" placeholder="Your Email" />
            <textarea name="comment" placeholder="Your Inquiry"></textarea>
            <input type="submit" value="Submit" />
          </form>
          <footer>
            <a href="/security">Security Policy</a> | <a href="/terms">Terms</a> | <a href="/privacy">Enterprise Security Information</a>
          </footer>
        </body>
        </html>
      `);
    } else if (url === "/normal-page-automated-traffic-text") {
      res.writeHead(200);
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>SEO Services - Get in Touch</title></head>
        <body>
          <h1>Contact Our Consultants</h1>
          <form>
            <input type="text" name="name" />
            <input type="email" name="email" />
            <textarea name="msg"></textarea>
            <button type="submit">Submit</button>
          </form>
          <div class="faq">
            <h3>How do we handle automated traffic?</h3>
            <p>Our analytics platform filters bot protection metrics and automated traffic reports for your digital campaigns.</p>
          </div>
        </body>
        </html>
      `);
    } else if (url === "/normal-202-response") {
      res.writeHead(202); // HTTP 202 Accepted
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Consulting Services - Contact</title></head>
        <body>
          <h1>Contact Us</h1>
          <p>We provide full stack development, SEO, and cloud infrastructure security.</p>
          <form>
            <input type="text" name="name" />
            <input type="email" name="email" />
            <textarea name="notes"></textarea>
            <button type="submit">Send Inquiry</button>
          </form>
          <footer>Enterprise Security Guaranteed.</footer>
        </body>
        </html>
      `);
    } else if (url === "/genuine-robot-challenge") {
      res.writeHead(200);
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Robot Challenge</title></head>
        <body>
          <h2>Security check to proceed</h2>
          <p>Please solve the challenge below to confirm that you are a human.</p>
          <div id="challenge-box"></div>
        </body>
        </html>
      `);
    } else if (url === "/genuine-cloudflare-managed") {
      res.writeHead(403);
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Just a moment...</title></head>
        <body>
          <h1>Just a moment...</h1>
          <p>Performing security verification. Verify you are human. Cloudflare Ray ID: 89ab348d.</p>
          <div id="cf-chl"></div>
        </body>
        </html>
      `);
    } else if (url === "/genuine-human-verification-interstitial") {
      res.writeHead(200);
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Security Check Required</title></head>
        <body>
          <div class="interstitial">
            <p>Unusual traffic from your computer network. Please verify that you are human.</p>
          </div>
        </body>
        </html>
      `);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const executablePath = await getChromiumExecutablePath();
  const browser: Browser = await chromium.launch({
    headless: true,
    executablePath: executablePath || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`✓ [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`✗ [FAIL] ${desc}`);
      failed++;
    }
  }

  try {
    // 1. Normal page with "Security"
    await page.goto(`${baseUrl}/normal-security-text`);
    const res1 = await detectUnsupportedVerification(page, `${baseUrl}/normal-security-text`);
    assert(res1 === null, 'Normal page with "Security" in body is NOT flagged as verification');

    // 2. Normal footer with "Security Policy"
    await page.goto(`${baseUrl}/normal-footer-security-policy`);
    const res2 = await detectUnsupportedVerification(page, `${baseUrl}/normal-footer-security-policy`);
    assert(res2 === null, 'Normal footer with "Security Policy" & "Enterprise Security" is NOT flagged');

    // 3. Normal page mentioning "automated traffic" in FAQ
    await page.goto(`${baseUrl}/normal-page-automated-traffic-text`);
    const res3 = await detectUnsupportedVerification(page, `${baseUrl}/normal-page-automated-traffic-text`);
    assert(res3 === null, 'Normal page mentioning "automated traffic" in FAQ is NOT flagged');

    // 4. HTTP 202 response with normal business content & form
    await page.goto(`${baseUrl}/normal-202-response`);
    const res4 = await detectUnsupportedVerification(page, `${baseUrl}/normal-202-response`);
    assert(res4 === null, 'HTTP 202 response with contact form & "security" is NOT flagged');

    // 5. Genuine robot challenge screen
    await page.goto(`${baseUrl}/genuine-robot-challenge`);
    const res5 = await detectUnsupportedVerification(page, `${baseUrl}/genuine-robot-challenge`);
    assert(res5 !== null && res5.blocking === true, 'Genuine Robot Challenge is correctly detected as blocking');

    // 6. Genuine Cloudflare Managed Challenge
    await page.goto(`${baseUrl}/genuine-cloudflare-managed`);
    const res6 = await detectUnsupportedVerification(page, `${baseUrl}/genuine-cloudflare-managed`);
    assert(res6 !== null && res6.blocking === true && res6.name.includes("Cloudflare"), 'Genuine Cloudflare Managed Challenge is correctly detected as blocking');

    // 7. Genuine Human Verification Interstitial
    await page.goto(`${baseUrl}/genuine-human-verification-interstitial`);
    const res7 = await detectUnsupportedVerification(page, `${baseUrl}/genuine-human-verification-interstitial`);
    assert(res7 !== null && res7.blocking === true, 'Genuine Human Verification Interstitial is correctly detected as blocking');

  } finally {
    await browser.close();
    server.close();
  }

  console.log("\n==================================================");
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test runner threw error:", err);
  process.exit(1);
});
