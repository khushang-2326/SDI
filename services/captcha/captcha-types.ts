export type CaptchaChallengeType =
  | "recaptcha_v2"
  | "recaptcha_v3"
  | "hcaptcha"
  | "turnstile"
  | "image"
  | "unsupported";

export type CaptchaSolveState =
  | "NONE"
  | "DETECTED"
  | "TASK_CREATED"
  | "WAITING_FOR_RESULT"
  | "SOLVED"
  | "APPLIED"
  | "FAILED"
  | "TIMEOUT"
  | "UNAUTHORIZED";

export interface DetectedCaptchaChallenge {
  type: CaptchaChallengeType;
  siteKey: string;
  pageUrl: string;
  action?: string;
  callbackName?: string;
  selector?: string;
  responseSelector?: string;
  base64Image?: string;
  confidence: number;
}

export interface CaptchaTaskContext {
  taskId?: string;
  providerId: string;
  challengeType: CaptchaChallengeType;
  siteKey: string;
  pageUrl: string;
  targetId?: string;
  userId?: string;
  state: CaptchaSolveState;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  token?: string;
  errorMessage?: string;
}

export interface CaptchaSolveResult {
  state: CaptchaSolveState;
  solved: boolean;
  token?: string;
  taskId?: string;
  provider?: string;
  durationMs?: number;
  reason?: string;
  errorMessage?: string;
  appliedDetails?: string;
}

export interface CaptchaOrchestratorOptions {
  page: any; // Playwright Page
  websiteUrl: string;
  userId?: string;
  targetId?: string;
  timeoutMs?: number;
  preferredProvider?: string;
  apiKey?: string;
  forceTestMode?: boolean;
}
