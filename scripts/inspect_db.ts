import { prisma } from "../lib/prisma";

async function main() {
  const websitesCount = await prisma.targetWebsite.count();
  console.log("Total target websites in DB:", websitesCount);

  const jobs = await prisma.submissionJob.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { results: true } }
    },
    take: 10
  });

  console.log("Recent Jobs in DB:");
  for (const job of jobs) {
    console.log(`Job ID: ${job.id}, Status: ${job.status}, Results Count: ${job._count.results}, CreatedAt: ${job.createdAt.toISOString()}`);
  }

  // Let's check results for the latest jobs
  if (jobs.length > 0) {
    const latestJob = jobs[0];
    const results = await prisma.submissionResult.findMany({
      where: { jobId: latestJob.id },
      include: {
        targetWebsite: true,
        attempts: true
      }
    });
    console.log(`\nLatest Job ${latestJob.id} Breakdown:`);
    let succ = 0;
    let fail = 0;
    for (const r of results) {
      const isSuccess = r.status === "Completed" || r.attempts.some(a => ["success", "completed", "dry_run_ready_to_book"].includes(a.status.toLowerCase()));
      if (isSuccess) succ++; else fail++;
      console.log(`- ${r.targetWebsite.websiteUrl}: Status=${r.status}, Attempts=${r.attempts.length}, Message=${r.message}`);
    }
    console.log(`Summary: ${succ} succeeded, ${fail} failed out of ${results.length}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
