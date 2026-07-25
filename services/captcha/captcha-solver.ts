export abstract class CaptchaSolver {
  protected apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Validates the provided API key (e.g. checks key format or performs a quick balance check).
   */
  abstract validateKey(): Promise<{ success: boolean; balance?: number; message?: string }>;

  /**
   * Solves Google reCAPTCHA v2 or v3 challenges.
   */
  abstract solveReCaptcha(
    siteKey: string,
    url: string,
    version?: "v2" | "v3",
    action?: string
  ): Promise<{ token: string }>;

  /**
   * Solves hCaptcha challenges.
   */
  abstract solveHCaptcha(siteKey: string, url: string): Promise<{ token: string }>;

  /**
   * Solves Cloudflare Turnstile challenges.
   */
  abstract solveTurnstile(siteKey: string, url: string): Promise<{ token: string }>;

  /**
   * Solves standard image-based (text OCR) CAPTCHA challenges.
   */
  abstract solveImage(base64Image: string): Promise<{ text: string }>;
}
