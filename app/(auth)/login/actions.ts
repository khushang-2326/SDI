"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/auth";
import { hashPassword } from "@/lib/password";

export async function loginAction(formData: FormData) {
  const loginId = String(formData.get("loginId") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (loginId !== "admin" || password !== "admin123") {
    redirect("/login?error=Invalid%20ID%20or%20password");
  }

  let user;
  try {
    user = await prisma.user.upsert({
      where: { email: "admin@lead-auto-submitter.local" },
      update: { name: "Administrator" },
      create: {
        name: "Administrator",
        email: "admin@lead-auto-submitter.local",
        passwordHash: hashPassword("admin123")
      }
    });
  } catch (err: any) {
    console.error("[LOGIN DATABASE ERROR]:", err);
    redirect(`/login?error=${encodeURIComponent("Database error: " + (err?.message || "Check logs"))}`);
  }

  try {
    await setSessionCookie(user.id);
  } catch (err: any) {
    console.error("[LOGIN COOKIE ERROR]:", err);
    redirect(`/login?error=${encodeURIComponent("Session error: " + (err?.message || "Failed to set cookie"))}`);
  }

  redirect("/dashboard");
}
