import { CandidateFeatureVector } from "./types";
import { RawCandidate } from "./candidate-extractor";
import { PageContext } from "./page-context-analyzer";

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

// Contextual Semantic Patterns (Broad Intent Categories beyond exact keywords)
const CONVERSATION_PATTERNS = [
  /\b(start|begin|open)\s+(a\s+)?(conversation|dialogue|discussion)\b/i,
  /\b(discuss|tell\s+us\s+about)\s+(your|a)\s+(project|goals?|needs?|vision|requirements?)\b/i,
  /\b(speak|talk)\s+with\s+(our|a|an)\s+(team|specialist|expert|representative|advisor)\b/i,
  /\b(connect\s+with\s+us|let's\s+connect)\b/i
];

const PROJECT_PATTERNS = [
  /\b(build|create|launch|start|kickoff)\s+(something|together|your\s+project|with\s+us)\b/i,
  /\b(start|begin)\s+your\s+(journey|transformation|growth)\b/i,
  /\b(ready\s+to\s+grow|take\s+the\s+next\s+step|work\s+together)\b/i
];

const ADVISORY_PATTERNS = [
  /\b(talk|speak|meet|consult)\s+(with\s+)?(an?\s+)?(advisor|consultant|strategist|attorney|lawyer|doctor|dentist|expert)\b/i,
  /\b(complimentary|free)\s+(consultation|evaluation|assessment|review|audit)\b/i
];

const INFORMATION_PATTERNS = [
  /\b(request|inquire|ask\s+for)\s+(more\s+)?(info|information|details|brochure|packet)\b/i,
  /\b(find|discover)\s+the\s+right\s+solution\b/i,
  /\b(how\s+can\s+we\s+help|get\s+help|need\s+assistance)\b/i
];

export function extractUniversalFeatureVector(
  params: {
    url: string;
    text?: string;
    ariaLabel?: string;
    title?: string;
    parentText?: string;
    nearbyText?: string;
    location?: RawCandidate["location"];
    candidateType?: RawCandidate["candidateType"];
    sourceType?: import("./types").CandidateSourceType;
    hasOnClick?: boolean;
    distanceFromTop?: number;
    mobileMenuSource?: boolean;
  },
  baseUrl: string,
  pageContext?: PageContext
): CandidateFeatureVector {
  const base = new URL(baseUrl);
  const targetUrl = new URL(params.url, base);

  const rawText = params.text ?? "";
  const normalizedText = normalizeText(rawText);
  const normalizedAria = normalizeText(params.ariaLabel ?? "");
  const normalizedTitle = normalizeText(params.title ?? "");
  const normalizedParent = normalizeText(params.parentText ?? "");
  const nearbyText = params.nearbyText ?? "";

  const pathSegments = targetUrl.pathname
    .split("/")
    .filter(Boolean)
    .flatMap((s) => s.split(/[-_]/))
    .map((s) => s.toLowerCase());

  const combinedSemantics = `${normalizedText} ${normalizedAria} ${normalizedTitle} ${normalizedParent} ${pathSegments.join(" ")}`;

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

  // 6. Contextual Intent Categories (Normalized 0.0 to 1.0)
  let conversationIntent = 0.0;
  for (const pat of CONVERSATION_PATTERNS) {
    if (pat.test(combinedSemantics)) {
      conversationIntent = 0.85;
      break;
    }
  }

  let projectIntent = 0.0;
  for (const pat of PROJECT_PATTERNS) {
    if (pat.test(combinedSemantics)) {
      projectIntent = 0.80;
      break;
    }
  }

  let advisoryIntent = 0.0;
  for (const pat of ADVISORY_PATTERNS) {
    if (pat.test(combinedSemantics)) {
      advisoryIntent = 0.85;
      break;
    }
  }

  let informationIntent = 0.0;
  for (const pat of INFORMATION_PATTERNS) {
    if (pat.test(combinedSemantics)) {
      informationIntent = 0.75;
      break;
    }
  }

  // 7. Structural Context Alignment
  let headingContextScore = 0.0;
  if (pageContext?.contactKeywordsInHeadings?.length) {
    const headingText = pageContext.contactKeywordsInHeadings.join(" ").toLowerCase();
    if (headingText.includes("contact") || headingText.includes("touch") || headingText.includes("help")) {
      headingContextScore = 0.8;
    }
  }

  let pageTitleContextScore = 0.0;
  if (pageContext?.pageTitle) {
    const titleLower = pageContext.pageTitle.toLowerCase();
    if (titleLower.includes("contact") || titleLower.includes("consultation") || titleLower.includes("quote")) {
      pageTitleContextScore = 0.8;
    }
  }

  const location = params.location ?? "body";
  const elementType = params.candidateType ?? "anchor";
  const sourceType = params.sourceType ?? "dom_anchor";

  const isHeader = location === "header";
  const isNav = location === "nav";
  const isFooter = location === "footer";
  const isMain = location === "main CTA" || location === "body";
  const isHero = location === "hero";
  const isCTA = elementType === "cta" || location === "main CTA" || location === "hero";
  const isButton = elementType === "button";
  const isAnchor = elementType === "anchor";

  return {
    url: params.url,
    normalizedUrl: targetUrl.origin + targetUrl.pathname,
    urlTokens: pathSegments,
    urlPathDepth: targetUrl.pathname.split("/").filter(Boolean).length,
    sameDomain: targetUrl.origin === base.origin,
    sourceType,

    rawText,
    normalizedText,
    ariaLabel: normalizedAria,
    titleAttr: normalizedTitle,
    parentText: normalizedParent,
    nearbyText,

    elementType,
    location,
    isHeader,
    isNav,
    isFooter,
    isMain,
    isHero,
    isCTA,
    isButton,
    isAnchor,
    hasOnClick: Boolean(params.hasOnClick),
    hasAriaLabel: Boolean(params.ariaLabel),
    hasTitle: Boolean(params.title),
    distanceFromTop: params.distanceFromTop ?? 0.5,
    mobileMenuSource: Boolean(params.mobileMenuSource),

    contactKeywordSignals: contactScore,
    bookingKeywordSignals: bookingScore,
    consultationSignals: consultationScore,
    leadSignals: leadScore,
    negativeSignals: negativeScore,

    conversationIntent,
    projectIntent,
    advisoryIntent,
    informationIntent,

    headingContextScore,
    pageTitleContextScore,
    pageTitle: pageContext?.pageTitle ?? "",
    pageHasExistingForm: Boolean(pageContext?.hasExistingForm),
    pageHasPhoneOrEmailOnly: Boolean(pageContext?.hasPhoneOrEmailOnly),
    pageHeadingKeywords: pageContext?.contactKeywordsInHeadings ?? []
  };
}

export function extractFeatureVector(
  raw: RawCandidate,
  baseUrl: string,
  pageContext: PageContext
): CandidateFeatureVector {
  return extractUniversalFeatureVector(
    {
      url: raw.href,
      text: raw.text,
      ariaLabel: raw.ariaLabel,
      title: raw.title,
      parentText: raw.parentText,
      nearbyText: raw.nearbyText,
      location: raw.location,
      candidateType: raw.candidateType,
      sourceType: raw.candidateType === "button" ? "dom_button" : "dom_anchor",
      hasOnClick: raw.hasOnClick,
      distanceFromTop: raw.distanceFromTop,
      mobileMenuSource: raw.mobileMenuSource
    },
    baseUrl,
    pageContext
  );
}
