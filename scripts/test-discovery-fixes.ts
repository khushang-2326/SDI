import { chromium } from "playwright";
import http from "node:http";
import { getChromiumExecutablePath } from "../services/browser-executable";
import { discoverSubmissionTargets } from "../services/submission-target-discovery";

const REGRESSION_MOCK_PAGES: Record<string, string> = {
  // Test 1: Pardot / Salesforce Marketing Cloud Iframe (frog.co, soundphysicians.com)
  "/test-pardot": `
    <!DOCTYPE html>
    <html>
      <body>
        <nav><a href="/test-pardot/contact">Contact Us</a></nav>
        <h1>Welcome to consultancy</h1>
      </body>
    </html>
  `,
  "/test-pardot/contact": `
    <!DOCTYPE html>
    <html>
      <body>
        <h1>Contact frog</h1>
        <iframe src="https://go.frog.co/l/95412/2022-05-16/6j1t7g" width="600" height="400"></iframe>
      </body>
    </html>
  `,

  // Test 2: Marketo Dynamic Form Container (datadoghq.com, bdo.com)
  "/test-marketo": `
    <!DOCTYPE html>
    <html>
      <body>
        <nav><a href="/test-marketo/contact">Contact Us</a></nav>
        <h1>Welcome</h1>
      </body>
    </html>
  `,
  "/test-marketo/contact": `
    <!DOCTYPE html>
    <html>
      <body>
        <h1>Get in Touch</h1>
        <form id="mktoForm_2029" class="mktoForm" action="/submit">
          <input type="text" name="FirstName" style="display:none;" />
          <input type="text" name="LastName" style="display:none;" />
          <input type="email" name="Email" style="display:none;" />
          <input type="text" name="Company" style="display:none;" />
          <button type="submit" style="display:none;">Submit</button>
        </form>
      </body>
    </html>
  `,

  // Test 3: Contact Form 7 in Inactive Tab/Accordion (workco.com)
  "/test-cf7": `
    <!DOCTYPE html>
    <html>
      <body>
        <nav><a href="/test-cf7/contact">Contact</a></nav>
        <h1>Welcome</h1>
      </body>
    </html>
  `,
  "/test-cf7/contact": `
    <!DOCTYPE html>
    <html>
      <body>
        <h1>Inquiries</h1>
        <form class="wpcf7-form init" action="/contact/#wpcf7-f221-o1" method="post">
          <div class="tab-pane" style="display:none;">
            <input type="text" name="your-name" placeholder="Your Name" />
            <input type="email" name="your-email" placeholder="Your Email" />
            <textarea name="your-message" placeholder="Message"></textarea>
            <button type="submit">Send</button>
          </div>
        </form>
      </body>
    </html>
  `,

  // Test 4: Homepage Multi-Step Enterprise Form (monks.com)
  "/test-homepage-form": `
    <!DOCTYPE html>
    <html>
      <body>
        <header><a href="/connect">Connect</a></header>
        <main style="height: 1500px;">
          <h1>Welcome</h1>
        </main>
        <div id="homepage-lead-form">
          <h2>Talk with our team</h2>
          <form id="form-step-0" action="/submit" method="post">
            <input type="text" name="firstname" placeholder="First Name" />
            <input type="text" name="lastname" placeholder="Last Name" />
            <input type="email" name="email" placeholder="Work Email" />
            <input type="text" name="company" placeholder="Company" />
            <button type="submit">Submit</button>
          </form>
        </div>
      </body>
    </html>
  `,
  "/connect": `
    <!DOCTYPE html>
    <html>
      <body>
        <h1>Connect Hub</h1>
        <p>No forms here, just social links.</p>
      </body>
    </html>
  `,

  // Test 5: Real Link Priority over Synthetic Fallbacks (kpmg.com)
  "/test-real-priority": `
    <!DOCTYPE html>
    <html>
      <body>
        <header>
          <a href="/quote">Services Overview</a>
        </header>
        <main>
          <h1>Enterprise Consulting</h1>
        </main>
        <footer>
          <a href="/test-real-priority/contact-landing.html">Contact Us</a>
        </footer>
      </body>
    </html>
  `,
  "/test-real-priority/contact-landing.html": `
    <!DOCTYPE html>
    <html>
      <body>
        <h1>Global Contact Page</h1>
        <form action="/submit" method="post">
          <input type="text" name="first_name" placeholder="First Name" />
          <input type="email" name="email" placeholder="Work Email" />
          <button type="submit">Submit Inquiry</button>
        </form>
      </body>
    </html>
  `
};

async function runRegressionTests() {
  console.log("==================================================");
  console.log("STARTING DISCOVERY ENGINE REGRESSION SUITE (8 FAILURE FIXES)");
  console.log("==================================================");

  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    const content = REGRESSION_MOCK_PAGES[url];
    if (content) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(content);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Mock server running at: ${baseUrl}`);

  const tests = [
    {
      name: "Fix #1: Pardot / Salesforce Marketing Cloud Iframe",
      entryUrl: `${baseUrl}/test-pardot`,
      expectedType: "contact_form",
      expectedUrlSnippet: "go.frog.co/l/"
    },
    {
      name: "Fix #2A: Marketo Dynamic Form Container",
      entryUrl: `${baseUrl}/test-marketo`,
      expectedType: "contact_form",
      expectedUrlSnippet: "/test-marketo/contact"
    },
    {
      name: "Fix #2B: Contact Form 7 Container (Inactive Tab/Accordion)",
      entryUrl: `${baseUrl}/test-cf7`,
      expectedType: "contact_form",
      expectedUrlSnippet: "/test-cf7/contact"
    },
    {
      name: "Fix #3: Homepage Below-The-Fold / Multi-Step Form",
      entryUrl: `${baseUrl}/test-homepage-form`,
      expectedType: "contact_form",
      expectedUrlSnippet: "/test-homepage-form"
    },
    {
      name: "Fix #4: Strict Real-Link Priority (Never Starved by Synthetic Paths)",
      entryUrl: `${baseUrl}/test-real-priority`,
      expectedType: "contact_form",
      expectedUrlSnippet: "/contact-landing.html"
    }
  ];

  let passed = 0;

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    console.log(`[Test ${i + 1}/${tests.length}] ${t.name}`);
    const start = Date.now();
    try {
      const res = await discoverSubmissionTargets({
        websiteUrl: t.entryUrl,
        timeoutMs: 10000,
        maxNavigationLinks: 5,
        maxFallbackPaths: 2
      });
      const top = res.targets[0] || null;
      const duration = ((Date.now() - start) / 1000).toFixed(1);

      if (!top) {
        console.log(`  -> FAIL: No target found in ${duration}s (Reason: ${res.reason})`);
      } else if (top.targetType !== t.expectedType) {
        console.log(`  -> FAIL: Expected type ${t.expectedType}, got ${top.targetType}`);
      } else if (t.expectedUrlSnippet && !top.url.includes(t.expectedUrlSnippet)) {
        console.log(`  -> FAIL: Target URL ${top.url} did not match snippet ${t.expectedUrlSnippet}`);
      } else {
        console.log(`  -> PASS: Discovered ${top.targetType} at ${top.url} in ${duration}s`);
        passed++;
      }
    } catch (err: any) {
      console.log(`  -> ERROR: ${err.message}`);
    }
  }

  server.close();

  console.log("==================================================");
  console.log(`REGRESSION SUITE SUMMARY: ${passed} / ${tests.length} PASSED (${((passed / tests.length) * 100).toFixed(1)}%)`);
  console.log("==================================================");

  if (passed !== tests.length) {
    process.exit(1);
  }
}

runRegressionTests().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
