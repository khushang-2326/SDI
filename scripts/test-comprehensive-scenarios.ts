import http from 'http';
import { chromium } from 'playwright';

async function runScenarioServer(port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const url = req.url || '/';

    if (url === '/modal-form') {
      // Scenario 1: A page with an overlay/modal that contains a contact form and a newsletter overlay
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Modal Contact Form</title></head>
        <body>
          <div id="newsletter-promo" class="promo-modal active" style="position:fixed;top:0;left:0;width:300px;height:200px;background:#fff;z-index:9999;">
            <p>Subscribe to our newsletter!</p>
            <button class="close-btn" aria-label="Close" onclick="this.parentElement.remove()">×</button>
          </div>
          <div id="contact-wrapper" style="margin-top:50px;">
            <form id="main-contact-form" action="/success" method="POST">
              <input type="text" name="your-name" placeholder="Your Name" required />
              <input type="email" name="your-email" placeholder="Your Email" required />
              <input type="text" name="company_name" placeholder="Company Name" />
              <select name="service_interest" required>
                <option value="">-- Please Select a Service --</option>
                <option value="consulting">Consulting</option>
                <option value="development">Development</option>
              </select>
              <textarea name="your-message" placeholder="Message" required></textarea>
              <input type="checkbox" name="terms_accepted" required /> I accept terms
              <button type="submit" id="submit-btn">Send Message</button>
            </form>
          </div>
        </body>
        </html>
      `);
    } else if (url === '/unmapped-fields') {
      // Scenario 2: Form with CMS technical names (wpforms, item_meta, select fields, custom fields)
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>CMS Technical Names Form</title></head>
        <body>
          <form id="wpform" action="/success" method="POST">
            <input type="text" name="wpforms[fields][1][first]" required />
            <input type="text" name="wpforms[fields][1][last]" required />
            <input type="email" name="wpforms[fields][2]" required />
            <input type="tel" name="wpforms[fields][3]" required />
            <input type="text" name="wpforms[fields][4][city]" required />
            <input type="text" name="wpforms[fields][4][state]" required />
            <input type="text" name="wpforms[fields][4][postal]" required />
            <select name="wpforms[fields][5]" required>
              <option value="">Select Country</option>
              <option value="US">United States</option>
              <option value="CA">Canada</option>
            </select>
            <textarea name="wpforms[fields][6]" required></textarea>
            <input type="checkbox" name="wpforms[fields][7]" required />
            <button type="submit">Submit Inquiry</button>
          </form>
        </body>
        </html>
      `);
    } else if (url === '/react-controlled') {
      // Scenario 3: React-like controlled form with hidden input synchronization
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>React Controlled Form</title></head>
        <body>
          <div id="root">
            <form id="react-form" onsubmit="event.preventDefault(); window.submitted = true; document.getElementById('msg').innerText = 'Thank you! Your message has been sent successfully.';">
              <input type="text" id="fn" name="firstName" required />
              <input type="text" id="ln" name="lastName" required />
              <input type="email" id="em" name="email" required />
              <textarea id="msg_body" name="message" required></textarea>
              <button type="submit" id="btn-submit">Submit</button>
            </form>
            <div id="msg"></div>
          </div>
          <script>
            // Add listeners to simulate reactive state bindings
            ['fn', 'ln', 'em', 'msg_body'].forEach(id => {
              const el = document.getElementById(id);
              el.addEventListener('input', (e) => { el.setAttribute('data-value', e.target.value); });
            });
          </script>
        </body>
        </html>
      `);
    } else if (url === '/challenge-false-positive') {
      // Scenario 4: Page containing DataDome or Cloudflare analytics script tag, but NO blocking interstitial challenge
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Regular Page with Security Telemetry</title>
          <script src="https://js.datadome.co/tags.js"></script>
        </head>
        <body>
          <h1>Welcome to our Company</h1>
          <form id="contact" action="/success" method="POST">
            <input type="text" name="fullName" required />
            <input type="email" name="email" required />
            <textarea name="message" required></textarea>
            <button type="submit">Submit</button>
          </form>
        </body>
        </html>
      `);
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

import { submitContactForm } from '../services/contact-form-automation';
import { dismissBlockingPopups } from '../services/cookie-consent-helper';
import { detectUnsupportedVerification } from '../services/verification-detector';
import { getChromiumExecutablePath } from '../services/browser-executable';

async function runComprehensiveTests() {
  const PORT = 38942;
  const server = await runScenarioServer(PORT);
  console.log(`[Test Server] Running on http://localhost:${PORT}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: await getChromiumExecutablePath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  let passed = 0;
  let failed = 0;

  const lead = {
    fullName: 'Alex Mercer',
    email: 'alex.mercer@innovatetech.io',
    mobile: '+1 555-0199',
    companyName: 'InnovateTech Solutions',
    website: 'https://innovatetech.io',
    message: 'Hello, we are interested in your services and would like to request more details.',
    subject: 'Partnership Inquiry',
  };

  try {
    // TEST 1: Modal Promo Dismissal + Contact Form Submission
    console.log('\n--- Scenario 1: Modal Promo Dismissal & Form Submission ---');
    const ctx1 = await browser.newContext();
    const res1 = await submitContactForm({
      websiteUrl: `http://localhost:${PORT}/modal-form`,
      leadData: lead,
      submit: true,
      browserContext: ctx1,
      skipPersist: true,
      timeoutMs: 30000
    });
    console.log('Result 1:', {
      status: res1.status,
      filledCount: res1.filledFields.length
    });
    await ctx1.close();

    if (res1.status === 'success') {
      console.log('✅ PASS: Scenario 1 (Modal promo dismissed and form submitted)');
      passed++;
    } else {
      console.error('❌ FAIL: Scenario 1 -', res1.errorMessage || res1.status);
      failed++;
    }

    // TEST 2: Unmapped Technical CMS Fields & Safe Fallbacks
    console.log('\n--- Scenario 2: CMS Technical Field Resolution & Safe Fallbacks ---');
    const ctx2 = await browser.newContext();
    const res2 = await submitContactForm({
      websiteUrl: `http://localhost:${PORT}/unmapped-fields`,
      leadData: lead,
      submit: true,
      browserContext: ctx2,
      skipPersist: true,
      timeoutMs: 30000
    });
    console.log('Result 2:', {
      status: res2.status,
      filledCount: res2.filledFields.length
    });
    await ctx2.close();

    if (res2.status === 'success') {
      console.log('✅ PASS: Scenario 2 (CMS Technical Fields & Safe Fallback resolution)');
      passed++;
    } else {
      console.error('❌ FAIL: Scenario 2 -', res2.errorMessage || res2.status);
      failed++;
    }

    // TEST 3: React Controlled Form & DOM Event Synchronization
    console.log('\n--- Scenario 3: React Controlled Form & Value Sync ---');
    const ctx3 = await browser.newContext();
    const res3 = await submitContactForm({
      websiteUrl: `http://localhost:${PORT}/react-controlled`,
      leadData: lead,
      submit: true,
      browserContext: ctx3,
      skipPersist: true,
      timeoutMs: 30000
    });
    console.log('Result 3:', {
      status: res3.status,
      filledCount: res3.filledFields.length
    });
    await ctx3.close();

    if (res3.status === 'success') {
      console.log('✅ PASS: Scenario 3 (React Controlled Input & Event Synchronization)');
      passed++;
    } else {
      console.error('❌ FAIL: Scenario 3 -', res3.errorMessage || res3.status);
      failed++;
    }

    // TEST 4: Bot Challenge False-Positive Hardening (Visibility check)
    console.log('\n--- Scenario 4: Bot Challenge False-Positive Filtering ---');
    const ctx4 = await browser.newContext();
    const page4 = await ctx4.newPage();
    await page4.goto(`http://localhost:${PORT}/challenge-false-positive`);
    const challengeCheck = await detectUnsupportedVerification(page4, `http://localhost:${PORT}/challenge-false-positive`);
    console.log('Challenge detected:', challengeCheck);
    await ctx4.close();

    if (!challengeCheck || challengeCheck.blocking === false) {
      console.log('✅ PASS: Scenario 4 (Passive background script does not trigger Robot Challenge classification)');
      passed++;
    } else {
      console.error('❌ FAIL: Scenario 4 (False positive challenge detected!)');
      failed++;
    }

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n========================================`);
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runComprehensiveTests().catch(err => {
  console.error(err);
  process.exit(1);
});
