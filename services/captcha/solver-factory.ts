import { CaptchaSolver } from "./captcha-solver";
import { MockSolver } from "./mock-solver";
import { TwoCaptchaSolver } from "./two-captcha-solver";
import { CapSolverSolver } from "./capsolver-solver";
import { AntiCaptchaSolver } from "./anti-captcha-solver";

export class SolverFactory {
  /**
   * Instantiates a CaptchaSolver based on the provider ID and API key.
   */
  static getSolver(providerId: string, apiKey: string): CaptchaSolver {
    const key = apiKey || "";
    const pid = (providerId || "mock").toLowerCase();

    switch (pid) {
      case "mock":
        return new MockSolver(key);

      case "2captcha":
        return new TwoCaptchaSolver(key);

      case "capsolver":
        return new CapSolverSolver(key);

      case "anticaptcha":
        return new AntiCaptchaSolver(key);

      // Providers compatible with 2Captcha API format
      case "rucaptcha":
      case "solvecaptcha":
      case "azcaptcha":
      case "bestcaptchasolver":
      case "capguru":
      case "anycaptcha":
      case "imagetyperz":
      case "captchatronix":
      case "captchasolutions":
      case "deathbycaptcha":
      case "nopecha":
      case "ai4cap":
      case "expertdecoders":
        // For compatibility, return 2Captcha solver. In production, some of these
        // may require custom base URLs which can be overridden in the solver.
        return new TwoCaptchaSolver(key);

      // Providers compatible with Anti-Captcha / CapMonster API format
      case "capmonstercloud":
      case "capmonsterselfhosted":
      case "xevil":
        return new AntiCaptchaSolver(key);

      default:
        // Fallback or custom provider placeholder
        // For other OCR engines, we prompt the user to use 2Captcha/CapSolver,
        // or we default to the Mock solver if no integration is loaded yet.
        return new MockSolver(key);
    }
  }
}
