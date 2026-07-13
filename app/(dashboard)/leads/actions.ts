"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function createLeadAction(formData: FormData) {
  const user = await requireUser();

  await prisma.lead.create({
    data: {
      fullName: String(formData.get("fullName") ?? "").trim(),
      mobileNumber: String(formData.get("mobileNumber") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim().toLowerCase(),
      address: String(formData.get("address") ?? "").trim(),
      message: String(formData.get("message") ?? "").trim(),
      companyName: String(formData.get("companyName") ?? "").trim(),
      userId: user.id
    }
  });

  revalidatePath("/leads");
}
