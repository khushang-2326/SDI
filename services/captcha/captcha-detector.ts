import type { Page } from "playwright";
import type { DetectedCaptchaChallenge } from "./captcha-types";

/**
 * Inspects a Playwright Page to detect active CAPTCHA challenges and extract
 * required parameters (challenge type, sitekey, action, callbacks).
 */
export async function detectCaptchaChallenge(
  page: Page,
  websiteUrl: string
): Promise<DetectedCaptchaChallenge | null> {
  try {
    const pageUrl = page.url() || websiteUrl;

    // 1. Check for reCAPTCHA (v2 / v3 / Enterprise)
    // Check interactive containers first
    const recaptchaContainers = await page.locator(".g-recaptcha, [data-sitekey][class*='recaptcha' i]").all();
    for (const container of recaptchaContainers) {
      const siteKey = (await container.getAttribute("data-sitekey")) || "";
      const size = (await container.getAttribute("data-size")) || "";
      const action = (await container.getAttribute("data-action")) || undefined;
      const callbackName = (await container.getAttribute("data-callback")) || undefined;

      if (siteKey) {
        const isV3 = size === "invisible" || Boolean(action);
        return {
          type: isV3 ? "recaptcha_v3" : "recaptcha_v2",
          siteKey,
          pageUrl,
          action,
          callbackName,
          selector: ".g-recaptcha",
          responseSelector: 'textarea[name="g-recaptcha-response"]',
          confidence: 0.98
        };
      }
    }

    // Check reCAPTCHA iframes
    const recaptchaIframes = await page.locator(
      "iframe[src*='google.com/recaptcha'], iframe[src*='recaptcha.net'], iframe[src*='recaptcha']"
    ).all();

    for (const iframe of recaptchaIframes) {
      const src = (await iframe.getAttribute("src")) || "";
      if (src.includes("api2/aframe") || src.includes("size=invisible")) continue;

      try {
        const parsedUrl = new URL(src);
        const siteKey = parsedUrl.searchParams.get("k") || parsedUrl.searchParams.get("sitekey");
        const action = parsedUrl.searchParams.get("sa") || undefined;
        if (siteKey) {
          return {
            type: "recaptcha_v2",
            siteKey,
            pageUrl,
            action,
            selector: "iframe[src*='recaptcha']",
            responseSelector: 'textarea[name="g-recaptcha-response"]',
            confidence: 0.95
          };
        }
      } catch {
        // invalid iframe src URL format
      }
    }

    // 2. Check for hCaptcha
    const hcaptchaContainers = await page.locator(".h-captcha, [data-sitekey][class*='hcaptcha' i]").all();
    for (const container of hcaptchaContainers) {
      const siteKey = (await container.getAttribute("data-sitekey")) || "";
      const callbackName = (await container.getAttribute("data-callback")) || undefined;
      if (siteKey) {
        return {
          type: "hcaptcha",
          siteKey,
          pageUrl,
          callbackName,
          selector: ".h-captcha",
          responseSelector: 'textarea[name="h-captcha-response"]',
          confidence: 0.98
        };
      }
    }

    const hcaptchaIframes = await page.locator("iframe[src*='hcaptcha'], iframe[src*='hcaptcha.com']").all();
    for (const iframe of hcaptchaIframes) {
      const src = (await iframe.getAttribute("src")) || "";
      try {
        const parsedUrl = new URL(src);
        const siteKey = parsedUrl.searchParams.get("sitekey") || parsedUrl.searchParams.get("k");
        if (siteKey) {
          return {
            type: "hcaptcha",
            siteKey,
            pageUrl,
            selector: "iframe[src*='hcaptcha']",
            responseSelector: 'textarea[name="h-captcha-response"]',
            confidence: 0.95
          };
        }
      } catch {
        // invalid URL
      }
    }

    // 3. Check for Cloudflare Turnstile
    const turnstileContainers = await page.locator(".cf-turnstile, [data-sitekey][class*='turnstile' i]").all();
    for (const container of turnstileContainers) {
      const siteKey = (await container.getAttribute("data-sitekey")) || "";
      const callbackName = (await container.getAttribute("data-callback")) || undefined;
      const action = (await container.getAttribute("data-action")) || undefined;
      if (siteKey) {
        return {
          type: "turnstile",
          siteKey,
          pageUrl,
          action,
          callbackName,
          selector: ".cf-turnstile",
          responseSelector: 'input[name="cf-turnstile-response"]',
          confidence: 0.98
        };
      }
    }

    const turnstileIframes = await page.locator("iframe[src*='challenges.cloudflare.com']").all();
    for (const iframe of turnstileIframes) {
      const src = (await iframe.getAttribute("src")) || "";
      try {
        const parsedUrl = new URL(src);
        const siteKey = parsedUrl.searchParams.get("key") || parsedUrl.searchParams.get("k");
        if (siteKey) {
          return {
            type: "turnstile",
            siteKey,
            pageUrl,
            selector: "iframe[src*='challenges.cloudflare.com']",
            responseSelector: 'input[name="cf-turnstile-response"]',
            confidence: 0.95
          };
        }
      } catch {
        // invalid URL
      }
    }

    // 4. Generic data-sitekey container fallback
    const genericSitekeyElements = await page.locator("[data-sitekey]").all();
    for (const el of genericSitekeyElements) {
      const siteKey = (await el.getAttribute("data-sitekey")) || "";
      const className = (await el.getAttribute("class")) || "";
      const callbackName = (await el.getAttribute("data-callback")) || undefined;

      if (siteKey) {
        let type: "recaptcha_v2" | "hcaptcha" | "turnstile" = "recaptcha_v2";
        if (className.includes("h-captcha") || className.includes("hcaptcha")) {
          type = "hcaptcha";
        } else if (className.includes("turnstile") || className.includes("cf-")) {
          type = "turnstile";
        }
        return {
          type,
          siteKey,
          pageUrl,
          callbackName,
          selector: "[data-sitekey]",
          confidence: 0.90
        };
      }
    }

    // 5. Image / OCR Captcha
    const imageCaptcha = page.locator("img[src*='captcha' i], img[id*='captcha' i], #captcha-image, .captcha-img").first();
    if (await imageCaptcha.count().then(c => c > 0).catch(() => false)) {
      const screenshotBuffer = await imageCaptcha.screenshot().catch(() => null);
      if (screenshotBuffer) {
        const base64Image = `data:image/png;base64,${screenshotBuffer.toString("base64")}`;
        return {
          type: "image",
          siteKey: "image-ocr",
          pageUrl,
          base64Image,
          selector: "img[src*='captcha' i]",
          responseSelector: 'input[name*="captcha" i]',
          confidence: 0.85
        };
      }
    }

    return null;
  } catch (error) {
    console.warn("[CaptchaDetector] Error inspecting page for CAPTCHA:", error);
    return null;
  }
}
