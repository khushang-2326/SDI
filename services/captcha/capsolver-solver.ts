import { CaptchaSolver, type CaptchaSolveOptions } from "./captcha-solver";

export class CapSolverSolver extends CaptchaSolver {
  async validateKey(): Promise<{ success: boolean; balance?: number; message?: string }> {
    if (!this.apiKey) {
      return { success: false, message: "API key is missing." };
    }
    try {
      const res = await fetch("https://api.capsolver.com/getBalance", {
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
      return { success: false, message: error.message || "Failed to connect to CapSolver API." };
    }
  }

  async solveReCaptcha(
    siteKey: string,
    url: string,
    version?: "v2" | "v3",
    action?: string,
    options?: CaptchaSolveOptions
  ): Promise<{ token: string; taskId?: string }> {
    const isV3 = version === "v3";
    const taskType = isV3 ? "ReCaptchaV3TaskProxyLess" : "ReCaptchaV2TaskProxyLess";
    const task: Record<string, any> = {
      type: taskType,
      websiteURL: url,
      websiteKey: siteKey
    };

    if (isV3 && action) {
      task.pageAction = action;
      task.minScore = 0.3;
    }

    return this.createAndPollTask(task, (solution) => solution.gRecaptchaResponse, options);
  }

  async solveHCaptcha(
    siteKey: string,
    url: string,
    options?: CaptchaSolveOptions
  ): Promise<{ token: string; taskId?: string }> {
    const task = {
      type: "HCaptchaTaskProxyLess",
      websiteURL: url,
      websiteKey: siteKey
    };
    return this.createAndPollTask(task, (solution) => solution.gRecaptchaResponse, options);
  }

  async solveTurnstile(
    siteKey: string,
    url: string,
    options?: CaptchaSolveOptions
  ): Promise<{ token: string; taskId?: string }> {
    const task = {
      type: "AntiTurnstileTaskProxyLess",
      websiteURL: url,
      websiteKey: siteKey
    };
    return this.createAndPollTask(task, (solution) => solution.token, options);
  }

  async solveImage(
    base64Image: string,
    options?: CaptchaSolveOptions
  ): Promise<{ text: string; taskId?: string }> {
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const task = {
      type: "ImageToTextTask",
      body: cleanBase64
    };
    const result = await this.createAndPollTask(task, (solution) => solution.text, options);
    return { text: result.token, taskId: result.taskId };
  }

  private async createAndPollTask(
    task: Record<string, any>,
    extractToken: (solution: any) => string,
    options?: CaptchaSolveOptions
  ): Promise<{ token: string; taskId?: string }> {
    try {
      if (options?.abortSignal?.aborted) {
        throw new Error("CapSolver operation aborted before start.");
      }

      // 1. Create task
      const createRes = await fetch("https://api.capsolver.com/createTask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientKey: this.apiKey,
          task
        }),
        signal: options?.abortSignal
      });

      if (!createRes.ok) {
        throw new Error(`Create task failed: ${createRes.statusText}`);
      }

      const createData = await createRes.json();
      if (createData.errorId !== 0) {
        throw new Error(createData.errorDescription || "Failed to create task on CapSolver.");
      }

      const taskId = String(createData.taskId || "");
      if (taskId && options?.onTaskCreated) {
        try {
          options.onTaskCreated(taskId);
        } catch {}
      }

      // If already ready
      if (createData.status === "ready" && createData.solution) {
        return { token: extractToken(createData.solution), taskId };
      }

      // 2. Poll task result with bounded timeout
      const timeoutMs = options?.timeoutMs || 150000;
      const intervalMs = 3000;
      const maxAttempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (options?.abortSignal?.aborted) {
          throw new Error("CapSolver polling cancelled.");
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));

        if (options?.abortSignal?.aborted) {
          throw new Error("CapSolver polling cancelled.");
        }

        const resultRes = await fetch("https://api.capsolver.com/getTaskResult", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientKey: this.apiKey,
            taskId
          }),
          signal: options?.abortSignal
        });

        if (!resultRes.ok) continue;

        const resultData = await resultRes.json();
        if (resultData.errorId !== 0) {
          throw new Error(resultData.errorDescription || "CapSolver task failed during execution.");
        }

        if (resultData.status === "ready" && resultData.solution) {
          return { token: extractToken(resultData.solution), taskId };
        } else if (resultData.status === "processing") {
          continue;
        } else {
          throw new Error(`Unexpected status: ${resultData.status}`);
        }
      }

      throw new Error(`CapSolver solving request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    } catch (error: any) {
      throw new Error(`[CapSolver Error] ${error.message}`);
    }
  }
}
