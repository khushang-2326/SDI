import { CandidateFeatureVector } from "./types";

export function calculateRuleScore(features: CandidateFeatureVector): number {
  let score = 0;

  // 1. Semantic Intent Signals (Multi-Lingual Stems)
  if (features.contactKeywordSignals > 0) {
    score = Math.max(score, features.contactKeywordSignals * 100);
  }
  if (features.bookingKeywordSignals > 0) {
    score = Math.max(score, features.bookingKeywordSignals * 95);
  }
  if (features.consultationSignals > 0) {
    score = Math.max(score, features.consultationSignals * 88);
  }
  if (features.leadSignals > 0) {
    score = Math.max(score, features.leadSignals * 85);
  }

  // Broad Contextual Intent Categories
  if (features.conversationIntent > 0) {
    score = Math.max(score, features.conversationIntent * 80);
  }
  if (features.projectIntent > 0) {
    score = Math.max(score, features.projectIntent * 80);
  }
  if (features.advisoryIntent > 0) {
    score = Math.max(score, features.advisoryIntent * 80);
  }
  if (features.informationIntent > 0) {
    score = Math.max(score, features.informationIntent * 70);
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
    score += 30;
  }

  const hasIntentOrPath =
    features.contactKeywordSignals > 0 ||
    features.bookingKeywordSignals > 0 ||
    features.consultationSignals > 0 ||
    features.leadSignals > 0 ||
    features.conversationIntent > 0 ||
    features.projectIntent > 0 ||
    features.advisoryIntent > 0 ||
    hasPathMatch;

  // 3. Structural Topology Boosts: Enforce Tier 1 (Header/Nav) -> Tier 2 (Footer) -> Tier 3 (Body/Main content)
  if (hasIntentOrPath) {
    if (features.isHeader || features.isNav || features.mobileMenuSource) {
      // Tier 1 Base: 1000+ points (Header / Navbar)
      score += 1000;
      // Rightmost item in nav/header is predominantly the contact/lead CTA
      if (features.isRightmostNav) {
        score += 50;
      }
    } else if (features.isFooter) {
      // Tier 2 Base: 500+ points (Footer)
      score += 500;
    } else if (features.isHero || features.isCTA || features.isModalTrigger) {
      // Tier 3 Base: 250+ points (Body / Hero / Main CTAs)
      score += 250;
    } else {
      // Tier 3 Base: 100+ points (Generic body)
      score += 100;
    }

    if (features.isProminentButton) {
      score += 20;
    }

    if (features.isModalTrigger) {
      score += 30;
    }
  }

  // 4. Element Type Boosts
  if (features.isButton || features.hasOnClick) {
    if (score >= 60) score += 10;
  }

  // 5. Heading Context Boost
  if (features.pageHeadingKeywords.length > 0 && score >= 40) {
    score += 10;
  }

  // 6. Provider Signature Boost (Direct Hubspot, Calendly, Typeform links)
  if (features.recognizedProvider && score >= 40) {
    score += 25;
  }

  // 7. Penalties
  if (features.negativeSignals > 0) {
    score -= features.negativeSignals * 65;
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
