import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";

const SCREENSHOT_DIR = path.join(process.cwd(), "public", "screenshots");

function slugify(value: string) {
  return value
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 70);
}

export type UnsupportedVerificationResult = {
  name: string;
  reason: string;
  screenshotPath: string | null;
};

/**
 * Detects reCAPTCHA, hCaptcha, Turnstile, Cloudflare verification, human verification,
 * and bot detection screens. When detected, captures a full-page screenshot and returns
 * a clear unsupported-verification failure reason. No bypass or solving is attempted.
 */
export async function detectUnsupportedVerification(
  page: Page,
  websiteUrl: string
): Promise<UnsupportedVerificationResult | null> {
  // 1. Interactive reCAPTCHA
  // Check for visible challenge bframe (interactive puzzle popup)
  const bframes = await page.locator("iframe[src*='bframe'], iframe[title*='recaptcha challenge' i]").all();
  for (const f of bframes) {
    if (await f.isVisible().catch(() => false)) {
      const screenshotPath = await captureFullPageVerificationScreenshot(page, websiteUrl, "reCAPTCHA Challenge");
      return {
        name: "reCAPTCHA",
        reason: "Unsupported verification: reCAPTCHA challenge detected. Manual verification required.",
        screenshotPath
      };
    }
  }

  // Check for visible reCAPTCHA v2 / Enterprise interactive checkbox
  const recaptchaIframes = await page.locator("iframe[src*='recaptcha'], iframe[src*='google.com/recaptcha'], iframe[src*='recaptcha.net']").all();
  for (const f of recaptchaIframes) {
    const src = (await f.getAttribute("src")) || "";
    // Skip invisible background risk tokens and telemetry
    if (src.includes("size=invisible") || src.includes("api2/aframe")) continue;
    const isBadge = await f.evaluate((el: any) => Boolean(el.closest(".grecaptcha-badge"))).catch(() => false);
    if (isBadge) continue;
    if (await f.isVisible().catch(() => false)) {
      const screenshotPath = await captureFullPageVerificationScreenshot(page, websiteUrl, "reCAPTCHA");
      return {
        name: "reCAPTCHA",
        reason: "Unsupported verification: reCAPTCHA detected. Manual verification required.",
        screenshotPath
      };
    }
  }

  const recaptchaContainers = await page.locator(".g-recaptcha, [data-sitekey][class*='recaptcha' i]").all();
  for (const c of recaptchaContainers) {
    const size = await c.getAttribute("data-size");
    if (size === "invisible") continue;
    if (await c.isVisible().catch(() => false)) {
      const screenshotPath = await captureFullPageVerificationScreenshot(page, websiteUrl, "reCAPTCHA");
      return {
        name: "reCAPTCHA",
        reason: "Unsupported verification: reCAPTCHA detected. Manual verification required.",
        screenshotPath
      };
    }
  }

  // 2. Interactive hCaptcha
  const hcaptchaIframes = await page.locator("iframe[src*='hcaptcha'], iframe[src*='hcaptcha.com']").all();
  for (const f of hcaptchaIframes) {
    const src = (await f.getAttribute("src")) || "";
    if (src.includes("size=invisible")) continue;
    if (await f.isVisible().catch(() => false)) {
      const screenshotPath = await captureFullPageVerificationScreenshot(page, websiteUrl, "hCaptcha");
      return {
        name: "hCaptcha",
        reason: "Unsupported verification: hCaptcha detected. Manual verification required.",
        screenshotPath
      };
    }
  }
  const hcaptchaContainers = await page.locator(".h-captcha, [data-sitekey][class*='hcaptcha' i]").all();
  for (const c of hcaptchaContainers) {
    const size = await c.getAttribute("data-size");
    if (size === "invisible") continue;
    if (await c.isVisible().catch(() => false)) {
      const screenshotPath = await captureFullPageVerificationScreenshot(page, websiteUrl, "hCaptcha");
      return {
        name: "hCaptcha",
        reason: "Unsupported verification: hCaptcha detected. Manual verification required.",
        screenshotPath
      };
    }
  }

  // 3. Cloudflare Turnstile
  const turnstileIframes = await page.locator("iframe[src*='challenges.cloudflare.com']").all();
  for (const f of turnstileIframes) {
    if (await f.isVisible().catch(() => false)) {
      const screenshotPath = await captureFullPageVerificationScreenshot(page, websiteUrl, "Cloudflare Turnstile");
      return {
        name: "Cloudflare Turnstile",
        reason: "Unsupported verification: Cloudflare Turnstile detected. Manual verification required.",
        screenshotPath
      };
    }
  }
  const turnstileContainers = await page.locator(".cf-turnstile, [data-sitekey][class*='turnstile' i]").all();
  for (const c of turnstileContainers) {
    const size = await c.getAttribute("data-size");
    if (size === "invisible") continue;
    if (await c.isVisible().catch(() => false)) {
      const screenshotPath = await captureFullPageVerificationScreenshot(page, websiteUrl, "Cloudflare Turnstile");
      return {
        name: "Cloudflare Turnstile",
        reason: "Unsupported verification: Cloudflare Turnstile detected. Manual verification required.",
        screenshotPath
      };
    }
  }

  // 4. Other interactive challenges: Arkose Labs, GeeTest, Friendly Captcha, MTCaptcha
  const otherChallenges = [
    {
      name: "Arkose Labs FunCaptcha",
      selector: "iframe[src*='arkoselabs']:visible, [data-pkey][class*='funcaptcha' i]:visible, [class*='funcaptcha' i]:visible"
    },
    {
      name: "GeeTest",
      selector: "iframe[src*='geetest']:visible, [class*='geetest' i]:visible"
    },
    {
      name: "Friendly Captcha",
      selector: "iframe[src*='friendlycaptcha']:visible, [class*='frc-captcha' i]:visible, [data-sitekey][class*='friendly' i]:visible"
    },
    {
      name: "MTCaptcha",
      selector: "iframe[src*='mtcaptcha']:visible, [class*='mtcaptcha' i]:visible"
    }
  ];

  for (const challenge of otherChallenges) {
    const found = await page.locator(challenge.selector).count().then((c) => c > 0).catch(() => false);
    if (found) {
      const screenshotPath = await captureFullPageVerificationScreenshot(page, websiteUrl, challenge.name);
      return {
        name: challenge.name,
        reason: `Unsupported verification: ${challenge.name} detected. Manual verification required.`,
        screenshotPath
      };
    }
  }

  // Cloudflare full-page managed challenge ("Just a moment...", "Verify you are human")
  const pageText = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  const title = await page.title().catch(() => "");

  const cloudflareManagedChallenge =
    /performing security verification|verify you are human|just a moment\.\.\./i.test(pageText) &&
    (/cloudflare/i.test(pageText) || /cloudflare/i.test(title) || /ray id/i.test(pageText));

  if (cloudflareManagedChallenge) {
    const screenshotPath = await captureFullPageVerificationScreenshot(page, websiteUrl, "Cloudflare Managed Challenge");
    return {
      name: "Cloudflare Managed Challenge",
      reason: "Unsupported verification: Cloudflare managed verification detected. Manual verification required.",
      screenshotPath
    };
  }

  // Generic human-verification or bot-detection challenge screens
  const humanVerificationChallenge =
    /(?:verify|confirm|prove)\s+(?:that\s+)?(?:you(?:'re| are)|i(?:'m| am))\s+(?:a\s+)?human|are you (?:a )?robot|checking your browser|automated traffic|unusual traffic|bot (?:detection|verification|protection)|access denied.*bot|security check to proceed/i.test(
      pageText
    );

  if (humanVerificationChallenge) {
    const screenshotPath = await captureFullPageVerificationScreenshot(page, websiteUrl, "Human Verification Challenge");
    return {
      name: "Human Verification Challenge",
      reason:
        "Unsupported verification: Human verification or bot detection screen detected. Manual verification required.",
      screenshotPath
    };
  }

  return null;
}

/**
 * Saves a full-page screenshot of the verification screen.
 */
export async function captureFullPageVerificationScreenshot(
  page: Page,
  websiteUrl: string,
  label: string
): Promise<string | null> {
  try {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    const slug = slugify(websiteUrl);
    const labelSlug = slugify(label);
    const fileName = `${Date.now()}-${slug}-${labelSlug}-verification.png`;
    const absolutePath = path.join(SCREENSHOT_DIR, fileName);
    await page.screenshot({
      path: absolutePath,
      fullPage: true,
      timeout: 15000,
      animations: "disabled"
    });
    return `/screenshots/${fileName}`;
  } catch (err) {
    console.warn("Failed to capture full-page verification screenshot:", err);
    return null;
  }
}
