import { chromium } from "playwright";
import { discoverSubmissionTargets } from "../services/submission-target-discovery";

interface TargetTestItem {
  id: number;
  category: string;
  url: string;
  baselineStatus: string;
  expectedBehavior: string;
}

const REGRESSION_TARGETS: TargetTestItem[] = [
  // 1. Three targets that failed with FORM_NOT_FOUND but had forms on the supplied page
  {
    id: 1,
    category: "1. SUPPLIED_PAGE_FORM",
    url: "https://www.portsidemarketing.com/contact-us",
    baselineStatus: "FORM_NOT_FOUND",
    expectedBehavior: "Form found on supplied page (Gravity Form)"
  },
  {
    id: 2,
    category: "1. SUPPLIED_PAGE_FORM",
    url: "https://doctorlogic.com/healthcare-services/medical-content-marketing",
    baselineStatus: "FORM_NOT_FOUND",
    expectedBehavior: "Lead form found on supplied page"
  },
  {
    id: 3,
    category: "1. SUPPLIED_PAGE_FORM",
    url: "https://jebseo.com/contact",
    baselineStatus: "FORM_NOT_FOUND",
    expectedBehavior: "Contact Form 7 found on supplied page"
  },

  // 2. Two targets that failed with FORM_NOT_FOUND but had forms linked from navbar
  {
    id: 4,
    category: "2. NAVBAR_FORM",
    url: "https://www.ribit.com/contact",
    baselineStatus: "FORM_NOT_FOUND",
    expectedBehavior: "Form found via navbar discovery"
  },
  {
    id: 5,
    category: "2. NAVBAR_FORM",
    url: "https://greenjaymedia.com/contact-us",
    baselineStatus: "FORM_NOT_FOUND",
    expectedBehavior: "Form found via navbar discovery"
  },

  // 3. One target that failed with FORM_NOT_FOUND with dynamic/lazy form
  {
    id: 6,
    category: "3. DYNAMIC_LAZY_FORM",
    url: "https://www.inturact.com/about-us/contact-us",
    baselineStatus: "FORM_NOT_FOUND",
    expectedBehavior: "HubSpot dynamic/lazy form detected"
  },

  // 4. Two targets that timed out due to slow assets
  {
    id: 7,
    category: "4. SLOW_ASSETS_TIMEOUT",
    url: "https://adventtrinity.com/contact",
    baselineStatus: "NAVIGATION_TIMEOUT (>120s)",
    expectedBehavior: "Faster load without tracker hangs; form detected or fast exit"
  },
  {
    id: 8,
    category: "4. SLOW_ASSETS_TIMEOUT",
    url: "https://www.magiclogix.com/contact",
    baselineStatus: "NAVIGATION_TIMEOUT (>120s)",
    expectedBehavior: "Trackers aborted; fast resolution"
  },

  // 5. Two targets that were HUMAN_VERIFICATION
  {
    id: 9,
    category: "5. HUMAN_VERIFICATION",
    url: "https://dallasseo.company/contact-us",
    baselineStatus: "HUMAN_VERIFICATION",
    expectedBehavior: "Remains accurately classified as HUMAN_VERIFICATION / Cloudflare challenge"
  },
  {
    id: 10,
    category: "5. HUMAN_VERIFICATION",
    url: "https://creativeeyeq.com/contact",
    baselineStatus: "HUMAN_VERIFICATION",
    expectedBehavior: "Remains accurately classified as HUMAN_VERIFICATION / Cloudflare Turnstile"
  },

  // 6. Two targets that were TRUE_NO_FORM
  {
    id: 11,
    category: "6. TRUE_NO_FORM",
    url: "https://mach1design.com/contact",
    baselineStatus: "FORM_NOT_FOUND",
    expectedBehavior: "Fast clean exit without form (<15s)"
  },
  {
    id: 12,
    category: "6. TRUE_NO_FORM",
    url: "https://craynetworks.screenconnect.com",
    baselineStatus: "FORM_NOT_FOUND",
    expectedBehavior: "Fast clean exit without form (<15s)"
  },

  // 7. Two targets that SUCCEEDED in the baseline run (NO REGRESSION)
  {
    id: 13,
    category: "7. BASELINE_SUCCESS",
    url: "https://www.iovista.com/contact",
    baselineStatus: "SUCCEEDED",
    expectedBehavior: "Remains SUCCEEDED (no regression)"
  },
  {
    id: 14,
    category: "7. BASELINE_SUCCESS",
    url: "https://www.arrowebs.com/contact-us",
    baselineStatus: "SUCCEEDED",
    expectedBehavior: "Remains SUCCEEDED (no regression)"
  }
];

interface TestResult {
  id: number;
  category: string;
  url: string;
  baselineStatus: string;
  newStatus: string;
  targetsFound: number;
  primaryTargetUrl: string | null;
  primaryTargetType: string | null;
  durationSec: number;
  reason: string;
  pass: boolean;
  notes: string;
}

async function runRegressionSuite() {
  console.log("==================================================================");
  console.log("STARTING 14-TARGET REPRESENTATIVE REGRESSION TEST SUITE");
  console.log("==================================================================");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  const results: TestResult[] = [];

  for (const item of REGRESSION_TARGETS) {
    console.log(`\n[TEST ${item.id}/14] [${item.category}] Testing: ${item.url}`);
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true
    });

    const start = Date.now();
    let res: any;
    try {
      res = await discoverSubmissionTargets({
        websiteUrl: item.url,
        browserContext: context,
        timeoutMs: 10000,
        maxNavigationLinks: 6,
        maxFallbackPaths: 3
      });
    } catch (err: any) {
      res = {
        websiteUrl: item.url,
        targets: [],
        checkedUrls: [item.url],
        reason: `Discovery threw error: ${err?.message || err}`
      };
    } finally {
      await context.close().catch(() => undefined);
    }

    const durationSec = Number(((Date.now() - start) / 1000).toFixed(2));
    const targetCount = res.targets?.length || 0;
    const primary = res.targets?.[0] || null;

    let newStatus = "NO_TARGET_FOUND";
    if (targetCount > 0) {
      newStatus = "TARGET_FOUND";
    } else if (/unsupported verification|robot challenge|recaptcha|hcaptcha|turnstile|cloudflare/i.test(res.reason)) {
      newStatus = "HUMAN_VERIFICATION";
    } else if (/timeout|exceeded/i.test(res.reason)) {
      newStatus = "NAVIGATION_TIMEOUT";
    }

    let pass = false;
    let notes = "";

    switch (item.category) {
      case "1. SUPPLIED_PAGE_FORM":
        pass = targetCount > 0;
        notes = pass ? `Recovered! Found ${primary.targetType}` : `Still missed: ${res.reason}`;
        break;
      case "2. NAVBAR_FORM":
        pass = targetCount > 0;
        notes = pass ? `Recovered! Found ${primary.targetType} at ${primary.url}` : `Still missed: ${res.reason}`;
        break;
      case "3. DYNAMIC_LAZY_FORM":
        pass = targetCount > 0;
        notes = pass ? `Recovered dynamic form! Found ${primary.targetType}` : `Still missed: ${res.reason}`;
        break;
      case "4. SLOW_ASSETS_TIMEOUT":
        pass = durationSec < 40;
        notes = `Resolved in ${durationSec}s (${targetCount > 0 ? "Target found" : "Fast clean exit"}). Baseline hung for >120s.`;
        break;
      case "5. HUMAN_VERIFICATION":
        pass = newStatus === "HUMAN_VERIFICATION";
        notes = pass ? `Correctly classified as HUMAN_VERIFICATION: ${res.reason}` : `Misclassified as ${newStatus}`;
        break;
      case "6. TRUE_NO_FORM":
        pass = targetCount === 0 && durationSec <= 20;
        notes = pass ? `Clean exit in ${durationSec}s without false positive` : `Exit took ${durationSec}s`;
        break;
      case "7. BASELINE_SUCCESS":
        pass = targetCount > 0;
        notes = pass ? `No regression! Target found: ${primary.targetType}` : `REGRESSION: previously succeeded, now failed!`;
        break;
    }

    console.log(`Result: ${pass ? "PASS" : "FAIL"} | Status: ${newStatus} | Targets: ${targetCount} | Duration: ${durationSec}s`);
    console.log(`Notes: ${notes}`);

    results.push({
      id: item.id,
      category: item.category,
      url: item.url,
      baselineStatus: item.baselineStatus,
      newStatus,
      targetsFound: targetCount,
      primaryTargetUrl: primary?.url || null,
      primaryTargetType: primary?.targetType || null,
      durationSec,
      reason: res.reason,
      pass,
      notes
    });
  }

  await browser.close();

  console.log("\n==================================================================");
  console.log("14-TARGET REGRESSION SUMMARY REPORT");
  console.log("==================================================================");
  console.table(results.map(r => ({
    ID: r.id,
    Category: r.category,
    URL: r.url.length > 35 ? r.url.slice(0, 32) + "..." : r.url,
    Baseline: r.baselineStatus,
    NewStatus: r.newStatus,
    Targets: r.targetsFound,
    TimeSec: r.durationSec,
    Pass: r.pass ? "YES" : "NO",
    Notes: r.notes
  })));

  const totalPassed = results.filter(r => r.pass).length;
  console.log(`\nTOTAL PASSED: ${totalPassed} / 14 (${((totalPassed / 14) * 100).toFixed(1)}%)`);

  // Save results to file
  const fs = await import("fs");
  fs.writeFileSync(
    "scripts/regression-14-results.json",
    JSON.stringify(results, null, 2),
    "utf8"
  );
  console.log("Results saved to scripts/regression-14-results.json");
}

runRegressionSuite().catch((err) => {
  console.error("Regression suite encountered fatal error:", err);
  process.exit(1);
});
