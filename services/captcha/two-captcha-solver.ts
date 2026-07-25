import { CaptchaSolver } from "./captcha-solver";

export class TwoCaptchaSolver extends CaptchaSolver {
  async validateKey(): Promise<{ success: boolean; balance?: number; message?: string }> {
    if (!this.apiKey) {
      return { success: false, message: "API key is missing." };
    }
    try {
      const res = await fetch(
        `https://2captcha.com/res.php?key=${encodeURIComponent(
          this.apiKey
        )}&action=getbalance&json=1`
      );
      if (!res.ok) {
        return { success: false, message: `HTTP Error: ${res.statusText}` };
      }
      const data = await res.json();
      if (data.status === 1) {
        return { success: true, balance: parseFloat(data.request) };
      } else {
        return { success: false, message: data.request || "Invalid API key or balance request failed." };
      }
    } catch (error: any) {
      return { success: false, message: error.message || "Failed to connect to 2Captcha API." };
    }
  }

  async solveReCaptcha(
    siteKey: string,
    url: string,
    version?: "v2" | "v3",
    action?: string
  ): Promise<{ token: string }> {
    const params: Record<string, string> = {
      key: this.apiKey,
      method: "userrecaptcha",
      googlekey: siteKey,
      pageurl: url,
      json: "1"
    };

    if (version === "v3") {
      params.version = "v3";
      params.min_score = "0.3";
      if (action) params.action = action;
    }

    return this.pollResult(params);
  }

  async solveHCaptcha(siteKey: string, url: string): Promise<{ token: string }> {
    const params = {
      key: this.apiKey,
      method: "hcaptcha",
      sitekey: siteKey,
      pageurl: url,
      json: "1"
    };
    return this.pollResult(params);
  }

  async solveTurnstile(siteKey: string, url: string): Promise<{ token: string }> {
    const params = {
      key: this.apiKey,
      method: "turnstile",
      sitekey: siteKey,
      pageurl: url,
      json: "1"
    };
    return this.pollResult(params);
  }

  async solveImage(base64Image: string): Promise<{ text: string }> {
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const params = {
      key: this.apiKey,
      method: "base64",
      body: cleanBase64,
      json: "1"
    };
    const result = await this.pollResult(params);
    return { text: result.token };
  }

  private async pollResult(params: Record<string, string>): Promise<{ token: string }> {
    try {
      // 1. Submit the captcha task
      const bodyParams = new URLSearchParams(params);
      const submitRes = await fetch("https://2captcha.com/in.php", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: bodyParams.toString()
      });

      if (!submitRes.ok) {
        throw new Error(`Submit task failed: ${submitRes.statusText}`);
      }

      const submitData = await submitRes.json();
      if (submitData.status !== 1) {
        throw new Error(submitData.request || "Failed to submit captcha task to 2Captcha.");
      }

      const taskId = submitData.request;

      // 2. Poll the result
      const maxAttempts = 30; // 30 attempts, 5s delay = 150s max timeout
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));

        const checkRes = await fetch(
          `https://2captcha.com/res.php?key=${encodeURIComponent(
            this.apiKey
          )}&action=get&id=${encodeURIComponent(taskId)}&json=1`
        );

        if (!checkRes.ok) continue;

        const checkData = await checkRes.json();
        if (checkData.status === 1) {
          return { token: checkData.request };
        } else if (checkData.request === "CAPCHA_NOT_READY") {
          continue;
        } else {
          throw new Error(checkData.request || "CAPTCHA solving failed.");
        }
      }

      throw new Error("CAPTCHA solving request timed out.");
    } catch (error: any) {
      throw new Error(`[2Captcha Error] ${error.message}`);
    }
  }
}
