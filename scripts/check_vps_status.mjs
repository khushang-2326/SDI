import { chromium } from 'playwright';

const BASE_URL = 'http://207.244.246.116';

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log("Navigating to login...");
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="loginId"]', 'admin');
  await page.fill('input[name="password"]', 'admin123');
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(3000);

  console.log("Navigating to /automation...");
  await page.goto(`${BASE_URL}/automation`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const state = await page.evaluate(() => {
    const text = document.body.innerText;
    const isRunning = text.includes('Running') || text.includes('Discovering') || text.includes('Processing');
    const buttons = Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean);
    const selects = Array.from(document.querySelectorAll('select option')).map(o => o.innerText.trim());
    return {
      currentUrl: window.location.href,
      isRunning,
      buttons,
      selects,
      snippet: text.slice(0, 500)
    };
  });

  console.log("VPS Automation State:", JSON.stringify(state, null, 2));
  await browser.close();
}

main().catch(console.error);
