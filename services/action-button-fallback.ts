import fs from "node:fs/promises";
import path from "node:path";
import type { Page, BrowserContext, Locator } from "playwright";
import type { LeadData, SubmitContactFormResult } from "@/types/automation";
import { dismissCookieBanners } from "./cookie-consent-helper";
import { isAuthorizedCaptchaTestTarget } from "./captcha/test-environment";
import { detectUnsupportedVerification } from "./verification-detector";

const SCREENSHOT_DIR = path.join(process.cwd(), "public", "screenshots");

function slugify(value: string) {
  return value
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 70);
}

async function takeDiagnosticScreenshot(page: Page, websiteUrl: string, label: string): Promise<string | null> {
  try {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    const fileName = `${Date.now()}-${slugify(websiteUrl)}-${label}.png`;
    const absolutePath = path.join(SCREENSHOT_DIR, fileName);
    try {
      await page.screenshot({ path: absolutePath, fullPage: false, timeout: 3000 });
    } catch {
      await page.screenshot({ path: absolutePath, fullPage: false, timeout: 2000 });
    }
    return `/screenshots/${fileName}`;
  } catch (err) {
    console.warn("[action-button-fallback] Screenshot capture skipped:", err);
    return null;
  }
}

export interface ActionButtonCandidate {
  index: number;
  tagName: string;
  text: string;
  ariaLabel: string;
  title: string;
  href: string;
  target: string;
  onclick: string;
  isModalTrigger: boolean;
  isDirectExternalCommunication?: boolean;
  score: number;
  reason: string;
  fingerprint: string;
  selector?: string;
}

export const ACTION_BUTTON_KEYWORDS: Array<{
  pattern: RegExp;
  score: number;
  label: string;
}> = [
  // 1. High-priority Booking / Scheduling
  { pattern: /\bbook(\s*a)?\s*(call|meeting|appointment|demo|now|consultation|session)\b/i, score: 125, label: "Book CTA" },
  { pattern: /\bschedule(\s*a)?\s*(meeting|call|consultation|appointment|now|demo|session)\b/i, score: 120, label: "Schedule CTA" },
  { pattern: /\bmake\s*an?\s*appointment\b/i, score: 115, label: "Make an Appointment" },
  { pattern: /\bmeeting\s*now\b/i, score: 115, label: "Meeting Now" },
  { pattern: /\breserve\s*now\b/i, score: 110, label: "Reserve Now" },
  { pattern: /\brequest(\s*a)?\s*(booking|reservation)\b/i, score: 110, label: "Request a Booking" },
  { pattern: /\bfree\s*consultation\b/i, score: 110, label: "Free Consultation" },
  { pattern: /\b(schedule|book)\s*a\s*consultation\b/i, score: 110, label: "Schedule a Consultation" },

  // 2. High-priority Calling & Contacting
  { pattern: /\bcontact\s*(us|me)?\b/i, score: 105, label: "Contact Us" },
  { pattern: /\bget\s*in\s*(touch|contact)\b/i, score: 105, label: "Get in Touch" },
  { pattern: /\btalk\s*to\s*(us|our\s*team|sales|a?\s*specialist|an?\s*expert|a?\s*consultant)\b/i, score: 100, label: "Talk to Us" },
  { pattern: /\bspeak\s*(to|with)\s*(us|sales|our\s*team|an?\s*expert|a?\s*specialist)\b/i, score: 100, label: "Speak to Us" },
  { pattern: /\blet'?s\s*talk\b/i, score: 95, label: "Let's Talk" },
  { pattern: /\brequest(\s*a)?\s*call(back)?\b/i, score: 95, label: "Request a Call" },
  { pattern: /\bcall\s*(me\s*back|us|now)\b/i, score: 90, label: "Call Us" },

  // 3. Meetings & Consultations
  { pattern: /\bmeet\s*(with\s*)?(us|the\s*team)\b/i, score: 95, label: "Meet Us" },
  { pattern: /\bjoin\s*(a\s*)?meeting\b/i, score: 90, label: "Join Meeting" },
  { pattern: /\bstart\s*(a\s*)?meeting\b/i, score: 90, label: "Start Meeting" },
  { pattern: /\bconsult\s*us\b/i, score: 90, label: "Consult Us" },
  { pattern: /\brequest(\s*a)?\s*consultation\b/i, score: 95, label: "Request a Consultation" },

  // 4. Sales, Demos, and Business Inquiries
  { pattern: /\b(request|book|get)(\s*a)?\s*demo\b/i, score: 100, label: "Demo CTA" },
  { pattern: /\b(request|get)(\s*a)?\s*quote\b/i, score: 95, label: "Request a Quote" },
  { pattern: /\b(enquire\s*now|send(\s*an)?\s*inquiry|make\s*an\s*inquiry|inquire\s*now|inquire)\b/i, score: 95, label: "Inquire" },
  { pattern: /\brequest\s*information\b/i, score: 90, label: "Request Information" },
  { pattern: /\bask\s*an?\s*expert\b/i, score: 90, label: "Ask an Expert" },
  { pattern: /\bconnect\s*with\s*us\b/i, score: 90, label: "Connect with Us" },
  { pattern: /\bcontact\s*sales\b/i, score: 95, label: "Contact Sales" },
  { pattern: /\bwork\s*with\s*us\b/i, score: 85, label: "Work with Us" },
  { pattern: /\bstart\s*a\s*project\b/i, score: 85, label: "Start a Project" },
  { pattern: /\bget\s*started\b/i, score: 80, label: "Get Started" },
  { pattern: /\bstart\s*now\b/i, score: 80, label: "Start Now" },
  { pattern: /\bjoin\s*now\b/i, score: 80, label: "Join Now" },
  { pattern: /\bregister\s*now\b/i, score: 75, label: "Register Now" },

  // 5. Customer messaging & support CTAs (inspected for contact forms)
  { pattern: /\b(message|email)\s*us\b/i, score: 80, label: "Message Us" },
  { pattern: /\b(help\s*and\s*support|customer\s*support)\b/i, score: 75, label: "Customer Support" },
  { pattern: /\blet'?s\s*connect\b/i, score: 75, label: "Let's Connect" },
  { pattern: /\bdiscover\s*more\b/i, score: 65, label: "Discover More" },

  // 6. Multilingual equivalents
  { pattern: /\b(contacto|cont[aá]ctenos|contactez[- ]nous|kontakt|contattaci|pedir\s*cita|cita\s*previa|devis|termin\s*vereinbaren|agendar|habla\s*con\s*nosotros|solicitar\s*demo)\b/i, score: 100, label: "Multilingual Contact" }
];

export const SCHEDULER_URL_PATTERN =
  /calendly\.com|meetings(-[a-z0-9]+)?\.hubspot\.com|leadconnectorhq\.com\/widget\/booking|acuityscheduling\.com|tidycal\.com|simplybook\.me|youcanbook\.me|calendarhero\.com|appointlet\.com|setmore\.com|cal\.com/i;

export const NEGATIVE_BUTTON_PATTERN =
  /\b(cart|checkout|basket|bag|shop|pricing|price|login|log[- ]?in|sign[- ]?in|my[- ]?account|forgot[- ]?password|password|wishlist|cookie|privacy|terms|legal|blog|news|press|careers|jobs|team|about[- ]?us|read[- ]?more|learn[- ]?more|download|view[- ]?more|share|facebook|twitter|instagram|linkedin|youtube|tiktok|filter|sort|search)\b/i;

export function isCalendlyUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "calendly.com" && !hostname.endsWith(".calendly.com")) return false;
    // Calendly event URLs have owner and event-slug (e.g. /asktheegghead/30min)
    return url.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

export function isSchedulerUrl(urlStr: string): boolean {
  return SCHEDULER_URL_PATTERN.test(urlStr);
}

/**
 * Inspects the current page DOM and identifies ranked action buttons, links, and triggers
 * likely to lead to a contact form, booking interface, scheduling widget, or consultation modal.
 */
export async function discoverActionButtonsOnPage(
  page: Page,
  maxCandidates: number = 4
): Promise<ActionButtonCandidate[]> {
  try {
    const candidates = await page.evaluate(() => {
      const elements = Array.from(
        document.querySelectorAll(
          "button, a, [role='button'], input[type='button'], input[type='submit'], [class*='btn'], [class*='button'], [data-modal-target], [data-target], [data-bs-target], [data-action]"
        )
      );

      const NEGATIVE_REGEX =
        /\b(cart|checkout|basket|bag|shop|pricing|price|login|log[- ]?in|sign[- ]?in|my[- ]?account|forgot[- ]?password|password|wishlist|cookie|privacy|terms|legal|blog|news|press|careers|jobs|team|about[- ]?us|read[- ]?more|learn[- ]?more|download|view[- ]?more|share|filter|sort|search)\b/i;

      const SCHEDULER_REGEX =
        /calendly\.com|meetings(-[a-z0-9]+)?\.hubspot\.com|leadconnectorhq\.com\/widget\/booking|acuityscheduling\.com|tidycal\.com|simplybook\.me|youcanbook\.me|calendarhero\.com|appointlet\.com|setmore\.com|cal\.com/i;

      const KEYWORD_RULES = [
        // 1. High-priority Booking / Scheduling
        { pattern: /\bbook(\s*a)?\s*(call|meeting|appointment|demo|now|consultation|session)\b/i, score: 125, label: "Book CTA" },
        { pattern: /\bschedule(\s*a)?\s*(meeting|call|consultation|appointment|now|demo|session)\b/i, score: 120, label: "Schedule CTA" },
        { pattern: /\bmake\s*an?\s*appointment\b/i, score: 115, label: "Make an Appointment" },
        { pattern: /\bmeeting\s*now\b/i, score: 115, label: "Meeting Now" },
        { pattern: /\breserve\s*now\b/i, score: 110, label: "Reserve Now" },
        { pattern: /\brequest(\s*a)?\s*(booking|reservation)\b/i, score: 110, label: "Request a Booking" },
        { pattern: /\bfree\s*consultation\b/i, score: 110, label: "Free Consultation" },
        { pattern: /\b(schedule|book)\s*a\s*consultation\b/i, score: 110, label: "Schedule a Consultation" },

        // 2. High-priority Calling & Contacting
        { pattern: /\bcontact\s*(us|me)?\b/i, score: 105, label: "Contact Us" },
        { pattern: /\bget\s*in\s*(touch|contact)\b/i, score: 105, label: "Get in Touch" },
        { pattern: /\btalk\s*to\s*(us|our\s*team|sales|a?\s*specialist|an?\s*expert|a?\s*consultant)\b/i, score: 100, label: "Talk to Us" },
        { pattern: /\bspeak\s*(to|with)\s*(us|sales|our\s*team|an?\s*expert|a?\s*specialist)\b/i, score: 100, label: "Speak to Us" },
        { pattern: /\blet'?s\s*talk\b/i, score: 95, label: "Let's Talk" },
        { pattern: /\brequest(\s*a)?\s*call(back)?\b/i, score: 95, label: "Request a Call" },
        { pattern: /\bcall\s*(me\s*back|us|now)\b/i, score: 90, label: "Call Us" },

        // 3. Meetings & Consultations
        { pattern: /\bmeet\s*(with\s*)?(us|the\s*team)\b/i, score: 95, label: "Meet Us" },
        { pattern: /\bjoin\s*(a\s*)?meeting\b/i, score: 90, label: "Join Meeting" },
        { pattern: /\bstart\s*(a\s*)?meeting\b/i, score: 90, label: "Start Meeting" },
        { pattern: /\bconsult\s*us\b/i, score: 90, label: "Consult Us" },
        { pattern: /\brequest(\s*a)?\s*consultation\b/i, score: 95, label: "Request a Consultation" },

        // 4. Sales, Demos, and Business Inquiries
        { pattern: /\b(request|book|get)(\s*a)?\s*demo\b/i, score: 100, label: "Demo CTA" },
        { pattern: /\b(request|get)(\s*a)?\s*quote\b/i, score: 95, label: "Request a Quote" },
        { pattern: /\b(enquire\s*now|send(\s*an)?\s*inquiry|make\s*an\s*inquiry|inquire\s*now|inquire)\b/i, score: 95, label: "Inquire" },
        { pattern: /\brequest\s*information\b/i, score: 90, label: "Request Information" },
        { pattern: /\bask\s*an?\s*expert\b/i, score: 90, label: "Ask an Expert" },
        { pattern: /\bconnect\s*with\s*us\b/i, score: 90, label: "Connect with Us" },
        { pattern: /\bcontact\s*sales\b/i, score: 95, label: "Contact Sales" },
        { pattern: /\bwork\s*with\s*us\b/i, score: 85, label: "Work with Us" },
        { pattern: /\bstart\s*a\s*project\b/i, score: 85, label: "Start a Project" },
        { pattern: /\bget\s*started\b/i, score: 80, label: "Get Started" },
        { pattern: /\bstart\s*now\b/i, score: 80, label: "Start Now" },
        { pattern: /\bjoin\s*now\b/i, score: 80, label: "Join Now" },
        { pattern: /\bregister\s*now\b/i, score: 75, label: "Register Now" },

        // 5. Customer messaging & support CTAs (inspected for contact forms)
        { pattern: /\b(message|email)\s*us\b/i, score: 80, label: "Message Us" },
        { pattern: /\b(help\s*and\s*support|customer\s*support)\b/i, score: 75, label: "Customer Support" },
        { pattern: /\blet'?s\s*connect\b/i, score: 75, label: "Let's Connect" },
        { pattern: /\bdiscover\s*more\b/i, score: 65, label: "Discover More" },

        // 6. Multilingual equivalents
        { pattern: /\b(contacto|cont[aá]ctenos|contactez[- ]nous|kontakt|contattaci|pedir\s*cita|cita\s*previa|devis|termin\s*vereinbaren|agendar|habla\s*con\s*nosotros|solicitar\s*demo)\b/i, score: 100, label: "Multilingual Contact" }
      ];

      const results: Array<{
        index: number;
        tagName: string;
        text: string;
        ariaLabel: string;
        title: string;
        href: string;
        target: string;
        onclick: string;
        isModalTrigger: boolean;
        isDirectExternalCommunication: boolean;
        score: number;
        reason: string;
        fingerprint: string;
      }> = [];

      const seenFingerprints = new Set<string>();

      for (let i = 0; i < elements.length; i++) {
        const el = elements[i] as HTMLElement;

        // Visibility & layout check
        const style = window.getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        ) {
          continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;

        const tagName = el.tagName.toLowerCase();
        const text = (el.textContent || (el as HTMLInputElement).value || "").trim().replace(/\s+/g, " ");
        const ariaLabel = (el.getAttribute("aria-label") || "").trim();
        const title = (el.getAttribute("title") || "").trim();
        const href = (el.getAttribute("href") || "").trim();
        const target = (el.getAttribute("target") || "").trim();
        const onclick = (el.getAttribute("onclick") || "").trim();
        const id = (el.id || "").trim();
        const className = (el.className || "").toString().trim();

        // Nearby context check (e.g. parent heading or container text)
        const parentText = (el.parentElement?.textContent || "").slice(0, 150).replace(/\s+/g, " ");

        const combinedText = [text, ariaLabel, title, id, className, href, onclick].join(" ").toLowerCase();

        // Exclude clear negative actions
        if (NEGATIVE_REGEX.test(combinedText)) {
          continue;
        }

        // Exclude social media links
        if (/facebook\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|youtube\.com|tiktok\.com|pinterest\.com/i.test(href)) {
          continue;
        }

        // Exclude raw mailto/tel unless labeled as an action button
        if (/^mailto:/i.test(href) && !/contact|enquir|quote|touch|consult/i.test(text)) {
          continue;
        }
        if (/^tel:/i.test(href) && !/call\s*us|call\s*now|book\s*a\s*call/i.test(text)) {
          continue;
        }

        // Exclude submit button if it is already inside a visible <form> that has inputs
        if (tagName === "button" || (tagName === "input" && (el as HTMLInputElement).type === "submit")) {
          const parentForm = el.closest("form");
          if (parentForm) {
            const inputs = parentForm.querySelectorAll("input:not([type='hidden']), textarea, select");
            if (inputs.length >= 2) {
              // This is a normal form submit button, not a discovery action button
              continue;
            }
          }
        }

        let score = 0;
        let matchedReason = "";

        // Check if destination is a direct scheduling service
        if (SCHEDULER_REGEX.test(href) || SCHEDULER_REGEX.test(onclick)) {
          score += 150;
          matchedReason = "External scheduler URL detected (Calendly/HubSpot/LeadConnector)";
        }

        // Match against priority keywords
        for (const rule of KEYWORD_RULES) {
          if (rule.pattern.test(text) || rule.pattern.test(ariaLabel) || rule.pattern.test(title)) {
            if (rule.score > score) {
              score = rule.score;
              matchedReason = `Matched keyword "${rule.label}"`;
            }
          }
        }

        // Destination URL path matches (for <a> tags)
        if (
          href &&
          /(?:^|\/)(contact|contact-us|contactus|get-in-touch|book-a-call|book-call|schedule|schedule-a-call|book-now|meeting|consultation|quote|get-a-quote|request-quote|get-started|inquire|lets-talk)(?:\/|\?|#|$)/i.test(
            href
          )
        ) {
          score += 40;
          if (!matchedReason) matchedReason = `Href path matched contact/booking route: "${href}"`;
        }

        // Modal / Popup trigger attributes
        const isModalTrigger =
          el.hasAttribute("data-modal-target") ||
          el.hasAttribute("data-drawer") ||
          el.hasAttribute("data-drawer-trigger") ||
          el.getAttribute("data-bs-toggle") === "modal" ||
          el.getAttribute("data-toggle") === "modal" ||
          el.getAttribute("aria-haspopup") === "dialog" ||
          /drawer|offcanvas|modal/i.test(el.getAttribute("aria-controls") || "") ||
          /drawer|offcanvas|modal/i.test(el.getAttribute("data-target") || "") ||
          href.startsWith("#contact") ||
          href.startsWith("#book") ||
          href.startsWith("#modal");

        if (isModalTrigger) {
          score += 25;
          if (!matchedReason) matchedReason = "Modal/dialog trigger element";
        }

        // Location / prominence boosts
        const isHeaderOrNav = Boolean(el.closest("header, nav, [role='navigation'], .navbar, .site-header"));
        const isHeroOrCta = Boolean(el.closest(".hero, .cta, [class*='banner'], [class*='hero'], [class*='call-to-action']"));
        if (isHeaderOrNav) score += 15;
        if (isHeroOrCta) score += 15;

        // Minimum score threshold
        if (score <= 0) continue;

        const fingerprint = `${tagName}:${text.toLowerCase().slice(0, 30)}:${href.toLowerCase().slice(0, 50)}:${id}`;
        if (seenFingerprints.has(fingerprint)) continue;
        seenFingerprints.add(fingerprint);

        const isDirectExternalCommunication =
          href.startsWith("tel:") ||
          href.startsWith("mailto:") ||
          /whatsapp\.com|wa\.me/i.test(href);

        el.setAttribute("data-sdi-action-button", String(results.length));

        results.push({
          index: results.length,
          tagName,
          text,
          ariaLabel,
          title,
          href,
          target,
          onclick,
          isModalTrigger,
          isDirectExternalCommunication,
          score,
          reason: matchedReason || "Context-aware action button",
          fingerprint
        });
      }

      // Sort descending by score
      results.sort((a, b) => b.score - a.score);
      return results;
    });

    return candidates.slice(0, maxCandidates);
  } catch (err) {
    console.warn("[action-button-fallback] Error scanning action buttons:", err);
    return [];
  }
}

export interface ActionButtonExecutionInput {
  page: Page;
  websiteUrl: string;
  leadData: LeadData;
  submit: boolean;
  liveSubmit?: boolean;
  timeoutMs: number;
  browserContext?: BrowserContext;
  skipPersist?: boolean;
  userId?: string;
  maxCandidates?: number;
}

export interface ActionButtonExecutionResult {
  handled: boolean;
  result?: SubmitContactFormResult;
  discoveredType?: "contact_form" | "calendly" | "booking_widget";
  discoveredUrl?: string;
  reason?: string;
}

/**
 * Reusable fallback engine:
 * When no contact form is found on the initial page, searches for action buttons/links
 * ("Book Now", "Book a Call", "Schedule a Meeting", "Contact Us", "Get a Quote", etc.),
 * clicks them in priority order, handles any resulting new tab, popup, modal, or page navigation,
 * and automates the discovered contact form or booking widget.
 */
export async function executeActionButtonFallback({
  page,
  websiteUrl,
  leadData,
  submit,
  liveSubmit,
  timeoutMs,
  browserContext,
  skipPersist,
  userId,
  maxCandidates = 4
}: ActionButtonExecutionInput): Promise<ActionButtonExecutionResult> {
  const shouldSubmit = liveSubmit !== undefined ? liveSubmit : submit;
  const context = browserContext ?? page.context();

  console.log(`[ACTION-BUTTON-FALLBACK] Searching for action buttons/links on ${websiteUrl} ...`);
  const candidates = await discoverActionButtonsOnPage(page, maxCandidates);

  if (candidates.length === 0) {
    console.log(`[ACTION-BUTTON-FALLBACK] No suitable action buttons or booking links found on ${websiteUrl}.`);
    return { handled: false, reason: "No suitable action buttons or links detected." };
  }

  console.log(
    `[ACTION-BUTTON-FALLBACK] Found ${candidates.length} candidate action button(s): ` +
    candidates.map((c) => `"${c.text || c.ariaLabel || c.href}" (score=${c.score})`).join(", ")
  );

  const attemptedFingerprints = new Set<string>();

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (attemptedFingerprints.has(candidate.fingerprint)) continue;
    attemptedFingerprints.add(candidate.fingerprint);

    console.log(`[ACTION-BUTTON-FALLBACK] Attempting candidate ${i + 1}/${candidates.length}: "${candidate.text}" [${candidate.tagName}] (href="${candidate.href}", score=${candidate.score})`);

    // Safe interaction rule: do NOT trigger native OS dialers, email clients, or messaging apps
    if (candidate.isDirectExternalCommunication) {
      console.log(`[ACTION-BUTTON-FALLBACK] Candidate "${candidate.text}" is a direct communication link (${candidate.href}). Skipping automated activation to follow safe interaction policy.`);
      continue;
    }

    // Diagnostic screenshot before clicking
    await takeDiagnosticScreenshot(page, websiteUrl, `before-action-btn-${i + 1}`).catch(() => null);

    // Fast path: if candidate is a direct link to Calendly or other external booking URL
    if (candidate.href && isCalendlyUrl(candidate.href)) {
      console.log(`[ACTION-BUTTON-FALLBACK] Direct Calendly link detected: ${candidate.href}. Delegating to Calendly automation.`);
      try {
        const { submitCalendlyBooking } = await import("./calendly-booking-automation");
        const calResult = await submitCalendlyBooking({
          websiteUrl: candidate.href,
          leadData,
          liveSubmit: shouldSubmit,
          browserContext: context,
          skipPersist: true,
          timeoutMs: Math.min(timeoutMs, 15000)
        });
        return {
          handled: true,
          result: calResult,
          discoveredType: "calendly",
          discoveredUrl: candidate.href,
          reason: `Calendly booking link found: "${candidate.text}"`
        };
      } catch (calErr: any) {
        console.warn(`[ACTION-BUTTON-FALLBACK] Calendly automation failed for ${candidate.href}:`, calErr);
        // Continue to next candidate
      }
    }

    // Set up new tab listener on browser context
    let newTabOpened: Page | null = null;
    let onPageHandler: ((p: Page) => void) | null = null;
    const newTabPromise = new Promise<Page | null>((resolve) => {
      onPageHandler = (p: Page) => {
        newTabOpened = p;
        resolve(p);
      };
      context.on("page", onPageHandler);
      setTimeout(() => resolve(null), 3500);
    });

    const urlBeforeClick = page.url();

    // Click candidate locator
    const candidateLocator = page.locator(`[data-sdi-action-button='${candidate.index}']`).first();
    let clickSucceeded = false;

    try {
      if (await candidateLocator.isVisible().catch(() => false)) {
        await candidateLocator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
        await candidateLocator.click({ timeout: 3500 });
        clickSucceeded = true;
      }
    } catch {
      // Fallback: Dispatch synthetic click in DOM
      clickSucceeded = await candidateLocator.evaluate((el: HTMLElement) => {
        el.click();
        return true;
      }).catch(() => false);
    }

    if (onPageHandler) {
      context.off("page", onPageHandler);
    }

    if (!clickSucceeded) {
      console.log(`[ACTION-BUTTON-FALLBACK] Candidate ${i + 1} could not be clicked; trying next candidate.`);
      continue;
    }

    const newTab = await Promise.race([
      newTabPromise,
      new Promise<null>((r) => setTimeout(() => r(null), 3000))
    ]);

    // ==========================================
    // CASE 1: A NEW TAB / WINDOW OPENED
    // ==========================================
    if (newTab) {
      console.log(`[ACTION-BUTTON-FALLBACK] New browser tab opened! URL: ${newTab.url()}`);
      try {
        await newTab.bringToFront().catch(() => {});
        await newTab.waitForLoadState("domcontentloaded", { timeout: 6000 }).catch(() => {});
        await dismissCookieBanners(newTab).catch(() => {});
        await takeDiagnosticScreenshot(newTab, newTab.url(), `new-tab-opened-${i + 1}`).catch(() => null);

        const newTabUrl = newTab.url();

        // 1a. If new tab is a Calendly scheduling page
        if (isCalendlyUrl(newTabUrl)) {
          console.log(`[ACTION-BUTTON-FALLBACK] New tab is Calendly: ${newTabUrl}. Executing Calendly automation.`);
          const { submitCalendlyBooking } = await import("./calendly-booking-automation");
          const calResult = await submitCalendlyBooking({
            websiteUrl: newTabUrl,
            leadData,
            liveSubmit: shouldSubmit,
            browserContext: context,
            skipPersist: true,
            timeoutMs: Math.min(timeoutMs, 15000)
          });
          await newTab.close().catch(() => {});
          return {
            handled: true,
            result: calResult,
            discoveredType: "calendly",
            discoveredUrl: newTabUrl,
            reason: `Calendly scheduling tab opened via "${candidate.text}"`
          };
        }

        // 1b. If new tab is another supported booking scheduler (e.g. HubSpot, LeadConnector)
        if (isSchedulerUrl(newTabUrl)) {
          console.log(`[ACTION-BUTTON-FALLBACK] New tab is external scheduler: ${newTabUrl}`);
          const { submitGenericBookingWidget } = await import("./generic-booking-widget-automation");
          const genResult = await submitGenericBookingWidget({
            websiteUrl: newTabUrl,
            leadData,
            liveSubmit: shouldSubmit,
            browserContext: context,
            skipPersist: true,
            timeoutMs: Math.min(timeoutMs, 40000)
          });
          await newTab.close().catch(() => {});
          return {
            handled: true,
            result: genResult,
            discoveredType: "booking_widget",
            discoveredUrl: newTabUrl,
            reason: `External booking scheduler opened in new tab via "${candidate.text}"`
          };
        }

        // 1c. Check if new tab renders a contact form
        const { submitContactForm } = await import("./contact-form-automation");
        const contactResult = await submitContactForm({
          websiteUrl: newTabUrl,
          leadData,
          submit,
          liveSubmit,
          timeoutMs: Math.min(timeoutMs, 35000),
          browserContext: context,
          skipPersist: true,
          userId,
          skipActionButtons: true,
          activePage: newTab
        });

        if (contactResult.status === "success" || contactResult.status === "dry_run_ready_to_book") {
          console.log(`[ACTION-BUTTON-FALLBACK] Contact form on new tab submitted successfully!`);
          await newTab.close().catch(() => {});
          return {
            handled: true,
            result: contactResult,
            discoveredType: "contact_form",
            discoveredUrl: newTabUrl,
            reason: `Contact form discovered and submitted in new tab via "${candidate.text}"`
          };
        }

        // If new tab did not yield a valid form, close it and return focus
        await newTab.close().catch(() => {});
      } catch (newTabErr: any) {
        console.warn(`[ACTION-BUTTON-FALLBACK] Error processing new tab:`, newTabErr?.message || newTabErr);
        await newTab.close().catch(() => {});
      }
    }

    // ==========================================
    // CASE 2: CURRENT PAGE NAVIGATED TO NEW URL
    // ==========================================
    if (page.url() !== urlBeforeClick) {
      const currentUrl = page.url();
      console.log(`[ACTION-BUTTON-FALLBACK] Button navigated to: ${currentUrl}`);
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 6000 }).catch(() => {});
        await dismissCookieBanners(page).catch(() => {});
        await takeDiagnosticScreenshot(page, currentUrl, `navigated-${i + 1}`).catch(() => null);

        if (isCalendlyUrl(currentUrl)) {
          const { submitCalendlyBooking } = await import("./calendly-booking-automation");
          const calResult = await submitCalendlyBooking({
            websiteUrl: currentUrl,
            leadData,
            liveSubmit: shouldSubmit,
            browserContext: context,
            skipPersist: true,
            timeoutMs: Math.min(timeoutMs, 15000)
          });
          return {
            handled: true,
            result: calResult,
            discoveredType: "calendly",
            discoveredUrl: currentUrl,
            reason: `Navigated to Calendly via "${candidate.text}"`
          };
        }

        const { submitContactForm } = await import("./contact-form-automation");
        const contactResult = await submitContactForm({
          websiteUrl: currentUrl,
          leadData,
          submit,
          liveSubmit,
          timeoutMs: Math.min(timeoutMs, 35000),
          browserContext: context,
          skipPersist: true,
          userId,
          skipActionButtons: true,
          activePage: page
        });

        if (contactResult.status === "success" || contactResult.status === "dry_run_ready_to_book") {
          return {
            handled: true,
            result: contactResult,
            discoveredType: "contact_form",
            discoveredUrl: currentUrl,
            reason: `Contact form navigated to via "${candidate.text}"`
          };
        }

        // Navigate back to restore page state for remaining candidates
        await page.goBack({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(500);
      } catch (navErr) {
        console.warn(`[ACTION-BUTTON-FALLBACK] Error inspecting navigated page:`, navErr);
        await page.goBack({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }

    // ==========================================
    // CASE 3: IN-PAGE MODAL / POPUP / DRAWER / EMBEDDED WIDGET
    // ==========================================
    console.log(`[ACTION-BUTTON-FALLBACK] Checking for in-page modal/popup/drawer or dynamic iframe on current page...`);
    await page.waitForTimeout(800);
    const { unhideHiddenFormContainers, detectBookingWidget } = await import("./contact-form-automation");
    await unhideHiddenFormContainers(page).catch(() => {});
    await dismissCookieBanners(page).catch(() => {});

    // Check if an embedded Calendly or scheduling iframe appeared
    const bookingWidget = await detectBookingWidget(page, 0);
    if (bookingWidget.found) {
      console.log(`[ACTION-BUTTON-FALLBACK] Booking widget appeared after clicking "${candidate.text}": ${bookingWidget.reason}`);
      await takeDiagnosticScreenshot(page, page.url(), `modal-booking-widget-${i + 1}`).catch(() => null);

      if (bookingWidget.widgetType === "calendly") {
        const { submitCalendlyBooking } = await import("./calendly-booking-automation");
        const calResult = await submitCalendlyBooking({
          websiteUrl: page.url(),
          leadData,
          liveSubmit: shouldSubmit,
          browserContext: context,
          skipPersist: true,
          timeoutMs: Math.min(timeoutMs, 40000)
        });
        return {
          handled: true,
          result: calResult,
          discoveredType: "calendly",
          discoveredUrl: page.url(),
          reason: `Calendly modal opened via "${candidate.text}"`
        };
      }

      const { submitGenericBookingWidget } = await import("./generic-booking-widget-automation");
      const genResult = await submitGenericBookingWidget({
        websiteUrl: page.url(),
        leadData,
        liveSubmit: shouldSubmit,
        browserContext: context,
        skipPersist: true,
        timeoutMs: Math.min(timeoutMs, 40000)
      });
      return {
        handled: true,
        result: genResult,
        discoveredType: "booking_widget",
        discoveredUrl: page.url(),
        reason: `Booking widget opened via "${candidate.text}"`
      };
    }

    // Check if a form appeared in modal / popup / dialog
    try {
      const { submitContactForm } = await import("./contact-form-automation");
      const contactResult = await submitContactForm({
        websiteUrl: page.url(),
        leadData,
        submit,
        liveSubmit,
        timeoutMs: Math.min(timeoutMs, 25000),
        browserContext: context,
        skipPersist: true,
        userId,
        skipActionButtons: true,
        activePage: page
      });

      if (contactResult.status === "success" || contactResult.status === "dry_run_ready_to_book") {
        console.log(`[ACTION-BUTTON-FALLBACK] Form inside modal/popup submitted successfully!`);
        return {
          handled: true,
          result: contactResult,
          discoveredType: "contact_form",
          discoveredUrl: page.url(),
          reason: `Modal form submitted via "${candidate.text}"`
        };
      }
    } catch {
      // Modal didn't contain a valid form
    }

    // Try closing any open modal before moving to the next candidate
    await page.evaluate(() => {
      const closeButtons = Array.from(
        document.querySelectorAll(
          "[aria-label*='close' i], .modal-close, .close, .btn-close, [data-dismiss='modal'], [data-bs-dismiss='modal']"
        )
      ) as HTMLElement[];
      for (const btn of closeButtons) {
        if (btn.offsetParent !== null) {
          btn.click();
          break;
        }
      }
    }).catch(() => {});
    await page.waitForTimeout(300);
  }

  // All candidates exhausted
  await takeDiagnosticScreenshot(page, websiteUrl, "action-buttons-exhausted").catch(() => null);
  return {
    handled: false,
    reason: `Checked ${candidates.length} action button(s), but none revealed a usable contact form or booking interface.`
  };
}
