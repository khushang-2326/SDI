import { discoverSubmissionTargets } from "../services/submission-target-discovery";

// 15 diverse, completely unseen real-world domains across multiple business sectors
const UNSEEN_SITES = [
  "https://www.wilsonlaw.com",
  "https://www.brightstarcare.com",
  "https://www.rotorooter.com",
  "https://www.servpro.com",
  "https://www.cleanslatecenters.com",
  "https://www.cooley.com",
  "https://www.davispolk.com",
  "https://www.goodwinlaw.com",
  "https://www.bain.com",
  "https://www.crowe.com",
  "https://www.bdo.com",
  "https://www.mossadams.com",
  "https://www.plantemoran.com",
  "https://www.cbiz.com",
  "https://www.marcumllp.com"
];

interface UnseenResult {
  url: string;
  contactPageFound: boolean;
  discoveredUrl: string | null;
  targetType: string | null;
  durationMs: number;
  reason: string;
}

async function main() {
  console.log("==================================================");
  console.log(`VALIDATING ON ${UNSEEN_SITES.length} UNSEEN REAL WEBSITES`);
  console.log("==================================================");

  const results: UnseenResult[] = [];

  for (let i = 0; i < UNSEEN_SITES.length; i++) {
    const siteUrl = UNSEEN_SITES[i];
    console.log(`\n[${i + 1}/${UNSEEN_SITES.length}] Evaluating: ${siteUrl}`);
    const start = Date.now();

    try {
      const res = await discoverSubmissionTargets({
        websiteUrl: siteUrl,
        timeoutMs: 15000,
        maxNavigationLinks: 6,
        maxFallbackPaths: 2
      });
      const durationMs = Date.now() - start;

      const topTarget = res.targets[0] || null;
      const contactPageFound = Boolean(topTarget);

      results.push({
        url: siteUrl,
        contactPageFound,
        discoveredUrl: topTarget?.url || null,
        targetType: topTarget?.targetType || null,
        durationMs,
        reason: res.reason
      });

      console.log(`  -> ${contactPageFound ? "FOUND" : "NO FORM"}: ${topTarget?.url || "N/A"} (${topTarget?.targetType || "none"}) in ${durationMs}ms`);
    } catch (err: any) {
      const durationMs = Date.now() - start;
      results.push({
        url: siteUrl,
        contactPageFound: false,
        discoveredUrl: null,
        targetType: "error",
        durationMs,
        reason: err?.message || "Execution error"
      });
      console.log(`  -> ERROR: ${err?.message} in ${durationMs}ms`);
    }
  }

  console.log("\n==================================================");
  console.log("UNSEEN SITES VALIDATION SUMMARY");
  console.log("==================================================");

  let foundCount = 0;
  let totalTime = 0;
  for (const r of results) {
    if (r.contactPageFound) foundCount++;
    totalTime += r.durationMs;
    console.log(`${r.contactPageFound ? "[✓ FOUND]" : "[✗ NONE ]"} ${r.url.padEnd(35)} -> ${r.discoveredUrl || r.reason.slice(0, 40)} (${(r.durationMs / 1000).toFixed(1)}s)`);
  }

  const avgTime = (totalTime / results.length / 1000).toFixed(2);
  const successPct = ((foundCount / results.length) * 100).toFixed(1);

  console.log(`\nTOTAL FOUND: ${foundCount} / ${results.length} (${successPct}%)`);
  console.log(`AVERAGE DISCOVERY TIME: ${avgTime}s`);
}

main().catch((err) => {
  console.error("Unseen sites validation failed:", err);
  process.exit(1);
});
