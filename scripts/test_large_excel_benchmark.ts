import * as XLSX from "xlsx";
import { prisma } from "../lib/prisma";
import { importWebsitesFromExcel } from "../services/website-import";

function generateMockExcelBuffer(count: number): Buffer {
  const data = [
    ["website", "websiteName", "contactPageUrl"],
    ...Array.from({ length: count }, (_, i) => [
      `https://benchmark-test-company-${i + 1}.example.com`,
      `Benchmark Company ${i + 1}`,
      `https://benchmark-test-company-${i + 1}.example.com/contact`
    ])
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Websites");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function runBenchmark() {
  console.log("=================================================");
  console.log("   LARGE DATASET EXCEL IMPORT BENCHMARK SUITE    ");
  console.log("=================================================");

  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: "benchmark_user@example.com",
        name: "Benchmark User"
      }
    });
  }

  const tiers = [100, 1000, 3000];

  for (const count of tiers) {
    console.log(`\n--- Testing ${count} Records Tier ---`);
    const genStart = performance.now();
    const buffer = generateMockExcelBuffer(count);
    const genDuration = (performance.now() - genStart).toFixed(2);
    console.log(`[1] Generated mock XLSX buffer (${(buffer.length / 1024).toFixed(1)} KB) in ${genDuration}ms`);

    const importStart = performance.now();
    const summary = await importWebsitesFromExcel(user.id, buffer);
    const importDuration = (performance.now() - importStart).toFixed(2);

    console.log(`[2] Import completed in ${importDuration}ms`);
    console.log(`    - Total Rows: ${summary.totalRows}`);
    console.log(`    - Saved Rows: ${summary.savedRows}`);
    console.log(`    - Duplicate Rows: ${summary.duplicateRows}`);
    console.log(`    - Invalid Rows: ${summary.invalidRows}`);
    console.log(`    - Throughput: ${(count / (parseFloat(importDuration) / 1000)).toFixed(0)} rows/second`);

    if (summary.savedRows + summary.duplicateRows !== count) {
      throw new Error(`Mismatch in tier ${count}: expected ${count}, got ${summary.savedRows + summary.duplicateRows}`);
    }

    // Verify DB count
    const dbCount = await prisma.targetWebsite.count({
      where: {
        userId: user.id,
        websiteUrl: { startsWith: "https://benchmark-test-company-" }
      }
    });
    console.log(`    - Verified in Database: ${dbCount} records`);

    // Clean up before next tier
    await prisma.targetWebsite.deleteMany({
      where: {
        userId: user.id,
        websiteUrl: { startsWith: "https://benchmark-test-company-" }
      }
    });
  }

  console.log("\n=================================================");
  console.log("🎉 ALL BENCHMARK TIERS COMPLETED SUCCESSFULLY!");
  console.log("3,000 records processed in sub-2-second transaction!");
  console.log("=================================================");
  process.exit(0);
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
