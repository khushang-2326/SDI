import { chromium } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable";
import { dismissCookieBanners } from "../services/cookie-consent-helper";

async function main() {
  console.log("=== Testing Universal Cookie Banner Auto-Acceptance ===");
  const executablePath = await getChromiumExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });

  try {
    // TEST 1: Live site test on https://hubs.la (HubSpot Abuse Prevention from user screenshot)
    console.log("\n[Test 1] Testing live HubSpot cookie banner on https://hubs.la ...");
    const page1 = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    });

    await page1.goto("https://hubs.la", { waitUntil: "domcontentloaded", timeout: 30000 });
    // Wait 2s for HubSpot async cookie banner script to inject
    await page1.waitForTimeout(2000);

    const bannerBefore = await page1.locator("#hs-eu-cookie-confirmation, #hs-eu-confirmation-button").count();
    console.log(`HubSpot banner present before dismissal: ${bannerBefore > 0}`);

    const dismissed = await dismissCookieBanners(page1);
    console.log(`dismissCookieBanners returned: ${dismissed}`);

    await page1.waitForTimeout(1000);
    const bannerVisibleAfter = await page1.locator("#hs-eu-confirmation-button").isVisible().catch(() => false);
    console.log(`HubSpot accept button still visible after dismissal: ${bannerVisibleAfter}`);

    if (bannerVisibleAfter) {
      throw new Error("Test 1 Failed: HubSpot accept button was not dismissed!");
    }
    console.log("✅ Test 1 Passed: HubSpot cookie banner successfully auto-accepted!");
    await page1.close();

    // TEST 2: Synthetic page testing "Allow All", "Always Allow", and multi-lingual variants
    console.log("\n[Test 2] Testing synthetic cookie popups with diverse button labels...");
    const testCases = [
      { html: `<div class="cookie-banner"><p>We use cookies</p><button id="btn1">Allow All</button></div>`, btnText: "Allow All" },
      { html: `<div id="cookie-popup"><p>Privacy consent</p><button id="btn2">Always Allow</button></div>`, btnText: "Always Allow" },
      { html: `<div class="consent-modal"><p>Notice</p><button id="btn3">Accept All Cookies</button></div>`, btnText: "Accept All Cookies" },
      { html: `<div role="dialog" aria-label="cookie consent"><button id="btn4">Allow</button></div>`, btnText: "Allow" },
      { html: `<div id="hs-banner-parent"><button id="btn5">Alle akzeptieren</button></div>`, btnText: "Alle akzeptieren" },
      { html: `<div class="cookie-container"><button id="btn6">Aceptar todas</button></div>`, btnText: "Aceptar todas" },
    ];

    for (const tc of testCases) {
      const page2 = await browser.newPage();
      await page2.setContent(`
        <!DOCTYPE html>
        <html>
          <body>
            ${tc.html}
            <form id="contact-form">
              <input type="text" name="name" placeholder="Name" />
              <button type="submit">Submit Inquiry</button>
            </form>
          </body>
        </html>
      `);

      const didDismiss = await dismissCookieBanners(page2);
      console.log(`Synthetic test for "${tc.btnText}" auto-accepted: ${didDismiss}`);
      if (!didDismiss) {
        throw new Error(`Synthetic test failed for button: "${tc.btnText}"`);
      }
      await page2.close();
    }
    console.log("✅ Test 2 Passed: All diverse 'allow all / always allow / allow' variations auto-accepted!");

    console.log("\n=======================================================");
    console.log("🎉 ALL UNIVERSAL COOKIE BANNER TESTS PASSED SUCCESSFULLY!");
    console.log("=======================================================");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
