"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function resetAnalyticsAction(formData: FormData) {
  const user = await requireUser();
  const password = String(formData.get("password") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (password !== "admin123") redirect("/analytics?resetError=Incorrect%20admin%20password");
  if (!reason) redirect("/analytics?resetError=A%20reason%20is%20required");
  await prisma.automationTransaction.deleteMany({ where: { userId: user.id } });
  redirect(`/analytics?resetMessage=${encodeURIComponent(`Analytics reset successfully. Reason: ${reason}`)}`);
}
