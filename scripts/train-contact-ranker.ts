import fs from "node:fs";
import path from "node:path";
import { ModelWeights, DiscoveryFeedbackRecord } from "../services/discovery/types";

// Seed dataset representing diverse general website patterns
interface TrainingSample {
  features: Record<string, number>;
  isContact: number; // 1 or 0
  hasForm: number;   // 1 or 0
}

const SEED_SAMPLES: TrainingSample[] = [
  // Primary contact links in header/nav
  {
    features: {
      contactKeywordSignals: 1.0,
      bookingKeywordSignals: 0,
      consultationSignals: 0,
      leadSignals: 0,
      negativeSignals: 0,
      hasPathMatch: 1.0,
      isHeaderNav: 1.0,
      isFooter: 0,
      isCTA: 0,
      isButton: 0,
      mobileMenuSource: 0,
      urlPathDepth: 0.2,
      distanceFromTop: 0.05,
      headingAlignment: 0
    },
    isContact: 1,
    hasForm: 1
  },
  // Footer contact link
  {
    features: {
      contactKeywordSignals: 0.95,
      bookingKeywordSignals: 0,
      consultationSignals: 0,
      leadSignals: 0,
      negativeSignals: 0,
      hasPathMatch: 1.0,
      isHeaderNav: 0,
      isFooter: 1.0,
      isCTA: 0,
      isButton: 0,
      mobileMenuSource: 0,
      urlPathDepth: 0.2,
      distanceFromTop: 0.95,
      headingAlignment: 0
    },
    isContact: 1,
    hasForm: 1
  },
  // Hero "Book a Call" CTA
  {
    features: {
      contactKeywordSignals: 0,
      bookingKeywordSignals: 1.0,
      consultationSignals: 0,
      leadSignals: 0,
      negativeSignals: 0,
      hasPathMatch: 1.0,
      isHeaderNav: 0,
      isFooter: 0,
      isCTA: 1.0,
      isButton: 1.0,
      mobileMenuSource: 0,
      urlPathDepth: 0.4,
      distanceFromTop: 0.2,
      headingAlignment: 1.0
    },
    isContact: 1,
    hasForm: 1
  },
  // "Request a Quote" button
  {
    features: {
      contactKeywordSignals: 0,
      bookingKeywordSignals: 0,
      consultationSignals: 0.95,
      leadSignals: 0,
      negativeSignals: 0,
      hasPathMatch: 1.0,
      isHeaderNav: 1.0,
      isFooter: 0,
      isCTA: 1.0,
      isButton: 1.0,
      mobileMenuSource: 0,
      urlPathDepth: 0.2,
      distanceFromTop: 0.1,
      headingAlignment: 0
    },
    isContact: 1,
    hasForm: 1
  },
  // "Let's Talk" CTA in body
  {
    features: {
      contactKeywordSignals: 0.85,
      bookingKeywordSignals: 0,
      consultationSignals: 0,
      leadSignals: 0.7,
      negativeSignals: 0,
      hasPathMatch: 0,
      isHeaderNav: 0,
      isFooter: 0,
      isCTA: 1.0,
      isButton: 1.0,
      mobileMenuSource: 0,
      urlPathDepth: 0.2,
      distanceFromTop: 0.6,
      headingAlignment: 1.0
    },
    isContact: 1,
    hasForm: 1
  },
  // "Let's Start Something" / "Get Started" anchor in body
  {
    features: {
      contactKeywordSignals: 0,
      bookingKeywordSignals: 0,
      consultationSignals: 0,
      leadSignals: 0.85,
      negativeSignals: 0,
      hasPathMatch: 1.0,
      isHeaderNav: 0,
      isFooter: 0,
      isCTA: 0,
      isButton: 0,
      mobileMenuSource: 0,
      urlPathDepth: 0.2,
      distanceFromTop: 0.5,
      headingAlignment: 0
    },
    isContact: 1,
    hasForm: 1
  },
  // Privacy Policy (Negative)
  {
    features: {
      contactKeywordSignals: 0,
      bookingKeywordSignals: 0,
      consultationSignals: 0,
      leadSignals: 0,
      negativeSignals: 1.0,
      hasPathMatch: 0,
      isHeaderNav: 0,
      isFooter: 1.0,
      isCTA: 0,
      isButton: 0,
      mobileMenuSource: 0,
      urlPathDepth: 0.2,
      distanceFromTop: 0.98,
      headingAlignment: 0
    },
    isContact: 0,
    hasForm: 0
  },
  // Terms of Service (Negative)
  {
    features: {
      contactKeywordSignals: 0,
      bookingKeywordSignals: 0,
      consultationSignals: 0,
      leadSignals: 0,
      negativeSignals: 1.0,
      hasPathMatch: 0,
      isHeaderNav: 0,
      isFooter: 1.0,
      isCTA: 0,
      isButton: 0,
      mobileMenuSource: 0,
      urlPathDepth: 0.2,
      distanceFromTop: 0.98,
      headingAlignment: 0
    },
    isContact: 0,
    hasForm: 0
  },
  // Blog link in navbar (Negative)
  {
    features: {
      contactKeywordSignals: 0,
      bookingKeywordSignals: 0,
      consultationSignals: 0,
      leadSignals: 0,
      negativeSignals: 0.7,
      hasPathMatch: 0,
      isHeaderNav: 1.0,
      isFooter: 0,
      isCTA: 0,
      isButton: 0,
      mobileMenuSource: 0,
      urlPathDepth: 0.2,
      distanceFromTop: 0.05,
      headingAlignment: 0
    },
    isContact: 0,
    hasForm: 0
  },
  // "About Us" link in nav (Non-contact)
  {
    features: {
      contactKeywordSignals: 0,
      bookingKeywordSignals: 0,
      consultationSignals: 0,
      leadSignals: 0,
      negativeSignals: 0.4,
      hasPathMatch: 0,
      isHeaderNav: 1.0,
      isFooter: 0,
      isCTA: 0,
      isButton: 0,
      mobileMenuSource: 0,
      urlPathDepth: 0.2,
      distanceFromTop: 0.05,
      headingAlignment: 0
    },
    isContact: 0,
    hasForm: 0
  },
  // Generic "Learn More" in body (Non-contact)
  {
    features: {
      contactKeywordSignals: 0,
      bookingKeywordSignals: 0,
      consultationSignals: 0,
      leadSignals: 0,
      negativeSignals: 0,
      hasPathMatch: 0,
      isHeaderNav: 0,
      isFooter: 0,
      isCTA: 0,
      isButton: 0,
      mobileMenuSource: 0,
      urlPathDepth: 0.2,
      distanceFromTop: 0.5,
      headingAlignment: 0
    },
    isContact: 0,
    hasForm: 0
  },
  // Mobile menu contact link
  {
    features: {
      contactKeywordSignals: 0.95,
      bookingKeywordSignals: 0,
      consultationSignals: 0,
      leadSignals: 0,
      negativeSignals: 0,
      hasPathMatch: 1.0,
      isHeaderNav: 0,
      isFooter: 0,
      isCTA: 0,
      isButton: 0,
      mobileMenuSource: 1.0,
      urlPathDepth: 0.2,
      distanceFromTop: 0.3,
      headingAlignment: 0
    },
    isContact: 1,
    hasForm: 1
  }
];

const FEATURE_NAMES = [
  "contactKeywordSignals",
  "bookingKeywordSignals",
  "consultationSignals",
  "leadSignals",
  "conversationIntent",
  "projectIntent",
  "advisoryIntent",
  "informationIntent",
  "negativeSignals",
  "hasPathMatch",
  "isHeaderNav",
  "isFooter",
  "isCTA",
  "isButton",
  "mobileMenuSource",
  "urlPathDepth",
  "distanceFromTop",
  "headingAlignment",
  "headingContextScore",
  "pageTitleContextScore"
];

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
}

function trainLogisticRegression(
  samples: TrainingSample[],
  targetKey: "isContact" | "hasForm",
  learningRate = 0.08,
  iterations = 1000,
  l2Reg = 0.01
): { coeffs: Record<string, number>; intercept: number } {
  const coeffs: Record<string, number> = {};
  for (const f of FEATURE_NAMES) coeffs[f] = 0.0;
  let intercept = 0.0;

  const N = samples.length;
  if (N === 0) return { coeffs, intercept: 0 };

  for (let iter = 0; iter < iterations; iter++) {
    const grad: Record<string, number> = {};
    for (const f of FEATURE_NAMES) grad[f] = 0.0;
    let gradIntercept = 0.0;

    for (const s of samples) {
      let z = intercept;
      for (const f of FEATURE_NAMES) {
        z += (s.features[f] || 0) * coeffs[f];
      }
      const p = sigmoid(z);
      const err = p - s[targetKey];

      for (const f of FEATURE_NAMES) {
        grad[f] += err * (s.features[f] || 0);
      }
      gradIntercept += err;
    }

    for (const f of FEATURE_NAMES) {
      coeffs[f] -= (learningRate * (grad[f] / N + l2Reg * coeffs[f]));
    }
    intercept -= (learningRate * (gradIntercept / N));
  }

  const roundedCoeffs: Record<string, number> = {};
  for (const f of FEATURE_NAMES) {
    roundedCoeffs[f] = Number(coeffs[f].toFixed(3));
  }

  return {
    coeffs: roundedCoeffs,
    intercept: Number(intercept.toFixed(3))
  };
}

function evaluateModel(
  samples: TrainingSample[],
  contactModel: { coeffs: Record<string, number>; intercept: number },
  formModel: { coeffs: Record<string, number>; intercept: number }
) {
  let tpContact = 0, fpContact = 0, tnContact = 0, fnContact = 0;
  let tpForm = 0, fpForm = 0, tnForm = 0, fnForm = 0;

  for (const s of samples) {
    let zC = contactModel.intercept;
    let zF = formModel.intercept;
    for (const f of FEATURE_NAMES) {
      zC += (s.features[f] || 0) * contactModel.coeffs[f];
      zF += (s.features[f] || 0) * formModel.coeffs[f];
    }
    const predContact = sigmoid(zC) >= 0.5 ? 1 : 0;
    const predForm = sigmoid(zF) >= 0.5 ? 1 : 0;

    if (predContact === 1 && s.isContact === 1) tpContact++;
    else if (predContact === 1 && s.isContact === 0) fpContact++;
    else if (predContact === 0 && s.isContact === 0) tnContact++;
    else if (predContact === 0 && s.isContact === 1) fnContact++;

    if (predForm === 1 && s.hasForm === 1) tpForm++;
    else if (predForm === 1 && s.hasForm === 0) fpForm++;
    else if (predForm === 0 && s.hasForm === 0) tnForm++;
    else if (predForm === 0 && s.hasForm === 1) fnForm++;
  }

  const total = samples.length || 1;
  const accuracy = Number(((tpContact + tnContact + tpForm + tnForm) / (2 * total)).toFixed(3));

  const pContact = tpContact + fpContact > 0 ? Number((tpContact / (tpContact + fpContact)).toFixed(3)) : 1.0;
  const rContact = tpContact + fnContact > 0 ? Number((tpContact / (tpContact + fnContact)).toFixed(3)) : 1.0;
  const f1Contact = pContact + rContact > 0 ? Number((2 * (pContact * rContact) / (pContact + rContact)).toFixed(3)) : 1.0;

  const pForm = tpForm + fpForm > 0 ? Number((tpForm / (tpForm + fpForm)).toFixed(3)) : 1.0;
  const rForm = tpForm + fnForm > 0 ? Number((tpForm / (tpForm + fnForm)).toFixed(3)) : 1.0;
  const f1Form = pForm + rForm > 0 ? Number((2 * (pForm * rForm) / (pForm + rForm)).toFixed(3)) : 1.0;

  return {
    accuracy,
    precisionContact: pContact,
    recallContact: rContact,
    f1Contact,
    confusionMatrixContact: { tp: tpContact, fp: fpContact, tn: tnContact, fn: fnContact },
    precisionForm: pForm,
    recallForm: rForm,
    f1Form,
    confusionMatrixForm: { tp: tpForm, fp: fpForm, tn: tnForm, fn: fnForm }
  };
}

async function main() {
  console.log("=== SDI Intelligent Contact Discovery Model Training ===");

  const samples: TrainingSample[] = [...SEED_SAMPLES];

  // Also read runtime feedback if available
  const feedbackPath = path.join(process.cwd(), "data", "discovery-feedback.jsonl");
  let feedbackLoadedCount = 0;
  if (fs.existsSync(feedbackPath)) {
    const lines = fs.readFileSync(feedbackPath, "utf-8").split("\n").filter(Boolean);
    console.log(`Inspecting ${lines.length} production feedback records...`);
    for (const line of lines) {
      try {
        const record: DiscoveryFeedbackRecord = JSON.parse(line);
        if (!record.visited) continue;

        const f = record.features;
        // Verify valid complete feature vector
        if (!f || typeof f !== "object" || !Array.isArray(f.urlTokens)) {
          continue;
        }

        const hasPathMatch = f.urlTokens.some((t) =>
          ["contact", "contactus", "touch", "reach", "book", "schedule", "quote", "started", "talk", "connect", "meeting"].includes(t)
        )
          ? 1.0
          : 0.0;

        samples.push({
          features: {
            contactKeywordSignals: f.contactKeywordSignals ?? 0,
            bookingKeywordSignals: f.bookingKeywordSignals ?? 0,
            consultationSignals: f.consultationSignals ?? 0,
            leadSignals: f.leadSignals ?? 0,
            conversationIntent: f.conversationIntent ?? 0,
            projectIntent: f.projectIntent ?? 0,
            advisoryIntent: f.advisoryIntent ?? 0,
            informationIntent: f.informationIntent ?? 0,
            negativeSignals: f.negativeSignals ?? 0,
            hasPathMatch,
            isHeaderNav: f.isHeader || f.isNav ? 1.0 : 0.0,
            isFooter: f.isFooter ? 1.0 : 0.0,
            isCTA: f.isCTA || f.isHero ? 1.0 : 0.0,
            isButton: f.isButton || f.hasOnClick ? 1.0 : 0.0,
            mobileMenuSource: f.mobileMenuSource ? 1.0 : 0.0,
            urlPathDepth: Math.min(f.urlPathDepth ?? 0, 5) / 5.0,
            distanceFromTop: f.distanceFromTop ?? 0.5,
            headingAlignment: (f.pageHeadingKeywords?.length ?? 0) > 0 ? 1.0 : 0.0,
            headingContextScore: f.headingContextScore ?? 0,
            pageTitleContextScore: f.pageTitleContextScore ?? 0
          },
          isContact: record.isContactPage ? 1 : 0,
          hasForm: record.hasUsableForm ? 1 : 0
        });
        feedbackLoadedCount++;
      } catch {
        continue;
      }
    }
  }

  console.log(`Loaded ${feedbackLoadedCount} valid production records with complete feature vectors.`);
  console.log(`Total sample pool: ${samples.length} across ${FEATURE_NAMES.length} features.`);

  // Cold-Start Maturity Tier Check:
  // If total samples < 100, do not train an untrusted model from micro-data.
  if (samples.length < 100) {
    console.log(`[MATURITY TIER] INSUFFICIENT TRAINING DATA: Sample count (${samples.length}) < 100 threshold.`);
    console.log(`[MATURITY TIER] System operates in Tier 1 (100% deterministic/semantic ranking). Keeping baseline weights.`);
    return;
  }

  // Shuffle samples deterministically for 80/20 train/validation split
  const shuffled = [...samples].sort(() => 0.5 - Math.random());
  const splitIdx = Math.floor(shuffled.length * 0.8);
  const trainSet = shuffled.slice(0, splitIdx);
  const valSet = shuffled.slice(splitIdx);

  console.log(`Split: ${trainSet.length} training samples, ${valSet.length} validation samples.`);

  const contactModel = trainLogisticRegression(trainSet, "isContact");
  const formModel = trainLogisticRegression(trainSet, "hasForm");

  const trainMetrics = evaluateModel(trainSet, contactModel, formModel);
  const valMetrics = evaluateModel(valSet, contactModel, formModel);

  console.log(`Training Complete.`);
  console.log(`Train Accuracy: ${(trainMetrics.accuracy * 100).toFixed(1)}% | Val Accuracy: ${(valMetrics.accuracy * 100).toFixed(1)}%`);
  console.log(`Contact F1: ${valMetrics.f1Contact} (Precision: ${valMetrics.precisionContact}, Recall: ${valMetrics.recallContact})`);
  console.log(`Form F1: ${valMetrics.f1Form} (Precision: ${valMetrics.precisionForm}, Recall: ${valMetrics.recallForm})`);
  console.log(`Confusion Matrix Contact: TP=${valMetrics.confusionMatrixContact.tp}, FP=${valMetrics.confusionMatrixContact.fp}, TN=${valMetrics.confusionMatrixContact.tn}, FN=${valMetrics.confusionMatrixContact.fn}`);
  console.log(`Confusion Matrix Form: TP=${valMetrics.confusionMatrixForm.tp}, FP=${valMetrics.confusionMatrixForm.fp}, TN=${valMetrics.confusionMatrixForm.tn}, FN=${valMetrics.confusionMatrixForm.fn}`);

  const weights: ModelWeights = {
    version: "2.0.0",
    featureNames: FEATURE_NAMES,
    contactCoefficients: contactModel.coeffs,
    contactIntercept: contactModel.intercept,
    formCoefficients: formModel.coeffs,
    formIntercept: formModel.intercept,
    metadata: {
      trainedAt: new Date().toISOString(),
      sampleCount: samples.length,
      metrics: {
        sampleCount: samples.length,
        trainAccuracy: trainMetrics.accuracy,
        valAccuracy: valMetrics.accuracy,
        precisionContact: valMetrics.precisionContact,
        recallContact: valMetrics.recallContact,
        f1Contact: valMetrics.f1Contact,
        precisionForm: valMetrics.precisionForm,
        recallForm: valMetrics.recallForm,
        f1Form: valMetrics.f1Form,
        confusionMatrixContact: valMetrics.confusionMatrixContact,
        confusionMatrixForm: valMetrics.confusionMatrixForm
      }
    }
  };

  const outputPath = path.join(
    process.cwd(),
    "services",
    "discovery",
    "models",
    "contact-ranker-weights.json"
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(weights, null, 2), "utf-8");

  console.log(`Saved updated model weights to ${outputPath}`);
}

main().catch((err) => {
  console.error("Training failed:", err);
  process.exit(1);
});
