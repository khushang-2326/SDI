import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Locator, type Page, type Frame, type BrowserContext } from "playwright";
import { getChromiumExecutablePath } from "@/services/browser-executable";
import { prisma } from "@/lib/prisma";
import {
  isProxyAuthenticationFailure,
  ProxyAuthenticationError,
  PROXY_407_MESSAGE,
  redactProxyDetails
} from "@/services/proxy-helper";
import { detectUnsupportedVerification } from "@/services/verification-detector";
import { isAuthorizedCaptchaTestTarget } from "@/services/captcha/test-environment";
import { handleCaptchaSolvingForTarget } from "@/services/captcha/captcha-orchestrator";
import {
  LeadData,
  SubmitContactFormInput,
  SubmitContactFormResult,
  StageTimingMetrics
} from "@/types/automation";
import { dismissCookieBanners, startParallelCookieGuardian, installCookieGuardianInitScript, type CookieGuardianController } from "./cookie-consent-helper";
import { buildAllPhoneFormats, resolveOptimalPhoneValue } from "./phone-format-helper";
import { waitForUniversalPageReadiness } from "./page-readiness";
import { evaluateFinalAutomationSuccess } from "./success-invariants";
import {
  type FieldSignals,
  type SemanticFieldType,
  type FieldClassification,
  type FieldVerificationItem,
  type FormFillMetrics,
  type UnmappedRequiredFieldDetail,
  extractFieldSignals,
  classifyField,
  classifyAllFormFields,
  isHoneypotField,
  splitFullName,
  solveMathOrSpamChallenge,
  COMMON_INPUT_SELECTOR
} from "./field-classifier";

type FieldKey = "fullName" | "email" | "mobile" | "city" | "address" | "message" | "companyName" | "website" | "jobTitle";

export function resolveSpintax(text: string): string {
  if (!text) return text;
  let result = text;
  const regex = /\{([^{}]+)\}/g;
  while (regex.test(result)) {
    result = result.replace(regex, (_, choices) => {
      const parts = choices.split("|");
      return parts[Math.floor(Math.random() * parts.length)].trim();
    });
  }
  return result;
}

type FieldCandidate = {
  index: number;
  descriptor: string;
  tagName: string;
  type: string;
};

export type BookingLifecycleState =
  | "BOOKING_NOT_FOUND"
  | "BOOKING_CONTAINER_FOUND"
  | "BOOKING_LOADING"
  | "BOOKING_FRAME_FOUND"
  | "BOOKING_READY"
  | "BOOKING_NO_INVENTORY"
  | "BOOKING_BLOCKED"
  | "BOOKING_FAILED";

export type BookingWidgetDetection = {
  found: boolean;
  state: BookingLifecycleState;
  reason: string | null;
  frameCount?: number;
  frameURLs?: string[];
  widgetType?: string | null;
};

type FormScope = Page | Locator;

const SCREENSHOT_DIR = path.join(process.cwd(), "public", "screenshots");
const DEMO_USER_EMAIL = "demo@lead-auto-submitter.local";
const NAME_FIELD_PATTERN = /(?:full[ _-]?name|first[ _-]?name|firstname|fname|given[ _-]?name|middle[ _-]?name|middlename|mname|last[ _-]?name|lastname|lname|surname|family[ _-]?name)/i;

const FIELD_KEYWORDS: Record<FieldKey, string[]> = {
  fullName: [
    "full name",
    "fullname",
    "your name",
    "name",
    "first name",
    "last name",
    "contact name"
  ],
  email: ["email", "e-mail", "mail", "email address", "work email", "email_address", "emailaddress"],
  mobile: ["phone", "mobile", "telephone", "tel", "cell", "contact number", "phone number", "mobile number", "cell phone", "work phone", "phonenumber", "whatsapp", "whatsapp number"],
  city: ["city", "town", "municipality"],
  address: ["address", "street", "street address", "mailing address", "physical address", "business address", "addr"],
  message: ["message", "comment", "comments", "details", "description", "note", "enquiry", "inquiry", "how can we help", "project details", "brief", "tell us about"],
  companyName: ["company", "business", "organization", "organisation", "brand", "company name", "business name", "firm", "employer"],
  website: ["website", "web site", "url", "domain", "company website", "site url", "web page", "web address"],
  jobTitle: ["job title", "title", "role", "position", "occupation"]
};

const FIELD_VALUES: Record<FieldKey, (leadData: LeadData) => string | undefined> = {
  fullName: (leadData) => leadData.fullName,
  email: (leadData) => leadData.email,
  mobile: (leadData) => leadData.mobile ?? leadData.mobileNumber ?? leadData.phone,
  city: (leadData) => leadData.city,
  address: (leadData) => leadData.address,
  message: (leadData) => leadData.message,
  companyName: (leadData) => leadData.companyName,
  website: (leadData) => leadData.website,
  jobTitle: (leadData) => leadData.jobTitle
};

function normalizeStatus(status: SubmitContactFormResult["status"]) {
  if (status === "success") return "Success";
  if (status === "booking_widget_found") return "Retry Needed";
  return "Failed";
}

function slugify(value: string) {
  return value
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 70);
}

function scoreCandidate(candidate: FieldCandidate, fieldKey: FieldKey) {
  const descriptor = candidate.descriptor.toLowerCase();
  const keywords = FIELD_KEYWORDS[fieldKey];
  let score = 0;

  for (const keyword of keywords) {
    if (descriptor.includes(keyword)) {
      score += keyword.length > 5 ? 3 : 2;
    }
  }

  if (fieldKey === "email" && candidate.type === "email") score += 6;
  if (fieldKey === "website" && candidate.type === "url") score += 6;
  if (fieldKey === "jobTitle" && descriptor.includes("title")) score += 4;
  // Never allow name matching to claim a browser-typed email control simply
  // because nearby labels include the word "name".
  if (fieldKey === "fullName" && candidate.type === "email") score -= 100;
  if (fieldKey === "mobile" && ["tel", "phone"].includes(candidate.type)) score += 6;
  if (fieldKey === "message" && candidate.tagName === "textarea") score += 5;
  if (fieldKey === "fullName" && descriptor.includes("username")) score -= 6;
  if (fieldKey === "companyName" && descriptor.includes("name")) score += 1;

  return score;
}

async function collectFieldCandidates(scope: FormScope): Promise<FieldCandidate[]> {
  return scope.locator(COMMON_INPUT_SELECTOR).evaluateAll((elements) =>
    elements.map((element, index) => {
      const input = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const id = input.id;
      const labels = Array.from((input as HTMLInputElement).labels ?? []).map(
        (label) => label.textContent ?? ""
      );
      const explicitLabel = id
        ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent ?? ""
        : "";
      const nearbyText = input.closest("p, div, li, label")?.textContent ?? "";
      const siblingText = [
        input.previousElementSibling?.textContent,
        input.nextElementSibling?.textContent,
        input.parentElement?.previousElementSibling?.textContent,
        input.parentElement?.nextElementSibling?.textContent
      ];

      return {
        index,
        descriptor: [
          input.getAttribute("name"),
          id,
          input.getAttribute("placeholder"),
          input.getAttribute("aria-label"),
          input.getAttribute("autocomplete"),
          explicitLabel,
          ...labels,
          nearbyText,
          ...siblingText
        ]
          .filter(Boolean)
          .join(" "),
        tagName: input.tagName.toLowerCase(),
        type: (input.getAttribute("type") ?? "").toLowerCase()
      };
    })
  );
}

async function blockHeavyAssets(page: Page) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    const url = request.url().toLowerCase();

    // Always allow critical CAPTCHA and verification services
    if (
      url.includes("recaptcha") ||
      url.includes("hcaptcha") ||
      url.includes("turnstile") ||
      url.includes("challenges.cloudflare") ||
      url.includes("gstatic.com/recaptcha") ||
      url.includes("2captcha") ||
      url.includes("anticaptcha") ||
      url.includes("capmonster")
    ) {
      await route.continue().catch(() => undefined);
      return;
    }

    // Preserve necessary CRM, form endpoints, and booking widgets
    if (
      url.includes("hubspot") ||
      url.includes("hsforms") ||
      url.includes("calendly") ||
      url.includes("leadconnector") ||
      url.includes("typeform") ||
      url.includes("pardot") ||
      url.includes("marketo") ||
      url.includes("wp-json") ||
      url.includes("admin-ajax")
    ) {
      await route.continue().catch(() => undefined);
      return;
    }

    // Abort heavy media, images, video streams, fonts, and third-party trackers
    const isHeavyMedia = ["media", "font", "image"].includes(resourceType) ||
      /\.(mp4|webm|avi|mov|mkv|ogg|wmv|flv|m4v|png|jpg|jpeg|webp|gif|svg|ico|bmp|tiff|avif)(\?.*)?$/i.test(url);

    const isTrackerOrAd =
      url.includes("google-analytics") ||
      url.includes("googletagmanager") ||
      url.includes("googleadservices") ||
      url.includes("doubleclick") ||
      url.includes("facebook.net") ||
      url.includes("connect.facebook") ||
      url.includes("hotjar") ||
      url.includes("clarity.ms") ||
      url.includes("crazyegg") ||
      url.includes("linkedin.com/tag") ||
      url.includes("snapchat.com") ||
      url.includes("tiktok.com") ||
      url.includes("intercom.io") ||
      url.includes("drift.com") ||
      url.includes("fullstory") ||
      url.includes("criteo.net") ||
      url.includes("taboola") ||
      url.includes("outbrain");

    if (isHeavyMedia || isTrackerOrAd) {
      await route.abort().catch(() => undefined);
      return;
    }

    await route.continue().catch(() => undefined);
  });
}

async function safelyFillField(
  locator: Locator,
  value: string
): Promise<{ success: boolean; verified: boolean; actualValue?: string }> {
  const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "input");
  const inputType = await locator.evaluate((element) => (element.getAttribute("type") || "").toLowerCase()).catch(() => "text");

  // Custom styled checkboxes / radios often have opacity:0 or are hidden by parent label
  if (inputType === "checkbox") {
    await locator.check({ force: true }).catch(async () => {
      await locator.click({ force: true }).catch(() => undefined);
    });
    await locator.evaluate((el: HTMLInputElement) => {
      el.checked = true;
      const tracker = (el as any)._valueTracker;
      if (tracker) tracker.setValue(false);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if ((window as any).jQuery) {
        try { (window as any).jQuery(el).trigger("change"); } catch {}
      }
    }).catch(() => undefined);
    const checked = await locator.isChecked().catch(() => true);
    return { success: true, verified: checked, actualValue: "checked" };
  }

  if (inputType === "radio") {
    await locator.check({ force: true }).catch(async () => {
      await locator.click({ force: true }).catch(() => undefined);
    });
    await locator.evaluate((el: HTMLInputElement) => {
      el.checked = true;
      const tracker = (el as any)._valueTracker;
      if (tracker) tracker.setValue(false);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if ((window as any).jQuery) {
        try { (window as any).jQuery(el).trigger("change"); } catch {}
      }
    }).catch(() => undefined);
    return { success: true, verified: true, actualValue: "selected" };
  }

  if (!(await locator.isVisible().catch(() => false))) return { success: false, verified: false };
  if (!(await locator.isEnabled().catch(() => false))) return { success: false, verified: false };

  if (tagName === "select") {
    const isPlaceholder = (text: string, val: string) => {
      const pPattern = /^(select|choose|please\s+(select|choose)|which|pick\s+an?|--|none\b|0\b|^$)/i;
      return !val || pPattern.test(text.trim()) || (val === "" && pPattern.test(text.trim()));
    };

    // 1. Try matching user target value
    let matchedIndex = -1;
    if (value && value.trim()) {
      const targetNorm = value.trim().toLowerCase();
      matchedIndex = await locator.evaluate((el: HTMLSelectElement, norm: string) => {
        return Array.from(el.options).findIndex((opt) => {
          if (opt.disabled) return false;
          const label = (opt.textContent || "").trim().toLowerCase();
          const val = (opt.value || "").trim().toLowerCase();
          return label === norm || val === norm || label.includes(norm) || (norm.length > 3 && norm.includes(label));
        });
      }, targetNorm).catch(() => -1);
    }

    // 2. If no matching option, select second option as by default (User requested: "for dropdown select second option as by default")
    if (matchedIndex < 0) {
      matchedIndex = await locator.evaluate((el: HTMLSelectElement) => {
        const placeholderPattern = /^(select|choose|please\s+(select|choose)|which|pick\s+an?|--|none\b|0\b|^$)/i;
        if (el.options.length > 1) {
          const secondOpt = el.options[1];
          if (!secondOpt.disabled && !placeholderPattern.test((secondOpt.textContent || "").trim())) {
            return 1;
          }
        }
        if (el.options.length > 2) {
          for (let i = 2; i < el.options.length; i++) {
            const opt = el.options[i];
            if (!opt.disabled && !placeholderPattern.test((opt.textContent || "").trim())) {
              return i;
            }
          }
        }
        return Array.from(el.options).findIndex((opt) => {
          if (opt.disabled) return false;
          const label = (opt.textContent || "").trim();
          const val = (opt.value || "").trim();
          return Boolean(val || label) && !placeholderPattern.test(label) && !(val === "" && placeholderPattern.test(label));
        });
      }).catch(() => -1);
    }

    if (matchedIndex >= 0) {
      try {
        await locator.selectOption({ index: matchedIndex }, { timeout: 3000 });
      } catch {
        await locator.evaluate((el: HTMLSelectElement, idx: number) => {
          el.selectedIndex = idx;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, matchedIndex).catch(() => undefined);
      }

      const selectVal = await locator.inputValue().catch(() => "");
      const selectedOptionText = await locator.evaluate((el: HTMLSelectElement) => {
        const opt = el.options[el.selectedIndex];
        return opt ? (opt.textContent || opt.value || "").trim() : "";
      }).catch(() => "");

      const isStillPlaceholder = isPlaceholder(selectedOptionText, selectVal);
      if (!isStillPlaceholder) {
        return { success: true, verified: true, actualValue: selectedOptionText || selectVal };
      }
    }

    return { success: false, verified: false, actualValue: undefined };
  }

  let fillValue = value;

  // Guard against [object HTMLInputElement] or non-string values being typed
  if (typeof fillValue !== "string" || fillValue.includes("[object")) {
    if (fillValue && typeof fillValue === "object") {
      fillValue = (fillValue as any).value || (fillValue as any).textContent || "";
    } else {
      fillValue = String(fillValue ?? "");
    }
    if (fillValue.includes("[object") || !fillValue.trim()) {
      fillValue = "";
    }
  }

  // Obey maxlength constraints to avoid browser truncation validation failures
  const maxLen = await locator.evaluate((el: HTMLInputElement) => el.maxLength > 0 ? el.maxLength : 0).catch(() => 0);
  if (maxLen > 0 && fillValue.length > maxLen) {
    fillValue = fillValue.slice(0, maxLen);
  }

  // Universal Recovery: Ensure valid email, location ("New York"), and jobTitle values
  if (tagName === "input" || tagName === "textarea") {
    const nameAttr = await locator.getAttribute("name").catch(() => "") || "";
    const idAttr = await locator.getAttribute("id").catch(() => "") || "";
    const placeholderAttr = await locator.getAttribute("placeholder").catch(() => "") || "";
    const ariaAttr = await locator.getAttribute("aria-label").catch(() => "") || "";
    const fullId = `${nameAttr} ${idAttr} ${placeholderAttr} ${ariaAttr}`.toLowerCase();

    const isEmailLike = inputType === "email" || (fullId.includes("mail") && !/mailing[ _-]?address|mail[ _-]?address/i.test(fullId));
    if (isEmailLike && (!fillValue || fillValue.includes("[object") || !fillValue.includes("@"))) {
      fillValue = "aadityavarma490@gmail.com";
    }

    const isLocationLike = fullId.includes("location") && !fullId.includes("user_location");
    if (isLocationLike && (!fillValue || fillValue.trim() === "")) {
      fillValue = "New York";
    }

    const isJobLike = /\b(job[ _-]?title|title|role|position|occupation|designation|jobtitle)\b/i.test(fullId);
    if (isJobLike && (!fillValue || fillValue.trim() === "")) {
      fillValue = "Business Consultant";
    }
  }

  // Obey phone input patterns/masks based on website requirements (all mobile formats supported)
  if (inputType === "tel" || tagName === "input") {
    const nameAttr = await locator.getAttribute("name").catch(() => "") || "";
    const idAttr = await locator.getAttribute("id").catch(() => "") || "";
    const isPhoneLike = inputType === "tel" || /phone|tel|mobile|whatsapp/i.test(`${nameAttr} ${idAttr}`);
    if (isPhoneLike && /\d{4,}/.test(fillValue)) {
      fillValue = await resolveOptimalPhoneValue(locator, fillValue);
    }
  }

  await locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => undefined);

  // Strategy 1: Playwright native fill (clears, focuses, inputs, dispatches trusted native events)
  let strategy1Ok = false;
  try {
    await locator.fill(fillValue, { timeout: 3500 });
    const check1 = await locator.inputValue().catch(() => "");
    if (check1 && (check1.toLowerCase().includes(fillValue.slice(0, 4).toLowerCase()) || fillValue.toLowerCase().includes(check1.slice(0, 4).toLowerCase()))) {
      strategy1Ok = true;
    }
  } catch {}

  // Strategy 2: If Strategy 1 failed, click + select all + backspace + pressSequentially
  if (!strategy1Ok) {
    try {
      await locator.click({ timeout: 2000, force: true });
      await locator.press("ControlOrMeta+A").catch(() => undefined);
      await locator.press("Backspace").catch(() => undefined);
      await locator.pressSequentially(fillValue, { delay: 10, timeout: 4000 });
    } catch {}
  }

  // Strategy 3: React / Vue / Angular controlled component value tracker synchronization
  const check2 = await locator.inputValue().catch(() => "");
  if (!check2 || !check2.toLowerCase().includes(fillValue.slice(0, 4).toLowerCase())) {
    await locator.evaluate((el: HTMLElement, val: string) => {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      const proto = input.tagName.toLowerCase() === "textarea" 
        ? window.HTMLTextAreaElement.prototype 
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) {
        setter.call(input, val);
      } else {
        input.value = val;
      }
      const tracker = (input as any)._valueTracker;
      if (tracker) {
        tracker.setValue(val + "_sync");
      }
      input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: val, inputType: "insertText" }));
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
    }, fillValue).catch(() => undefined);
  }

  // Verification step
  let currentValue = await locator.inputValue().catch(() => "");
  const verified = Boolean(
    currentValue &&
    (currentValue.toLowerCase().includes(fillValue.slice(0, 4).toLowerCase()) ||
     fillValue.toLowerCase().includes(currentValue.slice(0, 4).toLowerCase()))
  );

  return { success: verified, verified, actualValue: currentValue };
}

async function safelyFillCityField(
  locator: Locator,
  userCity?: string
): Promise<{ success: boolean; verified: boolean; actualValue?: string }> {
  if (!(await locator.isVisible().catch(() => false))) return { success: false, verified: false };
  if (!(await locator.isEnabled().catch(() => false))) return { success: false, verified: false };

  const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "input");
  const targetVal = (userCity && userCity.trim()) ? userCity.trim() : "New York";

  if (tagName !== "select") {
    return safelyFillField(locator, targetVal);
  }

  // For native <select>, match option by value/label or select first real option
  const matchingOptionIndex = await locator.evaluate((element, val) => {
    const select = element as HTMLSelectElement;
    const targetNorm = val.toLowerCase();
    const isNY = targetNorm === "new york" || targetNorm === "nyc" || targetNorm === "ny";
    return Array.from(select.options).findIndex((option) => {
      const label = (option.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      const value = (option.value || "").trim().toLowerCase();
      if (isNY) {
        if (value === "ny" || value === "nyc" || value === "new york" || value === "new_york") return true;
        if (label === "new york" || label === "new york city" || label === "nyc") return true;
      }
      return label === targetNorm || value === targetNorm || label.includes(targetNorm);
    });
  }, targetVal).catch(() => -1);

  if (matchingOptionIndex >= 0) {
    await locator.selectOption({ index: matchingOptionIndex }).catch(() => undefined);
    const selectVal = await locator.inputValue().catch(() => "");
    return { success: true, verified: true, actualValue: selectVal };
  }

  const didSelect = await selectFirstRealOption(locator);
  const selectVal = await locator.inputValue().catch(() => "");
  return { success: didSelect, verified: didSelect, actualValue: selectVal };
}

async function safelyFillStateField(
  locator: Locator,
  userState?: string
): Promise<{ success: boolean; verified: boolean; actualValue?: string }> {
  if (!(await locator.isVisible().catch(() => false))) return { success: false, verified: false };
  if (!(await locator.isEnabled().catch(() => false))) return { success: false, verified: false };

  const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "input");
  const targetVal = (userState && userState.trim()) ? userState.trim() : "New York";

  if (tagName !== "select") {
    return safelyFillField(locator, targetVal);
  }

  // For native <select>, match option by value/label or select first real option
  const matchingOptionIndex = await locator.evaluate((element, val) => {
    const select = element as HTMLSelectElement;
    const targetNorm = val.toLowerCase();
    const isNY = targetNorm === "new york" || targetNorm === "ny";
    return Array.from(select.options).findIndex((option) => {
      const label = (option.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      const value = (option.value || "").trim().toLowerCase();
      if (isNY) {
        if (value === "ny" || value === "new york" || value === "new_york") return true;
        if (label === "new york" || label === "ny") return true;
      }
      return label === targetNorm || value === targetNorm || label.includes(targetNorm);
    });
  }, targetVal).catch(() => -1);

  if (matchingOptionIndex >= 0) {
    await locator.selectOption({ index: matchingOptionIndex }).catch(() => undefined);
    const selectVal = await locator.inputValue().catch(() => "");
    return { success: true, verified: true, actualValue: selectVal };
  }

  const didSelect = await selectFirstRealOption(locator);
  const selectVal = await locator.inputValue().catch(() => "");
  return { success: didSelect, verified: didSelect, actualValue: selectVal };
}

async function safelyFillCountryField(
  locator: Locator,
  userCountry?: string
): Promise<{ success: boolean; verified: boolean; actualValue?: string }> {
  if (!(await locator.isVisible().catch(() => false))) return { success: false, verified: false };
  if (!(await locator.isEnabled().catch(() => false))) return { success: false, verified: false };

  const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "input");
  const targetVal = (userCountry && userCountry.trim()) ? userCountry.trim() : "United States";

  if (tagName !== "select") {
    return safelyFillField(locator, targetVal);
  }

  // For native <select>, match option by value/label or select first real option
  const matchingOptionIndex = await locator.evaluate((element, val) => {
    const select = element as HTMLSelectElement;
    const targetNorm = val.toLowerCase();
    const isUS = targetNorm === "united states" || targetNorm === "us" || targetNorm === "usa" || targetNorm === "u.s.";
    return Array.from(select.options).findIndex((option) => {
      const label = (option.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      const value = (option.value || "").trim().toLowerCase();
      if (isUS) {
        if (value === "us" || value === "usa" || value === "united states" || value === "840" || value === "united_states") return true;
        if (label === "united states" || label === "united states of america" || label === "usa" || label === "u.s.a." || label === "us" || label === "u.s.") return true;
      }
      return label === targetNorm || value === targetNorm || label.includes(targetNorm);
    });
  }, targetVal).catch(() => -1);

  if (matchingOptionIndex >= 0) {
    await locator.selectOption({ index: matchingOptionIndex }).catch(() => undefined);
    const selectVal = await locator.inputValue().catch(() => "");
    return { success: true, verified: true, actualValue: selectVal };
  }

  const didSelect = await selectFirstRealOption(locator);
  const selectVal = await locator.inputValue().catch(() => "");
  return { success: didSelect, verified: didSelect, actualValue: selectVal };
}

async function selectDefaultDropdownOption(locator: Locator): Promise<boolean> {
  const isEn = await locator.isEnabled().catch(() => false);
  if (!isEn) return false;

  // User requested: "for dropdown select second option as by default"
  const targetIdx = await locator.evaluate((element) => {
    const select = element as HTMLSelectElement;
    if (!select || select.tagName.toLowerCase() !== "select") return -1;

    // Do not make arbitrary selections for sensitive, legal, or high-risk declarations
    const combinedDesc = `${select.name || ""} ${select.id || ""} ${select.getAttribute("aria-label") || ""}`.toLowerCase();
    const isSensitive = /(payment|credit[ _-]?card|pay\b|waiver|liability|legally[ _-]?binding|billing[ _-]?authori)/i.test(combinedDesc);
    if (isSensitive) return -1;

    const pPattern = /^(select|choose|please\s+(select|choose)|which|pick\s+an?|--|none\b|0\b|^$)/i;
    const isRealOption = (option: HTMLOptionElement) => {
      const label = (option.textContent ?? "").replace(/\s+/g, " ").trim();
      const val = (option.value ?? "").trim();
      const isPlaceholder = pPattern.test(label) || pPattern.test(val) || (val === "" && pPattern.test(label));
      return !option.disabled && val !== "" && !isPlaceholder;
    };

    // If already on a valid non-placeholder option beyond index 0, we can keep it
    const selected = select.options[select.selectedIndex];
    if (selected && select.selectedIndex > 0 && isRealOption(selected)) return select.selectedIndex;

    // Prefer the second option (index 1) by default
    let idx = -1;
    if (select.options.length > 1) {
      const opt1 = select.options[1];
      if (!opt1.disabled && !pPattern.test((opt1.textContent || "").trim())) {
        idx = 1;
      }
    }

    // If option 1 is disabled or placeholder, look at subsequent options (index 2, 3...)
    if (idx < 0 && select.options.length > 2) {
      for (let i = 2; i < select.options.length; i++) {
        const opt = select.options[i];
        if (!opt.disabled && !pPattern.test((opt.textContent || "").trim())) {
          idx = i;
          break;
        }
      }
    }

    // Fallback: any non-placeholder real option
    if (idx < 0) {
      idx = Array.from(select.options).findIndex(isRealOption);
    }
    if (idx < 0) {
      idx = Array.from(select.options).findIndex((opt) => !opt.disabled && (opt.textContent ?? "").trim() && !pPattern.test((opt.textContent ?? "").trim()));
    }
    if (idx < 0 && select.options.length > 1) idx = 1;
    if (idx < 0 && select.options.length === 1) idx = 0;
    return idx;
  }).catch(() => -1);

  if (targetIdx < 0) return false;

  // Try Playwright native selectOption first (trusted user gesture)
  try {
    await locator.selectOption({ index: targetIdx }, { timeout: 2500 }).catch(() => undefined);
  } catch {}

  // ALWAYS dispatch synthetic input, change, and blur events and update React value tracker
  await locator.evaluate((element, idx) => {
    const select = element as HTMLSelectElement;
    if (!select || !select.options || !select.options[idx]) return;
    select.selectedIndex = idx;
    const opt = select.options[idx];
    if (opt) {
      // If option value is empty but required, set value to label so HTML5 constraint validation passes
      if (select.required && !opt.value) {
        opt.value = (opt.textContent || "").trim();
      }
      select.value = opt.value;
    }
    const tracker = (select as any)._valueTracker;
    if (tracker) tracker.setValue("");
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.dispatchEvent(new Event("blur", { bubbles: true }));
    if ((window as any).jQuery) {
      try { (window as any).jQuery(select).trigger("change"); } catch {}
    }
  }, targetIdx).catch(() => undefined);

  // Verify that the selected option is valid
  const verified = await locator.evaluate((element) => {
    const select = element as HTMLSelectElement;
    const opt = select.options[select.selectedIndex];
    if (!opt) return false;
    const label = (opt.textContent ?? "").replace(/\s+/g, " ").trim();
    const val = (opt.value ?? "").trim();
    const pPattern = /^(select|choose|please\s+(select|choose)|which|pick\s+an?|--|none\b|0\b|^$)/i;
    const hasValidText = Boolean(label) && !pPattern.test(label);
    const hasValidVal = Boolean(val) && !pPattern.test(val);
    return (hasValidVal || hasValidText) && !select.matches(":invalid");
  }).catch(() => false);

  return verified;
}

const selectFirstRealOption = selectDefaultDropdownOption;

async function sweepAndSelectRequiredDropdowns(scope: FormScope): Promise<string[]> {
  const selects = scope.locator("select");
  const count = await selects.count().catch(() => 0);
  const selectedDropdowns: string[] = [];

  for (let i = 0; i < count; i++) {
    const sel = selects.nth(i);
    if (!(await sel.isVisible().catch(() => false)) || !(await sel.isEnabled().catch(() => false))) continue;

    const needsSelection = await sel.evaluate((el: HTMLSelectElement) => {
      const isReq = el.required || el.getAttribute("aria-required") === "true" || el.matches(":invalid");
      const pPattern = /^(select|choose|please\s+(select|choose)|which|pick\s+an?|--|none\b|0\b|^$)/i;
      const opt = el.options[el.selectedIndex];
      const val = (opt?.value || el.value || "").trim();
      const txt = (opt?.textContent || "").trim();
      const hasValid = Boolean(val || txt) && !pPattern.test(txt) && !(val === "" && pPattern.test(txt));
      const shouldPickSecond = (el.selectedIndex === 0 || !hasValid) && el.options.length > 1;
      return (isReq && !hasValid) || shouldPickSecond;
    }).catch(() => false);

    if (needsSelection) {
      const didSelect = await selectFirstRealOption(sel);
      if (didSelect) {
        selectedDropdowns.push(`required_select:${i}`);
      }
    }
  }
  return selectedDropdowns;
}

async function reVerifyAndSelfHealFilledFields(
  scope: FormScope,
  items: FieldVerificationItem[]
): Promise<number> {
  const fields = scope.locator(COMMON_INPUT_SELECTOR);
  let healedCount = 0;

  for (const item of items) {
    if (!item.finalValue || (item.fieldType as string) === "checkbox" || (item.fieldType as string) === "radio") continue;
    try {
      const loc = fields.nth(item.fieldIndex);
      if (!(await loc.isVisible().catch(() => false))) continue;

      const currentVal = await loc.inputValue().catch(() => "");
      const expected = item.finalValue;
      const isStillGood = currentVal && (
        currentVal.toLowerCase().includes(expected.slice(0, 4).toLowerCase()) ||
        expected.toLowerCase().includes(currentVal.slice(0, 4).toLowerCase())
      );

      if (!isStillGood) {
        console.warn(`[contact-form-automation] Post-hydration recovery: field ${item.fieldIndex} (${item.fieldType}) lost value (current="${currentVal}"). Re-filling...`);
        const refill = await safelyFillField(loc, expected);
        if (refill.success) {
          item.verified = refill.verified;
          item.finalValue = refill.actualValue;
          healedCount++;
        }
      }
    } catch {
      // Continue
    }
  }

  return healedCount;
}

export async function selectRequiredRadioDefaults(scope: FormScope): Promise<string[]> {
  const filled: string[] = [];
  try {
    const isLoc = Boolean((scope as any).count && typeof (scope as any).count === "function");
    const radioResults = isLoc
      ? await (scope as Locator).evaluate((el: HTMLElement) => {
          const results: string[] = [];
          const allRadios = Array.from(el.querySelectorAll("input[type='radio']")) as HTMLInputElement[];
          const groups = new Map<string, HTMLInputElement[]>();

          for (const r of allRadios) {
            if (r.disabled) continue;
            const groupName = r.name || `unnamed_radio_${r.id || Math.random()}`;
            if (!groups.has(groupName)) groups.set(groupName, []);
            groups.get(groupName)!.push(r);
          }

          for (const [name, radios] of groups) {
            const anyChecked = radios.some((r) => r.checked);
            if (!anyChecked && radios.length > 0) {
              const first = radios[0];
              first.checked = true;
              first.dispatchEvent(new Event("input", { bubbles: true }));
              first.dispatchEvent(new Event("change", { bubbles: true }));
              if ((window as any).jQuery) {
                try { (window as any).jQuery(first).trigger("change"); } catch {}
              }

              const label = first.id ? el.querySelector(`label[for='${first.id}']`) : first.closest("label");
              if (label && (label as HTMLElement).offsetParent !== null) {
                try { (label as HTMLElement).click(); } catch {}
              } else {
                try { first.click(); } catch {}
              }

              results.push(`radio:${name}`);
            }
          }
          return results;
        })
      : await (scope as Page).evaluate(() => {
          const results: string[] = [];
          const allRadios = Array.from(document.querySelectorAll("input[type='radio']")) as HTMLInputElement[];
          const groups = new Map<string, HTMLInputElement[]>();

          for (const r of allRadios) {
            if (r.disabled) continue;
            const groupName = r.name || `unnamed_radio_${r.id || Math.random()}`;
            if (!groups.has(groupName)) groups.set(groupName, []);
            groups.get(groupName)!.push(r);
          }

          for (const [name, radios] of groups) {
            const anyChecked = radios.some((r) => r.checked);
            if (!anyChecked && radios.length > 0) {
              const first = radios[0];
              first.checked = true;
              first.dispatchEvent(new Event("input", { bubbles: true }));
              first.dispatchEvent(new Event("change", { bubbles: true }));
              if ((window as any).jQuery) {
                try { (window as any).jQuery(first).trigger("change"); } catch {}
              }

              const label = first.id ? document.querySelector(`label[for='${first.id}']`) : first.closest("label");
              if (label && (label as HTMLElement).offsetParent !== null) {
                try { (label as HTMLElement).click(); } catch {}
              } else {
                try { first.click(); } catch {}
              }

              results.push(`radio:${name}`);
            }
          }
          return results;
        });

    filled.push(...radioResults);
  } catch (err) {
    console.warn("[contact-form-automation] Error selecting radio defaults:", err);
  }
  return filled;
}

/**
 * Universal Button & Pill Selection Group Auto-Selector.
 * When a form contains selection button groups (e.g. Project Budget pills, Project Type pills,
 * Service chips, Timeline tags, etc.) where options are represented by clickable buttons or pills,
 * automatically selects the first valid button in each unselected group.
 */
export async function selectFirstOptionInButtonGroups(scope: FormScope): Promise<string[]> {
  const selected: string[] = [];
  try {
    const isLoc = Boolean((scope as any).count && typeof (scope as any).count === "function");
    const groupResults = isLoc
      ? await (scope as Locator).evaluate((el: HTMLElement) => {
          const root = el;
          const results: { groupName: string; clickedText: string }[] = [];
          const NON_OPTION_TEXT = /^(submit|send|send message|contact us|get in touch|request quote|request a quote|submit inquiry|book now|schedule|next|continue|attach|upload|browse|add file|\+ attach file|cancel|close|back|previous|search|login|sign in)$/i;

          const candidateContainers = Array.from(
            root.querySelectorAll(
              "[role='radiogroup'], [role='group'], [class*='budget' i], [class*='project-type' i], [class*='project_type' i], [class*='service' i], [class*='pills' i], [class*='chips' i], [class*='tags' i], [class*='options' i], [class*='choices' i], [class*='segmented' i], [class*='selection' i], fieldset, div"
            )
          ) as HTMLElement[];

          const buttonParents = new Set<HTMLElement>();
          const allTypeButtons = Array.from(root.querySelectorAll("button:not([type='submit']), div[role='button'], a[role='button']")) as HTMLElement[];
          for (const b of allTypeButtons) {
            const p = b.parentElement;
            if (p && !p.closest("nav") && !p.closest("header") && !p.closest("footer") && p.children.length >= 2) {
              buttonParents.add(p);
            }
          }

          const allCandidateContainers = Array.from(new Set([...candidateContainers, ...Array.from(buttonParents)]));

          for (const container of allCandidateContainers) {
            if (container.closest("nav") || container.closest("header") || container.closest("footer")) continue;

            const items = Array.from(
              container.querySelectorAll(
                "button:not([type='submit']), [role='radio'], [role='button'], label:has(input[type='radio']), .pill, .chip, .tag, [class*='choice' i], [class*='pill' i], [class*='btn-option' i]"
              )
            ) as HTMLElement[];

            const validOptions = items.filter((itemEl) => {
              const txt = (itemEl.textContent || "").trim();
              if (!txt || txt.length > 50) return false;
              if (NON_OPTION_TEXT.test(txt)) return false;
              if (itemEl.getAttribute("type") === "submit") return false;
              const rect = itemEl.getBoundingClientRect();
              const style = window.getComputedStyle(itemEl);
              return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0;
            });

            if (validOptions.length < 2 || validOptions.length > 15) continue;

            // Allow buttons wrapped in individual column/div wrappers (e.g. Brights in Image 1)
            const anySelected = validOptions.some((itemEl) => {
              const className = typeof itemEl.className === "string" ? itemEl.className.toLowerCase() : "";
              const isAriaSelected =
                itemEl.getAttribute("aria-checked") === "true" ||
                itemEl.getAttribute("aria-pressed") === "true" ||
                itemEl.getAttribute("aria-selected") === "true" ||
                itemEl.getAttribute("data-state") === "active" ||
                itemEl.getAttribute("data-state") === "checked" ||
                itemEl.getAttribute("data-state") === "on";
              const hasSelectedClass = /\b(active|selected|checked|current|is-active|is-selected|btn-primary)\b/.test(className);
              const hasInnerChecked = Boolean(itemEl.querySelector("input:checked"));
              return isAriaSelected || hasSelectedClass || hasInnerChecked;
            });

            if (!anySelected && validOptions.length > 0) {
              // Per user rule: select 2nd option by default (or 1st if only 1 exists)
              const targetOpt = validOptions.length > 1 ? validOptions[1] : validOptions[0];
              const targetText = (targetOpt.textContent || "").trim();

              ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
                try { targetOpt.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window })); } catch {}
              });
              targetOpt.click();
              targetOpt.dispatchEvent(new Event("change", { bubbles: true }));
              targetOpt.setAttribute("aria-pressed", "true");
              targetOpt.setAttribute("aria-selected", "true");
              targetOpt.setAttribute("aria-checked", "true");
              targetOpt.classList.add("active", "selected", "is-selected", "checked");

              const innerInput = targetOpt.querySelector("input[type='radio'], input[type='checkbox']") as HTMLInputElement | null;
              if (innerInput) {
                innerInput.checked = true;
                innerInput.dispatchEvent(new Event("input", { bubbles: true }));
                innerInput.dispatchEvent(new Event("change", { bubbles: true }));
              }

              results.push({
                groupName: container.getAttribute("aria-label") || container.className.slice(0, 30) || "button_group",
                clickedText: targetText
              });
            }
          }

          return results;
        })
      : await (scope as Page).evaluate(() => {
          const root = document;
          const results: { groupName: string; clickedText: string }[] = [];
          const NON_OPTION_TEXT = /^(submit|send|send message|contact us|get in touch|request quote|request a quote|submit inquiry|book now|schedule|next|continue|attach|upload|browse|add file|\+ attach file|cancel|close|back|previous|search|login|sign in)$/i;

          const candidateContainers = Array.from(
            root.querySelectorAll(
              "[role='radiogroup'], [role='group'], [class*='budget' i], [class*='project-type' i], [class*='project_type' i], [class*='service' i], [class*='pills' i], [class*='chips' i], [class*='tags' i], [class*='options' i], [class*='choices' i], [class*='segmented' i], [class*='selection' i], fieldset, div"
            )
          ) as HTMLElement[];

          const buttonParents = new Set<HTMLElement>();
          const allTypeButtons = Array.from(root.querySelectorAll("button:not([type='submit']), div[role='button'], a[role='button']")) as HTMLElement[];
          for (const b of allTypeButtons) {
            const p = b.parentElement;
            if (p && !p.closest("nav") && !p.closest("header") && !p.closest("footer") && p.children.length >= 2) {
              buttonParents.add(p);
            }
          }

          const allCandidateContainers = Array.from(new Set([...candidateContainers, ...Array.from(buttonParents)]));

          for (const container of allCandidateContainers) {
            if (container.closest("nav") || container.closest("header") || container.closest("footer")) continue;

            const items = Array.from(
              container.querySelectorAll(
                "button:not([type='submit']), [role='radio'], [role='button'], label:has(input[type='radio']), .pill, .chip, .tag, [class*='choice' i], [class*='pill' i], [class*='btn-option' i]"
              )
            ) as HTMLElement[];

            const validOptions = items.filter((itemEl) => {
              const txt = (itemEl.textContent || "").trim();
              if (!txt || txt.length > 50) return false;
              if (NON_OPTION_TEXT.test(txt)) return false;
              if (itemEl.getAttribute("type") === "submit") return false;
              const rect = itemEl.getBoundingClientRect();
              const style = window.getComputedStyle(itemEl);
              return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0;
            });

            if (validOptions.length < 2 || validOptions.length > 15) continue;

            // Allow buttons wrapped in individual column/div wrappers (e.g. Brights in Image 1)
            const anySelected = validOptions.some((itemEl) => {
              const className = typeof itemEl.className === "string" ? itemEl.className.toLowerCase() : "";
              const isAriaSelected =
                itemEl.getAttribute("aria-checked") === "true" ||
                itemEl.getAttribute("aria-pressed") === "true" ||
                itemEl.getAttribute("aria-selected") === "true" ||
                itemEl.getAttribute("data-state") === "active" ||
                itemEl.getAttribute("data-state") === "checked" ||
                itemEl.getAttribute("data-state") === "on";
              const hasSelectedClass = /\b(active|selected|checked|current|is-active|is-selected|btn-primary)\b/.test(className);
              const hasInnerChecked = Boolean(itemEl.querySelector("input:checked"));
              return isAriaSelected || hasSelectedClass || hasInnerChecked;
            });

            if (!anySelected && validOptions.length > 0) {
              // Per user rule: select 2nd option by default (or 1st if only 1 exists)
              const targetOpt = validOptions.length > 1 ? validOptions[1] : validOptions[0];
              const targetText = (targetOpt.textContent || "").trim();

              ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
                try { targetOpt.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window })); } catch {}
              });
              targetOpt.click();
              targetOpt.dispatchEvent(new Event("change", { bubbles: true }));
              targetOpt.setAttribute("aria-pressed", "true");
              targetOpt.setAttribute("aria-selected", "true");
              targetOpt.setAttribute("aria-checked", "true");
              targetOpt.classList.add("active", "selected", "is-selected", "checked");

              const innerInput = targetOpt.querySelector("input[type='radio'], input[type='checkbox']") as HTMLInputElement | null;
              if (innerInput) {
                innerInput.checked = true;
                innerInput.dispatchEvent(new Event("input", { bubbles: true }));
                innerInput.dispatchEvent(new Event("change", { bubbles: true }));
              }

              results.push({
                groupName: container.getAttribute("aria-label") || container.className.slice(0, 30) || "button_group",
                clickedText: targetText
              });
            }
          }

          return results;
        });

    for (const r of groupResults) {
      console.log(`[contact-form-automation] [BUTTON-GROUP] Auto-selected first option: ${r.groupName} -> "${r.clickedText}"`);
      selected.push(`selectionButton:${r.clickedText}`);
    }
  } catch (err) {
    console.warn("[contact-form-automation] Error selecting button group defaults:", err);
  }
  return selected;
}

async function selectCustomDropdownDefaults(scope: FormScope) {
  const dropdowns = scope.locator([
    "[role='combobox']:not(select)",
    "[aria-haspopup='listbox']:not(select)",
    "[aria-haspopup='menu'][role='button']",
    ".select2-selection",
    ".choices__inner",
    ".react-select__control",
    ".dropdown-toggle",
    "[data-radix-collection-item]"
  ].join(", "));
  const filled: string[] = [];
  try {
    const count = await dropdowns.count().catch(() => 0);

    for (let index = 0; index < count; index++) {
      const dropdown = dropdowns.nth(index);
      if (!(await dropdown.isVisible().catch(() => false))) continue;
      if (!(await dropdown.isEnabled().catch(() => false))) continue;

      await dropdown.scrollIntoViewIfNeeded().catch(() => undefined);
      const opened = await dropdown.click({ timeout: 1500 }).then(() => true).catch(() => false);
      if (!opened) continue;

      await dropdown.page().waitForTimeout(150).catch(() => undefined);

      const options = dropdown.page().locator([
        "[role='listbox']:visible [role='option']:visible",
        "[role='menu']:visible [role='menuitem']:visible",
        "[role='option']:visible",
        ".select2-results__option:not(.select2-results__option--disabled):visible",
        ".choices__item--choice:not(.choices__item--disabled):visible",
        ".dropdown-menu .dropdown-item:visible",
        ".react-select__option:visible"
      ].join(", "));
      const optionCount = await options.count().catch(() => 0);
      let selected = false;

      for (let optionIndex = 0; optionIndex < optionCount; optionIndex++) {
        const option = options.nth(optionIndex);
        const optionState = await option.evaluate((element) => ({
          text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
          disabled:
            element.getAttribute("aria-disabled") === "true" ||
            (element as HTMLButtonElement).disabled === true ||
            element.classList.contains("disabled")
        })).catch(() => ({ text: "", disabled: true }));
        const isPlaceholder = /^(select|choose|please\s+(select|choose)|which|pick\s+an?|--|none\b|^$)/i.test(optionState.text);
        if (optionState.disabled || !optionState.text || isPlaceholder) continue;

        selected = await option.click({ timeout: 2000 }).then(() => true).catch(() => false);
        if (selected) {
          filled.push(`custom-dropdown:${index}`);
          break;
        }
      }

      if (!selected) await dropdown.press("Escape").catch(() => undefined);
    }
  } catch {
    // Ignore dropdown evaluation interruptions
  }

  return filled;
}

export async function fillDetectedFields(scope: FormScope, leadData: LeadData): Promise<{
  filledFields: string[];
  skippedFields: string[];
  metrics: FormFillMetrics;
}> {
  const signals = await extractFieldSignals(scope);
  const classifications = classifyAllFormFields(signals);
  const fields = scope.locator(COMMON_INPUT_SELECTOR);

  const usedIndexes = new Set<number>();
  const filledFields: string[] = [];
  const skippedFields: string[] = [];
  const verificationItems: FieldVerificationItem[] = [];

  const fillSignal = async (
    signal: FieldSignals,
    fieldType: SemanticFieldType,
    sourceKey: string,
    value: string,
    confidence: number,
    evidence: string[],
    telemetrySource: "USER_DATA" | "FALLBACK_DATA" | "SELECT_FIRST_VALID_OPTION" = "USER_DATA"
  ): Promise<boolean> => {
    if (usedIndexes.has(signal.index)) return false;
    const locator = fields.nth(signal.index);
    const result = await safelyFillField(locator, value).catch(() => ({ success: false, verified: false, actualValue: undefined }));
    if (result.success) {
      usedIndexes.add(signal.index);
      filledFields.push(sourceKey);
      verificationItems.push({
        fieldIndex: signal.index,
        fieldType,
        mappedSource: `${sourceKey} [${telemetrySource}]`,
        confidence,
        evidence: [...evidence, `source:${telemetrySource}`],
        filled: true,
        verified: result.verified,
        finalValue: result.actualValue
      });
      return true;
    }
    return false;
  };

  const tryFillFieldCandidates = async (
    candidates: Array<{ signal: FieldSignals; cls: FieldClassification }>,
    fieldType: SemanticFieldType,
    sourceKey: string,
    value: string | undefined,
    telemetrySource: "USER_DATA" | "FALLBACK_DATA" | "SELECT_FIRST_VALID_OPTION" = "USER_DATA"
  ): Promise<boolean> => {
    if (!value || !value.trim()) return false;
    for (const item of candidates) {
      if (usedIndexes.has(item.signal.index)) continue;
      const ok = await fillSignal(item.signal, fieldType, sourceKey, value, item.cls.confidence, item.cls.evidence, telemetrySource);
      if (ok) return true;
    }
    return false;
  };

  // 1. Email (prioritize type=email / autocomplete=email / highest confidence)
  const emailCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "email")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  const emailVal = (leadData.email || "").trim();
  if (emailVal) {
    const filled = await tryFillFieldCandidates(emailCandidates, "email", "email", emailVal, "USER_DATA");
    if (!filled && emailCandidates.length > 0) {
      skippedFields.push("email");
    }
  } else {
    skippedFields.push("email");
  }

  // 2. Name Handling (First Name, Middle Name, Last Name, Full Name)
  const nameParts = splitFullName(leadData.fullName || "");
  const userFirstName = (leadData.firstName || nameParts.firstName || "").trim();
  const userMiddleName = (leadData.middleName || nameParts.middleName || "").trim();
  const userFullName = (leadData.fullName || (userFirstName && nameParts.lastName ? `${userFirstName} ${nameParts.lastName}` : userFirstName || "")).trim();

  const firstNameCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "first_name")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  const middleNameCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "middle_name")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  const lastNameCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "last_name")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  const fullNameCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "full_name")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (firstNameCandidates.length > 0 && userFirstName) {
    await tryFillFieldCandidates(firstNameCandidates, "first_name", "firstName", userFirstName, "USER_DATA");
  }

  let finalLastName = (leadData.lastName || nameParts.lastName || "").trim();
  if (middleNameCandidates.length > 0 && userMiddleName) {
    const didFillMiddle = await tryFillFieldCandidates(middleNameCandidates, "middle_name", "middleName", userMiddleName, "USER_DATA");
    if (didFillMiddle && !leadData.lastName && nameParts.pureLastName) {
      finalLastName = nameParts.pureLastName;
    }
  }

  if (lastNameCandidates.length > 0 && finalLastName) {
    await tryFillFieldCandidates(lastNameCandidates, "last_name", "lastName", finalLastName, "USER_DATA");
  }

  // If there are remaining full name candidates
  const unmappedFull = fullNameCandidates.filter((c) => !usedIndexes.has(c.signal.index));
  if (unmappedFull.length >= 2 && userFirstName && finalLastName) {
    await fillSignal(unmappedFull[0].signal, "first_name", "firstName", userFirstName, unmappedFull[0].cls.confidence, unmappedFull[0].cls.evidence, "USER_DATA");
    await fillSignal(unmappedFull[1].signal, "last_name", "lastName", finalLastName, unmappedFull[1].cls.confidence, unmappedFull[1].cls.evidence, "USER_DATA");
  } else if (unmappedFull.length > 0 && userFullName) {
    await tryFillFieldCandidates(unmappedFull, "full_name", "fullName", userFullName, "USER_DATA");
  }

  // 3. Phone / Mobile
  const phoneVal = (leadData.mobile || leadData.mobileNumber || leadData.phone || "").trim();
  const phoneCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "phone")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (phoneVal) {
    await tryFillFieldCandidates(phoneCandidates, "phone", "mobile", phoneVal, "USER_DATA");
  } else {
    skippedFields.push("mobile");
  }

  // 4. Message / Inquiry
  const messageVal = (leadData.message || leadData.inquiry || leadData.comments || leadData.comment || "").trim();
  const messageCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && (item.cls.fieldType === "message" || item.cls.fieldType === "inquiry"))
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (messageVal) {
    await tryFillFieldCandidates(messageCandidates, "message", "message", messageVal, "USER_DATA");
  } else {
    skippedFields.push("message");
  }

  // 5. Company Name
  const companyVal = (leadData.companyName || leadData.company || "").trim();
  const companyCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "company")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (companyVal) {
    await tryFillFieldCandidates(companyCandidates, "company", "companyName", companyVal, "USER_DATA");
  } else {
    skippedFields.push("companyName");
  }

  // 6. Website
  let websiteValue = (leadData.website || leadData.websiteUrl || "").trim();
  if (websiteValue && !/^https?:\/\//i.test(websiteValue)) {
    websiteValue = `https://${websiteValue}`;
  }
  const websiteCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "website")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (!websiteValue && websiteCandidates.some((c) => c.signal.isRequired)) {
    websiteValue = "https://example.com";
  }

  if (websiteValue && websiteCandidates.length > 0) {
    await tryFillFieldCandidates(websiteCandidates, "website", "website", websiteValue, "USER_DATA");
  } else if (websiteCandidates.length > 0) {
    skippedFields.push("website");
  }

  // 7. Subject
  let subjectVal = (leadData.subject || "").trim();
  const subjectCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "subject")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (!subjectVal && subjectCandidates.some((c) => c.signal.isRequired)) {
    subjectVal = "Inquiry regarding your services";
  }

  if (subjectVal && subjectCandidates.length > 0) {
    await tryFillFieldCandidates(subjectCandidates, "subject", "subject", subjectVal, "USER_DATA");
  } else if (subjectCandidates.length > 0) {
    skippedFields.push("subject");
  }

  // 8. City (Defaults to "New York" if not provided)
  const userCity = (leadData.city || leadData.town || "").trim();
  const effectiveCity = userCity || "New York";
  const cityCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "city")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  for (const c of cityCandidates) {
    if (usedIndexes.has(c.signal.index)) continue;
    const loc = fields.nth(c.signal.index);
    if (c.signal.tagName === "select") {
      const fillRes = await safelyFillCityField(loc, effectiveCity);
      if (fillRes.success) {
        usedIndexes.add(c.signal.index);
        filledFields.push("city");
        verificationItems.push({
          fieldIndex: c.signal.index,
          fieldType: "city",
          mappedSource: `city [${userCity ? "USER_DATA" : "DEFAULT_NEW_YORK"}]`,
          confidence: c.cls.confidence,
          evidence: [...c.cls.evidence, `source:${userCity ? "USER_DATA" : "DEFAULT_NEW_YORK"}`],
          filled: true,
          verified: fillRes.verified,
          finalValue: fillRes.actualValue
        });
        break;
      }
    } else {
      const ok = await fillSignal(c.signal, "city", "city", effectiveCity, c.cls.confidence, c.cls.evidence, userCity ? "USER_DATA" : "FALLBACK_DATA");
      if (ok) break;
    }
  }

  // 8b. State / Region
  const userState = (leadData.state || leadData.province || leadData.region || "").trim();
  const effectiveState = userState || "New York";
  const stateCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "state")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  for (const c of stateCandidates) {
    if (usedIndexes.has(c.signal.index)) continue;
    const loc = fields.nth(c.signal.index);
    if (c.signal.tagName === "select") {
      const fillRes = await safelyFillStateField(loc, effectiveState);
      if (fillRes.success) {
        usedIndexes.add(c.signal.index);
        filledFields.push("state");
        verificationItems.push({
          fieldIndex: c.signal.index,
          fieldType: "state",
          mappedSource: `state [${userState ? "USER_DATA" : "DEFAULT_NEW_YORK"}]`,
          confidence: c.cls.confidence,
          evidence: [...c.cls.evidence, `source:${userState ? "USER_DATA" : "DEFAULT_NEW_YORK"}`],
          filled: true,
          verified: fillRes.verified,
          finalValue: fillRes.actualValue
        });
        break;
      }
    } else {
      const ok = await fillSignal(c.signal, "state", "state", effectiveState, c.cls.confidence, c.cls.evidence, userState ? "USER_DATA" : "FALLBACK_DATA");
      if (ok) break;
    }
  }

  // 8c. Country (Defaults to "United States" if not provided)
  const userCountry = (leadData.country || leadData.nation || "").trim();
  const effectiveCountry = userCountry || "United States";
  const countryCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "country")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  for (const c of countryCandidates) {
    if (usedIndexes.has(c.signal.index)) continue;
    const loc = fields.nth(c.signal.index);
    if (c.signal.tagName === "select") {
      const fillRes = await safelyFillCountryField(loc, effectiveCountry);
      if (fillRes.success) {
        usedIndexes.add(c.signal.index);
        filledFields.push("country");
        verificationItems.push({
          fieldIndex: c.signal.index,
          fieldType: "country",
          mappedSource: `country [${userCountry ? "USER_DATA" : "DEFAULT_UNITED_STATES"}]`,
          confidence: c.cls.confidence,
          evidence: [...c.cls.evidence, `source:${userCountry ? "USER_DATA" : "DEFAULT_UNITED_STATES"}`],
          filled: true,
          verified: fillRes.verified,
          finalValue: fillRes.actualValue
        });
        break;
      }
    } else {
      const ok = await fillSignal(c.signal, "country", "country", effectiveCountry, c.cls.confidence, c.cls.evidence, userCountry ? "USER_DATA" : "FALLBACK_DATA");
      if (ok) break;
    }
  }

  // 8d. Address (Street Address)
  const userAddress = (leadData.address || leadData.streetAddress || leadData.street_address || leadData.street || leadData.address1 || "").trim();
  const addrCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "address")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (userAddress) {
    await tryFillFieldCandidates(addrCandidates, "address", "address", userAddress, "USER_DATA");
  } else {
    skippedFields.push("address");
  }

  // 8e. Postal / ZIP code field
  const userPostal = leadData.postalCode || leadData.zip || leadData.postal_code || leadData.address?.match(/\b\d{5}(-\d{4})?\b/)?.[0];
  const zipCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "postal_code")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (zipCandidates.length > 0 && userPostal) {
    const best = zipCandidates[0];
    await fillSignal(best.signal, "postal_code", "postalCode", userPostal, best.cls.confidence, best.cls.evidence, "USER_DATA");
  } else if (zipCandidates.length > 0) {
    skippedFields.push("postal_code");
  }

  // 8f. Job Title / Role
  const userJob = leadData.jobTitle || leadData.job_title || leadData.role || leadData.position;
  const jobCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "job_title")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (jobCandidates.length > 0) {
    const best = jobCandidates[0];
    const loc = fields.nth(best.signal.index);
    if (best.signal.tagName === "select") {
      await selectFirstRealOption(loc).catch(() => undefined);
      usedIndexes.add(best.signal.index);
      filledFields.push("job_title");
    } else {
      const effectiveJob = userJob || "Business Consultant";
      await fillSignal(best.signal, "job_title", "jobTitle", effectiveJob, best.cls.confidence, best.cls.evidence, userJob ? "USER_DATA" : "FALLBACK_DATA");
    }
  }

  // 8g. Budget / Price Range
  const userBudget = (leadData as any).budget || (leadData as any).projectBudget || (leadData as any).monthlyBudget;
  const budgetCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "budget")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (budgetCandidates.length > 0) {
    const best = budgetCandidates[0];
    const loc = fields.nth(best.signal.index);
    if (best.signal.tagName === "select") {
      const didSelect = await selectFirstRealOption(loc).catch(() => false);
      if (didSelect) {
        usedIndexes.add(best.signal.index);
        filledFields.push("budget");
        verificationItems.push({
          fieldIndex: best.signal.index,
          fieldType: "budget",
          mappedSource: `budget [${userBudget ? "USER_DATA" : "SELECT_FIRST_VALID_OPTION"}]`,
          confidence: best.cls.confidence,
          evidence: [...best.cls.evidence, `source:${userBudget ? "USER_DATA" : "SELECT_FIRST_VALID_OPTION"}`],
          filled: true,
          verified: true
        });
      }
    } else {
      const bVal = userBudget || "5000";
      await fillSignal(best.signal, "budget", "budget", bVal, best.cls.confidence, best.cls.evidence, userBudget ? "USER_DATA" : "FALLBACK_DATA");
    }
  }

  // 8h. Service of Interest / Services Required
  const userService = (leadData as any).service || (leadData as any).serviceInterest || (leadData as any).services;
  const serviceCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "service_interest")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (serviceCandidates.length > 0) {
    const best = serviceCandidates[0];
    const loc = fields.nth(best.signal.index);
    if (best.signal.tagName === "select") {
      const didSelect = await selectFirstRealOption(loc).catch(() => false);
      if (didSelect) {
        usedIndexes.add(best.signal.index);
        filledFields.push("service_interest");
        verificationItems.push({
          fieldIndex: best.signal.index,
          fieldType: "service_interest",
          mappedSource: `service_interest [${userService ? "USER_DATA" : "SELECT_FIRST_VALID_OPTION"}]`,
          confidence: best.cls.confidence,
          evidence: [...best.cls.evidence, `source:${userService ? "USER_DATA" : "SELECT_FIRST_VALID_OPTION"}`],
          filled: true,
          verified: true
        });
      }
    } else {
      const sVal = userService || "Web Design & Digital Marketing";
      await fillSignal(best.signal, "service_interest", "service", sVal, best.cls.confidence, best.cls.evidence, userService ? "USER_DATA" : "FALLBACK_DATA");
    }
  }

  // 8i. Referral Source / How did you hear about us
  const userSource = (leadData as any).referralSource || (leadData as any).source || (leadData as any).howHeard;
  const sourceCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "referral_source")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (sourceCandidates.length > 0) {
    const best = sourceCandidates[0];
    const loc = fields.nth(best.signal.index);
    if (best.signal.tagName === "select") {
      const didSelect = await selectFirstRealOption(loc).catch(() => false);
      if (didSelect) {
        usedIndexes.add(best.signal.index);
        filledFields.push("referral_source");
        verificationItems.push({
          fieldIndex: best.signal.index,
          fieldType: "referral_source",
          mappedSource: `referral_source [${userSource ? "USER_DATA" : "SELECT_FIRST_VALID_OPTION"}]`,
          confidence: best.cls.confidence,
          evidence: [...best.cls.evidence, `source:${userSource ? "USER_DATA" : "SELECT_FIRST_VALID_OPTION"}`],
          filled: true,
          verified: true
        });
      }
    } else {
      const refVal = userSource || "Google Search";
      await fillSignal(best.signal, "referral_source", "referralSource", refVal, best.cls.confidence, best.cls.evidence, userSource ? "USER_DATA" : "FALLBACK_DATA");
    }
  }

  // 8j. Industry / Sector
  const userIndustry = (leadData as any).industry || (leadData as any).sector;
  const industryCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "industry")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (industryCandidates.length > 0) {
    const best = industryCandidates[0];
    const loc = fields.nth(best.signal.index);
    if (best.signal.tagName === "select") {
      const didSelect = await selectFirstRealOption(loc).catch(() => false);
      if (didSelect) {
        usedIndexes.add(best.signal.index);
        filledFields.push("industry");
        verificationItems.push({
          fieldIndex: best.signal.index,
          fieldType: "industry",
          mappedSource: `industry [${userIndustry ? "USER_DATA" : "SELECT_FIRST_VALID_OPTION"}]`,
          confidence: best.cls.confidence,
          evidence: [...best.cls.evidence, `source:${userIndustry ? "USER_DATA" : "SELECT_FIRST_VALID_OPTION"}`],
          filled: true,
          verified: true
        });
      }
    } else {
      const indVal = userIndustry || "Technology";
      await fillSignal(best.signal, "industry", "industry", indVal, best.cls.confidence, best.cls.evidence, userIndustry ? "USER_DATA" : "FALLBACK_DATA");
    }
  }

  // 8k. Company Size
  const userCompSize = (leadData as any).companySize || (leadData as any).employees;
  const sizeCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "company_size")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (sizeCandidates.length > 0) {
    const best = sizeCandidates[0];
    const loc = fields.nth(best.signal.index);
    if (best.signal.tagName === "select") {
      const didSelect = await selectFirstRealOption(loc).catch(() => false);
      if (didSelect) {
        usedIndexes.add(best.signal.index);
        filledFields.push("company_size");
      }
    } else {
      const sizeVal = userCompSize || "1-10 Employees";
      await fillSignal(best.signal, "company_size", "companySize", sizeVal, best.cls.confidence, best.cls.evidence, userCompSize ? "USER_DATA" : "FALLBACK_DATA");
    }
  }

  // 9. Dropdowns: Select first real option for unmapped selects (Categorical fields like Industry, Service, Budget)
  for (const signal of signals) {
    if (signal.tagName !== "select" || usedIndexes.has(signal.index)) continue;
    const didSelect = await selectFirstRealOption(fields.nth(signal.index)).catch(() => false);
    if (didSelect) {
      usedIndexes.add(signal.index);
      filledFields.push(`dropdown:${signal.index}`);
      verificationItems.push({
        fieldIndex: signal.index,
        fieldType: "unknown",
        mappedSource: `dropdown:${signal.index} [SELECT_FIRST_VALID_OPTION]`,
        confidence: 0.8,
        evidence: ["select first real option", "source:SELECT_FIRST_VALID_OPTION"],
        filled: true,
        verified: true
      });
    }
  }

  // Sweep all required dropdowns in scope to ensure non-placeholder selection
  const reqDropdowns = await sweepAndSelectRequiredDropdowns(scope);
  filledFields.push(...reqDropdowns);

  // 10. Remaining required fields handling
  // If a field cannot be safely classified as generic text, location, contact info, or categorical selection, DO NOT INVENT A VALUE.
  for (const signal of signals) {
    if (usedIndexes.has(signal.index)) continue;
    if (!signal.isRequired) continue;
    if (["password", "file"].includes(signal.type)) continue;

    const loc = fields.nth(signal.index);
    if (signal.type === "checkbox") {
      await loc.check({ force: true }).catch(async () => {
        await loc.click({ force: true }).catch(() => undefined);
      });
      await loc.evaluate((el: HTMLInputElement) => {
        el.checked = true;
        const tracker = (el as any)._valueTracker;
        if (tracker) tracker.setValue(false);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        if ((window as any).jQuery) {
          try { (window as any).jQuery(el).trigger("change"); } catch {}
        }
      }).catch(() => undefined);
      usedIndexes.add(signal.index);
      filledFields.push(`consentCheckbox:${signal.index}`);
      continue;
    }
    if (signal.type === "radio") {
      await loc.check({ force: true }).catch(() => undefined);
      usedIndexes.add(signal.index);
      filledFields.push(`radio:${signal.index}`);
      continue;
    }
    if (signal.type === "tel" || /phone|mobile|tel/i.test(signal.name || signal.id || "")) {
      const pVal = (leadData.mobile || leadData.mobileNumber || leadData.phone || "").trim();
      if (pVal) {
        const fillRes = await safelyFillField(loc, pVal).catch(() => ({ success: false, verified: false, actualValue: undefined }));
        if (fillRes.success) {
          usedIndexes.add(signal.index);
          filledFields.push(`required_phone:${signal.index}`);
        }
      }
      continue;
    }
    if (signal.type === "email" || /email/i.test(signal.name || signal.id || "")) {
      const fillRes = await safelyFillField(loc, leadData.email).catch(() => ({ success: false, verified: false, actualValue: undefined }));
      if (fillRes.success) {
        usedIndexes.add(signal.index);
        filledFields.push(`required_email:${signal.index}`);
      }
      continue;
    }
    if (signal.tagName === "select") {
      let didSelect = await selectFirstRealOption(loc).catch(() => false);
      if (!didSelect) {
        didSelect = await loc.evaluate((el: HTMLSelectElement) => {
          if (!el || !el.options || el.options.length === 0) return false;
          const targetIndex = el.options.length > 1 ? 1 : 0;
          el.selectedIndex = targetIndex;
          if ((window as any).jQuery) {
            try { (window as any).jQuery(el).trigger("change"); } catch {}
          }
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }).catch(() => false);
      }
      if (didSelect) {
        usedIndexes.add(signal.index);
        filledFields.push(`required_select:${signal.index}`);
        verificationItems.push({
          fieldIndex: signal.index,
          fieldType: "unknown",
          mappedSource: `required_select:${signal.index} [FALLBACK_SELECT]`,
          confidence: 0.7,
          evidence: ["required select option chosen"],
          filled: true,
          verified: true
        });
      }
      continue;
    }

    const existingVal = await loc.inputValue().catch(() => "");
    if (existingVal.trim()) {
      usedIndexes.add(signal.index);
      continue;
    }

    // Semantic check: check if the unmapped required text field can be safely mapped to a known semantic category
    const localDescriptor = [
      signal.name,
      signal.id,
      signal.placeholder,
      signal.explicitLabel,
      signal.ariaLabel,
      signal.surroundingLabel,
      ...(signal.associatedLabels || [])
    ].filter(Boolean).join(" ").toLowerCase();

    const fullContainerDescriptor = [
      localDescriptor,
      signal.precedingSiblingText,
      signal.followingSiblingText,
      signal.parentContainerText
    ].filter(Boolean).join(" ").toLowerCase();
    
    // 10a. Math & Anti-spam text challenges (e.g. 3+4=?, "enter: seo", "What color is the sky?")
    const challengeAnswer = solveMathOrSpamChallenge(fullContainerDescriptor);
    if (challengeAnswer !== null) {
      const fillRes = await safelyFillField(loc, challengeAnswer).catch(() => ({ success: false, verified: false, actualValue: undefined }));
      if (fillRes.success) {
        usedIndexes.add(signal.index);
        filledFields.push(`spam_quiz:${signal.index}`);
        verificationItems.push({
          fieldIndex: signal.index,
          fieldType: "unknown",
          mappedSource: `spam_quiz:${signal.index} [SOLVED_CHALLENGE: ${challengeAnswer}]`,
          confidence: 0.95,
          evidence: ["solved math/spam challenge", `solution:${challengeAnswer}`],
          filled: true,
          verified: fillRes.verified,
          finalValue: fillRes.actualValue
        });
        continue;
      }
    }

    let safeValue: string | null = null;
    let telemetrySource: "USER_DATA" | "FALLBACK_DATA" = "USER_DATA";

    if (/\b(first[ _-]?name|firstname|fname|given)\b/i.test(localDescriptor)) {
      safeValue = userFirstName || null;
    } else if (/\b(middle[ _-]?name|middlename|mname)\b/i.test(localDescriptor)) {
      safeValue = userMiddleName || null;
    } else if (/\b(last[ _-]?name|lastname|lname|surname|family)\b/i.test(localDescriptor)) {
      safeValue = finalLastName || null;
    } else if (/\b(name|your-name|full[ _-]?name)\b/i.test(localDescriptor)) {
      safeValue = userFullName || userFirstName || null;
    } else if (/\b(email|e-mail)\b/i.test(localDescriptor) || signal.type === "email") {
      safeValue = leadData.email ? leadData.email.trim() : null;
    } else if (/\b(phone|mobile|tel|contact[ _-]?number|enter[ _-]?number|phone[ _-]?number|whatsapp)\b/i.test(localDescriptor) || signal.name === "number" || signal.type === "tel") {
      safeValue = phoneVal || null;
    } else if (/\b(address|street|addr|physical[ _-]?address|mailing[ _-]?address)\b/i.test(localDescriptor)) {
      safeValue = userAddress || null;
    } else if (/\b(city|town)\b/i.test(localDescriptor)) {
      safeValue = userCity || null;
    } else if (/\b(zip|postal|zip-code)\b/i.test(localDescriptor)) {
      safeValue = userPostal || null;
    } else if (/\b(state|province|region)\b/i.test(localDescriptor)) {
      safeValue = userState || null;
    } else if (/\b(country|nation)\b/i.test(localDescriptor)) {
      safeValue = userCountry || null;
    } else if (/\b(company|business|organization|organisation|firm|agency|enterprise|employer)\b/i.test(localDescriptor)) {
      safeValue = companyVal || null;
    } else if (/\b(website|url|web[ _-]?address)\b/i.test(localDescriptor) || signal.type === "url") {
      safeValue = (leadData.website || leadData.websiteUrl || "").trim() || null;
    } else if (/\b(subject|topic|title)\b/i.test(localDescriptor)) {
      safeValue = subjectVal || null;
    } else if (/\b(title|role|position|occupation)\b/i.test(localDescriptor)) {
      safeValue = userJob || null;
    } else if (/\b(message|comment|note|details|inquiry|feedback|description|question|brief|help|needs|goals|solutions|project\s+goals|objective|tell\s+us\s+how|why\s+are\s+you\s+reaching|about\s+project|project\s+description|requirement)\b/i.test(localDescriptor) || signal.tagName === "textarea") {
      safeValue = messageVal || null;
    }

    // If safeValue could not be safely derived from generic text, location, or contact info:
    // DO NOT INVENT A VALUE. Let it remain unmapped so it is audited accurately.
    if (safeValue !== null) {
      const fillRes = await safelyFillField(loc, safeValue).catch(() => ({ success: false, verified: false, actualValue: undefined }));
      if (fillRes.success) {
        usedIndexes.add(signal.index);
        filledFields.push(`required:${signal.index}`);
        verificationItems.push({
          fieldIndex: signal.index,
          fieldType: "unknown",
          mappedSource: `required:${signal.index} [${telemetrySource}]`,
          confidence: 0.7,
          evidence: ["semantic required text fallback", `source:${telemetrySource}`],
          filled: true,
          verified: fillRes.verified,
          finalValue: fillRes.actualValue
        });
      }
    }
  }

  // 11. Custom dropdowns, radios & button selection groups
  const customFilled = await selectCustomDropdownDefaults(scope);
  filledFields.push(...customFilled);
  const radioFilled = await selectRequiredRadioDefaults(scope);
  filledFields.push(...radioFilled);
  const buttonFilled = await selectFirstOptionInButtonGroups(scope);
  filledFields.push(...buttonFilled);

  // 12. Required Checkboxes (Consent / Terms / GDPR)
  try {
    for (const signal of signals) {
      if (signal.type !== "checkbox" || usedIndexes.has(signal.index)) continue;
      const cb = fields.nth(signal.index);
      const text = [
        signal.name,
        signal.id,
        signal.explicitLabel,
        ...signal.associatedLabels,
        signal.surroundingLabel,
        signal.followingSiblingText,
        signal.parentContainerText
      ].join(" ");

      const isExplicitMarketing = /newsletter|subscribe|marketing|promotions|updates|offers/i.test(text);
      const isConsentOrPolicy = /consent|agree|terms|privacy|policy|gdpr|rules|accept|disclaimer|legal|authorization|conditions|declar|confirm|trattamento|datenschutz|privacidad|akkoord|acconsento/i.test(text);
      const isReq = signal.isRequired || Boolean(signal.associatedLabels?.some((l) => /required|\*/i.test(l)));

      // Select an appropriate option only when required to satisfy the form's actual validation rules
      if (isReq || (isConsentOrPolicy && !isExplicitMarketing)) {
        await cb.check({ force: true }).catch(async () => {
          await cb.click({ force: true }).catch(() => undefined);
        });
        await cb.evaluate((el: HTMLInputElement) => {
          el.checked = true;
          const tracker = (el as any)._valueTracker;
          if (tracker) tracker.setValue(false);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          if ((window as any).jQuery) {
            try { (window as any).jQuery(el).trigger("change"); } catch {}
          }
        }).catch(() => undefined);
        usedIndexes.add(signal.index);
        filledFields.push(`consentCheckbox:${signal.index}`);
      }
    }
  } catch {
    // Continue
  }

  // 13. Audit Required vs Unmapped Fields
  const unmappedRequiredFields: string[] = [];
  const unmappedRequiredDetails: UnmappedRequiredFieldDetail[] = [];
  const unmappedOptionalFields: string[] = [];

  for (const signal of signals) {
    if (usedIndexes.has(signal.index)) continue;
    
    // Honeypot protection: skip honeypot fields so they are neither filled nor trigger required errors
    if (isHoneypotField(signal)) {
      usedIndexes.add(signal.index);
      continue;
    }

    // Skip search bars (e.g. name="s", search inputs on header/sidebar)
    if (
      signal.type === "search" ||
      signal.name === "s" ||
      signal.id === "search" ||
      /\b(search|search_input|site-search|site_search)\b/i.test(signal.name || signal.id || "")
    ) {
      usedIndexes.add(signal.index);
      continue;
    }
    const loc = fields.nth(signal.index);
    
    // Check if element is a checkbox/radio that is already checked
    if (signal.type === "checkbox" || signal.type === "radio") {
      const isChecked = await loc.evaluate((el) => (el as HTMLInputElement).checked).catch(() => false);
      if (isChecked) {
        usedIndexes.add(signal.index);
        continue;
      }
    }

    // Check if element already has a value (filtering out placeholder select options)
    const existingVal = await loc.evaluate((el) => {
      if (el.tagName.toLowerCase() === "select") {
        const sel = el as HTMLSelectElement;
        const opt = sel.options[sel.selectedIndex];
        if (!opt) return "";
        const val = (opt.value || "").trim();
        const txt = (opt.textContent || "").trim();
        // If option value is empty or text matches placeholder words, it is NOT a valid selection
        if (!val || /^(select|choose|please select|none|--)/i.test(txt)) {
          return "";
        }
        return val || txt;
      }
      return (el as HTMLInputElement).value || "";
    }).catch(() => "");
    if (existingVal.trim()) {
      usedIndexes.add(signal.index);
      continue;
    }

    // Auto-select first valid, non-placeholder option for required select dropdowns
    if (signal.tagName.toLowerCase() === "select" && signal.isRequired && signal.isVisible && !signal.isDisabled) {
      const selectedOption = await loc.evaluate((el) => {
        const sel = el as HTMLSelectElement;
        for (let i = 0; i < sel.options.length; i++) {
          const opt = sel.options[i];
          const val = (opt.value || "").trim();
          const txt = (opt.textContent || "").trim();
          if (val && !/^(select|choose|please select|none|--)/i.test(txt) && !opt.disabled) {
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event("input", { bubbles: true }));
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            if ((window as any).jQuery) {
              try { (window as any).jQuery(sel).trigger("change"); } catch {}
            }
            return txt || val;
          }
        }
        return null;
      }).catch(() => null);

      if (selectedOption) {
        usedIndexes.add(signal.index);
        filledFields.push(`select:${signal.name || signal.id || signal.index}`);
        verificationItems.push({
          fieldIndex: signal.index,
          fieldType: "custom_select" as SemanticFieldType,
          mappedSource: "SELECT_FIRST_VALID_OPTION",
          confidence: 0.95,
          evidence: ["auto_selected_first_valid_option"],
          filled: true,
          verified: true,
          finalValue: selectedOption
        });
        continue;
      }
    }

    // Plain text arithmetic honeypots (e.g. "3 + 4 = ?" or "What is 5 plus 2?")
    const labelAndPlaceholder = `${signal.explicitLabel || ""} ${signal.placeholder || ""} ${signal.ariaLabel || ""}`;
    const mathMatch = labelAndPlaceholder.match(/(\d+)\s*([\+\-\*])\s*(\d+)/);
    if (mathMatch && signal.tagName.toLowerCase() === "input" && (signal.type === "text" || signal.type === "number")) {
      const n1 = parseInt(mathMatch[1], 10);
      const op = mathMatch[2];
      const n2 = parseInt(mathMatch[3], 10);
      let ans = 0;
      if (op === "+") ans = n1 + n2;
      else if (op === "-") ans = n1 - n2;
      else if (op === "*") ans = n1 * n2;
      const fillRes = await safelyFillField(loc, String(ans));
      if (fillRes.success) {
        usedIndexes.add(signal.index);
        filledFields.push(`mathHoneypot:${signal.index}`);
        continue;
      }
    }

    // Fallback: If an unmapped required field is type="url" or asks for a URL/website/domain:
    const fieldDescriptor = `${signal.name || ""} ${signal.id || ""} ${signal.placeholder || ""} ${signal.explicitLabel || ""} ${signal.ariaLabel || ""}`.toLowerCase();
    if (
      signal.isRequired &&
      signal.isVisible &&
      !signal.isDisabled &&
      (signal.type === "url" || /\b(website|web[ _-]?site|url|domain|site[ _-]?url|web[ _-]?address|your[ _-]?website|current[ _-]?site|wcag_url|theme-url)\b/i.test(fieldDescriptor))
    ) {
      let webVal = (leadData.website || leadData.websiteUrl || "").trim();
      if (!webVal) webVal = "https://example.com";
      else if (!/^https?:\/\//i.test(webVal)) webVal = `https://${webVal}`;
      const fillRes = await safelyFillField(loc, webVal);
      if (fillRes.success) {
        usedIndexes.add(signal.index);
        filledFields.push(`website:${signal.name || signal.id || signal.index}`);
        verificationItems.push({
          fieldIndex: signal.index,
          fieldType: "website" as SemanticFieldType,
          mappedSource: "USER_DATA",
          confidence: 0.95,
          evidence: ["fallback_fill_required_website_url"],
          filled: true,
          verified: fillRes.verified,
          finalValue: webVal
        });
        continue;
      }
    }

    const identifier = signal.name || signal.id || signal.placeholder || signal.explicitLabel || `field_${signal.index}`;
    if (signal.isRequired && signal.isVisible && !signal.isDisabled) {
      unmappedRequiredFields.push(identifier);
      
      const optionsList = signal.selectOptions?.map((o) => o.text).filter(Boolean);
      const detail: UnmappedRequiredFieldDetail = {
        fieldName: signal.name || signal.id || `field_${signal.index}`,
        fieldLabel: signal.explicitLabel || signal.ariaLabel || signal.placeholder || signal.name || `field_${signal.index}`,
        fieldType: signal.type || signal.tagName,
        availableOptions: optionsList && optionsList.length > 0 ? optionsList : undefined,
        reason: "Required field cannot safely be mapped without explicit user data"
      };
      unmappedRequiredDetails.push(detail);

      console.warn(`[contact-form-automation] UNRESOLVED_REQUIRED_FIELD: fieldName="${detail.fieldName}", label="${detail.fieldLabel}", type="${detail.fieldType}", options=${optionsList?.length ?? 0}`);
    } else {
      unmappedOptionalFields.push(identifier);
    }
  }

  let classifiedCount = 0;
  for (const [_, cls] of classifications) {
    if (!cls.isNegative && cls.fieldType !== "unknown") {
      classifiedCount++;
    }
  }

  const metrics: FormFillMetrics = {
    fieldsDetected: signals.length,
    fieldsClassified: classifiedCount,
    filledFieldsCount: filledFields.length,
    verifiedFieldsCount: verificationItems.filter((v) => v.verified).length,
    unmappedRequiredFields,
    unmappedRequiredDetails,
    unmappedOptionalFields,
    items: verificationItems
  };

  return { filledFields, skippedFields, metrics };
}

async function scorePrimaryForm(form: Locator) {
  return form.evaluate((element) => {
    const formText = (element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const controls = Array.from(element.querySelectorAll("input, textarea, select")).filter((control) => {
      const input = control as HTMLInputElement;
      const style = window.getComputedStyle(input);
      const rect = input.getBoundingClientRect();
      return input.type !== "hidden" && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }) as Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
    const descriptors = controls.map((control) => [
      control.getAttribute("name"),
      control.id,
      control.getAttribute("placeholder"),
      control.getAttribute("aria-label"),
      control.getAttribute("autocomplete")
    ].filter(Boolean).join(" ").toLowerCase()).join(" ");
    const combinedText = `${formText} ${descriptors}`;
    const emailCount = controls.filter((control) => (control.getAttribute("type") ?? "").toLowerCase() === "email" || /email|e-mail/.test(control.getAttribute("name") ?? "")).length;
    const textareaCount = controls.filter((control) => control.tagName.toLowerCase() === "textarea").length;
    const requiredCount = controls.filter((control) => control.required || control.getAttribute("aria-required") === "true").length;
    const hasNameField = /first[ _-]?name|last[ _-]?name|full[ _-]?name|\bname\b/.test(combinedText);
    const hasMessageField = /message|comment|details|enquir|project|budget|service/.test(combinedText);
    const newsletterLike = /newsletter|subscribe|sign up|stay in the know|get marketing tips/.test(combinedText);
    const isInsideFooter = Boolean(element.closest("footer, [role='contentinfo']"));

    let score = controls.length * 12 + requiredCount * 6 + emailCount * 8 + textareaCount * 18;
    if (hasNameField) score += 22;
    if (hasMessageField) score += 22;
    if (controls.length === 1 && emailCount === 1) score -= 100;
    if (newsletterLike) score -= 90;
    if (isInsideFooter) score -= 35;
    return score;
  }).catch(() => Number.NEGATIVE_INFINITY);
}

export async function unhideHiddenFormContainers(page: Page | Frame) {
  await page.evaluate(() => {
    // 1. Unhide forms, framework wrappers, and embedded iframes (and their parent submenus/drawers up to 5 levels)
    const selector = "form, [class*='gform_wrapper'], [class*='forminator'], [id*='gform_wrapper'], [class*='wpcf7'], [class*='w-form'], [class*='sqs-block-form'], [class*='_form'], iframe[src*='form'], iframe[src*='prospector'], iframe[src*='hubspot'], iframe[src*='lead'], iframe[id*='hs-form'], iframe[class*='hs-form'], div.hbspt-form";
    document.querySelectorAll(selector).forEach((el) => {
      let curr: HTMLElement | null = el as HTMLElement;
      let depth = 0;
      while (curr && curr !== document.body && depth < 5) {
        if (curr.style?.display === "none" || window.getComputedStyle(curr).display === "none") {
          curr.style.display = "block";
        }
        if (curr.style?.visibility === "hidden" || window.getComputedStyle(curr).visibility === "hidden") {
          curr.style.visibility = "visible";
        }
        if (curr.style?.opacity === "0" || window.getComputedStyle(curr).opacity === "0") {
          curr.style.opacity = "1";
        }
        if (curr.getAttribute("aria-hidden") === "true") {
          curr.setAttribute("aria-hidden", "false");
        }
        curr = curr.parentElement;
        depth++;
      }
    });

    // 2. Unhide submenus, dropdowns, and drawers that contain forms or input fields
    const submenuContainers = [
      "ul.sub-menu", "ul.dropdown-menu", ".dropdown-content", ".sub-nav", ".submenu",
      ".elementor-nav-menu--dropdown", ".elementor-sub-item", ".w-dropdown-list",
      ".mega-menu", "[class*='mega-menu']", "[class*='megamenu']",
      "[class*='sub-menu']", "[class*='submenu']", "[class*='dropdown-menu']",
      ".offcanvas", "[class*='offcanvas']", "[class*='drawer']", "[class*='slideout']",
      ".nav-dropdown"
    ];
    document.querySelectorAll(submenuContainers.join(", ")).forEach((container) => {
      const hasInputs = container.querySelectorAll("input:not([type=hidden]):not([type=search]), textarea, select").length > 0;
      if (hasInputs) {
        const html = container as HTMLElement;
        if (html.style?.display === "none" || window.getComputedStyle(html).display === "none") {
          html.style.display = "block";
        }
        if (html.style?.visibility === "hidden" || window.getComputedStyle(html).visibility === "hidden") {
          html.style.visibility = "visible";
        }
        if (html.style?.opacity === "0" || window.getComputedStyle(html).opacity === "0") {
          html.style.opacity = "1";
        }
      }
    });
  }).catch(() => undefined);
}

export async function waitForDynamicPageReadiness(
  page: Page,
  maxWaitMs = 8000
): Promise<{ ready: boolean; state: string; durationMs: number }> {
  await unhideHiddenFormContainers(page).catch(() => undefined);
  const result = await waitForUniversalPageReadiness(page, {
    maxWaitMs,
    pollIntervalMs: 200,
    targetPurpose: "form"
  });
  await unhideHiddenFormContainers(page).catch(() => undefined);
  return {
    ready: result.ready,
    state: result.state,
    durationMs: result.durationMs
  };
}

async function findPrimaryForm(page: Page) {
  await unhideHiddenFormContainers(page);
  const candidates: Locator[] = [];
  const addVisibleForms = async (forms: Locator) => {
    try {
      const count = await Promise.race([
        forms.count(),
        new Promise<number>((_, rej) => setTimeout(() => rej(new Error("forms count timeout")), 1500))
      ]).catch(() => 0);
      for (let index = 0; index < count; index++) {
        const form = forms.nth(index);
        const isVis = await Promise.race([
          form.isVisible(),
          new Promise<boolean>((_, rej) => setTimeout(() => rej(new Error("form isVisible timeout")), 1000))
        ]).catch(() => false);
        if (isVis) candidates.push(form);
      }
    } catch {
      // ignore
    }
  };

  await addVisibleForms(page.locator("form"));
  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || frame.isDetached()) continue;
    const fUrl = frame.url() || "";
    const fName = frame.name() || "";
    const isLikelyFormFrame = /^https?:/i.test(fUrl) || /hs-form|hubspot|form/i.test(fName);
    if (!isLikelyFormFrame) continue;
    await addVisibleForms(frame.locator("form"));
  }

  // If no visible form found in top DOM, check forms inside submenus/drawers/modals
  if (candidates.length === 0) {
    const hiddenForms = page.locator("form");
    const count = await hiddenForms.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const f = hiddenForms.nth(i);
      const inputCount = await f.locator("input:not([type=hidden]):not([type=search]), textarea").count().catch(() => 0);
      if (inputCount >= 2) {
        candidates.push(f);
      }
    }
  }

  let best: { form: Locator; score: number } | null = null;
  for (const form of candidates) {
    const score = await Promise.race([
      scorePrimaryForm(form),
      new Promise<number>((_, rej) => setTimeout(() => rej(new Error("scorePrimaryForm timeout")), 1500))
    ]).catch(() => Number.NEGATIVE_INFINITY);
    if (!best || score > best.score) best = { form, score };
  }
  return best?.form ?? null;
}

export async function fillAllVisibleForms(page: Page, leadData: LeadData) {
  // If a heavy client-side hydration framework (Wix, Next.js, Nuxt, React, Webflow) is detected,
  // ensure the initial JavaScript hydration cycle has committed before attempting DOM interaction.
  const isHydratedFramework = await page.evaluate(() => {
    return Boolean(
      (window as any).wixBiSession ||
      document.querySelector("[data-mesh-id]") ||
      (window as any).__next_data__ ||
      document.querySelector("#__next") ||
      (window as any).__nuxt__ ||
      document.querySelector("#__nuxt")
    );
  }).catch(() => false);

  if (isHydratedFramework) {
    console.log(`[contact-form-automation] Client-side hydration framework detected. Waiting for hydration to settle...`);
    await page.waitForTimeout(2500);
  }

  let primaryForm = await findPrimaryForm(page);
  // A small number of sites use controls without a wrapping <form>.
  let result = await fillDetectedFields(primaryForm ?? page, leadData);

  // Progressive hydration retry for client-side rendered dynamic forms (HubSpot, Squarespace, React, Vue, Next.js)
  // If zero fields were filled and unmapped required fields are present or zero were detected,
  // allow up to 1.6s for asynchronous form containers to finish hydrating.
  if (result.filledFields.length === 0) {
    for (let poll = 0; poll < 3; poll++) {
      await page.waitForTimeout(400);
      primaryForm = await findPrimaryForm(page);
      result = await fillDetectedFields(primaryForm ?? page, leadData);
      if (result.filledFields.length > 0) {
        break;
      }
    }
  }

  // Post-fill Hydration & Self-Healing Guard:
  // Detect if any filled fields were wiped by late client-side hydration (e.g. Wix masterPage, React 16-19, Vue).
  // Wait a moment for hydration to settle, then re-verify all inputs and re-fill any that were cleared.
  await page.waitForTimeout(1000);
  await reVerifyAndSelfHealFilledFields(primaryForm ?? page, result.metrics.items);

  return { ...result, primaryForm };
}

/**
 * Sweeps for and checks any required, terms, policy, GDPR, or consent checkboxes
 * located in the form container or adjacent to the submit button.
 * Dispatches synthetic input/change events, updates React state trackers,
 * and clicks associated <label> elements for custom styled checkboxes.
 */
export async function sweepAndCheckPreSubmitCheckboxes(
  page: Page,
  formScope?: Locator | null,
  submitButton?: Locator | null
): Promise<string[]> {
  const checkedFields: string[] = [];
  try {
    const root = (formScope && (await formScope.count().catch(() => 0)) > 0) ? formScope : page;

    const targets: Locator[] = [
      root.locator("input[type='checkbox']"),
      root.locator("[role='checkbox']")
    ];

    if (submitButton && (await submitButton.count().catch(() => 0)) > 0) {
      try {
        const actionContainer = submitButton.locator(
          "xpath=ancestor::*[contains(@class, 'action') or contains(@class, 'button') or contains(@class, 'submit') or contains(@class, 'footer') or contains(@class, 'form-group') or self::form][1]"
        );
        if ((await actionContainer.count().catch(() => 0)) > 0) {
          targets.push(
            actionContainer.locator("input[type='checkbox']"),
            actionContainer.locator("[role='checkbox']")
          );
        }
      } catch {}
    }

    const CONSENT_PATTERN = /consent|agree|terms|privacy|policy|gdpr|rules|accept|disclaimer|legal|conditions|authorization|declar|confirm|trattamento|datenschutz|privacidad|akkoord|acconsento/i;
    const seenHandles = new Set<string>();

    for (const locatorGroup of targets) {
      const count = await locatorGroup.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const item = locatorGroup.nth(i);

        const info = await item.evaluate((el: HTMLElement) => {
          const isNative = el.tagName.toLowerCase() === "input";
          let isChecked = false;
          let isRequired = false;

          if (isNative) {
            const input = el as HTMLInputElement;
            isChecked = input.checked;
            isRequired = Boolean(
              input.required ||
              input.getAttribute("aria-required") === "true" ||
              input.getAttribute("data-required") === "true" ||
              input.classList.contains("required") ||
              input.matches(":invalid")
            );
          } else {
            isChecked = el.getAttribute("aria-checked") === "true";
            isRequired = Boolean(
              el.getAttribute("aria-required") === "true" ||
              el.getAttribute("data-required") === "true" ||
              el.classList.contains("required")
            );
          }

          const id = el.id || "";
          const name = el.getAttribute("name") || "";
          const ariaLabel = el.getAttribute("aria-label") || "";
          let labelText = "";
          if (id) {
            try {
              const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
              if (lbl) labelText += " " + (lbl.textContent || "");
            } catch {}
          }
          const parentLabel = el.closest("label");
          if (parentLabel) labelText += " " + (parentLabel.textContent || "");

          const parentContainer = el.parentElement;
          const containerText = parentContainer ? (parentContainer.textContent || "").slice(0, 300) : "";
          const grandParentText = parentContainer?.parentElement ? (parentContainer.parentElement.textContent || "").slice(0, 300) : "";

          const fullText = [name, id, ariaLabel, labelText, containerText, grandParentText].join(" ").replace(/\s+/g, " ").trim();
          const fingerprint = `${el.tagName}:${id || name || fullText.slice(0, 30)}`;

          return {
            isNative,
            isChecked,
            isRequired,
            id,
            name,
            fullText,
            fingerprint
          };
        }).catch(() => null);

        if (!info || info.isChecked || seenHandles.has(info.fingerprint)) continue;
        seenHandles.add(info.fingerprint);

        const isMarketingOrNewsletter = /\b(newsletter|marketing|promo|promotions|promotional|discount|offers|subscribe|subscription|third[ _-]?party)\b/i.test(info.fullText);
        if (!info.isRequired && isMarketingOrNewsletter) {
          continue; // Never check optional marketing or newsletter checkboxes
        }

        const isPolicyOrConsent = CONSENT_PATTERN.test(info.fullText);
        if (info.isRequired || isPolicyOrConsent) {
          const identifier = info.id || info.name || `checkbox_${checkedFields.length}`;

          if (info.isNative) {
            await item.check({ force: true }).catch(async () => {
              await item.click({ force: true }).catch(() => undefined);
            });

            await item.evaluate((el: HTMLInputElement) => {
              el.checked = true;
              const tracker = (el as any)._valueTracker;
              if (tracker) tracker.setValue(false);
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              if ((window as any).jQuery) {
                try { (window as any).jQuery(el).trigger("change"); } catch {}
              }
            }).catch(() => undefined);
          } else {
            await item.evaluate((el: HTMLElement) => {
              el.setAttribute("aria-checked", "true");
              el.dispatchEvent(new Event("click", { bubbles: true }));
            }).catch(() => undefined);
            await item.click({ force: true }).catch(() => undefined);
          }

          checkedFields.push(`preSubmitCheckbox:${identifier}`);
          console.log(`[contact-form-automation] [PRE-SUBMIT-CHECKBOX] Checked required/policy checkbox: "${identifier}" (required=${info.isRequired}, consent/policy=${isPolicyOrConsent})`);
        }
      }
    }

    // Option/Service Checkbox Group Fallback:
    // If the form has option checkboxes (e.g. services, categories, check_list[]) and ZERO checkboxes
    // are currently checked anywhere in the form, check at least the first non-marketing option to satisfy JS validation.
    const anyChecked = await (root as any).evaluate((el: HTMLElement) => {
      const allCb = Array.from(el.querySelectorAll("input[type='checkbox'], [role='checkbox']"));
      return allCb.some((cb: any) => cb.checked || cb.getAttribute("aria-checked") === "true");
    }).catch(() => false);

    if (!anyChecked) {
      for (const locatorGroup of targets) {
        const count = await locatorGroup.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const item = locatorGroup.nth(i);
          const candidate = await item.evaluate((el: HTMLElement) => {
            const isNative = el.tagName.toLowerCase() === "input";
            const name = el.getAttribute("name") || "";
            const id = el.id || "";
            const parent = el.closest("label") || el.parentElement;
            const text = (parent?.textContent || "").toLowerCase();
            const isMarketing = /\b(newsletter|marketing|promo|promotions|discount|offers|subscribe)\b/i.test(name + " " + id + " " + text);
            return {
              isNative,
              id: id || name || `checkbox_opt_${i}`,
              validOption: !isMarketing
            };
          }).catch(() => null);

          if (candidate && candidate.validOption) {
            await item.check({ force: true }).catch(async () => {
              await item.click({ force: true }).catch(() => undefined);
            });
            await item.evaluate((el: any) => {
              if (el.tagName && el.tagName.toLowerCase() === "input") {
                el.checked = true;
                const tracker = (el as any)._valueTracker;
                if (tracker) tracker.setValue(false);
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
                if ((window as any).jQuery) {
                  try { (window as any).jQuery(el).trigger("change"); } catch {}
                }
              } else {
                el.setAttribute("aria-checked", "true");
                el.dispatchEvent(new Event("click", { bubbles: true }));
              }
            }).catch(() => undefined);

            checkedFields.push(`optionCheckbox:${candidate.id}`);
            console.log(`[contact-form-automation] [PRE-SUBMIT-CHECKBOX] Auto-checked first service/option checkbox: "${candidate.id}" to satisfy form validation`);
            break;
          }
        }
        if (checkedFields.length > 0) break;
      }
    }
  } catch (err) {
    console.warn(`[contact-form-automation] [PRE-SUBMIT-CHECKBOX] Sweep warning:`, err);
  }
  return checkedFields;
}

export type SubmitCandidateInfo = {
  tagName: string;
  type?: string;
  text: string;
  score: number;
};

export type SubmitCandidateDiagnostic = {
  submitCandidateCount: number;
  rejectedCandidateCount: number;
  selectedCandidate: SubmitCandidateInfo | null;
  selectedScore: number;
  rejectionReasons: string[];
};

export async function findSubmitButtonWithDiagnostics(
  page: Page,
  leadData?: LeadData,
  targetForm?: Locator | null
): Promise<{ locator: Locator | null; diagnostics: SubmitCandidateDiagnostic }> {
  await unhideHiddenFormContainers(page).catch(() => undefined);

  const primaryForm = targetForm ?? (await findPrimaryForm(page));

  const RANK_FN = `(function(container, currentFormId) {
    var elements = Array.from(
      container.querySelectorAll(
        "button, input[type='submit'], input[type='button'], input[type='image'], [role='button'], a.btn, a.button, a[class*='btn'], a[class*='button'], [data-form-submit], [data-submit], [data-action*='submit' i], [data-state*='submit' i], div[role='button'], span[role='button'], div.btn, div.button, span.btn, span.button, [class*='submit' i], [id*='submit' i], a[href='javascript:void(0)'], a[href='#'], a:not([href])"
      )
    );

    var POSITIVE_KEYWORDS = [
      "submit", "send", "send message", "submit message", "send enquiry", "get in touch",
      "contact", "contact us", "reach out", "request quote", "request a quote", "get a quote",
      "get quote", "request consultation", "request demo", "schedule", "schedule call",
      "schedule consultation", "book call", "book now", "book consultation", "start now",
      "get started", "let's talk", "lets talk", "inquire", "connect", "start booking",
      "enviar", "absenden", "nachricht", "envoyer", "next", "continue"
    ];

    var candidates = [];
    var rejectedReasons = [];

    elements.forEach(function(el, index) {
      var tag = el.tagName.toLowerCase();
      var type = (el.getAttribute("type") || "").toLowerCase();
      var role = (el.getAttribute("role") || "").toLowerCase();
      var text = (el.innerText || el.textContent || el.getAttribute("value") || el.getAttribute("aria-label") || el.getAttribute("title") || "")
        .trim().toLowerCase().replace(/\\s+/g, " ");
      var cls = (el.className || "").toString().toLowerCase();
      var id = (el.id || "").toLowerCase();
      var hasFormSubmitAttr = el.hasAttribute("data-form-submit") || el.hasAttribute("data-submit") || (el.getAttribute("data-action") || "").toLowerCase().indexOf("submit") !== -1;
      var hasPositiveText = false;
      for (var k = 0; k < POSITIVE_KEYWORDS.length; k++) {
        if (text.indexOf(POSITIVE_KEYWORDS[k]) !== -1) {
          hasPositiveText = true;
          break;
        }
      }
      var hrefAttr = (el.getAttribute("href") || "").trim().toLowerCase();
      var isActionAnchor = tag === "a" && (hasFormSubmitAttr || hrefAttr === "" || hrefAttr === "#" || hrefAttr.indexOf("javascript:") === 0);

      var rect = el.getBoundingClientRect();
      var style = window.getComputedStyle(el);
      var isVisible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      var isDisabled = el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true" || el.classList.contains("disabled");
      var isInsideForm = Boolean(el.closest("form")) || Boolean(currentFormId && el.getAttribute("form") === currentFormId);

      var score = 0;
      var rejectionReason = null;

      if (/\\b(search|find)\\b/i.test(text) || id.indexOf("search") !== -1 || cls.indexOf("search") !== -1) {
        score -= 100;
        rejectionReason = "SEARCH_KEYWORD";
      }
      if (/\\b(log[ _-]?in|sign[ _-]?in|sign[ _-]?up|register|my account|client portal)\\b/i.test(text)) {
        score -= 80;
        rejectionReason = rejectionReason || "AUTH_KEYWORD";
      }
      if (/\\b(newsletter|subscribe|stay updated|join mailing list)\\b/i.test(text) && !(type === "submit" && isInsideForm)) {
        score -= 60;
        rejectionReason = rejectionReason || "NEWSLETTER_KEYWORD";
      }
      if (/\\b(cart|checkout|buy now|add to cart|bag|shop now)\\b/i.test(text)) {
        score -= 100;
        rejectionReason = rejectionReason || "COMMERCE_KEYWORD";
      }
      if (/\\b(cookie|accept all|accept cookies|decline cookies|preferences|got it|dismiss|agree)\\b/i.test(text)) {
        score -= 100;
        rejectionReason = rejectionReason || "COOKIE_CONSENT_KEYWORD";
      }
      if (/\\b(close|dismiss|cancel)\\b/i.test(text)) {
        score -= 80;
        rejectionReason = rejectionReason || "DISMISS_KEYWORD";
      }
      if (tag === "a" && cls.indexOf("btn") === -1 && cls.indexOf("button") === -1 && !isInsideForm && !hasFormSubmitAttr && !(isActionAnchor && hasPositiveText)) {
        score -= 80;
        rejectionReason = rejectionReason || "NAV_LINK";
      }
      if (isDisabled) {
        score -= 50;
        rejectionReason = rejectionReason || "DISABLED";
      }
      if (!isVisible) {
        score -= 40;
        rejectionReason = rejectionReason || "HIDDEN";
      }

      if (type === "submit" || type === "image" || hasFormSubmitAttr) score += 50;
      if (isInsideForm) score += 40;
      if (role === "button" || tag === "button") score += 20;
      if (currentFormId && el.getAttribute("form") === currentFormId) score += 25;
      if (
        cls.indexOf("submit") !== -1 || id.indexOf("submit") !== -1 ||
        cls.indexOf("gform_button") !== -1 || cls.indexOf("forminator-button") !== -1 ||
        cls.indexOf("wpforms-submit") !== -1 || cls.indexOf("hs-button") !== -1 ||
        cls.indexOf("wpcf7-submit") !== -1 || cls.indexOf("ff-btn-submit") !== -1
      ) {
        score += 30;
      }
      if (hasPositiveText) score += 35;
      if (isVisible) score += 20;

      if (score >= 20) {
        candidates.push({ index: index, tag: tag, type: type, text: text.slice(0, 40), score: score });
      } else {
        if (rejectionReason) rejectedReasons.push(rejectionReason);
      }
    });

    candidates.sort(function(a, b) { return b.score - a.score; });
    var selected = candidates[0] || null;
    if (selected) {
      var prev = container.querySelectorAll("[data-sdi-submit]");
      for (var p = 0; p < prev.length; p++) {
        prev[p].removeAttribute("data-sdi-submit");
      }
      elements[selected.index].setAttribute("data-sdi-submit", "selected");
    }

    return {
      submitCandidateCount: candidates.length,
      rejectedCandidateCount: elements.length - candidates.length,
      selectedCandidate: selected ? {
        tagName: selected.tag,
        type: selected.type,
        text: selected.text,
        score: selected.score
      } : null,
      selectedScore: selected ? selected.score : 0,
      rejectionReasons: rejectedReasons.slice(0, 5)
    };
  })`;

  const evaluateLocator = async (loc: Locator, formId?: string | null): Promise<SubmitCandidateDiagnostic | null> => {
    return loc.evaluate(
      (el: HTMLElement, args: { script: string; formId?: string }) => {
        const fn = (window as any).eval(args.script);
        return fn(el, args.formId);
      },
      { script: RANK_FN, formId: formId ?? undefined }
    ).catch((err) => {
      console.warn("[findSubmitButton] evaluateLocator failed:", err?.message);
      return null;
    });
  };

  const evaluatePageOrFrame = async (scope: Page | Frame): Promise<SubmitCandidateDiagnostic | null> => {
    return scope.evaluate(
      (args: { script: string; formId?: string }) => {
        const fn = (window as any).eval(args.script);
        return fn(document, args.formId);
      },
      { script: RANK_FN, formId: undefined }
    ).catch((err) => {
      console.warn("[findSubmitButton] evaluatePageOrFrame failed:", err?.message);
      return null;
    });
  };

  let defaultDiag: SubmitCandidateDiagnostic = {
    submitCandidateCount: 0,
    rejectedCandidateCount: 0,
    selectedCandidate: null,
    selectedScore: 0,
    rejectionReasons: []
  };

  // 1. First search inside primary form
  if (primaryForm) {
    const formId = await primaryForm.getAttribute("id").catch(() => null);
    const formEval = await evaluateLocator(primaryForm, formId);
    if (formEval && formEval.selectedCandidate) {
      const locator = primaryForm.locator("[data-sdi-submit='selected']").first();
      return { locator, diagnostics: formEval };
    }

    // Check external submit button tied to form id
    if (formId) {
      const extLoc = page.locator(`button[form='${formId}'], input[form='${formId}'][type='submit']`).first();
      if (await extLoc.isVisible().catch(() => false)) {
        return {
          locator: extLoc,
          diagnostics: {
            submitCandidateCount: 1,
            rejectedCandidateCount: 0,
            selectedCandidate: { tagName: "button", type: "submit", text: "External Form Submit", score: 90 },
            selectedScore: 90,
            rejectionReasons: []
          }
        };
      }
    }
  }

  // 2. Search on the main page
  const pageEval = await evaluatePageOrFrame(page);
  if (pageEval && pageEval.selectedCandidate) {
    const locator = page.locator("[data-sdi-submit='selected']").first();
    return { locator, diagnostics: pageEval };
  }
  if (pageEval) defaultDiag = pageEval;

  // 3. Search child frames
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const frameEval = await evaluatePageOrFrame(frame);
    if (frameEval && frameEval.selectedCandidate) {
      const locator = frame.locator("[data-sdi-submit='selected']").first();
      return { locator, diagnostics: frameEval };
    }
  }

  // 4. Multi-step forms (click NEXT and re-evaluate)
  const nextStepSelectors = [
    ".e-form__buttons__wrapper__button-next:visible",
    "button:has-text('NEXT'):visible",
    "button:has-text('Next'):visible",
    "button:has-text('Continue'):visible",
    "button:has-text('Weiter'):visible",
    "button:has-text('Siguiente'):visible",
    "button:has-text('Suivant'):visible",
    "button:has-text('Avanti'):visible",
    "button:has-text('Volgende'):visible",
    "button:has-text('Continuar'):visible",
    "button:has-text('Avançar'):visible",
    "input[value='NEXT' i]:visible",
    "input[value='Next' i]:visible",
    "input[value='Continue' i]:visible",
    "input[value='Siguiente' i]:visible",
    "input[value='Suivant' i]:visible",
    "[role='button']:has-text('Next'):visible",
    "[role='button']:has-text('Continue'):visible",
    "[data-action*='next' i]:visible",
    ".btn-next:visible, .button-next:visible, .next-step:visible"
  ];

  for (let step = 0; step < 3; step++) {
    let clickedNext = false;
    for (const nextSel of nextStepSelectors) {
      const nextBtn = page.locator(nextSel).first();
      if ((await nextBtn.count().catch(() => 0)) > 0 && (await nextBtn.isVisible().catch(() => false))) {
        const visibleCbs = page.locator("input[type='checkbox']:visible");
        if ((await visibleCbs.count().catch(() => 0)) > 0) {
          const firstCb = visibleCbs.first();
          if (!(await firstCb.isChecked().catch(() => false))) {
            await firstCb.check({ force: true }).catch(() => undefined);
            await page.waitForTimeout(250);
          }
        }
        await nextBtn.scrollIntoViewIfNeeded().catch(() => undefined);
        await nextBtn.click({ force: true }).catch(() => undefined);
        await page.waitForTimeout(1000);
        clickedNext = true;
        if (leadData) {
          await fillAllVisibleForms(page, leadData).catch(() => undefined);
        }
        break;
      }
    }

    if (clickedNext) {
      const reEval = primaryForm ? await evaluateLocator(primaryForm) : await evaluatePageOrFrame(page);
      if (reEval && reEval.selectedCandidate) {
        const targetScope = primaryForm ?? page;
        const locator = targetScope.locator("[data-sdi-submit='selected']").first();
        return { locator, diagnostics: reEval };
      }
    } else {
      break;
    }
  }

  // 5. Fallback safety net for zero-height Gravity / Forminator buttons
  const fallbackSelectors = [
    "button[type='submit']",
    "input[type='submit']",
    ".wpcf7-submit",
    ".gform_button",
    ".forminator-button-submit",
    "button.wpforms-submit",
    "button:has-text('Submit')",
    "button:has-text('Send')"
  ];
  for (const sel of fallbackSelectors) {
    const loc = (primaryForm ?? page).locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0) {
      await loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => undefined);
      if (await loc.isVisible().catch(() => false)) {
        return {
          locator: loc,
          diagnostics: {
            submitCandidateCount: 1,
            rejectedCandidateCount: 0,
            selectedCandidate: { tagName: "button", type: "submit", text: "Fallback Match", score: 60 },
            selectedScore: 60,
            rejectionReasons: []
          }
        };
      }
    }
  }

  return { locator: null, diagnostics: defaultDiag };
}

export async function findSubmitButton(page: Page, leadData?: LeadData, targetForm?: Locator | null): Promise<Locator | null> {
  const { locator } = await findSubmitButtonWithDiagnostics(page, leadData, targetForm);
  return locator;
}

export async function detectBookingWidget(page: Page, fieldsFilledCount = 0): Promise<BookingWidgetDetection> {
  const frames = page.frames();
  const frameURLs = frames.map((f) => f.url()).filter((u) => u && u !== "about:blank");
  const frameCount = frames.length;

  const iframeMatch = await page
    .locator("iframe")
    .evaluateAll((iframes) => {
      for (const iframe of iframes) {
        const src = iframe.getAttribute("src") ?? "";
        const title = iframe.getAttribute("title") ?? "";
        const lowerSrc = src.toLowerCase();
        const lowerTitle = title.toLowerCase();

        if (lowerSrc.includes("calendly") || lowerTitle.includes("calendly")) {
          return { widgetType: "calendly", reason: "iframe contains Calendly" };
        }

        if (lowerSrc.includes("leadconnector") || lowerSrc.includes("highlevel") || lowerTitle.includes("leadconnector")) {
          return { widgetType: "leadconnector", reason: "iframe contains LeadConnector / HighLevel booking widget" };
        }

        if (/(^|\.)meetings(-[a-z0-9]+)?\.hubspot\.com/i.test(lowerSrc) || lowerSrc.includes("meetings.hubspot.com")) {
          return { widgetType: "hubspot", reason: "iframe contains HubSpot Meetings" };
        }

        if (/acuityscheduling\.com|tidycal\.com|simplybook\.me|youcanbook\.me|calendarhero\.com|appointlet\.com|setmore\.com|cal\.com/i.test(lowerSrc)) {
          return { widgetType: "third_party", reason: "iframe contains booking calendar widget" };
        }
      }

      return null;
    })
    .catch(() => null);

  if (iframeMatch) {
    return {
      found: true,
      state: "BOOKING_FRAME_FOUND",
      reason: iframeMatch.reason,
      frameCount,
      frameURLs,
      widgetType: iframeMatch.widgetType
    };
  }

  const containerMatch = await page.evaluate(() => {
    const calendarContainers = document.querySelectorAll(
      ".widgets-step-1, .label-select-date, .vdpCell.selectable, [class*='booking-calendar' i], [class*='scheduler' i], [data-testid*='calendar' i], [class*='calendar-grid' i], [role='grid'][aria-label*='calendar' i]"
    );
    return calendarContainers.length > 0;
  }).catch(() => false);

  if (containerMatch) {
    return {
      found: true,
      state: "BOOKING_CONTAINER_FOUND",
      reason: "calendar container element detected",
      frameCount,
      frameURLs,
      widgetType: "embedded_container"
    };
  }

  const dateGridMatch = await page
    .locator("button, [role='button'], [role='gridcell']")
    .evaluateAll((elements) => {
      const visible = elements.filter((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0 &&
          !el.closest("footer, header, nav")
        );
      });
      const numericButtons = visible.filter((el) => {
        const text = (el.textContent ?? "").trim();
        const label = el.getAttribute("aria-label") ?? "";
        return /^\d{1,2}$/.test(text) || /\b\d{1,2},?\s?\d{4}\b/.test(label);
      });
      return numericButtons.length >= 5;
    })
    .catch(() => false);

  if (dateGridMatch) {
    return {
      found: true,
      state: "BOOKING_READY",
      reason: "multiple date-slot buttons detected",
      frameCount,
      frameURLs,
      widgetType: "interactive_calendar_grid"
    };
  }

  if (fieldsFilledCount >= 2) {
    return {
      found: false,
      state: "BOOKING_NOT_FOUND",
      reason: null,
      frameCount,
      frameURLs
    };
  }

  return {
    found: false,
    state: "BOOKING_NOT_FOUND",
    reason: null,
    frameCount,
    frameURLs
  };
}

async function submitBookingWidget({
  page,
  websiteUrl,
  submittedAt,
  filledFields,
  skippedFields,
  reason
}: {
  page: Page;
  websiteUrl: string;
  submittedAt: Date;
  filledFields: string[];
  skippedFields: string[];
  reason: string;
}): Promise<SubmitContactFormResult> {
  const screenshotPath = await takeScreenshot(page, websiteUrl, "booking-widget-found");

  return {
    websiteUrl,
    status: "booking_widget_found",
    errorMessage: null,
    screenshotPath,
    submittedAt,
    filledFields,
    skippedFields,
    bookingWidgetReason: reason
  };
}

async function checkButtonOrFormStateChange(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // 1. Check if submit button changed text to positive confirmation
    const buttons = Array.from(document.querySelectorAll("button, input[type='submit'], [role='button']"));
    const hasSuccessButton = buttons.some((b) => {
      const txt = (b.textContent || (b as HTMLInputElement).value || "").toLowerCase().trim();
      return /^(sent!?|message sent!?|submitted!?|success!?|thank you!?|enviado!?|gesendet!?)$/i.test(txt);
    });
    if (hasSuccessButton) return true;

    // 2. Check if active form has completed class or data-status attribute
    const forms = Array.from(document.querySelectorAll("form, [data-form]"));
    const hasSubmittedForm = forms.some((f) => {
      const cls = (f.className || "").toLowerCase();
      const statusAttr = (f.getAttribute("data-status") || f.getAttribute("data-state") || "").toLowerCase();
      return (
        cls.includes("sent") ||
        cls.includes("submitted") ||
        cls.includes("success") ||
        cls.includes("completed") ||
        statusAttr === "success" ||
        statusAttr === "sent"
      );
    });
    if (hasSubmittedForm) return true;

    // 3. Check for positive toast / alert in DOM
    const alerts = Array.from(document.querySelectorAll("[role='alert'], [role='status'], .toast, .swal2-container, .alert, .notification, .notyf"));
    const hasSuccessAlert = alerts.some((a) => {
      const txt = (a.textContent || "").toLowerCase();
      return (txt.includes("thank") || txt.includes("sent") || txt.includes("success") || txt.includes("received")) &&
             !txt.includes("error") && !txt.includes("fail") && !txt.includes("invalid");
    });
    return hasSuccessAlert;
  }).catch(() => false);
}

async function detectSuccess(page: Page, isNetworkSuccess?: () => boolean) {
  // Fast-path polling loop: check immediately and every 300ms for up to 4.5s
  const startTime = Date.now();
  const maxWaitMs = 4500;

  while (Date.now() - startTime < maxWaitMs) {
    // 0. Check network AJAX success flag
    if (isNetworkSuccess && isNetworkSuccess()) {
      return true;
    }

    // 1. Check URL redirect or path
    const currentUrl = page.url().toLowerCase();
    if (/(thank[_-]?you|thanks|success|confirmed|submission-received|message-sent|inquiry-received|\/sent|\/done)/i.test(currentUrl)) {
      return true;
    }

    // 2. Check known successful form framework selectors
    const isMatched = await checkSuccessFrameworkSelectors(page);
    if (isMatched) return true;

    // 3. Check page and child frames body text
    const textMatched = await checkSuccessText(page);
    if (textMatched) return true;

    // 4. Check button text or form state change
    const stateChanged = await checkButtonOrFormStateChange(page);
    if (stateChanged) return true;

    await page.waitForTimeout(300);
  }

  // Final check on network flag
  if (isNetworkSuccess && isNetworkSuccess()) {
    return true;
  }

  return false;
}

async function checkSuccessFrameworkSelectors(page: Page): Promise<boolean> {
  const successSelectors = [
    ".wpcf7-mail-sent-ok:visible",
    ".wpcf7-response-output:not(.wpcf7-validation-errors):not(.wpcf7-mail-sent-ng):not(.wpcf7-spam-blocked):visible",
    ".elementor-message-success:visible",
    ".w-form-done:visible",
    ".w-form-done[style*='display: block']",
    ".w-form-done:not([style*='display: none'])",
    ".form-submission-success:visible",
    ".alert-success:visible",
    ".success-message:visible",
    "[role='alert']:has-text('thank')",
    "[role='alert']:has-text('sent')",
    "[role='alert']:has-text('success')",
    ".submitted-message:visible",
    ".form-success:visible",
    ".gform_confirmation_message:visible",
    ".nf-response-msg:visible",
    ".fluentform-submission-success:visible",
    ".wpforms-confirmation-container:visible",
    ".wpforms-confirmation-scroll:visible",
    ".wpforms-confirmation-container-full:visible",
    ".frm_message:visible",
    ".ff-message-success:visible",
    "[data-form-status='success']:visible",
    "[aria-live='polite']:has-text('thank')",
    "[aria-live='polite']:has-text('success')",
    ".form-feedback:has-text('thank')",
    ".forminator-response-message:visible",
    ".hubspot-form-success:visible",
    ".hs-form-success:visible",
    ".toast-success:visible",
    ".toastr-success:visible",
    ".iziToast-success:visible",
    ".swal2-success:visible",
    ".caldera-grid .alert-success",
    ".super-msg.super-success:visible",
    "[data-status='mail_sent']:visible",
    "[data-status='sent']:visible",
    "form.sent:visible",
    ".wpcf7 form.sent:visible",
    ".chakra-alert[data-status='success']",
    ".ant-message-success",
    ".ant-alert-success",
    ".MuiAlert-standardSuccess",
    ".notyf__toast--success"
  ];

  for (const selector of successSelectors) {
    const isMatched = await page.locator(selector).first().isVisible().catch(() => false);
    if (isMatched) return true;
  }
  return false;
}

async function checkSuccessText(page: Page): Promise<boolean> {
  const successPatterns = [
    "thank you",
    "thanks for reaching out",
    "thanks for contacting",
    "thanks for your inquiry",
    "thank you for contacting",
    "thank you for reaching out",
    "thank you for your message",
    "thank you for getting in touch",
    "we have received your message",
    "your inquiry has been received",
    "we will respond",
    "message has been sent",
    "successfully sent",
    "message sent successfully",
    "your message was sent",
    "your message has been sent",
    "your submission has been received",
    "submission received",
    "we will be in touch",
    "we'll be in touch",
    "we will get back to you",
    "we'll get back to you",
    "talk to you soon",
    "inquiry has been sent",
    "request submitted",
    "form submitted successfully",
    "as soon as possible",
    "message successfully sent",
    "email sent successfully",
    "we received your message",
    "your request has been sent",
    "thanks for connecting",
    "thanks for your message",
    "thank you for your submission",
    "your form has been submitted",
    "your message has been successfully sent",
    "your details have been sent",
    "we'll contact you shortly",
    "we will contact you shortly",
    "we will get back to you shortly",
    "we'll get back to you shortly",
    "someone will be in touch",
    "a member of our team will be in touch",
    "thank you! your submission has been received",
    "thank you for submitting",
    "thanks for reaching out to us",
    "thanks for contacting us",
    "your response has been recorded",
    "form submitted",
    "message received",
    // Multilingual Success Patterns
    "gracias por contactar",
    "mensaje enviado",
    "hemos recibido su mensaje",
    "solicitud enviada",
    "merci pour votre message",
    "message envoyé",
    "bien reçu votre message",
    "vielen dank für ihre nachricht",
    "nachricht erfolgreich gesendet",
    "ihre anfrage wurde gesendet",
    "grazie per averci contattato",
    "messaggio inviato",
    "richiesta inviata",
    "obrigado por entrar em contato",
    "mensagem enviada",
    "bedankt voor uw bericht",
    "bericht succesvol verzonden"
  ];

  const bodyText = (await page.locator("body").innerText({ timeout: 1500 }).catch(() => ""))
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (successPatterns.some((pattern) => bodyText.includes(pattern))) {
    return true;
  }

  // Also check child iframes
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const frameText = (await frame.locator("body").innerText({ timeout: 1000 }).catch(() => ""))
      .toLowerCase()
    const frameUrl = frame.url().toLowerCase();
    if (/(thank[_-]?you|thanks|success|confirmed)/i.test(frameUrl)) return true;
    if (successPatterns.some((pattern) => frameText.includes(pattern))) {
      return true;
    }
  }

  return false;
}

async function takeScreenshot(page: Page, websiteUrl: string, label: string) {
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
    console.warn("Screenshot capture skipped:", err);
    return null;
  }
}

async function persistResult(result: SubmitContactFormResult, leadData: LeadData) {
  const user = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: {},
    create: {
      name: "Demo User",
      email: DEMO_USER_EMAIL,
      passwordHash: "demo-mode"
    }
  });
  const existingLead = await prisma.lead.findFirst({
    where: { userId: user.id, email: leadData.email }
  });
  const leadDataForSave = {
    fullName: leadData.fullName || [leadData.firstName, leadData.lastName].filter(Boolean).join(" ") || "Lead",
    mobileNumber: leadData.mobile ?? leadData.mobileNumber ?? "",
    email: leadData.email,
    address: leadData.address ?? "",
    message: leadData.message ?? "",
    companyName: leadData.companyName ?? "",
    userId: user.id
  };
  const lead = existingLead
    ? await prisma.lead.update({
        where: { id: existingLead.id },
        data: leadDataForSave
      })
    : await prisma.lead.create({ data: leadDataForSave });
  const existingTargetWebsite = await prisma.targetWebsite.findFirst({
    where: { userId: user.id, contactPageUrl: result.websiteUrl }
  });
  const targetWebsite = existingTargetWebsite
    ? await prisma.targetWebsite.update({
        where: { id: existingTargetWebsite.id },
        data: { websiteUrl: result.websiteUrl, status: "active" }
      })
    : await prisma.targetWebsite.create({
        data: {
      websiteName: new URL(result.websiteUrl).hostname,
      websiteUrl: result.websiteUrl,
      contactPageUrl: result.websiteUrl,
      status: "active",
      notes: "Created by Playwright contact form automation",
      userId: user.id
    }
      });
  const job = await prisma.submissionJob.create({
    data: {
      status: normalizeStatus(result.status),
      startedAt: result.submittedAt,
      completedAt: new Date(),
      userId: user.id,
      leadId: lead.id
    }
  });

  await prisma.submissionResult.create({
    data: {
      status: result.status,
      message:
        result.status === "success"
          ? "Contact form submitted successfully."
          : result.status === "booking_widget_found"
            ? `Booking widget found: ${result.bookingWidgetReason ?? "calendar detected"}`
          : result.errorMessage ?? "Contact form submission failed.",
      screenshotPath: result.screenshotPath,
      submittedAt: result.submittedAt,
      jobId: job.id,
      leadId: lead.id,
      targetWebsiteId: targetWebsite.id
    }
  });
}

async function shouldAttemptCaptchaSolve(websiteUrl: string, userId?: string): Promise<boolean> {
  if (isAuthorizedCaptchaTestTarget(websiteUrl)) return true;
  if (!userId) return false;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { captchaEnabled: true }
    });
    return Boolean(user?.captchaEnabled);
  } catch {
    return false;
  }
}

export async function validateFormBeforeSubmission(
  page: Page,
  formScope: Locator | null,
  leadData: LeadData
): Promise<{ valid: boolean; failureReason?: string; failedField?: string }> {
  const hasFormScope = Boolean(formScope && (await formScope.count().catch(() => 0)) > 0);
  const rootScope: FormScope = hasFormScope && formScope ? formScope : page;

  // 1. Pre-validation sweep: ensure unselected required dropdowns select first valid real option
  await sweepAndSelectRequiredDropdowns(rootScope).catch(() => undefined);

  // 2. Pre-validation sweep: ensure required checkboxes are checked
  await sweepAndCheckPreSubmitCheckboxes(page, formScope).catch(() => undefined);

  // 2b. Pre-validation sweep: ensure unselected button selection groups select first option
  await selectFirstOptionInButtonGroups(rootScope).catch(() => undefined);

  // 3. HTML5 constraint validation check on all visible form controls with active self-healing
  const getValidationError = async () => {
    return hasFormScope && formScope
      ? await formScope.evaluate((container: HTMLElement) => {
          const invalidControls = Array.from(
            container.querySelectorAll("input:invalid:not([type='hidden']), select:invalid, textarea:invalid")
          );
          for (const ctrl of invalidControls) {
            const el = ctrl as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const isVisible = (rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden") || el.required;
            if (!isVisible) continue;

            const identifier = el.name || el.id || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.tagName.toLowerCase();
            const msg = el.validationMessage || "Invalid or incomplete required field";
            return {
              identifier,
              msg,
              tagName: el.tagName.toLowerCase(),
              type: el.getAttribute("type") || ""
            };
          }
          return null;
        }).catch(() => null)
      : await page.evaluate(() => {
          const invalidControls = Array.from(
            document.querySelectorAll("input:invalid:not([type='hidden']), select:invalid, textarea:invalid")
          );
          for (const ctrl of invalidControls) {
            const el = ctrl as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const isVisible = (rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden") || el.required;
            if (!isVisible) continue;

            const identifier = el.name || el.id || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.tagName.toLowerCase();
            const msg = el.validationMessage || "Invalid or incomplete required field";
            return {
              identifier,
              msg,
              tagName: el.tagName.toLowerCase(),
              type: el.getAttribute("type") || ""
            };
          }
          return null;
        }).catch(() => null);
  };

  let validationError = await getValidationError();

  // If validation errors are detected, attempt active self-healing before failing
  if (validationError) {
    const healFn = (leadDataArg: any) => {
      const invalidControls = Array.from(
        document.querySelectorAll("input:invalid:not([type='hidden']), select:invalid, textarea:invalid")
      ) as (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[];

      const pPattern = /^(select|choose|please\s+(select|choose)|which|pick\s+an?|--|none\b|0\b|^$)/i;

      for (const el of invalidControls) {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute("type") || "").toLowerCase();
        const nameOrId = `${el.name || ""} ${el.id || ""} ${el.getAttribute("placeholder") || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();

        // 1. Dropdown select
        if (tag === "select") {
          const select = el as HTMLSelectElement;
          if (select.options && select.options.length > 0) {
            let targetIdx = Array.from(select.options).findIndex(
              (o) => !o.disabled && (o.value || "").trim() !== "" && !pPattern.test((o.textContent || "").trim())
            );
            if (targetIdx < 0) {
              targetIdx = Array.from(select.options).findIndex(
                (o) => !o.disabled && (o.textContent || "").trim() !== "" && !pPattern.test((o.textContent || "").trim())
              );
            }
            if (targetIdx < 0 && select.options.length > 1) targetIdx = 1;
            if (targetIdx >= 0) {
              select.selectedIndex = targetIdx;
              const opt = select.options[targetIdx];
              if (opt) {
                if (select.required && !opt.value) {
                  opt.value = (opt.textContent || "").trim();
                }
                select.value = opt.value;
              }
              const tracker = (select as any)._valueTracker;
              if (tracker) tracker.setValue("");
              select.dispatchEvent(new Event("input", { bubbles: true }));
              select.dispatchEvent(new Event("change", { bubbles: true }));
              select.dispatchEvent(new Event("blur", { bubbles: true }));
            }
          }
          continue;
        }

        // 2. Checkbox
        if (type === "checkbox") {
          const cb = el as HTMLInputElement;
          cb.checked = true;
          const tracker = (cb as any)._valueTracker;
          if (tracker) tracker.setValue(false);
          cb.dispatchEvent(new Event("input", { bubbles: true }));
          cb.dispatchEvent(new Event("change", { bubbles: true }));
          continue;
        }

        // 3. Radio
        if (type === "radio") {
          const rb = el as HTMLInputElement;
          rb.checked = true;
          rb.dispatchEvent(new Event("input", { bubbles: true }));
          rb.dispatchEvent(new Event("change", { bubbles: true }));
          continue;
        }

        // 4. Input / Textarea
        let fillVal = "";
        const nameParts = (leadDataArg.fullName || "").trim().split(/\s+/).filter(Boolean);
        const derivedFirstName = leadDataArg.firstName || (nameParts.length > 0 ? nameParts[0] : "");
        const derivedLastName = leadDataArg.lastName || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "");

        if (type === "email" || nameOrId.includes("email") || (nameOrId.includes("mail") && !nameOrId.includes("address"))) {
          fillVal = (leadDataArg.email || "").trim() || "aadityavarma490@gmail.com";
        } else if (type === "tel" || nameOrId.includes("phone") || nameOrId.includes("tel") || nameOrId.includes("mobile") || nameOrId.includes("whatsapp") || nameOrId.includes("contact_number") || nameOrId.includes("pn")) {
          const rawMobile = leadDataArg.mobile || leadDataArg.mobileNumber || leadDataArg.phone || "";
          if (rawMobile) {
            const digits = rawMobile.replace(/\D/g, "");
            const area = digits.length >= 10 ? (digits.length === 11 && digits.startsWith("1") ? digits.slice(1, 4) : digits.slice(0, 3)) : "555";
            const prefix = digits.length >= 10 ? (digits.length === 11 && digits.startsWith("1") ? digits.slice(4, 7) : digits.slice(3, 6)) : "234";
            const line = digits.length >= 10 ? (digits.length === 11 && digits.startsWith("1") ? digits.slice(7, 11) : digits.slice(6, 10)) : "5678";
            const phoneCandidates = [
              `(${area}) ${prefix}-${line}`,
              `${area}-${prefix}-${line}`,
              `${area}${prefix}${line}`,
              `+1${area}${prefix}${line}`,
              `+1 (${area}) ${prefix}-${line}`,
              `+1-${area}-${prefix}-${line}`,
              `${area}.${prefix}.${line}`,
              `${area} ${prefix} ${line}`
            ];
            let bestPhone = phoneCandidates[0];
            const max = (el as HTMLInputElement).maxLength > 0 ? (el as HTMLInputElement).maxLength : 999;
            for (const cand of phoneCandidates) {
              if (cand.length > max) continue;
              (el as HTMLInputElement).value = cand;
              if ((el as HTMLInputElement).checkValidity()) {
                bestPhone = cand;
                break;
              }
            }
            fillVal = bestPhone;
          } else {
            fillVal = "(555) 234-5678";
          }
        } else if (nameOrId.includes("first") || nameOrId.includes("fname") || nameOrId.includes("given")) {
          fillVal = derivedFirstName;
        } else if (nameOrId.includes("last") || nameOrId.includes("lname") || nameOrId.includes("surname") || nameOrId.includes("family")) {
          fillVal = derivedLastName;
        } else if (nameOrId.includes("name") && !nameOrId.includes("company") && !nameOrId.includes("business") && !nameOrId.includes("user")) {
          fillVal = leadDataArg.fullName || "";
        } else if (nameOrId.includes("company") || nameOrId.includes("organization") || nameOrId.includes("business") || nameOrId.includes("employer") || nameOrId.includes("org")) {
          fillVal = leadDataArg.companyName || leadDataArg.company || "";
        } else if (nameOrId.includes("website") || nameOrId.includes("url") || nameOrId.includes("site")) {
          fillVal = leadDataArg.website || "";
        } else if (nameOrId.includes("address") || nameOrId.includes("street") || nameOrId.includes("addr")) {
          fillVal = leadDataArg.address || "";
        } else if (nameOrId.includes("city") || nameOrId.includes("town") || nameOrId.includes("location")) {
          fillVal = leadDataArg.city || "New York";
        } else if (nameOrId.includes("state") || nameOrId.includes("province") || nameOrId.includes("region")) {
          fillVal = leadDataArg.state || "New York";
        } else if (nameOrId.includes("country") || nameOrId.includes("nation")) {
          fillVal = leadDataArg.country || "United States";
        } else if (nameOrId.includes("zip") || nameOrId.includes("postal")) {
          fillVal = leadDataArg.zip || leadDataArg.postalCode || "";
        } else if (nameOrId.includes("job") || nameOrId.includes("title") || nameOrId.includes("position") || nameOrId.includes("role") || nameOrId.includes("occupation") || nameOrId.includes("designation")) {
          fillVal = leadDataArg.jobTitle || "Business Consultant";
        } else if (nameOrId.includes("subject") || nameOrId.includes("topic") || nameOrId.includes("contacttype")) {
          fillVal = leadDataArg.subject || "";
        } else if (el.tagName.toLowerCase() === "textarea" || nameOrId.includes("message") || nameOrId.includes("comment") || nameOrId.includes("inquiry") || nameOrId.includes("question") || nameOrId.includes("detail")) {
          fillVal = leadDataArg.message || "";
        }

        if (fillVal) {
          el.value = fillVal;
          const tracker = (el as any)._valueTracker;
          if (tracker) tracker.setValue("");
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("blur", { bubbles: true }));
        }
      }
    };

    if (hasFormScope && formScope) {
      await formScope.evaluate(healFn, leadData).catch(() => undefined);
    } else {
      await page.evaluate(healFn, leadData).catch(() => undefined);
    }

    await page.waitForTimeout(200);
    validationError = await getValidationError();
  }

  if (validationError) {
    return {
      valid: false,
      failureReason: `Browser validation failed on "${validationError.identifier}": ${validationError.msg}`,
      failedField: validationError.identifier
    };
  }

  // 4. Verify all required <select> dropdowns have valid non-placeholder selections
  const checkInvalidSelect = async () => {
    return hasFormScope && formScope
      ? await formScope.evaluate((container: HTMLElement) => {
          const selects = Array.from(container.querySelectorAll("select")) as HTMLSelectElement[];
          const pPattern = /^(select|choose|please\s+(select|choose)|which|pick\s+an?|--|none\b|0\b|^$)/i;
          for (const sel of selects) {
            const isReq = sel.required || sel.getAttribute("aria-required") === "true";
            if (!isReq) continue;
            const rect = sel.getBoundingClientRect();
            const style = window.getComputedStyle(sel);
            if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) continue;

            const opt = sel.options[sel.selectedIndex];
            const val = (opt?.value || sel.value || "").trim();
            const txt = (opt?.textContent || "").trim();
            const hasValid = Boolean(val || txt) && !pPattern.test(txt) && !pPattern.test(val) && !(val === "" && pPattern.test(txt));
            if (!hasValid || sel.matches(":invalid")) {
              return sel.name || sel.id || "Required dropdown";
            }
          }
          return null;
        }).catch(() => null)
      : await page.evaluate(() => {
          const selects = Array.from(document.querySelectorAll("select")) as HTMLSelectElement[];
          const pPattern = /^(select|choose|please\s+(select|choose)|which|pick\s+an?|--|none\b|0\b|^$)/i;
          for (const sel of selects) {
            const isReq = sel.required || sel.getAttribute("aria-required") === "true";
            if (!isReq) continue;
            const rect = sel.getBoundingClientRect();
            const style = window.getComputedStyle(sel);
            if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) continue;

            const opt = sel.options[sel.selectedIndex];
            const val = (opt?.value || sel.value || "").trim();
            const txt = (opt?.textContent || "").trim();
            const hasValid = Boolean(val || txt) && !pPattern.test(txt) && !pPattern.test(val) && !(val === "" && pPattern.test(txt));
            if (!hasValid || sel.matches(":invalid")) {
              return sel.name || sel.id || "Required dropdown";
            }
          }
          return null;
        }).catch(() => null);
  };

  let invalidSelect = await checkInvalidSelect();
  if (invalidSelect) {
    // Attempt final sweep and select on rootScope
    await sweepAndSelectRequiredDropdowns(rootScope).catch(() => undefined);
    await page.waitForTimeout(200);
    invalidSelect = await checkInvalidSelect();
  }

  if (invalidSelect) {
    return {
      valid: false,
      failureReason: `Browser validation failed on "${invalidSelect}": Please select an item in the list.`,
      failedField: invalidSelect
    };
  }

  return { valid: true };
}

export async function submitContactForm({
  websiteUrl,
  leadData,
  headless = true,
  submit = true,
  liveSubmit,
  timeoutMs = 300000,
  browserContext,
  skipPersist,
  userId,
  skipActionButtons = false,
  activePage: customPage,
  onProgress
}: SubmitContactFormInput & { browserContext?: BrowserContext; skipPersist?: boolean; userId?: string; liveSubmit?: boolean; skipActionButtons?: boolean; activePage?: Page }): Promise<SubmitContactFormResult> {
  const shouldSubmit = liveSubmit !== undefined ? liveSubmit : submit;
  let browser: Browser | null = null;
  let page: Page | null = null;
  const submittedAt = new Date();
  let screenshotPath: string | null = null;
  let submittedFormId: string | null = null;
  let filledFields: string[] = [];
  let skippedFields: string[] = [];
  let fillMetrics: FormFillMetrics | null = null;

  const tStart = Date.now();
  let tNav = 0;
  let tReadiness = 0;
  let tFieldFilling = 0;
  let tSubmitDiscovery = 0;
  let submitDiag: SubmitCandidateDiagnostic | null = null;
  let cookieGuardian: CookieGuardianController | null = null;

  try {
    if (customPage) {
      page = customPage;
    } else if (browserContext) {
      page = await browserContext.newPage();
    } else {
      browser = await chromium.launch({
        headless: process.env.NODE_ENV === "production" || (!process.env.DISPLAY && process.platform !== "win32") ? true : headless,
        executablePath: await getChromiumExecutablePath(),
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu"
        ]
      });
      page = await browser.newPage({
        viewport: { width: 1366, height: 900 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
      });
    }
    if (!page) {
      throw new Error("Failed to initialize browser page.");
    }
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(45000);

    // A contact form can be usable even when a legacy script, tracker, or other
    // resource prevents DOMContentLoaded/networkidle from completing. Continue
    // as soon as the server commits the document, then wait for form controls.
    const activePage = page;
    await blockHeavyAssets(activePage).catch(() => undefined);
    await installCookieGuardianInitScript(activePage).catch(() => undefined);
    cookieGuardian = startParallelCookieGuardian(activePage);
    let proxy407Hit = false;
    let on407Reject: ((err: any) => void) | null = null;
    const proxy407Promise = new Promise((_, reject) => {
      on407Reject = reject;
    });
    proxy407Promise.catch(() => {});
    const responseHandler = (res: any) => {
      if (res.status() === 407) {
        proxy407Hit = true;
        if (on407Reject) on407Reject(new ProxyAuthenticationError(PROXY_407_MESSAGE));
      }
    };
    activePage.on("response", responseHandler);

    // Configurable navigation-to-usable-page rule (default 45s)
    const NAVIGATION_TIMEOUT_MS = Math.min(45000, timeoutMs);
    const tNavStart = Date.now();
    let navResponse: any = null;
    let pageUsable = false;

    if (!customPage) {
      try {
        const gotoPromise = activePage.goto(websiteUrl, {
          waitUntil: "commit",
          timeout: NAVIGATION_TIMEOUT_MS
        }).catch((err: any) => {
          if (isProxyAuthenticationFailure(err) || proxy407Hit) {
            throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
          }
          const errStr = err?.message || String(err);
          if (/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_ADDRESS_UNREACHABLE|ERR_CERT_COMMON_NAME_INVALID/i.test(errStr)) {
            throw err;
          }
          return null;
        });

        const checkUsable = async () => {
          return activePage.evaluate(() => {
            const body = document.body;
            if (!body) return { isUsable: false };
            const innerText = body.innerText || "";
            if (/502 bad gateway|504 gateway time-out|dns_probe_finished|err_connection_/i.test(innerText)) {
              return { isUsable: false };
            }
            const formCount = document.querySelectorAll("form, [role='form'], [class*='w-form'], [data-name*='form']").length;
            const inputCount = document.querySelectorAll("input:not([type='hidden']), textarea, select, [role='textbox']").length;
            const buttonCount = document.querySelectorAll("button, input[type='submit'], [role='button'], a[class*='btn'], a[class*='button']").length;
            const navCount = document.querySelectorAll("header a, nav a, footer a, [role='banner'] a, [role='navigation'] a, [role='contentinfo'] a, a[href*='contact']").length;
            const textLength = innerText.trim().length;

            const isUsable = formCount > 0 || (inputCount >= 1 && buttonCount >= 1) || navCount >= 1 || textLength >= 80;
            return { isUsable, formCount, inputCount, buttonCount, textLength };
          }).catch(() => ({ isUsable: false }));
        };

        navResponse = await Promise.race([gotoPromise, proxy407Promise]);
        if (proxy407Hit) throw new ProxyAuthenticationError(PROXY_407_MESSAGE);

        while (Date.now() - tNavStart < NAVIGATION_TIMEOUT_MS) {
          const u = await checkUsable();
          if (u.isUsable) {
            pageUsable = true;
            break;
          }
          await activePage.waitForTimeout(100);
        }

        if (pageUsable) {
          const usableDuration = Date.now() - tNavStart;
          console.log(`[NAVIGATION] Page became usable in ${usableDuration}ms for ${websiteUrl}`);
        } else {
          console.warn(`[NAVIGATION] 25-second navigation timeout occurred for ${websiteUrl} (usable DOM state not reached)`);
          if (navResponse) {
            await activePage.evaluate(() => window.stop()).catch(() => undefined);
          }
          throw new Error(`NAVIGATION_TIMEOUT: Navigation to usable page timed out after ${Math.round(NAVIGATION_TIMEOUT_MS / 1000)} seconds for ${websiteUrl}`);
        }
      } finally {
        activePage.off("response", responseHandler);
      }
    } else {
      activePage.off("response", responseHandler);
      pageUsable = true;
    }
    tNav = Date.now() - tNavStart;

    if (navResponse?.status() === 407 || proxy407Hit) {
      throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
    }

    const pageBodyText = await activePage.locator("body").innerText({ timeout: 1500 }).catch(() => "");
    if (isProxyAuthenticationFailure(null, navResponse?.status(), pageBodyText)) {
      screenshotPath = await takeScreenshot(page, websiteUrl, "proxy-407-failure").catch(() => null);
      throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
    }

    const statusCode = navResponse?.status();
    const pageTitle = await activePage.title().catch(() => "");
    if (statusCode === 403 || /403 forbidden/i.test(pageTitle) || /^403 forbidden/i.test(pageBodyText.trim())) {
      throw new Error("Website blocked access (HTTP 403 Forbidden).");
    }

    // Dismiss cookie banners immediately without artificial universal readiness delay
    const tReadinessStart = Date.now();
    await dismissCookieBanners(activePage).catch(() => undefined);
    tReadiness = Date.now() - tReadinessStart;

    const canSolveCaptcha = await shouldAttemptCaptchaSolve(websiteUrl, userId);

    const verification = await detectUnsupportedVerification(page, websiteUrl);
    if (verification) {
      if (verification.blocking === true) {
        // Blocking full-screen challenge (e.g. Cloudflare interstitial, 202 robot challenge)
        if (canSolveCaptcha) {
          const solveRes = await handleCaptchaSolvingForTarget({
            page,
            websiteUrl,
            userId,
            timeoutMs: Math.max(timeoutMs, 90000)
          });
          if (!solveRes.solved) {
            if (verification.screenshotPath) screenshotPath = verification.screenshotPath;
            throw new Error(solveRes.errorMessage || verification.reason);
          }
        } else {
          if (verification.screenshotPath) screenshotPath = verification.screenshotPath;
          throw new Error(verification.reason);
        }
      } else if (canSolveCaptcha) {
        // Inline CAPTCHA widget on contact form - attempt solver if enabled
        const solveRes = await handleCaptchaSolvingForTarget({
          page,
          websiteUrl,
          userId,
          timeoutMs: Math.max(timeoutMs, 90000)
        }).catch((err) => ({ solved: false, reason: err.message }));
        if (solveRes.solved) {
          console.log(`[contact-form-automation] CAPTCHA solved and applied for ${websiteUrl}`);
        }
      }
    }

    // Warm up page interactions to trigger delayed scripts (WP Rocket, LiteSpeed Cache, etc.)
    await activePage.mouse.move(150, 250).catch(() => undefined);
    await activePage.evaluate(() => {
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("mousemove"));
      window.dispatchEvent(new Event("touchstart"));
    }).catch(() => undefined);
    await activePage.waitForTimeout(300);

    // Resolve any spintax choices in the message/subject before filling
    const effectiveLeadData = {
      ...leadData,
      message: resolveSpintax(leadData.message || ""),
      subject: resolveSpintax(leadData.subject || "")
    };

    // Fill the selected primary form only once.
    await onProgress?.("fill_form", "Filling form fields with lead data...");
    // Proactively dismiss/accept any cookie consent banners before filling form fields
    await dismissCookieBanners(activePage).catch(() => undefined);
    const tFillStart = Date.now();
    const fillResult = await fillAllVisibleForms(page, effectiveLeadData);
    tFieldFilling = Date.now() - tFillStart;
    filledFields = fillResult.filledFields;
    skippedFields = fillResult.skippedFields;
    fillMetrics = fillResult.metrics;
    const substantiveFieldsCount = fillResult.filledFields.filter(
      (f) => !f.startsWith("consentCheckbox:") && !f.startsWith("preSubmitCheckbox:")
    ).length;

    // Action Button Fallback for pages where no substantive contact form fields were filled:
    // If no form was found or 0 substantive contact fields (name, email, message, etc.) were filled on the page,
    // invoke Action Button Fallback to discover action buttons ("Book Now", "Book a Call", "Get in Touch", etc.)
    // that open new tabs, modals, or navigated forms!
    if (substantiveFieldsCount === 0 && !skipActionButtons) {
      console.log(`[contact-form-automation] No substantive contact form completed on initial page ${websiteUrl}. Invoking Action Button Fallback...`);
      const { executeActionButtonFallback } = await import("./action-button-fallback");
      const fallbackRes = await executeActionButtonFallback({
        page,
        websiteUrl,
        leadData: effectiveLeadData,
        submit,
        liveSubmit,
        timeoutMs,
        browserContext: browserContext ?? page.context(),
        skipPersist,
        userId
      });

      if (fallbackRes.handled && fallbackRes.result) {
        if (!skipPersist) {
          await persistResult(fallbackRes.result, leadData);
        }
        return fallbackRes.result;
      }
    }

    // Post-fill checkbox sweep: check terms/privacy/required checkboxes so conditionally-enabled
    // submit buttons unlock and unmapped required fields audit does not falsely flag them.
    const postFillCheckboxes = await sweepAndCheckPreSubmitCheckboxes(activePage, fillResult.primaryForm);
    if (postFillCheckboxes.length > 0) {
      filledFields.push(...postFillCheckboxes);
      if (fillMetrics) {
        fillMetrics.unmappedRequiredFields = fillMetrics.unmappedRequiredFields.filter((f) => {
          const lowerF = f.toLowerCase();
          return !postFillCheckboxes.some((cb) => {
            const lowerCb = cb.toLowerCase();
            return lowerCb.includes(lowerF) || lowerF.includes(lowerCb.replace("presubmitcheckbox:", ""));
          }) && !/consent|term|privacy|policy|gdpr|accept|disclaimer|legal|condition/i.test(f);
        });
      }
    }

    // Ensure any late-mounting cookie banners or popups are dismissed before pre-submission validation
    await dismissCookieBanners(activePage).catch(() => undefined);

    screenshotPath = await takeScreenshot(page, websiteUrl, "before-submit");

    // Pre-Submission Comprehensive Validation:
    // Verify that all applicable required fields (name, email, phone, company, message, address, dropdowns, radios, checkboxes)
    // are completed and valid before proceeding with submission.
    if (shouldSubmit) {
      const preSubmitValidation = await validateFormBeforeSubmission(activePage, fillResult.primaryForm, effectiveLeadData);
      if (!preSubmitValidation.valid) {
        screenshotPath = await takeScreenshot(page, websiteUrl, "before-submit-validation-failure").catch(() => screenshotPath);
        throw new Error(`VALIDATION_BEFORE_SUBMISSION_FAILED: ${preSubmitValidation.failureReason}`);
      }
    }

    if (fillMetrics && fillMetrics.unmappedRequiredFields.length > 0) {

      const unmappedSummary = fillMetrics.unmappedRequiredFields.join(", ");
      const detailedLog = (fillMetrics.unmappedRequiredDetails || []).map((d) => 
        `[name="${d.fieldName}", label="${d.fieldLabel}", type="${d.fieldType}"${d.availableOptions ? `, options=[${d.availableOptions.join(",")}]` : ""}, reason="${d.reason}"]`
      ).join("; ");

      console.warn(`[contact-form-automation] Unmapped required fields on ${websiteUrl}: ${unmappedSummary} Details: ${detailedLog}`);
      if (fillMetrics.unmappedRequiredFields.some((f) => /captcha|turnstile|recaptcha|challenge/i.test(f))) {
        if (canSolveCaptcha) {
          const solveRes = await handleCaptchaSolvingForTarget({
            page,
            websiteUrl,
            userId,
            timeoutMs: Math.max(timeoutMs, 90000)
          });
          if (!solveRes.solved) {
            throw new Error(`CAPTCHA solving failed: ${solveRes.errorMessage || solveRes.reason}`);
          }
        } else {
          throw new Error(`Unsupported verification: CAPTCHA required field detected (${unmappedSummary}). Manual verification required.`);
        }
      } else {
        throw new Error(`UNRESOLVED_REQUIRED_FIELD: Missing required field(s): ${unmappedSummary}${detailedLog ? ` | ${detailedLog}` : ""}`);
      }
    }

    // Dismiss any newly popped cookie consent banners
    await dismissCookieBanners(activePage).catch(() => undefined);

    // Check once more after form fill for late bot challenges (only blocking screens)
    const postFillVerification = await detectUnsupportedVerification(page, websiteUrl);
    if (postFillVerification && postFillVerification.blocking === true) {
      if (canSolveCaptcha) {
        const solveRes = await handleCaptchaSolvingForTarget({
          page,
          websiteUrl,
          userId,
          timeoutMs: Math.max(timeoutMs, 90000)
        });
        if (!solveRes.solved) {
          if (postFillVerification.screenshotPath) screenshotPath = postFillVerification.screenshotPath;
          throw new Error(solveRes.errorMessage || postFillVerification.reason);
        }
      } else {
        if (postFillVerification.screenshotPath) screenshotPath = postFillVerification.screenshotPath;
        throw new Error(postFillVerification.reason);
      }
    }

    const tSubmitStart = Date.now();
    const submitResult = await findSubmitButtonWithDiagnostics(page, leadData, fillResult.primaryForm);
    let submitButton = submitResult.locator;
    submitDiag = submitResult.diagnostics;

    // Bounded hydration polling window (up to 1.6s) for asynchronously mounted/enabled submit buttons
    if (!submitButton) {
      for (let poll = 0; poll < 4; poll++) {
        await page.waitForTimeout(400);
        const retry = await findSubmitButtonWithDiagnostics(page, leadData, fillResult.primaryForm);
        if (retry.locator) {
          submitButton = retry.locator;
          submitDiag = retry.diagnostics;
          break;
        }
      }
    }
    tSubmitDiscovery = Date.now() - tSubmitStart;

    if (!submitButton || filledFields.length === 0) {
      const bookingWidget = await detectBookingWidget(page, filledFields.length);

      if (bookingWidget.found) {
        const result = await submitBookingWidget({
          page,
          websiteUrl,
          submittedAt,
          filledFields,
          skippedFields,
          reason: bookingWidget.reason ?? "booking widget detected"
        });

        if (!skipPersist) {
          await persistResult(result, leadData);
        }
        return result;
      }

      // Reusable Action Button Fallback:
      // If no form or booking widget was completed on the current page,
      // search for action buttons ("Book Now", "Book a Call", "Schedule a Meeting", "Contact Us", "Get a Quote", etc.)
      // that open forms, new tabs (Calendly), modals, or navigated pages before marking as failed!
      if (!skipActionButtons) {
        console.log(`[contact-form-automation] No contact form completed on ${websiteUrl}. Invoking Action Button Fallback...`);
        const { executeActionButtonFallback } = await import("./action-button-fallback");
        const fallbackRes = await executeActionButtonFallback({
          page,
          websiteUrl,
          leadData: effectiveLeadData,
          submit,
          liveSubmit,
          timeoutMs,
          browserContext: browserContext ?? page.context(),
          skipPersist,
          userId
        });

        if (fallbackRes.handled && fallbackRes.result) {
          if (!skipPersist) {
            await persistResult(fallbackRes.result, leadData);
          }
          return fallbackRes.result;
        }
      }

      if (!submitButton) {
        throw new Error("No visible submit button found.");
      }
    }

    let networkReportedSuccess = false;
    let serverReportedSpamOrBlock: string | null = null;
    const ajaxResponseListener = (res: any) => {
      try {
        const url = res.url().toLowerCase();
        const status = res.status();
        const req = res.request();
        const method = (req.method() || "").toUpperCase();

        const isTracker = /google-analytics|googletagmanager|doubleclick|facebook|clarity|hotjar|datadog|sentry|segment|criteo/i.test(url);
        if (isTracker) return;

        // Check if this is an API / form endpoint or any POST / PUT method triggered after submit
        const isFormEndpoint = (
          method === "POST" ||
          method === "PUT" ||
          method === "PATCH" ||
          url.includes("wp-json") ||
          url.includes("admin-ajax") ||
          url.includes("feedback") ||
          url.includes("contact") ||
          url.includes("submit") ||
          url.includes("forms") ||
          url.includes("hsforms") ||
          url.includes("formspree") ||
          url.includes("web3forms") ||
          url.includes("getform") ||
          url.includes("elementor") ||
          url.includes("ninja") ||
          url.includes("fluent") ||
          url.includes("forminator") ||
          url.includes("caldera") ||
          url.includes("leadconnector") ||
          url.includes("/api/") ||
          url.includes("sendmail") ||
          url.includes("webflow.com")
        );

        if (status >= 200 && status < 400 && isFormEndpoint) {
          // HTTP 204 No Content is inherently successful
          if (status === 204) {
            networkReportedSuccess = true;
            return;
          }

          res.text().then((text: string) => {
            if (!text) {
              if (method === "POST" || method === "PUT") {
                networkReportedSuccess = true;
              }
              return;
            }

            if (text.includes("apbct") && (text.includes('"blocked":true') || text.includes("Forbidden") || text.includes("blacklisted"))) {
              serverReportedSpamOrBlock = "Server Anti-Spam (CleanTalk) blocked submission: Sender IP or email blacklisted.";
            } else if (text.includes('"status":"spam"')) {
              serverReportedSpamOrBlock = "Server spam filter (Akismet / WPCF7) classified submission as spam.";
            } else if (text.includes('"status":"mail_failed"') || text.includes('"mail_sent_ng"')) {
              serverReportedSpamOrBlock = "Server mail delivery failed (SMTP connection error on target host).";
            }

            const hasErrorFlag = (
              text.includes('"status":"spam"') ||
              text.includes('"status":"validation_failed"') ||
              text.includes('"status":"error"') ||
              text.includes('"success":false') ||
              text.includes('"blocked":true') ||
              text.includes('"error":true')
            );

            if (!hasErrorFlag) {
              if (
                text.includes('"status":"mail_sent"') ||
                text.includes('"success":true') ||
                text.includes('"status":"success"') ||
                text.includes('"result":"success"') ||
                text.includes('"sent":true') ||
                text.includes('"code":"ok"') ||
                text.includes('"ok":true') ||
                /thank|received|mail_sent|success|submitted/i.test(text) ||
                ((method === "POST" || method === "PUT") && status === 200)
              ) {
                networkReportedSuccess = true;
              }
            }
          }).catch(() => {});
        }
      } catch {}
    };

    if (shouldSubmit) {
      await onProgress?.("submit_form", "Submitting contact form...");
      // Dismiss any open dropdown menus, hover overlays, mega-menus or popups
      await activePage.keyboard.press("Escape").catch(() => undefined);
      await activePage.mouse.move(0, 0).catch(() => undefined);
      await dismissCookieBanners(activePage).catch(() => undefined);
      await submitButton.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);

      // Anti-speed-trap & human velocity pacing:
      // WordPress anti-spam plugins (WP-Armour, Akismet, CF7 Honeypot) measure the timestamp
      // delta between page render and submission. A submission in < 4.5s is instantly flagged as bot.
      const elapsedSinceFill = Date.now() - tFillStart;
      if (elapsedSinceFill < 4500) {
        const neededDelay = 4500 - elapsedSinceFill + Math.floor(Math.random() * 1200);
        await activePage.waitForTimeout(neededDelay);
      }

      // Natural curved mouse movement & hover hesitation for anti-bot / reCAPTCHA v3 confidence
      try {
        const box = await submitButton.boundingBox();
        if (box) {
          const targetX = box.x + box.width / 2 + (Math.random() * 8 - 4);
          const targetY = box.y + box.height / 2 + (Math.random() * 6 - 3);
          // Waypoint curve
          await activePage.mouse.move(targetX - 35, targetY - 25, { steps: 8 }).catch(() => undefined);
          await activePage.waitForTimeout(100 + Math.floor(Math.random() * 150));
          await activePage.mouse.move(targetX, targetY, { steps: 6 }).catch(() => undefined);
          // Human hover hesitation before clicking
          await activePage.waitForTimeout(300 + Math.floor(Math.random() * 250));
        }
      } catch {}

      activePage.on("response", ajaxResponseListener);

      let networkActivityFired = false;
      const activityTracker = () => { networkActivityFired = true; };
      activePage.on("request", activityTracker);

      // Pre-Submit Checkbox, Button Group & Cookie Sweep: sweep immediately prior to click to ensure any dynamically mounted
      // policy, terms, consent or required checkboxes are checked, button options selected, and late cookie banners dismissed.
      await dismissCookieBanners(activePage).catch(() => undefined);
      await activePage.keyboard.press("Escape").catch(() => undefined);
      await selectFirstOptionInButtonGroups(fillResult.primaryForm || activePage).catch(() => undefined);
      const preSubmitCheckboxes = await sweepAndCheckPreSubmitCheckboxes(activePage, fillResult.primaryForm, submitButton);
      if (preSubmitCheckboxes.length > 0) {
        filledFields.push(...preSubmitCheckboxes);
      }

      // Capture submitted form ID to strictly scope post-submission constraint checks
      submittedFormId = await submitButton.evaluate((btn) => {
        const form = btn.closest("form");
        if (!form) return null;
        if (!form.id) {
          form.id = "sdi_form_" + Math.random().toString(36).slice(2, 9);
        }
        return form.id;
      }).catch(() => null);

      // Primary click execution
      let clickSucceeded = false;
      try {
        await submitButton.click({ timeout: 4000 });
        clickSucceeded = true;
      } catch {
        // If click was intercepted by a newly appeared cookie banner, mega-menu, or overlay, dismiss it and retry with force
        await dismissCookieBanners(activePage).catch(() => undefined);
        await activePage.keyboard.press("Escape").catch(() => undefined);
        try {
          await submitButton.click({ timeout: 2000, force: true });
          clickSucceeded = true;
        } catch {
          clickSucceeded = false;
        }
      }

      // Phase 2: HTML5 :invalid Self-Healing Recovery
      // If browser native validation blocked submission due to an unchecked required checkbox,
      // it applies the :invalid pseudo-class. Catch and auto-check it, then retry click.
      const hasInvalidCheckboxes = await submitButton.evaluate((btn) => {
        const form = btn.closest("form") || document.body;
        const invalids = Array.from(form.querySelectorAll("input[type='checkbox']:invalid, [role='checkbox'][aria-invalid='true']"));
        if (invalids.length === 0) return false;

        for (const el of invalids) {
          if (el.tagName.toLowerCase() === "input") {
            const input = el as HTMLInputElement;
            input.checked = true;
            const tracker = (input as any)._valueTracker;
            if (tracker) tracker.setValue(false);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            if ((window as any).jQuery) {
              try { (window as any).jQuery(input).trigger("change"); } catch {}
            }
          } else {
            el.setAttribute("aria-checked", "true");
            el.setAttribute("aria-invalid", "false");
            el.dispatchEvent(new Event("click", { bubbles: true }));
          }
        }
        return true;
      }).catch(() => false);

      if (hasInvalidCheckboxes) {
        console.log(`[contact-form-automation] [PRE-SUBMIT-CHECKBOX] Recovered unclicked required checkbox via :invalid detection. Retrying submit click...`);
        await activePage.waitForTimeout(300);
        await submitButton.click({ timeout: 4000, force: true }).catch(() => undefined);
      }

      let fallbackDispatched = false;
      await activePage.waitForTimeout(1500);
      if (!networkActivityFired || !clickSucceeded) {
        fallbackDispatched = await submitButton.evaluate((btn) => {
          let dispatched = false;
          const form = btn.closest("form");
          if (form) {
            if ((window as any).jQuery) {
              try { (window as any).jQuery(form).trigger("submit"); dispatched = true; } catch {}
            }
            if (typeof form.requestSubmit === "function") {
              try { form.requestSubmit(btn as HTMLButtonElement | HTMLInputElement); dispatched = true; } catch {}
            } else if (typeof form.submit === "function") {
              try { form.submit(); dispatched = true; } catch {}
            }
          }
          if ("click" in btn && typeof (btn as HTMLElement).click === "function") {
            try { (btn as HTMLElement).click(); dispatched = true; } catch {}
          }
          return dispatched;
        }).catch(() => false);
      }

      if (!clickSucceeded && !fallbackDispatched) {
        throw new Error("Submit button could not be clicked and form dispatch action failed.");
      }

      activePage.off("request", activityTracker);
    }

    const explicitSuccess = shouldSubmit
      ? (networkReportedSuccess || await detectSuccess(page, () => networkReportedSuccess))
      : true;

    if (shouldSubmit) {
      activePage.off("response", ajaxResponseListener);
    }
    await onProgress?.("take_screenshot", "Capturing proof screenshot...");
    screenshotPath = await takeScreenshot(page, websiteUrl, shouldSubmit ? "after-submit" : "dry-run");
    if (screenshotPath) {
      await onProgress?.("take_screenshot", "Proof screenshot captured", screenshotPath);
    }

    if (shouldSubmit) {
      // 1. Check for server-level spam, mail delivery errors, or access blocks
      if (serverReportedSpamOrBlock) {
        throw new Error(serverReportedSpamOrBlock);
      }

      // 2. Check for newly appeared post-submit CAPTCHA or anti-bot challenge
      const postSubmitVerification = await detectUnsupportedVerification(page, websiteUrl);
      if (postSubmitVerification && postSubmitVerification.blocking === true) {
        if (postSubmitVerification.screenshotPath) screenshotPath = postSubmitVerification.screenshotPath;
        throw new Error(`Anti-bot verification challenge blocked submission: ${postSubmitVerification.reason}`);
      }

      // 3. Check for visible on-page validation errors, spam flags, or submission failure banners
      const onPageError = await activePage.evaluate((args: { formId: string | null; explicitSuccess: boolean }) => {
        const errorSelectors = [
          ".wpcf7-response-output.wpcf7-spam-blocked",
          ".wpcf7-response-output.wpcf7-mail-sent-ng",
          ".wpcf7-response-output.wpcf7-validation-errors",
          ".wpforms-error-container",
          ".wpforms-error",
          ".gform_validation_errors",
          ".gfield_error",
          ".elementor-message-danger",
          ".elementor-message-error",
          ".w-form-fail",
          ".form-submission-error",
          ".alert-danger",
          ".alert-error",
          ".error-message",
          ".form-error",
          ".field-error",
          ".invalid-feedback",
          ".has-error",
          "[aria-invalid='true']:not([type='hidden'])",
          "[role='alert']"
        ];
        for (const sel of errorSelectors) {
          const els = Array.from(document.querySelectorAll(sel));
          for (const el of els) {
            const htmlEl = el as HTMLElement;
            if (htmlEl && (htmlEl.offsetParent !== null || window.getComputedStyle(htmlEl).display !== "none")) {
              const txt = (htmlEl.textContent || "").trim();
              if (
                txt &&
                (
                  txt.toLowerCase().includes("spam") ||
                  txt.toLowerCase().includes("error") ||
                  txt.toLowerCase().includes("failed") ||
                  txt.toLowerCase().includes("invalid") ||
                  txt.toLowerCase().includes("required") ||
                  txt.toLowerCase().includes("could not be sent") ||
                  txt.toLowerCase().includes("try again") ||
                  txt.toLowerCase().includes("robot") ||
                  txt.toLowerCase().includes("captcha")
                )
              ) {
                // Ensure it's not a success message that happens to use role='alert'
                if (!/thank|success|received|sent|confirmed|we will be in touch/i.test(txt)) {
                  return txt;
                }
              }
            }
          }
        }

        // Check HTML5 constraint validation strictly on the submitted form if available, or non-search inputs
        // If explicit success has ALREADY been confirmed by the server/network response, SKIP HTML5 :invalid checks!
        // Successful AJAX submissions frequently call form.reset() or document.getElementById(formId).reset(),
        // which clears inputs and causes HTML5 'required' constraints to report :invalid even though the submission succeeded.
        if (args.explicitSuccess) return null;

        const targetScope = args.formId ? document.getElementById(args.formId) : null;
        const invalidInputs = targetScope
          ? Array.from(targetScope.querySelectorAll("input:invalid:not([type='hidden']), textarea:invalid, select:invalid"))
          : Array.from(document.querySelectorAll("input:invalid:not([type='hidden']), textarea:invalid, select:invalid")).filter((el) => {
              const name = (el.getAttribute("name") || "").toLowerCase();
              const type = (el.getAttribute("type") || "").toLowerCase();
              const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
              // Ignore search inputs (e.g. name="s", name="q", type="search") and inputs in header/nav
              if (name === "s" || name === "q" || type === "search" || placeholder.includes("search") || el.closest("header, nav, [role='search']")) {
                return false;
              }
              // If there are multiple forms and this input belongs to another separate form, don't flag global document
              if (el.closest("form")) return false;
              return true;
            });

        for (const inp of invalidInputs) {
          const inputEl = inp as HTMLInputElement;
          if (inputEl.offsetParent !== null || window.getComputedStyle(inputEl).display !== "none") {
            const validationMsg = inputEl.validationMessage || "Required field is missing or invalid";
            const fieldDesc = inputEl.name || inputEl.id || inputEl.placeholder || "field";
            return `Validation failed on "${fieldDesc}": ${validationMsg}`;
          }
        }

        return null;
      }, { formId: submittedFormId, explicitSuccess }).catch(() => null);

      if (onPageError) {
        throw new Error(`Website rejected submission: "${onPageError.slice(0, 150)}"`);
      }

      if (explicitSuccess) {
        console.log(`[contact-form-automation] Submission on ${websiteUrl} verified via explicit confirmation.`);
      } else {
        // Success message is NOT mandatory. If the submission action completed normally and no failure indicators were detected, mark as PASS/SUCCESS.
        console.log(`[contact-form-automation] Submit clicked successfully on ${websiteUrl} without errors or anti-bot challenges. Classified as PASS/SUCCESS (success message not mandatory).`);
      }
    }

    const totalMs = Date.now() - tStart;
    const stageTiming: StageTimingMetrics = {
      navigationMs: tNav,
      readinessMs: tReadiness,
      fieldFillingMs: tFieldFilling,
      submitDiscoveryMs: tSubmitDiscovery,
      totalMs
    };

    const finalFieldsDetected = fillMetrics?.fieldsDetected ?? (filledFields.length > 0 ? filledFields.length : 0);
    const finalFieldsClassified = fillMetrics?.fieldsClassified ?? (filledFields.length > 0 ? filledFields.length : 0);
    const finalFieldsFilled = fillMetrics?.filledFieldsCount ?? filledFields.length;
    const finalFieldsVerified = fillMetrics?.verifiedFieldsCount ?? filledFields.length;
    const finalUnmappedRequired = fillMetrics?.unmappedRequiredFields ?? [];

    const invariantCheck = evaluateFinalAutomationSuccess({
      targetType: "contact_form",
      status: shouldSubmit ? "success" : "dry_run_ready_to_book",
      fieldsDetected: finalFieldsDetected,
      fieldsClassified: finalFieldsClassified,
      fieldsFilled: finalFieldsFilled,
      fieldsVerified: finalFieldsVerified,
      unmappedRequiredFields: finalUnmappedRequired,
      submitControlFound: Boolean(submitButton),
      submitControlScore: submitDiag?.selectedScore ?? 0,
      errorMessage: null,
      discoveryReason: null
    });

    if (!invariantCheck.isSuccess) {
      throw new Error(`INVARIANT_GATE_REJECTED: [${invariantCheck.taxonomyCategory}] ${invariantCheck.failureReason}`);
    }

    const isVerified = Boolean(explicitSuccess);
    const result: SubmitContactFormResult = {
      websiteUrl,
      status: shouldSubmit ? "success" : "dry_run_ready_to_book",
      submissionOutcome: shouldSubmit
        ? (isVerified ? "VERIFIED_SUCCESS" : "PASS")
        : "PASS",
      errorMessage: null,
      message: shouldSubmit
        ? (isVerified
            ? "Contact form submitted successfully with verified confirmation."
            : "Contact form submitted successfully (action completed without error).")
        : "Dry run: Form fields filled and submit button verified.",
      screenshotPath,
      submittedAt,
      filledFields,
      skippedFields,
      bookingWidgetReason: null,
      fieldsDetectedCount: finalFieldsDetected,
      fieldsClassifiedCount: finalFieldsClassified,
      filledFieldsCount: finalFieldsFilled,
      verifiedFieldsCount: finalFieldsVerified,
      unmappedRequiredFields: finalUnmappedRequired,
      unmappedOptionalFields: fillMetrics?.unmappedOptionalFields ?? [],
      fieldVerificationItems: fillMetrics?.items ?? [],
      stageTiming,
      submitCandidateCount: submitDiag?.submitCandidateCount,
      rejectedCandidateCount: submitDiag?.rejectedCandidateCount,
      selectedCandidateInfo: submitDiag?.selectedCandidate
    };

    if (!skipPersist) {
      await persistResult(result, leadData);
    }
    return result;
  } catch (error) {
    const isProxyErr = isProxyAuthenticationFailure(error);
    const rawErrorMessage = isProxyErr
      ? PROXY_407_MESSAGE
      : error instanceof Error
        ? error.message
        : "Unknown automation error.";
    const errorMessage = redactProxyDetails(rawErrorMessage);

    if (page && !screenshotPath) {
      screenshotPath = await takeScreenshot(page, websiteUrl, isProxyErr ? "proxy-407-failure" : "failure").catch(
        () => screenshotPath
      );
    }
    if (screenshotPath) {
      await onProgress?.("take_screenshot", "Captured failure screenshot", screenshotPath);
    }

    const totalMs = Date.now() - tStart;
    const stageTiming: StageTimingMetrics = {
      navigationMs: tNav,
      readinessMs: tReadiness,
      fieldFillingMs: tFieldFilling,
      submitDiscoveryMs: tSubmitDiscovery,
      totalMs
    };

    const result: SubmitContactFormResult = {
      websiteUrl,
      status: "failed",
      submissionOutcome: "FAILED",
      errorMessage,
      screenshotPath,
      submittedAt,
      filledFields,
      skippedFields,
      bookingWidgetReason: null,
      fieldsDetectedCount: fillMetrics?.fieldsDetected ?? 0,
      fieldsClassifiedCount: fillMetrics?.fieldsClassified ?? 0,
      filledFieldsCount: fillMetrics?.filledFieldsCount ?? filledFields.length,
      verifiedFieldsCount: fillMetrics?.verifiedFieldsCount ?? 0,
      unmappedRequiredFields: fillMetrics?.unmappedRequiredFields ?? [],
      unmappedOptionalFields: fillMetrics?.unmappedOptionalFields ?? [],
      fieldVerificationItems: fillMetrics?.items ?? [],
      stageTiming,
      submitCandidateCount: submitDiag?.submitCandidateCount,
      rejectedCandidateCount: submitDiag?.rejectedCandidateCount,
      selectedCandidateInfo: submitDiag?.selectedCandidate
    };

    if (!skipPersist) {
      await persistResult(result, leadData).catch(() => undefined);
    }
    return result;
  } finally {
    cookieGuardian?.stop();
    if (!customPage) {
      if (page && browserContext) {
        await page.close().catch(() => undefined);
      } else {
        await browser?.close().catch(() => undefined);
      }
    }
  }
}
