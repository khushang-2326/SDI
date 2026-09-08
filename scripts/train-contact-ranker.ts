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
  "negativeSignals",
  "hasPathMatch",
  "isHeaderNav",
  "isFooter",
  "isCTA",
  "isButton",
  "mobileMenuSource",
  "urlPathDepth",
  "distanceFromTop",
  "headingAlignment"
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

async function main() {
  console.log("=== SDI Intelligent Contact Discovery Model Training ===");

  const samples: TrainingSample[] = [...SEED_SAMPLES];

  // Also read runtime feedback if available
  const feedbackPath = path.join(process.cwd(), "data", "discovery-feedback.jsonl");
  if (fs.existsSync(feedbackPath)) {
    const lines = fs.readFileSync(feedbackPath, "utf-8").split("\n").filter(Boolean);
    console.log(`Loading ${lines.length} production feedback records...`);
    for (const line of lines) {
      try {
        const record: DiscoveryFeedbackRecord = JSON.parse(line);
        if (!record.visited) continue;

        const f = record.features;
        const hasPathMatch = f.urlTokens.some((t) =>
          ["contact", "contactus", "touch", "reach", "book", "schedule", "quote", "started"].includes(t)
        )
          ? 1.0
          : 0.0;

        samples.push({
          features: {
            contactKeywordSignals: f.contactKeywordSignals,
            bookingKeywordSignals: f.bookingKeywordSignals,
            consultationSignals: f.consultationSignals,
            leadSignals: f.leadSignals,
            negativeSignals: f.negativeSignals,
            hasPathMatch,
            isHeaderNav: f.isHeader || f.isNav ? 1.0 : 0.0,
            isFooter: f.isFooter ? 1.0 : 0.0,
            isCTA: f.isCTA || f.isHero ? 1.0 : 0.0,
            isButton: f.isButton || f.hasOnClick ? 1.0 : 0.0,
            mobileMenuSource: f.mobileMenuSource ? 1.0 : 0.0,
            urlPathDepth: Math.min(f.urlPathDepth, 5) / 5.0,
            distanceFromTop: f.distanceFromTop,
            headingAlignment: f.pageHeadingKeywords.length > 0 ? 1.0 : 0.0
          },
          isContact: record.formType !== "none" ? 1 : 0,
          hasForm: record.formFound ? 1 : 0
        });
      } catch {
        continue;
      }
    }
  }

  console.log(`Training with ${samples.length} total samples across ${FEATURE_NAMES.length} features...`);

  const contactModel = trainLogisticRegression(samples, "isContact");
  const formModel = trainLogisticRegression(samples, "hasForm");

  // Calculate training accuracy
  let correctContact = 0;
  let correctForm = 0;
  for (const s of samples) {
    let zC = contactModel.intercept;
    let zF = formModel.intercept;
    for (const f of FEATURE_NAMES) {
      zC += (s.features[f] || 0) * contactModel.coeffs[f];
      zF += (s.features[f] || 0) * formModel.coeffs[f];
    }
    if ((sigmoid(zC) >= 0.5 ? 1 : 0) === s.isContact) correctContact++;
    if ((sigmoid(zF) >= 0.5 ? 1 : 0) === s.hasForm) correctForm++;
  }

  const accuracy = Number(((correctContact + correctForm) / (2 * samples.length)).toFixed(3));
  console.log(`Training complete. Accuracy: ${(accuracy * 100).toFixed(1)}%`);

  const weights: ModelWeights = {
    version: "1.0.0",
    featureNames: FEATURE_NAMES,
    contactCoefficients: contactModel.coeffs,
    contactIntercept: contactModel.intercept,
    formCoefficients: formModel.coeffs,
    formIntercept: formModel.intercept,
    metadata: {
      trainedAt: new Date().toISOString(),
      sampleCount: samples.length,
      accuracy
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

  console.log(`Saved model weights to ${outputPath}`);
}

main().catch((err) => {
  console.error("Training failed:", err);
  process.exit(1);
});
