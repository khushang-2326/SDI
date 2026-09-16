import { prisma } from "../lib/prisma";
import fs from "fs";
import * as XLSX from "xlsx";

async function main() {
  const wb = XLSX.readFile("data/30-form.xlsx");
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet);
  const urls: string[] = rows.map((r: any) => r.website || r.Website || Object.values(r)[0]);
  console.log("Total URLs from 30-form.xlsx:", urls.length);

  const allJobs = await prisma.submissionJob.findMany({
    include: {
      results: {
        include: {
          targetWebsite: true,
          attempts: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  console.log("Total jobs in dev.db:", allJobs.length);
  for (const job of allJobs) {
    const jobUrls = job.results.map(r => r.targetWebsite.websiteUrl);
    const overlap = jobUrls.filter(u => {
      try {
        const host = new URL(u).hostname;
        return urls.some(x => x.includes(host));
      } catch {
        return false;
      }
    });

    if (overlap.length > 3 || job.results.length === 29) {
      console.log(`\nFound relevant Job: ${job.id}, status: ${job.status}, results: ${job.results.length}, overlap: ${overlap.length}`);
      let succ = 0;
      let fail = 0;
      let trials = 0;
      for (const r of job.results) {
        trials += r.attempts.length;
        const s = r.status === "Completed" || r.attempts.some(a => ["success", "completed", "dry_run_ready_to_book"].includes(a.status.toLowerCase()));
        if (s) succ++; else fail++;
      }
      console.log(`Job metrics: ${succ}/${job.results.length} succeeded, ${fail} failed, total trials: ${trials} (${(trials / (job.results.length || 1)).toFixed(1)} trials/target)`);
    }
  }

  // Also check AutomationTransaction table
  const txCount = await prisma.automationTransaction.count();
  console.log("\nTotal automation transactions in DB:", txCount);
  if (txCount > 0) {
    const txs = await prisma.automationTransaction.findMany({
      orderBy: { createdAt: "desc" },
      take: 20
    });
    console.log("Recent 20 transactions:");
    for (const t of txs) {
      console.log(`- ${t.websiteUrl}: status=${t.status}, liveSubmit=${t.liveSubmit}, createdAt=${t.createdAt.toISOString()}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
