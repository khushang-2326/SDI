import { CandidateFeatureVector } from "./types";

export function calculateRuleScore(features: CandidateFeatureVector): number {
  let score = 0;

  // 1. Semantic Intent Signals (Multi-Lingual Stems)
  // Direct Contact intent: 85 - 95
  if (features.contactKeywordSignals > 0) {
    score = Math.max(score, 85 + features.contactKeywordSignals * 10);
  }
  // Direct Booking intent: 75 - 85
  if (features.bookingKeywordSignals > 0) {
    score = Math.max(score, 75 + features.bookingKeywordSignals * 10);
  }
  // Consultation / Lead intent: 65 - 75
  if (features.consultationSignals > 0) {
    score = Math.max(score, 65 + features.consultationSignals * 10);
  }
  if (features.leadSignals > 0) {
    score = Math.max(score, 60 + features.leadSignals * 10);
  }

  // Broad Contextual Intent Categories (lower base so they never outrank direct contact/booking)
  if (features.conversationIntent > 0) {
    score = Math.max(score, 50 + features.conversationIntent * 10);
  }
  if (features.projectIntent > 0) {
    score = Math.max(score, 50 + features.projectIntent * 10);
  }
  if (features.advisoryIntent > 0) {
    score = Math.max(score, 35 + features.advisoryIntent * 5);
  }
  if (features.informationIntent > 0) {
    score = Math.max(score, 25 + features.informationIntent * 5);
  }

  // 2. Universal Multi-Lingual URL Path Matches
  const universalPathTokens = [
    "contact", "contactus", "touch", "reach", "book", "schedule", "meeting",
    "consultation", "quote", "start", "started", "inquire", "talk", "connect",
    "sales", "demo",
    "kontakt", "contacto", "contatt", "contat", "fale", "devis", "anfrage",
    "presupuesto", "preventivo", "termin", "cita", "rendez", "boeken", "offerte"
  ];

  const hasPathMatch = features.urlTokens.some((token) =>
    universalPathTokens.some((target) => token.includes(target))
  );
  if (hasPathMatch) {
    if (score > 0) {
      score += 5; // Path reinforces text intent
    } else {
      score = 45; // Path alone gives decent candidate score
    }
  }

  const hasIntentOrPath = score > 0;

  // 3. Structural Topology Boosts: Subtle modifiers (+2 to +6) to break ties without overriding intent
  if (hasIntentOrPath) {
    if (features.isHeader || features.isNav || features.mobileMenuSource) {
      score += 6;
      if (features.isRightmostNav) {
        score += 4;
      }
    } else if (features.isFooter) {
      score += 3;
    } else if (features.isHero || features.isCTA || features.isModalTrigger) {
      score += 2;
    } else {
      score += 1;
    }

    if (features.isProminentButton) {
      score += 3;
    }

    if (features.isModalTrigger) {
      score += 4;
    }
  }

  // 4. Element Type Boosts
  if (features.isButton || features.hasOnClick) {
    if (score >= 40) score += 3;
  }

  // 5. Heading Context Boost
  if (features.pageHeadingKeywords.length > 0 && score >= 40) {
    score += 2;
  }

  // 6. Provider Signature Boost (Direct Hubspot, Calendly, Typeform links)
  if (features.recognizedProvider) {
    score = Math.max(score, 90);
  }

  // 7. Penalties for negative paths & signals
  if (features.negativeSignals > 0) {
    score -= features.negativeSignals * 35;
  }

  const urlLower = features.url.toLowerCase();
  if (/portfolio|case-stud|sub-service|article|category|author|gallery|team|careers|jobs/i.test(urlLower)) {
    score -= 40;
  }

  // If in body without intent signals or path match, heavily penalize
  if (
    features.location === "body" &&
    features.contactKeywordSignals === 0 &&
    features.bookingKeywordSignals === 0 &&
    features.consultationSignals === 0 &&
    features.leadSignals === 0 &&
    !hasPathMatch
  ) {
    score -= 40;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
