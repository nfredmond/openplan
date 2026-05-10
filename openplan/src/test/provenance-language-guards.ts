import { expect } from "vitest";

const BROAD_CLAIM_VERB = "(?:(?:is|are|was|were)\\s+)?(?:ready|available|supported|provided|complete|approved)";

const BROAD_PROVENANCE_CLAIM_PATTERNS = [
  new RegExp(`\\bvalidated behavioral forecast(?:ing)?\\s+${BROAD_CLAIM_VERB}\\b`, "i"),
  new RegExp(`\\bcertified calibration\\s+${BROAD_CLAIM_VERB}\\b`, "i"),
  new RegExp(`\\bsurvey-grade certification\\s+${BROAD_CLAIM_VERB}\\b`, "i"),
  new RegExp(`\\bregulatory compliance\\s+${BROAD_CLAIM_VERB}\\b`, "i"),
  new RegExp(`\\bautonomous photogrammetry\\s+${BROAD_CLAIM_VERB}\\b`, "i"),
  new RegExp(`\\b(?:legal )?compliance automation\\s+${BROAD_CLAIM_VERB}\\b`, "i"),
  new RegExp(`\\baward prediction\\s+${BROAD_CLAIM_VERB}\\b`, "i"),
  new RegExp(`\\bautonomous approval\\s+${BROAD_CLAIM_VERB}\\b`, "i"),
  new RegExp(`\\bpublic consensus\\s+${BROAD_CLAIM_VERB}\\b`, "i"),
  new RegExp(`\\bpublic approval\\s+${BROAD_CLAIM_VERB}\\b`, "i"),
];

export function expectProvenanceLanguageOnly(text: unknown) {
  const value = String(text ?? "");

  for (const pattern of BROAD_PROVENANCE_CLAIM_PATTERNS) {
    expect(value).not.toMatch(pattern);
  }
}
