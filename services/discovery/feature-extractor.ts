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
    domDepth?: number;
    isRightmostNav?: boolean;
    isProminentButton?: boolean;
    isModalTrigger?: boolean;
    modalTargetSelector?: string;
    mobileMenuSource?: boolean;
    recognizedProvider?: string;
    navigationDepth?: number;
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

  // 1. Multi-Lingual Contact Intent Signal (0.0 to 1.0)
  let contactScore = 0.0;
  const contactStems = /\b(contact|kontakt|contacto|contatt|contat|touch|reach|fale|anfrage|nachricht|devis|presupuesto|preventivo|offerte|parlons|hablemos|inquir|inquiry)\b/i;
  if (normalizedText === "contact" || contactStems.test(normalizedText)) {
    contactScore = 1.0;
  } else if (contactStems.test(combinedSemantics)) {
    contactScore = 0.92;
  } else if (pathSegments.some((p) => contactStems.test(p))) {
    contactScore = 0.88;
  }

  // 2. Multi-Lingual Booking Intent Signal (0.0 to 1.0)
  let bookingScore = 0.0;
  const bookingStems = /\b(book|schedule|appointment|calendar|meeting|termin|rendez-vous|cita|appuntamento|agenda|prenota|reserva|boeken)\b/i;
  if (
    targetUrl.hostname.includes("calendly.com") ||
    targetUrl.hostname.includes("meetings.hubspot.com") ||
    targetUrl.hostname.includes("pipedrive.com")
  ) {
    bookingScore = 1.0;
  } else if (bookingStems.test(normalizedText)) {
    bookingScore = 0.95;
  } else if (bookingStems.test(combinedSemantics)) {
    bookingScore = 0.90;
  } else if (pathSegments.some((p) => bookingStems.test(p))) {
    bookingScore = 0.85;
  }

  // 3. Multi-Lingual Consultation & Quote Signal (0.0 to 1.0)
  let consultationScore = 0.0;
  const quoteStems = /\b(consultation|consult|quote|estimate|proposal|budget|tarif|kostenvoranschlag|devis|presupuesto|preventivo|orçamento|evaluation|audit)\b/i;
  if (quoteStems.test(normalizedText)) {
    consultationScore = 0.95;
  } else if (quoteStems.test(combinedSemantics)) {
    consultationScore = 0.88;
  } else if (pathSegments.some((p) => quoteStems.test(p))) {
    consultationScore = 0.85;
  }

  // 4. Multi-Lingual Lead & Project Start Signal (0.0 to 1.0)
  let leadScore = 0.0;
  const startStems = /\b(start|begin|get started|work with|let'?s talk|start project|demarrer|iniciar|progetto|vamos|grow|scale|launch)\b/i;
  if (startStems.test(normalizedText)) {
    leadScore = 0.90;
  } else if (startStems.test(combinedSemantics)) {
    leadScore = 0.80;
  }

  // 5. Negative Intent Signals
  let negativeScore = 0.0;
  const negativeStems = /\b(privacy|terms|cookie|cookies|login|signin|sign-in|cart|checkout|panier|warenkorb|carrello|anmelden|connexion|acceder|careers|jobs|blog|articles?)\b/i;
  if (negativeStems.test(normalizedText)) {
    negativeScore = 1.0;
  } else if (pathSegments.some((p) => negativeStems.test(p))) {
    negativeScore = 0.85;
  } else if (negativeStems.test(combinedSemantics)) {
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
    if (contactStems.test(headingText) || bookingStems.test(headingText) || quoteStems.test(headingText)) {
      headingContextScore = 0.85;
    }
  }

  let pageTitleContextScore = 0.0;
  if (pageContext?.pageTitle) {
    const titleLower = pageContext.pageTitle.toLowerCase();
    if (contactStems.test(titleLower) || bookingStems.test(titleLower) || quoteStems.test(titleLower)) {
      pageTitleContextScore = 0.85;
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
  const isButton = elementType === "button" || elementType === "modal_trigger";
  const isAnchor = elementType === "anchor";

  return {
    url: params.url,
    normalizedUrl: targetUrl.origin + targetUrl.pathname,
    urlTokens: pathSegments,
    urlPathDepth: targetUrl.pathname.split("/").filter(Boolean).length,
    sameDomain: targetUrl.origin === base.origin,
    sourceType,

    detectedLanguage: pageContext?.detectedLanguage ?? "unknown",

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
    isRightmostNav: Boolean(params.isRightmostNav),
    isProminentButton: Boolean(params.isProminentButton),
    hasOnClick: Boolean(params.hasOnClick),
    hasAriaLabel: Boolean(params.ariaLabel),
    hasTitle: Boolean(params.title),
    distanceFromTop: params.distanceFromTop ?? 0.5,
    domDepth: params.domDepth ?? 3,
    mobileMenuSource: Boolean(params.mobileMenuSource),
    isModalTrigger: Boolean(params.isModalTrigger),
    modalTargetSelector: params.modalTargetSelector,

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
    pageHeadingKeywords: pageContext?.contactKeywordsInHeadings ?? [],

    recognizedProvider: params.recognizedProvider,
    navigationDepth: params.navigationDepth ?? 1
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
      sourceType: raw.isModalTrigger
        ? "modal_trigger"
        : raw.candidateType === "button"
          ? "dom_button"
          : "dom_anchor",
      hasOnClick: raw.hasOnClick,
      distanceFromTop: raw.distanceFromTop,
      domDepth: raw.domDepth,
      isRightmostNav: raw.isRightmostNav,
      isProminentButton: raw.isProminentButton,
      isModalTrigger: raw.isModalTrigger,
      modalTargetSelector: raw.modalTargetSelector,
      mobileMenuSource: raw.mobileMenuSource
    },
    baseUrl,
    pageContext
  );
}
