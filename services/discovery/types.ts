/**
 * Production-Grade Intelligent Contact Discovery Types
 */

export type CandidateLocation =
  | "header"
  | "nav"
  | "footer"
  | "main CTA"
  | "hero"
  | "body"
  | "sidebar"
  | "mobile menu";

export type CandidateType =
  | "anchor"
  | "button"
  | "cta"
  | "url_pattern"
  | "js_navigation";

export interface CandidateFeatureVector {
  // Identity & URL Structure
  url: string;
  normalizedUrl: string;
  urlTokens: string[];
  urlPathDepth: number;
  sameDomain: boolean;

  // Text Content & Semantics
  rawText: string;
  normalizedText: string;
  ariaLabel: string;
  titleAttr: string;
  parentText: string;
  nearbyText: string;

  // DOM Location & Element Semantics
  elementType: CandidateType;
  location: CandidateLocation;
  isHeader: boolean;
  isNav: boolean;
  isFooter: boolean;
  isMain: boolean;
  isHero: boolean;
  isCTA: boolean;
  isButton: boolean;
  isAnchor: boolean;
  hasOnClick: boolean;
  hasAriaLabel: boolean;
  hasTitle: boolean;
  distanceFromTop: number; // 0.0 (top) to 1.0 (bottom)
  mobileMenuSource: boolean;

  // Semantic Intent Signals (Normalized 0.0 to 1.0)
  contactKeywordSignals: number; // "contact", "get in touch", "let's talk", "reach us"
  bookingKeywordSignals: number; // "book a call", "schedule", "calendar", "appointment"
  consultationSignals: number;   // "consultation", "free consultation", "quote", "estimate"
  leadSignals: number;           // "get started", "start project", "work with us", "grow"
  negativeSignals: number;       // "privacy", "terms", "login", "blog", "careers", "mailto:"

  // Page Context Signals
  pageTitle: string;
  pageHasExistingForm: boolean;
  pageHasPhoneOrEmailOnly: boolean;
  pageHeadingKeywords: string[];
}

export interface ScoredCandidate {
  url: string;
  normalizedUrl: string;
  candidateText: string;
  candidateHref: string;
  location: CandidateLocation;
  candidateType: CandidateType;
  features: CandidateFeatureVector;
  ruleScore: number;
  mlScore: number;
  finalScore: number;
  rank: number;
  reason: string;
}

export interface ModelWeights {
  version: string;
  featureNames: string[];
  // Logistic regression coefficients for P(contact_destination)
  contactCoefficients: Record<string, number>;
  contactIntercept: number;
  // Logistic regression coefficients for P(usable_form_exists)
  formCoefficients: Record<string, number>;
  formIntercept: number;
  metadata?: {
    trainedAt: string;
    sampleCount: number;
    accuracy: number;
  };
}

export interface DiscoveryFeedbackRecord {
  id: string;
  timestamp: string;
  sourceUrl: string;
  candidateUrl: string;
  candidateText: string;
  features: CandidateFeatureVector;
  ruleScore: number;
  mlScore: number;
  finalScore: number;
  rank: number;
  visited: boolean;
  formFound: boolean;
  formType: "contact_form" | "booking_widget" | "none";
  fieldsDetectedCount: number;
  outcome: "FORM_FOUND" | "NO_FORM" | "NAVIGATION_TIMEOUT" | "BLOCKED" | "NOT_VISITED";
}

export interface DiscoveryConfig {
  mlWeight: number;           // default: 0.5
  ruleWeight: number;         // default: 0.5
  maxCandidates: number;      // default: 6
  timeoutMs: number;          // default: 30000
  minConfidence: number;      // default: 30
}
