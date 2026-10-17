import http from "node:http";
import { chromium } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable";
import { submitContactForm } from "../services/contact-form-automation";

const leadData = {
  fullName: "Alice Johnson",
  email: "alice.johnson@business.example",
  companyName: "Acme Corp",
  mobile: "+1 (555) 234-5678",
  message: "We would like to request a consultation."
};

let server: http.Server;
let port: number;

function startServer(): Promise<number> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const url = req.url || "/";

      // 1. Landing page with an Action Button opening Calendly in a NEW TAB
      if (url === "/landing-with-newtab-btn") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Consulting Services</title></head>
            <body>
              <header>
                <nav>
                  <a href="/about">About</a>
                  <a href="/services">Services</a>
                  <a href="/calendly-mock" target="_blank" class="btn btn-primary" id="book-btn">Book a Call</a>
                </nav>
              </header>
              <main>
                <h1>Welcome to our advisory agency</h1>
                <p>We provide full-service growth consulting.</p>
              </main>
            </body>
          </html>
        `);
        return;
      }

      // Mock Calendly page in new tab
      if (url === "/calendly-mock") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Calendly - 30 Minute Meeting</title></head>
            <body>
              <div id="root">
                <h2>Select a Date &amp; Time</h2>
                <div role="grid" aria-label="calendar">
                  <button type="button" class="bookable-date" aria-label="October 25, 2026 - Times available">25</button>
                </div>
                <div class="time-slots">
                  <button type="button" data-start-time="10:00am">10:00am</button>
                  <button type="button" data-start-time="10:30am">10:30am</button>
                </div>
              </div>
            </body>
          </html>
        `);
        return;
      }

      // 2. Landing page with an in-page modal form triggered by a button
      if (url === "/landing-with-modal") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Modal Test</title>
              <style>
                #contact-modal { display: none; }
                #contact-modal.active { display: block; }
              </style>
            </head>
            <body>
              <h1>Innovative Solutions</h1>
              <p>We help businesses succeed.</p>
              <button id="open-modal-btn" onclick="document.getElementById('contact-modal').className = 'active';" class="cta-button">
                Get in Touch
              </button>

              <div id="contact-modal">
                <form id="lead-form" onsubmit="event.preventDefault(); document.getElementById('msg').innerText = 'Thank you for contacting us!';">
                  <h2>Send us an Inquiry</h2>
                  <input type="text" name="name" placeholder="Full Name" required />
                  <input type="email" name="email" placeholder="Business Email" required />
                  <textarea name="message" placeholder="Project Description"></textarea>
                  <label><input type="checkbox" name="terms" required /> I accept the Privacy Policy</label>
                  <button type="submit" id="submit-btn">Send Message</button>
                  <div id="msg"></div>
                </form>
              </div>
            </body>
          </html>
        `);
        return;
      }

      // 3. Landing page with action link navigating to a contact page
      if (url === "/landing-with-nav-btn") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Agency Home</title></head>
            <body>
              <h1>Digital Agency</h1>
              <a href="/quote-form-page" class="btn">Request a Quote</a>
            </body>
          </html>
        `);
        return;
      }

      if (url === "/quote-form-page") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Request a Quote</title></head>
            <body>
              <h1>Quote Request Form</h1>
              <form id="quote-form" onsubmit="event.preventDefault(); document.getElementById('res').innerText = 'Quote requested successfully!';">
                <input type="text" name="fullname" placeholder="Your Name" required />
                <input type="email" name="email" placeholder="Your Email" required />
                <textarea name="details" placeholder="Quote Details"></textarea>
                <button type="submit">Submit Request</button>
                <div id="res"></div>
              </form>
            </body>
          </html>
        `);
        return;
      }

      // 4. Page with NO forms and NO action buttons
      if (url === "/no-form-no-buttons") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Plain Blog</title></head>
            <body>
              <h1>Just a blog post</h1>
              <p>Nothing to submit or click here.</p>
            </body>
          </html>
        `);
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    server.listen(0, () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : 8080;
      resolve(p);
    });
  });
}

async function runTests() {
  port = await startServer();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[TEST-SUITE] Test HTTP server started on ${baseUrl}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: await getChromiumExecutablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    // -------------------------------------------------------------
    // TEST 1: Action button opening in-page modal form
    // -------------------------------------------------------------
    console.log("\n=======================================================");
    console.log("TEST 1: In-Page Modal Form via 'Get in Touch' button");
    console.log("=======================================================");
    const context1 = await browser.newContext();
    const res1 = await submitContactForm({
      websiteUrl: `${baseUrl}/landing-with-modal`,
      leadData,
      headless: true,
      submit: true,
      browserContext: context1,
      timeoutMs: 15000
    });
    console.log("TEST 1 Status:", res1.status);
    console.log("TEST 1 Message:", res1.message);
    if (res1.status === "success") {
      console.log("✅ TEST 1 PASSED: Modal form discovered, filled, and submitted!");
    } else {
      console.error("❌ TEST 1 FAILED:", res1.errorMessage);
    }
    await context1.close();

    // -------------------------------------------------------------
    // TEST 2: Action button navigating to /quote-form-page
    // -------------------------------------------------------------
    console.log("\n=======================================================");
    console.log("TEST 2: Navigated Form via 'Request a Quote' button");
    console.log("=======================================================");
    const context2 = await browser.newContext();
    const res2 = await submitContactForm({
      websiteUrl: `${baseUrl}/landing-with-nav-btn`,
      leadData,
      headless: true,
      submit: true,
      browserContext: context2,
      timeoutMs: 15000
    });
    console.log("TEST 2 Status:", res2.status);
    console.log("TEST 2 Message:", res2.message);
    if (res2.status === "success") {
      console.log("✅ TEST 2 PASSED: Navigated form discovered, filled, and submitted!");
    } else {
      console.error("❌ TEST 2 FAILED:", res2.errorMessage);
    }
    await context2.close();

    // -------------------------------------------------------------
    // TEST 3: Page with NO forms and NO buttons -> Should Fail gracefully
    // -------------------------------------------------------------
    console.log("\n=======================================================");
    console.log("TEST 3: Exhaustion on plain page without forms/buttons");
    console.log("=======================================================");
    const context3 = await browser.newContext();
    const res3 = await submitContactForm({
      websiteUrl: `${baseUrl}/no-form-no-buttons`,
      leadData,
      headless: true,
      submit: true,
      browserContext: context3,
      timeoutMs: 10000
    }).catch(err => ({ status: "failed", errorMessage: err.message }));
    console.log("TEST 3 Status:", (res3 as any).status);
    console.log("TEST 3 Error:", (res3 as any).errorMessage);
    if ((res3 as any).status === "failed") {
      console.log("✅ TEST 3 PASSED: Correctly failed and avoided infinite loops!");
    } else {
      console.error("❌ TEST 3 UNEXPECTED RESULT");
    }
    await context3.close();

  } finally {
    await browser.close();
    server.close();
  }
}

runTests().catch(err => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
