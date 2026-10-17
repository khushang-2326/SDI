import { chromium } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable";
import { submitContactForm } from "../services/contact-form-automation";

async function test() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: await getChromiumExecutablePath()
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    console.log("Navigating to https://www.wearecis.com/connect ...");
    await page.goto("https://www.wearecis.com/connect", { waitUntil: "domcontentloaded", timeout: 30000 });

    const res = await submitContactForm({
      websiteUrl: "https://www.wearecis.com/connect",
      leadData: {
        fullName: "Aditya Varma",
        email: "aditya.varma@example.com",
        mobile: "9173251200",
        message: "Hello, this is a test inquiry."
      },
      submit: false,
      activePage: page
    });

    console.log("Status:", res.status);
    console.log("Filled fields:", res.filledFields);
    console.log("Screenshot:", res.screenshotPath);

    const values = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("input, textarea")).map((el) => ({
        id: el.id,
        val: (el as HTMLInputElement).value
      }));
    });
    console.log("Inputs on page:", JSON.stringify(values.filter(v => v.id), null, 2));

  } finally {
    await browser.close();
  }
}

test();
