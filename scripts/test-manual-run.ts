import { chromium } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable";

async function main() {
  const executablePath = await getChromiumExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();

  console.log("Navigating to login...");
  await page.goto("https://sdi-production-c505.up.railway.app/login");
  await page.fill('input[name="loginId"]', "admin");
  await page.fill('input[name="password"]', "admin123");
  await page.click('button:has-text("Sign in")');
  await page.waitForURL("**/dashboard");
  console.log("Logged in!");

  console.log("Navigating to /automation...");
  await page.goto("https://sdi-production-c505.up.railway.app/automation");

  console.log("Entering manual URL...");
  // Select contact form automation type
  await page.selectOption('select[name="automationType"]', "contact");
  // Fill website URL
  await page.fill('input[name="websiteUrl"]', "https://www.aoe.com/en/contact");
  
  // Uncheck 'Show Playwright automation browser' since in cloud it's headless
  const showBrowser = page.locator('input[name="showBrowser"]');
  if (await showBrowser.isChecked()) {
    await showBrowser.uncheck();
  }

  // Uncheck 'Open target link in a new browser tab'
  const openTab = page.locator('input[name="openMonitorTab"]');
  if (await openTab.isChecked()) {
    await openTab.uncheck();
  }

  console.log("Clicking Start Workflow...");
  await page.click('button:has-text("Start Workflow")');

  console.log("Waiting for workflow result (30s)...");
  await page.waitForTimeout(30000);

  const text = await page.innerText("body");
  const activityStream = await page.innerText("h2:has-text('Workflow result')").catch(() => "");
  console.log("Activity stream header found:", Boolean(activityStream));
  
  const resultCard = await page.$(".card-enter, [class*='card-']");
  console.log("Result card present:", Boolean(resultCard));

  const allText = await page.innerText("main, section");
  console.log("Main section text:\n", allText);

  await browser.close();
}

main().catch(console.error);
