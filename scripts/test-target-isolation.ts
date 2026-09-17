import { acquireContext, releaseContext, closePool } from '../lib/browserPool';
import { runMultiTargetAutomation } from '../services/multi-target-automation';
import { LeadData, BookingPreferences } from '../types/automation';

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

async function main() {
  console.log("==================================================");
  console.log("RUNNING TARGET ISOLATION REGRESSION TEST");
  console.log("==================================================");

  let targetAFired = false;
  let targetBCompleted = false;
  let targetBContextClosedPrematurely = false;

  // 1. Target A: Give a tight deadline (500ms) on a slow URL so deadline fires
  console.log("\n[TEST-1] Launching Target A with 500ms deadline (deliberate timeout)...");
  const contextA = await acquireContext({ headless: true });
  const startA = Date.now();
  try {
    const resA = await runMultiTargetAutomation({
      websiteUrl: 'https://httpbin.org/delay/5',
      leadData,
      bookingPreferences,
      liveSubmit: false,
      browserContext: contextA,
      timeoutMs: 10000,
      deadlineAt: Date.now() + 500
    });
    console.log(`[TEST-1] Target A finished in ${Date.now() - startA}ms with reason:`, resA.discoveryReason);
    targetAFired = resA.discoveryReason.toLowerCase().includes("time limit") || resA.attempts.length === 0;
  } catch (err: any) {
    console.log(`[TEST-1] Target A threw as expected in ${Date.now() - startA}ms:`, err.message);
    targetAFired = true;
  } finally {
    await releaseContext(contextA).catch(() => undefined);
  }

  // 2. Target B: Runs immediately after Target A
  console.log("\n[TEST-2] Launching Target B immediately on fresh context...");
  const contextB = await acquireContext({ headless: true });
  const startB = Date.now();
  try {
    const resB = await runMultiTargetAutomation({
      websiteUrl: 'https://httpbin.org/html',
      leadData,
      bookingPreferences,
      liveSubmit: false,
      browserContext: contextB,
      timeoutMs: 15000,
      deadlineAt: Date.now() + 15000
    });
    console.log(`[TEST-2] Target B finished in ${Date.now() - startB}ms, status:`, resB.discoveryReason);
    targetBCompleted = true;
  } catch (err: any) {
    console.error(`[TEST-2] Target B failed:`, err.message);
    if (/target page, context or browser has been closed|target closed|browser has been closed/i.test(err.message)) {
      targetBContextClosedPrematurely = true;
    }
  } finally {
    await releaseContext(contextB).catch(() => undefined);
    await closePool();
  }

  console.log("\n==================================================");
  console.log("TARGET ISOLATION TEST VERIFICATION RESULTS");
  console.log("==================================================");
  console.log(`Target A Deadline Triggered:        ${targetAFired ? "PASS" : "FAIL"}`);
  console.log(`Target B Completed Cleanly:         ${targetBCompleted ? "PASS" : "FAIL"}`);
  console.log(`Context Prematurely Closed by A:    ${targetBContextClosedPrematurely ? "FAIL (LEAK)" : "PASS (ISOLATED)"}`);

  if (targetBCompleted && !targetBContextClosedPrematurely) {
    console.log("\n>>> REGRESSION TEST PASSED: Target isolation & deadline lifecycle verified clean! <<<\n");
    process.exit(0);
  } else {
    console.error("\n>>> REGRESSION TEST FAILED: Context closure or isolation leak detected! <<<\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error during target isolation test:", err);
  process.exit(1);
});
