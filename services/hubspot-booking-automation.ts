import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Locator, type Page, type BrowserContext } from "playwright";
import { getChromiumExecutablePath } from "@/services/browser-executable";
import { prisma } from "@/lib/prisma";
import {
  LeadData,
  SubmitCalendlyBookingInput,
  SubmitContactFormResult
} from "@/types/automation";

const SCREENSHOT_DIR = path.join(process.cwd(), "public", "screenshots");
const DEMO_USER_EMAIL = "demo@lead-auto-submitter.local";

type HubSpotStatus = SubmitContactFormResult["status"];

function normalizeJobStatus(status: HubSpotStatus) {
  if (status === "success") return "Success";
  if (status === "dry_run_ready_to_book") return "Pending";
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

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizePreference(value?: string) {
  return normalizeText(value ?? "").replace(/[,.-]/g, "");
}

function parseDayFromPreference(value?: string) {
  const match = value?.match(/\b([1-9]|[12]\d|3[01])\b/);
  return match?.[1] ?? "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function takeScreenshot(page: Page, websiteUrl: string, label: string) {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const fileName = `${Date.now()}-${slugify(websiteUrl)}-${label}.png`;
  const absolutePath = path.join(SCREENSHOT_DIR, fileName);
  await page.screenshot({ path: absolutePath, fullPage: false });
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
        data: {
          websiteUrl: result.websiteUrl,
          status: "active",
          notes: "HubSpot meetings booking automation"
        }
      })
    : await prisma.targetWebsite.create({
        data: {
          websiteName: new URL(result.websiteUrl).hostname,
          websiteUrl: result.websiteUrl,
          contactPageUrl: result.websiteUrl,
          status: "active",
          notes: "Created by HubSpot meetings booking automation",
          userId: user.id
        }
      });
  const job = await prisma.submissionJob.create({
    data: {
      status: normalizeJobStatus(result.status),
      startedAt: result.submittedAt,
      completedAt: new Date(),
      userId: user.id,
      leadId: lead.id
    }
  });

  await prisma.submissionResult.create({
    data: {
      status: result.status,
      message: [
        result.errorMessage,
        result.selectedDate ? `date=${result.selectedDate}` : null,
        result.selectedTime ? `time=${result.selectedTime}` : null
      ]
        .filter(Boolean)
        .join("; "),
      screenshotPath: result.screenshotPath,
      submittedAt: result.submittedAt,
      jobId: job.id,
      leadId: lead.id,
      targetWebsiteId: targetWebsite.id
    }
  });
}

async function visibleEnabled(locator: Locator) {
  return (
    (await locator.count().catch(() => 0)) > 0 &&
    (await locator.isVisible().catch(() => false)) &&
    (await locator.isEnabled().catch(() => false))
  );
}

async function chooseDate(page: Page, preferredDate?: string) {
  const preferredDay = parseDayFromPreference(preferredDate);
  const dateButtons = page.locator("button").filter({ hasText: /^\s*\d{1,2}\s*$/ });
  const candidates = await dateButtons.evaluateAll((buttons) =>
    buttons
      .map((button, index) => {
        const style = window.getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        const disabled =
          button.hasAttribute("disabled") ||
          button.getAttribute("aria-disabled") === "true" ||
          button.className.toString().toLowerCase().includes("disabled");

        return {
          index,
          text: button.textContent?.trim() ?? "",
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none",
          disabled
        };
      })
      .filter((candidate) => candidate.visible && !candidate.disabled)
  );

  const selected =
    candidates.find((candidate) => preferredDay && candidate.text === preferredDay) ??
    candidates[0];

  if (!selected) return null;

  const selectedLocator = dateButtons.nth(selected.index);
  await selectedLocator.scrollIntoViewIfNeeded().catch(() => undefined);
  await selectedLocator.click({ timeout: 4000 }).catch(() => undefined);
  await sleep(700);
  return selected.text;
}

async function chooseTime(page: Page, preferredTime?: string) {
  const preferred = normalizePreference(preferredTime);
  const timeButtons = page.locator("button, [role='button'], [role='checkbox'], a").filter({
    hasText: /\b\d{1,2}:\d{2}\s?(am|pm)\b/i
  });
  await timeButtons.first().waitFor({ state: "visible", timeout: 12000 }).catch(() => undefined);
  const candidates = await timeButtons.evaluateAll((buttons) =>
    buttons
      .map((button, index) => {
        const style = window.getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        const text = button.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const disabled =
          button.hasAttribute("disabled") ||
          button.getAttribute("aria-disabled") === "true" ||
          button.className.toString().toLowerCase().includes("disabled");

        return {
          index,
          text,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none",
          disabled
        };
      })
      .filter((candidate) => candidate.visible && !candidate.disabled)
  );

  const selected =
    candidates.find((candidate) => preferred && normalizePreference(candidate.text).includes(preferred)) ??
    candidates[0];

  if (!selected) return null;

  const selectedLocator = timeButtons.nth(selected.index);
  await selectedLocator.scrollIntoViewIfNeeded().catch(() => undefined);
  await selectedLocator.click({ timeout: 5000 }).catch(() => undefined);
  await sleep(1200);
  return selected.text;
}

async function fillFirstAvailable(locators: Locator[], value: string, lookupTimeoutMs = 600) {
  for (const locator of locators) {
    const first = locator.first();

    await first.waitFor({ state: "attached", timeout: lookupTimeoutMs }).catch(() => undefined);
    if (!(await visibleEnabled(first))) continue;

    await first.scrollIntoViewIfNeeded().catch(() => undefined);
    await first.click({ timeout: 1500 }).catch(() => undefined);
    await first.fill("", { timeout: 1500 }).catch(() => undefined);
    await first.pressSequentially(value, { delay: 35, timeout: 7000 });
    return true;
  }

  return false;
}

async function fillHubSpotForm(page: Page, leadData: LeadData) {
  const filledFields: string[] = [];
  const skippedFields: string[] = [];
  const [firstName, ...lastNameParts] = leadData.fullName.trim().split(/\s+/);
  const lastName = lastNameParts.join(" ");

  const firstNameFilled = await fillFirstAvailable(
    [
      page.locator('input[name*="first" i]'),
      page.locator('input[aria-label*="First" i]'),
      page.locator('input[placeholder*="First" i]')
    ],
    firstName || leadData.fullName
  );
  const fullNameFilled = firstNameFilled
    ? true
    : await fillFirstAvailable(
        [
          page.locator('input[name*="name" i]'),
          page.locator('input[aria-label*="Name" i]'),
          page.locator('input[placeholder*="Name" i]')
        ],
        leadData.fullName
      );

  if (firstNameFilled && lastName) {
    await fillFirstAvailable(
      [
        page.locator('input[name*="last" i]'),
        page.locator('input[aria-label*="Last" i]'),
        page.locator('input[placeholder*="Last" i]')
      ],
      lastName,
      350
    );
  }

  fullNameFilled ? filledFields.push("fullName") : skippedFields.push("fullName");

  const emailFilled = await fillFirstAvailable(
    [
      page.locator('input[type="email"]'),
      page.locator('input[name*="email" i]'),
      page.locator('input[aria-label*="Email" i]')
    ],
    leadData.email
  );
  emailFilled ? filledFields.push("email") : skippedFields.push("email");

  const mobile = leadData.mobile ?? leadData.mobileNumber;
  if (mobile) {
    const phoneFilled = await fillFirstAvailable(
      [
        page.locator('input[type="tel"]'),
        page.locator('input[name*="phone" i]'),
        page.locator('input[aria-label*="Phone" i]'),
        page.locator('input[placeholder*="Phone" i]')
      ],
      mobile,
      350
    );
    phoneFilled ? filledFields.push("mobile") : skippedFields.push("mobile");
  } else {
    skippedFields.push("mobile");
  }

  if (leadData.companyName) {
    const companyFilled = await fillFirstAvailable(
      [
        page.locator('input[name*="company" i]'),
        page.locator('input[aria-label*="Company" i]'),
        page.locator('input[placeholder*="Company" i]')
      ],
      leadData.companyName,
      350
    );
    companyFilled ? filledFields.push("companyName") : skippedFields.push("companyName");
  }

  const message = [leadData.message, leadData.address ? `Address: ${leadData.address}` : null]
    .filter(Boolean)
    .join("\n");

  if (message) {
    const messageFilled = await fillFirstAvailable(
      [
        page.locator("textarea"),
        page.locator('textarea[aria-label*="Message" i]'),
        page.locator('textarea[placeholder*="Message" i]'),
        page.locator('input[name*="message" i]')
      ],
      message,
      350
    );
    messageFilled ? filledFields.push("message") : skippedFields.push("message");
  } else {
    skippedFields.push("message");
  }

  return { filledFields, skippedFields };
}

async function clickScheduleButton(page: Page) {
  const button = page.locator("button, [role='button']").filter({
    hasText: /schedule|book|confirm|submit/i
  }).first();

  if (!(await visibleEnabled(button))) return false;

  await button.scrollIntoViewIfNeeded().catch(() => undefined);
  await button.click({ timeout: 6000 });
  return true;
}

async function confirmationFound(page: Page) {
  await page.waitForTimeout(2500);

  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return /booked|confirmed|scheduled|you are scheduled|invitation/i.test(bodyText);
}

export async function submitHubSpotBooking({
  websiteUrl,
  leadData,
  bookingPreferences = {},
  liveSubmit = false,
  headless = true,
  timeoutMs = 35000,
  browserContext,
  skipPersist
}: SubmitCalendlyBookingInput & { browserContext?: BrowserContext; skipPersist?: boolean }): Promise<SubmitContactFormResult> {
  let browser: Browser | null = null;
  let page: Page | null = null;
  const submittedAt = new Date();
  const screenshotPaths: string[] = [];
  let selectedDate: string | null = null;
  let selectedTime: string | null = null;
  let filledFields: string[] = [];
  let skippedFields: string[] = [];

  async function finish(status: HubSpotStatus, errorMessage: string | null) {
    const screenshotPath = page
      ? await takeScreenshot(page, websiteUrl, status).catch(() => screenshotPaths.at(-1) ?? null)
      : screenshotPaths.at(-1) ?? null;

    if (screenshotPath && !screenshotPaths.includes(screenshotPath)) {
      screenshotPaths.push(screenshotPath);
    }

    const result: SubmitContactFormResult = {
      websiteUrl,
      status,
      errorMessage,
      screenshotPath,
      submittedAt,
      filledFields,
      skippedFields,
      screenshotPaths,
      selectedDate,
      selectedTime
    };

    if (!skipPersist) {
      await persistResult(result, leadData).catch(() => undefined);
    }
    return result;
  }

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

    await page.goto(websiteUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
    await page.locator("body").waitFor({ state: "visible", timeout: 12000 });
    screenshotPaths.push(await takeScreenshot(page, websiteUrl, "hubspot-loaded"));

    selectedDate = await chooseDate(page, bookingPreferences.preferredDate);
    screenshotPaths.push(await takeScreenshot(page, websiteUrl, "hubspot-date-selected"));

    selectedTime = await chooseTime(page, bookingPreferences.preferredTime);

    if (!selectedTime) {
      return finish("no_available_slots", "No available HubSpot time slots were found.");
    }

    screenshotPaths.push(await takeScreenshot(page, websiteUrl, "hubspot-time-selected"));

    await page
      .locator('input[type="email"], input[name*="email" i], input[name*="first" i]')
      .first()
      .waitFor({ state: "visible", timeout: 15000 })
      .catch(() => undefined);

    const fillResult = await fillHubSpotForm(page, leadData);
    filledFields = fillResult.filledFields;
    skippedFields = fillResult.skippedFields;
    screenshotPaths.push(await takeScreenshot(page, websiteUrl, "hubspot-form-filled"));

    if (!liveSubmit) {
      return finish("dry_run_ready_to_book", null);
    }

    const didClickFinal = await clickScheduleButton(page);

    if (!didClickFinal) {
      return finish("confirmation_not_found", "Final HubSpot schedule button was not found.");
    }

    if (!(await confirmationFound(page))) {
      return finish("confirmation_not_found", "Final HubSpot confirmation was not detected.");
    }

    return finish("success", null);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown HubSpot error.";
    return finish("failed", errorMessage);
  } finally {
    if (page && browserContext) {
      await page.close().catch(() => undefined);
    } else {
      await browser?.close().catch(() => undefined);
    }
  }
}
