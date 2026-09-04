import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Locator, type Page, type BrowserContext } from "playwright";
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

type FieldKey = "fullName" | "email" | "mobile" | "city" | "address" | "message" | "companyName";

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
const COMMON_INPUT_SELECTOR = [
  "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']):not([type='checkbox']):not([type='radio'])",
  "textarea",
  "select"
].join(",");

const FIELD_KEYWORDS: Record<FieldKey, string[]> = {
  fullName: [
    "full name",
    "fullname",
    "your name",
    "name",
    "first name",
    "last name"
  ],
  email: ["email", "e-mail", "mail"],
  mobile: ["phone", "mobile", "telephone", "tel", "cell", "contact number"],
  city: ["city", "town", "municipality"],
  address: ["address", "street", "state", "zip", "postal"],
  message: ["message", "comment", "comments", "details", "description", "note", "enquiry"],
  companyName: ["company", "business", "organization", "organisation", "brand"]
};

const FIELD_VALUES: Record<FieldKey, (leadData: LeadData) => string | undefined> = {
  fullName: (leadData) => leadData.fullName,
  email: (leadData) => leadData.email,
  mobile: (leadData) => leadData.mobile ?? leadData.mobileNumber,
  city: () => "New York",
  address: (leadData) => leadData.address,
  message: (leadData) => leadData.message,
  companyName: (leadData) => leadData.companyName
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

async function safelyFillField(locator: Locator, value: string) {
  if (!(await locator.isVisible().catch(() => false))) return false;
  if (!(await locator.isEnabled().catch(() => false))) return false;

  const tagName = await locator.evaluate((element) => element.tagName.toLowerCase());

  if (tagName === "select") {
    await locator.selectOption({ label: value }).catch(async () => {
      await locator.selectOption({ value }).catch(() => undefined);
    });
    return true;
  }

  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  await locator.click({ timeout: 2000 }).catch(() => undefined);
  await locator.fill("", { timeout: 3000 }).catch(() => undefined);
  await locator.pressSequentially(value, { delay: 45, timeout: 10000 });
  return true;
}

async function safelyFillCityField(locator: Locator) {
  if (!(await locator.isVisible().catch(() => false))) return false;
  if (!(await locator.isEnabled().catch(() => false))) return false;

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

  if (matchingOptionIndex < 0) return false;
  await locator.selectOption({ index: matchingOptionIndex }).catch(() => undefined);
  return true;
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
      if (selected && isRealOption(selected)) return -1;

      return Array.from(select.options).findIndex(isRealOption);
    })
    .catch(() => -1);

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

async function fillDetectedFields(scope: FormScope, leadData: LeadData) {
  const candidates = await collectFieldCandidates(scope);
  const usedIndexes = new Set<number>();
  const filledFields: string[] = [];
  const skippedFields: string[] = [];
  const fields = scope.locator(COMMON_INPUT_SELECTOR);

  // Fill true email controls before broad keyword scoring. Some page builders
  // place all labels in one container, making a nearby name label otherwise
  // look like a match for the email field.
  for (const candidate of candidates) {
    const isEmailField = candidate.type === "email" || /\b(e-?mail|email address)\b/i.test(candidate.descriptor);
    if (!isEmailField) continue;
    const didFill = await safelyFillField(fields.nth(candidate.index), leadData.email).catch(() => false);
    if (didFill) {
      usedIndexes.add(candidate.index);
      filledFields.push("email");
    }
  }

  const nameParts = leadData.fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.at(-1) ?? "";
  const middleName = nameParts.slice(1, -1).join(" ");
  const firstNameCandidate = candidates.find((candidate) => /first[ _-]?name|firstname|fname|given[ _-]?name/i.test(candidate.descriptor));
  const middleNameCandidate = candidates.find((candidate) => candidate.index !== firstNameCandidate?.index && /middle[ _-]?name|middlename|mname/i.test(candidate.descriptor));
  const lastNameCandidate = candidates.find((candidate) => candidate.index !== firstNameCandidate?.index && /last[ _-]?name|lastname|lname|surname|family[ _-]?name/i.test(candidate.descriptor));

  if (firstNameCandidate) {
    const firstFilled = await safelyFillField(fields.nth(firstNameCandidate.index), firstName).catch(() => false);
    if (firstFilled) usedIndexes.add(firstNameCandidate.index);
    if (firstFilled) filledFields.push("firstName");
  }

  if (middleNameCandidate) {
    // For a two-part (or single-part) lead name, repeat the supplied full
    // name in a required middle-name field rather than leaving it blank.
    const middleValue = middleName || leadData.fullName;
    const middleFilled = await safelyFillField(fields.nth(middleNameCandidate.index), middleValue).catch(() => false);
    if (middleFilled) usedIndexes.add(middleNameCandidate.index);
    if (middleFilled) filledFields.push("middleName");
  }

  if (lastNameCandidate) {
    // A one-word lead name is valid: reuse it for a required surname field.
    const lastValue = nameParts.length > 1 ? lastName : leadData.fullName;
    const lastFilled = await safelyFillField(fields.nth(lastNameCandidate.index), lastValue).catch(() => false);
    if (lastFilled) usedIndexes.add(lastNameCandidate.index);
    if (lastFilled) filledFields.push("lastName");
  }

  for (const fieldKey of Object.keys(FIELD_VALUES) as FieldKey[]) {
    if (fieldKey === "email" && filledFields.includes("email")) continue;
    if (fieldKey === "fullName" && (filledFields.includes("firstName") || filledFields.includes("lastName"))) continue;
    const value = FIELD_VALUES[fieldKey](leadData);

    if (!value) {
      skippedFields.push(fieldKey);
      continue;
    }

    const ranked = candidates
      .filter((candidate) => !usedIndexes.has(candidate.index))
      .map((candidate) => ({
        candidate,
        score: scoreCandidate(candidate, fieldKey)
      }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];

    if (!best || best.score <= 0) {
      skippedFields.push(fieldKey);
      continue;
    }

    const didFill = await (fieldKey === "city"
      ? safelyFillCityField(fields.nth(best.candidate.index))
      : safelyFillField(fields.nth(best.candidate.index), value)
    ).catch(() => false);

    if (didFill) {
      usedIndexes.add(best.candidate.index);
      filledFields.push(fieldKey);
    } else {
      skippedFields.push(fieldKey);
    }
  }

  // Dropdowns such as "Service you need" do not map to lead data. Select the
  // first genuine option so required selects are not left on their placeholder.
  for (const candidate of candidates) {
    if (candidate.tagName !== "select" || usedIndexes.has(candidate.index)) continue;
    const didSelect = await selectFirstRealOption(fields.nth(candidate.index)).catch(() => false);
    if (didSelect) {
      usedIndexes.add(candidate.index);
      filledFields.push(`dropdown:${candidate.index}`);
    }
  }

  // Forms frequently include an unnamed required text field such as
  // "What service do you need?". It has no reliable semantic mapping, so
  // supply the requested service value after all known lead fields are done.
  filledFields.push(...await fillRemainingRequiredTextFields(fields, candidates, usedIndexes));

  filledFields.push(...await selectCustomDropdownDefaults(scope));
  filledFields.push(...await selectRequiredRadioDefaults(scope));

  // Check only controls the form explicitly marks as required. Optional
  // consent and marketing opt-ins must remain untouched.
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

  return { filledFields, skippedFields };
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

async function findPrimaryForm(page: Page) {
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
  return fillDetectedFields(primaryForm ?? page, leadData);
}

async function findSubmitButton(page: Page, leadData?: LeadData) {
  const selectors = [
    "button[type='submit']",
    "input[type='submit']",
    "button.hs-button",
    "input.hs-button",
    ".wpcf7-submit",
    "form button:not([type='button'])",
    "form input[type='submit']",
    "button:has-text('Submit')",
    "button:has-text('Send')",
    "button:has-text('Contact')",
    "button:has-text('Get in touch')",
    "button:has-text('Request')",
    "button:has-text('Nachricht')",
    "button:has-text('Enviar')",
    "button:has-text('Absenden')",
    "button:has-text('Envoyer')",
    "input[value*='Submit' i]",
    "input[value*='Send' i]",
    "input[value*='Contact' i]",
    "input[value*='Enviar' i]",
    "input[value*='Absenden' i]",
    "[role='button']:has-text('Submit')",
    "[role='button']:has-text('Send')",
    "[role='button']:has-text('Enviar')",
    "button:has-text('Let\'s get started')",
    "input[value*='started' i]",
    "a:has-text('Submit')",
    "a:has-text('Send')",
    "a:has-text('Send Message')",
    "a:has-text('Get in touch')",
    "div[role='button']:has-text('Submit')",
    "div[role='button']:has-text('Send')",
    "[class*='form' i] a",
    "[class*='form' i] [role='button']"
  ];

  const primaryForm = await findPrimaryForm(page);
  if (primaryForm) {
    for (const selector of selectors) {
      const locators = primaryForm.locator(selector);
      const count = await locators.count().catch(() => 0);
      for (let index = 0; index < count; index++) {
        const locator = locators.nth(index);
        if (await locator.isVisible().catch(() => false)) return locator;
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

  // Also check inside child frames (e.g. Dubsado on zachtoth.com)
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

        if (lowerSrc.includes("meetings.hubspot.com")) {
          return "iframe contains HubSpot Meetings";
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
  const successPatterns = [
    "thank you",
    "thanks",
    "success",
    "submitted",
    "sent",
    "message has been",
    "we will be in touch"
  ];

  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(2500);

  const bodyText = (await page.locator("body").innerText({ timeout: 5000 }).catch(() => ""))
    .toLowerCase()
    .replace(/\s+/g, " ");

  return successPatterns.some((pattern) => bodyText.includes(pattern));
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
    let proxy407Hit = false;
    const responseHandler = (res: any) => {
      if (res.status() === 407) proxy407Hit = true;
    };
    activePage.on("response", responseHandler);

    let navResponse: any = null;
    try {
      navResponse = await activePage.goto(websiteUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs
      });
    } catch (gotoErr: any) {
      if (isProxyAuthenticationFailure(gotoErr) || proxy407Hit) {
        screenshotPath = await takeScreenshot(page, websiteUrl, "proxy-407-failure").catch(() => null);
        throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
      }
      try {
        navResponse = await activePage.goto(websiteUrl, { waitUntil: "commit", timeout: timeoutMs });
      } catch (commitErr: any) {
        if (isProxyAuthenticationFailure(commitErr) || proxy407Hit) {
          screenshotPath = await takeScreenshot(page, websiteUrl, "proxy-407-failure").catch(() => null);
          throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
        }
      }
    } finally {
      activePage.off("response", responseHandler);
    }

    if (navResponse?.status() === 407 || proxy407Hit) {
      screenshotPath = await takeScreenshot(page, websiteUrl, "proxy-407-failure").catch(() => null);
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
    screenshotPath = await takeScreenshot(page, websiteUrl, "before-submit");

    // Dismiss any newly popped cookie consent banners
    await dismissCookieBanners(activePage).catch(() => undefined);

    // Some services show bot protection only after their client-side form has
    // hydrated. Check once more before locating the submit action.
    const postFillVerification = await detectUnsupportedVerification(page, websiteUrl);
    if (postFillVerification) {
      if (postFillVerification.screenshotPath) screenshotPath = postFillVerification.screenshotPath;
      throw new Error(postFillVerification.reason);
    }

    const submitButton = await findSubmitButton(page, leadData);

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
      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 12000 }),
        submitButton.click({ timeout: 10000 })
      ]);
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
      bookingWidgetReason: null
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
      bookingWidgetReason: null
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
