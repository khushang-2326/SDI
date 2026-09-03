import { request } from "playwright";
import type { ParsedProxy, ProxyTestResult } from "./types";

/**
 * Tests a proxy connection using Playwright's built-in request context.
 * Measures latency and detects public IP, country, and ISP.
 */
export async function testProxyConnection(proxy: ParsedProxy, timeoutMs = 15000): Promise<ProxyTestResult> {
  const startTime = Date.now();
  const server = `${proxy.protocol}://${proxy.host}:${proxy.port}`;
  
  let requestContext = null;
  try {
    requestContext = await request.newContext({
      proxy: {
        server,
        username: proxy.username,
        password: proxy.password
      },
      timeout: timeoutMs,
      ignoreHTTPSErrors: true
    });

    // Step 1: Query an IP detection service through the proxy
    // We try ip-api.com or ipwho.is or httpbin
    const response = await requestContext.get("http://ip-api.com/json/?fields=status,message,country,city,isp,query", {
      timeout: timeoutMs
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok()) {
      // Fallback to basic ip check
      const fallbackResp = await requestContext.get("https://api.ipify.org?format=json", {
        timeout: 10000
      });
      if (fallbackResp.ok()) {
        const data = await fallbackResp.json();
        return {
          success: true,
          ip: data.ip,
          latencyMs,
          message: `Connected via proxy (${data.ip})`
        };
      }
      throw new Error(`Proxy responded with HTTP ${response.status()}`);
    }

    const data = await response.json();
    if (data.status === "fail") {
      throw new Error(data.message || "Failed to retrieve IP geolocation.");
    }

    return {
      success: true,
      ip: data.query,
      country: data.country,
      city: data.city,
      isp: data.isp,
      latencyMs,
      message: `Connected: ${data.country || "Unknown Country"} (${data.city || ""}) • ISP: ${data.isp || "Unknown"}`
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
    if (requestContext) {
      await requestContext.dispose().catch(() => undefined);
    }
  }
}
