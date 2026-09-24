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
import { dismissCookieBanners } from "./cookie-consent-helper";
import { waitForUniversalPageReadiness } from "./page-readiness";
import { evaluateFinalAutomationSuccess } from "./success-invariants";
import {
  type FieldSignals,
  type SemanticFieldType,
  type FieldClassification,
  type FieldVerificationItem,
  type FormFillMetrics,
  extractFieldSignals,
  classifyField,
  classifyAllFormFields,
  splitFullName,
  COMMON_INPUT_SELECTOR
} from "./field-classifier";

type FieldKey = "fullName" | "email" | "mobile" | "city" | "address" | "message" | "companyName" | "website" | "jobTitle";

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
const REQUIRED_TEXT_FALLBACK = "Seo management";
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
  mobile: ["phone", "mobile", "telephone", "tel", "cell", "contact number", "phone number", "mobile number", "cell phone", "work phone", "phonenumber"],
  city: ["city", "town", "municipality"],
  address: ["address", "street", "state", "zip", "postal"],
  message: ["message", "comment", "comments", "details", "description", "note", "enquiry", "inquiry", "how can we help", "project details", "brief", "tell us about"],
  companyName: ["company", "business", "organization", "organisation", "brand", "company name", "business name", "firm"],
  website: ["website", "web site", "url", "domain", "company website", "site url", "web page", "web address"],
  jobTitle: ["job title", "title", "role", "position", "occupation"]
};

const FIELD_VALUES: Record<FieldKey, (leadData: LeadData) => string | undefined> = {
  fullName: (leadData) => leadData.fullName,
  email: (leadData) => leadData.email,
  mobile: (leadData) => leadData.mobile ?? leadData.mobileNumber,
  city: () => "New York",
  address: (leadData) => leadData.address,
  message: (leadData) => leadData.message,
  companyName: (leadData) => leadData.companyName,
  website: (leadData) => {
    const raw = leadData.companyName?.toLowerCase().replace(/[^a-z0-9]/g, "") || "example";
    return `https://${raw}.com`;
  },
  jobTitle: () => "Business Owner"
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

    // Abort heavy media, video streams, fonts, and third-party trackers
    const isHeavyMedia = ["media", "font"].includes(resourceType) ||
      /\.(mp4|webm|avi|mov|mkv|ogg|wmv|flv|m4v)(\?.*)?$/i.test(url);

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
  if (!(await locator.isVisible().catch(() => false))) return { success: false, verified: false };
  if (!(await locator.isEnabled().catch(() => false))) return { success: false, verified: false };

  const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "input");
  const inputType = await locator.evaluate((element) => (element.getAttribute("type") || "").toLowerCase()).catch(() => "text");
  if (inputType === "checkbox") {
    await locator.check({ force: true }).catch(async () => {
      await locator.click({ force: true }).catch(() => undefined);
    });
    const checked = await locator.isChecked().catch(() => true);
    return { success: true, verified: checked, actualValue: "checked" };
  }

  if (inputType === "radio") {
    await locator.check({ force: true }).catch(async () => {
      await locator.click({ force: true }).catch(() => undefined);
    });
    return { success: true, verified: true, actualValue: "selected" };
  }

  if (tagName === "select") {
    let selected = false;
    await locator.selectOption({ label: value }).then(() => { selected = true; }).catch(async () => {
      await locator.selectOption({ value }).then(() => { selected = true; }).catch(() => undefined);
    });
    const selectVal = await locator.inputValue().catch(() => "");
    return { success: true, verified: Boolean(selectVal) || selected, actualValue: selectVal };
  }

  await locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => undefined);
  await locator.click({ timeout: 2000 }).catch(() => undefined);
  await locator.fill("", { timeout: 2000 }).catch(() => undefined);

  if (value.length > 80 || tagName === "textarea") {
    await locator.fill(value, { timeout: 4000 }).catch(async () => {
      await locator.pressSequentially(value.slice(0, 120), { delay: 10, timeout: 3000 }).catch(() => undefined);
    });
  } else {
    await locator.pressSequentially(value, { delay: 15, timeout: 4000 }).catch(async () => {
      await locator.fill(value, { timeout: 2000 }).catch(() => undefined);
    });
  }

  // Verify DOM value and perform controlled-input synchronization if needed (React, Vue, Webflow, etc.)
  let currentValue = await locator.inputValue().catch(() => "");
  if (!currentValue && value) {
    await locator.evaluate((el, val) => {
      const input = el as HTMLInputElement;
      const nativeInputSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      if (input.tagName.toLowerCase() === "textarea" && nativeTextareaSetter) {
        nativeTextareaSetter.call(input, val);
      } else if (nativeInputSetter) {
        nativeInputSetter.call(input, val);
      } else {
        input.value = val;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));
    }, value).catch(() => undefined);
    currentValue = await locator.inputValue().catch(() => "");
  }

  const verified = Boolean(
    currentValue &&
    (currentValue.toLowerCase().includes(value.slice(0, 8).toLowerCase()) ||
     value.toLowerCase().includes(currentValue.slice(0, 8).toLowerCase()))
  );

  return { success: true, verified, actualValue: currentValue };
}

async function safelyFillCityField(locator: Locator): Promise<{ success: boolean; verified: boolean }> {
  if (!(await locator.isVisible().catch(() => false))) return { success: false, verified: false };
  if (!(await locator.isEnabled().catch(() => false))) return { success: false, verified: false };

  const tagName = await locator.evaluate((element) => element.tagName.toLowerCase());
  if (tagName !== "select") return safelyFillField(locator, "New York");

  const matchingOptionIndex = await locator.evaluate((element) => {
    const select = element as HTMLSelectElement;
    return Array.from(select.options).findIndex((option) => {
      const label = (option.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      const value = option.value.trim().toLowerCase();
      return label === "new york" || label === "new york city" || value === "new york" || value === "ny";
    });
  }).catch(() => -1);

  if (matchingOptionIndex < 0) return { success: false, verified: false };
  await locator.selectOption({ index: matchingOptionIndex }).catch(() => undefined);
  return { success: true, verified: true };
}

async function selectFirstRealOption(locator: Locator) {
  const result = await locator
    .evaluate((element) => {
      const select = element as HTMLSelectElement;
      if (!select || select.tagName.toLowerCase() !== "select") return false;
      const placeholderPattern = /^(select|choose|please\s+(select|choose)|which|pick\s+an?|--|none\b)/i;
      const isRealOption = (option: HTMLOptionElement) => {
        const label = (option.textContent ?? "").replace(/\s+/g, " ").trim();
        return !option.disabled && Boolean(option.value.trim()) && !placeholderPattern.test(label);
      };

      const selected = select.options[select.selectedIndex];
      if (selected && isRealOption(selected)) return true;

      const idx = Array.from(select.options).findIndex(isRealOption);
      if (idx >= 0) {
        select.selectedIndex = idx;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        select.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
      return false;
    })
    .catch(() => false);

  if (result) return true;

  try {
    const isVis = await locator.isVisible().catch(() => false);
    if (isVis) {
      await locator.selectOption({ index: 1 }, { timeout: 1500 });
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

async function selectRequiredRadioDefaults(scope: FormScope) {
  const radios = scope.locator("input[type='radio']");
  const count = await radios.count().catch(() => 0);
  const groups = new Map<string, Locator>();

  for (let index = 0; index < count; index++) {
    const radio = radios.nth(index);
    if (!(await radio.isVisible().catch(() => false)) || !(await radio.isEnabled().catch(() => false))) continue;
    const metadata = await radio.evaluate((element) => ({
      name: (element as HTMLInputElement).name,
      required: (element as HTMLInputElement).required || element.getAttribute("aria-required") === "true"
    })).catch(() => ({ name: "", required: false }));
    if (metadata.required && metadata.name && !groups.has(metadata.name)) groups.set(metadata.name, radio);
  }

  const filled: string[] = [];
  for (const [name, radio] of groups) {
    if (await radio.isChecked().catch(() => false)) continue;
    if (await radio.check({ force: true }).then(() => true).catch(() => false)) filled.push(`radio:${name}`);
  }
  return filled;
}

async function fillRemainingRequiredTextFields(
  fields: Locator,
  candidates: FieldCandidate[],
  usedIndexes: Set<number>
) {
  const filled: string[] = [];

  for (const candidate of candidates) {
    if (usedIndexes.has(candidate.index)) continue;
    if (candidate.tagName !== "textarea" && candidate.tagName !== "input") continue;

    // A person's name must always come from the lead name mapping below,
    // never from the generic service-description fallback.
    if (NAME_FIELD_PATTERN.test(candidate.descriptor)) continue;

    // Do not put generic text into structured controls. Known fields are
    // handled above, while browser validation rejects this value for these
    // input types.
    if (["email", "tel", "number", "date", "time", "url", "file", "password"].includes(candidate.type)) continue;

    const field = fields.nth(candidate.index);
    const isRequired = await field
      .evaluate((element) => {
        const control = element as HTMLInputElement | HTMLTextAreaElement;
        return control.required || control.getAttribute("aria-required") === "true";
      })
      .catch(() => false);
    if (!isRequired) continue;

    const existingValue = await field.inputValue().catch(() => "");
    if (existingValue.trim()) {
      usedIndexes.add(candidate.index);
      continue;
    }

    const didFill = await safelyFillField(field, REQUIRED_TEXT_FALLBACK).catch(() => false);
    if (didFill) {
      usedIndexes.add(candidate.index);
      filled.push(`required:${candidate.index}`);
    }
  }

  return filled;
}

async function selectCustomDropdownDefaults(scope: FormScope) {
  const dropdowns = scope.locator([
    "[role='combobox']:not(select)",
    "[aria-haspopup='listbox']:not(select)",
    "[aria-haspopup='menu'][role='button']"
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

      const options = dropdown.page().locator([
        "[role='listbox']:visible [role='option']:visible",
        "[role='menu']:visible [role='menuitem']:visible",
        "[role='option']:visible"
      ].join(", "));
      const optionCount = await options.count().catch(() => 0);
      let selected = false;

      for (let optionIndex = 0; optionIndex < optionCount; optionIndex++) {
        const option = options.nth(optionIndex);
        const optionState = await option.evaluate((element) => ({
          text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
          disabled:
            element.getAttribute("aria-disabled") === "true" ||
            (element as HTMLButtonElement).disabled === true
        })).catch(() => ({ text: "", disabled: true }));
        const isPlaceholder = /^(select|choose|please\s+(select|choose)|which|pick\s+an?|--|none\b)/i.test(optionState.text);
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

async function fillDetectedFields(scope: FormScope, leadData: LeadData): Promise<{
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
    evidence: string[]
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
        mappedSource: sourceKey,
        confidence,
        evidence,
        filled: true,
        verified: result.verified,
        finalValue: result.actualValue
      });
      return true;
    }
    return false;
  };

  // 1. Email (prioritize type=email / autocomplete=email / highest confidence)
  const emailCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "email")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (emailCandidates.length > 0) {
    const best = emailCandidates[0];
    await fillSignal(best.signal, "email", "email", leadData.email, best.cls.confidence, best.cls.evidence);
  } else {
    skippedFields.push("email");
  }

  // 2. Name Handling (Split name vs full name)
  const nameParts = splitFullName(leadData.fullName);
  const firstNameCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "first_name")
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

  if (firstNameCandidates.length > 0) {
    const bestFirst = firstNameCandidates[0];
    await fillSignal(bestFirst.signal, "first_name", "firstName", nameParts.firstName, bestFirst.cls.confidence, bestFirst.cls.evidence);
  }

  if (lastNameCandidates.length > 0) {
    const bestLast = lastNameCandidates[0];
    await fillSignal(bestLast.signal, "last_name", "lastName", nameParts.lastName, bestLast.cls.confidence, bestLast.cls.evidence);
  }

  // If first and last name were NOT both present/filled, and a full_name candidate exists:
  if (!filledFields.includes("firstName") && !filledFields.includes("lastName")) {
    if (fullNameCandidates.length > 0) {
      const bestFull = fullNameCandidates[0];
      await fillSignal(bestFull.signal, "full_name", "fullName", leadData.fullName, bestFull.cls.confidence, bestFull.cls.evidence);
    } else {
      skippedFields.push("fullName");
    }
  }

  // 3. Phone / Mobile
  const phoneValue = leadData.mobile ?? leadData.mobileNumber;
  if (phoneValue) {
    const phoneCandidates = signals
      .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
      .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
      .filter((item) => !item.cls.isNegative && item.cls.fieldType === "phone")
      .sort((a, b) => b.cls.confidence - a.cls.confidence);

    if (phoneCandidates.length > 0) {
      const best = phoneCandidates[0];
      await fillSignal(best.signal, "phone", "mobile", phoneValue, best.cls.confidence, best.cls.evidence);
    } else {
      skippedFields.push("mobile");
    }
  }

  // 4. Message / Inquiry
  const messageCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && (item.cls.fieldType === "message" || item.cls.fieldType === "inquiry"))
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  const messageValue = leadData.message || "Hello, I would like to inquire about your services. Thank you.";
  if (messageCandidates.length > 0) {
    const best = messageCandidates[0];
    await fillSignal(best.signal, "message", "message", messageValue, best.cls.confidence, best.cls.evidence);
  } else {
    skippedFields.push("message");
  }

  // 5. Company Name
  if (leadData.companyName) {
    const companyCandidates = signals
      .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
      .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
      .filter((item) => !item.cls.isNegative && item.cls.fieldType === "company")
      .sort((a, b) => b.cls.confidence - a.cls.confidence);

    if (companyCandidates.length > 0) {
      const best = companyCandidates[0];
      await fillSignal(best.signal, "company", "companyName", leadData.companyName, best.cls.confidence, best.cls.evidence);
    } else {
      skippedFields.push("companyName");
    }
  }

  // 6. Website
  const rawCo = leadData.companyName?.toLowerCase().replace(/[^a-z0-9]/g, "") || "example";
  const websiteValue = `https://${rawCo}.com`;
  const websiteCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "website")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (websiteCandidates.length > 0) {
    const best = websiteCandidates[0];
    await fillSignal(best.signal, "website", "website", websiteValue, best.cls.confidence, best.cls.evidence);
  }

  // 7. Subject
  const subjectCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "subject")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (subjectCandidates.length > 0) {
    const best = subjectCandidates[0];
    await fillSignal(best.signal, "subject", "subject", "Partnership / Inquiry", best.cls.confidence, best.cls.evidence);
  }

  // 8. City / Address
  const cityCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "city")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (cityCandidates.length > 0) {
    const best = cityCandidates[0];
    const loc = fields.nth(best.signal.index);
    if (best.signal.tagName === "select") {
      await safelyFillCityField(loc);
      usedIndexes.add(best.signal.index);
      filledFields.push("city");
      verificationItems.push({
        fieldIndex: best.signal.index,
        fieldType: "city",
        mappedSource: "city",
        confidence: best.cls.confidence,
        evidence: best.cls.evidence,
        filled: true,
        verified: true
      });
    } else {
      await fillSignal(best.signal, "city", "city", "New York", best.cls.confidence, best.cls.evidence);
    }
  }

  if (leadData.address) {
    const addrCandidates = signals
      .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
      .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
      .filter((item) => !item.cls.isNegative && item.cls.fieldType === "address")
      .sort((a, b) => b.cls.confidence - a.cls.confidence);

    if (addrCandidates.length > 0) {
      const best = addrCandidates[0];
      await fillSignal(best.signal, "address", "address", leadData.address, best.cls.confidence, best.cls.evidence);
    }
  }

  // 8b. Postal / ZIP code field
  const zipCandidates = signals
    .filter((s) => !usedIndexes.has(s.index) && !s.isDisabled && !s.isReadOnly)
    .map((s) => ({ signal: s, cls: classifications.get(s.index)! }))
    .filter((item) => !item.cls.isNegative && item.cls.fieldType === "postal_code")
    .sort((a, b) => b.cls.confidence - a.cls.confidence);

  if (zipCandidates.length > 0) {
    const best = zipCandidates[0];
    const zipMatch = leadData.address?.match(/\b\d{5}(-\d{4})?\b/)?.[0];
    const zipValue = zipMatch || "94105";
    await fillSignal(best.signal, "postal_code", "postalCode", zipValue, best.cls.confidence, best.cls.evidence);
  }

  // 9. Dropdowns: Select first real option for unmapped selects
  for (const signal of signals) {
    if (signal.tagName !== "select" || usedIndexes.has(signal.index)) continue;
    const didSelect = await selectFirstRealOption(fields.nth(signal.index)).catch(() => false);
    if (didSelect) {
      usedIndexes.add(signal.index);
      filledFields.push(`dropdown:${signal.index}`);
      verificationItems.push({
        fieldIndex: signal.index,
        fieldType: "unknown",
        mappedSource: `dropdown:${signal.index}`,
        confidence: 0.8,
        evidence: ["select first real option"],
        filled: true,
        verified: true
      });
    }
  }

  // 10. Remaining required fields fallback (ensures any unmapped required field across any CMS is filled)
  for (const signal of signals) {
    if (usedIndexes.has(signal.index)) continue;
    if (!signal.isRequired) continue;
    if (["password", "file"].includes(signal.type)) continue;

    const loc = fields.nth(signal.index);
    if (signal.type === "checkbox") {
      await loc.check({ force: true }).catch(async () => {
        await loc.click({ force: true }).catch(() => undefined);
      });
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
      const pVal = leadData.mobile || leadData.mobileNumber || "555-0199";
      const fillRes = await safelyFillField(loc, pVal).catch(() => ({ success: false, verified: false, actualValue: undefined }));
      if (fillRes.success) {
        usedIndexes.add(signal.index);
        filledFields.push(`required_phone:${signal.index}`);
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
      const didSelect = await selectFirstRealOption(loc).catch(() => false);
      if (didSelect) {
        usedIndexes.add(signal.index);
        filledFields.push(`required_select:${signal.index}`);
      }
      continue;
    }

    const existingVal = await loc.inputValue().catch(() => "");
    if (existingVal.trim()) {
      usedIndexes.add(signal.index);
      continue;
    }

    const fillRes = await safelyFillField(loc, REQUIRED_TEXT_FALLBACK).catch(() => ({ success: false, verified: false, actualValue: undefined }));
    if (fillRes.success) {
      usedIndexes.add(signal.index);
      filledFields.push(`required:${signal.index}`);
      verificationItems.push({
        fieldIndex: signal.index,
        fieldType: "unknown",
        mappedSource: `required:${signal.index}`,
        confidence: 0.7,
        evidence: ["fallback required text"],
        filled: true,
        verified: fillRes.verified,
        finalValue: fillRes.actualValue
      });
    }
  }

  // 11. Custom dropdowns & radios
  const customFilled = await selectCustomDropdownDefaults(scope);
  filledFields.push(...customFilled);
  const radioFilled = await selectRequiredRadioDefaults(scope);
  filledFields.push(...radioFilled);

  // 12. Required Checkboxes (Consent / Terms / GDPR)
  try {
    for (const signal of signals) {
      if (signal.type !== "checkbox" || usedIndexes.has(signal.index)) continue;
      const cb = fields.nth(signal.index);
      if (await cb.isVisible().catch(() => false)) {
        const text = [
          signal.name,
          signal.id,
          signal.explicitLabel,
          ...signal.associatedLabels,
          signal.surroundingLabel,
          signal.followingSiblingText,
          signal.parentContainerText
        ].join(" ");

        if (signal.isRequired || /consent|agree|terms|privacy|policy|gdpr|rules|accept/i.test(text)) {
          await cb.check({ force: true }).catch(async () => {
            await cb.click({ force: true }).catch(() => undefined);
          });
          usedIndexes.add(signal.index);
          filledFields.push(`consentCheckbox:${signal.index}`);
        }
      }
    }
  } catch {
    // Continue
  }

  // 13. Audit Required vs Unmapped Fields
  const unmappedRequiredFields: string[] = [];
  const unmappedOptionalFields: string[] = [];

  for (const signal of signals) {
    if (usedIndexes.has(signal.index)) continue;
    const loc = fields.nth(signal.index);
    
    // Check if element is a checkbox/radio that is already checked
    if (signal.type === "checkbox" || signal.type === "radio") {
      const isChecked = await loc.evaluate((el) => (el as HTMLInputElement).checked).catch(() => false);
      if (isChecked) {
        usedIndexes.add(signal.index);
        continue;
      }
    }

    // Check if element already has a value
    const existingVal = await loc.evaluate((el) => {
      if (el.tagName.toLowerCase() === "select") {
        const sel = el as HTMLSelectElement;
        const opt = sel.options[sel.selectedIndex];
        return opt ? opt.value || opt.textContent || "" : sel.value || "";
      }
      return (el as HTMLInputElement).value || "";
    }).catch(() => "");
    if (existingVal.trim()) {
      usedIndexes.add(signal.index);
      continue;
    }

    const identifier = signal.name || signal.id || signal.placeholder || signal.explicitLabel || `field_${signal.index}`;
    if (signal.isRequired && signal.isVisible && !signal.isDisabled) {
      unmappedRequiredFields.push(identifier);
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
    const selector = "form, [class*='gform_wrapper'], [class*='forminator'], [id*='gform_wrapper'], [class*='wpcf7'], [class*='w-form'], [class*='sqs-block-form'], [class*='_form'], iframe[src*='form'], iframe[src*='prospector'], iframe[src*='hubspot'], iframe[src*='lead']";
    document.querySelectorAll(selector).forEach((el) => {
      const htmlEl = el as HTMLElement;
      if (htmlEl && (htmlEl.style?.display === "none" || window.getComputedStyle(htmlEl).display === "none")) {
        htmlEl.style.display = "block";
      }
      if (htmlEl && (htmlEl.style?.visibility === "hidden" || window.getComputedStyle(htmlEl).visibility === "hidden")) {
        htmlEl.style.visibility = "visible";
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
    const count = await forms.count().catch(() => 0);
    for (let index = 0; index < count; index++) {
      const form = forms.nth(index);
      if (await form.isVisible().catch(() => false)) candidates.push(form);
    }
  };

  await addVisibleForms(page.locator("form"));
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    await addVisibleForms(frame.locator("form"));
  }

  let best: { form: Locator; score: number } | null = null;
  for (const form of candidates) {
    const score = await scorePrimaryForm(form);
    if (!best || score > best.score) best = { form, score };
  }
  return best?.form ?? null;
}

async function fillAllVisibleForms(page: Page, leadData: LeadData) {
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

  return { ...result, primaryForm };
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

async function detectSuccess(page: Page) {
  // Fast-path polling loop: check immediately and every 500ms for up to 6s
  // Many forms redirect or show confirmation immediately without waiting for background network requests.
  const startTime = Date.now();
  const maxWaitMs = 6000;

  while (Date.now() - startTime < maxWaitMs) {
    // 1. Check URL redirect or path
    const currentUrl = page.url().toLowerCase();
    if (/(thank[_-]?you|thanks|success|confirmed|submission-received|message-sent|inquiry-received)/i.test(currentUrl)) {
      return true;
    }

    // 2. Check known successful form framework selectors
    const isMatched = await checkSuccessFrameworkSelectors(page);
    if (isMatched) return true;

    // 3. Check page and child frames body text
    const textMatched = await checkSuccessText(page);
    if (textMatched) return true;

    await page.waitForTimeout(400);
  }

  return false;
}

async function checkSuccessFrameworkSelectors(page: Page): Promise<boolean> {
  const successSelectors = [
    ".wpcf7-mail-sent-ok:visible",
    ".wpcf7-response-output:has-text('Thank')",
    ".wpcf7-response-output:has-text('sent')",
    ".elementor-message-success:visible",
    ".w-form-done:visible",
    ".form-submission-success:visible",
    ".alert-success:visible",
    ".success-message:visible",
    "[role='alert']:has-text('thank')",
    "[role='alert']:has-text('sent')",
    ".submitted-message:visible",
    ".form-success:visible",
    ".gform_confirmation_message:visible",
    ".nf-response-msg:visible",
    ".fluentform-submission-success:visible",
    ".wpforms-confirmation-container:visible",
    ".frm_message:visible",
    ".ff-message-success:visible",
    "[data-form-status='success']:visible",
    "[aria-live='polite']:has-text('thank')",
    ".form-feedback:has-text('thank')"
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

  // Also check child frames (e.g. Dubsado, HubSpot, Typeform frames)
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const frameUrl = frame.url().toLowerCase();
    if (/(thank[_-]?you|thanks|success|confirmed)/i.test(frameUrl)) return true;
    const frameText = (await frame.locator("body").innerText({ timeout: 1000 }).catch(() => ""))
      .toLowerCase()
      .replace(/\s+/g, " ");
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
      await page.screenshot({ path: absolutePath, fullPage: true, timeout: 5000, animations: "disabled" });
    } catch {
      await page.screenshot({ path: absolutePath, fullPage: false, timeout: 3000 });
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
    fullName: leadData.fullName,
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

export async function submitContactForm({
  websiteUrl,
  leadData,
  headless = true,
  submit = true,
  liveSubmit,
  timeoutMs = 30000,
  browserContext,
  skipPersist,
  userId
}: SubmitContactFormInput & { browserContext?: BrowserContext; skipPersist?: boolean; userId?: string; liveSubmit?: boolean }): Promise<SubmitContactFormResult> {
  const shouldSubmit = liveSubmit !== undefined ? liveSubmit : submit;
  let browser: Browser | null = null;
  let page: Page | null = null;
  const submittedAt = new Date();
  let screenshotPath: string | null = null;
  let filledFields: string[] = [];
  let skippedFields: string[] = [];
  let fillMetrics: FormFillMetrics | null = null;

  const tStart = Date.now();
  let tNav = 0;
  let tReadiness = 0;
  let tFieldFilling = 0;
  let tSubmitDiscovery = 0;
  let submitDiag: SubmitCandidateDiagnostic | null = null;

  try {
    if (browserContext) {
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
    page.setDefaultTimeout(timeoutMs);

    // A contact form can be usable even when a legacy script, tracker, or other
    // resource prevents DOMContentLoaded/networkidle from completing. Continue
    // as soon as the server commits the document, then wait for form controls.
    const activePage = page;
    await blockHeavyAssets(activePage).catch(() => undefined);
    let proxy407Hit = false;
    let on407Reject: ((err: any) => void) | null = null;
    const proxy407Promise = new Promise((_, reject) => {
      on407Reject = reject;
    });
    const responseHandler = (res: any) => {
      if (res.status() === 407) {
        proxy407Hit = true;
        if (on407Reject) on407Reject(new ProxyAuthenticationError(PROXY_407_MESSAGE));
      }
    };
    activePage.on("response", responseHandler);

    let navResponse: any = null;
    const tNavStart = Date.now();
    try {
      navResponse = await Promise.race([
        activePage.goto(websiteUrl, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs
        }),
        proxy407Promise
      ]);
    } catch (gotoErr: any) {
      if (isProxyAuthenticationFailure(gotoErr) || proxy407Hit) {
        throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
      }
      try {
        navResponse = await Promise.race([
          activePage.goto(websiteUrl, { waitUntil: "commit", timeout: timeoutMs }),
          proxy407Promise
        ]);
      } catch (commitErr: any) {
        if (isProxyAuthenticationFailure(commitErr) || proxy407Hit) {
          throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
        }
      }
    } finally {
      activePage.off("response", responseHandler);
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

    // Progressive Dynamic Page Readiness
    const tReadinessStart = Date.now();
    await dismissCookieBanners(activePage).catch(() => undefined);
    await waitForDynamicPageReadiness(activePage, Math.min(timeoutMs, 8000));
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

    // Fill the selected primary form only once.
    const tFillStart = Date.now();
    const fillResult = await fillAllVisibleForms(page, leadData);
    tFieldFilling = Date.now() - tFillStart;
    filledFields = fillResult.filledFields;
    skippedFields = fillResult.skippedFields;
    fillMetrics = fillResult.metrics;
    screenshotPath = await takeScreenshot(page, websiteUrl, "before-submit");

    if (fillMetrics && fillMetrics.unmappedRequiredFields.length > 0) {
      const unmappedSummary = fillMetrics.unmappedRequiredFields.join(", ");
      console.warn(`[contact-form-automation] Unmapped required fields on ${websiteUrl}: ${unmappedSummary}`);
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
        throw new Error(`REQUIRED_FIELD_UNMAPPED: Missing required field(s): ${unmappedSummary}`);
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

    if (!submitButton) {
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

      throw new Error("No visible submit button found.");
    }

    if (shouldSubmit) {
      await dismissCookieBanners(activePage).catch(() => undefined);
      await submitButton.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
      // Wait for either navigation (redirect) or immediate DOM update/AJAX completion
      try {
        await Promise.allSettled([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 6000 }),
          submitButton.click({ timeout: 8000 })
        ]);
      } catch {
        // Fallback: requestSubmit on form directly if click fails
        await submitButton.evaluate((btn) => {
          const form = btn.closest("form");
          if (form && typeof form.requestSubmit === "function") {
            form.requestSubmit(btn as HTMLButtonElement | HTMLInputElement);
          } else if ("click" in btn && typeof (btn as HTMLElement).click === "function") {
            (btn as HTMLElement).click();
          }
        }).catch(() => undefined);
      }
    }

    const success = shouldSubmit ? await detectSuccess(page) : true;
    screenshotPath = await takeScreenshot(page, websiteUrl, shouldSubmit ? "after-submit" : "dry-run");

    if (!success) {
      throw new Error("Submit clicked, but no success message or successful page response was detected.");
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

    const result: SubmitContactFormResult = {
      websiteUrl,
      status: shouldSubmit ? "success" : "dry_run_ready_to_book",
      errorMessage: null,
      message: shouldSubmit ? "Contact form submitted successfully." : "Dry run: Form fields filled and submit button verified.",
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
    if (page && browserContext) {
      await page.close().catch(() => undefined);
    } else {
      await browser?.close().catch(() => undefined);
    }
  }
}
