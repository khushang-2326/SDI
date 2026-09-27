import { acquireContext, releaseContext } from "../lib/browserPool";
import { discoverSubmissionTargets } from "../services/submission-target-discovery";

const sampleTargets = [
  // 15 Targets previously failed as "Robot Challenge Screen detected"
  "https://www.canesta.com/contact",
  "https://seooptimizers.com/contact",
  "https://onecallwebdesign.com/contact",
  "https://sassandseo.com/contact",
  "https://www.digitalpiloto.com/contact",
  "https://orangecounty.digital/contact-us",
  "https://innovisionbiz.com/contact",
  "https://inpowermarketing.com/contact-us",
  "https://peakifymarketing.com/contact",
  "https://seoforleadgen.com/contact",
  "https://www.alignedposition.com/contact",
  "https://shoppositioner.com/contact-us",
  "https://leadforgesolutions.com/contact",
  "https://justdigitalinc.com/contact",
  "https://bananasmarketing.com/contact-us",

  // 5 Previously successful controls
  "https://eclipsemarketing.io/contact",
  "https://seotuners.com/contact-us",
  "https://405ads.com/contact",
  "https://zupo.co/contact-us",
  "https://rankwiseseo.com/contact-us"
];

async function run() {
  console.log("==================================================================");
  console.log("TESTING 20 SAMPLE TARGETS FOR FALSE-POSITIVE VERIFICATION FIX");
  console.log("==================================================================\n");

  let falsePositiveCount = 0;
  let recoveredCount = 0;
  let genuineChallengeCount = 0;

  for (let i = 0; i < sampleTargets.length; i++) {
    const url = sampleTargets[i];
    let context = null;
    try {
      context = await acquireContext({ headless: true, startupTimeoutMs: 8000 });
      const t0 = Date.now();
      const discovery = await discoverSubmissionTargets({
        websiteUrl: url,
        timeoutMs: 10000,
        browserContext: context,
        maxNavigationLinks: 3,
        maxFallbackPaths: 1
      });
      const dur = Date.now() - t0;

      const hasRobotChallenge = discovery.reason?.toLowerCase().includes("robot challenge");
      const hasVerification = discovery.reason?.toLowerCase().includes("unsupported verification");

      if (i < 15) {
        if (!hasRobotChallenge && !hasVerification) {
          recoveredCount++;
          console.log(`[${i + 1}/20] ✓ RECOVERED: ${url} (${dur}ms) -> Targets: ${discovery.targets.length}, Reason: ${discovery.reason}`);
        } else {
          genuineChallengeCount++;
          console.log(`[${i + 1}/20] ⚠ CHALLENGE: ${url} (${dur}ms) -> Reason: ${discovery.reason}`);
        }
      } else {
        console.log(`[${i + 1}/20] CONTROL: ${url} (${dur}ms) -> Targets: ${discovery.targets.length}, Reason: ${discovery.reason}`);
      }
    } catch (err: any) {
      console.log(`[${i + 1}/20] ✗ ERROR: ${url} -> ${err.message}`);
    } finally {
      if (context) await releaseContext(context).catch(() => undefined);
    }
  }

  console.log("\n==================================================================");
  console.log(`RESULTS FOR 15 PREVIOUSLY-BLOCKED ROBOT CHALLENGE SAMPLES:`);
  console.log(`- Recovered from False Positive: ${recoveredCount} / 15 (${((recoveredCount / 15) * 100).toFixed(1)}%)`);
  console.log(`- Genuine Challenges: ${genuineChallengeCount} / 15`);
  console.log("==================================================================");
}

run().catch(console.error);
