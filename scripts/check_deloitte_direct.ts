import { chromium } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable";

async function main() {
  const executablePath = await getChromiumExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();
  try {
    const res = await page.goto("https://www.deloitte.com/in/en/contact/contact-us.html", { waitUntil: "domcontentloaded", timeout: 25000 });
    console.log("Status:", res?.status());
    await page.waitForTimeout(3000);
    const details = await page.evaluate(() => {
      const hasFriendly = Boolean(document.querySelector('.frc-captcha, [data-sitekey], script[src*="friendly"]'));
      const scripts = Array.from(document.querySelectorAll('script')).map(s => s.src).filter(s => s.includes('friendly') || s.includes('captcha'));
      const iframes = Array.from(document.querySelectorAll('iframe')).map(i => i.src);
      return { title: document.title, hasFriendly, scripts, iframes };
    });
    console.log("Deloitte Contact Details:", JSON.stringify(details));
  } catch (err: any) {
    console.log("Error:", err.message);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
