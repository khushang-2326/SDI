import fs from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  type Browser,
  type Frame,
  type Locator,
  type Page,
  type BrowserContext
} from "playwright";
import { dismissCookieBanners } from "./cookie-consent-helper";

type CalendlyScope = Page | Frame;
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

async function takeScreenshot(page: Page, websiteUrl: string, label: string) {
  try {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    const fileName = `${Date.now()}-${slugify(websiteUrl)}-${label}.png`;
    const absolutePath = path.join(SCREENSHOT_DIR, fileName);
    await page.screenshot({ path: absolutePath, fullPage: false, timeout: 8000, animations: "disabled" });
    return `/screenshots/${fileName}`;
  } catch (err) {
    console.warn("Screenshot capture skipped:", err);
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

async function findCalendlyFrame(page: Page): Promise<CalendlyScope | null> {
  const hostname = new URL(page.url()).hostname.toLowerCase();

  // Direct Calendly event pages render the scheduler in the main document.
  if (hostname === "calendly.com" || hostname.endsWith(".calendly.com")) {
    return page;
  }

  const iframe = page
    .locator('iframe[src*="calendly" i], iframe[title*="Calendly" i]')
    .first();

  await iframe.waitFor({ state: "attached", timeout: 15000 }).catch(() => undefined);
  if ((await iframe.count()) === 0) {
    const calFrame = page.frames().find((f) => f.url().includes("calendly.com"));
    return calFrame ?? null;
  }

  await iframe.scrollIntoViewIfNeeded().catch(() => undefined);
  const frameElement = await iframe.elementHandle();
  const frame = await frameElement?.contentFrame();

  if (frame) {
    return frame;
  }

  const calFrame = page.frames().find((f) => f.url().includes("calendly.com"));
  return calFrame ?? null;
}

async function waitForCalendlyLoaded(frame: CalendlyScope) {
  await frame.locator("body").waitFor({ state: "visible", timeout: 25000 }).catch(() => undefined);
  const availableDate = frame
    .locator(
      'button[class*="bookable" i], button[aria-label*="available" i], button[aria-label*="disponible" i], button[aria-label*="verfügbar" i], button[data-testid*="day" i], [data-testid*="calendar" i], [role="grid"]'
    )
    .first();
  const schedulerText = frame
    .locator("body")
    .getByText(/select a date|choose a time|schedule|book|seleccione|elija|hora|fecha|reunión|agendar|termin|datum|horarios/i)
    .first();
  await Promise.race([
    availableDate.waitFor({ state: "visible", timeout: 18000 }),
    schedulerText.waitFor({ state: "visible", timeout: 18000 })
  ]).catch(() => undefined);
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
  
  // Wait for calendar grid or bookable day buttons (avoid waiting on disabled/unavailable buttons)
  await frame
    .locator(
      'button[class*="bookable" i], [role="grid"], [data-testid*="calendar" i], [class*="calendar" i]'
    )
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() => undefined);

  let candidates: {
    index: number;
    text: string;
    ariaLabel: string;
    disabled: boolean;
    visible: boolean;
    hasDateSignal: boolean;
    likelyAvailable: boolean;
  }[] = [];

  for (let attempt = 0; attempt < 8; attempt++) {
    const buttons = getCandidateButtons(frame);
    candidates = await buttons.evaluateAll((elements) =>
      elements
        .map((element, index) => {
          const button = element as HTMLButtonElement;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
          const ariaLabel = element.getAttribute("aria-label") ?? "";
          const className = element.getAttribute("class") ?? "";
          const dataTestId = element.getAttribute("data-testid") ?? "";
          const disabled =
            button.disabled ||
            element.getAttribute("aria-disabled") === "true" ||
            element.getAttribute("disabled") !== null ||
            /\bdisabled\b|unavailable|past|no-disponible|sin-horas/i.test(`${ariaLabel} ${className}`);

          // Calendly's previous/next-month arrows sit inside the same calendar container,
          // so check that text is a day number or ariaLabel indicates a date.
          const hasDateSignal =
            /^\d{1,2}$/.test(text) ||
            /\b(available|select|choose|disponible|seleccione|elija|verfügbar)\b.*\b\d{1,2}\b/i.test(ariaLabel) ||
            /\b\d{1,2}\b.*\b(available|select|choose|disponible|seleccione|elija|verfügbar)\b/i.test(ariaLabel) ||
            element.hasAttribute("data-date") ||
            /calendar-day/i.test(className) ||
            /day/i.test(dataTestId);

          const availabilityText = `${ariaLabel} ${className} ${dataTestId}`;
          const explicitlyUnavailable =
            /\b(no\s+times?\s+available|no\s+hay\s+horas|unavailable|no\s+disponible|sin\s+horas\s+disponibles|nicht\s+verfügbar|pas\s+disponible)\b/i.test(
              availabilityText
            );
          const likelyAvailable =
            !explicitlyUnavailable &&
            (/\b(times?\s+available|horas\s+disponibles|disponible|verfügbar|disponível|available)\b/i.test(
              availabilityText
            ) ||
              /bookable/i.test(className) ||
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

    if (candidates.length > 0) {
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

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

  const bookableBtn = frame
    .locator('button[class*="bookable" i]')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegex(selected.text)}\\s*$`) })
    .first();

  if ((await bookableBtn.count().catch(() => 0)) > 0) {
    await bookableBtn.scrollIntoViewIfNeeded().catch(() => undefined);
    await bookableBtn.evaluate((el) => (el as HTMLElement).click()).catch(() => undefined);
  } else if (selected.ariaLabel) {
    const ariaBtn = frame.locator(`button[aria-label="${selected.ariaLabel}"]`).first();
    if ((await ariaBtn.count().catch(() => 0)) > 0) {
      await ariaBtn.scrollIntoViewIfNeeded().catch(() => undefined);
      await ariaBtn.evaluate((el) => (el as HTMLElement).click()).catch(() => undefined);
    } else {
      const fallbackBtn = frame.locator("button, [role='button']").nth(selected.index);
      await fallbackBtn.scrollIntoViewIfNeeded().catch(() => undefined);
      await fallbackBtn.evaluate((el) => (el as HTMLElement).click()).catch(() => undefined);
    }
  } else {
    const fallbackBtn = frame.locator("button, [role='button']").nth(selected.index);
    await fallbackBtn.scrollIntoViewIfNeeded().catch(() => undefined);
    await fallbackBtn.evaluate((el) => (el as HTMLElement).click()).catch(() => undefined);
  }

  // Wait 1.5s for Calendly to fetch and mount time slots
  await new Promise((r) => setTimeout(r, 1500));

  return selected.ariaLabel || selected.text.trim();
}

function roundPreferredTime(timeStr: string | undefined): string | undefined {
  if (!timeStr) return undefined;
  
  const match = timeStr.match(/^\s*(\d{1,2}):(\d{2})(?:\s*([ap]\.?\s*m\.?))?\s*$/i);
  if (!match) return timeStr;

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  let ampmRaw = match[3] ? match[3].toLowerCase().replace(/\s|\./g, "") : "";

  if (minute < 30) {
    const minuteStr = "00";
    if (!ampmRaw) {
      return `${hour}:${minuteStr}`;
    }
    return `${hour}:${minuteStr} ${ampmRaw}`;
  } else {
    let nextHour = hour + 1;
    if (ampmRaw) {
      if (hour === 11) {
        ampmRaw = ampmRaw === "am" ? "pm" : "am";
      } else if (nextHour > 12) {
        nextHour = 1;
      }
      return `${nextHour}:00 ${ampmRaw}`;
    } else {
      if (nextHour >= 24) {
        nextHour = 0;
      }
      return `${nextHour}:00`;
    }
  }
}

function cleanTimeForComparison(val: string): string {
  return val
    .toLowerCase()
    .replace(/a\.\s*m\./g, "am")
    .replace(/p\.\s*m\./g, "pm")
    .replace(/[\s:.,-]/g, "");
}

async function chooseTime(
  frame: CalendlyScope,
  preferredTime: string | undefined,
  fallbackToFirstAvailableSlot: boolean
) {
  const rounded = roundPreferredTime(preferredTime);
  const cleanPreferred = rounded ? cleanTimeForComparison(rounded) : "";
  const cleanPreferredNoAmPm = cleanPreferred.replace(/am|pm/g, "");

  // Wait specifically for Calendly time-button elements to mount
  await frame
    .locator('button[class*="time-button" i], button[data-testid*="time" i]')
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() => undefined);

  let candidates: {
    index: number;
    text: string;
    ariaLabel: string;
    disabled: boolean;
    visible: boolean;
    hasTimeSignal: boolean;
  }[] = [];

  // Poll for up to 10 attempts (10s) to ensure dynamic API response renders slot buttons
  for (let attempt = 0; attempt < 10; attempt++) {
    const timeButtons = frame.locator('button[class*="time-button" i], button[data-testid*="time" i], button, [role="button"]');
    candidates = await timeButtons.evaluateAll((elements) =>
      elements
        .map((element, index) => {
          const button = element as HTMLButtonElement;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const text = element.textContent ?? "";
          const ariaLabel = element.getAttribute("aria-label") ?? "";
          const className = element.getAttribute("class") ?? "";
          const visibleText = text.replace(/\s+/g, " ").trim();
          const disabled =
            button.disabled ||
            element.getAttribute("aria-disabled") === "true" ||
            element.getAttribute("disabled") !== null;

          const isTimezoneOrNavigation =
            /\b(timezone|zona\s*horaria|hora\s*est[aá]ndar|time\s*zone|gmt|utc|anterior|previous|back)\b/i.test(
              `${visibleText} ${ariaLabel} ${className}`
            ) || /dropdown|select-button|nav|pagination/i.test(className);

          const isExplicitTimeButton = /time-button|time_button|time-slot|timeSlot/i.test(className);

          const hasTimeSignal =
            !isTimezoneOrNavigation &&
            (isExplicitTimeButton ||
              /\b\d{1,2}:\d{2}(\s*([ap]\.?\s*m\.?|hrs?|h))?\b/i.test(visibleText) ||
              /\b\d{1,2}(:\d{2})?\s*([ap]\.?\s*m\.?|hrs?|h)\b/i.test(ariaLabel));

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

    if (candidates.length > 0) {
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (candidates.length === 0) {
    return null;
  }

  const preferredCandidate = cleanPreferred
    ? candidates.find((c) =>
        cleanTimeForComparison(`${c.ariaLabel} ${c.text}`).includes(cleanPreferred)
      ) ??
      candidates.find((c) =>
        cleanTimeForComparison(`${c.ariaLabel} ${c.text}`).includes(cleanPreferredNoAmPm)
      )
    : undefined;
  const selected = preferredCandidate ?? (fallbackToFirstAvailableSlot ? candidates[0] : null);

  if (!selected) {
    return null;
  }

  const timeSlotBtn = frame
    .locator('button[class*="time-button" i], button, [role="button"]')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegex(selected.text)}\\s*$`, "i") })
    .filter({ hasNotText: /zona\s*horaria|hora\s*est[aá]ndar|timezone/i })
    .first();

  if ((await timeSlotBtn.count().catch(() => 0)) > 0) {
    await timeSlotBtn.scrollIntoViewIfNeeded().catch(() => undefined);
    await timeSlotBtn.evaluate((el) => (el as HTMLElement).click()).catch(() => undefined);
  } else {
    const fallbackBtn = frame.locator("button, [role='button']").nth(selected.index);
    await fallbackBtn.scrollIntoViewIfNeeded().catch(() => undefined);
    await fallbackBtn.evaluate((el) => (el as HTMLElement).click()).catch(() => undefined);
  }

  // After selecting a time, check if Calendly immediately revealed a "Next / Siguiente / Confirm" button
  await new Promise((r) => setTimeout(r, 600));
  const inlineNext = frame
    .locator("button, [role='button']")
    .filter({ hasText: /siguiente|next|continue|confirm|avanzar|confirmar/i })
    .first();

  if ((await inlineNext.count().catch(() => 0)) > 0 && (await inlineNext.isVisible().catch(() => false))) {
    await inlineNext.scrollIntoViewIfNeeded().catch(() => undefined);
    await inlineNext.evaluate((el) => (el as HTMLElement).click()).catch(() => undefined);
  }

  return selected.text.trim() || selected.ariaLabel;
}

async function clickProgressButton(frame: CalendlyScope, pattern: RegExp) {
  const matchingButtons = frame.locator("button, [role='button']").filter({ hasText: pattern });
  const count = await matchingButtons.count();

  for (let index = 0; index < count; index++) {
    const button = matchingButtons.nth(index);

    if (!(await button.isVisible().catch(() => false))) continue;
    if (!(await button.isEnabled().catch(() => false))) continue;

    await button.scrollIntoViewIfNeeded().catch(() => undefined);
    try {
      await button.click({ timeout: 10000 });
    } catch {
      await button.click({ timeout: 3000, force: true }).catch(async () => {
        await button.press("Enter", { timeout: 3000 }).catch(() => undefined);
      });
    }
    return true;
  }

  return false;
}

async function inviteeFormVisible(frame: CalendlyScope) {
  const formFields = frame.locator(
    'input[type="email"], input[name*="name" i], input[id*="name" i], input[aria-label*="Name" i], input[aria-label*="Nombre" i], textarea'
  );

  return (await formFields.count()) > 0 && (await formFields.first().isVisible().catch(() => false));
}

async function waitForInviteeForm(frame: CalendlyScope, timeout = 10000) {
  const formFields = frame.locator(
    'input[type="email"], input[name*="name" i], input[id*="name" i], input[aria-label*="Name" i], input[aria-label*="Nombre" i], textarea'
  );
  await formFields.first().waitFor({ state: "visible", timeout }).catch(() => undefined);
  return inviteeFormVisible(frame);
}

async function fillFirstAvailable(locators: Locator[], value: string, lookupTimeoutMs = 700) {
  for (const locator of locators) {
    const first = locator.first();

    await first.waitFor({ state: "attached", timeout: lookupTimeoutMs }).catch(() => undefined);
    if ((await first.count().catch(() => 0)) === 0) continue;
    if (!(await first.isVisible().catch(() => false))) continue;
    if (!(await first.isEnabled().catch(() => false))) continue;

    await first.scrollIntoViewIfNeeded().catch(() => undefined);
    await first.fill(value, { timeout: 5000 });
    return true;
  }

  return false;
}

async function fillCalendlyForm(frame: CalendlyScope, leadData: LeadData) {
  const filledFields: string[] = [];
  const skippedFields: string[] = [];
  const nameParts = leadData.fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ");

  // 1. Name fields (Full Name or First + Last Name)
  // Prefer an explicit first/last pair before a broad `name` selector. On many
  // forms the first-name input also matches `input[name*="name"]`; filling it
  // first with the complete name leaves the required last-name input empty.
  const firstNameFilled = firstName && lastName
    ? await fillFirstAvailable(
      [
        frame.locator('input[name*="first_name" i]'),
        frame.locator('input[name*="first" i]'),
        frame.locator('input[autocomplete="given-name"]'),
        frame.locator('input[aria-label*="First" i]'),
        frame.locator('input[placeholder*="First" i]'),
        frame.locator('input[aria-label*="Nombre" i]')
      ],
      firstName
    )
    : false;
  const lastNameFilled = firstNameFilled && lastName
    ? await fillFirstAvailable(
      [
        frame.locator('input[name*="last_name" i]'),
        frame.locator('input[name*="last" i]'),
        frame.locator('input[autocomplete="family-name"]'),
        frame.locator('input[aria-label*="Last" i]'),
        frame.locator('input[placeholder*="Last" i]'),
        frame.locator('input[aria-label*="Apellido" i]')
      ],
      lastName
    )
    : false;

  let nameFilled = firstNameFilled && lastNameFilled;
  if (nameFilled) {
    filledFields.push("firstName", "lastName");
  }

  if (!nameFilled && !firstNameFilled && !lastNameFilled) nameFilled = await fillFirstAvailable(
    [
      frame.locator('input[name="full_name"]'),
      frame.locator('input#full_name_input'),
      frame.locator('input[name*="full_name" i]'),
      frame.locator('input[name*="name" i]'),
      frame.locator('input[id*="name" i]'),
      frame.locator('input[aria-label*="Name" i]'),
      frame.locator('input[placeholder*="Name" i]'),
      frame.locator('input[aria-label*="Nombre" i]'),
      frame.locator('input[placeholder*="Nombre" i]')
    ],
    leadData.fullName
  );

  nameFilled ? filledFields.push("fullName") : skippedFields.push("fullName");

  // 2. Email field
  const emailFilled = await fillFirstAvailable(
    [
      frame.locator('input[type="email"]'),
      frame.locator('input[name="email"]'),
      frame.locator('input#email_input'),
      frame.locator('input[name*="email" i]'),
      frame.locator('input[id*="email" i]'),
      frame.locator('input[aria-label*="Email" i]'),
      frame.locator('input[placeholder*="Correo" i]'),
      frame.locator('input[aria-label*="Correo" i]')
    ],
    leadData.email
  );
  emailFilled ? filledFields.push("email") : skippedFields.push("email");

  // 3. Phone / Mobile field
  const mobile = leadData.mobile ?? leadData.mobileNumber;
  if (mobile) {
    const phoneFilled = await fillFirstAvailable(
      [
        frame.locator('input[type="tel"]'),
        frame.locator('input[name="phone_number"]'),
        frame.locator('input[name*="phone" i]'),
        frame.locator('input[name*="telefono" i]'),
        frame.locator('input[id*="phone" i]'),
        frame.locator('input[aria-label*="Phone" i]'),
        frame.locator('input[aria-label*="Teléfono" i]'),
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

  // 4. Company Name
  if (leadData.companyName) {
    const companyFilled = await fillFirstAvailable(
      [
        frame.locator('input[name*="company" i]'),
        frame.locator('input[name*="empresa" i]'),
        frame.locator('input[id*="company" i]'),
        frame.locator('input[aria-label*="Company" i]'),
        frame.locator('input[aria-label*="Empresa" i]'),
        frame.locator('input[placeholder*="Company" i]'),
        frame.locator('input[placeholder*="Empresa" i]'),
        frame.locator('input[aria-label*="Business" i]')
      ],
      leadData.companyName,
      350
    );
    companyFilled ? filledFields.push("companyName") : skippedFields.push("companyName");
  }

  // 5. Message / Notes / Additional Questions
  const message = [leadData.message, leadData.address ? `Address: ${leadData.address}` : null]
    .filter(Boolean)
    .join("\n");

  if (message) {
    const messageFilled = await fillFirstAvailable(
      [
        frame.locator("textarea"),
        frame.locator('textarea[aria-label*="Message" i]'),
        frame.locator('textarea[aria-label*="Mensaje" i]'),
        frame.locator('textarea[placeholder*="Message" i]'),
        frame.locator('textarea[placeholder*="Mensaje" i]'),
        frame.locator('textarea[aria-label*="Question" i]'),
        frame.locator('textarea[placeholder*="Detalles" i]')
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
  const confirmationPattern =
    /you are scheduled|confirmed|programad[oa]|confirmad[oa]|a calendar invitation has been sent|reunión agendada|cita programada|evento programado/i;
  await Promise.race([
    page.waitForURL(/scheduled_events/i, { timeout: 10000 }),
    page.getByText(confirmationPattern).first().waitFor({ state: "visible", timeout: 10000 }),
    frame.getByText(confirmationPattern).first().waitFor({ state: "visible", timeout: 10000 })
  ]).catch(() => undefined);

  if (page.url().includes("scheduled_events")) {
    return true;
  }

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

    await page.goto(websiteUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    // Dismiss any cookie consent overlay before looking for frames
    await dismissCookieBanners(page).catch(() => undefined);

    const frame = await findCalendlyFrame(page);

    if (!frame) {
      return finish("iframe_not_accessible", "Calendly iframe could not be found or accessed.");
    }

    await dismissCookieBanners(page).catch(() => undefined);
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

    screenshotPaths.push(await takeScreenshot(page, websiteUrl, "date-selected"));

    selectedTime = await chooseTime(
      frame,
      bookingPreferences.preferredTime,
      bookingPreferences.fallbackToFirstAvailableSlot ?? true
    );

    if (!selectedTime) {
      return finish("no_available_slots", "No available Calendly time slots were found.");
    }

    screenshotPaths.push(await takeScreenshot(page, websiteUrl, "time-selected"));

    // Calendly currently has two booking layouts. Older layouts reveal a
    // Next/Continue button after the time is chosen; newer layouts navigate
    // directly to the invitee form.
    let formVisible = await waitForInviteeForm(frame, 3000);

    if (!formVisible) {
      const didContinue = await clickProgressButton(
        frame,
        /next|continue|confirm|siguiente|continuar|confirmar|avanzar/i
      );

      if (didContinue) {
        screenshotPaths.push(await takeScreenshot(page, websiteUrl, "time-confirmed"));
        formVisible = await waitForInviteeForm(frame, 6000);
      }
    }

    if (!formVisible) {
      return finish("failed", "Invitee details form did not appear after time selection.");
    }

    const fillResult = await fillCalendlyForm(frame, leadData);
    filledFields = fillResult.filledFields;
    skippedFields = fillResult.skippedFields;

    screenshotPaths.push(await takeScreenshot(page, websiteUrl, "form-filled"));

    if (!liveSubmit) {
      return finish("dry_run_ready_to_book", null);
    }

    const scheduled = await clickProgressButton(
      frame,
      /schedule event|confirm|book event|programar evento|confirmar|agendar/i
    );

    if (!scheduled) {
      return finish("failed", "Schedule Event button could not be clicked.");
    }

    const confirmed = await confirmationFound(page, frame);

    if (confirmed) {
      screenshotPaths.push(await takeScreenshot(page, websiteUrl, "booking-confirmed"));
      return finish("success", null);
    }

    return finish("confirmation_not_found", "Booking was submitted but confirmation was not detected.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Calendly automation error.";
    return finish("failed", message);
  } finally {
    if (page && !browserContext) {
      await page.close().catch(() => undefined);
    }
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}
