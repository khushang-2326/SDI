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
  | "mobile menu"
  | "modal"
  | "dropdown";

export type CandidateType =
  | "anchor"
  | "button"
  | "cta"
  | "url_pattern"
  | "js_navigation"
  | "modal_trigger"
  | "dropdown_item";

export type CandidateSourceType =
  | "dom_anchor"
  | "dom_button"
  | "dom_onclick"
  | "modal_trigger"
  | "dropdown"
  | "http_probe"
  | "sitemap"
  | "synthetic_fallback"
  | "depth_2_cta";

export type FormTypeClassification =
  | "NATIVE_HTML"
  | "WORDPRESS"
  | "AJAX"
  | "SPA"
  | "CRM"
  | "IFRAME"
  | "BOOKING"
  | "MULTI_STEP"
  | "MODAL"
  | "OTHER";

export type DetectedCmsFramework =
  | "wordpress"
  | "webflow"
  | "wix"
  | "squarespace"
  | "shopify"
  | "drupal"
  | "joomla"
  | "ghost"
  | "framer"
  | "duda"
  | "hubspot"
  | "nextjs"
  | "react"
  | "vue"
  | "angular"
  | "svelte"
  | "custom";

export interface ProviderSignature {
  name: string;
  type: "crm_form" | "booking_widget" | "conversational_lead" | "cms_form";
  iframePatterns?: RegExp[];
  scriptPatterns?: RegExp[];
  domSelectors?: string[];
}

export interface CandidateFeatureVector {
  // Identity & URL Structure
  url: string;
  normalizedUrl: string;
  urlTokens: string[];
  urlPathDepth: number;
  sameDomain: boolean;
  sourceType: CandidateSourceType;

  // Language Context
  detectedLanguage: string; // ISO 639-1: "en", "fr", "es", "de", "it", "pt", "nl", or "unknown"

  // Text Content & Semantics
  rawText: string;
  normalizedText: string;
  ariaLabel: string;
  titleAttr: string;
  parentText: string;
  nearbyText: string;

  // DOM Location & Element Semantics (Language-Agnostic)
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
  isRightmostNav: boolean;
  isProminentButton: boolean;
  hasOnClick: boolean;
  hasAriaLabel: boolean;
  hasTitle: boolean;
  distanceFromTop: number; // 0.0 (top) to 1.0 (bottom)
  domDepth: number;
  mobileMenuSource: boolean;
  isModalTrigger: boolean;
  modalTargetSelector?: string;

  // Semantic Intent Signals (Normalized 0.0 to 1.0 across languages)
  contactKeywordSignals: number; // contact, kontakt, contacto, touch, reach, connect, fale
  bookingKeywordSignals: number; // book, schedule, appointment, meeting, termin, cita
  consultationSignals: number;   // consultation, quote, estimate, devis, anfrage, presupuesto
  leadSignals: number;           // get started, start project, work with us, demarrer
  negativeSignals: number;       // privacy, terms, login, cart, checkout, cookies

  // Contextual Semantic Categories (Beyond explicit keywords)
  conversationIntent: number;    // start a conversation, discuss your project, parlons
  projectIntent: number;         // build something, start your project, launch
  advisoryIntent: number;        // talk with an advisor, speak with an expert
  informationIntent: number;     // request information, inquire, demande d'info

  // Structural & Surrounding Context
  headingContextScore: number;   // Alignment with nearest H1/H2/H3 text
  pageTitleContextScore: number; // Alignment with page title/meta description
  pageTitle: string;
  pageHasExistingForm: boolean;
  pageHasPhoneOrEmailOnly: boolean;
  pageHeadingKeywords: string[];

  // Provider & Traversal Metadata
  recognizedProvider?: string;
  navigationDepth: number;
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
