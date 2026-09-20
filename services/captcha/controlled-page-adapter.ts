import type { Page } from "playwright";
import type { DetectedCaptchaChallenge } from "./captcha-types";

/**
 * Passes the solved CAPTCHA result (token/text) through the controlled test-page adapter.
 * Injects the response token into corresponding form fields and invokes any registered callbacks.
 */
export async function applyCaptchaSolutionToPage(
  page: Page,
  challenge: DetectedCaptchaChallenge,
  solution: { token?: string; text?: string }
): Promise<{ applied: boolean; details: string }> {
  const token = solution.token || solution.text || "";
  if (!token) {
    throw new Error("Cannot apply empty CAPTCHA solution token.");
  }

  const result = await page.evaluate(
    (args: { type: string; token: string; callbackName: string | null }) => {
      let appliedCount = 0;
      const details: string[] = [];
      const val = args.token;

      // 1. Injections for reCAPTCHA v2 / v3
      if (args.type === "recaptcha_v2" || args.type === "recaptcha_v3") {
        const textareas = document.querySelectorAll(
          'textarea[name="g-recaptcha-response"], textarea#g-recaptcha-response, .g-recaptcha-response'
        );
        for (let i = 0; i < textareas.length; i++) {
          const ta = textareas[i] as HTMLTextAreaElement;
          ta.value = val;
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          ta.dispatchEvent(new Event("change", { bubbles: true }));
          appliedCount++;
          details.push("Injected into " + (ta.name || ta.id || "g-recaptcha-response"));
        }

        // Try global callback if specified
        if (args.callbackName && typeof (window as any)[args.callbackName] === "function") {
          try {
            (window as any)[args.callbackName](val);
            appliedCount++;
            details.push("Invoked window." + args.callbackName + "(token)");
          } catch (err: any) {
            details.push("Callback window." + args.callbackName + " error: " + err.message);
          }
        }

        // Try grecaptcha client callbacks
        const cfg = (window as any).___grecaptcha_cfg;
        if (cfg && cfg.clients) {
          try {
            const clientKeys = Object.keys(cfg.clients);
            for (let i = 0; i < clientKeys.length; i++) {
              const client = cfg.clients[clientKeys[i]];
              if (client) {
                const stack = [{ obj: client, depth: 0 }];
                while (stack.length > 0) {
                  const item = stack.pop()!;
                  if (item.depth > 4 || !item.obj) continue;
                  if (typeof item.obj.callback === "function") {
                    item.obj.callback(val);
                    appliedCount++;
                    details.push("Invoked ___grecaptcha_cfg client callback");
                    break;
                  }
                  if (typeof item.obj.callback === "string" && typeof (window as any)[item.obj.callback] === "function") {
                    (window as any)[item.obj.callback](val);
                    appliedCount++;
                    details.push("Invoked callback " + item.obj.callback);
                    break;
                  }
                  const propKeys = Object.keys(item.obj);
                  for (let j = 0; j < propKeys.length; j++) {
                    const child = item.obj[propKeys[j]];
                    if (typeof child === "object" && child !== null) {
                      stack.push({ obj: child, depth: item.depth + 1 });
                    }
                  }
                }
              }
            }
          } catch (e) {
            // ignore
          }
        }
      }

      // 2. Injections for hCaptcha
      if (args.type === "hcaptcha") {
        const hTextareas = document.querySelectorAll(
          'textarea[name="h-captcha-response"], [name="h-captcha-response"], textarea[name="g-recaptcha-response"]'
        );
        for (let i = 0; i < hTextareas.length; i++) {
          const ta = hTextareas[i] as HTMLTextAreaElement | HTMLInputElement;
          ta.value = val;
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          ta.dispatchEvent(new Event("change", { bubbles: true }));
          appliedCount++;
          details.push("Injected into h-captcha-response");
        }

        if (args.callbackName && typeof (window as any)[args.callbackName] === "function") {
          try {
            (window as any)[args.callbackName](val);
            appliedCount++;
            details.push("Invoked window." + args.callbackName + "(token)");
          } catch (err: any) {
            details.push("Callback window." + args.callbackName + " error: " + err.message);
          }
        }

        if (typeof (window as any).hcaptchaCallback === "function") {
          try {
            (window as any).hcaptchaCallback(val);
            appliedCount++;
          } catch (e) {}
        }
      }

      // 3. Injections for Cloudflare Turnstile
      if (args.type === "turnstile") {
        const turnstileInputs = document.querySelectorAll(
          'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], [name="cf-turnstile-response"]'
        );
        for (let i = 0; i < turnstileInputs.length; i++) {
          const inp = turnstileInputs[i] as HTMLInputElement | HTMLTextAreaElement;
          inp.value = val;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          appliedCount++;
          details.push("Injected into cf-turnstile-response");
        }

        if (args.callbackName && typeof (window as any)[args.callbackName] === "function") {
          try {
            (window as any)[args.callbackName](val);
            appliedCount++;
            details.push("Invoked window." + args.callbackName + "(token)");
          } catch (err: any) {
            details.push("Callback window." + args.callbackName + " error: " + err.message);
          }
        }

        if (typeof (window as any).turnstileCallback === "function") {
          try {
            (window as any).turnstileCallback(val);
            appliedCount++;
          } catch (e) {}
        }
      }

      // 4. Injections for Image/OCR Captcha
      if (args.type === "image") {
        const imageInputs = document.querySelectorAll(
          'input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i]'
        );
        for (let i = 0; i < imageInputs.length; i++) {
          const inp = imageInputs[i] as HTMLInputElement;
          inp.value = val;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          appliedCount++;
          details.push("Injected text into " + (inp.name || inp.id || "captcha-input"));
        }
      }

      // 5. Explicit SDI Test Harness Hook
      if (typeof (window as any).__sdi_captcha_solved_hook === "function") {
        try {
          (window as any).__sdi_captcha_solved_hook({ type: args.type, token: val });
          appliedCount++;
          details.push("Invoked window.__sdi_captcha_solved_hook");
        } catch (e) {}
      }

      // If no explicit elements found, look for any form and add hidden input
      if (appliedCount === 0) {
        const forms = document.querySelectorAll("form");
        if (forms.length > 0) {
          const form = forms[0];
          const hiddenInput = document.createElement("input");
          hiddenInput.type = "hidden";
          hiddenInput.name = args.type === "hcaptcha" ? "h-captcha-response" : args.type === "turnstile" ? "cf-turnstile-response" : "g-recaptcha-response";
          hiddenInput.value = val;
          form.appendChild(hiddenInput);
          appliedCount++;
          details.push("Appended hidden response input to form");
        }
      }

      return {
        applied: appliedCount > 0,
        details: details.join("; ") || "No injection targets found"
      };
    },
    {
      type: challenge.type,
      token,
      callbackName: challenge.callbackName || null
    }
  );

  return result;
}
