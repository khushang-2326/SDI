import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Locator, type Page, type BrowserContext } from "playwright";
import { getChromiumExecutablePath } from "@/services/browser-executable";
import { prisma } from "@/lib/prisma";
import {
  LeadData,
  SubmitContactFormInput,
  SubmitContactFormResult
} from "@/types/automation";

type FieldKey = "fullName" | "email" | "mobile" | "address" | "message" | "companyName";

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
const COMMON_INPUT_SELECTOR = [
  "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset'])",
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
  address: ["address", "street", "city", "state", "zip", "postal"],
  message: ["message", "comment", "comments", "details", "description", "note", "enquiry"],
  companyName: ["company", "business", "organization", "organisation", "brand"]
};

const FIELD_VALUES: Record<FieldKey, (leadData: LeadData) => string | undefined> = {
  fullName: (leadData) => leadData.fullName,
  email: (leadData) => leadData.email,
  mobile: (leadData) => leadData.mobile ?? leadData.mobileNumber,
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
          nearbyText
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

  const nameParts = leadData.fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ");
  const firstNameCandidate = candidates.find((candidate) => /first[ _-]?name|firstname|fname|given[ _-]?name/i.test(candidate.descriptor));
  const lastNameCandidate = candidates.find((candidate) => candidate.index !== firstNameCandidate?.index && /last[ _-]?name|lastname|lname|surname|family[ _-]?name/i.test(candidate.descriptor));

  if (firstName && lastName && firstNameCandidate && lastNameCandidate) {
    const firstFilled = await safelyFillField(fields.nth(firstNameCandidate.index), firstName).catch(() => false);
    const lastFilled = await safelyFillField(fields.nth(lastNameCandidate.index), lastName).catch(() => false);
    if (firstFilled) usedIndexes.add(firstNameCandidate.index);
    if (lastFilled) usedIndexes.add(lastNameCandidate.index);
    if (firstFilled && lastFilled) filledFields.push("firstName", "lastName");
  }

  for (const fieldKey of Object.keys(FIELD_VALUES) as FieldKey[]) {
    if (fieldKey === "fullName" && filledFields.includes("firstName") && filledFields.includes("lastName")) continue;
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

    const didFill = await safelyFillField(fields.nth(best.candidate.index), value).catch(
      () => false
    );

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

  filledFields.push(...await selectCustomDropdownDefaults(scope));

  return { filledFields, skippedFields };
}

async function fillAllVisibleForms(page: Page, leadData: LeadData) {
  const forms = page.locator("form");
  const formCount = await forms.count();
  const filledFields = new Set<string>();
  const skippedFields = new Set<string>();
  let visibleFormCount = 0;

  for (let index = 0; index < formCount; index++) {
    const form = forms.nth(index);
    if (!(await form.isVisible().catch(() => false))) continue;
    if ((await form.locator(COMMON_INPUT_SELECTOR).count()) === 0) continue;
    visibleFormCount++;
    const result = await fillDetectedFields(form, leadData);
    for (const field of result.filledFields) filledFields.add(field);
    for (const field of result.skippedFields) skippedFields.add(field);
  }

  // A small number of sites use form controls without a wrapping <form>.
  if (visibleFormCount === 0) {
    const result = await fillDetectedFields(page, leadData);
    for (const field of result.filledFields) filledFields.add(field);
    for (const field of result.skippedFields) skippedFields.add(field);
  }

  for (const field of filledFields) skippedFields.delete(field);
  return { filledFields: [...filledFields], skippedFields: [...skippedFields] };
}

async function findSubmitButton(page: Page) {
  const selectors = [
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Submit')",
    "button:has-text('Send')",
    "button:has-text('Contact')",
    "input[value*='Submit' i]",
    "input[value*='Send' i]",
    "[role='button']:has-text('Submit')",
    "[role='button']:has-text('Send')"
    ,"form button:not([type='button'])"
    ,"form input[type='submit']"
    ,"button:has-text('Get in touch')"
    ,"button:has-text('Request')"
  ];

  const modalRoots = page.locator([
    "[role='dialog']:visible",
    "[aria-modal='true']:visible",
    ".modal:visible",
    "[class*='popup' i]:visible"
  ].join(", "));
  for (let rootIndex = 0; rootIndex < await modalRoots.count(); rootIndex++) {
    const root = modalRoots.nth(rootIndex);
    for (const selector of selectors) {
      const locator = root.locator(selector).first();
      if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) return locator;
    }
  }

  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
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

        if (src.toLowerCase().includes("calendly")) {
          return "iframe src contains calendly";
        }

        if (title.toLowerCase().includes("calendly")) {
          return "iframe title contains Calendly";
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
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const fileName = `${Date.now()}-${slugify(websiteUrl)}-${label}.png`;
  const absolutePath = path.join(SCREENSHOT_DIR, fileName);
  await page.screenshot({ path: absolutePath, fullPage: true });
  return `/screenshots/${fileName}`;
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
  timeoutMs = 30000,
  browserContext,
  skipPersist
}: SubmitContactFormInput & { browserContext?: BrowserContext; skipPersist?: boolean }): Promise<SubmitContactFormResult> {
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
        headless,
        executablePath: await getChromiumExecutablePath()
      });
      page = await browser.newPage({
        viewport: { width: 1366, height: 900 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
      });
    }
    page.setDefaultTimeout(timeoutMs);

    await page.goto(websiteUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

    let fillResult = await fillAllVisibleForms(page, leadData);
    // Exit-intent and delayed marketing forms can mount after the primary form
    // has already been filled. Scan again so both forms receive lead data.
    await page.waitForTimeout(750);
    const lateFillResult = await fillAllVisibleForms(page, leadData);
    fillResult = {
      filledFields: [...new Set([...fillResult.filledFields, ...lateFillResult.filledFields])],
      skippedFields: [...new Set([...fillResult.skippedFields, ...lateFillResult.skippedFields])]
        .filter((field) => !lateFillResult.filledFields.includes(field))
    };
    filledFields = fillResult.filledFields;
    skippedFields = fillResult.skippedFields;
    screenshotPath = await takeScreenshot(page, websiteUrl, "before-submit");

    const submitButton = await findSubmitButton(page);

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

    if (submit) {
      await submitButton.scrollIntoViewIfNeeded().catch(() => undefined);
      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 12000 }),
        submitButton.click({ timeout: 10000 })
      ]);
    }

    const success = submit ? await detectSuccess(page) : true;
    screenshotPath = await takeScreenshot(page, websiteUrl, submit ? "after-submit" : "dry-run");

    if (!success) {
      throw new Error("Submit clicked, but no success message or successful page response was detected.");
    }

    const result: SubmitContactFormResult = {
      websiteUrl,
      status: submit ? "success" : "dry_run_ready_to_book",
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
    const errorMessage = error instanceof Error ? error.message : "Unknown automation error.";

    if (page) {
      screenshotPath = await takeScreenshot(page, websiteUrl, "failure").catch(
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
