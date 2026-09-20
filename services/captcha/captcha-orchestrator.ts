import type { Page } from "playwright";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { SolverFactory } from "./solver-factory";
import { isAuthorizedCaptchaTestTarget } from "./test-environment";
import { detectCaptchaChallenge } from "./captcha-detector";
import { applyCaptchaSolutionToPage } from "./controlled-page-adapter";
import type {
  CaptchaOrchestratorOptions,
  CaptchaSolveResult,
  CaptchaTaskContext,
  DetectedCaptchaChallenge
} from "./captcha-types";

// In-memory active task registry to ensure each task belongs to exactly one target
const activeTasksByTarget = new Map<string, CaptchaTaskContext>();

/**
 * Orchestrates the full lifecycle of CAPTCHA solving on authorized test targets:
 * CAPTCHA_DETECTED
 *  → create provider task
 *  → store task ID for current target
 *  → bounded polling
 *  → receive provider result
 *  → validate result
 *  → pass result through controlled test-page adapter
 *  → record history
 *  → return result
 */
export async function handleCaptchaSolvingForTarget(
  options: CaptchaOrchestratorOptions
): Promise<CaptchaSolveResult> {
  const { page, websiteUrl, userId, targetId, timeoutMs = 30000, forceTestMode } = options;
  const startedAt = new Date();
  const targetKey = targetId || websiteUrl;

  // 1. Resolve user settings & credentials server-side
  let providerId = options.preferredProvider || "mock";
  let apiKey = options.apiKey || "";
  let userCaptchaEnabled = false;

  if (userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          captchaEnabled: true,
          captchaProvider: true,
          captchaApiKey: true
        }
      });

      if (user) {
        userCaptchaEnabled = Boolean(user.captchaEnabled);
        if (!options.preferredProvider && user.captchaProvider) {
          providerId = user.captchaProvider;
        }
        if (!apiKey && user.captchaApiKey) {
          apiKey = decrypt(user.captchaApiKey);
        }
      }
    } catch (err: any) {
      console.warn(`[CaptchaOrchestrator] Failed to fetch user CAPTCHA settings: ${err.message}`);
    }
  }

  // 2. Authorization check: Either user enabled CAPTCHA solving in settings, or target is authorized test environment, or forceTestMode is set
  const isAuthorized = forceTestMode || userCaptchaEnabled || isAuthorizedCaptchaTestTarget(websiteUrl);
  if (!isAuthorized) {
    console.warn(
      `[CaptchaOrchestrator] CAPTCHA solving is disabled in user settings, and ${websiteUrl} is not an authorized test environment.`
    );
    return {
      state: "UNAUTHORIZED",
      solved: false,
      reason: `CAPTCHA solving is disabled in user settings, and ${websiteUrl} is not an authorized test environment. Manual verification required.`
    };
  }

  // 3. Detect CAPTCHA challenge
  const challenge = await detectCaptchaChallenge(page, websiteUrl);
  if (!challenge) {
    return {
      state: "NONE",
      solved: false,
      reason: "No active CAPTCHA challenge detected on page."
    };
  }

  console.log(
    `[CaptchaOrchestrator] CAPTCHA detected on target ${websiteUrl}: Type=${challenge.type}, SiteKey=${challenge.siteKey}, Provider=${providerId}`
  );

  // If no API key provided and not mock, check fallback
  if (!apiKey && providerId !== "mock") {
    // For test simulation, fallback to mock if key is missing
    console.warn(`[CaptchaOrchestrator] Missing API key for ${providerId}, falling back to MockSolver.`);
    providerId = "mock";
    apiKey = "test-mock-key";
  }

  // 4. Instantiate solver via SolverFactory
  const solver = SolverFactory.getSolver(providerId, apiKey);

  // 5. Initialize target-isolated task context
  let currentTaskId: string | undefined;
  const taskContext: CaptchaTaskContext = {
    providerId,
    challengeType: challenge.type,
    siteKey: challenge.siteKey,
    pageUrl: challenge.pageUrl,
    targetId: targetKey,
    userId,
    state: "TASK_CREATED",
    startedAt
  };
  activeTasksByTarget.set(targetKey, taskContext);

  try {
    taskContext.state = "WAITING_FOR_RESULT";

    // Bounded timeout
    const boundedTimeoutMs = Math.max(1000, Math.min(timeoutMs, 120000));
    const solveOptions = {
      timeoutMs: boundedTimeoutMs,
      onTaskCreated: (taskId: string) => {
        currentTaskId = taskId;
        taskContext.taskId = taskId;
        console.log(`[CaptchaOrchestrator] Provider task created for target ${targetKey}: TaskID=${taskId}`);
      }
    };

    // 6. Execute solve based on challenge type
    let token = "";
    if (challenge.type === "recaptcha_v2" || challenge.type === "recaptcha_v3") {
      const res = await solver.solveReCaptcha(
        challenge.siteKey,
        challenge.pageUrl,
        challenge.type === "recaptcha_v3" ? "v3" : "v2",
        challenge.action,
        solveOptions
      );
      token = res.token;
      if (res.taskId) currentTaskId = res.taskId;
    } else if (challenge.type === "hcaptcha") {
      const res = await solver.solveHCaptcha(challenge.siteKey, challenge.pageUrl, solveOptions);
      token = res.token;
      if (res.taskId) currentTaskId = res.taskId;
    } else if (challenge.type === "turnstile") {
      const res = await solver.solveTurnstile(challenge.siteKey, challenge.pageUrl, solveOptions);
      token = res.token;
      if (res.taskId) currentTaskId = res.taskId;
    } else if (challenge.type === "image" && challenge.base64Image) {
      const res = await solver.solveImage(challenge.base64Image, solveOptions);
      token = res.text;
      if (res.taskId) currentTaskId = res.taskId;
    } else {
      throw new Error(`Unsupported challenge type: ${challenge.type}`);
    }

    // 7. Validate solution
    if (!token || typeof token !== "string" || token.trim().length === 0) {
      throw new Error("Received empty or invalid solution token from provider.");
    }

    taskContext.state = "SOLVED";
    taskContext.token = token;

    // 8. Pass through controlled test-page adapter
    const adapterResult = await applyCaptchaSolutionToPage(page, challenge, { token });
    taskContext.state = "APPLIED";
    taskContext.completedAt = new Date();
    taskContext.durationMs = taskContext.completedAt.getTime() - startedAt.getTime();

    // 9. Record history in Prisma if userId present
    if (userId) {
      try {
        await prisma.captchaSolveHistory.create({
          data: {
            userId,
            provider: providerId,
            captchaType: challenge.type,
            status: "Success",
            durationMs: taskContext.durationMs,
            errorMessage: null
          }
        });
      } catch (dbErr: any) {
        console.warn(`[CaptchaOrchestrator] Failed to persist solve history: ${dbErr.message}`);
      }
    }

    console.log(
      `[CaptchaOrchestrator] Successfully solved and applied CAPTCHA for ${targetKey} in ${taskContext.durationMs}ms.`
    );

    return {
      state: "APPLIED",
      solved: true,
      token,
      taskId: currentTaskId,
      provider: providerId,
      durationMs: taskContext.durationMs,
      appliedDetails: adapterResult.details
    };
  } catch (error: any) {
    const durationMs = Date.now() - startedAt.getTime();
    const isTimeout = /timed out|timeout/i.test(error.message);
    taskContext.state = isTimeout ? "TIMEOUT" : "FAILED";
    taskContext.errorMessage = error.message;
    taskContext.durationMs = durationMs;

    // Record failure in history
    if (userId) {
      try {
        await prisma.captchaSolveHistory.create({
          data: {
            userId,
            provider: providerId,
            captchaType: challenge.type,
            status: isTimeout ? "Timeout" : "Failed",
            durationMs,
            errorMessage: error.message
          }
        });
      } catch {}
    }

    console.warn(`[CaptchaOrchestrator] CAPTCHA solving failed for ${targetKey}: ${error.message}`);

    return {
      state: taskContext.state,
      solved: false,
      taskId: currentTaskId,
      provider: providerId,
      durationMs,
      errorMessage: error.message
    };
  } finally {
    activeTasksByTarget.delete(targetKey);
  }
}

/**
 * Returns the currently active CAPTCHA task for a given target, if any.
 */
export function getActiveCaptchaTask(targetKey: string): CaptchaTaskContext | undefined {
  return activeTasksByTarget.get(targetKey);
}
