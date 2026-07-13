import fs from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  type Browser,
  type FrameLocator,
  type Locator,
  type Page
} from "playwright";

type CalendlyScope = Page | FrameLocator;
import { getChromiumExecutablePath } from "@/services/browser-executable";
import { prisma } from "@/lib/prisma";
import {
  LeadData,
  SubmitCalendlyBookingInput,
  SubmitContactFormResult
} from "@/types/automation";

const SCREENSHOT_DIR = path.join(process.cwd(), "public", "screenshots");
const DEMO_USER_EMAIL = "demo@lead-auto-submitter.local";

type CalendlyStatus = SubmitContactFormResult["status"];

function normalizeJobStatus(status: CalendlyStatus) {
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
        data: { websiteUrl: result.websiteUrl, status: "active" }
      })
    : await prisma.targetWebsite.create({
        data: {
          websiteName: new URL(result.websiteUrl).hostname,
          websiteUrl: result.websiteUrl,
          contactPageUrl: result.websiteUrl,
          status: "active",
          notes: "Created by Calendly booking automation",
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

async function findCalendlyFrame(page: Page) {
  const hostname = new URL(page.url()).hostname.toLowerCase();

  // Direct Calendly event pages render the scheduler in the main document.
  // Embedded widgets render it inside a Calendly iframe.
  if (hostname === "calendly.com" || hostname.endsWith(".calendly.com")) {
    return page;
  }

  const iframe = page
    .locator('iframe[src*="calendly" i], iframe[title*="Calendly" i]')
    .first();

  if ((await iframe.count()) === 0) {
    return null;
  }

  await iframe.waitFor({ state: "attached", timeout: 15000 });
  const frameElement = await iframe.elementHandle();
  const frame = await frameElement?.contentFrame();

  if (!frame) {
    return null;
  }

  return page.frameLocator('iframe[src*="calendly" i], iframe[title*="Calendly" i]').first();
}

async function waitForCalendlyLoaded(frame: CalendlyScope) {
  await frame
    .locator("body")
    .waitFor({ state: "visible", timeout: 30000 });
  await frame
    .locator("body")
    .getByText(/select a date|choose a time|schedule|book/i)
    .first()
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(() => undefined);
}

function getCandidateButtons(frame: CalendlyScope) {
  return frame.locator("button, [role='button']");
}

async function chooseDate(
  frame: CalendlyScope,
  preferredDate: string | undefined,
  fallbackToFirstAvailableSlot: boolean
) {
  const preferred = normalizePreference(preferredDate);
  const preferredDay = parseDayFromPreference(preferredDate);
  const buttons = getCandidateButtons(frame);
  const candidates = await buttons.evaluateAll((elements) =>
    elements
      .map((element, index) => {
        const button = element as HTMLButtonElement;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
        const ariaLabel = element.getAttribute("aria-label") ?? "";
        const className = element.getAttribute("class") ?? "";
        const disabled =
          button.disabled ||
          element.getAttribute("aria-disabled") === "true" ||
          element.getAttribute("disabled") !== null ||
          /\bdisabled\b|unavailable|past/i.test(`${ariaLabel} ${className}`);
        // Calendly's previous/next-month arrows sit inside the same calendar container,
        // so parent text is too broad and can make those controls look like dates.
        const hasDateSignal =
          /^\d{1,2}$/.test(text) ||
          /\b(available|select|choose)\b.*\b\d{1,2}\b/i.test(ariaLabel) ||
          /\b\d{1,2}\b.*\b(available|select|choose)\b/i.test(ariaLabel);
        const likelyAvailable =
          /\bavailable\b/i.test(`${ariaLabel} ${className}`) ||
          (!/\bunavailable\b/i.test(`${ariaLabel} ${className}`) &&
            !/\bdisabled\b/i.test(className));

        return {
          index,
          text,
          ariaLabel,
          disabled,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none",
          hasDateSignal,
          likelyAvailable
        };
      })
      .filter(
        (candidate) =>
          candidate.visible &&
          !candidate.disabled &&
          candidate.hasDateSignal &&
          candidate.likelyAvailable
      )
  );

  if (candidates.length === 0) {
    return null;
  }

  const preferredCandidate = preferred
    ? candidates.find((candidate) =>
        normalizePreference(`${candidate.ariaLabel} ${candidate.text}`).includes(preferred)
      ) ??
      candidates.find((candidate) =>
        preferredDay ? candidate.text.trim() === preferredDay : false
      )
    : undefined;
  const selected = preferredCandidate ?? (fallbackToFirstAvailableSlot ? candidates[0] : null);

  if (!selected) {
    return null;
  }

  await buttons.nth(selected.index).scrollIntoViewIfNeeded().catch(() => undefined);
  await buttons.nth(selected.index).click({ timeout: 10000 });

  return selected.ariaLabel || selected.text.trim();
}

async function chooseTime(
  frame: CalendlyScope,
  preferredTime: string | undefined,
  fallbackToFirstAvailableSlot: boolean
) {
  const preferred = normalizePreference(preferredTime);
  const buttons = getCandidateButtons(frame);
  await frame
    .locator("button, [role='button']")
    .filter({ hasText: /^\s*\d{1,2}(:\d{2})?\s?(am|pm)\s*$/i })
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() => undefined);
  const candidates = await buttons.evaluateAll((elements) =>
    elements
      .map((element, index) => {
        const button = element as HTMLButtonElement;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const text = element.textContent ?? "";
        const ariaLabel = element.getAttribute("aria-label") ?? "";
        const visibleText = text.replace(/\s+/g, " ").trim();
        const disabled =
          button.disabled ||
          element.getAttribute("aria-disabled") === "true" ||
          element.getAttribute("disabled") !== null;
        const hasTimeSignal =
          /^\d{1,2}(:\d{2})?\s?(am|pm)$/i.test(visibleText) ||
          /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i.test(ariaLabel);

        return {
          index,
          text: visibleText,
          ariaLabel,
          disabled,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none",
          hasTimeSignal
        };
      })
      .filter((candidate) => candidate.visible && !candidate.disabled && candidate.hasTimeSignal)
  );

  if (candidates.length === 0) {
    return null;
  }

  const preferredCandidate = preferred
    ? candidates.find((candidate) =>
        normalizePreference(`${candidate.ariaLabel} ${candidate.text}`).includes(preferred)
      )
    : undefined;
  const selected = preferredCandidate ?? (fallbackToFirstAvailableSlot ? candidates[0] : null);

  if (!selected) {
    return null;
  }

  const selectedLocator = frame
    .locator("button, [role='button']")
    .filter({ hasText: new RegExp(`^\\s*${escapeRegex(selected.text)}\\s*$`, "i") })
    .first();
  const clickTarget = (await selectedLocator.count()) > 0 ? selectedLocator : buttons.nth(selected.index);

  await clickTarget.scrollIntoViewIfNeeded().catch(() => undefined);
  await clickTarget.click({ timeout: 10000 }).catch(() => undefined);
  await sleep(700);

  if (!(await hasProgressButton(frame))) {
    await clickTarget.press("Enter", { timeout: 3000 }).catch(() => undefined);
    await sleep(700);
  }

  if (!(await hasProgressButton(frame))) {
    await clickTarget
      .evaluate((element) => (element as HTMLElement).click())
      .catch(() => undefined);
    await sleep(700);
  }

  return selected.text.trim() || selected.ariaLabel;
}

async function hasProgressButton(frame: CalendlyScope) {
  const button = frame.locator("button, [role='button']").filter({
    hasText: /next|continue|confirm/i
  }).first();

  return (await button.count()) > 0 && (await button.isVisible().catch(() => false));
}

async function clickProgressButton(frame: CalendlyScope, labels: RegExp) {
  const button = frame.locator("button, [role='button']").filter({ hasText: labels }).first();

  if ((await button.count()) > 0 && (await button.isVisible().catch(() => false))) {
    await button.scrollIntoViewIfNeeded().catch(() => undefined);
    await button.click({ timeout: 10000 }).catch(() => undefined);
    await sleep(700);
    await button.click({ timeout: 5000, force: true }).catch(() => undefined);
    await sleep(700);
    await button.press("Enter", { timeout: 3000 }).catch(() => undefined);
    await sleep(700);
    await button.evaluate((element) => (element as HTMLElement).click()).catch(() => undefined);
    return true;
  }

  return false;
}

async function inviteeFormVisible(frame: CalendlyScope) {
  const formFields = frame.locator(
    'input[type="email"], input[name*="name" i], input[aria-label*="Name" i], textarea'
  );

  await formFields.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
  return (await formFields.count()) > 0 && (await formFields.first().isVisible().catch(() => false));
}

async function fillFirstAvailable(locators: Locator[], value: string, lookupTimeoutMs = 700) {
  for (const locator of locators) {
    const first = locator.first();

    await first.waitFor({ state: "attached", timeout: lookupTimeoutMs }).catch(() => undefined);
    if ((await first.count().catch(() => 0)) === 0) continue;
    if (!(await first.isVisible().catch(() => false))) continue;
    if (!(await first.isEnabled().catch(() => false))) continue;

    await first.scrollIntoViewIfNeeded().catch(() => undefined);
    await first.fill("", { timeout: 3000 }).catch(() => undefined);
    await first.pressSequentially(value, { delay: 45, timeout: 10000 });
    return true;
  }

  return false;
}

async function fillCalendlyForm(frame: CalendlyScope, leadData: LeadData) {
  const filledFields: string[] = [];
  const skippedFields: string[] = [];
  const nameFilled = await fillFirstAvailable(
    [
      frame.locator('input[name*="name" i]'),
      frame.locator('input[aria-label*="Name" i]'),
      frame.locator('input[placeholder*="Name" i]')
    ],
    leadData.fullName
  );
  nameFilled ? filledFields.push("fullName") : skippedFields.push("fullName");

  const emailFilled = await fillFirstAvailable(
    [
      frame.locator('input[type="email"]'),
      frame.locator('input[name*="email" i]'),
      frame.locator('input[aria-label*="Email" i]')
    ],
    leadData.email
  );
  emailFilled ? filledFields.push("email") : skippedFields.push("email");

  const mobile = leadData.mobile ?? leadData.mobileNumber;
  if (mobile) {
    const phoneFilled = await fillFirstAvailable(
      [
        frame.locator('input[type="tel"]'),
        frame.locator('input[name*="phone" i]'),
        frame.locator('input[aria-label*="Phone" i]'),
        frame.locator('input[placeholder*="Phone" i]'),
        frame.locator('input[aria-label*="Mobile" i]')
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
        frame.locator('input[name*="company" i]'),
        frame.locator('input[aria-label*="Company" i]'),
        frame.locator('input[placeholder*="Company" i]'),
        frame.locator('input[aria-label*="Business" i]')
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
        frame.locator("textarea"),
        frame.locator('textarea[aria-label*="Message" i]'),
        frame.locator('textarea[placeholder*="Message" i]'),
        frame.locator('textarea[aria-label*="Question" i]')
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

async function confirmationFound(page: Page, frame: CalendlyScope) {
  await page.waitForTimeout(3000);

  if (page.url().includes("scheduled_events")) {
    return true;
  }

  const confirmationPattern =
    /you are scheduled|confirmed|a calendar invitation has been sent/i;
  const pageText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const frameText = await frame.locator("body").innerText({ timeout: 5000 }).catch(() => "");

  return confirmationPattern.test(`${pageText} ${frameText}`);
}

export async function submitCalendlyBooking({
  websiteUrl,
  leadData,
  bookingPreferences = {},
  liveSubmit = false,
  headless = true,
  timeoutMs = 45000
}: SubmitCalendlyBookingInput): Promise<SubmitContactFormResult> {
  let browser: Browser | null = null;
  let page: Page | null = null;
  const submittedAt = new Date();
  const screenshotPaths: string[] = [];
  let selectedDate: string | null = null;
  let selectedTime: string | null = null;
  let filledFields: string[] = [];
  let skippedFields: string[] = [];

  async function finish(status: CalendlyStatus, errorMessage: string | null) {
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

    await persistResult(result, leadData).catch(() => undefined);
    return result;
  }

  try {
    browser = await chromium.launch({
      headless,
      executablePath: await getChromiumExecutablePath()
    });
    page = await browser.newPage({
      viewport: { width: 1366, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    });
    page.setDefaultTimeout(timeoutMs);

    await page.goto(websiteUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

    const frame = await findCalendlyFrame(page);

    if (!frame) {
      return finish("iframe_not_accessible", "Calendly iframe could not be found or accessed.");
    }

    await waitForCalendlyLoaded(frame);
    screenshotPaths.push(await takeScreenshot(page, websiteUrl, "calendar-loaded"));

    selectedDate = await chooseDate(
      frame,
      bookingPreferences.preferredDate,
      bookingPreferences.fallbackToFirstAvailableSlot ?? true
    );

    if (!selectedDate) {
      return finish("no_available_slots", "No available Calendly date buttons were found.");
    }

    await page.waitForTimeout(1500);
    screenshotPaths.push(await takeScreenshot(page, websiteUrl, "date-selected"));

    selectedTime = await chooseTime(
      frame,
      bookingPreferences.preferredTime,
      bookingPreferences.fallbackToFirstAvailableSlot ?? true
    );

    if (!selectedTime) {
      return finish("no_available_slots", "No available Calendly time slots were found.");
    }

    await page.waitForTimeout(1000);
    screenshotPaths.push(await takeScreenshot(page, websiteUrl, "time-selected"));

    // Calendly currently has two booking layouts. Older layouts reveal a
    // Next/Continue button after the time is chosen; newer layouts navigate
    // directly to the invitee form. A progress button is therefore optional.
    let formVisible = await inviteeFormVisible(frame);

    if (!formVisible) {
      const didContinue = await clickProgressButton(frame, /next|continue|confirm/i);

      if (didContinue) {
        await page.waitForTimeout(2000);
        formVisible = await inviteeFormVisible(frame);
      }
    }

    if (!formVisible) {
      return finish(
        "confirmation_not_found",
        "Calendly time was selected, but neither the invitee form nor a usable Next/Continue step appeared."
      );
    }

    const fillResult = await fillCalendlyForm(frame, leadData);
    filledFields = fillResult.filledFields;
    skippedFields = fillResult.skippedFields;
    screenshotPaths.push(await takeScreenshot(page, websiteUrl, "form-filled"));

    if (!liveSubmit) {
      return finish("dry_run_ready_to_book", null);
    }

    const didClickFinal = await clickProgressButton(
      frame,
      /schedule event|confirm|schedule|book/i
    );

    if (!didClickFinal) {
      return finish("confirmation_not_found", "Final Schedule Event button was not found.");
    }

    if (!(await confirmationFound(page, frame))) {
      return finish("confirmation_not_found", "Final confirmation was not detected.");
    }

    return finish("success", null);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown Calendly error.";
    return finish("failed", errorMessage);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
