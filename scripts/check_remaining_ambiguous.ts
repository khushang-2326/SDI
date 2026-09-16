import { chromium } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable";

async function checkUrl(name: string, url: string) {
  const executablePath = await getChromiumExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();
  try {
    console.log(`Checking ${name}: ${url}`);
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    console.log(`  Status: ${res?.status()}`);
    await page.waitForTimeout(2000);
    const info = await page.evaluate(() => {
      const forms = Array.from(document.querySelectorAll("form"));
      const inputs = Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=search]), textarea, select")).filter(el => {
        const id = (el.id || "").toLowerCase();
        const name = (el.getAttribute("name") || "").toLowerCase();
        return !id.includes("onetrust") && !id.includes("cookie") && !name.includes("onetrust") && !name.includes("cookie") && !id.includes("ot-group");
      });
      const body = document.body ? document.body.innerText.slice(0, 300) : "";
      return {
        forms: forms.length,
        inputs: inputs.map(i => `${(i as HTMLInputElement).name || i.id || i.tagName}: ${i.getAttribute("type") || "text"}`),
        snippet: body.replace(/\s+/g, " ").slice(0, 150)
      };
    });
    console.log(`  Inputs: ${JSON.stringify(info.inputs)}`);
    console.log(`  Snippet: ${info.snippet}`);
  } catch (err: any) {
    console.log(`  Error: ${err.message}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  await checkUrl("Zapier Sales", "https://zapier.com/l/contact-sales");
  await checkUrl("Baker Tilly Contact", "https://www.bakertilly.com/contact");
  await checkUrl("Roto Rooter Contact", "https://www.rotorooter.com/contact-us/");
  await checkUrl("Instrument Contact", "https://www.instrument.com/contact/");
}

main().catch(console.error);
