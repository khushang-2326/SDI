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

  // Get first bookable button
  const bookableButtons = frame.locator('button[class*="bookable" i]');
  console.log("Bookable buttons count:", await bookableButtons.count());
  const firstBookable = bookableButtons.first();
  console.log("First bookable text:", await firstBookable.innerText(), "aria:", await firstBookable.getAttribute("aria-label"));

  // Click it
  await firstBookable.click();
  console.log("Clicked first bookable, waiting 2s...");
  await page.waitForTimeout(2000);

  // Take screenshot of frame
  const buttonsAfter = await frame.locator("button, [role='button']").evaluateAll(els => els.map(e => ({
    text: (e.textContent || "").trim().replace(/\s+/g, " "),
    ariaLabel: e.getAttribute("aria-label"),
    className: e.getAttribute("class"),
    visible: e.getBoundingClientRect().width > 0
  })));

  console.log("Buttons after click:", buttonsAfter.filter(b => b.visible));

  await browser.close();
}

run().catch(console.error);
