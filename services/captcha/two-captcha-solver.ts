import { CaptchaSolver, type CaptchaSolveOptions } from "./captcha-solver";

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
    action?: string,
    options?: CaptchaSolveOptions
  ): Promise<{ token: string; taskId?: string }> {
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

    return this.pollResult(params, options);
  }

  async solveHCaptcha(
    siteKey: string,
    url: string,
    options?: CaptchaSolveOptions
  ): Promise<{ token: string; taskId?: string }> {
    const params = {
      key: this.apiKey,
      method: "hcaptcha",
      sitekey: siteKey,
      pageurl: url,
      json: "1"
    };
    return this.pollResult(params, options);
  }

  async solveTurnstile(
    siteKey: string,
    url: string,
    options?: CaptchaSolveOptions
  ): Promise<{ token: string; taskId?: string }> {
    const params = {
      key: this.apiKey,
      method: "turnstile",
      sitekey: siteKey,
      pageurl: url,
      json: "1"
    };
    return this.pollResult(params, options);
  }

  async solveImage(
    base64Image: string,
    options?: CaptchaSolveOptions
  ): Promise<{ text: string; taskId?: string }> {
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const params = {
      key: this.apiKey,
      method: "base64",
      body: cleanBase64,
      json: "1"
    };
    const result = await this.pollResult(params, options);
    return { text: result.token, taskId: result.taskId };
  }

  private async pollResult(
    params: Record<string, string>,
    options?: CaptchaSolveOptions
  ): Promise<{ token: string; taskId?: string }> {
    try {
      if (options?.abortSignal?.aborted) {
        throw new Error("CAPTCHA solving operation aborted before start.");
      }

      // 1. Submit the captcha task
      const bodyParams = new URLSearchParams(params);
      const submitRes = await fetch("https://2captcha.com/in.php", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: bodyParams.toString(),
        signal: options?.abortSignal
      });

      if (!submitRes.ok) {
        throw new Error(`Submit task failed: ${submitRes.statusText}`);
      }

      const submitData = await submitRes.json();
      if (submitData.status !== 1) {
        throw new Error(submitData.request || "Failed to submit captcha task to 2Captcha.");
      }

      const taskId = String(submitData.request);
      if (options?.onTaskCreated) {
        try {
          options.onTaskCreated(taskId);
        } catch {}
      }

      // 2. Poll the result with bounded attempts
      const timeoutMs = options?.timeoutMs || 120000;
      const intervalMs = 4000;
      const maxAttempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));

      // Wait 6 seconds initially before first poll
      await new Promise((resolve) => setTimeout(resolve, 6000));

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }

        if (options?.abortSignal?.aborted) {
          throw new Error("CAPTCHA solving polling cancelled.");
        }

        const checkRes = await fetch(
          `https://2captcha.com/res.php?key=${encodeURIComponent(
            this.apiKey
          )}&action=get&id=${encodeURIComponent(taskId)}&json=1`,
          { signal: options?.abortSignal }
        );

        if (!checkRes.ok) continue;

        const checkData = await checkRes.json();
        if (checkData.status === 1) {
          return { token: checkData.request, taskId };
        } else if (checkData.request === "CAPCHA_NOT_READY") {
          continue;
        } else {
          throw new Error(checkData.request || "CAPTCHA solving failed.");
        }
      }

      throw new Error(`CAPTCHA solving request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    } catch (error: any) {
      throw new Error(`[2Captcha Error] ${error.message}`);
    }
  }
}
