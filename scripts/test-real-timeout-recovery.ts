import { chromium, type Browser } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable";
import { submitContactForm } from "../services/contact-form-automation";
import type { LeadData } from "../types/automation";

const lead: LeadData = {
  fullName: "John Miller",
  email: "john.miller@example.com",
  mobile: "2125550199",
  message: "Inquiry regarding web services and potential partnership.",
  companyName: "Miller Enterprises"
};

const realTimeoutTargets = [
  "https://www.californiaseopros.com/contact",
  "https://digitalpiloto.com/contact-us/",
  "https://newmediaroots.com/contact/",
  "https://solvid.co.uk/contact/",
  "https://www.propeller.co.uk/contact/"
];

async function main() {
  console.log("================================================================");
  console.log("REAL TARGET NAVIGATION TIMEOUT RECOVERY REGRESSION TEST");
  console.log("================================================================");

  const browser: Browser = await chromium.launch({
    headless: true,
    executablePath: await getChromiumExecutablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  try {
    for (const url of realTimeoutTargets) {
      console.log(`\nTesting target: ${url}`);
      const ctx = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      });
      const tStart = Date.now();
      try {
        const res = await submitContactForm({
          websiteUrl: url,
          leadData: lead,
          submit: false, // Dry-run mode for safety
          browserContext: ctx,
          skipPersist: true,
          timeoutMs: 30000
        });
        const dur = Date.now() - tStart;
        console.log(`  -> Status: ${res.status}`);
        console.log(`  -> Duration: ${dur}ms`);
        console.log(`  -> Stage Timing:`, JSON.stringify(res.stageTiming));
        console.log(`  -> Fields Detected: ${res.fieldsDetectedCount}, Filled: ${res.filledFieldsCount}`);
        if (res.errorMessage) console.log(`  -> Error/Reason: ${res.errorMessage}`);
      } catch (err: any) {
        console.log(`  -> Threw error: ${err.message} (${Date.now() - tStart}ms)`);
      } finally {
        await ctx.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
