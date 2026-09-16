import { acquireContext, releaseContext } from "../lib/browserPool";
import { submitContactForm } from "../services/contact-form-automation";
import { LeadData } from "../types/automation";

const leadData: LeadData = {
  fullName: "Alex Rivera",
  email: "alex.rivera@example.com",
  mobile: "+14155552671",
  address: "123 Market St, San Francisco, CA",
  message: "Hi, I am interested in your services and would love to discuss a potential partnership.",
  companyName: "Rivera Consulting"
};

async function main() {
  console.log("Investigating based-agency.com/contact/...");
  const context = await acquireContext({ headless: true });
  try {
    const page = await context.newPage();
    page.on("console", msg => console.log("PAGE CONSOLE:", msg.text()));
    page.on("requestfailed", req => console.log("PAGE REQ FAILED:", req.url(), req.failure()?.errorText));

    const startTime = Date.now();
    console.log("Navigating to https://based-agency.com/contact/...");
    await page.goto("https://based-agency.com/contact/", { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log(`Navigation finished in ${Date.now() - startTime}ms`);

    // Check forms
    const formsCount = await page.locator("form").count();
    console.log(`Found ${formsCount} form(s)`);

    const inputs = await page.locator("form input, form textarea, form select").evaluateAll(els => els.map(e => ({
      name: e.getAttribute("name"),
      type: e.getAttribute("type"),
      placeholder: e.getAttribute("placeholder"),
      id: e.id,
      visible: e.getBoundingClientRect().width > 0
    })));
    console.log("Inputs:", inputs);

    const submitBtns = await page.locator("form button, form input[type='submit'], form [role='button']").evaluateAll(els => els.map(e => ({
      tag: e.tagName,
      text: e.textContent?.trim(),
      type: e.getAttribute("type"),
      visible: e.getBoundingClientRect().width > 0
    })));
    console.log("Submit controls:", submitBtns);

    await page.close();

    console.log("\nNow running submitContactForm directly...");
    const res = await submitContactForm({
      websiteUrl: "https://based-agency.com/contact/",
      leadData,
      submit: false,
      browserContext: context,
      skipPersist: true,
      timeoutMs: 45000
    });
    console.log("submitContactForm result:", res.status, res.errorMessage);
    console.log("Filled:", res.filledFields);
    console.log("Skipped:", res.skippedFields);
  } finally {
    await releaseContext(context);
  }
}

main().catch(console.error);
