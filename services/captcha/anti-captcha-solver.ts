import { CaptchaSolver } from "./captcha-solver";

export class AntiCaptchaSolver extends CaptchaSolver {
  async validateKey(): Promise<{ success: boolean; balance?: number; message?: string }> {
    if (!this.apiKey) {
      return { success: false, message: "API key is missing." };
    }
    try {
      const res = await fetch("https://api.anti-captcha.com/getBalance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: this.apiKey })
      });
      if (!res.ok) {
        return { success: false, message: `HTTP Error: ${res.statusText}` };
      }
      const data = await res.json();
      if (data.errorId === 0) {
        return { success: true, balance: data.balance };
      } else {
        return { success: false, message: data.errorDescription || "Invalid clientKey or validation failed." };
      }
    } catch (error: any) {
      return { success: false, message: error.message || "Failed to connect to Anti-Captcha API." };
    }
  }

  async solveReCaptcha(
    siteKey: string,
    url: string,
    version?: "v2" | "v3",
    action?: string
  ): Promise<{ token: string }> {
    const isV3 = version === "v3";
    const taskType = isV3 ? "RecaptchaV3TaskProxyless" : "RecaptchaV2TaskProxyless";
    const task: Record<string, any> = {
      type: taskType,
      websiteURL: url,
      websiteKey: siteKey
    };

    if (isV3 && action) {
      task.pageAction = action;
      task.minScore = 0.3;
    }

    return this.createAndPollTask(task, (solution) => solution.gRecaptchaResponse);
  }

  async solveHCaptcha(siteKey: string, url: string): Promise<{ token: string }> {
    const task = {
      type: "HCaptchaTaskProxyless",
      websiteURL: url,
      websiteKey: siteKey
    };
    return this.createAndPollTask(task, (solution) => solution.gRecaptchaResponse);
  }

  async solveTurnstile(siteKey: string, url: string): Promise<{ token: string }> {
    const task = {
      type: "TurnstileTaskProxyless",
      websiteURL: url,
      websiteKey: siteKey
    };
    return this.createAndPollTask(task, (solution) => solution.token);
  }

  async solveImage(base64Image: string): Promise<{ text: string }> {
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const task = {
      type: "ImageToTextTask",
      body: cleanBase64
    };
    const result = await this.createAndPollTask(task, (solution) => solution.text);
    return { text: result.token };
  }

  private async createAndPollTask(
    task: Record<string, any>,
    extractToken: (solution: any) => string
  ): Promise<{ token: string }> {
    try {
      // 1. Create task
      const createRes = await fetch("https://api.anti-captcha.com/createTask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientKey: this.apiKey,
          task
        })
      });

      if (!createRes.ok) {
        throw new Error(`Create task failed: ${createRes.statusText}`);
      }

      const createData = await createRes.json();
      if (createData.errorId !== 0) {
        throw new Error(createData.errorDescription || "Failed to create task on Anti-Captcha.");
      }

      const taskId = createData.taskId;

      // 2. Poll task result
      const maxAttempts = 30;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const resultRes = await fetch("https://api.anti-captcha.com/getTaskResult", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientKey: this.apiKey,
            taskId
          })
        });

        if (!resultRes.ok) continue;

        const resultData = await resultRes.json();
        if (resultData.errorId !== 0) {
          throw new Error(resultData.errorDescription || "Anti-Captcha task failed during execution.");
        }

        if (resultData.status === "ready" && resultData.solution) {
          return { token: extractToken(resultData.solution) };
        } else if (resultData.status === "processing") {
          continue;
        } else {
          throw new Error(`Unexpected status: ${resultData.status}`);
        }
      }

      throw new Error("Anti-Captcha solving request timed out.");
    } catch (error: any) {
      throw new Error(`[Anti-Captcha Error] ${error.message}`);
    }
  }
}
