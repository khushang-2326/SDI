import { chromium } from "playwright";
import type { ParsedProxy, ProxyTestResult } from "./types";
import { getChromiumExecutablePath } from "@/services/browser-executable";

/**
 * Tests a proxy through an actual Chromium page. This deliberately mirrors
 * the network path used by the automation runner rather than only testing a
 * lightweight HTTP client.
 */
export async function testProxyConnection(proxy: ParsedProxy, timeoutMs = 15000): Promise<ProxyTestResult> {
  const startTime = Date.now();
  const server = `${proxy.protocol}://${proxy.host}:${proxy.port}`;
  
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    const executablePath = await getChromiumExecutablePath();
    browser = await chromium.launch({
      headless: true,
      executablePath: executablePath || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
    });
    const context = await browser.newContext({
      proxy: {
        server,
        username: proxy.username,
        password: proxy.password
      },
      ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    // Load the same kind of external page that the automation loads, then
    // collect proxy metadata. The fallback still proves browser traffic works
    // when a provider blocks the HTTP geolocation endpoint.
    const response = await page.goto("http://ip-api.com/json/?fields=status,message,country,city,isp,query", {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });
    const latencyMs = Date.now() - startTime;
    const responseText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    const data = responseText ? JSON.parse(responseText) as Record<string, unknown> : null;

    if (!response?.ok() || data?.status === "fail") {
      const fallbackResponse = await page.goto("https://api.ipify.org?format=json", {
        waitUntil: "domcontentloaded",
        timeout: Math.min(timeoutMs, 10000)
      });
      const fallbackText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
      if (fallbackResponse?.ok() && fallbackText) {
        const fallbackData = JSON.parse(fallbackText) as { ip?: string };
        return {
          success: true,
          ip: fallbackData.ip,
          latencyMs,
          message: `Chromium connected via proxy (${fallbackData.ip || "unknown IP"})`
        };
      }
      throw new Error(data?.message as string || `Proxy browser test returned HTTP ${response?.status() || "no response"}`);
    }

    return {
      success: true,
      ip: String(data?.query || ""),
      country: String(data?.country || ""),
      city: String(data?.city || ""),
      isp: String(data?.isp || ""),
      latencyMs,
      message: `Chromium connected: ${String(data?.country || "Unknown")} (${String(data?.city || "")}) • ISP: ${String(data?.isp || "Unknown")}`
    };
  } catch (error: any) {
    const errorMsg = error?.message || "Connection timed out or proxy refused connection.";
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      message: errorMsg.includes("net::ERR")
        ? `Network error: ${errorMsg}`
        : `Proxy test failed: ${errorMsg}`
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
