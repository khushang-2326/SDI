import http from 'http';
import { chromium, Browser } from 'playwright';
import { fillAllVisibleForms, submitContactForm } from '../services/contact-form-automation';
import { getChromiumExecutablePath } from '../services/browser-executable';

async function runTestServer(port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const url = req.url || '/';

    if (url === '/user-data-priority') {
      // Form with state, city, country, postal code, and job title
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>User Data Priority Form</title></head>
        <body>
          <form id="contact-form" action="/success" method="POST">
            <input type="text" name="first_name" id="fn" required />
            <input type="text" name="last_name" id="ln" required />
            <input type="email" name="email" id="em" required />
            <input type="text" name="city" id="city_input" required />
            <input type="text" name="state" id="state_input" required />
            <input type="text" name="country" id="country_input" required />
            <input type="text" name="zip" id="zip_input" required />
            <input type="text" name="job_title" id="job_input" required />
            <textarea name="message" id="msg_input" required></textarea>
            <button type="submit" id="btn-submit">Submit</button>
          </form>
        </body>
        </html>
      `);
    } else if (url === '/categorical-selects') {
      // Form with categorical dropdowns: industry, budget, service, company_size
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Categorical Selects Form</title></head>
        <body>
          <form id="categorical-form" action="/success" method="POST">
            <input type="text" name="name" required />
            <input type="email" name="email" required />
            
            <label for="ind">Industry</label>
            <select id="ind" name="industry" required>
              <option value="">-- Please Select Your Industry --</option>
              <option value="software">Software & Tech</option>
              <option value="manufacturing">Manufacturing</option>
            </select>

            <label for="bud">Estimated Budget</label>
            <select id="bud" name="budget" required>
              <option value="">Select a Budget Range</option>
              <option value="5k-10k">$5,000 - $10,000</option>
              <option value="10k-25k">$10,000 - $25,000</option>
            </select>

            <label for="srv">Service Needed</label>
            <select id="srv" name="service" required>
              <option value="">Choose Service</option>
              <option value="seo">SEO Optimization</option>
              <option value="ppc">Paid Advertising</option>
            </select>

            <label for="hear">How did you hear about us?</label>
            <select id="hear" name="referral_source" required>
              <option value="">Which platform?</option>
              <option value="google">Google Search</option>
              <option value="referral">Client Referral</option>
            </select>

            <textarea name="message" required></textarea>
            <button type="submit">Submit</button>
          </form>
        </body>
        </html>
      `);
    } else if (url === '/unknown-required-field') {
      // Form with an unclassifiable custom required text field
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Unknown Required Field Form</title></head>
        <body>
          <form id="strict-form" action="/success" method="POST">
            <input type="text" name="name" required />
            <input type="email" name="email" required />
            <label for="tax_id">Tax Registration Number / Security Identifier</label>
            <input type="text" id="tax_id" name="organization_tax_registration_id" required />
            <textarea name="message" required></textarea>
            <button type="submit">Submit</button>
          </form>
        </body>
        </html>
      `);
    } else if (url === '/success') {
      res.end('<h1>Thank you! Your message has been sent successfully.</h1>');
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

async function runFieldSemanticsVerification() {
  const PORT = 38945;
  const server = await runTestServer(PORT);
  console.log(`[Test Server] Running on http://localhost:${PORT}`);

  const browser: Browser = await chromium.launch({
    headless: true,
    executablePath: await getChromiumExecutablePath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  let passed = 0;
  let failed = 0;

  try {
    // -------------------------------------------------------------
    // TEST 1: User Lead Data Priority (Explicit Values NOT Overridden)
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: User Data Priority (State = Gujarat, City = Ahmedabad) ---');
    const userLead = {
      fullName: 'Aarav Patel',
      firstName: 'Aarav',
      lastName: 'Patel',
      email: 'aarav.patel@techcorp.in',
      mobile: '+91 98765 43210',
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      postalCode: '380001',
      jobTitle: 'Principal Architect',
      message: 'Interested in exploring cloud migration partnerships.',
      companyName: 'TechCorp India'
    };

    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await page1.goto(`http://localhost:${PORT}/user-data-priority`);

    const fillRes1 = await fillAllVisibleForms(page1, userLead);

    const cityVal = await page1.$eval('#city_input', (el: any) => el.value).catch(() => '');
    const stateVal = await page1.$eval('#state_input', (el: any) => el.value).catch(() => '');
    const countryVal = await page1.$eval('#country_input', (el: any) => el.value).catch(() => '');
    const zipVal = await page1.$eval('#zip_input', (el: any) => el.value).catch(() => '');
    const jobVal = await page1.$eval('#job_input', (el: any) => el.value).catch(() => '');

    console.log('DOM Readback Values:', { cityVal, stateVal, countryVal, zipVal, jobVal });
    await ctx1.close();

    const isStateCorrect = stateVal === 'Gujarat';
    const isCityCorrect = cityVal === 'Ahmedabad';
    const isCountryCorrect = countryVal === 'India';
    const isZipCorrect = zipVal === '380001';
    const isJobCorrect = jobVal === 'Principal Architect';

    if (isStateCorrect && isCityCorrect && isCountryCorrect && isZipCorrect && isJobCorrect && fillRes1.filledFields.length >= 8) {
      console.log('✅ PASS: Test 1 (User data preserved with highest priority, fallback did not override)');
      passed++;
    } else {
      console.error('❌ FAIL: Test 1 - Fallback incorrectly replaced user data');
      failed++;
    }

    // -------------------------------------------------------------
    // TEST 2: Categorical Dropdowns (Industry, Budget, Service)
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Categorical Dropdown Options Selection ---');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(`http://localhost:${PORT}/categorical-selects`);

    const fillRes2 = await fillAllVisibleForms(page2, userLead);

    const indVal = await page2.$eval('#ind', (el: any) => el.value).catch(() => '');
    const budVal = await page2.$eval('#bud', (el: any) => el.value).catch(() => '');
    const srvVal = await page2.$eval('#srv', (el: any) => el.value).catch(() => '');
    const hearVal = await page2.$eval('#hear', (el: any) => el.value).catch(() => '');

    console.log('Categorical Dropdown Selected Values:', { indVal, budVal, srvVal, hearVal });
    await ctx2.close();

    // Valid non-placeholder values must be selected
    const isIndValid = indVal === 'software';
    const isBudValid = budVal === '5k-10k';
    const isSrvValid = srvVal === 'seo';
    const isHearValid = hearVal === 'google';

    if (isIndValid && isBudValid && isSrvValid && isHearValid && fillRes2.filledFields.length >= 6) {
      console.log('✅ PASS: Test 2 (Categorical selects correctly selected first valid options and ignored placeholders)');
      passed++;
    } else {
      console.error('❌ FAIL: Test 2 - Categorical select options failed');
      failed++;
    }

    // -------------------------------------------------------------
    // TEST 3: Unknown Unclassifiable Required Field
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Unknown Unclassifiable Required Field (No Value Invented) ---');
    const ctx3 = await browser.newContext();
    const res3 = await submitContactForm({
      websiteUrl: `http://localhost:${PORT}/unknown-required-field`,
      leadData: userLead,
      submit: true,
      browserContext: ctx3,
      skipPersist: true,
      timeoutMs: 30000
    });
    await ctx3.close();

    console.log('Unknown Required Field Result:', {
      status: res3.status,
      errorMessage: res3.errorMessage
    });

    // Invariant must catch the unmapped required field and reject with REQUIRED_FIELD_UNMAPPED
    if (res3.status === 'failed' && res3.errorMessage?.includes('REQUIRED_FIELD_UNMAPPED') && res3.errorMessage?.includes('organization_tax_registration_id')) {
      console.log('✅ PASS: Test 3 (Did not invent a value for unknown required field; returned REQUIRED_FIELD_UNMAPPED with field details)');
      passed++;
    } else {
      console.error('❌ FAIL: Test 3 - Did not properly reject unknown required field');
      failed++;
    }

  } catch (err) {
    console.error('Verification error:', err);
    failed++;
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n======================================================`);
  console.log(`FIELD SEMANTICS VERIFICATION: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runFieldSemanticsVerification().catch(err => {
  console.error(err);
  process.exit(1);
});
