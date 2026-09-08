import fs from "node:fs";
import path from "node:path";
import { CandidateFeatureVector, ModelWeights } from "./types";

export interface MLPrediction {
  pContact: number;
  pForm: number;
  mlScore: number;
  available: boolean;
}

let cachedWeights: ModelWeights | null = null;
let weightsLoaded = false;

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
}

export function loadModelWeights(): ModelWeights | null {
  if (weightsLoaded) return cachedWeights;

  try {
    const weightsPath = path.join(__dirname, "models", "contact-ranker-weights.json");
    if (fs.existsSync(weightsPath)) {
      const raw = fs.readFileSync(weightsPath, "utf-8");
      cachedWeights = JSON.parse(raw);
    }
  } catch (err) {
    console.warn("[CONTACT-DISCOVERY] Failed to load local ML model weights. Falling back to deterministic rules.", err);
    cachedWeights = null;
  } finally {
    weightsLoaded = true;
  }

  return cachedWeights;
}

export function predictCandidateScore(features: CandidateFeatureVector): MLPrediction {
  const weights = loadModelWeights();

  if (!weights) {
    return {
      pContact: 0,
      pForm: 0,
      mlScore: 0,
      available: false
    };
  }

  const hasPathMatch = features.urlTokens.some((t) =>
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
      "started",
      "inquire",
      "talk"
    ].includes(t)
  )
    ? 1.0
    : 0.0;

  const vectorRecord: Record<string, number> = {
    contactKeywordSignals: features.contactKeywordSignals,
    bookingKeywordSignals: features.bookingKeywordSignals,
    consultationSignals: features.consultationSignals,
    leadSignals: features.leadSignals,
    negativeSignals: features.negativeSignals,
    hasPathMatch,
    isHeaderNav: features.isHeader || features.isNav ? 1.0 : 0.0,
    isFooter: features.isFooter ? 1.0 : 0.0,
    isCTA: features.isCTA || features.isHero ? 1.0 : 0.0,
    isButton: features.isButton || features.hasOnClick ? 1.0 : 0.0,
    mobileMenuSource: features.mobileMenuSource ? 1.0 : 0.0,
    urlPathDepth: Math.min(features.urlPathDepth, 5) / 5.0,
    distanceFromTop: features.distanceFromTop,
    headingAlignment: features.pageHeadingKeywords.length > 0 ? 1.0 : 0.0
  };

  // 1. P(contact_destination)
  let zContact = weights.contactIntercept;
  for (const [feat, coeff] of Object.entries(weights.contactCoefficients)) {
    zContact += (vectorRecord[feat] ?? 0.0) * coeff;
  }
  const pContact = sigmoid(zContact);

  // 2. P(usable_form_exists)
  let zForm = weights.formIntercept;
  for (const [feat, coeff] of Object.entries(weights.formCoefficients)) {
    zForm += (vectorRecord[feat] ?? 0.0) * coeff;
  }
  const pForm = sigmoid(zForm);

  // Compound probability that this is a contact destination AND has a usable form
  const compoundProb = pContact * pForm;
  const mlScore = Math.round(compoundProb * 100);

  return {
    pContact: Number(pContact.toFixed(3)),
    pForm: Number(pForm.toFixed(3)),
    mlScore,
    available: true
  };
}
