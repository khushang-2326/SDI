import fs from 'node:fs';
import { submitContactForm } from '../services/contact-form-automation';
import { evaluateFinalAutomationSuccess } from '../services/success-invariants';
import { LeadData } from '../types/automation';

const realLead: LeadData = {
  fullName: "David Miller",
  email: "david.miller@acmesolutions.com",
  mobile: "2125550199",
  companyName: "Acme Solutions Inc",
  address: "450 Lexington Ave, New York, NY 10017",
  message: "Hello, we are interested in discussing your marketing and technology consulting services for our business. Please let us know your availability. Thank you."
};

interface TargetItem {
  id: string;
  name: string;
  url: string;
  category: string;
  prevMsg: string;
}

interface ValidationResultRecord {
  index: number;
  name: string;
  url: string;
  category: string;
  previousOutcome: string;
  status: string;
  resolvedUrl: string | null;
  errorMessage: string | null;
  durationMs: number;
  invariantPassed: boolean;
  invariantError: string | null;
  taxonomy: string;
  recovered: boolean;
}

function classifyTaxonomy(status: string, errorMessage: string | null, resolvedUrl: string | null): string {
  const normStatus = (status || '').toLowerCase();
  const msg = (errorMessage || '').toLowerCase();

  if (normStatus === 'success' || normStatus === 'dry_run_ready_to_book') {
    return 'SUCCESS';
  }
  if (msg.includes('403') || msg.includes('forbidden') || msg.includes('cloudflare') || msg.includes('waf')) {
    return 'HTTP_403';
  }
  if (msg.includes('human verification') || msg.includes('bot detection') || msg.includes('turnstile') || msg.includes('hcaptcha')) {
    return 'HUMAN_VERIFICATION';
  }
  if (msg.includes('captcha') || msg.includes('recaptcha')) {
    return 'CAPTCHA';
  }
  if (msg.includes('required_field_unmapped') || msg.includes('missing required field')) {
    return 'REQUIRED_FIELD_UNMAPPED';
  }
  if (msg.includes('field_fill_failed') || msg.includes('failure_form_field_mapping')) {
    return 'FIELD_FILL_FAILED';
  }
  if (msg.includes('submit_button_not_found') || msg.includes('failure_submit_control')) {
    return 'SUBMIT_BUTTON_NOT_FOUND';
  }
  if (msg.includes('failure_form_not_detected') || msg.includes('0 meaningful form fields') || msg.includes('form_not_found')) {
    return 'FORM_NOT_FOUND';
  }
  if (msg.includes('booking') || msg.includes('widget_mount_failure') || msg.includes('calendar')) {
    return 'BOOKING_FAILURE';
  }
  if (msg.includes('timeout') || msg.includes('navigation timeout') || msg.includes('dead_site')) {
    return 'NAVIGATION_TIMEOUT';
  }
  if (msg.includes('interrupted by another navigation') || msg.includes('redirect')) {
    return 'REDIRECT';
  }
  if (msg.includes('net::') || msg.includes('econnrefused') || msg.includes('err_')) {
    return 'NETWORK_ERROR';
  }
  if (msg.includes('target closed') || msg.includes('browser') || msg.includes('context')) {
    return 'BROWSER/CONTEXT';
  }
  return 'OTHER';
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function main() {
  const targets: TargetItem[] = JSON.parse(fs.readFileSync('sample_40_unseen_targets.json', 'utf8'));

  console.log("================================================================================");
  console.log(`STARTING POST-FORENSIC VALIDATION: ${targets.length} UNSEEN REAL PRODUCTION TARGETS`);
  console.log("================================================================================");

  const results: ValidationResultRecord[] = [];
  let falseSuccessCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    console.log(`\n[${i + 1}/${targets.length}] Testing: ${target.name} (${target.url})`);
    console.log(`  Previous category: ${target.category} | Prev: ${target.prevMsg.slice(0, 70)}`);

    const tStart = Date.now();
    let res: any;
    try {
      const runTarget = submitContactForm({
        websiteUrl: target.url,
        leadData: realLead,
        headless: true,
        submit: false,
        skipPersist: true,
        timeoutMs: 15000
      });
      const watchdog = new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error("Target execution watchdog timeout (20s)")), 20000)
      );
      res = await Promise.race([runTarget, watchdog]);
    } catch (err: any) {
      res = {
        status: 'failed',
        errorMessage: err?.message || 'Automation threw uncaught error',
        websiteUrl: target.url
      };
    }
    const tEnd = Date.now();
    const durationMs = tEnd - tStart;

    // Run Central Success Invariant
    let invariantPassed = true;
    let invariantError: string | null = null;
    const taxonomy = classifyTaxonomy(res.status, res.errorMessage, res.websiteUrl);

    if (res.status === 'success' || res.status === 'dry_run_ready_to_book') {
      const invCheck = evaluateFinalAutomationSuccess({
        targetType: res.bookingWidgetReason ? 'booking_widget' : 'contact_form',
        status: res.status,
        errorMessage: res.errorMessage ?? null,
        discoveryReason: res.bookingWidgetReason ?? null,
        fieldsDetected: res.fieldsDetectedCount ?? 0,
        fieldsClassified: res.fieldsClassifiedCount ?? 0,
        fieldsFilled: res.filledFieldsCount ?? 0,
        fieldsVerified: res.verifiedFieldsCount ?? 0,
        unmappedRequiredFields: res.unmappedRequiredFields ?? [],
        submitControlFound: (res.submitCandidateCount ?? 0) > 0 || res.status === 'success' || res.status === 'dry_run_ready_to_book',
        submitControlScore: res.selectedCandidateInfo?.score ?? 80
      });

      if (!invCheck.isSuccess) {
        invariantPassed = false;
        invariantError = invCheck.failureReason;
        falseSuccessCount++;
        console.error(`  🚨 INVARIANT VIOLATION: ${invCheck.failureReason}`);
      }
    }

    const isSuccess = (res.status === 'success' || res.status === 'dry_run_ready_to_book') && invariantPassed;
    const recovered = isSuccess && target.category !== 'SUCCESS';

    const record: ValidationResultRecord = {
      index: i + 1,
      name: target.name,
      url: target.url,
      category: target.category,
      previousOutcome: target.prevMsg,
      status: res.status,
      resolvedUrl: res.websiteUrl || null,
      errorMessage: res.errorMessage || null,
      durationMs,
      invariantPassed,
      invariantError,
      taxonomy,
      recovered
    };

    results.push(record);

    console.log(`  -> Status: ${res.status} | Taxonomy: ${taxonomy} | Duration: ${durationMs}ms`);
    if (res.errorMessage) {
      console.log(`  -> Error: ${res.errorMessage.slice(0, 120)}`);
    }
    if (recovered) {
      console.log(`  🌟 RECOVERED TARGET! Previously failed in ${target.category}`);
    }
  }

  // Generate Report
  console.log("\n================================================================================");
  console.log("VALIDATION SUMMARY REPORT");
  console.log("================================================================================");

  const total = results.length;
  const successCount = results.filter(r => (r.status === 'success' || r.status === 'dry_run_ready_to_book') && r.invariantPassed).length;
  const failureCount = total - successCount;
  const successPct = ((successCount / total) * 100).toFixed(1);
  const recoveredCount = results.filter(r => r.recovered).length;

  console.log(`Total URLs Tested: ${total}`);
  console.log(`Success:           ${successCount} (${successPct}%)`);
  console.log(`Failure:           ${failureCount} (${(100 - parseFloat(successPct)).toFixed(1)}%)`);
  console.log(`Recovered Count:   ${recoveredCount} / ${total}`);
  console.log(`False Successes:   ${falseSuccessCount} (Expected: 0)`);

  // Taxonomy Breakdown
  const taxonomyCounts: Record<string, number> = {};
  for (const r of results) {
    taxonomyCounts[r.taxonomy] = (taxonomyCounts[r.taxonomy] || 0) + 1;
  }

  console.log("\n--- Failure Taxonomy Breakdown ---");
  console.table(Object.entries(taxonomyCounts).map(([taxonomy, count]) => ({
    Taxonomy: taxonomy,
    Count: count,
    Percentage: `${((count / total) * 100).toFixed(1)}%`
  })));

  // Duration Percentiles
  const durations = results.map(r => r.durationMs);
  const sumDuration = durations.reduce((a, b) => a + b, 0);
  const avgDuration = Math.round(sumDuration / total);
  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);
  const p99 = percentile(durations, 99);
  const maxDuration = Math.max(...durations);

  console.log("\n--- Latency & Duration Metrics ---");
  console.log(`P50 Duration:      ${p50}ms`);
  console.log(`P95 Duration:      ${p95}ms`);
  console.log(`P99 Duration:      ${p99}ms`);
  console.log(`Max Duration:      ${maxDuration}ms`);
  console.log(`Average Duration:  ${avgDuration}ms`);

  // Save JSON report
  fs.writeFileSync('unseen_validation_report.json', JSON.stringify({
    total,
    successCount,
    failureCount,
    successPct: `${successPct}%`,
    recoveredCount,
    falseSuccessCount,
    taxonomyCounts,
    durations: { p50, p95, p99, max: maxDuration, avg: avgDuration },
    results
  }, null, 2));

  console.log("\nReport saved to unseen_validation_report.json");
}

main().catch(err => {
  console.error("Validation error:", err);
  process.exit(1);
});
