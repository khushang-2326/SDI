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

  await frame.locator('button[aria-label*="available" i], button[aria-label*="disponible" i], [data-testid*="day" i], [role="grid"]').first().waitFor({ state: "visible", timeout: 20000 });

  // Click September 7 button
  const sept7 = frame.locator("button, [role='button']").filter({ hasText: /^7$/ }).first();
  console.log("Sept 7 count:", await sept7.count());
  if (await sept7.count() > 0) {
    console.log("Sept 7 text:", await sept7.innerText(), "aria:", await sept7.getAttribute("aria-label"), "disabled:", await sept7.getAttribute("disabled"));
    await sept7.click();
    console.log("Clicked sept 7, waiting 3s...");
    await page.waitForTimeout(3000);

    const frameHtml = await frame.content();
    console.log("Frame text after click:", (await frame.locator("body").innerText()).replace(/\n+/g, " | "));

    const buttons = await frame.locator("button, [role='button']").evaluateAll(els => els.map(e => ({
      text: (e.textContent || "").trim().replace(/\s+/g, " "),
      ariaLabel: e.getAttribute("aria-label"),
      className: e.getAttribute("class"),
      visible: e.getBoundingClientRect().width > 0,
      disabled: e.disabled || e.getAttribute("aria-disabled") === "true"
    })));
    console.log("All visible buttons after sept 7 click:", buttons.filter(b => b.visible));
  }

  await browser.close();
}

run().catch(console.error);
