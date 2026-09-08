import { CandidateFeatureVector } from "./types";
import { RawCandidate } from "./candidate-extractor";
import { PageContext } from "./page-context-analyzer";

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function extractFeatureVector(
  raw: RawCandidate,
  baseUrl: string,
  pageContext: PageContext
): CandidateFeatureVector {
  const base = new URL(baseUrl);
  const targetUrl = new URL(raw.href, base);

  const normalizedText = normalizeText(raw.text);
  const normalizedAria = normalizeText(raw.ariaLabel);
  const normalizedTitle = normalizeText(raw.title);
  const normalizedParent = normalizeText(raw.parentText);

  const pathSegments = targetUrl.pathname
    .split("/")
    .filter(Boolean)
    .flatMap((s) => s.split(/[-_]/))
    .map((s) => s.toLowerCase());

  const combinedSemantics = `${normalizedText} ${normalizedAria} ${normalizedTitle} ${pathSegments.join(" ")}`;

  // 1. Contact Intent Signal (0.0 to 1.0)
  let contactScore = 0.0;
  if (normalizedText === "contact" || /\bcontact\b/i.test(normalizedText)) contactScore = 1.0;
  else if (combinedSemantics.includes("contact us") || combinedSemantics.includes("contact-us")) contactScore = 0.95;
  else if (combinedSemantics.includes("get in touch") || combinedSemantics.includes("reach us")) contactScore = 0.90;
  else if (combinedSemantics.includes("let's talk") || combinedSemantics.includes("lets talk") || combinedSemantics.includes("talk to us")) contactScore = 0.85;
  else if (combinedSemantics.includes("connect") || combinedSemantics.includes("inquire")) contactScore = 0.70;
  else if (pathSegments.includes("contact") || pathSegments.includes("reach")) contactScore = 0.80;

  // 2. Booking Intent Signal (0.0 to 1.0)
  let bookingScore = 0.0;
  if (
    targetUrl.hostname.includes("calendly.com") ||
    targetUrl.hostname.includes("meetings.hubspot.com") ||
    targetUrl.hostname.includes("pipedrive.com")
  ) {
    bookingScore = 1.0;
  } else if (combinedSemantics.includes("book a call") || combinedSemantics.includes("schedule a call")) {
    bookingScore = 1.0;
  } else if (combinedSemantics.includes("book call") || combinedSemantics.includes("schedule call")) {
    bookingScore = 0.95;
  } else if (combinedSemantics.includes("book a meeting") || combinedSemantics.includes("schedule a meeting")) {
    bookingScore = 0.90;
  } else if (combinedSemantics.includes("book now") || combinedSemantics.includes("schedule now")) {
    bookingScore = 0.85;
  } else if (/\b(schedule|book|calendar|appointment|meeting)\b/i.test(combinedSemantics)) {
    bookingScore = 0.85;
  } else if (pathSegments.includes("schedule") || pathSegments.includes("book") || pathSegments.includes("appointment")) {
    bookingScore = 0.80;
  }

  // 3. Consultation / Quote Intent Signal (0.0 to 1.0)
  let consultationScore = 0.0;
  if (combinedSemantics.includes("request a quote") || combinedSemantics.includes("get a quote")) consultationScore = 0.95;
  else if (combinedSemantics.includes("free consultation") || combinedSemantics.includes("request consultation")) consultationScore = 0.90;
  else if (combinedSemantics.includes("consultation") || combinedSemantics.includes("quote")) consultationScore = 0.85;
  else if (combinedSemantics.includes("estimate") || combinedSemantics.includes("request demo") || combinedSemantics.includes("book demo")) consultationScore = 0.80;
  else if (pathSegments.includes("quote") || pathSegments.includes("consultation")) consultationScore = 0.80;

  // 4. Lead Intent Signal (0.0 to 1.0)
  let leadScore = 0.0;
  if (combinedSemantics.includes("get started") || combinedSemantics.includes("start a project") || combinedSemantics.includes("start something")) leadScore = 0.85;
  else if (combinedSemantics.includes("work with us") || combinedSemantics.includes("let's work together") || combinedSemantics.includes("let's start something")) leadScore = 0.85;
  else if (combinedSemantics.includes("talk to sales") || combinedSemantics.includes("speak with an expert") || combinedSemantics.includes("talk to an expert")) leadScore = 0.80;
  else if (combinedSemantics.includes("ready to grow") || combinedSemantics.includes("tell us about your project") || combinedSemantics.includes("start a conversation")) leadScore = 0.75;
  else if (pathSegments.includes("start") || pathSegments.includes("inquire")) leadScore = 0.70;

  // 5. Negative Signal (0.0 to 1.0)
  let negativeScore = 0.0;
  if (
    combinedSemantics.includes("privacy") ||
    combinedSemantics.includes("terms") ||
    combinedSemantics.includes("cookie") ||
    combinedSemantics.includes("login") ||
    combinedSemantics.includes("cart") ||
    combinedSemantics.includes("checkout")
  ) {
    negativeScore = 1.0;
  } else if (
    combinedSemantics.includes("blog") ||
    combinedSemantics.includes("news") ||
    combinedSemantics.includes("article") ||
    combinedSemantics.includes("career") ||
    combinedSemantics.includes("job")
  ) {
    negativeScore = 0.7;
  } else if (
    combinedSemantics.includes("about") ||
    combinedSemantics.includes("team") ||
    combinedSemantics.includes("pricing")
  ) {
    negativeScore = 0.4;
  }

  const isHeader = raw.location === "header";
  const isNav = raw.location === "nav";
  const isFooter = raw.location === "footer";
  const isMain = raw.location === "main CTA" || raw.location === "body";
  const isHero = raw.location === "hero";
  const isCTA = raw.candidateType === "cta" || raw.location === "main CTA" || raw.location === "hero";
  const isButton = raw.candidateType === "button";
  const isAnchor = raw.candidateType === "anchor";

  return {
    url: raw.href,
    normalizedUrl: targetUrl.origin + targetUrl.pathname,
    urlTokens: pathSegments,
    urlPathDepth: targetUrl.pathname.split("/").filter(Boolean).length,
    sameDomain: targetUrl.origin === base.origin,

    rawText: raw.text,
    normalizedText,
    ariaLabel: normalizedAria,
    titleAttr: normalizedTitle,
    parentText: normalizedParent,
    nearbyText: raw.nearbyText,

    elementType: raw.candidateType,
    location: raw.location,
    isHeader,
    isNav,
    isFooter,
    isMain,
    isHero,
    isCTA,
    isButton,
    isAnchor,
    hasOnClick: raw.hasOnClick,
    hasAriaLabel: Boolean(raw.ariaLabel),
    hasTitle: Boolean(raw.title),
    distanceFromTop: raw.distanceFromTop,
    mobileMenuSource: raw.mobileMenuSource,

    contactKeywordSignals: contactScore,
    bookingKeywordSignals: bookingScore,
    consultationSignals: consultationScore,
    leadSignals: leadScore,
    negativeSignals: negativeScore,

    pageTitle: pageContext.pageTitle,
    pageHasExistingForm: pageContext.hasExistingForm,
    pageHasPhoneOrEmailOnly: pageContext.hasPhoneOrEmailOnly,
    pageHeadingKeywords: pageContext.contactKeywordsInHeadings
  };
}
