import { AutomationRunner } from "@/components/AutomationRunner";
import { PageHeader } from "@/components/PageHeader";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUploadFileGroups } from "@/services/upload-file-groups";
import fs from "node:fs/promises";
import path from "node:path";

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
  const fileGroups = await getUploadFileGroups(uploadedFiles, uniqueWebsites);

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
