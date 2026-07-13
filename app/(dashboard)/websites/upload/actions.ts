"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { importWebsitesFromExcel } from "@/services/website-import";
import { prisma } from "@/lib/prisma";
import fs from "node:fs/promises";
import path from "node:path";

function summaryToSearchParams(summary: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(summary)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }

  return params.toString();
}

export async function uploadWebsitesAction(formData: FormData) {
  const user = await requireUser();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    redirect(
      `/websites/upload?${summaryToSearchParams({
        totalRows: 0,
        savedRows: 0,
        duplicateRows: 0,
        invalidRows: 0,
        failedRows: 0,
        message: "Please choose a .xlsx file to upload."
      })}`
    );
  }

  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    redirect(
      `/websites/upload?${summaryToSearchParams({
        totalRows: 0,
        savedRows: 0,
        duplicateRows: 0,
        invalidRows: 0,
        failedRows: 0,
        message: "Only .xlsx files are supported."
      })}`
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const summary = await importWebsitesFromExcel(user.id, buffer);
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await fs.mkdir(uploadDir, { recursive: true });
  const safeName = file.name.replace(/[^a-z0-9._-]+/gi, "-");
  await fs.writeFile(path.join(uploadDir, `${Date.now()}-${safeName}`), buffer);

  redirect(`/websites/upload?${summaryToSearchParams(summary)}`);
}

export async function removeUploadedFileAction(formData: FormData) {
  await requireUser();
  const fileName = path.basename(String(formData.get("fileName") ?? ""));
  if (fileName) await fs.unlink(path.join(process.cwd(), "public", "uploads", fileName)).catch(() => undefined);
  redirect("/websites/upload?message=Uploaded%20file%20removed");
}

export async function renameUploadedFileAction(formData: FormData) {
  await requireUser();
  const oldName = path.basename(String(formData.get("fileName") ?? ""));
  let newName = String(formData.get("newName") ?? "").trim().replace(/[^a-z0-9._-]+/gi, "-");
  if (!newName.toLowerCase().endsWith(".xlsx")) newName += ".xlsx";
  if (oldName && newName) {
    const prefix = oldName.match(/^\d+-/)?.[0] ?? `${Date.now()}-`;
    const dir = path.join(process.cwd(), "public", "uploads");
    await fs.rename(path.join(dir, oldName), path.join(dir, `${prefix}${newName}`));
  }
  redirect("/websites/upload?message=Uploaded%20file%20renamed");
}

export async function clearSavedWebsitesAction() {
  const user = await requireUser();
  await prisma.targetWebsite.deleteMany({ where: { userId: user.id } });
  redirect("/websites/upload?message=Saved%20websites%20cleared");
}
