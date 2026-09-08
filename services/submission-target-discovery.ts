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
import { dismissCookieBanners } from "./cookie-consent-helper";
import {
  isProxyAuthenticationFailure,
  ProxyAuthenticationError,
  PROXY_407_MESSAGE,
  redactProxyDetails
} from "@/services/proxy-helper";
import { detectUnsupportedVerification } from "@/services/verification-detector";
import { analyzePageContext } from "./discovery/page-context-analyzer";
import { extractRawCandidates } from "./discovery/candidate-extractor";
import { extractFeatureVector, extractUniversalFeatureVector } from "./discovery/feature-extractor";
import { scoreAndRankCandidates } from "./discovery/hybrid-ranker";
import { recordDiscoveryFeedback } from "./discovery/feedback-store";
import type { CandidateFeatureVector, CandidateLocation, CandidateType } from "./discovery/types";
export type { CandidateLocation, CandidateType };

const SCREENSHOT_DIR = path.join(process.cwd(), "public", "screenshots");
const DEFAULT_MAX_NAVIGATION_LINKS = 10;
const DEFAULT_MAX_FALLBACK_PATHS = 4;

const COMMON_TARGET_PATHS = [
  "/contact",
  "/contact-us",
  "/contactus",
  "/contact-me",
  "/contact-form",
  "/get-in-touch",
  "/reach-us",
  "/reach-out",
  "/book",
  "/book-now",
  "/booknow",
  "/book-a-demo",
  "/request-demo",
  "/schedule",
  "/schedule-a-call",
  "/strategy-call",
  "/appointment",
  "/consultation",
  "/free-consultation",
  "/request-a-quote",
  "/quote",
  "/get-started",
  "/contact-1",
  "/connect",
  "/inquire",
  "/lets-talk",
  "/work-with-us",
  "/start-a-project",
  "/talk-to-us"
];

export type Candidate = {
  url: string;
  score: number;
  reason: string;
  matchedTargetHint: boolean;
  candidateText?: string;
  candidateHref?: string;
  candidateLocation?: CandidateLocation;
  candidateType?: CandidateType;
  features?: CandidateFeatureVector;
  depth?: number;
};

type HttpDocument = { url: string; body: string };

const HTTP_DISCOVERY_BUDGET_MS = 8_000;
const HTTP_REQUEST_TIMEOUT_MS = 2_500;
const HTTP_PROBE_CONCURRENCY = 4;
const HTTP_MAX_PAGES = 10;

const NAVIGATION_LINK_SELECTOR = [
  "header a[href]",
  "nav a[href]",
  "footer a[href]",
  '[role="navigation"] a[href]',
  ".navbar a[href]",
  ".menu a[href]",
  ".site-header a[href]",
  ".site-footer a[href]",
  "main a[href]",
  '[role="main"] a[href]',
  ".hero a[href]",
  ".cta a[href]",
  "a[href*='contact']",
  "a[href*='talk']",
  "a[href*='touch']",
  "a[href*='quote']",
  "a[href*='book']",
  "a[href*='schedule']",
  "a[href*='meeting']",
  "a[href*='consult']",
  "a[href*='started']",
  "a[href*='inquire']"
].join(", ");

const INTERACTIVE_DISCOVERY_TRIGGER_SELECTOR = "button, [role='button'], summary";
const MAX_INTERACTIVE_DISCOVERY_CLICKS = 3;

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

function isCalendlyEventUrl(url: URL) {
  const hostname = url.hostname.toLowerCase();
  if (hostname !== "calendly.com" && !hostname.endsWith(".calendly.com")) return false;

  // Public event URLs always contain the owner and event-slug path segments
  // (for example /acme/intro-call). Calendly's own /contact and /pricing pages
  // are ordinary website pages, not scheduling targets.
  return url.pathname.split("/").filter(Boolean).length >= 2;
}

function isPipedriveSchedulerUrl(url: URL) {
  const hostname = url.hostname.toLowerCase();
  return (
    (hostname === "pipedrive.com" || hostname.endsWith(".pipedrive.com")) &&
    /^\/scheduler\/[^/]+\/[^/]+/i.test(url.pathname)
  );
}

function isPrivatePipedriveContactUrl(url: URL) {
  const hostname = url.hostname.toLowerCase();
  return (
    (hostname === "pipedrive.com" || hostname.endsWith(".pipedrive.com")) &&
    /^(?:\/contact\/?|\/auth\/login\b)/i.test(url.pathname)
  );
}

function isSupportedExternalTarget(url: URL) {
  const hostname = url.hostname.toLowerCase();
  return isCalendlyEventUrl(url) || isPipedriveSchedulerUrl(url) || hostname === "meetings.hubspot.com";
}

async function takeScreenshot(page: Page, websiteUrl: string, label: string) {
  try {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    const fileName = `${Date.now()}-${slugify(websiteUrl)}-${label}.png`;
    const absolutePath = path.join(SCREENSHOT_DIR, fileName);
    await page.screenshot({ path: absolutePath, fullPage: false, timeout: 2500, animations: "disabled" });
    return `/screenshots/${fileName}`;
  } catch (err) {
    console.warn("Screenshot capture skipped:", err);
    return null;
  }
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

export function scoreTargetHint(text: string, href: string, location?: "header" | "nav" | "footer" | "main CTA" | "body") {
  const normalizedText = normalizeText(text);
  const normalizedHref = normalizeText(href);
  const combined = `${normalizedText} ${normalizedHref}`;
  let score = 0;

  // Primary High Priority Keywords
  if (normalizedText === "contact" || /\bcontact\b/i.test(normalizedText)) score = Math.max(score, 100);
  if (combined.includes("contact us")) score = Math.max(score, 95);
  if (combined.includes("get in touch")) score = Math.max(score, 90);
  if (combined.includes("book a call") || combined.includes("book call")) score = Math.max(score, 90);
  if (combined.includes("schedule a call") || combined.includes("schedule call")) score = Math.max(score, 85);
  if (combined.includes("let's talk") || combined.includes("lets talk") || combined.includes("talk to us") || combined.includes("talk with us")) score = Math.max(score, 85);
  if (combined.includes("request a quote") || combined.includes("request quote") || combined.includes("get a quote") || combined.includes("get quote")) score = Math.max(score, 80);
  if (combined.includes("free consultation") || combined.includes("request consultation") || combined.includes("consultation")) score = Math.max(score, 75);
  if (combined.includes("get started") || combined.includes("start a project")) score = Math.max(score, 70);
  if (combined.includes("work with us") || combined.includes("book a meeting") || combined.includes("schedule a meeting")) score = Math.max(score, 70);
  if (combined.includes("talk to sales") || combined.includes("book now") || combined.includes("schedule demo") || combined.includes("request demo")) score = Math.max(score, 65);
  if (combined.includes("reach us") || combined.includes("reach out") || combined.includes("connect")) score = Math.max(score, 60);

  // URL Path Matches
  if (
    /\/(contact|contact-us|contactus|get-in-touch|book-a-call|book-call|schedule|schedule-a-call|meeting|book-meeting|consultation|quote|request-quote|get-started|inquire|lets-talk)(\/|\?|#|$)/i.test(
      normalizedHref
    )
  ) {
    score += 60;
  }

  // Location Boosts
  if (location === "header" || location === "nav") {
    score += 30;
  } else if (location === "footer") {
    score += 30;
  } else if (location === "main CTA") {
    score += 20;
  }

  // Penalties
  if (combined.includes("mailto:") || combined.includes("tel:")) score -= 50;
  if (combined.includes("privacy") || combined.includes("terms") || combined.includes("cookies") || combined.includes("blog") || combined.includes("news")) {
    score -= 30;
  }

  return score;
}

export async function collectNavigationCandidates(
  page: Page,
  baseUrl: string,
  maxCandidates: number = DEFAULT_MAX_NAVIGATION_LINKS
): Promise<Candidate[]> {
  try {
    const pageContext = await analyzePageContext(page);
    const rawCandidates = await extractRawCandidates(page, baseUrl);
    const featureVectors = rawCandidates.map((raw) =>
      extractFeatureVector(raw, baseUrl, pageContext)
    );
    const scoredCandidates = scoreAndRankCandidates(featureVectors, {
      maxCandidates
    });

    const candidates: Candidate[] = scoredCandidates.map((sc) => {
      console.log(
        `[CONTACT-DISCOVERY] Candidate ${sc.rank}/${scoredCandidates.length}: text="${sc.candidateText}" href="${sc.url}" location="${sc.location}" ruleScore=${sc.ruleScore} mlScore=${sc.mlScore} finalScore=${sc.finalScore} type="${sc.candidateType}"`
      );
      return {
        url: sc.url,
        score: sc.finalScore,
        matchedTargetHint: sc.finalScore > 0,
        candidateText: sc.candidateText,
        candidateHref: sc.candidateHref,
        candidateLocation: sc.location,
        candidateType: sc.candidateType as CandidateType,
        reason: sc.reason,
        // Store features on candidate for later feedback logging
        features: sc.features
      } as Candidate & { features?: CandidateFeatureVector };
    });

    return candidates;
  } catch (err) {
    console.warn("[CONTACT-DISCOVERY] Error collecting navigation candidates:", err);
    return [];
  }
}

async function fetchHttpDocument(url: string, deadline: number): Promise<HttpDocument | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return null;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(HTTP_REQUEST_TIMEOUT_MS, remaining)
  );
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; LeadAutomationDiscovery/1.0)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1"
      }
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("html") && !contentType.includes("xml")) return null;
    return { url: response.url, body: (await response.text()).slice(0, 1_500_000) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractHttpLinks(document: HttpDocument, includeCrawlLinks = false): Candidate[] {
  let base: URL;
  try {
    base = new URL(document.url);
  } catch {
    return [];
  }
  const rawLinks: Array<{ href: string; text: string; resolved: URL }> = [];
  const anchorPattern = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of document.body.matchAll(anchorPattern)) {
    try {
      const href = match[1].replace(/&amp;/gi, "&");
      const text = match[2].replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
      const resolved = new URL(href, base);
      if (
        (resolved.origin !== base.origin && !isSupportedExternalTarget(resolved)) ||
        !["http:", "https:"].includes(resolved.protocol) ||
        SKIPPED_PATH_PATTERN.test(resolved.pathname) ||
        SKIPPED_EXTENSION_PATTERN.test(`${resolved.pathname}${resolved.search}`)
      ) continue;
      rawLinks.push({ href, text, resolved });
    } catch {
      continue;
    }
  }

  const featureVectors = rawLinks.map((link) =>
    extractUniversalFeatureVector(
      {
        url: link.resolved.toString(),
        text: link.text,
        sourceType: "http_probe"
      },
      document.url
    )
  );

  const scored = scoreAndRankCandidates(featureVectors, { maxCandidates: 50 });

  const candidates: Candidate[] = [];
  for (const s of scored) {
    const crawlWorthy = /\/(about|company|services?|solutions?)(\/|$)/i.test(new URL(s.url).pathname);
    if (s.finalScore <= 0 && (!includeCrawlLinks || !crawlWorthy)) continue;
    candidates.push({
      url: withoutHash(s.url),
      score: s.finalScore,
      matchedTargetHint: s.finalScore > 0,
      candidateText: s.candidateText,
      candidateHref: s.candidateHref,
      candidateLocation: s.location,
      candidateType: s.candidateType as CandidateType,
      reason: `HTTP homepage link "${normalizeText(s.candidateText || new URL(s.url).pathname)}"${s.finalScore > 0 ? " matched a contact/booking hint" : " selected for shallow crawl"}`,
      features: s.features,
      depth: 1
    });
  }
  return candidates;
}

function documentSignalScore(body: string) {
  const normalized = body.toLowerCase();
  const hasForm = /<form\b/i.test(body);
  const hasEmail = /<input\b[^>]*(type\s*=\s*["']?email|name\s*=\s*["'][^"']*email)/i.test(body);
  const hasMessage = /<textarea\b/i.test(body);
  const hasCalendly = /calendly\.com|data-url\s*=\s*["'][^"']*calendly/i.test(normalized);
  const hasHubSpot = /meetings\.hubspot\.com|hubspot.*meetings/i.test(normalized);
  return Number(hasForm) * 25 + Number(hasEmail) * 25 + Number(hasMessage) * 20 + Number(hasCalendly || hasHubSpot) * 50;
}

function extractSitemapCandidates(document: HttpDocument): Candidate[] {
  const rawUrls: URL[] = [];
  for (const match of document.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/gi, "&"));
      if (SKIPPED_PATH_PATTERN.test(url.pathname)) continue;
      rawUrls.push(url);
    } catch {
      continue;
    }
  }

  const featureVectors = rawUrls.map((url) =>
    extractUniversalFeatureVector(
      {
        url: url.toString(),
        text: url.pathname,
        sourceType: "sitemap"
      },
      document.url
    )
  );

  const scored = scoreAndRankCandidates(featureVectors, { maxCandidates: 50 });
  const candidates: Candidate[] = [];
  for (const s of scored) {
    if (s.finalScore <= 0) continue;
    candidates.push({
      url: withoutHash(s.url),
      score: Math.min(100, s.finalScore + 8),
      matchedTargetHint: true,
      candidateText: s.candidateText,
      candidateHref: s.candidateHref,
      candidateLocation: s.location,
      candidateType: s.candidateType as CandidateType,
      reason: `sitemap URL "${new URL(s.url).pathname}" matched a contact/booking hint`,
      features: s.features,
      depth: 1
    });
  }
  return candidates;
}

async function collectHttpDiscoveryCandidates(websiteUrl: string): Promise<Candidate[]> {
  const deadline = Date.now() + HTTP_DISCOVERY_BUDGET_MS;
  const homepage = await fetchHttpDocument(websiteUrl, deadline);
  if (!homepage) return [];

  const homepageLinks = extractHttpLinks(homepage, true);
  let candidates = mergeCandidates(homepageLinks.filter((candidate) => candidate.matchedTargetHint), 8);
  let pagesUsed = 1;

  const probeCandidates = candidates.slice(0, Math.min(HTTP_PROBE_CONCURRENCY * 2, HTTP_MAX_PAGES - pagesUsed));
  const probed = await Promise.all(probeCandidates.map(async (candidate) => {
    const document = await fetchHttpDocument(candidate.url, deadline);
    if (!document) return null;
    pagesUsed++;
    const signalScore = documentSignalScore(document.body);
    if (signalScore <= 0) return null;
    return {
      ...candidate,
      url: withoutHash(document.url),
      score: Math.min(100, candidate.score + signalScore),
      reason: `${candidate.reason}; HTTP probe confirmed form or booking signals`
    };
  }));
  candidates = mergeCandidates([
    ...probed.filter((candidate): candidate is Candidate => Boolean(candidate)),
    ...candidates
  ], 8);

  if (candidates.length < 3 && Date.now() < deadline) {
    const origin = new URL(homepage.url).origin;
    const sitemapDocuments = await Promise.all([
      `${origin}/sitemap.xml`,
      `${origin}/sitemap_index.xml`,
      `${origin}/page-sitemap.xml`
    ].map((url) => fetchHttpDocument(url, deadline)));
    pagesUsed += sitemapDocuments.filter(Boolean).length;
    candidates = mergeCandidates([
      ...candidates,
      ...sitemapDocuments.flatMap((document) => document ? extractSitemapCandidates(document) : [])
    ], 8);
  }

  if (candidates.length < 3 && pagesUsed < HTTP_MAX_PAGES && Date.now() < deadline) {
    const crawlLinks = mergeCandidates(
      homepageLinks.filter((candidate) => !candidate.matchedTargetHint),
      Math.min(3, HTTP_MAX_PAGES - pagesUsed)
    );
    const crawlDocuments = await Promise.all(crawlLinks.map((candidate) => fetchHttpDocument(candidate.url, deadline)));
    candidates = mergeCandidates([
      ...candidates,
      ...crawlDocuments.flatMap((document) => document ? extractHttpLinks(document) : [])
    ], 8);
  }

  return candidates;
}

async function getVisibleFormScore(container: Page | Frame) {
  try {
    const inputCount = await container.locator("input, textarea").count().catch(() => 0);
    if (inputCount === 0) return 0;

    return await container
      .locator("form, input:not([type=hidden]), textarea, button[type='submit'], input[type='submit'], button")
      .evaluateAll((elements) => {
        const sliced = elements.slice(0, 50);
        let hasEmail = false;
        let hasMessage = false;
        let hasName = false;
        let hasSubmit = false;
        let hasFormSubmit = false;

        for (const element of sliced) {
          const style = window.getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const rect = element.getBoundingClientRect();
          if (rect.height <= 0) continue;

          const tag = element.tagName.toLowerCase();
          if (tag === "textarea") {
            hasMessage = true;
          } else if (tag === "input") {
            const input = element as HTMLInputElement;
            if (
              input.type === "email" ||
              /email/i.test(input.name ?? "") ||
              /email/i.test(input.placeholder ?? "") ||
              /email/i.test(input.getAttribute("aria-label") ?? "")
            ) {
              hasEmail = true;
            }
            if (/name/i.test(`${input.name ?? ""} ${input.placeholder ?? ""}`)) {
              hasName = true;
            }
            if (input.type === "submit" || /submit|send|contact|request|quote/i.test(input.value ?? "")) {
              hasSubmit = true;
              hasFormSubmit = true;
            }
          } else if (tag === "button") {
            if (element.getAttribute("type") === "submit") hasFormSubmit = true;
            if (/submit|send|contact|request|quote/i.test(element.textContent ?? "")) {
              hasSubmit = true;
            }
          }
        }

        return Number(hasEmail) * 35 + Number(hasMessage) * 25 + Number(hasName) * 15 + Number(hasSubmit || hasFormSubmit) * 25;
      })
      .catch(() => 0);
  } catch {
    return 0;
  }
}

function commonPathCandidates(baseUrl: string): Candidate[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const featureVectors = COMMON_TARGET_PATHS.map((targetPath) => {
    const resolvedUrl = new URL(targetPath, base.origin).toString();
    return extractUniversalFeatureVector(
      { url: resolvedUrl, text: targetPath, sourceType: "synthetic_fallback" },
      baseUrl
    );
  });

  const scored = scoreAndRankCandidates(featureVectors, { maxCandidates: COMMON_TARGET_PATHS.length });

  return scored.map((s) => ({
    url: withoutHash(s.url),
    score: s.finalScore,
    reason: `common path ${new URL(s.url).pathname}`,
    matchedTargetHint: s.finalScore > 0,
    candidateText: s.candidateText,
    candidateHref: s.candidateHref,
    candidateLocation: s.location,
    candidateType: s.candidateType as CandidateType,
    features: s.features,
    depth: 1
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

  const isSynthetic = (c: Candidate) => c.reason.startsWith("common path");

  return Array.from(byUrl.values())
    .sort(
      (a, b) =>
        Number(!isSynthetic(b)) - Number(!isSynthetic(a)) ||
        Number(b.matchedTargetHint) - Number(a.matchedTargetHint) ||
        b.score - a.score
    )
    .slice(0, limit);
}

const TARGET_EXECUTION_ORDER: Record<DiscoveredSubmissionTarget["targetType"], number> = {
  contact_form: 1,
  calendly: 2,
  hubspot_booking: 3,
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

  const relevantFrames = page.frames().filter((frame) => {
    if (frame === page.mainFrame() || !/^https?:/i.test(frame.url())) return false;
    const fUrl = frame.url().toLowerCase();
    if (/google|doubleclick|facebook|analytics|gtm|clarity|hotjar|segment|datadog|sentry|recaptcha|turnstile|hcaptcha/i.test(fUrl)) return false;
    return true;
  }).slice(0, 5);

  for (const frame of relevantFrames) {
    const frameFormScore = await Promise.race([
      getVisibleFormScore(frame),
      new Promise<number>((r) => setTimeout(() => r(0), 1000))
    ]);
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
      if (!isCalendlyEventUrl(resolved) && hostname !== "meetings.hubspot.com") {
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
    : isCalendlyEventUrl(resolved)
      ? "calendly"
      : isPipedriveSchedulerUrl(resolved)
        ? "booking_widget"
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

  if (isCalendlyEventUrl(new URL(currentUrl))) {
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

  if (isPipedriveSchedulerUrl(new URL(currentUrl))) {
    return {
      websiteUrl: url,
      discoveredUrl: currentUrl,
      targetType: "booking_widget",
      confidence: 98,
      reason: `Public Pipedrive scheduler found; ${candidateReason}`,
      checkedUrls: [],
      screenshotPath: await takeScreenshot(page, url, "pipedrive-scheduler-discovered").catch(() => null)
    };
  }

  // 1. Check for embedded forms or booking widgets inside iframes (e.g. Dubsado, LeadConnector, Typeform, Cognito)
  const iframeTarget = await page
    .locator("iframe")
    .evaluateAll((iframes) => {
      for (const iframe of iframes) {
        const src = iframe.getAttribute("src") ?? "";
        if (/hsforms\.com|hubspot|dubsado\.com|typeform\.com|cognitoforms\.com|jotform\.com|marketingautomation\.services|formstack\.com|forms\.office\.com|fillout\.com|airtable\.com\/embed/i.test(src)) {
          return { url: src, type: "contact_form" as const };
        }
        if (/leadconnectorhq\.com\/widget\/booking|calendly\.com|calendar\.google\.com\/calendar\/appointments|tidycal\.com|acuityscheduling\.com/i.test(src)) {
          return { url: src, type: "booking_widget" as const };
        }
        if (/leadconnectorhq\.com\/widget\/form/i.test(src)) {
          return { url: src, type: "contact_form" as const };
        }
      }
      return null;
    })
    .catch(() => null);

  if (iframeTarget) {
    return {
      websiteUrl: url,
      discoveredUrl: iframeTarget.url,
      targetType: iframeTarget.type,
      confidence: 94,
      reason: `Embedded ${iframeTarget.type === "booking_widget" ? "booking widget" : "form"} iframe found; ${candidateReason}`,
      checkedUrls: [],
      screenshotPath: await takeScreenshot(page, url, "embedded-form-discovered").catch(() => null)
    };
  }

  // 2. Prioritize an actual visible form over generic booking-related page copy or URL words.
  const contactTarget = await detectContactTarget(page, url, candidateReason);
  if (contactTarget) return contactTarget;

  // 3. If no actual contact form was found, only check for booking-style URL paths if candidate was an explicit link/CTA or page has calendar/form cues
  const isSyntheticCommonPath = candidateReason.includes("common path");
  if (!isSyntheticCommonPath && /\/(discovery-call|book-call|booking|book-now|scheduler|schedule(-a)?-call|schedule-meeting|appointment)/i.test(new URL(currentUrl).pathname)) {
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

  const hasEmbeddedBookingCalendar = await page.evaluate(() => {
    const bodyHtml = document.body ? document.body.innerHTML : "";
    return (
      bodyHtml.includes('"type":"BookingCalendar"') ||
      bodyHtml.includes("bookingcalendar-") ||
      bodyHtml.includes("leadconnectorhq.com/widget/booking") ||
      bodyHtml.includes("appointment_widgets") ||
      bodyHtml.includes("c-calendar")
    );
  }).catch(() => false);

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
    "discovery call",
    "active calendars",
    "choose a date",
    "select date",
    "select a date",
    "select time",
    "book an appointment"
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

/**
 * Some sites keep their navigation or contact form behind a collapsed menu or
 * a contact modal. Reveal only a small, explicit set of those controls before
 * giving up. This never presses submit controls or attempts form submission.
 */
async function revealInteractiveDiscoveryTargets(page: Page): Promise<number> {
  const triggers = await page
    .locator(INTERACTIVE_DISCOVERY_TRIGGER_SELECTOR)
    .evaluateAll((elements) => {
      const candidates: { index: number }[] = [];
      for (let i = 0; i < elements.length; i++) {
        const control = elements[i] as HTMLElement;
        const text = [
          control.textContent,
          control.getAttribute("aria-label"),
          control.getAttribute("title")
        ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        if (!/\b(menu|navigation|contact|contact us|get in touch|let'?s talk|start a project)\b|☰/i.test(text)) {
          continue;
        }
        if (control.matches("button[type='submit'], input[type='submit']")) continue;
        if (control.getAttribute("aria-expanded") === "true") continue;
        const style = window.getComputedStyle(control);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const rect = control.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        candidates.push({ index: i });
        if (candidates.length >= MAX_INTERACTIVE_DISCOVERY_CLICKS) break;
      }
      return candidates;
    })
    .catch(() => []);

  let clicked = 0;
  for (const trigger of triggers) {
    await page.locator(INTERACTIVE_DISCOVERY_TRIGGER_SELECTOR)
      .nth(trigger.index)
      .click({ timeout: 1_500 })
      .then(() => { clicked += 1; })
      .catch(() => undefined);
  }
  if (clicked > 0) await page.waitForTimeout(250);
  return clicked;
}

async function detectTargetWithLazyScroll(
  page: Page,
  url: string,
  candidateReason: string
): Promise<DiscoverSubmissionTargetResult | null> {
  const initialResult = await detectTargetOnPage(page, url, candidateReason);
  if (initialResult) return initialResult;

  const revealedControls = await revealInteractiveDiscoveryTargets(page);
  if (revealedControls > 0) {
    const revealedResult = await detectTargetOnPage(
      page,
      page.url(),
      `${candidateReason}; checked ${revealedControls} navigation/contact control${revealedControls === 1 ? "" : "s"}`
    );
    if (revealedResult) return revealedResult;
  }

  // Progressive 3-pass scan down the page to trigger lazy-loaded forms
  for (let pass = 1; pass <= 3; pass++) {
    await page.mouse.wheel(0, 1200).catch(() => undefined);
    await page.waitForTimeout(300);
    const scrolledResult = await detectTargetOnPage(page, url, `${candidateReason}; detected during lazy-page scan ${pass}/3`);
    if (scrolledResult) return scrolledResult;
  }
  return null;
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

  if (isCalendlyEventUrl(normalizedUrl)) {
    return {
      websiteUrl: normalizedWebsiteUrl,
      discoveredUrl: normalizedWebsiteUrl,
      targetType: "calendly",
      confidence: 100,
      reason: "Direct Calendly event URL provided.",
      checkedUrls: [normalizedWebsiteUrl],
      screenshotPath: null
    };
  }

  if (isPipedriveSchedulerUrl(normalizedUrl)) {
    return {
      websiteUrl: normalizedWebsiteUrl,
      discoveredUrl: normalizedWebsiteUrl,
      targetType: "booking_widget",
      confidence: 100,
      reason: "Direct public Pipedrive scheduler URL provided.",
      checkedUrls: [normalizedWebsiteUrl],
      screenshotPath: null
    };
  }

  if (isPrivatePipedriveContactUrl(normalizedUrl)) {
    return {
      websiteUrl: normalizedWebsiteUrl,
      discoveredUrl: null,
      targetType: "not_found",
      confidence: 100,
      reason: "This Pipedrive contact URL requires account login. Use that company's public /scheduler/... booking URL instead.",
      checkedUrls: [normalizedWebsiteUrl],
      screenshotPath: null
    };
  }

  if (/\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(contact(-us)?|get-in-touch|reach-us)(\.php|\.html)?\/?$/i.test(normalizedUrl.pathname)) {
    return {
      websiteUrl: normalizedWebsiteUrl,
      discoveredUrl: normalizedWebsiteUrl,
      targetType: "contact_form",
      confidence: 95,
      reason: "Direct contact URL provided.",
      checkedUrls: [normalizedWebsiteUrl],
      screenshotPath: null
    };
  }

  if (/\/(discovery-call|book-call|booking|book-now|scheduler|schedule(-a)?-call|schedule-meeting|consultation|appointment)/i.test(normalizedUrl.pathname)) {
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
    const httpCandidates = await collectHttpDiscoveryCandidates(normalizedWebsiteUrl);
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
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--disable-webgl",
          "--disable-3d-apis",
          "--disable-accelerated-2d-canvas"
        ]
      });

      page = await browser.newPage({
        viewport: { width: 1280, height: 820 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
      });
    }
    page.setDefaultTimeout(timeoutMs);
    await blockHeavyAssets(page);

    let proxy407Hit = false;
    const responseHandler = (res: any) => {
      if (res.status() === 407) proxy407Hit = true;
    };
    page.on("response", responseHandler);

    let navResponse: any = null;
    let navError: any = null;
    try {
      navResponse = await page.goto(normalizedWebsiteUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs
      });
    } catch (err: any) {
      navError = err;
    } finally {
      page.off("response", responseHandler);
    }

    if (proxy407Hit || isProxyAuthenticationFailure(navError) || navResponse?.status() === 407) {
      await takeScreenshot(page, normalizedWebsiteUrl, "proxy-407-failure").catch(() => null);
      throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
    }

    const initialBodyText = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
    if (isProxyAuthenticationFailure(null, navResponse?.status(), initialBodyText)) {
      await takeScreenshot(page, normalizedWebsiteUrl, "proxy-407-failure").catch(() => null);
      throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
    }

    const statusCode = navResponse?.status();
    const pageTitle = await page.title().catch(() => "");
    if (statusCode === 403 || /403 forbidden/i.test(pageTitle) || /^403 forbidden/i.test(initialBodyText.trim())) {
      return {
        websiteUrl: normalizedWebsiteUrl,
        discoveredUrl: null,
        targetType: "not_found",
        confidence: 0,
        reason: "Website blocked access (HTTP 403 Forbidden).",
        checkedUrls: [normalizedWebsiteUrl],
        screenshotPath: await takeScreenshot(page, normalizedWebsiteUrl, "http-403-forbidden").catch(() => null)
      };
    }

    const homepageLoaded = Boolean(navResponse && !navError);
    if (homepageLoaded) {
      await dismissCookieBanners(page).catch(() => undefined);
      // Do not wait indefinitely for background trackers/analytics.
      // 2.5s networkidle or immediate DOM interactive is plenty.
      await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => undefined);
      await page.waitForTimeout(400);
    }

    const verification = await detectUnsupportedVerification(page, normalizedWebsiteUrl);
    if (verification) {
      return {
        websiteUrl: normalizedWebsiteUrl,
        discoveredUrl: null,
        targetType: "not_found",
        confidence: 0,
        reason: verification.reason,
        checkedUrls: [normalizedWebsiteUrl],
        screenshotPath: verification.screenshotPath
      };
    }

    const directResult = homepageLoaded
      ? await detectTargetWithLazyScroll(page, page.url(), "entered URL already works")
      : null;

    if (directResult?.targetType === "contact_form") {
      return { ...directResult, websiteUrl: normalizedWebsiteUrl, checkedUrls: [page.url()] };
    }
    const homepageBookingResult = directResult;

    const navigationCandidates = mergeCandidates([
      ...httpCandidates,
      ...(homepageLoaded ? await collectNavigationCandidates(page, page.url()) : [])
    ], maxNavigationLinks);
    const fallbackCandidates = mergeCandidates(
      commonPathCandidates(homepageLoaded ? page.url() : normalizedWebsiteUrl),
      maxFallbackPaths
    );
    const candidates = [...navigationCandidates, ...fallbackCandidates];
    const discoveryDeadline = Date.now() + timeoutMs;

    for (const candidate of candidates) {
      if (Date.now() >= discoveryDeadline) {
        break;
      }
      checkedUrls.push(candidate.url);

      const remainingCandidateTimeout = Math.max(2000, Math.min(12000, discoveryDeadline - Date.now()));
      const candidateLoaded = await page
        .goto(candidate.url, {
          waitUntil: "domcontentloaded",
          timeout: remainingCandidateTimeout
        })
        .then(() => true)
        .catch(() => false);

      if (!candidateLoaded) {
        continue;
      }

      await dismissCookieBanners(page).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(300);

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
    if (isProxyAuthenticationFailure(error)) {
      throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
    }
    return {
      websiteUrl: normalizedWebsiteUrl,
      discoveredUrl: null,
      targetType: "not_found",
      confidence: 0,
      reason: redactProxyDetails(error instanceof Error ? error.message : "Target discovery failed."),
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

async function discoverSubmissionTargetsInternal({
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
    const cleanNormalized = withoutHash(normalizedWebsiteUrl).replace(/\/+$/, "");
    const cleanUrl = url.replace(/\/+$/, "");
    const isSuppliedPage = cleanUrl === cleanNormalized;
    const discoveryResult = isSuppliedPage ? "FOUND_ON_SUPPLIED_PAGE" : "FOUND_ON_OTHER_PAGE";
    const target: DiscoveredSubmissionTarget = {
      targetType,
      url,
      executionOrder: TARGET_EXECUTION_ORDER[targetType],
      confidence: result.confidence,
      reason: result.reason,
      screenshotPath: result.screenshotPath,
      metadata: {
        discoveredFrom: normalizedWebsiteUrl,
        discoveryResult
      }
    };
    const existing = discovered.get(key);
    if (!existing || target.confidence > existing.confidence) discovered.set(key, target);
  };

  try {
    const httpCandidates = await collectHttpDiscoveryCandidates(normalizedWebsiteUrl);
    for (const candidate of httpCandidates) {
      addResult(resultFromSupportedExternalCandidate(normalizedWebsiteUrl, candidate));
    }

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
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--disable-webgl",
          "--disable-3d-apis",
          "--disable-accelerated-2d-canvas"
        ]
      });
      page = await browser.newPage({
        viewport: { width: 1280, height: 820 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
      });
    }
    page.setDefaultTimeout(timeoutMs);
    await blockHeavyAssets(page);

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
    page.on("response", responseHandler);

    let navResponse: any = null;
    let navError: any = null;
    try {
      navResponse = await Promise.race([
        page.goto(normalizedWebsiteUrl, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs
        }),
        proxy407Promise
      ]);
    } catch (err: any) {
      navError = err;
    } finally {
      page.off("response", responseHandler);
    }

    if (proxy407Hit || isProxyAuthenticationFailure(navError) || navResponse?.status() === 407) {
      throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
    }

    const pageBodyText = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
    if (isProxyAuthenticationFailure(null, navResponse?.status(), pageBodyText)) {
      await takeScreenshot(page, normalizedWebsiteUrl, "proxy-407-failure").catch(() => null);
      throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
    }

    if (navError && !navResponse) {
      return {
        websiteUrl: normalizedWebsiteUrl,
        targets: [],
        checkedUrls: [normalizedWebsiteUrl],
        reason: redactProxyDetails(navError.message || "The website could not be loaded for multi-target discovery."),
        screenshotPath: await takeScreenshot(page, normalizedWebsiteUrl, "target-not-found").catch(() => null)
      };
    }

    const statusCode = navResponse?.status();
    const pageTitle = await page.title().catch(() => "");
    if (statusCode === 403 || /403 forbidden/i.test(pageTitle) || /^403 forbidden/i.test(pageBodyText.trim())) {
      return {
        websiteUrl: normalizedWebsiteUrl,
        targets: [],
        checkedUrls: [normalizedWebsiteUrl],
        reason: "Website blocked access (HTTP 403 Forbidden).",
        screenshotPath: await takeScreenshot(page, normalizedWebsiteUrl, "http-403-forbidden").catch(() => null)
      };
    }

    if (statusCode === 202 && (/robot challenge/i.test(pageTitle) || /security/i.test(pageBodyText))) {
      return {
        websiteUrl: normalizedWebsiteUrl,
        targets: [],
        checkedUrls: [normalizedWebsiteUrl],
        reason: "Unsupported verification: Robot Challenge Screen detected. Manual verification required.",
        screenshotPath: await takeScreenshot(page, normalizedWebsiteUrl, "robot-challenge-202").catch(() => null)
      };
    }

    // Check for CAPTCHA, Cloudflare managed challenge, or bot-detection screens
    const verification = await detectUnsupportedVerification(page, normalizedWebsiteUrl);
    if (verification) {
      return {
        websiteUrl: normalizedWebsiteUrl,
        targets: [],
        checkedUrls: [normalizedWebsiteUrl],
        reason: verification.reason,
        screenshotPath: verification.screenshotPath
      };
    }

    // Auto-accept cookie banners so nav links and forms are visible
    await dismissCookieBanners(page).catch(() => undefined);
    await page.waitForTimeout(700);
    await dismissCookieBanners(page).catch(() => undefined);
    checkedUrls.push(withoutHash(page.url()));
    const directResult = await detectTargetWithLazyScroll(page, page.url(), "entered URL already works");
    addResult(directResult);

    // A direct public scheduling URL is already the exact target. Continuing
    // through navigation wastes the remaining automation budget on unrelated forms.
    if (directResult?.targetType === "calendly" || directResult?.targetType === "hubspot_booking") {
      const targets = Array.from(discovered.values()).sort(
        (a, b) => a.executionOrder - b.executionOrder || b.confidence - a.confidence || a.url.localeCompare(b.url)
      );
      return {
        websiteUrl: normalizedWebsiteUrl,
        targets,
        checkedUrls,
        reason: "The entered URL is a direct booking page.",
        screenshotPath: targets[0]?.screenshotPath
      };
    }

    // Fast-path: if a contact form is already present on the page, use it immediately
    // rather than spending seconds crawling secondary navigation links.
    if (directResult?.targetType === "contact_form") {
      const targets = Array.from(discovered.values()).sort(
        (a, b) => a.executionOrder - b.executionOrder || b.confidence - a.confidence || a.url.localeCompare(b.url)
      );
      return {
        websiteUrl: normalizedWebsiteUrl,
        targets,
        checkedUrls,
        reason: "Contact form found directly on the entered page.",
        screenshotPath: targets[0]?.screenshotPath
      };
    }

    const supportedExternalCandidates = await collectSupportedExternalCandidates(page, page.url());
    for (const candidate of supportedExternalCandidates) {
      addResult(resultFromSupportedExternalCandidate(normalizedWebsiteUrl, candidate));
    }

    const navigationCandidates = mergeCandidates([
      ...httpCandidates,
      ...supportedExternalCandidates,
      ...(await collectNavigationCandidates(page, page.url()))
    ], maxNavigationLinks);
    const fallbackCandidates = mergeCandidates(commonPathCandidates(page.url()), maxFallbackPaths);
    const maxPageVisits = 6;
    const candidatesQueue: Candidate[] = mergeCandidates([...navigationCandidates, ...fallbackCandidates], maxNavigationLinks + maxFallbackPaths);

    let candidateIndex = 0;
    while (candidateIndex < candidatesQueue.length) {
      if (Array.from(discovered.values()).some((target) => target.targetType === "contact_form")) break;
      if (checkedUrls.length >= maxPageVisits) break;

      const candidate = candidatesQueue[candidateIndex++];
      const candidateUrl = withoutHash(candidate.url);
      if (checkedUrls.includes(candidateUrl)) continue;
      checkedUrls.push(candidateUrl);

      const currentDepth = candidate.depth || 1;
      console.log(`[CONTACT-DISCOVERY] Trying candidate (depth ${currentDepth}): ${candidate.url} (reason: ${candidate.reason})`);

      const features = candidate.features || extractUniversalFeatureVector(
        {
          url: candidate.url,
          text: candidate.candidateText || candidate.reason,
          sourceType: candidate.candidateLocation === "body" ? "dom_anchor" : "dom_anchor"
        },
        normalizedWebsiteUrl
      );
      const mappedType = (candidate.candidateType?.toLowerCase() === "cta" ? "cta" : (candidate.candidateType || "anchor")) as any;

      const loaded = await page.goto(candidate.url, {
        waitUntil: "domcontentloaded",
        timeout: Math.min(timeoutMs, 7000)
      }).then(() => true).catch(() => false);

      if (!loaded) {
        console.log(`[CONTACT-DISCOVERY] Failed to load candidate: ${candidate.url}`);
        recordDiscoveryFeedback(
          normalizedWebsiteUrl,
          {
            url: candidate.url,
            normalizedUrl: candidate.url,
            candidateText: candidate.candidateText || "",
            candidateHref: candidate.candidateHref || candidate.url,
            location: candidate.candidateLocation || "body",
            candidateType: mappedType,
            features,
            ruleScore: candidate.score,
            mlScore: 0,
            finalScore: candidate.score,
            rank: checkedUrls.length,
            reason: candidate.reason
          },
          false,
          false,
          false,
          "none",
          0,
          "NAVIGATION_FAILED",
          currentDepth
        ).catch(() => undefined);
        continue;
      }

      await dismissCookieBanners(page).catch(() => undefined);
      // Bounded wait for dynamic client-side forms (HubSpot, Marketo, LeadConnector, SPA embeds)
      await page
        .locator("form:not([action*='search']), input:not([type=hidden]):not([type=search]), textarea, iframe[src*='hsforms'], iframe[src*='marketo']")
        .first()
        .waitFor({ state: "attached", timeout: 2500 })
        .catch(() => undefined);
      await page.waitForTimeout(400);
      const candResult = await detectTargetWithLazyScroll(page, page.url(), candidate.reason);
      addResult(candResult);

      const formFound = Boolean(candResult && candResult.targetType !== "not_found");
      const formType = (formFound && candResult ? candResult.targetType : "none") as "contact_form" | "booking_widget" | "none";
      const fieldsDetected = formFound ? 1 : 0;

      const pageTitle = await page.title().catch(() => "");
      const isContactPage = formFound ||
        /contact|get[- ]in[- ]touch|reach[- ]us|let'?s[- ]talk|book[- ]a[- ]call|schedule/i.test(page.url()) ||
        /contact|get[- ]in[- ]touch|reach[- ]us|let'?s[- ]talk/i.test(pageTitle) ||
        features.contactKeywordSignals > 0 ||
        features.bookingKeywordSignals > 0;

      const outcome = formFound
        ? "FORM_FOUND"
        : isContactPage
          ? "CONTACT_PAGE_NO_FORM"
          : "IRRELEVANT_PAGE";

      // Async record sanitized feedback for offline learning
      recordDiscoveryFeedback(
        normalizedWebsiteUrl,
        {
          url: candidate.url,
          normalizedUrl: candidate.url,
          candidateText: candidate.candidateText || "",
          candidateHref: candidate.candidateHref || candidate.url,
          location: candidate.candidateLocation || "body",
          candidateType: mappedType,
          features,
          ruleScore: candidate.score,
          mlScore: 0,
          finalScore: candidate.score,
          rank: checkedUrls.length,
          reason: candidate.reason
        },
        true,
        isContactPage,
        formFound,
        formType,
        fieldsDetected,
        outcome,
        currentDepth
      ).catch(() => undefined);

      if (candResult && candResult.targetType !== "not_found") {
        console.log(
          `[CONTACT-DISCOVERY] FORM/WIDGET FOUND: targetType=${candResult.targetType} source=${candidate.candidateLocation || "other"} status=FOUND_ON_OTHER_PAGE url=${candResult.discoveredUrl}`
        );
        if (candResult.targetType === "contact_form") break;
      } else if (
        currentDepth < 2 &&
        (features.consultationSignals > 0.7 || features.leadSignals > 0.7 || isContactPage) &&
        checkedUrls.length < maxPageVisits
      ) {
        // Adaptive Depth-2 exploration: strong intent page without an inline form.
        // Look for CTAs/links on this page that lead to the actual form or booking flow.
        try {
          const depth2Candidates = await collectNavigationCandidates(page, page.url(), 3);
          for (const d2 of depth2Candidates) {
            const d2Url = withoutHash(d2.url);
            if (!checkedUrls.includes(d2Url) && !candidatesQueue.some((c) => withoutHash(c.url) === d2Url)) {
              candidatesQueue.push({
                ...d2,
                depth: 2,
                reason: `${d2.reason} (Depth-2 from ${candidate.url})`
              });
            }
          }
        } catch (err) {
          console.warn("[CONTACT-DISCOVERY] Error during Depth-2 candidate collection:", err);
        }
      }
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
        : `No supported contact form found on the supplied page or relevant discovered pages.`,
      screenshotPath: targets[0]?.screenshotPath ?? await takeScreenshot(page, normalizedWebsiteUrl, "target-not-found").catch(() => null)
    };
  } catch (error) {
    if (isProxyAuthenticationFailure(error)) {
      throw new ProxyAuthenticationError(PROXY_407_MESSAGE);
    }
    return {
      websiteUrl: normalizedWebsiteUrl,
      targets: Array.from(discovered.values()).sort((a, b) => a.executionOrder - b.executionOrder),
      checkedUrls,
      reason: redactProxyDetails(error instanceof Error ? error.message : "Unknown multi-target discovery error."),
      screenshotPath: null
    };
  } finally {
    if (page && browserContext) await page.close().catch(() => undefined);
    else await browser?.close().catch(() => undefined);
  }
}

export async function discoverSubmissionTargets(
  input: DiscoverSubmissionTargetInput & { browserContext?: BrowserContext }
): Promise<DiscoverSubmissionTargetsResult> {
  const timeoutMs = input.timeoutMs ?? 8000;
  const overallBudgetMs = Math.max(timeoutMs * 4, 60000);
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<DiscoverSubmissionTargetsResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        websiteUrl: input.websiteUrl,
        targets: [],
        checkedUrls: [input.websiteUrl],
        reason: `Target discovery exceeded overall budget limit (${Math.round(overallBudgetMs / 1000)}s).`,
        screenshotPath: null
      });
    }, overallBudgetMs);
  });

  try {
    return await Promise.race([discoverSubmissionTargetsInternal(input), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
