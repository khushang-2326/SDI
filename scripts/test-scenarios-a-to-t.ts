import { chromium } from "playwright";
import http from "node:http";
import { getChromiumExecutablePath } from "../services/browser-executable";
import { collectNavigationCandidates, discoverSubmissionTargets } from "../services/submission-target-discovery";

// Mock HTML templates for Scenarios A through T
const MOCK_PAGES: Record<string, string> = {
  // Scenario A: Direct form on entered page
  "/scenario-a": `
    <!DOCTYPE html>
    <html>
      <body>
        <h1>Direct Contact Page</h1>
        <form action="/submit" method="POST">
          <input type="text" name="name" placeholder="Name" required />
          <input type="email" name="email" placeholder="Email" required />
          <textarea name="message" placeholder="Message"></textarea>
          <button type="submit">Send Message</button>
        </form>
      </body>
    </html>
  `,

  // Scenario B: Navbar Contact Link
  "/scenario-b": `
    <!DOCTYPE html>
    <html>
      <body>
        <header>
          <nav>
            <a href="/">Home</a>
            <a href="/about">About</a>
            <a href="/scenario-b-contact">Contact Us</a>
          </nav>
        </header>
        <main><h1>Welcome to our agency</h1></main>
      </body>
    </html>
  `,
  "/scenario-b-contact": `
    <!DOCTYPE html>
    <html>
      <body>
        <h1>Get in Touch</h1>
        <form action="/submit" method="POST">
          <input type="text" name="name" required />
          <input type="email" name="email" required />
          <button type="submit">Submit</button>
        </form>
      </body>
    </html>
  `,

  // Scenario C: Footer Contact Link
  "/scenario-c": `
    <!DOCTYPE html>
    <html>
      <body>
        <main><h1>Welcome</h1></main>
        <footer>
          <a href="/scenario-c-contact">Contact Us</a>
        </footer>
      </body>
    </html>
  `,
  "/scenario-c-contact": `
    <!DOCTYPE html>
    <html>
      <body>
        <form action="/submit"><input type="text" name="name" /><button type="submit">Submit</button></form>
      </body>
    </html>
  `,

  // Scenario D: Below-the-fold CTA
  "/scenario-d": `
    <!DOCTYPE html>
    <html>
      <body>
        <div style="height: 1200px;"><h1>Long Hero</h1></div>
        <div class="cta">
          <h2>Ready for transformation?</h2>
          <a href="/scenario-d-book">Book a Consultation</a>
        </div>
      </body>
    </html>
  `,
  "/scenario-d-book": `
    <!DOCTYPE html>
    <html>
      <body>
        <form action="/submit"><input type="text" name="name" /><button type="submit">Book</button></form>
      </body>
    </html>
  `,

  // Scenario E: Generic CTA with contact intent
  "/scenario-e": `
    <!DOCTYPE html>
    <html>
      <body>
        <main>
          <h1>Innovation Lab</h1>
          <a href="/scenario-e-start">Let's Start Something</a>
        </main>
      </body>
    </html>
  `,
  "/scenario-e-start": `
    <!DOCTYPE html>
    <html>
      <body>
        <form action="/submit"><input type="email" name="email" /><button type="submit">Start</button></form>
      </body>
    </html>
  `,

  // Scenario F: /get-in-touch
  "/scenario-f": `
    <!DOCTYPE html>
    <html>
      <body>
        <nav><a href="/get-in-touch">Reach Out</a></nav>
      </body>
    </html>
  `,
  "/get-in-touch": `
    <!DOCTYPE html>
    <html>
      <body>
        <form><input type="text" name="name" /><button type="submit">Send</button></form>
      </body>
    </html>
  `,

  // Scenario G: /book-a-call
  "/scenario-g": `
    <!DOCTYPE html>
    <html>
      <body>
        <nav><a href="/book-a-call">Schedule a Call</a></nav>
      </body>
    </html>
  `,
  "/book-a-call": `
    <!DOCTYPE html>
    <html>
      <body>
        <form><input type="text" name="phone" /><button type="submit">Schedule</button></form>
      </body>
    </html>
  `,

  // Scenario H: JS Navigation
  "/scenario-h": `
    <!DOCTYPE html>
    <html>
      <body>
        <button onclick="location.href='/scenario-h-contact'">Talk to Us</button>
      </body>
    </html>
  `,
  "/scenario-h-contact": `
    <!DOCTYPE html>
    <html>
      <body>
        <form><input type="text" name="name" /><button type="submit">Go</button></form>
      </body>
    </html>
  `,

  // Scenario I: Mobile Hamburger Menu
  "/scenario-i": `
    <!DOCTYPE html>
    <html>
      <body>
        <button class="hamburger" aria-label="menu" onclick="document.getElementById('m-menu').style.display='block'">Menu</button>
        <div id="m-menu" style="display: none;">
          <a href="/scenario-i-contact">Contact Sales</a>
        </div>
      </body>
    </html>
  `,
  "/scenario-i-contact": `
    <!DOCTYPE html>
    <html>
      <body>
        <form><input type="text" name="name" /><button type="submit">Submit</button></form>
      </body>
    </html>
  `,

  // Scenario J: Multiple candidate ranking order
  "/scenario-j": `
    <!DOCTYPE html>
    <html>
      <body>
        <header>
          <nav>
            <a href="/pricing">Pricing</a>
            <a href="/about">About</a>
            <a href="/scenario-j-book">Book a Consultation</a>
            <a href="/scenario-j-contact">Contact Us</a>
          </nav>
        </header>
      </body>
    </html>
  `,
  "/scenario-j-contact": `
    <!DOCTYPE html>
    <html><body><form><input type="text" name="name" /><button type="submit">Submit</button></form></body></html>
  `,
  "/scenario-j-book": `
    <!DOCTYPE html>
    <html><body><form><input type="text" name="name" /><button type="submit">Book</button></form></body></html>
  `,

  // Scenario K: First candidate no form, second candidate form
  "/scenario-k": `
    <!DOCTYPE html>
    <html>
      <body>
        <header>
          <nav>
            <a href="/scenario-k-empty">Talk to Us</a>
            <a href="/scenario-k-form">Contact Us</a>
          </nav>
        </header>
      </body>
    </html>
  `,
  "/scenario-k-empty": `
    <!DOCTYPE html>
    <html><body><h1>Talk to Us</h1><p>Call us at 555-0199</p></body></html>
  `,
  "/scenario-k-form": `
    <!DOCTYPE html>
    <html><body><form action="/submit" method="POST"><input type="text" name="name" required /><input type="email" name="email" required /><textarea name="message"></textarea><button type="submit">Submit</button></form></body></html>
  `,

  // Scenario L: No contact candidates
  "/scenario-l": `
    <!DOCTYPE html>
    <html>
      <body>
        <header><nav><a href="/blog">Blog</a><a href="/products">Products</a></nav></header>
      </body>
    </html>
  `,

  // Scenario M: False positive rejection for "About"
  "/scenario-m": `
    <!DOCTYPE html>
    <html>
      <body>
        <nav><a href="/about">About Our Firm</a></nav>
      </body>
    </html>
  `,

  // Scenario N: False positive rejection for "Learn More"
  "/scenario-n": `
    <!DOCTYPE html>
    <html>
      <body>
        <main><a href="/services">Learn More</a></main>
      </body>
    </html>
  `,

  // Scenario O: Privacy & Terms exclusion
  "/scenario-o": `
    <!DOCTYPE html>
    <html>
      <body>
        <footer>
          <a href="/privacy-policy">Privacy Policy</a>
          <a href="/terms-of-service">Terms of Service</a>
        </footer>
      </body>
    </html>
  `,

  // Scenario P: mailto/phone only page (No form detected)
  "/scenario-p": `
    <!DOCTYPE html>
    <html>
      <body>
        <h1>Call or Email Us</h1>
        <a href="mailto:info@example.com">Email Us</a>
        <a href="tel:5551234567">Call Us</a>
      </body>
    </html>
  `,

  // Scenario Q: External link exclusion
  "/scenario-q": `
    <!DOCTYPE html>
    <html>
      <body>
        <header><a href="https://other-unrelated-domain.com/contact">Other Contact</a></header>
      </body>
    </html>
  `,

  // Scenario R: Embedded HubSpot form
  "/scenario-r": `
    <!DOCTYPE html>
    <html>
      <body>
        <nav><a href="/scenario-r-page">Contact Us</a></nav>
      </body>
    </html>
  `,
  "/scenario-r-page": `
    <!DOCTYPE html>
    <html>
      <body>
        <iframe src="https://forms.hsforms.com/embed/v3/form/123/456"></iframe>
      </body>
    </html>
  `,

  // Scenario S: Embedded LeadConnector form
  "/scenario-s": `
    <!DOCTYPE html>
    <html>
      <body>
        <nav><a href="/scenario-s-page">Contact Us</a></nav>
      </body>
    </html>
  `,
  "/scenario-s-page": `
    <!DOCTYPE html>
    <html>
      <body>
        <iframe src="https://api.leadconnectorhq.com/widget/form/789"></iframe>
      </body>
    </html>
  `,

  // Scenario T: Calendly event target
  "/scenario-t": `
    <!DOCTYPE html>
    <html>
      <body>
        <a href="https://calendly.com/acme-corp/intro-call">Schedule Intro Call</a>
      </body>
    </html>
  `
};

async function runScenarioWithTimeout<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutMs = 25000
): Promise<T> {
  const t0 = Date.now();
  console.log(`[TEST] Scenario ${name} START`);
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Scenario ${name} exceeded hard test deadline of ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([fn(), timeoutPromise]);
    console.log(`[TEST] Scenario ${name} END (+${Date.now() - t0}ms)`);
    return result;
  } catch (err: any) {
    console.log(`[TEST] Scenario ${name} FAILED/TIMEOUT (+${Date.now() - t0}ms): ${err?.message || err}`);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  console.log("==================================================");
  console.log("RUNNING SCENARIOS A THROUGH T: INTELLIGENT DISCOVERY TEST SUITE");
  console.log("==================================================");

  // Start a local mock HTTP server
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1:4000");
    const html = MOCK_PAGES[url.pathname] || "<html><body>404 Not Found</body></html>";
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  });

  await new Promise<void>((resolve) => server.listen(4000, "127.0.0.1", resolve));
  const baseUrl = "http://127.0.0.1:4000";

  let browser: any = null;
  const results: Record<string, { pass: boolean; details: string }> = {};

  try {
    const executablePath = await getChromiumExecutablePath();
    browser = await chromium.launch({ headless: true, executablePath });

    // Scenario A: Direct form on page
    await runScenarioWithTimeout("A", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-a`);
        const res = await discoverSubmissionTargets({ websiteUrl: `${baseUrl}/scenario-a`, timeoutMs: 5000 });
        const pass = res.targets.some((t) => t.targetType === "contact_form");
        results["A (Direct Form)"] = { pass, details: pass ? `Fast-path returned ${res.targets[0]?.url}` : "Failed" };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["A (Direct Form)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario B: Navbar Contact
    await runScenarioWithTimeout("B", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-b`);
        const candidates = await collectNavigationCandidates(page, `${baseUrl}/scenario-b`);
        const match = candidates.find((c) => c.url.includes("/scenario-b-contact"));
        const pass = Boolean(match && match.candidateLocation === "nav");
        results["B (Navbar Contact)"] = { pass, details: match ? `Found: ${match.url} (score=${match.score}, loc=${match.candidateLocation})` : "Not found" };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["B (Navbar Contact)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario C: Footer Contact
    await runScenarioWithTimeout("C", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-c`);
        const candidates = await collectNavigationCandidates(page, `${baseUrl}/scenario-c`);
        const match = candidates.find((c) => c.url.includes("/scenario-c-contact"));
        const pass = Boolean(match && match.candidateLocation === "footer");
        results["C (Footer Contact)"] = { pass, details: match ? `Found: ${match.url} (score=${match.score}, loc=${match.candidateLocation})` : "Not found" };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["C (Footer Contact)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario D: Below-the-fold CTA
    await runScenarioWithTimeout("D", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-d`);
        const candidates = await collectNavigationCandidates(page, `${baseUrl}/scenario-d`);
        const match = candidates.find((c) => c.url.includes("/scenario-d-book"));
        const pass = Boolean(match);
        results["D (Below-fold CTA)"] = { pass, details: match ? `Found: ${match.url} (score=${match.score})` : "Not found" };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["D (Below-fold CTA)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario E: Generic CTA with contact intent
    await runScenarioWithTimeout("E", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-e`);
        const candidates = await collectNavigationCandidates(page, `${baseUrl}/scenario-e`);
        const match = candidates.find((c) => c.url.includes("/scenario-e-start"));
        const pass = Boolean(match && match.score >= 50);
        results["E (Generic CTA with intent)"] = { pass, details: match ? `Found: ${match.url} (score=${match.score})` : "Not found" };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["E (Generic CTA with intent)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario F: /get-in-touch
    await runScenarioWithTimeout("F", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-f`);
        const candidates = await collectNavigationCandidates(page, `${baseUrl}/scenario-f`);
        const match = candidates.find((c) => c.url.includes("/get-in-touch"));
        const pass = Boolean(match && match.score >= 70);
        results["F (/get-in-touch)"] = { pass, details: match ? `Found: ${match.url} (score=${match.score})` : "Not found" };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["F (/get-in-touch)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario G: /book-a-call
    await runScenarioWithTimeout("G", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-g`);
        const candidates = await collectNavigationCandidates(page, `${baseUrl}/scenario-g`);
        const match = candidates.find((c) => c.url.includes("/book-a-call"));
        const pass = Boolean(match && match.score >= 70);
        results["G (/book-a-call)"] = { pass, details: match ? `Found: ${match.url} (score=${match.score})` : "Not found" };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["G (/book-a-call)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario H: JS Navigation
    await runScenarioWithTimeout("H", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-h`);
        const candidates = await collectNavigationCandidates(page, `${baseUrl}/scenario-h`);
        const match = candidates.find((c) => c.url.includes("/scenario-h-contact"));
        const pass = Boolean(match);
        results["H (JS Navigation onclick)"] = { pass, details: match ? `Found: ${match.url} (type=${match.candidateType})` : "Not found" };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["H (JS Navigation onclick)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario I: Mobile Menu Disclosure
    await runScenarioWithTimeout("I", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-i`);
        const candidates = await collectNavigationCandidates(page, `${baseUrl}/scenario-i`);
        const match = candidates.find((c) => c.url.includes("/scenario-i-contact"));
        const pass = Boolean(match);
        results["I (Mobile Menu)"] = { pass, details: match ? `Found: ${match.url} (loc=${match.candidateLocation})` : "Not found" };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["I (Mobile Menu)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario J: Multiple candidate ranking
    await runScenarioWithTimeout("J", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-j`);
        const candidates = await collectNavigationCandidates(page, `${baseUrl}/scenario-j`);
        const topUrls = candidates.slice(0, 2).map((c) => c.url);
        const pass = topUrls.some((u) => u.includes("contact")) && topUrls.some((u) => u.includes("book"));
        results["J (Multiple Candidate Ranking)"] = { pass, details: `Top ranks: ${topUrls.join(", ")}` };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["J (Multiple Candidate Ranking)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario K: First candidate empty, second has form
    await runScenarioWithTimeout("K", async () => {
      const res = await discoverSubmissionTargets({ websiteUrl: `${baseUrl}/scenario-k`, timeoutMs: 8000 });
      const pass = res.targets.some((t) => t.url.includes("/scenario-k-form"));
      results["K (Skip empty, find next)"] = { pass, details: pass ? `Discovered: ${res.targets[0]?.url}` : "Not found" };
    }).catch((err) => {
      results["K (Skip empty, find next)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario L: No contact candidates
    await runScenarioWithTimeout("L", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-l`);
        const candidates = await collectNavigationCandidates(page, `${baseUrl}/scenario-l`);
        const pass = candidates.length === 0;
        results["L (No contact candidates)"] = { pass, details: `Found ${candidates.length} candidates` };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["L (No contact candidates)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario M: False positive rejection for "About"
    await runScenarioWithTimeout("M", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-m`);
        const candidates = await collectNavigationCandidates(page, `${baseUrl}/scenario-m`);
        const pass = !candidates.some((c) => c.url.includes("/about"));
        results["M (Reject About Us)"] = { pass, details: pass ? "Successfully rejected /about" : "Failed (included /about)" };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["M (Reject About Us)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario N: False positive rejection for "Learn More"
    await runScenarioWithTimeout("N", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-n`);
        const candidates = await collectNavigationCandidates(page, `${baseUrl}/scenario-n`);
        const pass = !candidates.some((c) => c.url.includes("/services"));
        results["N (Reject Learn More)"] = { pass, details: pass ? "Successfully rejected /services" : "Failed" };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["N (Reject Learn More)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario O: Privacy / Terms exclusion
    await runScenarioWithTimeout("O", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-o`);
        const candidates = await collectNavigationCandidates(page, `${baseUrl}/scenario-o`);
        const pass = candidates.length === 0;
        results["O (Exclude Privacy/Terms)"] = { pass, details: pass ? "0 candidates (cleanly excluded)" : "Failed" };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["O (Exclude Privacy/Terms)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario P: mailto/phone only page (No form detected)
    await runScenarioWithTimeout("P", async () => {
      const res = await discoverSubmissionTargets({ websiteUrl: `${baseUrl}/scenario-p`, timeoutMs: 5000 });
      const pass = res.targets.length === 0;
      results["P (mailto/tel only -> NO_FORM)"] = { pass, details: pass ? "Correctly identified as no web form" : "Failed" };
    }).catch((err) => {
      results["P (mailto/tel only -> NO_FORM)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario Q: External domain exclusion
    await runScenarioWithTimeout("Q", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-q`);
        const candidates = await collectNavigationCandidates(page, `${baseUrl}/scenario-q`);
        const pass = !candidates.some((c) => c.url.includes("other-unrelated-domain.com"));
        results["Q (Exclude external domains)"] = { pass, details: pass ? "Preserved same-domain safety" : "Failed" };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["Q (Exclude external domains)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario R: Embedded HubSpot
    await runScenarioWithTimeout("R", async () => {
      const res = await discoverSubmissionTargets({ websiteUrl: `${baseUrl}/scenario-r`, timeoutMs: 8000 });
      const pass = res.targets.some((t) => t.url.includes("hsforms.com") || t.url.includes("/scenario-r-page"));
      results["R (Embedded HubSpot)"] = { pass, details: pass ? `Discovered: ${res.targets[0]?.url}` : "Failed" };
    }).catch((err) => {
      results["R (Embedded HubSpot)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario S: Embedded LeadConnector
    await runScenarioWithTimeout("S", async () => {
      const res = await discoverSubmissionTargets({ websiteUrl: `${baseUrl}/scenario-s`, timeoutMs: 8000 });
      const pass = res.targets.some((t) => t.url.includes("leadconnectorhq.com") || t.url.includes("/scenario-s-page"));
      results["S (Embedded LeadConnector)"] = { pass, details: pass ? `Discovered: ${res.targets[0]?.url}` : "Failed" };
    }).catch((err) => {
      results["S (Embedded LeadConnector)"] = { pass: false, details: `Error: ${err.message}` };
    });

    // Scenario T: Calendly event target
    await runScenarioWithTimeout("T", async () => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/scenario-t`);
        const candidates = await collectNavigationCandidates(page, `${baseUrl}/scenario-t`);
        const match = candidates.find((c) => c.url.includes("calendly.com/acme-corp/intro-call"));
        const pass = Boolean(match);
        results["T (Calendly Event)"] = { pass, details: match ? `Discovered supported Calendly target: ${match.url}` : "Failed" };
      } finally {
        await page.close().catch(() => {});
      }
    }).catch((err) => {
      results["T (Calendly Event)"] = { pass: false, details: `Error: ${err.message}` };
    });

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    server.close();
  }

  console.log("\n==================================================");
  console.log("RESULTS SUMMARY: SCENARIOS A THROUGH T");
  console.log("==================================================");
  let totalPass = 0;
  const entries = Object.entries(results);
  for (const [scenario, res] of entries) {
    if (res.pass) totalPass++;
    console.log(`[${res.pass ? "PASS" : "FAIL"}] Scenario ${scenario}: ${res.details}`);
  }
  console.log(`\nTOTAL: ${totalPass} / ${entries.length} PASS (${((totalPass / entries.length) * 100).toFixed(1)}%)`);

  if (totalPass !== entries.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
