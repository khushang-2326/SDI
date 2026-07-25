import { CaptchaSolver } from "./captcha-solver";

export class MockSolver extends CaptchaSolver {
  async validateKey(): Promise<{ success: boolean; balance?: number; message?: string }> {
    if (!this.apiKey || this.apiKey.trim() === "") {
      return { success: false, message: "API key is required." };
    }
    return { success: true, balance: 10.0, message: "Connection successful (Simulation Mode)." };
  }

  async solveReCaptcha(
    siteKey: string,
    url: string,
    version?: "v2" | "v3",
    action?: string
  ): Promise<{ token: string }> {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return { token: `mock-g-recaptcha-response-token-for-${siteKey}-${version || "v2"}` };
  }

  async solveHCaptcha(siteKey: string, url: string): Promise<{ token: string }> {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return { token: `mock-h-captcha-response-token-for-${siteKey}` };
  }

  async solveTurnstile(siteKey: string, url: string): Promise<{ token: string }> {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return { token: `mock-cf-turnstile-response-token-for-${siteKey}` };
  }

  async solveImage(base64Image: string): Promise<{ text: string }> {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return { text: "MOCK123" };
  }
}
