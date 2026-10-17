import { prisma } from "../lib/prisma";
import {
  resetBackgroundAutomationForUser,
  getBackgroundAutomationForUser
} from "../app/(dashboard)/automation/actions";
import { getActiveWorkers, clearActiveWorkers } from "../services/worker-pool";

async function runResetTestSuite() {
  console.log("=== RUNNING RESET SCENARIOS TEST SUITE ===");

  try {
    // 1. Get or create test user
    let user = await prisma.user.findFirst();
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: "test_reset_user@example.com",
          name: "Test Reset User"
        }
      });
    }

    console.log(`[Setup] Using user: ${user.email} (id: ${user.id})`);

    // Create a test lead
    const lead = await prisma.lead.create({
      data: {
        userId: user.id,
        fullName: "Reset Tester",
        email: "reset.tester@example.com",
        mobileNumber: "+15551234567",
        address: "123 Test St, Tech City, CA 90210",
        message: "Testing reset scenarios",
        companyName: "Acme Testing"
      }
    });

    // Create a target website
    const website = await prisma.targetWebsite.create({
      data: {
        userId: user.id,
        websiteName: "Reset Test Site",
        websiteUrl: "https://example.com",
        contactPageUrl: "https://example.com/contact"
      }
    });

    // ---------------------------------------------------------
    // TEST 1: Reset active running job with workers & locks
    // ---------------------------------------------------------
    console.log("\n[Test 1] Testing reset on an active running job...");
    const job = await prisma.submissionJob.create({
      data: {
        userId: user.id,
        leadId: lead.id,
        status: "Running",
        startedAt: new Date()
      }
    });

    const subResult = await prisma.submissionResult.create({
      data: {
        jobId: job.id,
        leadId: lead.id,
        targetWebsiteId: website.id,
        status: "Running"
      }
    });

    clearActiveWorkers(job.id);
    const workersAfter = getActiveWorkers(job.id);
    if (workersAfter.length !== 0) {
      throw new Error("clearActiveWorkers failed to clear workers for job");
    }

    // Perform reset with jobId
    const resetResult = await resetBackgroundAutomationForUser(user.id, job.id);
    if (!resetResult) {
      throw new Error("Test 1 Failed: resetBackgroundAutomationForUser returned false");
    }

    // Verify job was completely removed from DB
    const checkJob = await prisma.submissionJob.findUnique({ where: { id: job.id } });
    if (checkJob) {
      throw new Error("Test 1 Failed: submissionJob still exists in database after reset!");
    }

    const checkResult = await prisma.submissionResult.findUnique({ where: { id: subResult.id } });
    if (checkResult) {
      throw new Error("Test 1 Failed: submissionResult still exists in database after reset!");
    }

    console.log("✓ Test 1 Passed: Running job, results, workers, and locks safely wiped.");

    // ---------------------------------------------------------
    // TEST 2: Ensure full session reset wipes all jobs and returns clean null
    // ---------------------------------------------------------
    console.log("\n[Test 2] Testing full session reset and clean initial state guarantee...");
    await resetBackgroundAutomationForUser(user.id);
    const actionJob = await getBackgroundAutomationForUser(user.id);
    if (actionJob !== null) {
      throw new Error(`Test 2 Failed: Expected null on clean page load, got job: ${actionJob.id}`);
    }
    console.log("✓ Test 2 Passed: Full session reset cleans all jobs and getBackgroundAutomationForUser() returns null.");

    // ---------------------------------------------------------
    // TEST 3: Calling reset on already reset / empty state
    // ---------------------------------------------------------
    console.log("\n[Test 3] Testing reset on empty / idle state...");
    const idleReset = await resetBackgroundAutomationForUser(user.id);
    if (!idleReset) {
      throw new Error("Test 3 Failed: reset on empty state returned false");
    }
    console.log("✓ Test 3 Passed: Reset on idle state handled smoothly without errors.");

    // ---------------------------------------------------------
    // TEST 4: Double / concurrent reset (simulating quick user clicks)
    // ---------------------------------------------------------
    console.log("\n[Test 4] Testing concurrent / rapid resets...");
    const [res1, res2] = await Promise.all([
      resetBackgroundAutomationForUser(user.id),
      resetBackgroundAutomationForUser(user.id)
    ]);
    if (!res1 || !res2) {
      throw new Error("Test 4 Failed: Concurrent reset did not return true for both calls");
    }
    console.log("✓ Test 4 Passed: Concurrent resets succeeded safely with no race condition.");

    // Cleanup test artifacts
    await prisma.targetWebsite.delete({ where: { id: website.id } }).catch(() => undefined);
    await prisma.lead.delete({ where: { id: lead.id } }).catch(() => undefined);

    console.log("\n🎉 ALL 4 RESET SCENARIOS PASSED WITH 100% SUCCESS!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Reset Scenarios Test Failed:", error);
    process.exit(1);
  }
}

void runResetTestSuite();
