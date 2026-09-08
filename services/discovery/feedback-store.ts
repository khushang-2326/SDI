import fs from "node:fs/promises";
import path from "node:path";
import { DiscoveryFeedbackRecord, ScoredCandidate } from "./types";

const FEEDBACK_FILE_PATH = path.join(process.cwd(), "data", "discovery-feedback.jsonl");

export async function recordDiscoveryFeedback(
  sourceUrl: string,
  candidate: ScoredCandidate,
  visited: boolean,
  isContactPage: boolean,
  hasUsableForm: boolean,
  formType: "contact_form" | "booking_widget" | "none",
  fieldsDetectedCount: number,
  outcome: "FORM_FOUND" | "CONTACT_PAGE_NO_FORM" | "IRRELEVANT_PAGE" | "NAVIGATION_FAILED" | "NOT_VISITED",
  depth: number = 1
): Promise<void> {
  try {
    const record: DiscoveryFeedbackRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      sourceUrl,
      candidateUrl: candidate.url,
      candidateText: (candidate.candidateText || "").slice(0, 100),
      sourceType: candidate.features?.sourceType || "dom_anchor",
      location: candidate.location || "body",
      features: candidate.features,
      ruleScore: candidate.ruleScore,
      mlScore: candidate.mlScore,
      finalScore: candidate.finalScore,
      rank: candidate.rank,
      visited,
      depth,
      isContactPage,
      hasUsableForm,
      formType,
      fieldsDetectedCount,
      outcome
    };

    const dir = path.dirname(FEEDBACK_FILE_PATH);
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(FEEDBACK_FILE_PATH, `${JSON.stringify(record)}\n`, "utf-8");
  } catch (err) {
    // Feedback logging should never crash the automation
    console.warn("[CONTACT-DISCOVERY] Failed to record discovery feedback:", err);
  }
}
