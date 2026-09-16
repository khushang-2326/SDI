import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Locator, type Page, type BrowserContext, type Frame } from "playwright";
import { getChromiumExecutablePath } from "@/services/browser-executable";

type BookingScope = Page | Frame;

function getCandidateScopes(page: Page): BookingScope[] {
  const frames = page.frames();
  return [page, ...frames.filter((f) => f !== page.mainFrame())];
}
import { prisma } from "@/lib/prisma";
import {
  LeadData,
  SubmitCalendlyBookingInput,
  SubmitContactFormResult
} from "@/types/automation";
import { dismissCookieBanners } from "./cookie-consent-helper";
import {
  isProxyAuthenticationFailure,
  ProxyAuthenticationError,
  PROXY_407_MESSAGE,
  redactProxyDetails
} from "@/services/proxy-helper";
import { detectUnsupportedVerification } from "@/services/verification-detector";

const SCREENSHOT_DIR = path.join(process.cwd(), "public", "screenshots");
const DEMO_USER_EMAIL = "demo@lead-auto-submitter.local";

type GenericBookingStatus = SubmitContactFormResult["status"];

function normalizeJobStatus(status: GenericBookingStatus) {
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

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] || fullName,
    lastName: parts.slice(1).join(" ")
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function takeScreenshot(page: Page, websiteUrl: string, label: string) {
  try {
    if (!page || page.isClosed()) return "";
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    const fileName = `${Date.now()}-${slugify(websiteUrl)}-${label}.png`;
    const absolutePath = path.join(SCREENSHOT_DIR, fileName);
    await page.screenshot({ path: absolutePath, fullPage: false, timeout: 8000, animations: "disabled" });
    return `/screenshots/${fileName}`;
  } catch (err) {
    return "";
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
          notes: "Created by generic booking widget automation",
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

async function scrollToBookingWidget(page: Page): Promise<{ found: boolean; activeScope: BookingScope }> {
  const scopes = getCandidateScopes(page);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    for (const scope of scopes) {
      const schedulerElements = scope.locator([
        ".widgets-step-1",
        ".label-select-date",
        ".vdpCell.selectable",
        "[class*='booking-calendar' i]",
        "[class*='scheduler' i]",
        "[data-testid*='calendar' i]",
        "[class*='calendar-grid' i]"
      ].join(", ")).first();

      if ((await schedulerElements.count().catch(() => 0)) > 0 && (await schedulerElements.isVisible().catch(() => false))) {
        await schedulerElements.scrollIntoViewIfNeeded().catch(() => undefined);
        return { found: true, activeScope: scope };
      }

      const dateControls = scope.locator("button, [role='button'], .vdpCell.selectable, [aria-label*='slot available' i], [data-date]");
      if (await dateControls.count().then((count) => count >= 2).catch(() => false)) {
        return { found: true, activeScope: scope };
      }

      const calendarIsPresent = await scope.locator("button, [role='button']")
        .filter({ hasText: /^\s*(?:today\s*)?\d{1,2}\s*(?:[a-z]+)?\s*$/i })
        .count()
        .then((count) => count >= 2)
        .catch(() => false);
      if (calendarIsPresent) return { found: true, activeScope: scope };
    }

    await page.mouse.wheel(0, 850).catch(() => undefined);
    await sleep(400);
  }

  return { found: false, activeScope: page };
}

async function collectDateCandidates(scope: BookingScope, preferredDate?: string) {
  const preferredDay = parseDayFromPreference(preferredDate);
  const candidates = await scope.locator("button, [role='button'], .vdpCell.selectable, [aria-label*='slot available' i], [data-date]").evaluateAll((buttons) =>
    buttons
      .map((button, index) => {
        const style = window.getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        const rawText = button.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const accessibleLabel = button.getAttribute("aria-label") ?? "";
        const dateLabel = `${accessibleLabel} ${rawText}`;
        const dayFirstMatch = dateLabel.match(
          /\b(\d{1,2})\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i
        );
        const monthFirstMatch = dateLabel.match(
          /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/i
        );
        const text = dayFirstMatch?.[1] ?? monthFirstMatch?.[1] ?? rawText.replace(/[^\d]/g, "").trim();
        const className = button.className.toString();
        const disabled =
          button.hasAttribute("disabled") ||
          button.getAttribute("aria-disabled") === "true" ||
          /disabled/i.test(className);

        return {
          index,
          text,
          className,
          disabled,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none"
        };
      })
      .filter((candidate) => /^\d{1,2}$/.test(candidate.text) && candidate.visible && !candidate.disabled)
  );
  const preferred = preferredDay
    ? candidates.filter((candidate) => candidate.text === preferredDay)
    : [];
  const likelyAvailable = candidates.filter(
    (candidate) => !/dTNYCq|rdp-button/i.test(candidate.className)
  );
  const ordered = [...preferred, ...likelyAvailable, ...candidates];
  const seen = new Set<number>();

  return ordered.filter((candidate) => {
    if (seen.has(candidate.index)) return false;
    seen.add(candidate.index);
    return true;
  });
}

async function visibleTimeSlotExists(scope: BookingScope) {
  const slot = scope.locator("button, [role='button'], a, .widgets-time-slot").filter({
    hasText: /\b\d{1,2}:\d{2}\s?(am|pm)\b/i
  }).first();

  return (await slot.waitFor({ state: "visible", timeout: 3500 }).then(() => true).catch(() => false));
}

async function chooseDate(scope: BookingScope, preferredDate?: string) {
  const deadline = Date.now() + 6000;
  let candidates: Awaited<ReturnType<typeof collectDateCandidates>> = [];
  while (Date.now() < deadline) {
    candidates = await collectDateCandidates(scope, preferredDate);
    if (candidates.length > 0) break;
    await sleep(400);
  }
  const buttons = scope.locator("button, [role='button'], .vdpCell.selectable, [aria-label*='slot available' i], [data-date]");

  for (const candidate of candidates.slice(0, 18)) {
    const button = buttons.nth(candidate.index);

    await button.scrollIntoViewIfNeeded().catch(() => undefined);
    await button.click({ timeout: 3000 }).catch(() => undefined);
    await sleep(900);

    if (await visibleTimeSlotExists(scope)) {
      return candidate.text;
    }
  }

  return null;
}

function roundPreferredTime(timeStr: string | undefined): string | undefined {
  if (!timeStr) return undefined;
  
  const match = timeStr.match(/^\s*(\d{1,2}):(\d{2})(?:\s*(am|pm))?\s*$/i);
  if (!match) return timeStr;

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  let ampm = match[3] ? match[3].toLowerCase() : "";

  if (minute < 30) {
    const minuteStr = "00";
    if (!ampm) {
      return `${hour}:${minuteStr}`;
    }
    return `${hour}:${minuteStr} ${ampm}`;
  } else {
    let nextHour = hour + 1;
    if (ampm) {
      if (hour === 11) {
        ampm = ampm === "am" ? "pm" : "am";
      } else if (nextHour > 12) {
        nextHour = 1;
      }
      return `${nextHour}:00 ${ampm}`;
    } else {
      if (nextHour >= 24) {
        nextHour = 0;
      }
      return `${nextHour}:00`;
    }
  }
}

function cleanTimeForComparison(val: string): string {
  return val.toLowerCase().replace(/[\s:.,-]/g, "");
}

async function chooseTime(scope: BookingScope, preferredTime?: string) {
  const rounded = roundPreferredTime(preferredTime);
  const cleanPreferred = rounded ? cleanTimeForComparison(rounded) : "";
  const cleanPreferredNoAmPm = cleanPreferred.replace(/am|pm/g, "");

  const timeButtons = scope.locator("button, [role='button'], a, .widgets-time-slot").filter({
    hasText: /\b\d{1,2}:\d{2}\s?(am|pm)\b/i
  });
  await timeButtons.first().waitFor({ state: "visible", timeout: 20000 }).catch(() => undefined);
  const candidates = await timeButtons.evaluateAll((buttons) =>
    buttons
      .map((button, index) => {
        const style = window.getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        const text = button.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const disabled =
          button.hasAttribute("disabled") ||
          button.getAttribute("aria-disabled") === "true" ||
          /disabled/i.test(button.className.toString());

        return {
          index,
          text,
          disabled,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none"
        };
      })
      .filter((candidate) => candidate.visible && !candidate.disabled)
  );
  const selected = cleanPreferred
    ? candidates.find((c) => cleanTimeForComparison(c.text).includes(cleanPreferred)) ??
      candidates.find((c) => cleanTimeForComparison(c.text).includes(cleanPreferredNoAmPm)) ??
      candidates[0]
    : candidates[0];

  if (!selected) return null;

  const selectedLocator = timeButtons.nth(selected.index);
  await selectedLocator.scrollIntoViewIfNeeded().catch(() => undefined);
  await selectedLocator.click({ timeout: 5000 }).catch(() => undefined);
  await sleep(900);
  return selected.text;
}

async function clickNextStep(scope: BookingScope) {
  const inviteeField = scope.locator([
    'input[type="email"]',
    'input[name*="email" i]',
    'input[placeholder*="email" i]',
    'input[name*="name" i]',
    'input[placeholder="Name" i]'
  ].join(", ")).first();
  if (await inviteeField.isVisible().catch(() => false)) return true;

  const button = scope.locator("button, [role='button']").filter({ hasText: /next step|next|continue|^select$/i }).first();

  await button.waitFor({ state: "visible", timeout: 20000 }).catch(() => undefined);
  if (!(await visibleEnabled(button))) return false;

  await button.scrollIntoViewIfNeeded().catch(() => undefined);
  await button.click({ timeout: 5000 }).catch(() => undefined);
  await sleep(1500);
  return true;
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

async function fillBookingForm(scope: BookingScope, leadData: LeadData) {
  const filledFields: string[] = [];
  const skippedFields: string[] = [];
  const { firstName, lastName } = splitName(leadData.fullName);

  const firstNameFilled = await fillFirstAvailable(
    [
      scope.locator('input[name*="first" i]'),
      scope.locator('input[placeholder*="First" i]'),
      scope.locator('input[aria-label*="First" i]'),
      scope.locator('input[name="name" i]'),
      scope.locator('input[name*="name" i]:not([type="email"])'),
      scope.locator('input[placeholder="Name" i]'),
      scope.locator('input[aria-label="Name" i]')
    ],
    lastName ? leadData.fullName : firstName
  );
  firstNameFilled ? filledFields.push("fullName") : skippedFields.push("fullName");

  if (lastName) {
    await fillFirstAvailable(
      [
        scope.locator('input[name*="surname" i]'),
        scope.locator('input[name*="last" i]'),
        scope.locator('input[placeholder*="Last" i]'),
        scope.locator('input[aria-label*="Last" i]')
      ],
      lastName,
      350
    );
  }

  const emailFilled = await fillFirstAvailable(
    [
      scope.locator('input[type="email"]'),
      scope.locator('input[name*="email" i]'),
      scope.locator('input[placeholder*="Email" i]')
    ],
    leadData.email
  );
  emailFilled ? filledFields.push("email") : skippedFields.push("email");

  if (leadData.companyName) {
    const companyFilled = await fillFirstAvailable(
      [
        scope.locator('input[name*="company" i]'),
        scope.locator('input[placeholder*="Company" i]'),
        scope.locator('input[aria-label*="Company" i]')
      ],
      leadData.companyName,
      350
    );
    companyFilled ? filledFields.push("companyName") : skippedFields.push("companyName");
  }

  const mobile = leadData.mobile ?? leadData.mobileNumber;
  if (mobile) {
    const phoneFilled = await fillFirstAvailable(
      [
        scope.locator('input[type="tel"]'),
        scope.locator('input[name*="phone" i]'),
        scope.locator('input[placeholder*="Phone" i]')
      ],
      mobile,
      350
    );
    phoneFilled ? filledFields.push("mobile") : skippedFields.push("mobile");
  } else {
    skippedFields.push("mobile");
  }

  const message = [leadData.companyName, leadData.message, leadData.address ? `Address: ${leadData.address}` : null]
    .filter(Boolean)
    .join("\n");

  if (message) {
    const messageFilled = await fillFirstAvailable(
      [scope.locator("textarea"), scope.locator('input[name*="message" i]')],
      message,
      350
    );
    messageFilled ? filledFields.push("message") : skippedFields.push("message");
  } else {
    skippedFields.push("message");
  }

  return { filledFields, skippedFields };
}

async function clickFinalSubmit(scope: BookingScope) {
  const button = scope.locator("button, [role='button']").filter({ hasText: /submit|schedule|book|confirm/i }).first();

  if (!(await visibleEnabled(button))) return false;

  await button.scrollIntoViewIfNeeded().catch(() => undefined);
  await button.click({ timeout: 6000 });
  return true;
}

async function confirmationFound(page: Page, scope?: BookingScope) {
  await page.waitForTimeout(2500);
  const pageBodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const scopeBodyText = scope && scope !== page ? await scope.locator("body").innerText({ timeout: 3000 }).catch(() => "") : "";
  const combined = `${pageBodyText} ${scopeBodyText}`;
  return /confirmed|booking confirmed|thank you|scheduled|submitted/i.test(combined);
}

export async function submitGenericBookingWidget({
  websiteUrl,
  leadData,
  bookingPreferences = {},
  liveSubmit = false,
  headless = true,
  timeoutMs = 45000,
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
  let bookingProvider: string | null = "generic_scheduler";
  let bookingContainerDetected = false;
  let interactiveCalendarDetected = false;
  let bookingState: "BOOKING_PROVIDER_FOUND" | "BOOKING_CONTAINER_MOUNTING" | "BOOKING_READY" | "BOOKING_NO_INVENTORY" | "BOOKING_BLOCKED" | "BOOKING_FAILED" = "BOOKING_PROVIDER_FOUND";
  let availableSlotState: "available" | "none" | "unmounted" | "blocked" = "unmounted";
  let requiredInteractionState: "ready" | "pending" | "failed" = "pending";

  async function finish(status: GenericBookingStatus, errorMessage: string | null) {
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
      selectedTime,
      bookingProvider,
      bookingContainerDetected,
      bookingState,
      interactiveCalendarDetected,
      availableSlotState,
      requiredInteractionState
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
    page.setDefaultTimeout(timeoutMs);

    let proxy407Hit = false;
    const responseHandler = (res: any) => {
      if (res.status() === 407) proxy407Hit = true;
    };
    page.on("response", responseHandler);

    let navResponse: any = null;
    let navError: any = null;
    try {
      navResponse = await page.goto(websiteUrl, { waitUntil: "commit", timeout: timeoutMs });
    } catch (err: any) {
      navError = err;
    } finally {
      page.off("response", responseHandler);
    }

    if (proxy407Hit || isProxyAuthenticationFailure(navError) || navResponse?.status() === 407) {
      throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
    }

    const verification = await detectUnsupportedVerification(page, websiteUrl);
    if (verification) {
      if (verification.screenshotPath) screenshotPaths.push(verification.screenshotPath);
      return finish("failed", verification.reason);
    }

    await dismissCookieBanners(page).catch(() => undefined);
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => undefined);
    await dismissCookieBanners(page).catch(() => undefined);
    // Third-party schedulers hydrate after document load.
    // Use a bounded polling window (8 seconds) rather than stalling the worker.
    const widgetDeadline = Date.now() + Math.min(timeoutMs, 8000);
    let widgetFound = false;
    let activeScope: BookingScope = page;
    while (Date.now() < widgetDeadline) {
      const res = await scrollToBookingWidget(page);
      if (res.found) {
        widgetFound = true;
        activeScope = res.activeScope;
        break;
      }
      await page.waitForTimeout(400);
    }

    if (!widgetFound) {
      return finish("booking_widget_found", "Booking widget source was found, but it did not render on the page.");
    }

    screenshotPaths.push(await takeScreenshot(page, websiteUrl, "generic-booking-loaded"));

    selectedDate = await chooseDate(activeScope, bookingPreferences.preferredDate);

    if (!selectedDate) {
      return finish("no_available_slots", "No date with available time slots was found.");
    }

    screenshotPaths.push(await takeScreenshot(page, websiteUrl, "generic-booking-date-selected"));

    selectedTime = await chooseTime(activeScope, bookingPreferences.preferredTime);

    if (!selectedTime) {
      return finish("no_available_slots", "No available time slots were found.");
    }

    screenshotPaths.push(await takeScreenshot(page, websiteUrl, "generic-booking-time-selected"));

    if (!(await clickNextStep(activeScope))) {
      return finish("confirmation_not_found", "Next step button was not found after selecting a time.");
    }

    await activeScope
      .locator('input[type="email"], input[name*="first" i], input[placeholder*="First" i]')
      .first()
      .waitFor({ state: "visible", timeout: 25000 })
      .catch(() => undefined);

    const fillResult = await fillBookingForm(activeScope, leadData);
    filledFields = fillResult.filledFields;
    skippedFields = fillResult.skippedFields;
    screenshotPaths.push(await takeScreenshot(page, websiteUrl, "generic-booking-form-filled"));

    if (!liveSubmit) {
      return finish("dry_run_ready_to_book", null);
    }

    const didClickFinal = await clickFinalSubmit(activeScope);

    if (!didClickFinal) {
      return finish("confirmation_not_found", "Final submit button was not found.");
    }

    if (!(await confirmationFound(page, activeScope))) {
      return finish("confirmation_not_found", "Final confirmation was not detected.");
    }

    return finish("success", null);
  } catch (error) {
    if (isProxyAuthenticationFailure(error)) {
      throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
    }
    const errorMessage = redactProxyDetails(error instanceof Error ? error.message : "Unknown booking widget error.");
    return finish("failed", errorMessage);
  } finally {
    if (page && browserContext) {
      await page.close().catch(() => undefined);
    } else {
      await browser?.close().catch(() => undefined);
    }
  }
}
