"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/auth";
import { hashPassword } from "@/lib/password";

export async function loginAction(formData: FormData) {
  const loginId = String(formData.get("loginId") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (loginId !== "admin" || password !== "admin123") redirect("/login?error=Invalid%20ID%20or%20password");
  const user = await prisma.user.upsert({ where: { email: "admin@lead-auto-submitter.local" }, update: { name: "Administrator" }, create: { name: "Administrator", email: "admin@lead-auto-submitter.local", passwordHash: hashPassword("admin123") } });

  await setSessionCookie(user.id);
  redirect("/dashboard");
}
