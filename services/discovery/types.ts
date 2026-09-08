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

export type CandidateSourceType =
  | "dom_anchor"
  | "dom_button"
  | "dom_onclick"
  | "http_probe"
  | "sitemap"
  | "synthetic_fallback"
  | "depth_2_cta";

export interface CandidateFeatureVector {
  // Identity & URL Structure
  url: string;
  normalizedUrl: string;
  urlTokens: string[];
  urlPathDepth: number;
  sameDomain: boolean;
  sourceType: CandidateSourceType;

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

  // Contextual Semantic Categories (Beyond explicit keywords)
  conversationIntent: number;    // "start a conversation", "discuss your project", "tell us about", "speak with"
  projectIntent: number;         // "build something", "start your project", "start your journey", "take the next step"
  advisoryIntent: number;        // "talk with an advisor", "speak with an expert", "consult our team"
  informationIntent: number;     // "request information", "inquire", "find the right solution"

  // Structural & Surrounding Context
  headingContextScore: number;   // Alignment with nearest H1/H2/H3 text
  pageTitleContextScore: number; // Alignment with page title/meta description
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

export interface ModelMetrics {
  sampleCount: number;
  trainAccuracy: number;
  valAccuracy: number;
  precisionContact: number;
  recallContact: number;
  f1Contact: number;
  precisionForm: number;
  recallForm: number;
  f1Form: number;
  confusionMatrixContact: { tp: number; fp: number; tn: number; fn: number };
  confusionMatrixForm: { tp: number; fp: number; tn: number; fn: number };
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
    metrics?: ModelMetrics;
  };
}

export interface DiscoveryFeedbackRecord {
  id: string;
  timestamp: string;
  sourceUrl: string;
  candidateUrl: string;
  candidateText: string;
  sourceType: CandidateSourceType;
  location: CandidateLocation;
  
  // 100% complete feature vector - NEVER empty
  features: CandidateFeatureVector;
  
  // Scoring metadata at decision time
  ruleScore: number;
  mlScore: number;
  finalScore: number;
  rank: number;
  visited: boolean;
  depth: number; // 1 or 2
  
  // Ground-Truth Labels (Observed Reality)
  isContactPage: boolean;     // Semantic destination evidence
  hasUsableForm: boolean;     // Confirmed by existing form/widget detector
  formType: "contact_form" | "booking_widget" | "none";
  fieldsDetectedCount: number;
  outcome: "FORM_FOUND" | "CONTACT_PAGE_NO_FORM" | "IRRELEVANT_PAGE" | "NAVIGATION_FAILED" | "NOT_VISITED";
}

export interface DiscoveryConfig {
  mlWeight: number;           // default: 0.5
  ruleWeight: number;         // default: 0.5
  maxCandidates: number;      // default: 6
  timeoutMs: number;          // default: 30000
  minConfidence: number;      // default: 30
  maxDepth: number;           // default: 2
  maxPageVisits: number;      // default: 6
}
