import { chromium } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable";

async function main() {
  const executablePath = await getChromiumExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });

  // Crowe
  console.log("=== CHECKING CROWE ===");
  const page1 = await browser.newPage();
  try {
    const res1 = await page1.goto("https://www.crowe.com/contact-us", { waitUntil: "domcontentloaded", timeout: 20000 });
    console.log("Crowe status:", res1?.status());
    await page1.waitForTimeout(3000);
    const croweCaptcha = await page1.evaluate(() => {
      return {
        title: document.title,
        hasMtCaptcha: Boolean(document.querySelector('.mtcap, script[src*="mtcaptcha"]')),
        hasFriendly: Boolean(document.querySelector('.frc-captcha, script[src*="friendly-challenge"]')),
        scripts: Array.from(document.querySelectorAll('script')).map(s => s.src).filter(s => s.includes('captcha') || s.includes('challenge') || s.includes('turnstile'))
      };
    });
    console.log("Crowe captcha check:", JSON.stringify(croweCaptcha));
  } catch (err: any) {
    console.log("Crowe error:", err.message);
  } finally {
    await page1.close();
  }

  // Deloitte
  console.log("=== CHECKING DELOITTE ===");
  const page2 = await browser.newPage();
  try {
    const res2 = await page2.goto("https://www.deloitte.com/global/en/footer/contact-us.html", { waitUntil: "domcontentloaded", timeout: 20000 });
    console.log("Deloitte status:", res2?.status());
    await page2.waitForTimeout(3000);
    const deloitteCaptcha = await page2.evaluate(() => {
      return {
        title: document.title,
        hasMtCaptcha: Boolean(document.querySelector('.mtcap, script[src*="mtcaptcha"]')),
        hasFriendly: Boolean(document.querySelector('.frc-captcha, script[src*="friendly-challenge"]')),
        scripts: Array.from(document.querySelectorAll('script')).map(s => s.src).filter(s => s.includes('captcha') || s.includes('challenge') || s.includes('turnstile'))
      };
    });
    console.log("Deloitte captcha check:", JSON.stringify(deloitteCaptcha));
  } catch (err: any) {
    console.log("Deloitte error:", err.message);
  } finally {
    await page2.close();
  }

  await browser.close();
}

main().catch(console.error);
