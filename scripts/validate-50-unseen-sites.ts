import { discoverSubmissionTargets } from "../services/submission-target-discovery";

interface UnseenSiteDef {
  url: string;
  category: "SaaS/Tech" | "Legal/Advisory" | "Home/Field Services" | "Healthcare" | "Creative/Agency" | "Enterprise/Consulting";
  expectedNature: string;
}

const UNSEEN_52_SITES: UnseenSiteDef[] = [
  // 1. SaaS & Tech
  { url: "https://zapier.com", category: "SaaS/Tech", expectedNature: "Multi-level nav, sales/contact flow" },
  { url: "https://airtable.com", category: "SaaS/Tech", expectedNature: "SaaS CTA, contact sales" },
  { url: "https://webflow.com", category: "SaaS/Tech", expectedNature: "Contact sales page" },
  { url: "https://clickup.com", category: "SaaS/Tech", expectedNature: "Contact sales" },
  { url: "https://miro.com", category: "SaaS/Tech", expectedNature: "Contact sales" },
  { url: "https://postman.com", category: "SaaS/Tech", expectedNature: "Contact sales form" },
  { url: "https://datadoghq.com", category: "SaaS/Tech", expectedNature: "Contact / Request demo" },
  { url: "https://hashicorp.com", category: "SaaS/Tech", expectedNature: "Contact sales" },

  // 2. Legal & Professional Advisory
  { url: "https://www.cooley.com", category: "Legal/Advisory", expectedNature: "Law firm offices/contact" },
  { url: "https://www.davispolk.com", category: "Legal/Advisory", expectedNature: "Law firm contact page" },
  { url: "https://www.goodwinlaw.com", category: "Legal/Advisory", expectedNature: "Law firm connect/contact" },
  { url: "https://www.wilsonlaw.com", category: "Legal/Advisory", expectedNature: "Free consultation / contact" },
  { url: "https://www.bain.com", category: "Legal/Advisory", expectedNature: "Consulting contact us" },
  { url: "https://www.crowe.com", category: "Legal/Advisory", expectedNature: "Accounting & advisory contact" },
  { url: "https://www.bdo.com", category: "Legal/Advisory", expectedNature: "Accounting contact" },
  { url: "https://www.mossadams.com", category: "Legal/Advisory", expectedNature: "Accounting inquiry" },
  { url: "https://www.plantemoran.com", category: "Legal/Advisory", expectedNature: "Professional services contact" },
  { url: "https://www.cbiz.com", category: "Legal/Advisory", expectedNature: "Contact advisory" },
  { url: "https://www.marcumllp.com", category: "Legal/Advisory", expectedNature: "Accounting contact" },
  { url: "https://www.bakertilly.com", category: "Legal/Advisory", expectedNature: "Advisory contact us" },

  // 3. Home & Field Services
  { url: "https://www.rotorooter.com", category: "Home/Field Services", expectedNature: "Schedule service / plumbing" },
  { url: "https://www.servpro.com", category: "Home/Field Services", expectedNature: "Restoration request service" },
  { url: "https://www.mrhandyman.com", category: "Home/Field Services", expectedNature: "Request service / contact" },
  { url: "https://www.mistersparky.com", category: "Home/Field Services", expectedNature: "Schedule appointment / electrical" },
  { url: "https://www.onehourheatandair.com", category: "Home/Field Services", expectedNature: "Schedule appointment / HVAC" },
  { url: "https://www.benjaminfranklinplumbing.com", category: "Home/Field Services", expectedNature: "Plumbing scheduler" },
  { url: "https://www.maidpro.com", category: "Home/Field Services", expectedNature: "Get a quote" },
  { url: "https://www.mollymaid.com", category: "Home/Field Services", expectedNature: "Request an estimate" },
  { url: "https://www.thecleaningauthority.com", category: "Home/Field Services", expectedNature: "Free estimate" },

  // 4. Healthcare & Wellness
  { url: "https://www.brightstarcare.com", category: "Healthcare", expectedNature: "Find care / contact" },
  { url: "https://www.cleanslatecenters.com", category: "Healthcare", expectedNature: "Book appointment / contact" },
  { url: "https://www.bayada.com", category: "Healthcare", expectedNature: "Home healthcare contact" },
  { url: "https://www.oakstreethealth.com", category: "Healthcare", expectedNature: "Schedule visit" },
  { url: "https://www.citymd.com", category: "Healthcare", expectedNature: "Urgent care contact" },
  { url: "https://www.kindredhospitals.com", category: "Healthcare", expectedNature: "Hospital contact" },
  { url: "https://www.soundphysicians.com", category: "Healthcare", expectedNature: "Medical group contact" },

  // 5. Creative & Digital Agencies
  { url: "https://www.hugeinc.com", category: "Creative/Agency", expectedNature: "Agency contact page" },
  { url: "https://www.frogdesign.com", category: "Creative/Agency", expectedNature: "Consultancy contact" },
  { url: "https://www.ideo.com", category: "Creative/Agency", expectedNature: "Design contact" },
  { url: "https://www.rga.com", category: "Creative/Agency", expectedNature: "Agency inquiry" },
  { url: "https://www.instrument.com", category: "Creative/Agency", expectedNature: "Digital agency contact" },
  { url: "https://www.fantasy.co", category: "Creative/Agency", expectedNature: "Design agency contact" },
  { url: "https://www.workco.com", category: "Creative/Agency", expectedNature: "Product agency contact" },
  { url: "https://www.monks.com", category: "Creative/Agency", expectedNature: "Digital agency contact" },

  // 6. Enterprise & Global Consultancies (Difficult real-world edge cases)
  { url: "https://www.mckinsey.com", category: "Enterprise/Consulting", expectedNature: "Enterprise multi-level nav contact" },
  { url: "https://www.bcg.com", category: "Enterprise/Consulting", expectedNature: "Global advisory contact" },
  { url: "https://www.accenture.com", category: "Enterprise/Consulting", expectedNature: "IT consulting contact" },
  { url: "https://www.deloitte.com", category: "Enterprise/Consulting", expectedNature: "Advisory contact us" },
  { url: "https://www.pwc.com", category: "Enterprise/Consulting", expectedNature: "Advisory contact us" },
  { url: "https://www.kpmg.com", category: "Enterprise/Consulting", expectedNature: "Advisory contact us" },
  { url: "https://www.ey.com", category: "Enterprise/Consulting", expectedNature: "Advisory contact us" }
];

interface EvaluationResult {
  url: string;
  category: string;
  expectedNature: string;
  contactTargetFound: boolean;
  discoveredUrl: string | null;
  targetType: string | null;
  confidence: number;
  durationMs: number;
  checkedUrlsCount: number;
  classification: "FORM_FOUND" | "BOOKING_WIDGET" | "NO_PUBLIC_FORM" | "BLOCKED_CAPTCHA" | "TIMEOUT_ERROR";
  reason: string;
}

async function main() {
  console.log("==================================================");
  console.log(`INTELLIGENT CONTACT DISCOVERY: 50+ UNSEEN WEBSITES VALIDATION`);
  console.log(`Total Unseen Targets: ${UNSEEN_52_SITES.length}`);
  console.log(`Dataset Separation: 100% Unseen (0% overlap with 164 benchmark)`);
  console.log("==================================================\n");

  const results: EvaluationResult[] = [];

  for (let i = 0; i < UNSEEN_52_SITES.length; i++) {
    const site = UNSEEN_52_SITES[i];
    console.log(`[${i + 1}/${UNSEEN_52_SITES.length}] Evaluating [${site.category}]: ${site.url}`);
    const start = Date.now();

    try {
      const res = await discoverSubmissionTargets({
        websiteUrl: site.url,
        timeoutMs: 16000,
        maxNavigationLinks: 6,
        maxFallbackPaths: 2
      });
      const durationMs = Date.now() - start;

      const topTarget = res.targets[0] || null;
      const contactTargetFound = Boolean(topTarget);

      let classification: EvaluationResult["classification"];
      if (topTarget?.targetType === "contact_form") {
        classification = "FORM_FOUND";
      } else if (topTarget?.targetType === "booking_widget" || topTarget?.targetType === "calendly" || topTarget?.targetType === "hubspot_booking") {
        classification = "BOOKING_WIDGET";
      } else if (res.reason.includes("403") || res.reason.includes("blocked") || res.reason.includes("CAPTCHA") || res.reason.includes("verification")) {
        classification = "BLOCKED_CAPTCHA";
      } else {
        classification = "NO_PUBLIC_FORM";
      }

      const evalRes: EvaluationResult = {
        url: site.url,
        category: site.category,
        expectedNature: site.expectedNature,
        contactTargetFound,
        discoveredUrl: topTarget?.url || null,
        targetType: topTarget?.targetType || null,
        confidence: topTarget?.confidence || 0,
        durationMs,
        checkedUrlsCount: res.checkedUrls.length,
        classification,
        reason: res.reason
      };

      results.push(evalRes);
      console.log(`  -> ${contactTargetFound ? "FOUND" : "NOT FOUND"}: ${topTarget?.url || "N/A"} (${topTarget?.targetType || "none"}) [${classification}] in ${(durationMs / 1000).toFixed(1)}s (checked ${res.checkedUrls.length} pages)`);
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const isBlocked = err?.message?.includes("403") || err?.message?.includes("Cloudflare");
      results.push({
        url: site.url,
        category: site.category,
        expectedNature: site.expectedNature,
        contactTargetFound: false,
        discoveredUrl: null,
        targetType: null,
        confidence: 0,
        durationMs,
        checkedUrlsCount: 1,
        classification: isBlocked ? "BLOCKED_CAPTCHA" : "TIMEOUT_ERROR",
        reason: err?.message || "Error"
      });
      console.log(`  -> ERROR: ${err?.message} in ${(durationMs / 1000).toFixed(1)}s`);
    }
  }

  console.log("\n==================================================");
  console.log("50+ UNSEEN SITES VALIDATION REPORT");
  console.log("==================================================");

  let foundCount = 0;
  let formFoundCount = 0;
  let bookingWidgetCount = 0;
  let blockedCount = 0;
  let noPublicFormCount = 0;
  let timeoutCount = 0;
  let totalTime = 0;

  const categoryStats: Record<string, { total: number; found: number }> = {};

  for (const r of results) {
    if (r.contactTargetFound) foundCount++;
    if (r.classification === "FORM_FOUND") formFoundCount++;
    if (r.classification === "BOOKING_WIDGET") bookingWidgetCount++;
    if (r.classification === "BLOCKED_CAPTCHA") blockedCount++;
    if (r.classification === "NO_PUBLIC_FORM") noPublicFormCount++;
    if (r.classification === "TIMEOUT_ERROR") timeoutCount++;
    totalTime += r.durationMs;

    if (!categoryStats[r.category]) {
      categoryStats[r.category] = { total: 0, found: 0 };
    }
    categoryStats[r.category].total++;
    if (r.contactTargetFound) categoryStats[r.category].found++;

    const statusBadge = r.contactTargetFound ? "[✓ FOUND]" : "[✗ NONE ]";
    const dest = r.discoveredUrl ? r.discoveredUrl.replace(/^https?:\/\//, "").slice(0, 45) : r.reason.slice(0, 45);
    console.log(`${statusBadge} ${r.url.replace(/^https?:\/\//, "").padEnd(32)} | ${(r.targetType || "none").padEnd(14)} | ${(r.durationMs / 1000).toFixed(1)}s | ${dest}`);
  }

  const overallSuccessRate = ((foundCount / results.length) * 100).toFixed(1);
  const eligibleSites = results.length - blockedCount;
  const eligibleSuccessRate = eligibleSites > 0 ? ((foundCount / eligibleSites) * 100).toFixed(1) : "N/A";
  const avgDuration = (totalTime / results.length / 1000).toFixed(2);

  console.log("\n--------------------------------------------------");
  console.log("CATEGORY BREAKDOWN:");
  for (const [cat, stats] of Object.entries(categoryStats)) {
    const rate = ((stats.found / stats.total) * 100).toFixed(1);
    console.log(`  ${cat.padEnd(25)}: ${stats.found} / ${stats.total} (${rate}%)`);
  }

  console.log("\n--------------------------------------------------");
  console.log("CLASSIFICATION SUMMARY:");
  console.log(`  Usable Contact Forms:    ${formFoundCount}`);
  console.log(`  Booking/CRM Widgets:     ${bookingWidgetCount}`);
  console.log(`  No Public Form / Nav:    ${noPublicFormCount}`);
  console.log(`  Blocked / CAPTCHA:       ${blockedCount}`);
  console.log(`  Timeouts / Errors:       ${timeoutCount}`);
  console.log("--------------------------------------------------");
  console.log(`OVERALL SUCCESS:         ${foundCount} / ${results.length} (${overallSuccessRate}%)`);
  console.log(`ELIGIBLE SUCCESS:        ${foundCount} / ${eligibleSites} (${eligibleSuccessRate}%) (excluding Cloudflare/WAF blocked)`);
  console.log(`AVERAGE DISCOVERY TIME:  ${avgDuration}s`);
  console.log("==================================================");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
