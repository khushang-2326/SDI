import { chromium } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable.ts";

async function run() {
  const executablePath = await getChromiumExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  
  await page.goto("https://bigbuda.cl/agendar", { waitUntil: "domcontentloaded", timeout: 30000 });

  const iframeLocator = page.locator('iframe[src*="calendly" i], iframe[title*="Calendly" i]').first();
  await iframeLocator.waitFor({ state: "attached", timeout: 15000 });
  const frameElement = await iframeLocator.elementHandle();
  const frame = await frameElement?.contentFrame();
  if (!frame) return;

  await frame.locator('button[class*="bookable" i], [role="grid"]').first().waitFor({ state: "visible", timeout: 20000 });

  // Find day 7
  const day7Btn = frame.locator('button[class*="bookable" i]').filter({ hasText: /^7$/ }).first();
  console.log("Day 7 exists:", await day7Btn.count());
  if (await day7Btn.count() > 0) {
    console.log("Day 7 text:", await day7Btn.innerText(), "aria:", await day7Btn.getAttribute("aria-label"));
    await day7Btn.click();
    console.log("Clicked day 7, waiting 3s...");
    await page.waitForTimeout(3000);

    const bodyText = await frame.locator("body").innerText();
    console.log("Body text after clicking day 7:\n", bodyText);

    const allButtons = await frame.locator("button, [role='button']").evaluateAll(els => els.map(e => ({
      text: (e.textContent || "").trim().replace(/\s+/g, " "),
      ariaLabel: e.getAttribute("aria-label"),
      className: e.getAttribute("class"),
      visible: e.getBoundingClientRect().width > 0,
      disabled: e.disabled || e.getAttribute("aria-disabled") === "true"
    })));

    console.log("All visible buttons after day 7 click:\n", allButtons.filter(b => b.visible));
  }

  await browser.close();
}

run().catch(console.error);
