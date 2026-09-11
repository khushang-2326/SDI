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
import {
  LeadData,
  SubmitContactFormInput,
  SubmitContactFormResult
} from "@/types/automation";
import { dismissCookieBanners } from "./cookie-consent-helper";
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

type BookingWidgetDetection = {
  found: boolean;
  reason: string | null;
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
    const shouldBlock =
      ["image", "font", "media"].includes(resourceType) ||
      url.includes("google-analytics") ||
      url.includes("googletagmanager") ||
      url.includes("facebook") ||
      url.includes("doubleclick") ||
      url.includes("hotjar");

    if (shouldBlock) {
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

  if (tagName === "select") {
    let selected = false;
    await locator.selectOption({ label: value }).then(() => { selected = true; }).catch(async () => {
      await locator.selectOption({ value }).then(() => { selected = true; }).catch(() => undefined);
    });
    const selectVal = await locator.inputValue().catch(() => "");
    return { success: true, verified: Boolean(selectVal) || selected, actualValue: selectVal };
  }

  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
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
  if (!(await locator.isVisible().catch(() => false))) return false;
  if (!(await locator.isEnabled().catch(() => false))) return false;

  const optionIndex = await locator
    .evaluate((element) => {
      const select = element as HTMLSelectElement;
      const placeholderPattern = /^(select|choose|please\s+(select|choose)|which|pick\s+an?|--|none\b)/i;
      const isRealOption = (option: HTMLOptionElement) => {
        const label = option.textContent?.replace(/\s+/g, " ").trim() ?? "";
        return !option.disabled && Boolean(option.value.trim()) && !placeholderPattern.test(label);
      };

      const selected = select.options[select.selectedIndex];
      if (selected && isRealOption(selected)) return -2;

      return Array.from(select.options).findIndex(isRealOption);
    })
    .catch(() => -1);

  if (optionIndex === -2) return true;
  if (optionIndex < 0) return false;
  await locator.selectOption({ index: optionIndex });
  return true;
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
  const count = await dropdowns.count();

  for (let index = 0; index < count; index++) {
    const dropdown = dropdowns.nth(index);
    if (!(await dropdown.isVisible().catch(() => false))) continue;
    if (!(await dropdown.isEnabled().catch(() => false))) continue;

    await dropdown.scrollIntoViewIfNeeded().catch(() => undefined);
    const opened = await dropdown.click({ timeout: 2000 }).then(() => true).catch(() => false);
    if (!opened) continue;

    const options = dropdown.page().locator([
      "[role='listbox']:visible [role='option']:visible",
      "[role='menu']:visible [role='menuitem']:visible",
      "[role='option']:visible"
    ].join(", "));
    const optionCount = await options.count();
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

  // 10. Remaining required text fields fallback (e.g. "What service do you need?")
  for (const signal of signals) {
    if (usedIndexes.has(signal.index)) continue;
    if (signal.tagName !== "textarea" && signal.tagName !== "input") continue;
    if (!signal.isRequired) continue;
    if (["email", "tel", "number", "date", "time", "url", "file", "password"].includes(signal.type)) continue;

    const loc = fields.nth(signal.index);
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

  // 12. Required Checkboxes (Consent / Terms only)
  try {
    const checkboxes = scope.locator("input[type='checkbox']");
    const checkboxCount = await checkboxes.count().catch(() => 0);
    for (let i = 0; i < checkboxCount; i++) {
      const cb = checkboxes.nth(i);
      if (await cb.isVisible().catch(() => false)) {
        const cbRequired = await cb.getAttribute("required");
        const cbAriaRequired = await cb.getAttribute("aria-required");
        const isRequired = cbRequired !== null || cbAriaRequired === "true";
        if (isRequired) {
          await cb.check({ force: true }).catch(async () => {
            await cb.click({ force: true }).catch(() => undefined);
          });
          filledFields.push("consentCheckbox");
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
    // Check if element already has a value
    const loc = fields.nth(signal.index);
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

  const metrics: FormFillMetrics = {
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
    const selector = "form, [class*='gform_wrapper'], [class*='forminator'], [id*='gform_wrapper'], [class*='wpcf7'], [class*='w-form'], [class*='sqs-block-form'], [class*='_form']";
    document.querySelectorAll(selector).forEach((el) => {
      const htmlEl = el as HTMLElement;
      if (htmlEl && (htmlEl.style?.display === "none" || window.getComputedStyle(htmlEl).display === "none")) {
        htmlEl.style.display = "block";
      }
    });
  }).catch(() => undefined);
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
  const primaryForm = await findPrimaryForm(page);
  // A small number of sites use controls without a wrapping <form>.
  const result = await fillDetectedFields(primaryForm ?? page, leadData);
  return { ...result, primaryForm };
}

export async function findSubmitButton(page: Page, leadData?: LeadData, targetForm?: Locator | null) {
  await unhideHiddenFormContainers(page);
  const selectors = [
    // Standard submit elements
    "button[type='submit']",
    "input[type='submit']",
    "input[type='image']",
    // Framework-specific submit controls
    ".elementor-button[type='submit']",
    "button.elementor-button",
    ".elementor-field-type-submit button",
    "button.hs-button",
    "input.hs-button",
    ".wpcf7-submit",
    "input.wpcf7-submit",
    "button.wpcf7-submit",
    ".gform_button",
    "input.gform_button",
    "button.gform_button",
    "input[id*='gform_submit' i]",
    "button[id*='gform_submit' i]",
    ".gform_footer input[type='submit']",
    ".gform_footer button",
    ".forminator-button-submit",
    "button.forminator-button",
    ".forminator-custom-form button",
    "button.wpforms-submit",
    "input.wpforms-submit",
    ".wpforms-submit-container button",
    "button.ff-btn-submit",
    "button.fluentform-submit-btn",
    "input.ninja-forms-field[type='submit']",
    ".nf-field-element input[type='button']",
    ".nf-field-element input[type='submit']",
    "a[href*='submit-form' i]",
    ".elButton",
    "form button:not([type='button'])",
    "form input[type='submit']",
    "button[id*='submit' i]",
    "button[class*='submit' i]",
    "input[id*='submit' i]",
    // Semantic signal texts on button
    "button:has-text('Submit')",
    "button:has-text('Submit Form')",
    "button:has-text('Send')",
    "button:has-text('Send Message')",
    "button:has-text('Send Enquiry')",
    "button:has-text('Submit Message')",
    "button:has-text('Get Started')",
    "button:has-text('Start Now')",
    "button:has-text('Start booking')",
    "button:has-text('Get My Custom Quote')",
    "button:has-text('Get a Quote')",
    "button:has-text('Quote')",
    "button:has-text('Request Quote')",
    "button:has-text('Request Consultation')",
    "button:has-text('Request A Quote')",
    "button:has-text('Request Demo')",
    "button:has-text('Request A Demo')",
    "button:has-text('Book A Call')",
    "button:has-text('Book Now')",
    "button:has-text('Book')",
    "button:has-text('Schedule')",
    "button:has-text('Schedule Consultation')",
    "button:has-text('Schedule A Call')",
    "button:has-text('Let\\'s Talk')",
    "button:has-text('Connect')",
    "button:has-text('Inquire')",
    "button:has-text('Contact')",
    "button:has-text('Contact Us')",
    "button:has-text('Get in touch')",
    "button:has-text('Free Strategy Session')",
    "button:has-text('Subscribe')",
    "button:has-text('SUBSCRIBE')",
    "button:has-text('Nachricht')",
    "button:has-text('Enviar')",
    "button:has-text('Absenden')",
    "button:has-text('Envoyer')",
    // Semantic input values
    "input[value*='Submit' i]",
    "input[value*='Send' i]",
    "input[value*='Enquiry' i]",
    "input[value*='Contact' i]",
    "input[value*='Get Started' i]",
    "input[value*='Start' i]",
    "input[value*='Quote' i]",
    "input[value*='Book' i]",
    "input[value*='Subscribe' i]",
    "input[value*='Enviar' i]",
    "input[value*='Absenden' i]",
    "input[value*='Demo' i]",
    // Semantic role=button
    "[role='button']:has-text('Submit')",
    "[role='button']:has-text('Submit Form')",
    "[role='button']:has-text('Send')",
    "[role='button']:has-text('Send Message')",
    "[role='button']:has-text('Get Started')",
    "[role='button']:has-text('Start booking')",
    "[role='button']:has-text('Quote')",
    "[role='button']:has-text('Get My Custom Quote')",
    "[role='button']:has-text('Request Quote')",
    "[role='button']:has-text('Request Consultation')",
    "[role='button']:has-text('Book Now')",
    "[role='button']:has-text('Book')",
    "[role='button']:has-text('Schedule')",
    "[role='button']:has-text('Let\\'s Talk')",
    "[role='button']:has-text('Enviar')",
    // Button-like div / span / a associated with form
    "a:has-text('Submit')",
    "a:has-text('Submit Form')",
    "a:has-text('Send')",
    "a:has-text('Send Message')",
    "a:has-text('Get in touch')",
    "a:has-text('Quote')",
    "a:has-text('Request Quote')",
    "a:has-text('Start booking')",
    "a:has-text('Book')",
    "div[role='button']:has-text('Submit')",
    "div[role='button']:has-text('Send')",
    "div[class*='btn']:has-text('Submit')",
    "div[class*='btn']:has-text('Send')",
    "div[class*='button']:has-text('Submit')",
    "div[class*='button']:has-text('Send')",
    "span[class*='btn']:has-text('Submit')",
    "span[class*='button']:has-text('Submit')",
    "[class*='form' i] a[class*='btn']",
    "[class*='form' i] a[class*='button']",
    "[class*='form' i] [role='button']"
  ];

  const primaryForm = targetForm ?? (await findPrimaryForm(page));
  if (primaryForm) {
    for (const selector of selectors) {
      const locators = primaryForm.locator(selector);
      const count = await locators.count().catch(() => 0);
      for (let index = 0; index < count; index++) {
        const locator = locators.nth(index);
        if (await locator.isVisible().catch(() => false)) return locator;

        // If not immediately visible, scroll into view and re-check
        await locator.scrollIntoViewIfNeeded().catch(() => undefined);
        if (await locator.isVisible().catch(() => false)) return locator;

        // Zero-height / Theme-styled Gravity / Forminator recovery:
        // If attached, enabled, and matches designated submit traits inside form
        const isAttachedSubmit = await locator.evaluate((el) => {
          const tag = el.tagName.toLowerCase();
          const type = (el as HTMLInputElement).type?.toLowerCase();
          const cls = (el.className || "").toLowerCase();
          const id = (el.id || "").toLowerCase();
          const isSubmitType = type === "submit" || type === "image";
          const isSubmitClass = cls.includes("submit") || cls.includes("gform_button") || cls.includes("forminator-button") || cls.includes("wpforms-submit");
          const isSubmitId = id.includes("submit") || id.includes("gform_submit");
          const isBtn = tag === "button" || tag === "input";
          const isDisabled = (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
          return isBtn && (isSubmitType || isSubmitClass || isSubmitId) && !isDisabled;
        }).catch(() => false);
        if (isAttachedSubmit) return locator;
      }
    }

    // Check if primaryForm has an id, look for external submit button associated via HTML5 form="id"
    const formId = await primaryForm.getAttribute("id").catch(() => null);
    if (formId) {
      const externalLocators = page.locator(`button[form='${formId}'], input[form='${formId}'][type='submit']`);
      const extCount = await externalLocators.count().catch(() => 0);
      for (let i = 0; i < extCount; i++) {
        const extLoc = externalLocators.nth(i);
        if (await extLoc.isVisible().catch(() => false)) return extLoc;
      }
    }
  }

  const modalRoots = page.locator([
    "[role='dialog']:visible",
    "[aria-modal='true']:visible",
    ".modal:visible",
    "[class*='popup' i]:visible"
  ].join(", "));
  for (let rootIndex = 0; rootIndex < await modalRoots.count(); rootIndex++) {
    const root = modalRoots.nth(rootIndex);
    for (const selector of selectors) {
      const locators = root.locator(selector);
      const count = await locators.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const loc = locators.nth(i);
        if (await loc.isVisible().catch(() => false)) return loc;
      }
    }
  }

  for (const selector of selectors) {
    const locators = page.locator(selector);
    const count = await locators.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const loc = locators.nth(i);
      if (await loc.isVisible().catch(() => false)) {
        return loc;
      }
      // If not immediately visible, scroll into view and re-check
      await loc.scrollIntoViewIfNeeded().catch(() => undefined);
      if (await loc.isVisible().catch(() => false)) return loc;

      const isAttachedSubmit = await loc.evaluate((el) => {
        const tag = el.tagName.toLowerCase();
        const type = (el as HTMLInputElement).type?.toLowerCase();
        const cls = (el.className || "").toLowerCase();
        const id = (el.id || "").toLowerCase();
        const isSubmitType = type === "submit" || type === "image";
        const isSubmitClass = cls.includes("submit") || cls.includes("gform_button") || cls.includes("forminator-button") || cls.includes("wpforms-submit");
        const isSubmitId = id.includes("submit") || id.includes("gform_submit");
        const isBtn = tag === "button" || tag === "input";
        const isDisabled = (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
        return isBtn && (isSubmitType || isSubmitClass || isSubmitId) && !isDisabled;
      }).catch(() => false);
      if (isAttachedSubmit) return loc;
    }
  }

  // Multi-step forms (e.g. Elementor, Town & Country Web Design): click "NEXT" button to reveal submit button
  const nextStepSelectors = [
    ".e-form__buttons__wrapper__button-next:visible",
    "button:has-text('NEXT'):visible",
    "button:has-text('Next'):visible",
    "button:has-text('Continue'):visible",
    "button:has-text('Weiter'):visible",
    "button:has-text('Siguiente'):visible",
    "input[value='NEXT' i]:visible",
    "input[value='Next' i]:visible",
    "[role='button']:has-text('Next'):visible"
  ];

  for (let step = 0; step < 4; step++) {
    let clickedNext = false;
    for (const nextSel of nextStepSelectors) {
      const nextBtn = page.locator(nextSel).first();
      if ((await nextBtn.count()) > 0 && (await nextBtn.isVisible().catch(() => false))) {
        // If there are visible unchecked checkboxes, check the first one to allow next step
        const visibleCbs = page.locator("input[type='checkbox']:visible");
        const cbCount = await visibleCbs.count().catch(() => 0);
        if (cbCount > 0) {
          const firstCb = visibleCbs.first();
          if (!(await firstCb.isChecked().catch(() => false))) {
            await firstCb.check({ force: true }).catch(() => undefined);
            await page.waitForTimeout(250);
          }
        }
        await nextBtn.scrollIntoViewIfNeeded().catch(() => undefined);
        await nextBtn.click({ force: true }).catch(() => undefined);
        await page.waitForTimeout(1200);
        clickedNext = true;
        if (leadData) {
          await fillAllVisibleForms(page, leadData).catch(() => undefined);
        }
        break;
      }
    }

    if (clickedNext) {
      for (const selector of selectors) {
        const locators = page.locator(selector);
        const count = await locators.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const loc = locators.nth(i);
          if (await loc.isVisible().catch(() => false)) {
            return loc;
          }
        }
      }
    } else {
      break;
    }
  }

  // Also check inside child frames (e.g. Dubsado on zachtoth.com, embedded forms)
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    for (const selector of selectors) {
      const locators = frame.locator(selector);
      const count = await locators.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const loc = locators.nth(i);
        if (await loc.isVisible().catch(() => false)) {
          return loc;
        }
        await loc.scrollIntoViewIfNeeded().catch(() => undefined);
        if (await loc.isVisible().catch(() => false)) {
          return loc;
        }
      }
    }
  }

  return null;
}

async function detectBookingWidget(page: Page): Promise<BookingWidgetDetection> {
  const iframeMatch = await page
    .locator("iframe")
    .evaluateAll((iframes) => {
      for (const iframe of iframes) {
        const src = iframe.getAttribute("src") ?? "";
        const title = iframe.getAttribute("title") ?? "";
        const lowerSrc = src.toLowerCase();
        const lowerTitle = title.toLowerCase();

        if (lowerSrc.includes("calendly") || lowerTitle.includes("calendly")) {
          return "iframe contains Calendly";
        }

        if (lowerSrc.includes("leadconnector") || lowerSrc.includes("highlevel") || lowerTitle.includes("leadconnector")) {
          return "iframe contains LeadConnector / HighLevel booking widget";
        }

        if (/(^|\.)meetings(-[a-z0-9]+)?\.hubspot\.com/i.test(lowerSrc) || lowerSrc.includes("meetings.hubspot.com")) {
          return "iframe contains HubSpot Meetings";
        }

        if (/acuityscheduling\.com|tidycal\.com|simplybook\.me|youcanbook\.me|calendarhero\.com|appointlet\.com|setmore\.com|cal\.com/i.test(lowerSrc)) {
          return "iframe contains booking calendar widget";
        }
      }

      return null;
    })
    .catch(() => null);

  if (iframeMatch) {
    return { found: true, reason: iframeMatch };
  }

  const textMatch = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .then((text) => {
      const normalized = text.toLowerCase().replace(/\s+/g, " ");
      const phrases = [
        "select a date & time",
        "schedule a meeting",
        "book a call",
        "choose a time"
      ];

      return phrases.find((phrase) => normalized.includes(phrase)) ?? null;
    })
    .catch(() => null);

  if (textMatch) {
    return { found: true, reason: `text contains "${textMatch}"` };
  }

  const slotReason = await page
    .locator("button, [role='button'], a")
    .evaluateAll((elements) => {
      const visibleElements = elements.filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      });
      const slotTextPattern =
        /\b(\d{1,2}:\d{2}\s?(am|pm)|\d{1,2}\s?(am|pm)|today|tomorrow|morning|afternoon|evening)\b/i;
      const dateLabelPattern =
        /\b(mon|tue|wed|thu|fri|sat|sun|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
      const explicitSlot = visibleElements.find((element) => {
        const text = element.textContent ?? "";
        const label = element.getAttribute("aria-label") ?? "";
        const combined = `${text} ${label}`;
        return slotTextPattern.test(combined) || dateLabelPattern.test(combined);
      });

      if (explicitSlot) {
        return "button with date/time slot text";
      }

      const numericButtons = visibleElements.filter((element) => {
        const text = (element.textContent ?? "").trim();
        const label = element.getAttribute("aria-label") ?? "";
        return /^\d{1,2}$/.test(text) || /\b\d{1,2},?\s?\d{4}\b/.test(label);
      });

      if (numericButtons.length >= 5) {
        return "multiple date-slot buttons detected";
      }

      return null;
    })
    .catch(() => null);

  if (slotReason) {
    return { found: true, reason: slotReason };
  }

  return { found: false, reason: null };
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
    "as soon as possible"
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
    await page.screenshot({ path: absolutePath, fullPage: true, timeout: 15000, animations: "disabled" });
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

    if (navResponse?.status() === 407 || proxy407Hit) {
      throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
    }

    // Bounded wait for dynamic form or inputs to mount (HubSpot, LeadConnector, SPA embeds)
    await activePage
      .locator("form:not([action*='search']), input:not([type=hidden]):not([type=search]), textarea")
      .first()
      .waitFor({ state: "attached", timeout: 3500 })
      .catch(() => undefined);

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

    if (statusCode === 202 && (/robot challenge/i.test(pageTitle) || /security/i.test(pageBodyText))) {
      screenshotPath = await takeScreenshot(page, websiteUrl, "robot-challenge-202").catch(() => null);
      throw new Error("Unsupported verification: Robot Challenge Screen detected. Manual verification required.");
    }

    // Auto-accept cookie consent banners so contact forms and submit buttons become visible
    await dismissCookieBanners(activePage).catch(() => undefined);

    await activePage
      .locator("form, input, textarea, select, button[type='submit'], input[type='submit']")
      .first()
      .waitFor({
        state: "attached",
        timeout: Math.min(timeoutMs, 15000)
      })
      .catch(() => undefined);

    await dismissCookieBanners(activePage).catch(() => undefined);
    await page.waitForTimeout(500);

    const verification = await detectUnsupportedVerification(page, websiteUrl);
    if (verification) {
      if (verification.screenshotPath) screenshotPath = verification.screenshotPath;
      throw new Error(verification.reason);
    }

    // Fill the selected primary form only once. Repeating this pass cleared
    // and retyped every field, making each website visibly slower.
    const fillResult = await fillAllVisibleForms(page, leadData);
    filledFields = fillResult.filledFields;
    skippedFields = fillResult.skippedFields;
    fillMetrics = fillResult.metrics;
    screenshotPath = await takeScreenshot(page, websiteUrl, "before-submit");

    if (fillMetrics && fillMetrics.unmappedRequiredFields.length > 0) {
      const unmappedSummary = fillMetrics.unmappedRequiredFields.join(", ");
      console.warn(`[contact-form-automation] Unmapped required fields on ${websiteUrl}: ${unmappedSummary}`);
      throw new Error(`REQUIRED_FIELD_UNMAPPED: Missing required field(s): ${unmappedSummary}`);
    }

    // Dismiss any newly popped cookie consent banners
    await dismissCookieBanners(activePage).catch(() => undefined);

    // Some services show bot protection only after their client-side form has
    // hydrated. Check once more before locating the submit action.
    const postFillVerification = await detectUnsupportedVerification(page, websiteUrl);
    if (postFillVerification) {
      if (postFillVerification.screenshotPath) screenshotPath = postFillVerification.screenshotPath;
      throw new Error(postFillVerification.reason);
    }

    let submitButton = await findSubmitButton(page, leadData, fillResult.primaryForm);

    // Bounded hydration polling window (up to 2.5s) for asynchronously mounted/enabled submit buttons
    if (!submitButton) {
      for (let poll = 0; poll < 5; poll++) {
        await page.waitForTimeout(500);
        submitButton = await findSubmitButton(page, leadData, fillResult.primaryForm);
        if (submitButton) break;
      }
    }

    if (!submitButton) {
      const bookingWidget = await detectBookingWidget(page);

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
      await submitButton.scrollIntoViewIfNeeded().catch(() => undefined);
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

    const result: SubmitContactFormResult = {
      websiteUrl,
      status: shouldSubmit ? "success" : "dry_run_ready_to_book",
      errorMessage: null,
      screenshotPath,
      submittedAt,
      filledFields,
      skippedFields,
      bookingWidgetReason: null,
      filledFieldsCount: fillMetrics?.filledFieldsCount ?? filledFields.length,
      verifiedFieldsCount: fillMetrics?.verifiedFieldsCount ?? filledFields.length,
      unmappedRequiredFields: fillMetrics?.unmappedRequiredFields ?? [],
      unmappedOptionalFields: fillMetrics?.unmappedOptionalFields ?? [],
      fieldVerificationItems: fillMetrics?.items ?? []
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

    const result: SubmitContactFormResult = {
      websiteUrl,
      status: "failed",
      errorMessage,
      screenshotPath,
      submittedAt,
      filledFields,
      skippedFields,
      bookingWidgetReason: null,
      filledFieldsCount: fillMetrics?.filledFieldsCount ?? filledFields.length,
      verifiedFieldsCount: fillMetrics?.verifiedFieldsCount ?? 0,
      unmappedRequiredFields: fillMetrics?.unmappedRequiredFields ?? [],
      unmappedOptionalFields: fillMetrics?.unmappedOptionalFields ?? [],
      fieldVerificationItems: fillMetrics?.items ?? []
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
