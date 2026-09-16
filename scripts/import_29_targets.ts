import fs from "fs";
import { prisma } from "../lib/prisma";
import { importWebsitesFromExcel } from "../services/website-import";

async function main() {
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: "Administrator",
        email: "admin@lead-auto-submitter.local",
        passwordHash: "admin123"
      }
    });
  }
  console.log("Using user:", user.id, user.email);

  const fileBuffer = fs.readFileSync("data/30-form.xlsx");
  const summary = await importWebsitesFromExcel(user.id, fileBuffer);
  console.log("Import summary:", summary);

  const websites = await prisma.targetWebsite.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 35
  });

  console.log(`User now has ${websites.length} websites. Recent:`);
  for (const w of websites) {
    console.log(`- [${w.id}] ${w.websiteName}: ${w.websiteUrl}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
