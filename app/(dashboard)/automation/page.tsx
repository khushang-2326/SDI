import { AutomationRunner } from "@/components/AutomationRunner";
import { PageHeader } from "@/components/PageHeader";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";

export default async function AutomationPage() {
  const user = await requireUser();
  const websites = await prisma.targetWebsite.findMany({
    where: { userId: user.id, status: "active" },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      websiteName: true,
      websiteUrl: true,
      contactPageUrl: true
    }
  });
  const uniqueWebsites = Array.from(
    new Map(
      websites.map((website) => [
        `${website.websiteUrl}|${website.contactPageUrl}`,
        website
      ])
    ).values()
  );
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  const uploadedFiles = await fs.readdir(uploadDir).catch(() => [] as string[]);
  const websiteIdByUrl = new Map(uniqueWebsites.map((website) => [website.websiteUrl.replace(/\/$/, "").toLowerCase(), website.id]));
  const fileGroups = await Promise.all(uploadedFiles.map(async (fileName) => {
    const workbook = XLSX.read(await fs.readFile(path.join(uploadDir, fileName)), { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const websiteIds = rows.map((row) => String(row.website ?? row.websiteUrl ?? "").trim()).map((url) => /^https?:\/\//i.test(url) ? url : `https://${url}`).map((url) => url.replace(/\/$/, "").toLowerCase()).map((url) => websiteIdByUrl.get(url)).filter((id): id is string => Boolean(id));
    return { fileName, displayName: fileName.replace(/^\d+-/, ""), websiteIds: Array.from(new Set(websiteIds)) };
  }));

  return (
    <>
      <PageHeader
        description="Process every website imported from Excel in one sequential run, select one saved website, or enter a URL manually."
        title="Run Automation"
      />
      <AutomationRunner fileGroups={fileGroups} websites={uniqueWebsites} />
    </>
  );
}
