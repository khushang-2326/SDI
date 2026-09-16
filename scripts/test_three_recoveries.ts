import { acquireContext, releaseContext } from "../lib/browserPool";
import { runMultiTargetAutomation } from "../services/multi-target-automation";
import { LeadData, BookingPreferences } from "../types/automation";

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

const THREE_URLS = [
  "https://based-agency.com/contact/",
  "https://overcashierdesign.com/contact",
  "https://www.liverecover.com/demo"
];

async function main() {
  console.log("==================================================");
  console.log("TESTING THE THREE RECOVERIES (DRY-RUN ONLY)");
  console.log("==================================================");

  for (const url of THREE_URLS) {
    console.log(`\nTesting target: ${url}`);
    const context = await acquireContext({ headless: true });
    try {
      const result = await runMultiTargetAutomation({
        websiteUrl: url,
        leadData,
        bookingPreferences,
        liveSubmit: false,
        browserContext: context,
        timeoutMs: 45000,
        deadlineAt: Date.now() + 60000,
        callbacks: {
          onTargetsDiscovered: async (targets, reason) => {
            console.log(`  Discovered ${targets.length} target(s). Reason: ${reason}`);
            targets.forEach((t, i) => console.log(`    [${i+1}] ${t.targetType} -> ${t.url} (conf: ${t.confidence}%)`));
          },
          onAttemptStarted: async (target) => {
            console.log(`  Executing target: ${target.targetType} on ${target.url}`);
          },
          onAttemptFinished: async (attempt) => {
            console.log(`  Finished attempt: status=${attempt.result.status}, error=${attempt.result.errorMessage}`);
            console.log(`    Filled fields (${attempt.result.filledFields.length}):`, attempt.result.filledFields);
            console.log(`    Skipped fields:`, attempt.result.skippedFields);
            console.log(`    Screenshots:`, attempt.result.screenshotPaths);
          }
        }
      });

      const succ = result.attempts.some(a => ["success", "completed", "dry_run_ready_to_book"].includes(a.result.status.toLowerCase()));
      console.log(`>> Outcome for ${url}: ${succ ? "SUCCESS" : "FAILED"}`);
    } catch (err: any) {
      console.error(`>> Error for ${url}:`, err.message);
    } finally {
      await releaseContext(context);
    }
  }
}

main().catch(console.error);
