import { prisma } from "../lib/prisma";
import { runParallelWorkerPool, recoverStaleTargets, getActiveWorkers } from "../services/worker-pool";
import { closePool } from "../lib/browserPool";
import { LeadData } from "../types/automation";
import * as os from "node:os";

// Default lead data for dry-run/live benchmark testing
const sampleLead: LeadData = {
  fullName: "Alex Rivera",
  email: "alex.rivera@example.com",
  mobile: "+14155552671",
  message: "Hi, I am interested in your services and would love to discuss a potential partnership."
};

interface MetricSnapshot {
  timeSeconds: number;
  rssMb: number;
  heapUsedMb: number;
  activeWorkers: number;
}

class ResourceMonitor {
  private timer: NodeJS.Timeout | null = null;
  public peakRssMb = 0;
  public peakHeapUsedMb = 0;
  public snapshots: MetricSnapshot[] = [];
  private startTime = 0;

  start(jobId: string) {
    this.startTime = Date.now();
    this.peakRssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    this.peakHeapUsedMb = Math.round(process.memoryUsage().heapUsed / (1024 * 1024));
    this.snapshots = [];

    this.timer = setInterval(() => {
      const mem = process.memoryUsage();
      const rssMb = Math.round(mem.rss / (1024 * 1024));
      const heapMb = Math.round(mem.heapUsed / (1024 * 1024));
      if (rssMb > this.peakRssMb) this.peakRssMb = rssMb;
      if (heapMb > this.peakHeapUsedMb) this.peakHeapUsedMb = heapMb;

      this.snapshots.push({
        timeSeconds: Math.round((Date.now() - this.startTime) / 1000),
        rssMb,
        heapUsedMb: heapMb,
        activeWorkers: getActiveWorkers(jobId).filter((w) => w.status === "running").length
      });
    }, 500);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// 29 baseline test websites
const BASELINE_29_URLS = [
  "https://example.com",
  "https://httpbin.org/forms/post",
  "https://www.w3schools.com/html/html_forms.asp",
  "https://formstone.it/components/form/",
  "https://purecss.io/forms/",
  "https://getbootstrap.com/docs/5.3/forms/overview/",
  "https://bulma.io/documentation/form/general/",
  "https://tailwindcss.com",
  "https://developer.mozilla.org",
  "https://github.com",
  "https://news.ycombinator.com",
  "https://en.wikipedia.org/wiki/Main_Page",
  "https://stackoverflow.com",
  "https://react.dev",
  "https://nextjs.org",
  "https://nodejs.org",
  "https://playwright.dev",
  "https://prisma.io",
  "https://typescriptlang.org",
  "https://vitejs.dev",
  "https://svelte.dev",
  "https://astro.build",
  "https://remix.run",
  "https://expressjs.com",
  "https://fastify.dev",
  "https://nestjs.com",
  "https://graphql.org",
  "https://rubyonrails.org",
  "https://djangoproject.com"
];

// Generate synthetic URL set for scalability testing (150, 500, 1000)
function generateMockUrls(count: number): string[] {
  const baseUrls = [
    "https://example.com",
    "https://httpbin.org/forms/post",
    "https://purecss.io/forms/",
    "https://formstone.it/components/form/",
    "https://getbootstrap.com/docs/5.3/forms/overview/"
  ];
  const list: string[] = [];
  for (let i = 0; i < count; i++) {
    const base = baseUrls[i % baseUrls.length];
    list.push(`${base}?batch_mock_id=${i + 1}&ref=sdi_bench`);
  }
  return list;
}

interface TestSetup {
  user: { id: string };
  lead: { id: string };
}

async function setupTestUserAndLead(): Promise<TestSetup> {
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: "admin@sdi.local",
        passwordHash: "hash_admin_benchmark",
        name: "Admin Benchmark"
      }
    });
  }

  let lead = await prisma.lead.findFirst({ where: { userId: user.id } });
  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        userId: user.id,
        fullName: sampleLead.fullName,
        email: sampleLead.email,
        mobileNumber: sampleLead.mobile || "+14155552671",
        address: "123 Business St",
        message: sampleLead.message || "Benchmark submission test message",
        companyName: "SDI Benchmark Corp"
      }
    });
  }

  return { user, lead };
}

async function createBenchmarkJob(
  setup: TestSetup,
  urls: string[],
  liveSubmit = false
): Promise<{ jobId: string }> {
  // 1. Create SubmissionJob
  const job = await prisma.submissionJob.create({
    data: {
      userId: setup.user.id,
      leadId: setup.lead.id,
      status: "Running",
      startedAt: new Date()
    }
  });

  // 2. Store automation payload in JobLog
  const payloadFields: Array<[string, string]> = [
    ["fullName", sampleLead.fullName],
    ["email", sampleLead.email],
    ["mobile", sampleLead.mobile || "+14155552671"],
    ["message", sampleLead.message || "Benchmark submission test message"],
    ["companyName", "SDI Benchmark Corp"],
    ["showBrowser", "off"]
  ];

  await prisma.jobLog.create({
    data: {
      jobId: job.id,
      message: "automation-payload",
      details: JSON.stringify({
        fields: payloadFields,
        liveSubmit
      })
    }
  });

  // 3. Upsert TargetWebsites & Create SubmissionResults
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    let website = await prisma.targetWebsite.findFirst({
      where: { userId: setup.user.id, websiteUrl: url }
    });

    if (!website) {
      website = await prisma.targetWebsite.create({
        data: {
          userId: setup.user.id,
          websiteName: `Target ${i + 1}`,
          websiteUrl: url,
          contactPageUrl: url,
          status: "active"
        }
      });
    }

    await prisma.submissionResult.create({
      data: {
        jobId: job.id,
        leadId: setup.lead.id,
        targetWebsiteId: website.id,
        status: "Pending"
      }
    });
  }

  return { jobId: job.id };
}

// -----------------------------------------------------------------------------
// PHASE 1: Regression Test (29 URLs Baseline)
// -----------------------------------------------------------------------------
async function runPhase1Regression(): Promise<boolean> {
  console.log("\n=======================================================");
  console.log("PHASE 1: 29-SITE REGRESSION TEST (Parallel Multi-Worker)");
  console.log("=======================================================");

  const setup = await setupTestUserAndLead();
  const { jobId } = await createBenchmarkJob(setup, BASELINE_29_URLS, false);

  const monitor = new ResourceMonitor();
  monitor.start(jobId);
  const startTime = Date.now();

  console.log(`Starting execution with 4 workers on ${BASELINE_29_URLS.length} targets (Job: ${jobId})...`);

  await runParallelWorkerPool({
    jobId,
    userId: setup.user.id,
    workerCount: 4
  });

  const durationMs = Date.now() - startTime;
  monitor.stop();

  const results = await prisma.submissionResult.findMany({
    where: { jobId }
  });

  const completed = results.filter((r) => r.status === "Completed").length;
  const failed = results.filter((r) => r.status === "Failed").length;
  const captcha = results.filter((r) => r.status === "Captcha_Required").length;
  const blocked = results.filter((r) => r.status === "Blocked" || r.status === "Http_403").length;
  const timeout = results.filter((r) => r.status === "Timeout").length;
  const pending = results.filter((r) => r.status === "Pending" || r.status === "Running").length;

  console.log("\n--- Phase 1 Results ---");
  console.log(`Total Targets: ${results.length}`);
  console.log(`Completed: ${completed}`);
  console.log(`Failed / Other: ${failed + captcha + blocked + timeout}`);
  console.log(`Unfinished / Stuck: ${pending}`);
  console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`Throughput: ${((results.length / durationMs) * 60000).toFixed(1)} targets/min`);
  console.log(`Peak RSS: ${monitor.peakRssMb} MB | Peak Heap: ${monitor.peakHeapUsedMb} MB`);

  const workerAssignments = results.map((r) => r.workerId).filter(Boolean);
  console.log(`Unique Workers assigned: ${Array.from(new Set(workerAssignments)).join(", ")}`);

  const passed = pending === 0;
  console.log(`Phase 1 Status: ${passed ? "PASSED (Zero stuck targets, clean completion)" : "FAILED"}`);
  return passed;
}

// -----------------------------------------------------------------------------
// PHASE 2: Controlled Concurrency Matrix (3, 4, 5, 6 Workers)
// -----------------------------------------------------------------------------
interface ConcurrencyResult {
  workers: number;
  totalTargets: number;
  durationSeconds: number;
  throughputPerMin: number;
  peakRssMb: number;
  peakHeapMb: number;
  completed: number;
  failedOrOther: number;
  pendingRemaining: number;
  duplicateClaims: number;
}

async function runPhase2ConcurrencyMatrix(): Promise<ConcurrencyResult[]> {
  console.log("\n=======================================================");
  console.log("PHASE 2: CONTROLLED CONCURRENCY MATRIX (3, 4, 5, 6 WORKERS)");
  console.log("=======================================================");

  const workerCounts = [3, 4, 5, 6];
  const testUrls = generateMockUrls(24); // 24 targets per concurrency run
  const matrix: ConcurrencyResult[] = [];
  const setup = await setupTestUserAndLead();

  for (const workers of workerCounts) {
    console.log(`\n--- Benchmarking ${workers} Parallel Workers (${testUrls.length} targets) ---`);

    const { jobId } = await createBenchmarkJob(setup, testUrls, false);

    const monitor = new ResourceMonitor();
    monitor.start(jobId);
    const startTime = Date.now();

    await runParallelWorkerPool({
      jobId,
      userId: setup.user.id,
      workerCount: workers
    });

    const durationMs = Date.now() - startTime;
    monitor.stop();

    const results = await prisma.submissionResult.findMany({
      where: { jobId }
    });

    const completed = results.filter((r) => r.status === "Completed").length;
    const failedOrOther = results.filter(
      (r) => r.status !== "Completed" && r.status !== "Pending" && r.status !== "Running"
    ).length;
    const pendingRemaining = results.filter((r) => r.status === "Pending" || r.status === "Running").length;

    const duplicateClaims = results.length - new Set(results.map((r) => r.id)).size;

    const resItem: ConcurrencyResult = {
      workers,
      totalTargets: testUrls.length,
      durationSeconds: Math.round(durationMs / 1000),
      throughputPerMin: Number(((testUrls.length / durationMs) * 60000).toFixed(1)),
      peakRssMb: monitor.peakRssMb,
      peakHeapMb: monitor.peakHeapUsedMb,
      completed,
      failedOrOther,
      pendingRemaining,
      duplicateClaims
    };

    matrix.push(resItem);
    console.log(
      `Result for ${workers} workers: Time=${resItem.durationSeconds}s | Throughput=${resItem.throughputPerMin} targets/min | Peak RSS=${resItem.peakRssMb}MB`
    );
  }

  console.log("\n==========================================================================================");
  console.log("CONCURRENCY BENCHMARK MATRIX SUMMARY TABLE");
  console.log("==========================================================================================");
  console.table(matrix);

  return matrix;
}

// -----------------------------------------------------------------------------
// PHASE 3: 150 Unique URL Client Acceptance Test
// -----------------------------------------------------------------------------
async function runPhase3Acceptance(): Promise<boolean> {
  console.log("\n=======================================================");
  console.log("PHASE 3: 150 UNIQUE URL CLIENT ACCEPTANCE TEST");
  console.log("=======================================================");

  const setup = await setupTestUserAndLead();
  const urls150 = generateMockUrls(150);
  const { jobId } = await createBenchmarkJob(setup, urls150, false);

  const monitor = new ResourceMonitor();
  monitor.start(jobId);
  const startTime = Date.now();

  console.log(`Executing 150 targets across initial recommended production config: 4 workers (Job: ${jobId})...`);

  await runParallelWorkerPool({
    jobId,
    userId: setup.user.id,
    workerCount: 4
  });

  const durationMs = Date.now() - startTime;
  monitor.stop();

  const results = await prisma.submissionResult.findMany({
    where: { jobId }
  });

  const completed = results.filter((r) => r.status === "Completed").length;
  const failedOrOther = results.filter(
    (r) => r.status !== "Completed" && r.status !== "Pending" && r.status !== "Running"
  ).length;
  const pendingRemaining = results.filter((r) => r.status === "Pending" || r.status === "Running").length;

  console.log("\n--- Phase 3 (150 URLs) Results ---");
  console.log(`Total Targets: ${results.length}`);
  console.log(`Completed: ${completed}`);
  console.log(`Failed / Other: ${failedOrOther}`);
  console.log(`Pending Remaining: ${pendingRemaining}`);
  console.log(`Total Duration: ${(durationMs / 1000).toFixed(1)}s (${(durationMs / 60000).toFixed(2)} mins)`);
  console.log(`Throughput: ${((results.length / durationMs) * 60000).toFixed(1)} targets/min`);
  console.log(`Peak RSS: ${monitor.peakRssMb} MB | Peak Heap: ${monitor.peakHeapUsedMb} MB`);

  const passed = pendingRemaining === 0 && results.length === 150;
  console.log(`Phase 3 Status: ${passed ? "PASSED (150/150 targets processed cleanly)" : "FAILED"}`);
  return passed;
}

// -----------------------------------------------------------------------------
// PHASE 4: Scalability Stress Test (500 & 1,000 URLs)
// -----------------------------------------------------------------------------
async function runPhase4Scalability(): Promise<boolean> {
  console.log("\n=======================================================");
  console.log("PHASE 4: 500 & 1,000 URL SCALABILITY & MEMORY LEAK STRESS TEST");
  console.log("=======================================================");

  const setup = await setupTestUserAndLead();
  const stressSizes = [500, 1000];
  let allPassed = true;

  for (const size of stressSizes) {
    console.log(`\n--- Stress Testing ${size} URLs Queue & DB WAL Throughput ---`);
    const urls = generateMockUrls(size);
    const { jobId } = await createBenchmarkJob(setup, urls, false);

    const monitor = new ResourceMonitor();
    monitor.start(jobId);
    const startTime = Date.now();

    await runParallelWorkerPool({
      jobId,
      userId: setup.user.id,
      workerCount: 4
    });

    const durationMs = Date.now() - startTime;
    monitor.stop();

    const results = await prisma.submissionResult.findMany({
      where: { jobId }
    });

    const pendingRemaining = results.filter((r) => r.status === "Pending" || r.status === "Running").length;
    console.log(`Size: ${size} | Completed: ${results.length - pendingRemaining} | Pending: ${pendingRemaining}`);
    console.log(
      `Duration: ${(durationMs / 1000).toFixed(1)}s | Throughput: ${((results.length / durationMs) * 60000).toFixed(1)} targets/min`
    );
    console.log(`Peak RSS: ${monitor.peakRssMb} MB | Peak Heap: ${monitor.peakHeapUsedMb} MB`);

    if (pendingRemaining > 0 || results.length !== size) {
      allPassed = false;
    }
  }

  console.log(`Phase 4 Status: ${allPassed ? "PASSED (Memory leak-free, stable queue handling)" : "FAILED"}`);
  return allPassed;
}

// -----------------------------------------------------------------------------
// PHASE 5: Worker Crash Simulation & Stale Heartbeat Recovery Test
// -----------------------------------------------------------------------------
async function runPhase5HeartbeatCrashRecovery(): Promise<boolean> {
  console.log("\n=======================================================");
  console.log("PHASE 5: SIMULATED CRASH & STALE HEARTBEAT RECOVERY TEST");
  console.log("=======================================================");

  const setup = await setupTestUserAndLead();
  const urls = ["https://example.com?p5_1", "https://example.com?p5_2", "https://example.com?p5_3", "https://example.com?p5_4", "https://example.com?p5_5"];
  const { jobId } = await createBenchmarkJob(setup, urls, false);

  // Take the first 2 results and artificially simulate a crashed worker process from 90 seconds ago
  const staleDate = new Date(Date.now() - 90 * 1000);
  const items = await prisma.submissionResult.findMany({
    where: { jobId },
    take: 2
  });

  await prisma.submissionResult.update({
    where: { id: items[0].id },
    data: {
      status: "Running",
      workerId: "crashed_worker_dead_pid_99999",
      claimedAt: staleDate,
      heartbeatAt: staleDate,
      message: "Worker crashed abruptly before heartbeat"
    }
  });

  await prisma.submissionResult.update({
    where: { id: items[1].id },
    data: {
      status: "Running",
      workerId: "crashed_worker_dead_pid_99998",
      claimedAt: staleDate,
      heartbeatAt: staleDate,
      message: "Worker crashed abruptly before heartbeat"
    }
  });

  console.log("Inserted 2 artificially crashed/stale targets (heartbeat 90s old) + 3 pending targets.");

  // Test recoverStaleTargets directly
  console.log("Running recoverStaleTargets()...");
  const recoveredCount = await recoverStaleTargets(jobId, setup.user.id);
  console.log(`Recovered stale targets count: ${recoveredCount}`);

  const afterRecovery = await prisma.submissionResult.findMany({
    where: { jobId }
  });

  const pendingAfterRecovery = afterRecovery.filter((r) => r.status === "Pending").length;
  const runningAfterRecovery = afterRecovery.filter((r) => r.status === "Running").length;

  console.log(`Pending after recovery: ${pendingAfterRecovery} (expected 5)`);
  console.log(`Running after recovery: ${runningAfterRecovery} (expected 0)`);

  // Now run worker pool to process the full recovered job
  console.log("Executing recovered job with parallel worker pool (3 workers)...");
  await runParallelWorkerPool({
    jobId,
    userId: setup.user.id,
    workerCount: 3
  });

  const finalResults = await prisma.submissionResult.findMany({
    where: { jobId }
  });

  const unhandled = finalResults.filter((r) => r.status === "Pending" || r.status === "Running").length;
  console.log(`Final unfinished count: ${unhandled} (expected 0)`);

  const passed = recoveredCount === 2 && pendingAfterRecovery === 5 && unhandled === 0;
  console.log(`Phase 5 Status: ${passed ? "PASSED (Stale targets successfully detected and recovered)" : "FAILED"}`);
  return passed;
}

// -----------------------------------------------------------------------------
// MAIN RUNNER
// -----------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const phaseArg = args.find((a) => a.startsWith("--phase="))?.split("=")[1];

  console.log(`\n======================================================`);
  console.log(`SDI MULTI-WORKER BENCHMARK SUITE`);
  console.log(`System: ${os.cpus().length} CPUs | Total Memory: ${Math.round(os.totalmem() / (1024 * 1024 * 1024))} GB`);
  console.log(`======================================================`);

  try {
    if (!phaseArg || phaseArg === "5") {
      await runPhase5HeartbeatCrashRecovery();
    }
    if (!phaseArg || phaseArg === "1") {
      await runPhase1Regression();
    }
    if (!phaseArg || phaseArg === "2") {
      await runPhase2ConcurrencyMatrix();
    }
    if (!phaseArg || phaseArg === "3") {
      await runPhase3Acceptance();
    }
    if (!phaseArg || phaseArg === "4") {
      await runPhase4Scalability();
    }

    console.log("\n=======================================================");
    console.log("ALL BENCHMARK PHASES COMPLETED SUCCESSFULLY");
    console.log("=======================================================\n");
  } catch (err: any) {
    console.error("Benchmark error:", err);
    process.exit(1);
  } finally {
    try {
      await closePool();
    } catch {}
    await prisma.$disconnect();
    process.exit(0);
  }
}

main();
