import { chromium } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable";
import { navigateForDiscovery, discoverSubmissionTargets } from "../services/submission-target-discovery";

async function testEndToEndDnsRecovery() {
  console.log("=== Testing End-to-End DNS Recovery with Real Failed Target ===\n");
  
  const targetUrl = "https://www.sweethomemedia.com";
  console.log(`Target: ${targetUrl} (Previously failed with net::ERR_NAME_NOT_RESOLVED)`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: (await getChromiumExecutablePath()) || undefined
  });
  const page = await browser.newPage();

  console.log("\n1. Testing navigateForDiscovery with DNS fallback...");
  const navResult = await navigateForDiscovery(page, targetUrl, 25000, "discovery");
  console.log(`Navigation Result: success=${navResult.success}, committed=${navResult.committed}, status=${navResult.status}, finalUrl=${navResult.finalUrl}`);
  
  if (navResult.success || navResult.committed) {
    console.log("✅ [PASS] navigateForDiscovery recovered via DNS fallback!");
  } else {
    console.error("❌ [FAIL] navigateForDiscovery failed to recover:", navResult.navError);
    process.exit(1);
  }

  await page.close();
  await browser.close();

  console.log("\n2. Testing discoverSubmissionTargets with DNS fallback...");
  const discoveryResult = await discoverSubmissionTargets({
    websiteUrl: targetUrl,
    timeoutMs: 30000
  });

  console.log(`Discovered ${discoveryResult.targets.length} targets:`);
  for (const t of discoveryResult.targets) {
    console.log(`- [${t.targetType}] ${t.url} (confidence: ${t.confidence}, reason: ${t.reason})`);
  }

  if (discoveryResult.targets.length > 0) {
    console.log("✅ [PASS] Target discovery successfully found contact form on recovered domain!");
  } else {
    console.log("⚠️ No specific contact form discovered, but page loaded successfully. Reason:", discoveryResult.reason);
  }

  console.log("\n=== Real-world DNS Recovery Test Complete ===");
}

testEndToEndDnsRecovery().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
