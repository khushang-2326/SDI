import { CaptchaSolver, type CaptchaSolveOptions } from "./captcha-solver";

export interface MockSolverBehavior {
  delayMs?: number;
  shouldFail?: boolean;
  failReason?: string;
  shouldTimeout?: boolean;
  validateKeySuccess?: boolean;
  validateKeyBalance?: number;
  validateKeyMessage?: string;
}

export class MockSolver extends CaptchaSolver {
  private static defaultBehavior: MockSolverBehavior = {
    delayMs: 100,
    shouldFail: false,
    failReason: "Mock solver simulated provider failure.",
    shouldTimeout: false,
    validateKeySuccess: true,
    validateKeyBalance: 10.0,
    validateKeyMessage: "Connection successful (Simulation Mode)."
  };

  private static taskCounter = 0;
  private behavior: MockSolverBehavior;

  constructor(apiKey: string) {
    super(apiKey);
    this.behavior = { ...MockSolver.defaultBehavior };
  }

  /**
   * Sets default behavior for all newly created MockSolver instances.
   */
  static setDefaultBehavior(behavior: Partial<MockSolverBehavior>): void {
    MockSolver.defaultBehavior = { ...MockSolver.defaultBehavior, ...behavior };
  }

  /**
   * Resets default behavior to standard simulation mode.
   */
  static resetDefaultBehavior(): void {
    MockSolver.defaultBehavior = {
      delayMs: 100,
      shouldFail: false,
      failReason: "Mock solver simulated provider failure.",
      shouldTimeout: false,
      validateKeySuccess: true,
      validateKeyBalance: 10.0,
      validateKeyMessage: "Connection successful (Simulation Mode)."
    };
  }

  /**
   * Configures behavior for this specific instance.
   */
  setMockBehavior(behavior: Partial<MockSolverBehavior>): void {
    this.behavior = { ...this.behavior, ...behavior };
  }

  private generateTaskId(): string {
    MockSolver.taskCounter++;
    return `mock-task-${Date.now()}-${MockSolver.taskCounter}`;
  }

  private async executeSimulatedSolve(
    generateToken: () => string,
    options?: CaptchaSolveOptions
  ): Promise<{ token: string; taskId: string }> {
    const taskId = this.generateTaskId();
    if (options?.onTaskCreated) {
      try {
        options.onTaskCreated(taskId);
      } catch {}
    }

    const delay = this.behavior.delayMs ?? 100;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (options?.abortSignal?.aborted) {
      throw new Error("CAPTCHA solving operation was aborted.");
    }

    if (this.behavior.shouldTimeout) {
      const timeoutWait = (options?.timeoutMs || 2000) + 500;
      await new Promise((resolve) => setTimeout(resolve, timeoutWait));
      throw new Error("CAPTCHA solving request timed out.");
    }

    if (this.behavior.shouldFail) {
      throw new Error(this.behavior.failReason || "Mock solver simulated failure.");
    }

    return { token: generateToken(), taskId };
  }

  async validateKey(): Promise<{ success: boolean; balance?: number; message?: string }> {
    if (!this.apiKey || this.apiKey.trim() === "") {
      return { success: false, message: "API key is required." };
    }
    if (this.behavior.validateKeySuccess === false) {
      return {
        success: false,
        message: this.behavior.validateKeyMessage || "Mock API key validation failed."
      };
    }
    return {
      success: true,
      balance: this.behavior.validateKeyBalance ?? 10.0,
      message: this.behavior.validateKeyMessage || "Connection successful (Simulation Mode)."
    };
  }

  async solveReCaptcha(
    siteKey: string,
    url: string,
    version?: "v2" | "v3",
    action?: string,
    options?: CaptchaSolveOptions
  ): Promise<{ token: string; taskId?: string }> {
    return this.executeSimulatedSolve(
      () => `mock-g-recaptcha-response-token-for-${siteKey}-${version || "v2"}`,
      options
    );
  }

  async solveHCaptcha(
    siteKey: string,
    url: string,
    options?: CaptchaSolveOptions
  ): Promise<{ token: string; taskId?: string }> {
    return this.executeSimulatedSolve(
      () => `mock-h-captcha-response-token-for-${siteKey}`,
      options
    );
  }

  async solveTurnstile(
    siteKey: string,
    url: string,
    options?: CaptchaSolveOptions
  ): Promise<{ token: string; taskId?: string }> {
    return this.executeSimulatedSolve(
      () => `mock-cf-turnstile-response-token-for-${siteKey}`,
      options
    );
  }

  async solveImage(
    base64Image: string,
    options?: CaptchaSolveOptions
  ): Promise<{ text: string; taskId?: string }> {
    const result = await this.executeSimulatedSolve(() => "MOCK123", options);
    return { text: result.token, taskId: result.taskId };
  }
}
