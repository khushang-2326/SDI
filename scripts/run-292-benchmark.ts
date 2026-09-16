import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { acquireContext, releaseContext, closePool } from 'c:/Khushang/SDI-main/lib/browserPool';
import { runMultiTargetAutomation } from 'c:/Khushang/SDI-main/services/multi-target-automation';
import { LeadData, BookingPreferences } from 'c:/Khushang/SDI-main/types/automation';

const leadData: LeadData = {
  fullName: "Alex Rivera",
  email: "alex.rivera@example.com",
  mobile: "+14155552671",
  address: "123 Market St, San Francisco, CA",
  message: "Hi, I am interested in your services and would love to discuss a potential partnership.",
  companyName: "Rivera Consulting"
};

const bookingPreferences: BookingPreferences = {
  preferredDate: "tomorrow",
  preferredTime: "10:00am",
  fallbackToFirstAvailableSlot: true
};

export type AuthoritativeCategory =
  | "SUCCESS"
  | "CAPTCHA/HUMAN_VERIFICATION"
  | "HTTP_403/WAF"
  | "DNS/NETWORK"
  | "GENUINE_NO_FORM"
  | "ZERO_CALENDAR_INVENTORY"
  | "EXPIRED/INVALID_USER_PROVIDED_BOOKING_URL"
  | "AUTOMATION_FAILURE"
  | "OTHER";

interface TargetResult {
  index: number;
  url: string;
  success: boolean;
  eligible: boolean;
  status: string;
  errorMessage: string | null;
  attemptsCount: number;
  durationMs: number;
  filledFields: string[];
  skippedFields: string[];
  classification: AuthoritativeCategory;
  discoveryReason: string;
  stageTiming?: any;
  discoveredTargets: Array<{ targetType: string; url: string; confidence: number }>;
}

function classifyAuthoritative(
  isSuccess: boolean,
  url: string,
  errorMsg: string | null,
  discoveryReason: string
): { classification: AuthoritativeCategory; isEligible: boolean } {
  if (isSuccess) {
    return { classification: "SUCCESS", isEligible: true };
  }

  const combined = `${errorMsg || ""} ${discoveryReason || ""}`.toLowerCase();

  // 1. CAPTCHA / Human Verification
  if (
    combined.includes("captcha") ||
    combined.includes("turnstile") ||
    combined.includes("recaptcha") ||
    combined.includes("hcaptcha") ||
    combined.includes("robot challenge") ||
    combined.includes("human verification") ||
    combined.includes("cloudflare")
  ) {
    return { classification: "CAPTCHA/HUMAN_VERIFICATION", isEligible: false };
  }

  // 2. HTTP 403 / WAF
  if (
    combined.includes("403") ||
    combined.includes("forbidden") ||
    combined.includes("waf") ||
    combined.includes("access denied") ||
    combined.includes("blocked access")
  ) {
    return { classification: "HTTP_403/WAF", isEligible: false };
  }

  // 3. DNS / Network
  if (
    combined.includes("net::err_name_not_resolved") ||
    combined.includes("net::err_connection_refused") ||
    combined.includes("net::err_connection_reset") ||
    combined.includes("enotfound") ||
    combined.includes("econnrefused") ||
    combined.includes("dns")
  ) {
    return { classification: "DNS/NETWORK", isEligible: false };
  }

  // 4. Zero Calendar Inventory
  if (
    combined.includes("no available") ||
    combined.includes("zero available") ||
    combined.includes("no time slots") ||
    combined.includes("no date with available") ||
    combined.includes("zero_calendar_inventory")
  ) {
    return { classification: "ZERO_CALENDAR_INVENTORY", isEligible: false };
  }

  // 5. Expired / Invalid user-provided booking URL
  if (
    combined.includes("month=") ||
    combined.includes("uuid=") ||
    combined.includes("stale month") ||
    combined.includes("expired")
  ) {
    return { classification: "EXPIRED/INVALID_USER_PROVIDED_BOOKING_URL", isEligible: false };
  }

  // 6. Genuine No Form
  if (
    combined.includes("mailto") ||
    combined.includes("tel:") ||
    combined.includes("no supported contact form") ||
    combined.includes("no web form")
  ) {
    return { classification: "GENUINE_NO_FORM", isEligible: false };
  }

  // 7. Automation Failure (eligible)
  if (
    combined.includes("submit") ||
    combined.includes("timeout") ||
    combined.includes("budget limit") ||
    combined.includes("button") ||
    combined.includes("validation") ||
    combined.includes("render")
  ) {
    return { classification: "AUTOMATION_FAILURE", isEligible: true };
  }

  return { classification: "OTHER", isEligible: true };
}

async function runTarget(index: number, url: string): Promise<TargetResult> {
  const start = Date.now();
  console.log(`\n==================================================`);
  console.log(`[${index}/29] STARTING TARGET: ${url}`);
  console.log(`==================================================`);
  let context: any = null;
  const discovered: Array<{ targetType: string; url: string; confidence: number }> = [];

  try {
    context = await acquireContext({ headless: true });
    const result = await runMultiTargetAutomation({
      websiteUrl: url,
      leadData,
      bookingPreferences,
      liveSubmit: false,
      browserContext: context,
      timeoutMs: 45000,
      deadlineAt: Date.now() + 60000,
      callbacks: {
        onTargetsDiscovered: async (targets) => {
          targets.forEach((t) =>
            discovered.push({ targetType: t.targetType, url: t.url, confidence: t.confidence })
          );
        }
      }
    });

    const durationMs = Date.now() - start;
    const attempts = result.attempts || [];
    const successfulAttempt = attempts.find((a) =>
      ["success", "completed", "dry_run_ready_to_book"].includes((a.result?.status || "").toLowerCase())
    );

    const isSuccess = Boolean(successfulAttempt);
    let finalStatus = isSuccess
      ? (successfulAttempt?.result?.status || "SUCCESS")
      : (attempts[attempts.length - 1]?.result?.status || "FAILED");

    let errorMsg = isSuccess
      ? null
      : [
          ...attempts.map((a) => a.result?.errorMessage),
          attempts.length === 0 ? result.discoveryReason : null
        ]
          .filter(Boolean)
          .join(" | ") || null;

    const filled = successfulAttempt?.result?.filledFields || attempts[0]?.result?.filledFields || [];
    const skipped = successfulAttempt?.result?.skippedFields || attempts[0]?.result?.skippedFields || [];
    const stageTiming = successfulAttempt?.result?.stageTiming || attempts[0]?.result?.stageTiming;

    const { classification, isEligible } = classifyAuthoritative(
      isSuccess,
      url,
      errorMsg,
      result.discoveryReason
    );

    console.log(`[${index}/29] RESULT: ${isSuccess ? "SUCCESS" : "FAILED"} in ${(durationMs / 1000).toFixed(1)}s (status: ${finalStatus}, attempts: ${attempts.length}, class: ${classification})`);
    if (errorMsg) console.log(`  Error: ${errorMsg}`);
    if (filled.length) console.log(`  Filled fields (${filled.length}): ${filled.join(", ")}`);
    if (stageTiming) console.log(`  Stage timing:`, JSON.stringify(stageTiming));

    return {
      index,
      url,
      success: isSuccess,
      eligible: isEligible,
      status: finalStatus,
      errorMessage: errorMsg,
      attemptsCount: Math.max(1, attempts.length),
      durationMs,
      filledFields: filled,
      skippedFields: skipped,
      classification,
      discoveryReason: result.discoveryReason,
      stageTiming,
      discoveredTargets: discovered
    };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const msg = String(err?.message || err);
    console.log(`[${index}/29] EXCEPTION: ${msg}`);
    const { classification, isEligible } = classifyAuthoritative(false, url, msg, "");

    return {
      index,
      url,
      success: false,
      eligible: isEligible,
      status: "EXCEPTION",
      errorMessage: msg,
      attemptsCount: 1,
      durationMs,
      filledFields: [],
      skippedFields: [],
      classification,
      discoveryReason: msg,
      discoveredTargets: discovered
    };
  } finally {
    if (context) {
      await releaseContext(context).catch(() => undefined);
    }
  }
}

async function main() {
  const suiteStartTime = new Date().toISOString();
  console.log("==================================================");
  console.log("AUTHORITATIVE 29-TARGET DRY-RUN VALIDATION BENCHMARK");
  console.log(`Start Time: ${suiteStartTime}`);
  console.log("==================================================");

  const wb = XLSX.readFile('c:/Khushang/SDI-main/data/30-form.xlsx');
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet);
  const targetUrls = rows.map((r, idx) => ({
    index: idx + 1,
    url: String(r.website || r.Website || Object.values(r)[0]).trim()
  }));

  console.log(`Loaded ${targetUrls.length} targets from data/30-form.xlsx\n`);

  const results: TargetResult[] = [];
  const overallStart = Date.now();

  for (const t of targetUrls) {
    const res = await runTarget(t.index, t.url);
    results.push(res);
  }

  const overallDuration = (Date.now() - overallStart) / 1000;
  await closePool().catch(() => undefined);

  // Compute reconciled metrics
  const total = results.length;
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;
  const rawSuccessPct = ((successCount / total) * 100).toFixed(1);

  const eligibleTargets = results.filter((r) => r.eligible);
  const eligibleSuccess = eligibleTargets.filter((r) => r.success).length;
  const eligibleFail = eligibleTargets.filter((r) => !r.success).length;
  const eligibleSuccessPct = ((eligibleSuccess / eligibleTargets.length) * 100).toFixed(1);

  const totalTrials = results.reduce((sum, r) => sum + r.attemptsCount, 0);
  const trialsPerTarget = (totalTrials / total).toFixed(2);

  // Failure Breakdown
  const breakdown: Record<string, number> = {
    SUCCESS: 0,
    "CAPTCHA/HUMAN_VERIFICATION": 0,
    "HTTP_403/WAF": 0,
    "DNS/NETWORK": 0,
    GENUINE_NO_FORM: 0,
    ZERO_CALENDAR_INVENTORY: 0,
    "EXPIRED/INVALID_USER_PROVIDED_BOOKING_URL": 0,
    AUTOMATION_FAILURE: 0,
    OTHER: 0
  };

  results.forEach((r) => {
    breakdown[r.classification] = (breakdown[r.classification] || 0) + 1;
  });

  const failuresSum = Object.entries(breakdown)
    .filter(([k]) => k !== "SUCCESS")
    .reduce((sum, [, count]) => sum + count, 0);

  console.log("\n==================================================");
  console.log("29-TARGET BENCHMARK METRIC RECONCILIATION");
  console.log("==================================================");
  console.log(`Total Targets:                 ${total}`);
  console.log(`Raw Success:                   ${successCount} / ${total} (${rawSuccessPct}%)`);
  console.log(`Total Failures:                ${failCount} / ${total}`);
  console.log(`Eligible Targets:              ${eligibleTargets.length} / ${total}`);
  console.log(`Eligible Success:              ${eligibleSuccess} / ${eligibleTargets.length} (${eligibleSuccessPct}%)`);
  console.log(`Total Trials:                  ${totalTrials}`);
  console.log(`Trials / Target:               ${trialsPerTarget}`);
  console.log(`Overall Duration:              ${overallDuration.toFixed(1)}s`);
  console.log("--------------------------------------------------");
  console.log("AUTHORITATIVE FAILURE BREAKDOWN:");
  for (const [cat, cnt] of Object.entries(breakdown)) {
    if (cnt > 0) console.log(`  - ${cat}: ${cnt}`);
  }
  console.log("--------------------------------------------------");
  console.log(`Mathematical Consistency:`);
  console.log(`  successCount + failCount === total:       ${successCount + failCount === total}`);
  console.log(`  sum(failure categories) === failCount:    ${failuresSum === failCount}`);
  console.log("==================================================\n");

  console.log("| # | Target URL | Status | Outcome | Trials | Duration | Classification | Eligible |");
  console.log("|---|------------|--------|---------|--------|----------|----------------|----------|");
  for (const r of results) {
    console.log(`| ${r.index} | ${r.url} | ${r.status} | ${r.success ? "PASS" : "FAIL"} | ${r.attemptsCount} | ${(r.durationMs / 1000).toFixed(1)}s | ${r.classification} | ${r.eligible ? "YES" : "NO"} |`);
  }

  const suiteEndTime = new Date().toISOString();
  fs.mkdirSync('c:/Khushang/SDI-main/outputs', { recursive: true });
  fs.writeFileSync('c:/Khushang/SDI-main/outputs/final_29_targets_result.json', JSON.stringify({
    summary: {
      total,
      rawSuccess: successCount,
      rawSuccessPct: parseFloat(rawSuccessPct),
      failuresCount: failCount,
      eligibleTotal: eligibleTargets.length,
      eligibleSuccess,
      eligibleSuccessPct: parseFloat(eligibleSuccessPct),
      totalTrials,
      trialsPerTarget: parseFloat(trialsPerTarget),
      overallDurationSeconds: overallDuration,
      startTime: suiteStartTime,
      endTime: suiteEndTime,
      mathematicalReconciliation: {
        successPlusFailuresEqualsTotal: successCount + failCount === total,
        sumFailuresEqualsFailCount: failuresSum === failCount
      },
      failureBreakdown: breakdown
    },
    results
  }, null, 2));

  console.log("\nSaved detailed JSON to outputs/final_29_targets_result.json");
}

main().catch(console.error);
