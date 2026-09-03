import { chromium } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable";

async function main() {
  const executablePath = await getChromiumExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();
  
  page.on("console", (msg) => console.log("BROWSER LOG:", msg.text()));
  page.on("pageerror", (err) => console.error("BROWSER ERROR:", err.message));
  page.on("response", (res) => {
    if (res.status() >= 400) {
      console.log(`HTTP ${res.status()} on ${res.url()}`);
    }
  });

  console.log("Navigating to login page...");
  await page.goto("https://sdi-production-c505.up.railway.app/login", { waitUntil: "networkidle" });

  console.log("Filling login credentials...");
  await page.fill('input[name="loginId"]', "admin");
  await page.fill('input[name="password"]', "admin123");

  console.log("Submitting login form...");
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(4000);

  console.log("Current URL after submit:", page.url());
  const bodyText = await page.innerText("body");
  console.log("Body text preview:\n", bodyText.slice(0, 500));

  await browser.close();
}

main().catch(console.error);
