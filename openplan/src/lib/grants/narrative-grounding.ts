/**
 * Grant-narrative grounding helpers.
 *
 * The narrative-draft route builds a numbered fact list (fact_1..fact_N)
 * from the workspace data it already assembles, requires the model to cite
 * facts with inline `[fact:N]` tokens, and validates the result with the
 * Planner Pack grounding contract (`@/lib/planner-pack/grounding`,
 * 'annotated' mode). This module holds the pure pieces shared by the route
 * and the UI: the fact-list type, the persisted grounding summary shape
 * (stored in funding_opportunity_narrative_drafts.grounding_json), the
 * display-side token stripper, and a defensive parser for stored JSON.
 */

import type { GroundedNarrative } from "@/lib/planner-pack/grounding";

/** FactBlock-like entry: a numbered workspace fact the model may cite. */
export type NarrativeFact = {
  fact_id: string;
  claim_text: string;
};

export type NarrativeGroundingSentence = {
  text: string;
  cited_fact_ids: string[];
  is_grounded: boolean;
  unknown_fact_ids: string[];
};

/**
 * Persisted validation result for one draft. Mirrors the annotated-mode
 * `GroundedNarrative` (annotated mode keeps every sentence, so
 * `dropped_sentences` is always empty; it is stored anyway so the shape
 * stays honest if a strict-mode caller ever persists through this type).
 */
export type NarrativeDraftGrounding = {
  mode: "annotated";
  facts: NarrativeFact[];
  sentences: NarrativeGroundingSentence[];
  dropped_sentences: NarrativeGroundingSentence[];
  cited_fact_ids: string[];
  unknown_fact_ids: string[];
  grounded_sentence_count: number;
  total_sentence_count: number;
  is_fully_grounded: boolean;
};

/** Build sequential fact ids fact_1..fact_N over claim texts, skipping blanks. */
export function buildNarrativeFactList(claimTexts: Array<string | null | undefined>): NarrativeFact[] {
  const facts: NarrativeFact[] = [];
  for (const claimText of claimTexts) {
    const trimmed = claimText?.trim();
    if (!trimmed) continue;
    facts.push({ fact_id: `fact_${facts.length + 1}`, claim_text: trimmed });
  }
  return facts;
}

/** Render the numbered fact list as prompt lines (`[fact:N] claim`). */
export function renderNarrativeFactPromptLines(facts: NarrativeFact[]): string[] {
  return facts.map((fact) => `[fact:${fact.fact_id}] ${fact.claim_text}`);
}

/** Collapse an annotated-mode validation into the persisted summary. */
export function summarizeNarrativeGrounding(
  validated: GroundedNarrative,
  facts: NarrativeFact[]
): NarrativeDraftGrounding {
  const toSentence = (sentence: GroundedNarrative["sentences"][number]): NarrativeGroundingSentence => ({
    text: sentence.text,
    cited_fact_ids: sentence.citedFactIds,
    is_grounded: sentence.isGrounded,
    unknown_fact_ids: sentence.unknownFactIds,
  });

  const sentences = validated.sentences.map(toSentence);

  return {
    mode: "annotated",
    facts,
    sentences,
    dropped_sentences: validated.droppedSentences.map(toSentence),
    cited_fact_ids: validated.citedFactIds,
    unknown_fact_ids: validated.unknownFactIds,
    grounded_sentence_count: sentences.filter((sentence) => sentence.is_grounded).length,
    total_sentence_count: sentences.length + validated.droppedSentences.length,
    is_fully_grounded: validated.isFullyGrounded,
  };
}

/** Matches the inline citation token; kept in sync with `grounding.ts`. */
const CITATION_TOKEN_PATTERN = /\[fact:[A-Za-z0-9][A-Za-z0-9_.-]*\]/g;

/**
 * Strip `[fact:N]` tokens for display. The stored draft_markdown keeps the
 * tokens (they are the provenance record); only the rendered view drops
 * them. Whitespace left behind by a removed token is collapsed so the prose
 * reads cleanly, without touching newlines (markdown structure survives).
 */
export function stripFactCitationTokens(markdown: string): string {
  return markdown
    .replace(CITATION_TOKEN_PATTERN, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseSentence(value: unknown): NarrativeGroundingSentence | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.text !== "string") return null;
  if (!isStringArray(record.cited_fact_ids) || !isStringArray(record.unknown_fact_ids)) return null;
  if (typeof record.is_grounded !== "boolean") return null;
  return {
    text: record.text,
    cited_fact_ids: record.cited_fact_ids,
    is_grounded: record.is_grounded,
    unknown_fact_ids: record.unknown_fact_ids,
  };
}

/**
 * Defensively parse a stored grounding_json value. Returns null for
 * pre-grounding drafts (null column) or malformed payloads instead of
 * letting a bad row break the panel.
 */
export function parseStoredNarrativeGrounding(value: unknown): NarrativeDraftGrounding | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.mode !== "annotated") return null;
  if (!Array.isArray(record.sentences)) return null;

  const sentences = record.sentences.map(parseSentence);
  if (sentences.some((sentence) => sentence === null)) return null;

  const droppedRaw = Array.isArray(record.dropped_sentences) ? record.dropped_sentences : [];
  const dropped = droppedRaw.map(parseSentence).filter(
    (sentence): sentence is NarrativeGroundingSentence => sentence !== null
  );

  const factsRaw = Array.isArray(record.facts) ? record.facts : [];
  const facts = factsRaw.flatMap((fact) => {
    if (!fact || typeof fact !== "object") return [];
    const factRecord = fact as Record<string, unknown>;
    return typeof factRecord.fact_id === "string" && typeof factRecord.claim_text === "string"
      ? [{ fact_id: factRecord.fact_id, claim_text: factRecord.claim_text }]
      : [];
  });

  const parsedSentences = sentences as NarrativeGroundingSentence[];

  return {
    mode: "annotated",
    facts,
    sentences: parsedSentences,
    dropped_sentences: dropped,
    cited_fact_ids: isStringArray(record.cited_fact_ids) ? record.cited_fact_ids : [],
    unknown_fact_ids: isStringArray(record.unknown_fact_ids) ? record.unknown_fact_ids : [],
    grounded_sentence_count:
      typeof record.grounded_sentence_count === "number"
        ? record.grounded_sentence_count
        : parsedSentences.filter((sentence) => sentence.is_grounded).length,
    total_sentence_count:
      typeof record.total_sentence_count === "number"
        ? record.total_sentence_count
        : parsedSentences.length + dropped.length,
    is_fully_grounded:
      typeof record.is_fully_grounded === "boolean"
        ? record.is_fully_grounded
        : parsedSentences.every((sentence) => sentence.is_grounded),
  };
}

/** Sentences an operator should review: uncited or citing unknown fact ids. */
export function listFlaggedNarrativeSentences(
  grounding: NarrativeDraftGrounding
): Array<{ text: string; reason: "missing_citation" | "unknown_fact_id"; unknown_fact_ids: string[] }> {
  return [...grounding.sentences, ...grounding.dropped_sentences]
    .filter((sentence) => !sentence.is_grounded)
    .map((sentence) => ({
      text: sentence.text,
      reason: sentence.cited_fact_ids.length === 0 ? ("missing_citation" as const) : ("unknown_fact_id" as const),
      unknown_fact_ids: sentence.unknown_fact_ids,
    }));
}
