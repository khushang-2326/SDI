import { CandidateFeatureVector, DiscoveryConfig, ScoredCandidate } from "./types";
import { calculateRuleScore } from "./deterministic-ranker";
import { predictCandidateScore } from "./ml-ranker";

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  mlWeight: Number(process.env.CONTACT_DISCOVERY_ML_WEIGHT ?? "0.5"),
  ruleWeight: Number(process.env.CONTACT_DISCOVERY_RULE_WEIGHT ?? "0.5"),
  maxCandidates: Number(process.env.CONTACT_DISCOVERY_MAX_CANDIDATES ?? "6"),
  timeoutMs: Number(process.env.CONTACT_DISCOVERY_TIMEOUT_MS ?? "30000"),
  minConfidence: Number(process.env.CONTACT_DISCOVERY_MIN_CONFIDENCE ?? "30")
};

export function scoreAndRankCandidates(
  featureVectors: CandidateFeatureVector[],
  config: Partial<DiscoveryConfig> = {}
): ScoredCandidate[] {
  const activeConfig: DiscoveryConfig = {
    ...DEFAULT_DISCOVERY_CONFIG,
    ...config
  };

  const scored: ScoredCandidate[] = featureVectors.map((features) => {
    const ruleScore = calculateRuleScore(features);
    const mlPrediction = predictCandidateScore(features);

    let finalScore: number;
    let mlWeight = activeConfig.mlWeight;
    let ruleWeight = activeConfig.ruleWeight;

    if (!mlPrediction.available) {
      // Cold-start fallback: purely rule-based
      finalScore = ruleScore;
    } else {
      // Normalize weights
      const totalWeight = mlWeight + ruleWeight;
      if (totalWeight > 0) {
        mlWeight /= totalWeight;
        ruleWeight /= totalWeight;
      } else {
        mlWeight = 0.5;
        ruleWeight = 0.5;
      }
      finalScore = Math.round(ruleScore * ruleWeight + mlPrediction.mlScore * mlWeight);
    }

    const reason = `[CONTACT-DISCOVERY] ${features.location} ${features.elementType} "${features.normalizedText || features.urlTokens.join("/")}" (rule=${ruleScore}, ml=${mlPrediction.mlScore}, final=${finalScore})`;

    return {
      url: features.url,
      normalizedUrl: features.normalizedUrl,
      candidateText: features.rawText,
      candidateHref: features.url,
      location: features.location,
      candidateType: features.elementType,
      features,
      ruleScore,
      mlScore: mlPrediction.mlScore,
      finalScore,
      rank: 0,
      reason
    };
  });

  // Filter out candidates with score below minimum threshold
  const filtered = scored.filter((c) => c.finalScore >= activeConfig.minConfidence);

  // Sort descending by finalScore, then ruleScore, then shorter URL path
  filtered.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    if (b.ruleScore !== a.ruleScore) return b.ruleScore - a.ruleScore;
    return a.url.length - b.url.length;
  });

  // Deduplicate by normalized URL
  const seenUrls = new Set<string>();
  const deduplicated: ScoredCandidate[] = [];

  for (const c of filtered) {
    const clean = c.normalizedUrl.replace(/\/+$/, "");
    if (seenUrls.has(clean)) continue;
    seenUrls.add(clean);
    deduplicated.push(c);
  }

  // Assign ranks
  const limited = deduplicated.slice(0, activeConfig.maxCandidates);
  limited.forEach((c, idx) => {
    c.rank = idx + 1;
  });

  return limited;
}
