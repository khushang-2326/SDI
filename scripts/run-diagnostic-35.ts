import * as XLSX from "xlsx";
import { normalizeInputTargetUrl } from "../services/url-normalizer";
import { runMultiTargetAutomation } from "../services/multi-target-automation";
import { acquireContext, releaseContext, closePool } from "../lib/browserPool";
import { LeadData, BookingPreferences } from "../types/automation";
import fs from "fs";
import path from "path";

const leadData: LeadData = {
  fullName: "Alex Rivera",
  email: "alex.rivera@example.com",
  mobile: "+14155552671",
  message: "Hi, I am interested in your services and would love to discuss a potential partnership."
};

const bookingPreferences: BookingPreferences = {
  preferredTimezone: "America/New_York",
  preferredDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  preferredTimeOfDay: "afternoon"
};

interface TargetMetric {
  url: string;
  success: boolean;
  targetType?: string;
  discoveredUrl?: string;
  attemptsCount: number;
  durationMs: number;
  failureCategory?: string;
  reason: string;
}

async function run() {
  const filePath = path.resolve("data/1700.xlsx");
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any>(sheet, { header: 1, defval: "" });

  const rawUrls: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const val = String(rows[i][0] || "").trim();
    if (val) rawUrls.push(val);
  }

  const normalized = rawUrls
    .map((u) => normalizeInputTargetUrl(u))
    .filter((n) => n.isValidTarget && Boolean(n.normalizedTargetUrl))
    .map((n) => n.normalizedTargetUrl!);

  console.log("Loaded " + normalized.length + " valid target websites from 1700.xlsx.");

  const sampleSize = 35;
  const step = Math.floor(normalized.length / sampleSize);
  const sampleTargets: string[] = [];
  for (let i = 0; i < sampleSize; i++) {
    sampleTargets.push(normalized[i * step]);
  }

  console.log("\n==================================================");
  console.log("STARTING CONTROLLED " + sampleSize + "-TARGET DIAGNOSTIC BENCHMARK");
  console.log("==================================================\n");

  const metrics: TargetMetric[] = [];
  const startTime = Date.now();

  for (let idx = 0; idx < sampleTargets.length; idx++) {
    const targetUrl = sampleTargets[idx];
    const targetStart = Date.now();
    console.log("\n[" + (idx + 1) + "/" + sampleSize + "] Starting target: " + targetUrl);

    let browserContext: any = null;
    try {
      browserContext = await acquireContext({ headless: true });
      const result = await runMultiTargetAutomation({
        websiteUrl: targetUrl,
        leadData,
        bookingPreferences,
        liveSubmit: false,
        browserContext,
        timeoutMs: 25000,
        callbacks: {
          onAttemptStarted: async (target) => console.log("  [ATTEMPT] Started: " + target.url + " (" + target.targetType + ")"),
          onAttemptFinished: async (att) => console.log("  [ATTEMPT] Finished: " + att.target.url + " -> " + att.result.status)
        }
      });

      const elapsed = Date.now() - targetStart;
      const lastAttempt = result.attempts[result.attempts.length - 1];
      const success = result.attempts.some((a) => a.result.status === "success" || a.result.status === "dry_run_ready_to_book");
      const targetType = result.targets[0]?.targetType;
      const discoveredUrl = result.targets[0]?.url;

      let failureCategory = "NONE";
      if (!success) {
        const reason = (lastAttempt?.result?.errorMessage || result.discoveryReason || "").toLowerCase();
        if (reason.includes("captcha") || reason.includes("turnstile") || reason.includes("cloudflare") || reason.includes("human verification") || reason.includes("challenge") || reason.includes("robot challenge")) {
          failureCategory = "CAPTCHA / HUMAN VERIFICATION";
        } else if (reason.includes("timeout") || reason.includes("time limit") || reason.includes("exceeded")) {
          failureCategory = "NAVIGATION TIMEOUT";
        } else if (reason.includes("403") || reason.includes("forbidden") || reason.includes("blocked access")) {
          failureCategory = "HTTP 403";
        } else if (reason.includes("not found") || reason.includes("no supported contact form")) {
          failureCategory = "FORM NOT FOUND";
        } else if (reason.includes("network") || reason.includes("net::") || reason.includes("dns")) {
          failureCategory = "NETWORK ERROR";
        } else {
          failureCategory = "OTHER";
        }
      }

      const metric: TargetMetric = {
        url: targetUrl,
        success,
        targetType,
        discoveredUrl,
        attemptsCount: result.attempts.length,
        durationMs: elapsed,
        failureCategory: success ? undefined : failureCategory,
        reason: lastAttempt?.result?.errorMessage || result.discoveryReason
      };

      metrics.push(metric);
      console.log("[" + (idx + 1) + "/" + sampleSize + "] " + targetUrl + " -> " + (success ? "SUCCESS" : "FAILED (" + failureCategory + ")") + " in " + (elapsed / 1000).toFixed(1) + "s (Target: " + (targetType || "none") + ")");
    } catch (err: any) {
      const elapsed = Date.now() - targetStart;
      metrics.push({
        url: targetUrl,
        success: false,
        attemptsCount: 0,
        durationMs: elapsed,
        failureCategory: "CRASH / UNHANDLED",
        reason: err.message
      });
      console.log("[" + (idx + 1) + "/" + sampleSize + "] " + targetUrl + " -> ERROR in " + (elapsed / 1000).toFixed(1) + "s: " + err.message);
    } finally {
      if (browserContext) {
        await releaseContext(browserContext).catch(() => {});
      }
    }
  }

  await closePool().catch(() => {});

  const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalSuccess = metrics.filter((m) => m.success).length;
  const totalFailed = metrics.filter((m) => !m.success).length;
  const rawSuccessRate = ((totalSuccess / sampleSize) * 100).toFixed(1);

  const failureCategories: Record<string, number> = {};
  for (const m of metrics) {
    if (!m.success && m.failureCategory) {
      failureCategories[m.failureCategory] = (failureCategories[m.failureCategory] || 0) + 1;
    }
  }

  const eligibleTargets = metrics.filter((m) => m.failureCategory !== "CAPTCHA / HUMAN VERIFICATION" && m.failureCategory !== "HTTP 403");
  const eligibleSuccess = eligibleTargets.filter((m) => m.success).length;
  const eligibleSuccessRate = eligibleTargets.length > 0 ? ((eligibleSuccess / eligibleTargets.length) * 100).toFixed(1) : "0.0";

  console.log("\n==================================================");
  console.log("DIAGNOSTIC BENCHMARK RESULTS (" + sampleSize + " TARGETS)");
  console.log("==================================================");
  console.log("Total Targets:        " + sampleSize);
  console.log("Successful:           " + totalSuccess);
  console.log("Failed:               " + totalFailed);
  console.log("Raw Success Rate:     " + rawSuccessRate + "%");
  console.log("Eligible Targets:     " + eligibleTargets.length);
  console.log("Eligible Success Rate:" + eligibleSuccessRate + "%");
  console.log("Total Runtime:        " + totalTimeSec + "s (avg " + (Number(totalTimeSec) / sampleSize).toFixed(1) + "s/target)");
  console.log("\nFailure Breakdown:");
  for (const [cat, count] of Object.entries(failureCategories)) {
    console.log("  - " + cat + ": " + count);
  }
  console.log("==================================================\n");

  fs.writeFileSync(
    "data/diagnostic-benchmark-results.json",
    JSON.stringify({ total: sampleSize, totalSuccess, totalFailed, rawSuccessRate, eligibleSuccessRate, totalTimeSec, failureCategories, metrics }, null, 2)
  );
}

run().catch(console.error);
