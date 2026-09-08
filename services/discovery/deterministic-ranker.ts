import { CandidateFeatureVector } from "./types";

export function calculateRuleScore(features: CandidateFeatureVector): number {
  let score = 0;

  // 1. Semantic Intent Signals
  if (features.contactKeywordSignals > 0) {
    score = Math.max(score, features.contactKeywordSignals * 100);
  }
  if (features.bookingKeywordSignals > 0) {
    score = Math.max(score, features.bookingKeywordSignals * 95);
  }
  if (features.consultationSignals > 0) {
    score = Math.max(score, features.consultationSignals * 85);
  }
  if (features.leadSignals > 0) {
    score = Math.max(score, features.leadSignals * 85);
  }

  // 2. URL Path Matches
  const hasPathMatch = features.urlTokens.some((token) =>
    [
      "contact",
      "contactus",
      "touch",
      "reach",
      "book",
      "schedule",
      "meeting",
      "consultation",
      "quote",
      "start",
      "started",
      "inquire",
      "talk"
    ].includes(token)
  );
  if (hasPathMatch) {
    score += 40;
  }

  const hasIntentOrPath =
    features.contactKeywordSignals > 0 ||
    features.bookingKeywordSignals > 0 ||
    features.consultationSignals > 0 ||
    features.leadSignals > 0 ||
    hasPathMatch;

  // 3. Location Boosts (only apply if the element has some intent or path signal)
  if (hasIntentOrPath) {
    if (features.isHeader || features.isNav) {
      score += 25;
    } else if (features.isFooter) {
      score += 25;
    } else if (features.isHero || features.isCTA) {
      score += 20;
    } else if (features.mobileMenuSource) {
      score += 20;
    }
  }

  // 4. Element Type Boosts
  if (features.isButton || features.hasOnClick) {
    // If button has strong intent, give it confidence
    if (score >= 60) score += 10;
  }

  // 5. Heading Context Boost
  if (features.pageHeadingKeywords.length > 0 && score >= 40) {
    score += 10;
  }

  // 6. Penalties
  if (features.negativeSignals > 0) {
    score -= features.negativeSignals * 60;
  }

  // If in body and no intent signals, penalize heavily
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
