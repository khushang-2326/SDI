"use server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import { SolverFactory } from "@/services/captcha/solver-factory";
import { parseProxyString } from "@/lib/proxy/parser";
import { testProxyConnection } from "@/lib/proxy/tester";
import type { ParsedProxy, ProxyProtocol, ProxyTestResult } from "@/lib/proxy/types";
import { revalidatePath } from "next/cache";

export type CaptchaSettingsState = {
  success?: boolean;
  error?: string;
  captchaEnabled?: boolean;
};

export type ProxySettingsState = {
  success?: boolean;
  error?: string;
  proxyEnabled?: boolean;
};

const PROXY_PROTOCOLS = new Set<ProxyProtocol>(["http", "https", "socks5"]);

function parseProxyPort(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function parseProxyProtocol(value: string): ProxyProtocol | null {
  const protocol = value.toLowerCase() as ProxyProtocol;
  return PROXY_PROTOCOLS.has(protocol) ? protocol : null;
}

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
 * Server Action to validate a CAPTCHA key dynamically.
 */
export async function validateCaptchaKeyAction(
  provider: string,
  apiKey: string
): Promise<{ success: boolean; balance?: number; message?: string }> {
  try {
    const user = await requireUser();
    let keyToValidate = apiKey.trim();

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

/**
 * Update the user's Proxy configuration.
 */
export async function updateProxySettingsAction(
  _prevState: ProxySettingsState,
  formData: FormData
): Promise<ProxySettingsState> {
  try {
    const user = await requireUser();
    const enabledValue = String(formData.get("proxyEnabled") || "").toLowerCase();
    const enabled = enabledValue === "true" || enabledValue === "on" || enabledValue === "1";

    const protocol = parseProxyProtocol(String(formData.get("proxyProtocol") || "http"));
    const host = String(formData.get("proxyHost") || "").trim();
    const rawPort = String(formData.get("proxyPort") || "").trim();
    const port = rawPort ? parseProxyPort(rawPort) : null;
    const username = String(formData.get("proxyUsername") || "").trim();
    const rawPassword = String(formData.get("proxyPassword") || "").trim();

    const bandwidthSaverValue = String(formData.get("proxyBandwidthSaver") || "").toLowerCase();
    const bandwidthSaver = bandwidthSaverValue === "true" || bandwidthSaverValue === "on" || bandwidthSaverValue === "1";

    if (!protocol) throw new Error("Proxy protocol must be HTTP, HTTPS, or SOCKS5.");
    if (enabled && (!host || port === null)) {
      throw new Error("An enabled proxy requires a host and a port from 1 to 65535.");
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { proxyPassword: true }
    });

    let encryptedPassword = existingUser?.proxyPassword ?? null;
    if (rawPassword && !rawPassword.startsWith("•••")) {
      encryptedPassword = encrypt(rawPassword);
    } else if (!rawPassword && rawPassword !== "••••••••") {
      encryptedPassword = null;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        proxyEnabled: enabled,
        proxyProtocol: protocol,
        proxyHost: host || null,
        proxyPort: port,
        proxyUsername: username || null,
        proxyPassword: encryptedPassword,
        proxyBandwidthSaver: bandwidthSaver
      }
    });

    revalidatePath("/settings");
    return { success: true, proxyEnabled: enabled };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to save proxy settings." };
  }
}

/**
 * Server Action to parse a universal proxy string and/or test proxy connectivity.
 */
export async function validateProxyAction(formData: FormData): Promise<ProxyTestResult> {
  try {
    const user = await requireUser();
    const data = {
      rawString: String(formData.get("rawString") || ""),
      protocol: String(formData.get("proxyProtocol") || "http"),
      host: String(formData.get("proxyHost") || ""),
      port: String(formData.get("proxyPort") || ""),
      username: String(formData.get("proxyUsername") || ""),
      password: String(formData.get("proxyPassword") || "")
    };
    let proxy: ParsedProxy | null = null;

    if (data.rawString && data.rawString.trim()) {
      proxy = parseProxyString(data.rawString);
    }

    if (!proxy && data.host && data.port) {
      const portNum = parseProxyPort(data.port);
      const protocol = parseProxyProtocol(data.protocol);
      if (!protocol || portNum === null) {
        return { success: false, message: "Use HTTP, HTTPS, or SOCKS5 and a port from 1 to 65535." };
      }
      let pass = data.password?.trim();

      // If password is masked, fetch decrypted password from DB
      if (pass?.startsWith("•••") || !pass) {
        const existingUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { proxyPassword: true }
        });
        if (existingUser?.proxyPassword) {
          pass = decrypt(existingUser.proxyPassword);
        }
      }

      proxy = {
        protocol,
        host: data.host.trim(),
        port: portNum,
        username: data.username?.trim() || undefined,
        password: pass || undefined
      };
    }

    if (!proxy) {
      return { success: false, message: "Invalid proxy configuration. Host and valid Port are required." };
    }

    return await testProxyConnection(proxy);
  } catch (error: any) {
    return { success: false, message: error?.message || "Failed to validate proxy connection." };
  }
}
