import { chromium } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable";
import { splitFullName, classifyField, extractFieldSignals } from "../services/field-classifier";
import { fillDetectedFields, sweepAndCheckPreSubmitCheckboxes, selectRequiredRadioDefaults } from "../services/contact-form-automation";
import type { LeadData } from "../types/automation";

async function runTestSuite() {
  console.log("=================================================");
  console.log("  AUTOMATED LEAD DATA MAPPING & FORM FILLING TEST");
  console.log("=================================================\n");

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    totalTests++;
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
    }
  }

  // TEST 1: splitFullName Unit Tests
  console.log("--- 1. Testing splitFullName Logic ---");
  const name1 = splitFullName("John Doe");
  assert(name1.firstName === "John" && name1.lastName === "Doe", "Two-word name splits correctly into First and Last");

  const name2 = splitFullName("Cher");
  assert(name2.firstName === "Cher" && name2.lastName === "", "Single-word name does NOT duplicate into last name", `Got: first="${name2.firstName}", last="${name2.lastName}"`);

  const name3 = splitFullName("Mary Jane Watson");
  assert(name3.firstName === "Mary" && name3.lastName === "Jane Watson" && name3.middleName === "Jane", "Three-word name preserves middle name in last name when no middle field exists", `Got: first="${name3.firstName}", middle="${name3.middleName}", last="${name3.lastName}"`);

  const name4 = splitFullName("Dr. Martin Luther King Jr.");
  assert(name4.firstName === "Dr. Martin" && name4.lastName === "Luther King Jr." && name4.pureLastName === "Jr.", "Prefix handled correctly without dropping names", `Got: first="${name4.firstName}", last="${name4.lastName}"`);

  // Launch browser for DOM integration tests
  const executablePath = await getChromiumExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();

  try {
    // TEST 2: Single Full Name Field
    console.log("\n--- 2. Single Full Name Field ---");
    const leadSingleName: LeadData = {
      fullName: "Alexander Hamilton",
      email: "alex@treasury.gov",
      mobile: "+15551234567"
    };
    await page.setContent(`
      <form id="f1">
        <label for="fullname">Full Name</label>
        <input type="text" id="fullname" name="fullname" />
        <label for="email">Email</label>
        <input type="email" id="email" name="email" />
      </form>
    `);
    await fillDetectedFields(page, leadSingleName);
    const f1Name = await page.$eval("#fullname", (el: any) => el.value);
    assert(f1Name === "Alexander Hamilton", "Single Full Name field filled with complete full name", `Got "${f1Name}"`);

    // TEST 3: Separate First and Last Name Fields (Standard, Single Name, Multi-Word, with Middle Name)
    console.log("\n--- 3. Separate Name Fields ---");
    // 3a. Standard two words
    await page.setContent(`
      <form id="f2">
        <input type="text" id="fname" name="first_name" />
        <input type="text" id="lname" name="last_name" />
        <input type="email" id="email" name="email" />
      </form>
    `);
    await fillDetectedFields(page, { fullName: "Sarah Connor", email: "sarah@future.net" });
    const f2First = await page.$eval("#fname", (el: any) => el.value);
    const f2Last = await page.$eval("#lname", (el: any) => el.value);
    assert(f2First === "Sarah" && f2Last === "Connor", "Separate First and Last name filled from two-word full name", `Got first="${f2First}", last="${f2Last}"`);

    // 3b. Single name (must NOT duplicate into last name)
    await page.setContent(`
      <form id="f2b">
        <input type="text" id="fname" name="first_name" />
        <input type="text" id="lname" name="last_name" />
        <input type="email" id="email" name="email" />
      </form>
    `);
    await fillDetectedFields(page, { fullName: "Madonna", email: "madonna@music.com" });
    const f2bFirst = await page.$eval("#fname", (el: any) => el.value);
    const f2bLast = await page.$eval("#lname", (el: any) => el.value);
    assert(f2bFirst === "Madonna" && f2bLast === "", "Single-word name does NOT duplicate into last name field", `Got first="${f2bFirst}", last="${f2bLast}"`);

    // 3c. Multi-word name without middle name field (middle name preserved in last name)
    await page.setContent(`
      <form id="f2c">
        <input type="text" id="fname" name="first_name" />
        <input type="text" id="lname" name="last_name" />
        <input type="email" id="email" name="email" />
      </form>
    `);
    await fillDetectedFields(page, { fullName: "Mary Jane Watson", email: "mj@dailybugle.com" });
    const f2cFirst = await page.$eval("#fname", (el: any) => el.value);
    const f2cLast = await page.$eval("#lname", (el: any) => el.value);
    assert(f2cFirst === "Mary" && f2cLast === "Jane Watson", "Multi-word name preserves middle name in last name field", `Got first="${f2cFirst}", last="${f2cLast}"`);

    // 3d. Form with First, Middle, and Last name fields
    await page.setContent(`
      <form id="f2d">
        <input type="text" id="fname" name="first_name" />
        <input type="text" id="mname" name="middle_name" />
        <input type="text" id="lname" name="last_name" />
        <input type="email" id="email" name="email" />
      </form>
    `);
    await fillDetectedFields(page, { fullName: "Arthur Conan Doyle", email: "arthur@sherlock.uk" });
    const f2dFirst = await page.$eval("#fname", (el: any) => el.value);
    const f2dMiddle = await page.$eval("#mname", (el: any) => el.value);
    const f2dLast = await page.$eval("#lname", (el: any) => el.value);
    assert(f2dFirst === "Arthur" && f2dMiddle === "Conan" && f2dLast === "Doyle", "Form with middle name field fills First, Middle, and Last without overlap", `Got first="${f2dFirst}", middle="${f2dMiddle}", last="${f2dLast}"`);

    // TEST 4: Mobile, Phone, Contact Number, WhatsApp
    console.log("\n--- 4. Mobile / Phone / WhatsApp Mapping ---");
    const userPhone = "+44 20 7946 0991";

    // 4a. Standard Phone input
    await page.setContent(`
      <form id="f3a">
        <input type="text" id="phone" name="phone" />
        <input type="email" id="email" name="email" />
      </form>
    `);
    await fillDetectedFields(page, { fullName: "Sherlock Holmes", email: "sherlock@bakerstreet.com", mobile: userPhone });
    const f3aPhone = await page.$eval("#phone", (el: any) => el.value);
    assert(f3aPhone === userPhone, "Phone field preserves supplied phone number and formatting", `Got "${f3aPhone}"`);

    // 4b. Mobile Number input (type="tel")
    await page.setContent(`
      <form id="f3b">
        <input type="tel" id="mobile" name="mobile_number" />
        <input type="email" id="email" name="email" />
      </form>
    `);
    await fillDetectedFields(page, { fullName: "Sherlock Holmes", email: "sherlock@bakerstreet.com", mobile: userPhone });
    const f3bMobile = await page.$eval("#mobile", (el: any) => el.value);
    assert(f3bMobile === userPhone, "Mobile Number (tel) field receives supplied mobile number", `Got "${f3bMobile}"`);

    // 4c. WhatsApp Number input
    await page.setContent(`
      <form id="f3c">
        <input type="text" id="whatsapp" name="whatsapp_number" />
        <input type="email" id="email" name="email" />
      </form>
    `);
    await fillDetectedFields(page, { fullName: "Sherlock Holmes", email: "sherlock@bakerstreet.com", mobile: userPhone });
    const f3cWhatsapp = await page.$eval("#whatsapp", (el: any) => el.value);
    assert(f3cWhatsapp === userPhone, "WhatsApp Number field receives supplied phone number", `Got "${f3cWhatsapp}"`);

    // TEST 5: Exact Email Preservation
    console.log("\n--- 5. Exact Email Preservation ---");
    await page.setContent(`
      <form id="f4">
        <input type="email" id="email" name="email_address" />
      </form>
    `);
    const exactEmail = "Special.Character+tag@subdomain.enterprise-client.co.uk";
    await fillDetectedFields(page, { fullName: "User", email: exactEmail });
    const f4Email = await page.$eval("#email", (el: any) => el.value);
    assert(f4Email === exactEmail, "Exact email string preserved without lowercasing corruption or dummy fallback", `Got "${f4Email}"`);

    // TEST 6: Company Name vs Address / Website / Phone Disambiguation
    console.log("\n--- 6. Company Name vs Address/Website Disambiguation ---");
    await page.setContent(`
      <form id="f5">
        <label for="company">Company Name</label>
        <input type="text" id="company" name="company_name" />

        <label for="comp_addr">Business Address</label>
        <input type="text" id="comp_addr" name="business_address" />

        <label for="comp_web">Company Website</label>
        <input type="url" id="comp_web" name="company_website" />

        <input type="email" id="email" name="email" />
      </form>
    `);
    const leadCompany: LeadData = {
      fullName: "Tony Stark",
      email: "tony@stark.com",
      companyName: "Stark Industries, Inc.",
      address: "10880 Malibu Point, Malibu, CA",
      website: "https://starkindustries.com"
    };
    await fillDetectedFields(page, leadCompany);
    const f5Company = await page.$eval("#company", (el: any) => el.value);
    const f5Addr = await page.$eval("#comp_addr", (el: any) => el.value);
    const f5Web = await page.$eval("#comp_web", (el: any) => el.value);
    assert(f5Company === "Stark Industries, Inc.", "Company Name mapped to company_name field", `Got "${f5Company}"`);
    assert(f5Addr === "10880 Malibu Point, Malibu, CA", "Business Address mapped to address, NOT confused with company", `Got "${f5Addr}"`);
    assert(f5Web === "https://starkindustries.com", "Company Website mapped to website, NOT confused with company", `Got "${f5Web}"`);

    // TEST 7: Strict Address vs. Message Separation
    console.log("\n--- 7. Strict Address vs. Message Separation ---");
    // 7a. Form with BOTH Address and Message
    await page.setContent(`
      <form id="f6">
        <input type="text" id="name" name="name" />
        <input type="email" id="email" name="email" />
        <textarea id="address" name="street_address" placeholder="Enter physical street address"></textarea>
        <textarea id="message" name="message" placeholder="How can we help?"></textarea>
      </form>
    `);
    const addrData: LeadData = {
      fullName: "Bruce Wayne",
      email: "bruce@wayne.corp",
      address: "1007 Mountain Drive, Gotham, NJ",
      message: "We need cybersecurity consulting for Wayne Enterprises."
    };
    await fillDetectedFields(page, addrData);
    const f6Addr = await page.$eval("#address", (el: any) => el.value);
    const f6Msg = await page.$eval("#message", (el: any) => el.value);
    assert(f6Addr === "1007 Mountain Drive, Gotham, NJ", "Address textarea receives ONLY the address", `Got "${f6Addr}"`);
    assert(f6Msg === "We need cybersecurity consulting for Wayne Enterprises.", "Message textarea receives ONLY the message", `Got "${f6Msg}"`);
    assert(!f6Addr.includes("cybersecurity"), "Address does NOT leak message content");
    assert(!f6Msg.includes("Mountain Drive"), "Message does NOT leak address content");

    // 7b. Form with Address ONLY
    await page.setContent(`
      <form id="f6b">
        <input type="text" id="name" name="name" />
        <input type="email" id="email" name="email" />
        <textarea id="address" name="address" placeholder="Mailing Address"></textarea>
      </form>
    `);
    await fillDetectedFields(page, addrData);
    const f6bAddr = await page.$eval("#address", (el: any) => el.value);
    assert(f6bAddr === "1007 Mountain Drive, Gotham, NJ", "Form with address only receives address in address textarea", `Got "${f6bAddr}"`);

    // 7c. Form with Message ONLY
    await page.setContent(`
      <form id="f6c">
        <input type="text" id="name" name="name" />
        <input type="email" id="email" name="email" />
        <textarea id="message" name="message" placeholder="Your inquiry"></textarea>
      </form>
    `);
    await fillDetectedFields(page, addrData);
    const f6cMsg = await page.$eval("#message", (el: any) => el.value);
    assert(f6cMsg === "We need cybersecurity consulting for Wayne Enterprises.", "Form with message only receives message in message textarea", `Got "${f6cMsg}"`);

    // TEST 8: Dropdowns and Selection Controls
    console.log("\n--- 8. Dropdowns and Selection Controls ---");
    await page.setContent(`
      <form id="f7">
        <input type="text" name="name" />
        <input type="email" name="email" />
        <select id="service" name="service" required>
          <option value="">-- Please Select a Service --</option>
          <option value="seo">SEO Optimization</option>
          <option value="web">Web Development</option>
        </select>
        <select id="payment" name="payment_credit_card">
          <option value="">-- Select Payment Method --</option>
          <option value="cc">Authorize Credit Card</option>
        </select>
      </form>
    `);
    await fillDetectedFields(page, { fullName: "User", email: "user@test.com" });
    const f7ServiceVal = await page.$eval("#service", (el: any) => el.value);
    const f7PaymentVal = await page.$eval("#payment", (el: any) => el.value);
    assert(f7ServiceVal === "seo" || f7ServiceVal === "web", "Required dropdown selected first valid non-placeholder option", `Got value "${f7ServiceVal}"`);
    assert(f7PaymentVal === "", "Sensitive payment dropdown was NOT arbitrarily selected", `Got value "${f7PaymentVal}"`);

    // TEST 9: Radio Buttons
    console.log("\n--- 9. Required Radio Buttons ---");
    await page.setContent(`
      <form id="f8">
        <input type="text" name="name" />
        <input type="email" name="email" />
        <fieldset class="required">
          <legend>Preferred Contact Time *</legend>
          <label><input type="radio" name="contact_time" value="morning" required /> Morning</label>
          <label><input type="radio" name="contact_time" value="afternoon" required /> Afternoon</label>
        </fieldset>
      </form>
    `);
    await selectRequiredRadioDefaults(page);
    const morningChecked = await page.$eval("input[value='morning']", (el: any) => el.checked);
    const afternoonChecked = await page.$eval("input[value='afternoon']", (el: any) => el.checked);
    assert(morningChecked || afternoonChecked, "Required radio button group has valid selection", `Morning=${morningChecked}, Afternoon=${afternoonChecked}`);

    // TEST 10: Checkboxes - Required Consent vs. Optional Newsletter
    console.log("\n--- 10. Consent vs. Optional Marketing Checkboxes ---");
    await page.setContent(`
      <form id="f9">
        <input type="text" name="name" />
        <input type="email" name="email" />
        <div class="form-group">
          <label><input type="checkbox" id="terms-cb" name="terms" required /> I agree to the Terms of Service & Privacy Policy</label>
        </div>
        <div class="form-group">
          <label><input type="checkbox" id="news-cb" name="newsletter" /> Send me promotional marketing newsletters and discounts</label>
        </div>
      </form>
    `);
    await sweepAndCheckPreSubmitCheckboxes(page);
    const termsChecked = await page.$eval("#terms-cb", (el: any) => el.checked);
    const newsChecked = await page.$eval("#news-cb", (el: any) => el.checked);
    assert(termsChecked === true, "Required Terms/Consent checkbox was automatically checked", `termsChecked=${termsChecked}`);
    assert(newsChecked === false, "Optional Marketing/Newsletter checkbox was NOT checked", `newsChecked=${newsChecked}`);

    // TEST 11: Missing Required Fields Honest Reporting (No Invented Data)
    console.log("\n--- 11. Missing Required Fields Honest Reporting ---");
    await page.setContent(`
      <form id="f10">
        <label for="fname">First Name *</label>
        <input type="text" id="fname" name="fname" required />

        <label for="tax_id">Government Tax ID *</label>
        <input type="text" id="tax_id" name="tax_id" required />
      </form>
    `);
    const fillRes = await fillDetectedFields(page, {
      fullName: "Alan Turing",
      email: "alan@bletchley.uk"
    });
    const taxVal = await page.$eval("#tax_id", (el: any) => el.value);
    assert(taxVal === "", "Unmapped required field was NOT filled with fake invented data", `Got value "${taxVal}"`);
    assert(
      fillRes.metrics?.unmappedRequiredFields.some((f) => f.includes("tax_id")),
      "Unmapped required field is honestly reported in unmappedRequiredFields metrics",
      `Metrics: ${JSON.stringify(fillRes.metrics?.unmappedRequiredFields)}`
    );

    // TEST 12: Consecutive Jobs with Different Lead Data (No Stale Leakage)
    console.log("\n--- 12. Consecutive Jobs Data Isolation ---");
    const job1Lead: LeadData = {
      fullName: "Job One Lead",
      email: "lead1@jobone.com",
      mobile: "111-111-1111",
      companyName: "First Company",
      address: "111 First Ave",
      message: "First Job Inquiry"
    };
    const job2Lead: LeadData = {
      fullName: "Job Two Lead",
      email: "lead2@jobtwo.com",
      mobile: "222-222-2222",
      companyName: "Second Company",
      address: "222 Second Ave",
      message: "Second Job Inquiry"
    };

    // Run Job 1
    await page.setContent(`
      <form id="f11">
        <input type="text" id="name" name="name" />
        <input type="email" id="email" name="email" />
        <input type="tel" id="phone" name="phone" />
        <input type="text" id="company" name="company" />
        <input type="text" id="address" name="address" />
        <textarea id="message" name="message"></textarea>
      </form>
    `);
    await fillDetectedFields(page, job1Lead);
    const j1Name = await page.$eval("#name", (el: any) => el.value);
    const j1Email = await page.$eval("#email", (el: any) => el.value);

    // Run Job 2 on new form
    await page.setContent(`
      <form id="f12">
        <input type="text" id="name" name="name" />
        <input type="email" id="email" name="email" />
        <input type="tel" id="phone" name="phone" />
        <input type="text" id="company" name="company" />
        <input type="text" id="address" name="address" />
        <textarea id="message" name="message"></textarea>
      </form>
    `);
    await fillDetectedFields(page, job2Lead);
    const j2Name = await page.$eval("#name", (el: any) => el.value);
    const j2Email = await page.$eval("#email", (el: any) => el.value);
    const j2Phone = await page.$eval("#phone", (el: any) => el.value);
    const j2Company = await page.$eval("#company", (el: any) => el.value);
    const j2Address = await page.$eval("#address", (el: any) => el.value);
    const j2Message = await page.$eval("#message", (el: any) => el.value);

    assert(j1Name === "Job One Lead" && j1Email === "lead1@jobone.com", "Job 1 processed with Job 1 data");
    assert(j2Name === "Job Two Lead" && j2Email === "lead2@jobtwo.com", "Job 2 processed with Job 2 data without stale leakage from Job 1");
    assert(j2Phone === "222-222-2222" && j2Company === "Second Company", "Job 2 phone and company match Job 2");
    assert(j2Address === "222 Second Ave" && j2Message === "Second Job Inquiry", "Job 2 address and message match Job 2");

  } finally {
    await browser.close();
  }

  console.log("\n=================================================");
  console.log(`  TEST RESULTS: ${passedTests} / ${totalTests} PASSED`);
  console.log("=================================================");

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
