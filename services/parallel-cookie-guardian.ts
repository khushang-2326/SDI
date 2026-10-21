import type { Page, Frame } from "playwright";

/**
 * Universal Parallel Cookie & Popup Guardian.
 * 
 * Runs concurrently alongside automation sessions to continuously detect,
 * dismiss, or accept cookie banners, consent dialogs, and blocking modal overlays
 * that load asynchronously (e.g. 3s, 7s, 10s after initial page render).
 * 
 * Hierarchy:
 * 1. Closes popups immediately if a close/dismiss button exists.
 * 2. Otherwise clicks "Okay", "Allow", "Always Allow", "Allow Cookies", "Accept All", etc.
 * 3. Neutralizes any fixed backdrop overlay obstructing form inputs or submit buttons.
 */

export interface CookieGuardianController {
  stop: () => void;
  isActive: () => boolean;
  sweepNow: () => Promise<boolean>;
}

// In-page sweep function evaluated directly inside the browser DOM context
export const IN_PAGE_COOKIE_SWEEP_CODE = `(() => {
  try {
    let handledAny = false;

    // 1. Target known vendor containers and generic dialogs
    const dialogSelectors = [
      "#hs-eu-cookie-confirmation",
      "#hs-banner-parent",
      "#onetrust-banner-sdk",
      "#CybotCookiebotDialog",
      ".osano-cm-window",
      ".cky-consent-container",
      ".cky-consent-bar",
      "[id*='usercentrics']",
      "#didomi-notice",
      ".cmplz-cookiebanner",
      ".ccm19-popup",
      ".klaro",
      "#axeptio_overlay",
      "._brlbs-cookie-banner",
      "#truste-consent-track",
      "#ccc",
      "[role='dialog'][class*='cookie' i]",
      "[role='dialog'][id*='cookie' i]",
      "[role='dialog'][aria-label*='cookie' i]",
      "[role='dialog'][aria-label*='consent' i]",
      "[role='region'][aria-label*='cookie' i]",
      "[aria-modal='true'][class*='cookie' i]",
      "[aria-modal='true'][id*='cookie' i]",
      "[class*='cookie-banner' i]",
      "[id*='cookie-banner' i]",
      "[class*='cookie-notice' i]",
      "[id*='cookie-notice' i]",
      "[class*='cookie-consent' i]",
      "[id*='cookie-consent' i]",
      "[class*='consent-banner' i]",
      "[id*='consent-banner' i]",
      "[class*='consent-modal' i]",
      "[id*='consent-modal' i]",
      ".modal-backdrop",
      ".overlay-backdrop",
      "[class*='cookie-backdrop']",
      "[class*='cookie-overlay']"
    ];

    const elements = Array.from(document.querySelectorAll(dialogSelectors.join(",")));

    // Helper: is element visible
    function isVisible(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    // Helper: is this element actually a contact or booking form (PROTECT IT FROM BEING DISMISSED)
    function isContactForm(container) {
      if (!container || !(container instanceof HTMLElement)) return false;
      const inputs = container.querySelectorAll("input:not([type='hidden']):not([type='search']):not([type='submit']), textarea, select");
      const hasEmail = Boolean(container.querySelector("input[type='email'], input[name*='email' i]"));
      const hasMsg = Boolean(container.querySelector("textarea, input[name*='message' i], input[name*='comment' i]"));
      return (hasEmail && hasMsg) || inputs.length >= 3;
    }

    // Process dialogs & cookie banners
    for (const el of elements) {
      if (!(el instanceof HTMLElement)) continue;
      if (!isVisible(el)) continue;
      if (isContactForm(el)) continue;

      // PRIORITY 1: Close button if present (User requested: "close that if possible")
      const closeButtons = Array.from(
        el.querySelectorAll(
          "button[aria-label*='close' i], button[aria-label*='dismiss' i], [title*='close' i], [data-dismiss], [data-bs-dismiss], .close, .modal-close, .popup-close, .hs-eu-cookie-close-button, #hs-eu-close-button, .osano-cm-close, .onetrust-close-btn-handler, [class*='close-btn' i], [class*='btn-close' i]"
        )
      );

      let closed = false;
      for (const btn of closeButtons) {
        if (isVisible(btn)) {
          try {
            btn.click();
            closed = true;
            handledAny = true;
            break;
          } catch {}
        }
      }
      if (closed) continue;

      // Also check buttons with literal close text (X, Close, Dismiss)
      const allActionButtons = Array.from(
        el.querySelectorAll("button, a, input[type='button'], input[type='submit'], [role='button']")
      );

      for (const btn of allActionButtons) {
        if (!isVisible(btn)) continue;
        const text = (btn.textContent || "").trim();
        if (/^(x|✕|✖|close|dismiss|skip|no thanks|not now)$/i.test(text)) {
          try {
            btn.click();
            closed = true;
            handledAny = true;
            break;
          } catch {}
        }
      }
      if (closed) continue;

      // PRIORITY 2: Accept / Allow / Always Allow / Okay / Allow Cookies
      // (User requested: "other wise click okay,allow,alway allow,allow cokkies etc")
      const allowPatterns = /\\b(allow all( cookies)?|always allow|allow( all)? cookies|allow|accept all( cookies)?|always accept|accept( all)? cookies|accept|i agree|agree|okay|ok|got it|confirm|enable all|alle akzeptieren|immer erlauben|tout accepter|toujours autoriser|autoriser|aceptar todo|permitir todo|permitir todas|aceitar todos|consenti tutti|accetta tutti|alles accepteren|alles toestaan)\\b/i;

      let allowed = false;
      for (const btn of allActionButtons) {
        if (!isVisible(btn)) continue;
        const text = (btn.textContent || "").trim();
        const id = (btn.id || "").toLowerCase();
        const cls = String(btn.className?.baseVal || btn.className || "").toLowerCase();
        const aria = (btn.getAttribute("aria-label") || "").toLowerCase();

        const isAllowBtn =
          allowPatterns.test(text) ||
          allowPatterns.test(aria) ||
          id.includes("accept") ||
          id.includes("allow") ||
          id.includes("consent") ||
          cls.includes("accept") ||
          cls.includes("allow") ||
          id.includes("confirmation");

        if (isAllowBtn) {
          try {
            btn.click();
            allowed = true;
            handledAny = true;
            break;
          } catch {}
        }
      }

      if (allowed) continue;

      // PRIORITY 3: If no interactive button succeeded and it's a fixed backdrop blocking clicks, neutralize it
      const isBackdrop =
        el.classList.contains("modal-backdrop") ||
        el.classList.contains("overlay-backdrop") ||
        el.className?.includes?.("backdrop") ||
        el.className?.includes?.("overlay");

      if (isBackdrop) {
        try {
          el.style.setProperty("display", "none", "important");
          el.style.setProperty("pointer-events", "none", "important");
          handledAny = true;
        } catch {}
      }
    }

    // 2. Global Sweep: Catch any standalone Allow/Accept button anywhere on page
    const standaloneButtons = Array.from(
      document.querySelectorAll("button, a[role='button'], input[type='button'], [role='button']")
    );

    for (const btn of standaloneButtons) {
      if (!isVisible(btn)) continue;
      const text = (btn.textContent || "").trim();
      if (/\\b(allow all( cookies)?|always allow|allow cookies|accept all cookies|accept all|always accept)\\b/i.test(text)) {
        try {
          btn.click();
          handledAny = true;
          break;
        } catch {}
      }
    }

    // 3. Piercing open Shadow DOM roots (Usercentrics, Didomi, Cookiebot, etc.)
    function sweepShadow(node) {
      if (!node) return;
      if (node.shadowRoot) {
        const shadowButtons = Array.from(node.shadowRoot.querySelectorAll("button, a, [role='button']"));
        for (const btn of shadowButtons) {
          if (!isVisible(btn)) continue;
          const text = (btn.textContent || "").trim().toLowerCase();
          if (/\\b(allow all|always allow|allow|accept all|accept|okay|ok|agree|got it)\\b/i.test(text)) {
            try {
              btn.click();
              handledAny = true;
              return;
            } catch {}
          }
        }
        sweepShadow(node.shadowRoot);
      }
      for (const child of Array.from(node.children || [])) {
        sweepShadow(child);
      }
    }
    sweepShadow(document.body);

    // 4. Neutralize any full-screen fixed overlays that block pointer events
    const allFixed = Array.from(document.querySelectorAll("div, section, aside"));
    for (const item of allFixed) {
      if (!(item instanceof HTMLElement)) continue;
      const style = window.getComputedStyle(item);
      if (style.position === "fixed" && style.display !== "none" && style.pointerEvents !== "none") {
        const z = parseInt(style.zIndex, 10);
        if (z >= 999 && !isContactForm(item)) {
          const text = (item.textContent || "").toLowerCase();
          if (/cookie|consent|tracking|gdpr|datenschutz|privacy policy/i.test(text) || item.id.includes("cookie") || item.className?.includes?.("cookie")) {
            item.style.setProperty("display", "none", "important");
            item.style.setProperty("pointer-events", "none", "important");
            handledAny = true;
          }
        }
      }
    }

    return handledAny;
  } catch (err) {
    return false;
  }
})()`;

// MutationObserver script injected via page.addInitScript to react the instant a popup is added
const DOM_OBSERVER_INIT_SCRIPT = `(() => {
  if (window.__cookieGuardianActive) return;
  window.__cookieGuardianActive = true;

  const sweep = () => {
    ${IN_PAGE_COOKIE_SWEEP_CODE}
  };

  // Run on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sweep);
  } else {
    sweep();
  }

  // Set up MutationObserver to react to dynamically added banners (e.g. 3s, 7s after load)
  try {
    const observer = new MutationObserver(() => {
      sweep();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "id"]
    });
  } catch {}

  // Periodic safety sweep every 750ms for asynchronous CDN-loaded banners
  setInterval(sweep, 750);
})();`;

/**
 * Attaches the in-browser MutationObserver and interval to the page context.
 * Guarantees that any popup appearing at 3s, 7s, or 10s is handled in real time.
 */
export async function installCookieGuardianInitScript(page: Page): Promise<void> {
  try {
    await page.addInitScript(DOM_OBSERVER_INIT_SCRIPT).catch(() => undefined);
  } catch {
    // Continue
  }
}

/**
 * Registers Playwright native locator handlers for common vendor cookie dialogs.
 * Playwright automatically invokes these right before any click/fill action if an overlay blocks.
 */
export async function registerPlaywrightLocatorHandlers(page: Page): Promise<void> {
  try {
    // 1. OneTrust Accept
    await page.addLocatorHandler(
      page.locator("#onetrust-accept-btn-handler, #onetrust-banner-sdk button#onetrust-accept-btn-handler").first(),
      async (locator) => {
        await locator.click({ timeout: 1500, force: true }).catch(() => undefined);
      }
    ).catch(() => undefined);

    // 2. HubSpot EU Cookie Accept
    await page.addLocatorHandler(
      page.locator("#hs-eu-confirmation-button, .hs-eu-confirmation-button").first(),
      async (locator) => {
        await locator.click({ timeout: 1500, force: true }).catch(() => undefined);
      }
    ).catch(() => undefined);

    // 3. Cookiebot Allow All
    await page.addLocatorHandler(
      page.locator("#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyButtonAccept").first(),
      async (locator) => {
        await locator.click({ timeout: 1500, force: true }).catch(() => undefined);
      }
    ).catch(() => undefined);

    // 4. Osano Accept All
    await page.addLocatorHandler(
      page.locator(".osano-cm-accept-all, button.osano-cm-accept-all, button.osano-cm-btn").first(),
      async (locator) => {
        await locator.click({ timeout: 1500, force: true }).catch(() => undefined);
      }
    ).catch(() => undefined);

    // 5. CookieYes Accept
    await page.addLocatorHandler(
      page.locator("button.cky-btn-accept, button[data-cky-tag='accept-button']").first(),
      async (locator) => {
        await locator.click({ timeout: 1500, force: true }).catch(() => undefined);
      }
    ).catch(() => undefined);

    // 6. Generic Close Button on Dialogs
    await page.addLocatorHandler(
      page.locator("[role='dialog'][class*='cookie' i] button[aria-label*='close' i], [class*='cookie' i] button[aria-label*='close' i], .hs-eu-cookie-close-button, .osano-cm-close").first(),
      async (locator) => {
        await locator.click({ timeout: 1500, force: true }).catch(() => undefined);
      }
    ).catch(() => undefined);
  } catch {
    // Continue
  }
}

/**
 * Starts a parallel background cookie guardian for a Playwright page.
 * 
 * - Injects the in-browser MutationObserver
 * - Sets up native Playwright locator handlers
 * - Runs a concurrent Node.js loop checking main frame and child iframes every 750ms
 * - Returns a controller with a `stop()` function to cleanly exit when automation finishes.
 */
export function startParallelCookieGuardian(page: Page): CookieGuardianController {
  let active = true;

  // Immediately inject in-browser guardian if page is already open
  void page.evaluate(IN_PAGE_COOKIE_SWEEP_CODE).catch(() => undefined);
  void registerPlaywrightLocatorHandlers(page).catch(() => undefined);

  // Background concurrent polling loop
  const pollingLoop = async () => {
    while (active) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      if (!active || page.isClosed()) break;

      try {
        // Main page sweep
        await page.evaluate(IN_PAGE_COOKIE_SWEEP_CODE).catch(() => undefined);

        // Check child iframes (e.g. OneTrust, TrustArc, Google CMP in iframes)
        const frames = page.frames();
        for (const frame of frames) {
          if (!active || page.isClosed()) break;
          if (frame !== page.mainFrame() && !frame.isDetached()) {
            await frame.evaluate(IN_PAGE_COOKIE_SWEEP_CODE).catch(() => undefined);
          }
        }
      } catch {
        // Ignore navigation or frame detach exceptions
      }
    }
  };

  // Run in background without awaiting
  void pollingLoop();

  return {
    stop: () => {
      active = false;
    },
    isActive: () => active,
    sweepNow: async () => {
      if (page.isClosed()) return false;
      try {
        const handled = await page.evaluate(IN_PAGE_COOKIE_SWEEP_CODE).catch(() => false);
        return Boolean(handled);
      } catch {
        return false;
      }
    }
  };
}
