import { prisma } from "../lib/prisma";
import { runParallelWorkerPool } from "../services/worker-pool";
import fs from "fs";
import path from "path";

const BASELINE_JOB_ID = "cmtsxzdki06x9nm2xv4ilyrt0";

async function main() {
  console.log("==================================================================");
  console.log("STARTING FULL 292-TARGET BENCHMARK EXECUTION");
  console.log("==================================================================");

  // 1. Fetch baseline job and its exact 292 targetWebsiteIds
  const baselineJob = await prisma.submissionJob.findUnique({
    where: { id: BASELINE_JOB_ID },
    include: {
      results: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          targetWebsiteId: true,
          targetWebsite: {
            select: {
              id: true,
              websiteUrl: true,
              websiteName: true
            }
          }
        }
      }
    }
  });

  if (!baselineJob) {
    throw new Error(`Baseline job ${BASELINE_JOB_ID} not found in database.`);
  }

  const targetWebsiteIds = baselineJob.results.map(r => r.targetWebsiteId);
  console.log(`Baseline Job ID: ${BASELINE_JOB_ID}`);
  console.log(`Target Count: ${targetWebsiteIds.length} (exact match: ${targetWebsiteIds.length === 292})`);

  if (targetWebsiteIds.length !== 292) {
    throw new Error(`Expected 292 targets, got ${targetWebsiteIds.length}`);
  }

  // 2. Fetch baseline jobLog automation-payload
  const payloadLog = await prisma.jobLog.findFirst({
    where: { jobId: BASELINE_JOB_ID, message: "automation-payload" },
    orderBy: { createdAt: "desc" }
  });

  if (!payloadLog?.details) {
    throw new Error(`Automation payload log missing for baseline job ${BASELINE_JOB_ID}`);
  }

  const payload = JSON.parse(payloadLog.details);
  console.log(`Automation Payload Mode: liveSubmit=${payload.liveSubmit} (DRY RUN / SUBMISSION READY)`);
  console.log(`User ID: ${baselineJob.userId}`);
  console.log(`Lead ID: ${baselineJob.leadId}`);
  console.log(`Worker Count: 6`);

  // 3. Create new SubmissionJob
  const newJob = await prisma.submissionJob.create({
    data: {
      status: "Running",
      startedAt: new Date(),
      userId: baselineJob.userId,
      leadId: baselineJob.leadId
    }
  });

  console.log(`\n>>> NEW BENCHMARK JOB CREATED <<<`);
  console.log(`>>> JOB ID: ${newJob.id} <<<\n`);

  // 4. Copy automation-payload jobLog
  await prisma.jobLog.create({
    data: {
      jobId: newJob.id,
      level: "system",
      message: "automation-payload",
      details: payloadLog.details
    }
  });

  // 5. Create exactly 292 SubmissionResult rows in the exact same sequence
  console.log("Seeding 292 SubmissionResult records...");
  const createData = targetWebsiteIds.map(targetWebsiteId => ({
    jobId: newJob.id,
    leadId: baselineJob.leadId,
    targetWebsiteId,
    status: "Pending"
  }));

  for (const item of createData) {
    await prisma.submissionResult.create({ data: item });
  }

  const seededCount = await prisma.submissionResult.count({ where: { jobId: newJob.id } });
  console.log(`Successfully seeded ${seededCount} records for Job ${newJob.id}.`);

  // 6. Launch 6-worker parallel worker pool
  const benchmarkStartTime = Date.now();
  console.log(`Launching 6-worker pool at ${new Date().toISOString()}...`);

  const poolPromise = runParallelWorkerPool({
    jobId: newJob.id,
    userId: baselineJob.userId,
    workerCount: 6
  });

  // 7. Polling monitor loop
  let isDone = false;
  let pollCount = 0;

  const monitorInterval = setInterval(async () => {
    pollCount++;
    const elapsedSec = Math.round((Date.now() - benchmarkStartTime) / 1000);
    const elapsedMin = (elapsedSec / 60).toFixed(1);

    try {
      const counts = await prisma.submissionResult.groupBy({
        by: ["status"],
        where: { jobId: newJob.id },
        _count: { status: true }
      });

      const countMap: Record<string, number> = {};
      let totalProcessed = 0;
      for (const c of counts) {
        countMap[c.status] = c._count.status;
        if (c.status !== "Pending" && c.status !== "Running" && c.status !== "Discovering") {
          totalProcessed += c._count.status;
        }
      }

      const pending = countMap["Pending"] || 0;
      const inProgress = (countMap["Running"] || 0) + (countMap["Discovering"] || 0);
      const completed = countMap["Completed"] || 0;
      const failed = totalProcessed - completed;
      const successRate = totalProcessed > 0 ? ((completed / totalProcessed) * 100).toFixed(1) : "0.0";
      const throughput = totalProcessed > 0 ? (totalProcessed / (elapsedSec / 60)).toFixed(1) : "0.0";

      console.log(
        `[${elapsedMin}m | Poll #${pollCount}] Processed: ${totalProcessed}/292 | In-Progress: ${inProgress} | Pending: ${pending} | Success: ${completed} (${successRate}%) | Failed: ${failed} | Speed: ${throughput} targets/min`
      );

      if (pending === 0 && inProgress === 0 && totalProcessed >= 292) {
        isDone = true;
      }
    } catch (err: any) {
      console.warn(`[Monitor Warning] ${err?.message || err}`);
    }
  }, 10000);

  // Await completion of worker pool
  try {
    await poolPromise;
  } catch (err) {
    console.error("Worker pool error:", err);
  } finally {
    clearInterval(monitorInterval);
  }

  const benchmarkEndTime = Date.now();
  const totalDurationMs = benchmarkEndTime - benchmarkStartTime;
  const totalDurationSec = Math.round(totalDurationMs / 1000);
  const minutes = Math.floor(totalDurationSec / 60);
  const seconds = totalDurationSec % 60;
  const durationFormatted = `${minutes}m ${seconds}s`;

  console.log("\n==================================================================");
  console.log(`BENCHMARK RUN COMPLETED in ${durationFormatted} (${totalDurationSec}s)`);
  console.log(`Job ID: ${newJob.id}`);
  console.log("==================================================================");

  // Update parent job status to Completed
  await prisma.submissionJob.update({
    where: { id: newJob.id },
    data: { status: "Completed", completedAt: new Date() }
  });

  // 8. Fetch all results from baseline and new job for complete comparison
  console.log("Generating complete comparative forensics analysis...");
  const [baselineResults, newResults] = await Promise.all([
    prisma.submissionResult.findMany({
      where: { jobId: BASELINE_JOB_ID },
      include: { targetWebsite: true },
      orderBy: [{ targetWebsite: { websiteUrl: "asc" } }]
    }),
    prisma.submissionResult.findMany({
      where: { jobId: newJob.id },
      include: { targetWebsite: true },
      orderBy: [{ targetWebsite: { websiteUrl: "asc" } }]
    })
  ]);

  const outputPayload = {
    metadata: {
      baselineJobId: BASELINE_JOB_ID,
      newJobId: newJob.id,
      totalTargets: 292,
      workerCount: 6,
      mode: "dry_run",
      startTime: new Date(benchmarkStartTime).toISOString(),
      endTime: new Date(benchmarkEndTime).toISOString(),
      totalDurationSec,
      durationFormatted,
      baselineDurationFormatted: "34m 40s",
      baselineDurationSec: 2080
    },
    baselineResults,
    newResults
  };

  const outputPath = path.join(process.cwd(), "data", "benchmark-292-results.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(outputPayload, null, 2), "utf8");
  console.log(`Benchmark data successfully saved to: ${outputPath}`);
}

main()
  .catch(err => {
    console.error("Fatal benchmark runner error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
