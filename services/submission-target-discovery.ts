import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Frame, type Page, type BrowserContext } from "playwright";
import { getChromiumExecutablePath } from "@/services/browser-executable";
import {
  DiscoverSubmissionTargetInput,
  DiscoverSubmissionTargetResult,
  DiscoverSubmissionTargetsResult,
  DiscoveredSubmissionTarget,
  SubmissionTargetType
} from "@/types/automation";

const SCREENSHOT_DIR = path.join(process.cwd(), "public", "screenshots");
const DEFAULT_MAX_NAVIGATION_LINKS = 10;
const DEFAULT_MAX_FALLBACK_PATHS = 4;

const COMMON_TARGET_PATHS = [
  "/contact",
  "/contact-us",
  "/contactus",
  "/book",
  "/book-now",
  "/booknow",
  "/schedule",
  "/schedule-a-call",
  "/appointment",
  "/consultation",
  "/request-a-quote",
  "/quote",
  "/get-started"
  ,"/contact-1"
  ,"/contact-me"
  ,"/connect"
  ,"/inquire"
  ,"/lets-talk"
  ,"/work-with-us"
];

type Candidate = {
  url: string;
  score: number;
  reason: string;
  matchedTargetHint: boolean;
};

const NAVIGATION_LINK_SELECTOR = [
  "header a[href]",
  "nav a[href]",
  "footer a[href]",
  '[role="navigation"] a[href]',
  ".navbar a[href]",
  ".menu a[href]",
  ".site-header a[href]",
  ".site-footer a[href]"
  ,"main a[href]"
  ,'[role="main"] a[href]'
].join(", ");

const SKIPPED_PATH_PATTERN =
  /\/(privacy|terms|cookies?|blog|news|articles?|category|tags?|login|sign-?in|sign-?up|cart|checkout)(\/|$)/i;
const SKIPPED_EXTENSION_PATTERN =
  /\.(pdf|jpe?g|png|gif|svg|webp|zip|rar|mp[34]|avi|mov|docx?|xlsx?)(\?|$)/i;

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

function ensureUrl(value: string) {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function withoutHash(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function isSupportedExternalTarget(url: URL) {
  const hostname = url.hostname.toLowerCase();
  return hostname === "calendly.com" || hostname === "meetings.hubspot.com";
}

async function takeScreenshot(page: Page, websiteUrl: string, label: string) {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const fileName = `${Date.now()}-${slugify(websiteUrl)}-${label}.png`;
  const absolutePath = path.join(SCREENSHOT_DIR, fileName);
  await page.screenshot({ path: absolutePath, fullPage: true });
  return `/screenshots/${fileName}`;
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

function scoreTargetHint(text: string, href: string) {
  const combined = normalizeText(`${text} ${href}`);
  let score = 0;

  const hints = [
    ["contact us", 35],
    ["contact", 30],
    ["get in touch", 15],
    ["let's talk", 15],
    ["lets talk", 15],
    ["talk to sales", 15],
    ["request quote", 13],
    ["get quote", 13],
    ["book now", 14],
    ["book a call", 14],
    ["book", 10],
    ["schedule", 12],
    ["appointment", 11],
    ["consultation", 10],
    ["inquiry", 9],
    ["enquiry", 9],
    ["quote", 8],
    ["get started", 7],
    ["meeting", 7]
    ,["connect", 8]
    ,["reach us", 10]
    ,["work with us", 11]
    ,["start a project", 11]
    ,["estimate", 7]
  ] as const;

  for (const [hint, value] of hints) {
    if (combined.includes(hint)) score += value;
  }

  if (combined.includes("mailto:") || combined.includes("tel:")) score -= 20;
  if (combined.includes("privacy") || combined.includes("terms")) score -= 10;
  return score;
}

async function collectNavigationCandidates(page: Page, baseUrl: string): Promise<Candidate[]> {
  const base = new URL(baseUrl);

  return page
    .locator(NAVIGATION_LINK_SELECTOR)
    .evaluateAll((anchors) =>
      anchors.map((anchor) => ({
        href: anchor.getAttribute("href") ?? "",
        text: anchor.textContent ?? "",
        ariaLabel: anchor.getAttribute("aria-label") ?? "",
        title: anchor.getAttribute("title") ?? "",
        source: anchor.closest("footer, .site-footer")
          ? "footer"
          : anchor.closest("header, .site-header")
            ? "header"
            : anchor.closest("main, [role='main']") ? "main CTA" : "navigation"
      }))
    )
    .then((links) =>
      links
        .map((link) => {
          try {
            const resolved = new URL(link.href, base);

            if (
              (resolved.origin !== base.origin && !isSupportedExternalTarget(resolved)) ||
              ["mailto:", "tel:", "javascript:"].includes(resolved.protocol) ||
              SKIPPED_PATH_PATTERN.test(resolved.pathname) ||
              SKIPPED_EXTENSION_PATTERN.test(`${resolved.pathname}${resolved.search}`)
            ) {
              return null;
            }

            const score = scoreTargetHint(
              `${link.text} ${link.ariaLabel} ${link.title}`,
              resolved.toString()
            );

            if (link.source === "main CTA" && score <= 0) return null;

            return {
              url: withoutHash(resolved.toString()),
              score,
              matchedTargetHint: score > 0,
              reason: `${link.source} link "${normalizeText(
                link.text || link.ariaLabel || link.title || resolved.pathname
              )}"${score > 0 ? " matched a contact/booking hint" : " checked as navigation fallback"}`
            };
          } catch {
            return null;
          }
        })
        .filter((candidate): candidate is Candidate => Boolean(candidate))
    )
    .catch(() => []);
}

async function getVisibleFormScore(container: Page | Frame) {
  return container
    .locator("form, input, textarea, button")
    .evaluateAll((elements) => {
      const visible = elements.filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.height > 0;
      });
      const hasEmail = visible.some((element) => {
        const input = element as HTMLInputElement;
        return (
          input.type === "email" ||
          /email/i.test(input.name ?? "") ||
          /email/i.test(input.placeholder ?? "") ||
          /email/i.test(input.getAttribute("aria-label") ?? "")
        );
      });
      const hasMessage = visible.some((element) => element.tagName.toLowerCase() === "textarea");
      const hasName = visible.some((element) => /name/i.test(`${(element as HTMLInputElement).name ?? ""} ${(element as HTMLInputElement).placeholder ?? ""}`));
      const hasSubmit = visible.some((element) =>
        /submit|send|contact|request|quote/i.test(
          `${element.textContent ?? ""} ${(element as HTMLInputElement).value ?? ""}`
        )
      );
      const hasFormSubmit = visible.some((element) => element.matches("button[type='submit'], input[type='submit']"));

      return Number(hasEmail) * 35 + Number(hasMessage) * 25 + Number(hasName) * 15 + Number(hasSubmit || hasFormSubmit) * 25;
    })
    .catch(() => 0);
}

function commonPathCandidates(baseUrl: string): Candidate[] {
  const base = new URL(baseUrl);

  return COMMON_TARGET_PATHS.map((targetPath) => ({
    url: new URL(targetPath, base.origin).toString(),
    score: scoreTargetHint(targetPath, targetPath),
    reason: `common path ${targetPath}`,
    matchedTargetHint: true
  }));
}

function mergeCandidates(candidates: Candidate[], limit: number) {
  const byUrl = new Map<string, Candidate>();

  for (const candidate of candidates) {
    const current = byUrl.get(candidate.url);

    if (!current || candidate.score > current.score) {
      byUrl.set(candidate.url, candidate);
    }
  }

  return Array.from(byUrl.values())
    .sort(
      (a, b) =>
        Number(b.matchedTargetHint) - Number(a.matchedTargetHint) || b.score - a.score
    )
    .slice(0, limit);
}

const TARGET_EXECUTION_ORDER: Record<DiscoveredSubmissionTarget["targetType"], number> = {
  calendly: 1,
  hubspot_booking: 2,
  contact_form: 3,
  booking_widget: 4
};

async function detectContactTarget(
  page: Page,
  websiteUrl: string,
  candidateReason: string
): Promise<DiscoverSubmissionTargetResult | null> {
  const formScore = await getVisibleFormScore(page);
  if (formScore >= 60) {
    return {
      websiteUrl,
      discoveredUrl: page.url(),
      targetType: "contact_form",
      confidence: Math.min(90, formScore),
      reason: `contact form fields detected; ${candidateReason}`,
      checkedUrls: [],
      screenshotPath: await takeScreenshot(page, websiteUrl, "contact-form-discovered").catch(() => null)
    };
  }

  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || !/^https?:/i.test(frame.url())) continue;
    const frameFormScore = await getVisibleFormScore(frame);
    if (frameFormScore < 60) continue;
    return {
      websiteUrl,
      discoveredUrl: frame.url(),
      targetType: "contact_form",
      confidence: Math.min(88, frameFormScore),
      reason: `contact form fields detected inside an embedded frame; ${candidateReason}`,
      checkedUrls: [],
      screenshotPath: await takeScreenshot(page, websiteUrl, "embedded-form-discovered").catch(() => null)
    };
  }
  return null;
}

async function collectSupportedExternalCandidates(page: Page, baseUrl: string): Promise<Candidate[]> {
  return page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      href: anchor.getAttribute("href") ?? "",
      text: (anchor.textContent ?? "").replace(/\s+/g, " ").trim()
    }))
  ).then((links) => links.flatMap((link) => {
    try {
      const resolved = new URL(link.href, baseUrl);
      const hostname = resolved.hostname.toLowerCase();
      if (hostname !== "calendly.com" && !hostname.endsWith(".calendly.com") && hostname !== "meetings.hubspot.com") {
        return [];
      }
      return [{
        url: withoutHash(resolved.toString()),
        score: 100,
        reason: `supported external booking link "${link.text || resolved.hostname}"`,
        matchedTargetHint: true
      }];
    } catch {
      return [];
    }
  })).catch(() => []);
}

function resultFromSupportedExternalCandidate(
  websiteUrl: string,
  candidate: Candidate
): DiscoverSubmissionTargetResult | null {
  const resolved = new URL(candidate.url);
  const hostname = resolved.hostname.toLowerCase();
  const targetType = hostname === "meetings.hubspot.com"
    ? "hubspot_booking"
    : hostname === "calendly.com" || hostname.endsWith(".calendly.com")
      ? "calendly"
      : null;

  if (!targetType) return null;
  return {
    websiteUrl,
    discoveredUrl: withoutHash(resolved.toString()),
    targetType,
    confidence: targetType === "calendly" ? 98 : 96,
    reason: `${candidate.reason}; detected directly from the website booking link`,
    checkedUrls: [],
    screenshotPath: null
  };
}

async function detectTargetOnPage(
  page: Page,
  url: string,
  candidateReason: string
): Promise<DiscoverSubmissionTargetResult | null> {
  const currentUrl = page.url();
  const currentHostname = new URL(currentUrl).hostname.toLowerCase();
  const notFound = await page
    .locator("body")
    .innerText({ timeout: 2000 })
    .then((text) => /404|page not found|not found/i.test(text))
    .catch(() => false);

  if (notFound) return null;

  if (currentHostname.includes("meetings.hubspot.com")) {
    return {
      websiteUrl: url,
      discoveredUrl: currentUrl,
      targetType: "hubspot_booking",
      confidence: 96,
      reason: `HubSpot meetings URL found; ${candidateReason}`,
      checkedUrls: [],
      screenshotPath: await takeScreenshot(page, url, "target-discovered").catch(() => null)
    };
  }

  if (currentHostname === "calendly.com" || currentHostname.endsWith(".calendly.com")) {
    return {
      websiteUrl: url,
      discoveredUrl: currentUrl,
      targetType: "calendly",
      confidence: 98,
      reason: `Direct Calendly page found; ${candidateReason}`,
      checkedUrls: [],
      screenshotPath: await takeScreenshot(page, url, "calendly-discovered").catch(() => null)
    };
  }

  if (/\/(discovery-call|book-call|booking|book-now|schedule-call|consultation|appointment)/i.test(new URL(currentUrl).pathname)) {
    return {
      websiteUrl: url,
      discoveredUrl: currentUrl,
      targetType: "booking_widget",
      confidence: 78,
      reason: `Booking-style URL path found; ${candidateReason}`,
      checkedUrls: [],
      screenshotPath: await takeScreenshot(page, url, "target-discovered").catch(() => null)
    };
  }

  const html = await page.content().catch(() => "");
  const hasEmbeddedBookingCalendar =
    html.includes('"type":"BookingCalendar"') ||
    html.includes("bookingcalendar-") ||
    html.includes("nextStepButtonText");

  if (hasEmbeddedBookingCalendar) {
    return {
      websiteUrl: url,
      discoveredUrl: currentUrl,
      targetType: "booking_widget",
      confidence: 90,
      reason: `Embedded booking calendar source found; ${candidateReason}`,
      checkedUrls: [],
      screenshotPath: await takeScreenshot(page, url, "target-discovered").catch(() => null)
    };
  }

  const calendlyReason = await page
    .locator("iframe")
    .evaluateAll((iframes) => {
      for (const iframe of iframes) {
        const src = iframe.getAttribute("src") ?? "";
        const title = iframe.getAttribute("title") ?? "";

        if (src.toLowerCase().includes("calendly")) return "Calendly iframe src found";
        if (title.toLowerCase().includes("calendly")) return "Calendly iframe title found";
      }

      return null;
    })
    .catch(() => null);

  if (calendlyReason) {
    return {
      websiteUrl: url,
      discoveredUrl: url,
      targetType: "calendly",
      confidence: 95,
      reason: `${calendlyReason}; ${candidateReason}`,
      checkedUrls: [],
      screenshotPath: await takeScreenshot(page, url, "target-discovered").catch(() => null)
    };
  }

  // Prefer an actual visible form over generic booking-related page copy.
  // Contact pages commonly contain phrases such as "contact details" that do
  // not indicate a calendar or booking widget.
  const contactTarget = await detectContactTarget(page, url, candidateReason);
  if (contactTarget) return contactTarget;

  const bodyText = await page.locator("body").innerText({ timeout: 2500 }).catch(() => "");
  const normalizedBodyText = normalizeText(bodyText);
  const bookingText = [
    "select a date & time",
    "schedule a meeting",
    "book a call",
    "choose a time",
    "choose time",
    "your info",
    "what time works best",
    "meeting duration",
    "date/time",
    "next step"
  ].find((phrase) => normalizedBodyText.includes(phrase));

  if (bookingText) {
    const isHubSpotBooking =
      currentHostname.includes("hubspot") ||
      normalizedBodyText.includes("hubspot") ||
      normalizedBodyText.includes("what time works best");

    return {
      websiteUrl: url,
      discoveredUrl: currentUrl,
      targetType: isHubSpotBooking ? "hubspot_booking" : "booking_widget",
      confidence: 82,
      reason: `booking text "${bookingText}" found; ${candidateReason}`,
      checkedUrls: [],
      screenshotPath: await takeScreenshot(page, url, "target-discovered").catch(() => null)
    };
  }

  return null;
}

async function detectTargetWithLazyScroll(
  page: Page,
  url: string,
  candidateReason: string
): Promise<DiscoverSubmissionTargetResult | null> {
  const initialResult = await detectTargetOnPage(page, url, candidateReason);
  if (initialResult) return initialResult;

  // Some builders do not mount or reveal the form until it approaches the
  // viewport. Scroll once only after the fast, above-the-fold scan fails.
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  await page.waitForTimeout(400);
  return detectTargetOnPage(page, url, `${candidateReason}; detected after scrolling`);
}

export async function discoverSubmissionTarget({
  websiteUrl,
  headless = true,
  timeoutMs = 8000,
  maxNavigationLinks = DEFAULT_MAX_NAVIGATION_LINKS,
  maxFallbackPaths = DEFAULT_MAX_FALLBACK_PATHS,
  browserContext
}: DiscoverSubmissionTargetInput & { browserContext?: BrowserContext }): Promise<DiscoverSubmissionTargetResult> {
  let browser: Browser | null = null;
  let page: Page | null = null;
  const checkedUrls: string[] = [];
  const normalizedWebsiteUrl = ensureUrl(websiteUrl);
  let normalizedUrl: URL;

  try {
    normalizedUrl = new URL(normalizedWebsiteUrl);
  } catch (error) {
    return {
      websiteUrl: normalizedWebsiteUrl,
      discoveredUrl: null,
      targetType: "not_found",
      confidence: 0,
      reason: "Invalid URL provided.",
      checkedUrls: [normalizedWebsiteUrl],
      screenshotPath: null
    };
  }

  if (/\/(discovery-call|book-call|booking|book-now|schedule-call|consultation|appointment)/i.test(normalizedUrl.pathname)) {
    return {
      websiteUrl: normalizedWebsiteUrl,
      discoveredUrl: normalizedWebsiteUrl,
      targetType: "booking_widget",
      confidence: 78,
      reason: "Booking-style URL path found.",
      checkedUrls: [normalizedWebsiteUrl],
      screenshotPath: null
    };
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
        viewport: { width: 1280, height: 820 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
      });
    }
    page.setDefaultTimeout(timeoutMs);
    await blockHeavyAssets(page);

    const homepageLoaded = await page
      .goto(normalizedWebsiteUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs
      })
      .then(() => true)
      .catch(() => false);
    if (homepageLoaded) await page.waitForTimeout(700);

    const directResult = homepageLoaded
      ? await detectTargetWithLazyScroll(page, page.url(), "entered URL already works")
      : null;

    if (directResult?.targetType === "contact_form") {
      return { ...directResult, websiteUrl: normalizedWebsiteUrl, checkedUrls: [page.url()] };
    }
    const homepageBookingResult = directResult;

    const navigationCandidates = homepageLoaded
      ? mergeCandidates(await collectNavigationCandidates(page, page.url()), maxNavigationLinks)
      : [];
    const fallbackCandidates = mergeCandidates(
      commonPathCandidates(homepageLoaded ? page.url() : normalizedWebsiteUrl),
      maxFallbackPaths
    );
    const candidates = [...navigationCandidates, ...fallbackCandidates];

    for (const candidate of candidates) {
      checkedUrls.push(candidate.url);

      const candidateLoaded = await page
        .goto(candidate.url, {
          waitUntil: "domcontentloaded",
          timeout: Math.min(timeoutMs, 5000)
        })
        .then(() => true)
        .catch(() => false);

      if (!candidateLoaded) {
        continue;
      }

      await page.waitForTimeout(500);

      const result = await detectTargetWithLazyScroll(page, page.url(), candidate.reason);

      if (result) {
        return {
          ...result,
          websiteUrl: normalizedWebsiteUrl,
          checkedUrls: [normalizedWebsiteUrl, ...checkedUrls]
        };
      }
    }

    if (homepageBookingResult) {
      return {
        ...homepageBookingResult,
        websiteUrl: normalizedWebsiteUrl,
        checkedUrls: [normalizedWebsiteUrl, ...checkedUrls],
        reason: `${homepageBookingResult.reason}; used as fallback after no contact form was found in navigation`
      };
    }

    return {
      websiteUrl: normalizedWebsiteUrl,
      discoveredUrl: null,
      targetType: "not_found" as SubmissionTargetType,
      confidence: 0,
      reason: `No supported contact form or booking widget was found after checking ${checkedUrls.length + 1} page${checkedUrls.length === 0 ? "" : "s"}. The site may have no public form, use an unsupported widget, or require manual review.`,
      checkedUrls: [normalizedWebsiteUrl, ...checkedUrls],
      screenshotPath: await takeScreenshot(page, normalizedWebsiteUrl, "target-not-found").catch(
        () => null
      )
    };
  } catch (error) {
    return {
      websiteUrl: normalizedWebsiteUrl,
      discoveredUrl: null,
      targetType: "not_found",
      confidence: 0,
      reason: error instanceof Error ? error.message : "Target discovery failed.",
      checkedUrls,
      screenshotPath: null
    };
  } finally {
    if (page && browserContext) {
      await page.close().catch(() => undefined);
    } else {
      await browser?.close().catch(() => undefined);
    }
  }
}

export async function discoverSubmissionTargets({
  websiteUrl,
  headless = true,
  timeoutMs = 8000,
  maxNavigationLinks = DEFAULT_MAX_NAVIGATION_LINKS,
  maxFallbackPaths = DEFAULT_MAX_FALLBACK_PATHS,
  browserContext
}: DiscoverSubmissionTargetInput & { browserContext?: BrowserContext }): Promise<DiscoverSubmissionTargetsResult> {
  const normalizedWebsiteUrl = ensureUrl(websiteUrl);
  try {
    new URL(normalizedWebsiteUrl);
  } catch {
    return {
      websiteUrl: normalizedWebsiteUrl,
      targets: [],
      checkedUrls: [normalizedWebsiteUrl],
      reason: "Invalid URL provided.",
      screenshotPath: null
    };
  }

  let browser: Browser | null = null;
  let page: Page | null = null;
  const checkedUrls: string[] = [];
  const discovered = new Map<string, DiscoveredSubmissionTarget>();

  const addResult = (result: DiscoverSubmissionTargetResult | null) => {
    if (!result?.discoveredUrl || result.targetType === "not_found") return;
    const targetType = result.targetType;
    const url = withoutHash(result.discoveredUrl);
    const key = `${targetType}:${url}`;
    const target: DiscoveredSubmissionTarget = {
      targetType,
      url,
      executionOrder: TARGET_EXECUTION_ORDER[targetType],
      confidence: result.confidence,
      reason: result.reason,
      screenshotPath: result.screenshotPath,
      metadata: { discoveredFrom: normalizedWebsiteUrl }
    };
    const existing = discovered.get(key);
    if (!existing || target.confidence > existing.confidence) discovered.set(key, target);
  };

  try {
    if (browserContext) {
      page = await browserContext.newPage();
    } else {
      browser = await chromium.launch({
        headless,
        executablePath: await getChromiumExecutablePath()
      });
      page = await browser.newPage({
        viewport: { width: 1280, height: 820 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
      });
    }
    page.setDefaultTimeout(timeoutMs);
    await blockHeavyAssets(page);

    const homepageLoaded = await page.goto(normalizedWebsiteUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    }).then(() => true).catch(() => false);

    if (!homepageLoaded) {
      return {
        websiteUrl: normalizedWebsiteUrl,
        targets: [],
        checkedUrls: [normalizedWebsiteUrl],
        reason: "The website could not be loaded for multi-target discovery.",
        screenshotPath: await takeScreenshot(page, normalizedWebsiteUrl, "target-not-found").catch(() => null)
      };
    }

    await page.waitForTimeout(700);
    checkedUrls.push(withoutHash(page.url()));
    addResult(await detectTargetWithLazyScroll(page, page.url(), "entered URL already works"));

    const supportedExternalCandidates = await collectSupportedExternalCandidates(page, page.url());
    for (const candidate of supportedExternalCandidates) {
      addResult(resultFromSupportedExternalCandidate(normalizedWebsiteUrl, candidate));
    }

    const navigationCandidates = mergeCandidates([
      ...supportedExternalCandidates,
      ...(await collectNavigationCandidates(page, page.url()))
    ], maxNavigationLinks);
    const fallbackCandidates = mergeCandidates(commonPathCandidates(page.url()), maxFallbackPaths);
    const candidates = mergeCandidates([...navigationCandidates, ...fallbackCandidates], maxNavigationLinks + maxFallbackPaths);

    for (const candidate of candidates) {
      const candidateUrl = withoutHash(candidate.url);
      if (checkedUrls.includes(candidateUrl)) continue;
      checkedUrls.push(candidateUrl);
      const loaded = await page.goto(candidate.url, {
        waitUntil: "domcontentloaded",
        timeout: Math.min(timeoutMs, 7000)
      }).then(() => true).catch(() => false);
      if (!loaded) continue;
      await page.waitForTimeout(500);
      addResult(await detectTargetWithLazyScroll(page, page.url(), candidate.reason));
    }

    const targets = Array.from(discovered.values()).sort(
      (a, b) => a.executionOrder - b.executionOrder || b.confidence - a.confidence || a.url.localeCompare(b.url)
    );
    return {
      websiteUrl: normalizedWebsiteUrl,
      targets,
      checkedUrls,
      reason: targets.length > 0
        ? `Discovered ${targets.length} supported submission target${targets.length === 1 ? "" : "s"}.`
        : `No supported submission target was found after checking ${checkedUrls.length} page${checkedUrls.length === 1 ? "" : "s"}.`,
      screenshotPath: targets[0]?.screenshotPath ?? await takeScreenshot(page, normalizedWebsiteUrl, "target-not-found").catch(() => null)
    };
  } catch (error) {
    return {
      websiteUrl: normalizedWebsiteUrl,
      targets: Array.from(discovered.values()).sort((a, b) => a.executionOrder - b.executionOrder),
      checkedUrls,
      reason: error instanceof Error ? error.message : "Unknown multi-target discovery error.",
      screenshotPath: null
    };
  } finally {
    if (page && browserContext) await page.close().catch(() => undefined);
    else await browser?.close().catch(() => undefined);
  }
}
