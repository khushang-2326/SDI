"use server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import { SolverFactory } from "@/services/captcha/solver-factory";
import { revalidatePath } from "next/cache";

export type CaptchaSettingsState = {
  success?: boolean;
  error?: string;
  captchaEnabled?: boolean;
};

/**
 * Update the user's CAPTCHA solving automation configurations.
 */
export async function updateCaptchaSettingsAction(
  _prevState: CaptchaSettingsState,
  formData: FormData
): Promise<CaptchaSettingsState> {
  try {
    const user = await requireUser();
    const enabledValue = String(formData.get("captchaEnabled") || "").toLowerCase();
    const enabled = enabledValue === "true" || enabledValue === "on" || enabledValue === "1";
    const provider = String(formData.get("captchaProvider") || "mock");
    const rawApiKey = String(formData.get("captchaApiKey") || "").trim();

    // Fetch existing settings
    const existingUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { captchaApiKey: true }
    });

    let encryptedApiKey = existingUser?.captchaApiKey ?? null;

    // Only update key if the user entered a new value
    // (We mask the current value as a bunch of bullets, e.g. "••••••••")
    if (rawApiKey && !rawApiKey.startsWith("•••")) {
      encryptedApiKey = encrypt(rawApiKey);
    } else if (!rawApiKey && rawApiKey !== "••••••••") {
      encryptedApiKey = null;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        captchaEnabled: enabled,
        captchaProvider: provider,
        captchaApiKey: encryptedApiKey
      }
    });

    revalidatePath("/settings");
    return { success: true, captchaEnabled: enabled };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to save settings." };
  }
}

/**
 * Server Action to validate a key/connection configuration dynamically.
 */
export async function validateCaptchaKeyAction(
  provider: string,
  apiKey: string
): Promise<{ success: boolean; balance?: number; message?: string }> {
  try {
    const user = await requireUser();
    let keyToValidate = apiKey.trim();

    // If key matches the masked pattern, retrieve the saved key from database
    if (keyToValidate.startsWith("•••") || !keyToValidate) {
      const existingUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { captchaApiKey: true }
      });
      if (existingUser?.captchaApiKey) {
        keyToValidate = decrypt(existingUser.captchaApiKey);
      }
    }

    if (!keyToValidate && provider !== "mock") {
      return { success: false, message: "API key is required." };
    }

    const solver = SolverFactory.getSolver(provider, keyToValidate);
    return await solver.validateKey();
  } catch (error: any) {
    return { success: false, message: error.message || "Key validation failed." };
  }
}
