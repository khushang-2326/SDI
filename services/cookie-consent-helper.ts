import type { Page, Frame } from "playwright";

/**
 * Universal Cookie Banner & Consent Modal Auto-Acceptor.
 * Supports HubSpot, OneTrust, Cookiebot, Osano, CCM19, Complianz, CookieFirst,
 * Termly, Didomi, Klaro, Usercentrics, Axeptio, CookieYes, Borlabs, TrustArc,
 * Civic UK Cookie Control, Quantcast, Google Funding Choices, Moove GDPR,
 * and generic multi-lingual cookie/consent modals worldwide.
 */

const SPECIALIZED_ACCEPT_SELECTORS = [
  // HubSpot (e.g. hubs.la, hubspot.com, and millions of HubSpot-hosted websites)
  "#hs-eu-confirmation-button",
  "button#hs-eu-confirmation-button",
  "a#hs-eu-confirmation-button",
  ".hs-eu-confirmation-button",
  "#hs-eu-cookie-confirmation button:not([id*='decline' i]):not([id*='close' i]):not([class*='close' i])",
  "#hs-eu-cookie-confirmation-buttons-area button:first-child",
  "#hs-banner-parent button:not([class*='close' i]):not([id*='decline' i])",
  "[id*='hs-eu' i][id*='confirm' i]",
  "[id*='hs-eu' i][id*='accept' i]",
  "[id*='hs-eu' i][id*='allow' i]",

  // OneTrust (enterprise sites)
  "#onetrust-accept-btn-handler",
  "button#onetrust-accept-btn-handler",
  ".onetrust-accept-btn-handler",
  "#onetrust-banner-sdk button#onetrust-accept-btn-handler",
  ".onetrust-close-btn-handler",
  "#onetrust-reject-all-handler",

  // Cookiebot (widely used in EU & globally)
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  "#CybotCookiebotDialogBodyLevelButtonAccept",
  "#CybotCookiebotDialogBodyButtonLevelOptinAllowallSelection",
  "a#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "[id*='Cookiebot' i] button[id*='AllowAll' i]",
  "[id*='Cookiebot' i] button[id*='Accept' i]",

  // Osano (Calendly & enterprise sites)
  ".osano-cm-accept-all",
  ".osano-cm-accept",
  "button.osano-cm-accept-all",
  "button.osano-cm-accept",
  "button.osano-cm-btn",
  ".osano-cm-window button.osano-cm-btn",

  // CookieYes / CKY
  "button.cky-btn-accept",
  "button[data-cky-tag='accept-button']",
  ".cky-btn-accept",
  ".cky-consent-bar button.cky-btn-accept",
  "button[data-cky-tag='settings-button'] ~ button",

  // Usercentrics
  "button[data-testid='uc-accept-all-button']",
  "button[data-testid='uc-accept-all']",
  "button#uc-btn-accept-banner",
  "[id*='usercentrics' i] button[data-testid*='accept']",
  "[id*='usercentrics' i] button[data-testid*='allow']",

  // Didomi
  "#didomi-notice-agree-button",
  "button#didomi-notice-agree-button",
  ".didomi-components-button:has-text('Agree')",
  ".didomi-components-button:has-text('Accept')",

  // Complianz (WordPress)
  ".cmplz-accept",
  "button.cmplz-btn.cmplz-accept",
  "button.cmplz-btn.cmplz-all",
  ".cmplz-btn.cmplz-accept-all",

  // CCM19 (AOE & German/European sites)
  "button.ccm19-accept-all",
  "button[data-ccm19-action='accept-all']",
  ".ccm19-button-primary",
  ".ccm19-accept",
  "button.ccm--save-settings",
  ".ccm--save-settings",
  ".ccm--button-primary",

  // CookieFirst
  "button[data-cookiefirst-action='accept']",
  "button[data-cookiefirst-action='accept-all']",

  // Termly
  "button[data-tid='banner-accept']",
  "button[data-tid='banner-accept-all']",

  // Quantcast Choice
  ".qc-cmp2-summary-buttons button[mode='primary']",
  "button.qc-cmp-button[mode='primary']",

  // Klaro
  ".klaro .cm-btn-accept-all",
  ".klaro .cm-btn-success",
  ".klaro .cm-btn-accept",

  // Axeptio
  "#axeptio_btn_acceptAll",
  "#axeptio_btn_accept",
  "button[id*='axeptio' i]",

  // Borlabs Cookie (WordPress)
  "a._brlbs-btn-accept-all",
  "button._brlbs-btn-accept-all",
  "._brlbs-btn-accept-all",
  "._brlbs-accept",

  // TrustArc / Consent Manager
  ".truste-button1",
  "a.truste-button1",
  "#truste-consent-button",
  "button#truste-consent-button",

  // Civic UK Cookie Control
  "#ccc-notify-accept",
  "#ccc-recommended-settings",
  "button#ccc-notify-accept",

  // Moove GDPR / Cookie Compliance
  "button.moove-gdpr-infobar-allow-all",
  "button.moove-gdpr-modal-allow-all",
  ".moove-gdpr-infobar-allow-all",

  // Google Funding Choices / Consent
  "button.fc-cta-consent",
  ".fc-cta-consent",
  "button[aria-label='Consent']",
  "button[aria-label='Agree']",

  // High-confidence generic classes and IDs
  "#cookie-accept",
  "#accept-cookies",
  "#accept-all-cookies",
  "#accept-all",
  "#allow-all",
  "#allow-cookies",
  "#allow-all-cookies",
  ".cookie-accept",
  ".accept-cookies-btn",
  ".cookie-allow-all",
  ".cookie-accept-all",
  "button[id*='cookie' i][id*='accept' i]",
  "button[class*='cookie' i][class*='accept' i]",
  "button[id*='consent' i][id*='accept' i]",
  "button[class*='consent' i][class*='accept' i]",
  "button[id*='cookie' i][id*='allow' i]",
  "button[class*='cookie' i][class*='allow' i]",
  "button[id*='consent' i][id*='allow' i]",
  "button[class*='consent' i][class*='allow' i]",
  "a[id*='cookie' i][id*='accept' i]",
  "a[class*='cookie' i][class*='accept' i]",
  "a[id*='cookie' i][id*='allow' i]",
  "a[class*='cookie' i][class*='allow' i]"
];

// Multi-lingual Text Matching across all buttons and clickable elements
// Includes comprehensive English, Spanish, German, French, Portuguese, Italian, Dutch, Swedish, Polish
const ACCEPT_TEXT_REGEX = new RegExp(
  "^[\\s✓✔•\\-\\–\\—]*(" +
    [
      // English
      "allow all( cookies)?",
      "always allow( cookies)?",
      "allow( cookies)?",
      "allow selection",
      "allow necessary and optional",
      "allow optional",
      "accept all( cookies)?",
      "always accept( cookies)?",
      "accept( cookies)?",
      "accept selection",
      "accept recommended",
      "accept necessary",
      "accept necessary and optional",
      "accept and continue",
      "accept & continue",
      "accept and proceed",
      "accept & proceed",
      "accept and close",
      "accept & close",
      "i agree",
      "agree",
      "agree to all",
      "agree & continue",
      "agree and continue",
      "agree and proceed",
      "i accept",
      "i accept all",
      "i understand",
      "understand",
      "got it",
      "ok",
      "okay",
      "ok, got it",
      "consent",
      "consent to all",
      "enable all",
      "enable cookies",
      "confirm choices",
      "save & exit",
      "save preferences",
      "continue",
      "proceed",
      // Spanish
      "permitir todo",
      "permitir todas( las cookies)?",
      "permitir cookies",
      "permitir",
      "siempre permitir",
      "aceptar todo",
      "aceptar todas( las cookies)?",
      "aceptar cookies",
      "aceptar",
      "entendido",
      "de acuerdo",
      // German
      "alle akzeptieren",
      "alle cookies akzeptieren",
      "immer erlauben",
      "erlauben",
      "alle erlauben",
      "akzeptieren",
      "zustimmen",
      "einverstanden",
      "verstanden",
      "alles annehmen",
      "cookies akzeptieren",
      // French
      "tout autoriser",
      "autoriser tout",
      "toujours autoriser",
      "autoriser",
      "tout accepter",
      "accepter tous les cookies",
      "accepter",
      "j'accepte",
      "compris",
      "j'ai compris",
      "d'accord",
      // Portuguese
      "permitir todos",
      "permitir todas",
      "permitir cookies",
      "permitir",
      "aceitar todos",
      "aceitar todas( as cookies)?",
      "aceitar cookies",
      "aceitar",
      "concordar",
      "entendi",
      // Italian
      "consenti tutti",
      "consenti cookie",
      "consenti",
      "accetta tutti",
      "accetta cookies",
      "accetta",
      "accetto",
      "ho capito",
      // Dutch
      "alles toestaan",
      "toestaan",
      "altijd toestaan",
      "alles accepteren",
      "accepteren",
      "akkoord",
      "begrepen"
    ].join("|") +
    ")[\\s✓✔•\\-\\–\\—]*$",
  "i"
);

// High-confidence explicit phrase matching for any standalone button/link anywhere on the page
const EXPLICIT_GLOBAL_COOKIE_REGEX = new RegExp(
  "^[\\s✓✔•\\-\\–\\—]*(" +
    [
      "allow all( cookies)?",
      "always allow( cookies)?",
      "allow( all)? cookies",
      "accept all( cookies)?",
      "always accept( cookies)?",
      "accept( all)? cookies",
      "agree to all( cookies)?",
      "consent to all( cookies)?",
      "enable all cookies",
      "alle cookies akzeptieren",
      "alle cookies erlauben",
      "accepter tous les cookies",
      "autoriser tous les cookies",
      "aceptar todas las cookies",
      "permitir todas las cookies",
      "aceitar todas as cookies"
    ].join("|") +
    ")[\\s✓✔•\\-\\–\\—]*$",
  "i"
);

const FAST_ACCEPT_CSS = SPECIALIZED_ACCEPT_SELECTORS.filter((s) => !s.includes(":has-text")).join(", ");

const COOKIE_CONTAINER_SELECTORS = [
  "[id*='cookie' i]",
  "[class*='cookie' i]",
  "[id*='consent' i]",
  "[class*='consent' i]",
  "[id*='hs-eu' i]",
  "[class*='hs-eu' i]",
  "#hs-banner-parent",
  "[id*='onetrust' i]",
  "[class*='onetrust' i]",
  "[id*='cookiebot' i]",
  "[class*='cookiebot' i]",
  "[id*='usercentrics' i]",
  "[class*='usercentrics' i]",
  "[id*='didomi' i]",
  "[class*='didomi' i]",
  "[id*='axeptio' i]",
  "[class*='axeptio' i]",
  "[role='dialog'][aria-label*='cookie' i]",
  "[role='dialog'][aria-label*='consent' i]",
  "[role='region'][aria-label*='cookie' i]",
  "[aria-modal='true'][class*='cookie' i]",
  "[aria-modal='true'][id*='cookie' i]"
].join(", ");

async function dismissScopeCookieBanners(scope: Page | Frame): Promise<boolean> {
  let dismissed = false;

  // 1. Try vendor & specialized accept selectors (iterating all matches to find visible ones)
  try {
    const locators = scope.locator(FAST_ACCEPT_CSS);
    const count = await locators.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 8); i++) {
      const el = locators.nth(i);
      if (await el.isVisible().catch(() => false)) {
        await el.click({ timeout: 1000, force: true }).catch(() => undefined);
        return true;
      }
    }
  } catch {
    // Continue
  }

  // 2. Try text-based pseudo selectors defined in specialized list
  try {
    const textSelectors = SPECIALIZED_ACCEPT_SELECTORS.filter((s) => s.includes(":has-text"));
    for (const selector of textSelectors) {
      const locator = scope.locator(selector).first();
      if ((await locator.count().catch(() => 0)) > 0 && (await locator.isVisible().catch(() => false))) {
        await locator.click({ timeout: 1000, force: true }).catch(() => undefined);
        return true;
      }
    }
  } catch {
    // Continue
  }

  // 3. Multi-lingual Text Matching strictly inside recognized cookie/consent containers
  if (!dismissed) {
    try {
      const containerButtons = scope.locator(
        `${COOKIE_CONTAINER_SELECTORS} button, ${COOKIE_CONTAINER_SELECTORS} a, ${COOKIE_CONTAINER_SELECTORS} input[type='button'], ${COOKIE_CONTAINER_SELECTORS} input[type='submit'], ${COOKIE_CONTAINER_SELECTORS} [role='button'], ${COOKIE_CONTAINER_SELECTORS} .hs-eu-confirmation-button`
      );

      const count = await containerButtons.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 12); i++) {
        const btn = containerButtons.nth(i);
        if (await btn.isVisible().catch(() => false)) {
          const text = ((await btn.textContent().catch(() => "")) || "").trim();
          const aria = ((await btn.getAttribute("aria-label").catch(() => "")) || "").trim();
          if (ACCEPT_TEXT_REGEX.test(text) || ACCEPT_TEXT_REGEX.test(aria)) {
            await btn.click({ timeout: 1000, force: true }).catch(() => undefined);
            dismissed = true;
            break;
          }
        }
      }
    } catch {
      // Continue
    }
  }

  // 4. Standalone buttons anywhere on the page with explicit cookie accept text (e.g. "Accept All Cookies", "Allow All Cookies", "Always Allow")
  if (!dismissed) {
    try {
      const explicitButtons = scope
        .locator("button, a[role='button'], a.btn, a.button, input[type='button'], input[type='submit'], [role='button']")
        .filter({ hasText: EXPLICIT_GLOBAL_COOKIE_REGEX });

      const count = await explicitButtons.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 5); i++) {
        const btn = explicitButtons.nth(i);
        if (await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 1000, force: true }).catch(() => undefined);
          dismissed = true;
          break;
        }
      }
    } catch {
      // Continue
    }
  }

  // 5. Check for cookie-specific close/dismiss controls as a fallback if accept button wasn't clicked
  if (!dismissed) {
    try {
      const closeButtons = scope.locator(
        "[role='dialog'][class*='cookie' i] button[aria-label*='close' i], [class*='cookie' i] button[aria-label*='close' i], [id*='cookie' i] button[aria-label*='close' i], .osano-cm-close, .hs-eu-cookie-close-button, #hs-eu-close-button"
      );
      const count = await closeButtons.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 4); i++) {
        const btn = closeButtons.nth(i);
        if (await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 1000, force: true }).catch(() => undefined);
          dismissed = true;
          break;
        }
      }
    } catch {
      // Continue
    }
  }

  return dismissed;
}

/**
 * Universal Shadow DOM Auto-Consent Engine.
 * Pierces open Shadow Roots (e.g. Usercentrics, Axeptio, Didomi, Cookiebot)
 * to locate and click Allow/Accept buttons that standard CSS selectors cannot reach.
 */
async function dismissShadowCookieBanners(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      let clicked = false;

      function searchNode(node: Node): boolean {
        if (clicked) return true;
        if (!node) return false;

        if (node instanceof HTMLElement) {
          // If this is an open shadow host, inspect its shadow root
          if (node.shadowRoot) {
            searchNode(node.shadowRoot);
          }

          const tagName = node.tagName.toLowerCase();
          if (tagName === "button" || tagName === "a" || node.getAttribute("role") === "button") {
            const text = (node.textContent || "").trim().toLowerCase();
            const id = (node.id || "").toLowerCase();
            const className = typeof node.className === "string" ? node.className.toLowerCase() : "";

            const isAcceptText =
              /^(allow all( cookies)?|always allow|allow|accept all( cookies)?|accept|i agree|agree|accept selection|enable all)$/i.test(
                text
              );

            const isAcceptAttribute =
              id.includes("accept") || id.includes("allow") || className.includes("accept") || className.includes("allow");

            // Verify element is not hidden
            const rect = node.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(node).display !== "none";

            if (isVisible && (isAcceptText || isAcceptAttribute)) {
              try {
                node.click();
                clicked = true;
                return true;
              } catch {}
            }
          }
        }

        // Search child nodes
        for (const child of Array.from(node.childNodes)) {
          if (searchNode(child)) return true;
        }

        return false;
      }

      searchNode(document.body);
      return clicked;
    }).catch(() => false);
  } catch {
    return false;
  }
}

/**
 * Safe Obstruction, Cookie Banner & Popup Neutralizer.
 * Dismisses or neutralizes any modal, banner, or backdrop overlay that is physically
 * obstructing page contact forms or inputs, while strictly protecting contact/booking forms.
 */
export async function dismissBlockingPopups(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll(
          "#hs-eu-cookie-confirmation, #hs-banner-parent, #onetrust-banner-sdk, #CybotCookiebotDialog, [role='dialog'], [aria-modal='true'], .modal, .popup, .overlay, [class*='newsletter' i], [class*='promo' i], [class*='popup' i], [class*='lightbox' i], [class*='announcement' i], [class*='intercom' i], [class*='drift' i], [class*='cookie' i], [id*='cookie' i], [class*='consent' i], [id*='consent' i]"
        )
      ) as HTMLElement[];

      let dismissedAny = false;

      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0" ||
          rect.width < 50 ||
          rect.height < 30
        ) {
          continue;
        }

        // CRITICAL PROTECTION: If this container is the actual contact form, DO NOT HIDE IT!
        const formInputs = el.querySelectorAll(
          "input:not([type='hidden']):not([type='search']):not([type='submit']):not([type='button']), textarea, select"
        );
        const hasEmail = Boolean(el.querySelector("input[type='email'], input[name*='email' i], input[id*='email' i]"));
        const hasMessage = Boolean(el.querySelector("textarea, input[name*='message' i], input[name*='comment' i]"));
        const hasName = Boolean(el.querySelector("input[name*='name' i], input[id*='name' i]"));

        if ((hasEmail && (hasMessage || hasName)) || formInputs.length >= 3) {
          continue;
        }

        const containerText = (el.textContent ?? "").toLowerCase();
        const isCookieOrConsent =
          /cookie|consent|tracking|gdpr|datenschutz|privacy policy|our website uses cookies|manage cookies/i.test(
            containerText
          ) ||
          /cookie|consent|hs-eu|onetrust|cookiebot/i.test(el.id) ||
          /cookie|consent|hs-eu|onetrust|cookiebot/i.test(el.className);

        const isMarketingObstruction =
          /newsletter|subscribe|discount|offer|coupon|special|promo|save\s+\d+%|join\s+our|announcement|welcome|chat\s+with\s+us|need\s+help\??/i.test(
            containerText
          ) ||
          el.classList.contains("modal") ||
          el.getAttribute("role") === "dialog";

        if (!isCookieOrConsent && !isMarketingObstruction) continue;

        // Step A: If it's a cookie or consent dialog, prioritize clicking "Accept All" / "Allow" / "Agree"
        if (isCookieOrConsent) {
          const actionButtons = Array.from(el.querySelectorAll("button, a, input[type='button'], input[type='submit'], [role='button']")) as HTMLElement[];
          let accepted = false;
          for (const btn of actionButtons) {
            const bText = (btn.textContent || "").trim().toLowerCase();
            const bId = (btn.id || "").toLowerCase();
            const bClass = typeof btn.className === "string" ? btn.className.toLowerCase() : "";

            if (
              /^(accept all( cookies)?|always allow|allow all( cookies)?|allow|accept|i agree|agree|got it|ok|okay|confirm|enable all)$/i.test(bText) ||
              bId.includes("confirmation") || bId.includes("accept") || bId.includes("allow") ||
              bClass.includes("accept") || bClass.includes("allow")
            ) {
              try {
                btn.click();
                accepted = true;
                dismissedAny = true;
                break;
              } catch {}
            }
          }
          if (accepted) continue;
        }

        // Step B: Search for close button inside this obstruction
        const closeSelectors = [
          "button[aria-label*='close' i]",
          "button[aria-label*='dismiss' i]",
          "[title*='close' i]",
          "[data-dismiss]",
          "[data-bs-dismiss]",
          ".close",
          ".modal-close",
          ".popup-close",
          ".hs-eu-cookie-close-button",
          "#hs-eu-close-button",
          "[class*='close-btn' i]",
          "[class*='btn-close' i]",
          "[class*='close' i]",
          "[class*='dismiss' i]",
          "svg[class*='close' i]",
          "button",
          "a"
        ];

        let closeBtn: HTMLElement | null = null;
        for (const sel of closeSelectors) {
          const matching = Array.from(el.querySelectorAll(sel)) as HTMLElement[];
          for (const btn of matching) {
            const btnText = (btn.textContent ?? "").trim().toLowerCase();
            const btnAria = (btn.getAttribute("aria-label") ?? "").toLowerCase();
            const btnTitle = (btn.getAttribute("title") ?? "").toLowerCase();
            const btnClass = typeof btn.className === "string" ? btn.className.toLowerCase() : "";

            if (
              btnAria.includes("close") ||
              btnAria.includes("dismiss") ||
              btnTitle.includes("close") ||
              btnClass.includes("close") ||
              btnClass.includes("dismiss") ||
              btn.hasAttribute("data-dismiss") ||
              btn.hasAttribute("data-bs-dismiss") ||
              /^(x|✕|✖|close|dismiss|no thanks|no thank you|not now|maybe later|skip|close window)$/i.test(btnText)
            ) {
              const bRect = btn.getBoundingClientRect();
              const bStyle = window.getComputedStyle(btn);
              if (bStyle.display !== "none" && bStyle.visibility !== "hidden" && bRect.width > 0) {
                closeBtn = btn;
                break;
              }
            }
          }
          if (closeBtn) break;
        }

        if (closeBtn) {
          try {
            closeBtn.click();
            dismissedAny = true;
          } catch {}
        } else if (isCookieOrConsent) {
          // If banner has no clickable buttons and is fixed overlay blocking the page, safely neutralize it
          try {
            el.style.setProperty("display", "none", "important");
            el.style.setProperty("pointer-events", "none", "important");
            dismissedAny = true;
          } catch {}
        }
      }

      // Neutralize any leftover sticky modal-backdrop or cookie overlays that block mouse clicks
      const backdrops = Array.from(
        document.querySelectorAll(".modal-backdrop, .overlay-backdrop, [class*='cookie-backdrop'], [class*='cookie-overlay']")
      ) as HTMLElement[];
      for (const bd of backdrops) {
        bd.style.setProperty("display", "none", "important");
        bd.style.setProperty("pointer-events", "none", "important");
      }

      return dismissedAny;
    }).catch(() => false);
  } catch {
    return false;
  }
}

async function dismissCookieBannersInternal(page: Page): Promise<boolean> {
  let dismissed = false;

  // 1. Process main page cookie banners
  try {
    const mainDismissed = await dismissScopeCookieBanners(page);
    if (mainDismissed) dismissed = true;
  } catch {
    // Continue
  }

  // 2. Process Shadow DOM cookie banners (e.g. Usercentrics, Axeptio, Didomi)
  try {
    const shadowDismissed = await dismissShadowCookieBanners(page);
    if (shadowDismissed) dismissed = true;
  } catch {
    // Continue
  }

  // 3. Process blocking marketing overlays & popups
  try {
    const popupDismissed = await dismissBlockingPopups(page);
    if (popupDismissed) dismissed = true;
  } catch {
    // Continue
  }

  // 4. Process consent/CMP child iframes (e.g. OneTrust, TrustArc, Google CMP)
  try {
    const frames = page.frames().filter((f) => {
      if (f === page.mainFrame()) return false;
      const fUrl = f.url().toLowerCase();
      return /consent|cookie|osano|didomi|usercentrics|klaro|onetrust|quantcast|axeptio|iubenda|sp_message/i.test(fUrl);
    }).slice(0, 4);

    for (const frame of frames) {
      const frameDismissed = await dismissScopeCookieBanners(frame).catch(() => false);
      if (frameDismissed) dismissed = true;
    }
  } catch {
    // Continue
  }

  return dismissed;
}

/**
 * Universal Cookie Banner Dismissal Entrypoint.
 * Automatically accepts "Allow All", "Accept All", "Always Allow", or "Allow"
 * on any cookie banner, consent popup, or modal overlay across target websites.
 */
export async function dismissCookieBanners(page: Page): Promise<boolean> {
  return await Promise.race([
    dismissCookieBannersInternal(page),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000))
  ]);
}
