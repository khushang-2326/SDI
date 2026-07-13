"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { discoverSubmissionTarget } from "@/services/submission-target-discovery";

export async function createWebsiteAction(formData: FormData) {
  const user = await requireUser();
  const status = String(formData.get("status") ?? "active") === "inactive" ? "inactive" : "active";

  await prisma.targetWebsite.create({
    data: {
      websiteName: String(formData.get("websiteName") ?? "").trim(),
      websiteUrl: String(formData.get("websiteUrl") ?? "").trim(),
      contactPageUrl: String(formData.get("contactPageUrl") ?? "").trim(),
      status,
      notes: String(formData.get("notes") ?? "").trim() || null,
      userId: user.id
    }
  });

  revalidatePath("/websites");
}

export async function discoverWebsiteTargetAction(formData: FormData) {
  const user = await requireUser();
  const websiteId = String(formData.get("websiteId") ?? "");
  const website = await prisma.targetWebsite.findFirst({
    where: { id: websiteId, userId: user.id }
  });

  if (!website) {
    return;
  }

  const result = await discoverSubmissionTarget({
    websiteUrl: website.websiteUrl,
    timeoutMs: 15000
  });
  const discoveryNote = [
    website.notes,
    result.discoveredUrl
      ? `Discovered ${result.targetType}: ${result.discoveredUrl} (${result.reason})`
      : `Discovery failed: ${result.reason}`
  ]
    .filter(Boolean)
    .join("\n");

  await prisma.targetWebsite.update({
    where: { id: website.id },
    data: {
      contactPageUrl: result.discoveredUrl ?? website.contactPageUrl,
      notes: discoveryNote,
      status: result.discoveredUrl ? "active" : website.status
    }
  });

  revalidatePath("/websites");
  revalidatePath("/automation");
}
