import { chromium } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable";
import { submitContactForm } from "../services/contact-form-automation";
import http from "http";

const htmlContent = `
<!DOCTYPE html>
<html>
<head><title>Test Contact Form</title></head>
<body>
  <form id="contact-form">
    <label for="fname">First Name *</label>
    <input type="text" id="fname" name="firstName" required />

    <label for="lname">Last Name *</label>
    <input type="text" id="lname" name="lastName" required />

    <label for="email">Email *</label>
    <input type="email" id="email" name="email" required />

    <label for="phone">Phone Number *</label>
    <input type="tel" id="phone" name="phone" required />

    <label for="company">Company Name</label>
    <input type="text" id="company" name="company" />

    <label for="address">Street Address *</label>
    <input type="text" id="address" name="address" required />

    <label for="reason">Reason for Contact *</label>
    <select id="reason" name="reason" required>
      <option value="">-- Please choose an option --</option>
      <option value="sales">Sales & Partnerships</option>
      <option value="support">Customer Support</option>
      <option value="billing">Billing Inquiry</option>
    </select>

    <label for="priority">Priority</label>
    <select id="priority" name="priority">
      <option value="">Select priority</option>
      <option value="normal">Normal</option>
      <option value="high">Urgent</option>
    </select>

    <fieldset>
      <legend>Preferred Contact Method *</legend>
      <label><input type="radio" name="contactMethod" value="email" required /> Email</label>
      <label><input type="radio" name="contactMethod" value="phone" required /> Phone</label>
    </fieldset>

    <label for="message">Message *</label>
    <textarea id="message" name="message" required></textarea>

    <label>
      <input type="checkbox" id="terms" name="terms" required />
      I agree to the Terms of Service and Privacy Policy *
    </label>

    <label>
      <input type="checkbox" id="newsletter" name="newsletter" />
      Subscribe to our promotional marketing newsletter
    </label>

    <button type="submit" id="submit-btn">Submit Message</button>
  </form>
</body>
</html>
`;

async function runTest() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(htmlContent);
  });

  server.listen(4567, async () => {
    console.log("Local test server listening on http://localhost:4567");

    const browser = await chromium.launch({
      headless: true,
      executablePath: await getChromiumExecutablePath()
    });

    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      await page.goto("http://localhost:4567");

      const res = await submitContactForm({
        websiteUrl: "http://localhost:4567",
        leadData: {
          firstName: "John",
          lastName: "Doe",
          email: "john.doe@example.com",
          phone: "2125550199",
          companyName: "Acme Corp",
          address: "742 Evergreen Terrace",
          message: "We need consulting on our web infrastructure."
        },
        submit: false,
        activePage: page
      });

      console.log("Form status:", res.status);
      console.log("Filled fields:", res.filledFields);
      console.log("Verification items count:", res.fieldVerificationItems?.length);

      const state = await page.evaluate(() => {
        const reasonSelect = document.getElementById("reason") as HTMLSelectElement;
        const prioritySelect = document.getElementById("priority") as HTMLSelectElement;
        const radios = Array.from(document.querySelectorAll("input[type='radio']")) as HTMLInputElement[];
        const termsCb = document.getElementById("terms") as HTMLInputElement;
        const newsCb = document.getElementById("newsletter") as HTMLInputElement;

        return {
          reasonSelectedValue: reasonSelect.value,
          reasonSelectedText: reasonSelect.options[reasonSelect.selectedIndex]?.text,
          prioritySelectedValue: prioritySelect.value,
          radioChecked: radios.find(r => r.checked)?.value,
          termsChecked: termsCb.checked,
          newsletterChecked: newsCb.checked
        };
      });

      console.log("Form controls state after automation:", JSON.stringify(state, null, 2));

      // Assertions
      if (state.reasonSelectedValue !== "sales") {
        throw new Error(`Expected reason to be 'sales', got '${state.reasonSelectedValue}'`);
      }
      if (!state.radioChecked) {
        throw new Error("Expected required radio to be checked!");
      }
      if (!state.termsChecked) {
        throw new Error("Expected required terms checkbox to be checked!");
      }
      if (state.newsletterChecked) {
        throw new Error("Expected optional newsletter checkbox to REMAIN UNCHECKED!");
      }

      console.log("ALL ASSERTIONS PASSED SUCCESSFULLY!");
    } catch (err: any) {
      console.error("Test failed:", err.message || err);
      process.exitCode = 1;
    } finally {
      await browser.close();
      server.close();
    }
  });
}

runTest();
