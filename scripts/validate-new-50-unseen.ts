import { discoverSubmissionTargets } from "../services/submission-target-discovery";

interface UnseenSiteDef {
  url: string;
  category: string;
}

// 50 completely new, independently selected unseen live websites (0% overlap with original 51 and 0% overlap with 164 benchmark)
const NEW_UNSEEN_50_SITES: UnseenSiteDef[] = [
  // 1. SaaS / B2B Tech
  { url: "https://www.asana.com", category: "SaaS/Tech" },
  { url: "https://www.pagerduty.com", category: "SaaS/Tech" },
  { url: "https://www.zendesk.com", category: "SaaS/Tech" },
  { url: "https://www.box.com", category: "SaaS/Tech" },
  { url: "https://www.intercom.com", category: "SaaS/Tech" },
  { url: "https://www.hubspot.com", category: "SaaS/Tech" },
  { url: "https://www.freshworks.com", category: "SaaS/Tech" },
  { url: "https://www.elastic.co", category: "SaaS/Tech" },

  // 2. Legal / Professional Advisory
  { url: "https://www.skadden.com", category: "Legal/Advisory" },
  { url: "https://www.kirkland.com", category: "Legal/Advisory" },
  { url: "https://www.lw.com", category: "Legal/Advisory" },
  { url: "https://www.sidley.com", category: "Legal/Advisory" },
  { url: "https://www.morganlewis.com", category: "Legal/Advisory" },
  { url: "https://www.gtlaw.com", category: "Legal/Advisory" },
  { url: "https://www.mwe.com", category: "Legal/Advisory" },
  { url: "https://www.reedsmith.com", category: "Legal/Advisory" },

  // 3. Home & Field Services
  { url: "https://www.stanleysteemer.com", category: "Home/Field Services" },
  { url: "https://www.orkin.com", category: "Home/Field Services" },
  { url: "https://www.terminix.com", category: "Home/Field Services" },
  { url: "https://www.cottagecare.com", category: "Home/Field Services" },
  { url: "https://www.lawn-doctor.com", category: "Home/Field Services" },
  { url: "https://www.trugreen.com", category: "Home/Field Services" },
  { url: "https://www.merrymaids.com", category: "Home/Field Services" },
  { url: "https://www.twoamentruck.com", category: "Home/Field Services" },

  // 4. Healthcare & Medical Services
  { url: "https://www.onemedical.com", category: "Healthcare" },
  { url: "https://www.carbonhealth.com", category: "Healthcare" },
  { url: "https://www.talkspace.com", category: "Healthcare" },
  { url: "https://www.betterhelp.com", category: "Healthcare" },
  { url: "https://www.davita.com", category: "Healthcare" },
  { url: "https://www.medexpress.com", category: "Healthcare" },
  { url: "https://www.patientfirst.com", category: "Healthcare" },
  { url: "https://www.zoomcare.com", category: "Healthcare" },

  // 5. Creative & Digital Agencies
  { url: "https://www.akqa.com", category: "Creative/Agency" },
  { url: "https://www.ogilvy.com", category: "Creative/Agency" },
  { url: "https://www.wundermanthompson.com", category: "Creative/Agency" },
  { url: "https://www.tbwa.com", category: "Creative/Agency" },
  { url: "https://www.bbdo.com", category: "Creative/Agency" },
  { url: "https://www.mccann.com", category: "Creative/Agency" },
  { url: "https://www.grey.com", category: "Creative/Agency" },
  { url: "https://www.droga5.com", category: "Creative/Agency" },

  // 6. Enterprise & Global Consultancies
  { url: "https://www.boozallen.com", category: "Enterprise/Consulting" },
  { url: "https://www.gartner.com", category: "Enterprise/Consulting" },
  { url: "https://www.oliverwyman.com", category: "Enterprise/Consulting" },
  { url: "https://www.kearney.com", category: "Enterprise/Consulting" },
  { url: "https://www.alixpartners.com", category: "Enterprise/Consulting" },
  { url: "https://www.fticonsulting.com", category: "Enterprise/Consulting" },
  { url: "https://www.rolandberger.com", category: "Enterprise/Consulting" },
  { url: "https://www.marshmclennan.com", category: "Enterprise/Consulting" },
  { url: "https://www.aon.com", category: "Enterprise/Consulting" },
  { url: "https://www.willistowerswatson.com", category: "Enterprise/Consulting" }
];

interface EvalResult {
  url: string;
  category: string;
  found: boolean;
  discoveredUrl: string | null;
  targetType: string | null;
  durationMs: number;
  reason: string;
}

async function main() {
  console.log("==================================================");
  console.log(`EVALUATING 50 NEW UNSEEN WEBSITES (GENERALIZATION SUITE)`);
  console.log(`Total Targets: ${NEW_UNSEEN_50_SITES.length}`);
  console.log("==================================================\n");

  const results: EvalResult[] = [];
  let foundCount = 0;
  let totalTime = 0;

  for (let i = 0; i < NEW_UNSEEN_50_SITES.length; i++) {
    const site = NEW_UNSEEN_50_SITES[i];
    console.log(`[${i + 1}/${NEW_UNSEEN_50_SITES.length}] Evaluating [${site.category}]: ${site.url}`);
    const start = Date.now();

    try {
      const res = await discoverSubmissionTargets({
        websiteUrl: site.url,
        timeoutMs: 15000,
        maxNavigationLinks: 6,
        maxFallbackPaths: 2
      });
      const durationMs = Date.now() - start;
      const top = res.targets[0] || null;
      const found = Boolean(top);

      if (found) foundCount++;
      totalTime += durationMs;

      results.push({
        url: site.url,
        category: site.category,
        found,
        discoveredUrl: top ? top.url : null,
        targetType: top ? top.targetType : null,
        durationMs,
        reason: res.reason
      });

      const badge = found ? "[✓ FOUND]" : "[✗ NONE ]";
      const dest = top ? top.url.replace(/^https?:\/\//, "").slice(0, 45) : res.reason.slice(0, 45);
      console.log(`  ${badge} ${top ? top.targetType : "none"} in ${(durationMs / 1000).toFixed(1)}s -> ${dest}`);
    } catch (err: any) {
      const durationMs = Date.now() - start;
      totalTime += durationMs;
      results.push({
        url: site.url,
        category: site.category,
        found: false,
        discoveredUrl: null,
        targetType: null,
        durationMs,
        reason: err.message
      });
      console.log(`  -> ERROR: ${err.message}`);
    }
  }

  console.log("\n==================================================");
  console.log("50 NEW UNSEEN SITES EVALUATION REPORT");
  console.log("==================================================");
  for (const r of results) {
    const badge = r.found ? "[✓ FOUND]" : "[✗ NONE ]";
    const dest = r.discoveredUrl ? r.discoveredUrl.replace(/^https?:\/\//, "").slice(0, 45) : r.reason.slice(0, 45);
    console.log(`${badge} ${r.url.replace(/^https?:\/\//, "").padEnd(32)} | ${(r.targetType || "none").padEnd(14)} | ${(r.durationMs / 1000).toFixed(1)}s | ${dest}`);
  }

  const avgDuration = (totalTime / results.length / 1000).toFixed(2);
  const successRate = ((foundCount / results.length) * 100).toFixed(1);

  console.log("\n--------------------------------------------------");
  console.log(`TOTAL FOUND:             ${foundCount} / ${results.length} (${successRate}%)`);
  console.log(`AVERAGE DISCOVERY TIME:  ${avgDuration}s`);
  console.log("==================================================");
  console.log("\n>>> Generalization validation execution completed!\n");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
