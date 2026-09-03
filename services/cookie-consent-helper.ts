import type { Page, Frame } from "playwright";

/**
 * Universal Cookie Banner / Consent Modal Auto-Acceptor.
 * Supports Calendly, OneTrust, Cookiebot, Osano, CCM19, Complianz, CookieFirst,
 * Termly, Didomi, Klaro, Usercentrics, Axeptio, CookieYes, Iubenda, and generic multi-lingual popups.
 */

const SPECIALIZED_ACCEPT_SELECTORS = [
  // Vendor-specific consent controls only. Generic button text is scoped to a
  // known consent container below, so normal page CTAs are never clicked.
  // Osano (Calendly & enterprise sites)
  ".osano-cm-accept-all",
  ".osano-cm-accept",
  "button.osano-cm-accept-all",
  "button.osano-cm-accept",
  "button.osano-cm-btn",
  // OneTrust
  "#onetrust-accept-btn-handler",
  "button#onetrust-accept-btn-handler",
  ".onetrust-close-btn-handler",
  "#onetrust-reject-all-handler",
  // Cookiebot
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  "#CybotCookiebotDialogBodyLevelButtonAccept",
  // CCM19 (AOE & German sites)
  "button.ccm19-accept-all",
  "button[data-ccm19-action='accept-all']",
  ".ccm19-button-primary",
  ".ccm19-accept",
  "button.ccm--save-settings",
  ".ccm--save-settings",
  ".ccm--button-primary",
  "button:has-text('Accept all')",
  "button:has-text('Alle akzeptieren')",
  // Complianz
  ".cmplz-accept",
  "button.cmplz-btn.cmplz-accept",
  // CookieFirst
  "button[data-cookiefirst-action='accept']",
  "button[data-cookiefirst-action='accept-all']",
  // Termly
  "button[data-tid='banner-accept']",
  // Quantcast
  ".qc-cmp2-summary-buttons button[mode='primary']",
  // Klaro
  ".klaro .cm-btn-accept-all",
  ".klaro .cm-btn-success",
  // Didomi
  "#didomi-notice-agree-button",
  // Usercentrics
  "button[data-testid='uc-accept-all-button']",
  "button[data-testid='uc-accept-all']",
  // CookieYes
  "button.cky-btn-accept",
  "button[data-cky-tag='accept-button']",
  // Axeptio
  "#axeptio_btn_acceptAll",
  // Generic high-confidence IDs/classes
  "#cookie-accept",
  "#accept-cookies",
  "#accept-all-cookies",
  ".cookie-accept",
  ".accept-cookies-btn",
  "button[id*='cookie' i][id*='accept' i]",
  "button[class*='cookie' i][class*='accept' i]",
  "button[id*='consent' i][id*='accept' i]",
  "button[class*='consent' i][class*='accept' i]",
  "button[id*='cookie' i][id*='allow' i]",
  "button[class*='cookie' i][class*='allow' i]",
  "a[id*='cookie' i][id*='accept' i]",
  "a[class*='cookie' i][class*='accept' i]"
];

// Multi-lingual Text Matching across all buttons and clickable elements
// Supports: English, Spanish, German, French, Portuguese, Italian, Dutch
const ACCEPT_TEXT_REGEX = new RegExp(
  "^\\s*(" +
    [
      // English
      "i understand",
      "understand",
      "accept all( cookies)?",
      "accept( cookies)?",
      "allow all( cookies)?",
      "allow( cookies)?",
      "allow selection",
      "accept selection",
      "accept recommended",
      "accept necessary",
      "i agree",
      "i accept",
      "agree & continue",
      "agree and continue",
      "agree and proceed",
      "agree to all",
      "agree",
      "got it",
      "ok",
      "okay",
      "accept and close",
      "accept & close",
      "consent",
      "enable all",
      "confirm choices",
      "save & exit",
      "save preferences",
      "continue",
      "proceed",
      // Spanish
      "aceptar todo",
      "aceptar todas( las cookies)?",
      "aceptar cookies",
      "aceptar",
      "permitir todo",
      "permitir todas",
      "entendido",
      "de acuerdo",
      // German
      "alle akzeptieren",
      "alle cookies akzeptieren",
      "akzeptieren",
      "zustimmen",
      "einverstanden",
      "verstanden",
      "alles annehmen",
      "cookies akzeptieren",
      // French
      "tout accepter",
      "accepter tous les cookies",
      "accepter",
      "j'accepte",
      "compris",
      "j'ai compris",
      "d'accord",
      "autoriser tout",
      // Portuguese
      "aceitar todos",
      "aceitar todas( as cookies)?",
      "aceitar cookies",
      "aceitar",
      "concordar",
      "entendi",
      // Italian
      "accetta tutti",
      "accetta cookies",
      "accetta",
      "accetto",
      "ho capito",
      "consenti tutti",
      // Dutch
      "alles accepteren",
      "accepteren",
      "akkoord",
      "begrepen"
    ].join("|") +
    ")\\s*$",
  "i"
);

async function dismissScopeCookieBanners(scope: Page | Frame): Promise<boolean> {
  let dismissed = false;

  // 1. Try specialized selectors first
  for (const selector of SPECIALIZED_ACCEPT_SELECTORS) {
    try {
      const locator = scope.locator(selector).first();
      if ((await locator.count().catch(() => 0)) > 0 && (await locator.isVisible().catch(() => false))) {
        await locator.click({ timeout: 1000, force: true }).catch(() => undefined);
        dismissed = true;
        break;
      }
    } catch {
      // Continue to next selector
    }
  }

  // 2. Multi-lingual matching, strictly inside a cookie/consent container.
  if (!dismissed) {
    try {
      const cookieContainerButtons = scope
        .locator(
          "[class*='cookie' i] button, [id*='cookie' i] button, [class*='consent' i] button, [id*='consent' i] button, [aria-label*='cookie' i], [aria-label*='consent' i], button.osano-cm-btn"
        )
        .filter({ hasText: ACCEPT_TEXT_REGEX });

      const count = await cookieContainerButtons.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 3); i++) {
        const btn = cookieContainerButtons.nth(i);
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

  // 3. Check for cookie-specific close controls.
  if (!dismissed) {
    try {
      const closeButtons = scope.locator(
        "[role='dialog'][class*='cookie' i] button[aria-label*='close' i], [class*='cookie' i] button[aria-label*='close' i], [id*='cookie' i] button[aria-label*='close' i], .osano-cm-close"
      );
      if ((await closeButtons.count().catch(() => 0)) > 0 && (await closeButtons.first().isVisible().catch(() => false))) {
        await closeButtons.first().click({ timeout: 1000, force: true }).catch(() => undefined);
        dismissed = true;
      }
    } catch {
      // Continue
    }
  }

  return dismissed;
}

export async function dismissCookieBanners(page: Page): Promise<boolean> {
  let dismissed = false;

  // 1. Process main page
  try {
    const mainDismissed = await dismissScopeCookieBanners(page);
    if (mainDismissed) dismissed = true;
  } catch {
    // Continue
  }

  // 2. Process all child iframes
  try {
    const frames = page.frames();
    for (const frame of frames) {
      if (frame !== page.mainFrame()) {
        const frameDismissed = await dismissScopeCookieBanners(frame).catch(() => false);
        if (frameDismissed) dismissed = true;
      }
    }
  } catch {
    // Continue
  }

  return dismissed;
}
