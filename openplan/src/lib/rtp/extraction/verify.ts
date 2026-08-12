/**
 * THE VERIFIER. It sits between the model and the database, and it is not a
 * model.
 *
 * Everything else in this lane is plumbing. This file is the reason a figure
 * transcribed out of an adopted plan is allowed anywhere near an RTP table: it
 * proves, deterministically and with no I/O, that every value a candidate
 * carries is present in the words that candidate quoted, and that those words
 * are present in the passage it cited.
 *
 * A HALLUCINATED FIGURE PRODUCES ZERO ROWS, NOT A WRONG ROW. That sentence is
 * the whole design. A model asked to transcribe $412M from page 112 can answer
 * $421M with a perfectly real quote and a perfectly real page, and no reviewer
 * reading forty cards will catch it. The numeric rule below does, because the
 * digits are simply not in the text.
 *
 * WHAT IT CHECKS, in the order it checks it:
 *   1. `source_chunk_id` is one of the passages actually sent in this batch.
 *      A passage the model invented cites nothing.
 *   2. The passage names a SINGLE page. See `chunk_spans_pages` below.
 *   3. The quote is a substring of that passage, after whitespace
 *      normalisation applied identically to both sides.
 *   4. Every field is one this target kind declares, and every declared
 *      required field is present.
 *   5. Every NUMBER in the fields has a numeric-core match inside the quote,
 *      using the repository's one numeric normaliser
 *      (`lib/planner-pack/grounding.ts` — `$4.2M`, `$4.2 million` and
 *      `4,200,000` all reduce to `4200000`, so a fabricated magnitude cannot
 *      collide on the bare mantissa).
 *   6. Every quoted TEXT field appears inside the quote, case-folded.
 *   7. Nothing that looks like an id got into the payload.
 *   8. The page is taken FROM THE PASSAGE. The model's own page claim is kept
 *      only as an audit cross-check and is counted, never stored.
 *   9. A band label resolves against the cycle's own bands by exact label, or
 *      the band is left UNSET for the reviewer. A guessed band sets an
 *      escalation exponent.
 *
 * A CANDIDATE IS DISCARDED WHOLE, never partially repaired. Dropping the bad
 * field and keeping the row would produce a record that looks transcribed and
 * is missing the thing the planner was told it had.
 *
 * DISCARDS ARE COUNTED, NEVER SILENT. `discarded` carries a reason per
 * candidate so the review surface can say "41 proposed; 6 dropped because their
 * figures were not in the text they cited" instead of showing 35 and looking
 * clean.
 *
 * DOCUMENTED BOUNDS — this narrows human review, it does not replace it:
 *   - Presence, not attribution. A number found ANYWHERE in the quote licenses
 *     the field, so two figures swapped between two columns of the same quoted
 *     table row both pass. Keeping quotes short is what limits this, and the
 *     quote is on the card the reviewer reads.
 *   - Unit-class blind. `4.5%` matches a bare `4.5` in the quote.
 *   - Signs are not captured; the write routes refuse negatives separately.
 *   - Spelled-out numbers ("nine million") are invisible, so a candidate whose
 *     figure the plan writes in words is discarded rather than accepted. That
 *     is the safe direction.
 *   - Classification fields (revenue vs cost, constrained vs illustrative) are
 *     NOT checked against the quote, because the plan does not spell them the
 *     way the database does. They are the reviewer's to confirm, and they are
 *     marked so the surface can say so.
 */

import { numericCoresIn } from "@/lib/planner-pack/grounding";

import {
  RTP_EXTRACTION_TARGETS,
  type ExtractionPassage,
  type RawExtractionCandidate,
  type RtpExtractionFieldSpec,
  type RtpExtractionTargetKind,
} from "./contract";

/**
 * Every way a candidate can fail to be transcription. Each one is a sentence
 * the review surface can show a planner, so they are named for what happened
 * rather than for the line of code that noticed.
 */
export const RTP_EXTRACTION_DISCARD_REASONS = [
  "target_kind_mismatch",
  "unknown_passage",
  "empty_quote",
  "quote_not_in_passage",
  "no_fields",
  "unknown_field",
  "missing_required_field",
  "value_not_a_number",
  "value_out_of_range",
  "zero_is_not_unpriced",
  "figure_not_in_quote",
  "text_not_in_quote",
  "text_too_long",
  "not_a_verbatim_copy",
  "unknown_classification",
  "identifier_in_payload",
] as const;

export type RtpExtractionDiscardReason = (typeof RTP_EXTRACTION_DISCARD_REASONS)[number];

export type RtpExtractionDiscard = {
  targetKind: RtpExtractionTargetKind;
  reason: RtpExtractionDiscardReason;
  /** The field that caused it, when one field did. */
  field: string | null;
  /** The passage the model cited, if it cited a real one. */
  chunkId: string | null;
};

export type VerifiedExtractionCandidate = {
  targetKind: RtpExtractionTargetKind;
  /** Exactly what the target route's POST accepts, as a SUBSET. Never a row. */
  proposedJson: Record<string, unknown>;
  chunkId: string;
  /** From the passage's own `page_from`. Never from the model. */
  page: number;
  quote: string;
  /**
   * True by construction — every candidate this function returns passed every
   * check above. It is written to `rtp_extraction_candidates.quote_verified`,
   * whose CHECK refuses acceptance without it, and it is NOT a confidence
   * score: it is a yes/no about a substring, checkable by hand from the two
   * pieces of text stored beside it.
   */
  quoteVerified: true;
  /** The model claimed a page and it was not the passage's. Audit only. */
  modelPageMismatch: boolean;
  /** A band label was quoted but matched no band in this cycle. */
  horizonBandUnresolved: boolean;
};

export type ExtractionBand = { id: string; label: string | null };

export type VerifyExtractionResult = {
  accepted: VerifiedExtractionCandidate[];
  discarded: RtpExtractionDiscard[];
};

/**
 * The one normalisation, applied IDENTICALLY to the passage and to the quote.
 *
 * NFKC first, because a PDF's text layer hands back ligatures and full-width
 * digits that no model retypes the same way; then every run of whitespace —
 * including the non-breaking spaces a table layout is full of — becomes one
 * ordinary space. Case is PRESERVED here: quotes are matched case-sensitively
 * against their passage, because a copyist that recased the plan's text is not
 * copying it.
 *
 * Symmetry is what keeps this safe. Because the same function runs on both
 * sides, nothing it does can admit a quote whose characters are not in the
 * passage — it can only forgive how they were spaced.
 *
 * WHAT IT DELIBERATELY DOES NOT FORGIVE, so the next reader does not file it as
 * a bug: unicode dashes. NFKC leaves an en-dash, em-dash and minus sign as
 * themselves, so a model that retypes the plan's "2025–2050" with a plain
 * hyphen produces a quote that is not found in the passage, and the candidate
 * is discarded. That is an over-refusal, and it is the safe direction: folding
 * dashes together would mean the stored quote no longer appears in the stored
 * passage character for character, which is the one property that lets a
 * planner check a `quote_verified` claim by eye. A dropped candidate costs a
 * re-extraction; a quote that cannot be found in the page it cites costs the
 * credibility of every other one.
 */
export function normalizeForQuoteMatch(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** A uuid in any casing, anywhere in a value. */
const IDENTIFIER_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/** JSON numbers, and the numeric strings an HTML form or a sloppy model sends. */
function coerceNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,\s]/g, "");
    if (cleaned === "") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type FieldOutcome =
  | { ok: true; value: unknown }
  | { ok: false; reason: RtpExtractionDiscardReason };

function verifyField(
  spec: RtpExtractionFieldSpec,
  rawValue: unknown,
  quote: string,
  quoteCores: ReadonlySet<string>,
  foldedQuote: string
): FieldOutcome {
  if (typeof rawValue === "string" && IDENTIFIER_PATTERN.test(rawValue)) {
    return { ok: false, reason: "identifier_in_payload" };
  }

  if (spec.kind === "numeric") {
    const value = coerceNumber(rawValue);
    if (value === null) return { ok: false, reason: "value_not_a_number" };
    if (spec.integer && !Number.isInteger(value)) return { ok: false, reason: "value_out_of_range" };
    if (spec.min !== undefined && value < spec.min) return { ok: false, reason: "value_out_of_range" };
    if (spec.max !== undefined && value > spec.max) return { ok: false, reason: "value_out_of_range" };
    if (spec.zeroMeansUnpriced && value === 0) return { ok: false, reason: "zero_is_not_unpriced" };

    // THE RULE. Every core the value reduces to must be in the quote's cores.
    const valueCores = numericCoresIn(String(value));
    if (valueCores.size === 0) return { ok: false, reason: "value_not_a_number" };
    for (const core of valueCores) {
      if (!quoteCores.has(core)) return { ok: false, reason: "figure_not_in_quote" };
    }
    return { ok: true, value };
  }

  if (spec.kind === "classification") {
    const text = String(rawValue ?? "").trim();
    if (!spec.enumValues?.includes(text)) return { ok: false, reason: "unknown_classification" };
    return { ok: true, value: text };
  }

  if (spec.kind === "verbatim_block") {
    if (typeof rawValue !== "string") return { ok: false, reason: "not_a_verbatim_copy" };
    if (spec.maxChars && rawValue.length > spec.maxChars) return { ok: false, reason: "text_too_long" };
    // A block is not "contained in" its quote — it IS the quote. Anything else
    // is the model having shortened, joined or tidied the plan's own words.
    if (normalizeForQuoteMatch(rawValue) !== normalizeForQuoteMatch(quote)) {
      return { ok: false, reason: "not_a_verbatim_copy" };
    }
    return { ok: true, value: rawValue };
  }

  // quoted_text
  if (typeof rawValue !== "string") return { ok: false, reason: "text_not_in_quote" };
  if (spec.maxChars && rawValue.length > spec.maxChars) return { ok: false, reason: "text_too_long" };
  const normalized = normalizeForQuoteMatch(rawValue);
  if (!normalized) return { ok: false, reason: "text_not_in_quote" };
  if (!foldedQuote.includes(normalized.toLowerCase())) {
    return { ok: false, reason: "text_not_in_quote" };
  }
  return { ok: true, value: normalized };
}

/**
 * Resolve a quoted period label against the cycle's own bands.
 *
 * EXACT match after whitespace normalisation, case-sensitive, and AMBIGUITY
 * COUNTS AS NO MATCH — two bands normalising to the same label means the
 * verifier cannot tell which one the plan meant, and picking one would be the
 * pairing judgement this lane refuses to make on a planner's behalf.
 */
function resolveBandId(label: string, bands: readonly ExtractionBand[]): string | null {
  const target = normalizeForQuoteMatch(label);
  const matches = bands.filter((band) => normalizeForQuoteMatch(band.label ?? "") === target);
  return matches.length === 1 ? matches[0].id : null;
}

// ---------------------------------------------------------------------------
// What may be cited at all.
// ---------------------------------------------------------------------------

/** A stored chunk, as `kb_document_chunks` holds it. */
export type ExtractionChunkRow = {
  id: string;
  chunk_index: number;
  page_from: number | null;
  page_to: number | null;
  content: string | null;
};

export const PASSAGE_EXCLUSION_REASONS = ["no_page", "spans_pages", "empty_content"] as const;
export type PassageExclusionReason = (typeof PASSAGE_EXCLUSION_REASONS)[number];

export type PassageExclusion = { chunkId: string; reason: PassageExclusionReason };

/**
 * THE PAGE HAS TO BE RIGHT, so a passage that cannot name one page is not read.
 *
 * `rtp_extraction_candidates.source_page` is a single integer and the migration
 * is explicit that it comes from the chunk's own `page_from`. But chunking
 * (`lib/knowledge-base/chunk.ts`) packs ~3200 characters of paragraphs and
 * records the RANGE they came from, so a great many chunks legitimately carry
 * `page_from` 112 and `page_to` 113. Citing `page_from` for a figure that is
 * actually printed on 113 would put a wrong page number on a provenance chip —
 * on the public plan page, in the board export body — and a citation that is
 * quietly off by one is exactly the kind of small lie this repository refuses.
 *
 * So a spanning passage is EXCLUDED, counted, and named. That is a real cost:
 * on a densely typeset plan a large share of passages straddle a page break and
 * their figures cannot be transcribed by this lane at all, which the run
 * discloses rather than absorbing.
 *
 * THE FIX, when it is wanted, is a `source_page_to` column beside `source_page`
 * and a chip that renders a range — a schema change, not a looser verifier.
 * Widening this predicate instead would trade a disclosed gap for an
 * undetectable error, which is the wrong direction on every axis this feature
 * has.
 */
export function buildExtractionPassages(chunks: readonly ExtractionChunkRow[]): {
  passages: ExtractionPassage[];
  excluded: PassageExclusion[];
} {
  const passages: ExtractionPassage[] = [];
  const excluded: PassageExclusion[] = [];

  for (const chunk of chunks) {
    const content = (chunk.content ?? "").trim();
    if (!content) {
      excluded.push({ chunkId: chunk.id, reason: "empty_content" });
      continue;
    }
    if (chunk.page_from === null || chunk.page_from === undefined) {
      excluded.push({ chunkId: chunk.id, reason: "no_page" });
      continue;
    }
    if (chunk.page_to !== null && chunk.page_to !== undefined && chunk.page_to !== chunk.page_from) {
      excluded.push({ chunkId: chunk.id, reason: "spans_pages" });
      continue;
    }
    passages.push({ chunkId: chunk.id, page: chunk.page_from, content });
  }

  return { passages, excluded };
}

/** Planner-voice sentences for why a passage was not read. */
export const PASSAGE_EXCLUSION_SENTENCES: Record<PassageExclusionReason, string> = {
  no_page:
    "this passage carries no page number, so anything taken from it could not be cited to a page",
  spans_pages:
    "this passage runs across a page break, so a figure in it could not be cited to one exact page",
  empty_content: "this passage holds no text",
};

export function verifyExtractionCandidates(params: {
  targetKind: RtpExtractionTargetKind;
  candidates: readonly RawExtractionCandidate[];
  /** The passages actually sent in this batch — the only citable ids. */
  passages: readonly ExtractionPassage[];
  /** The cycle's own horizon bands, for label resolution. Never in the prompt. */
  bands?: readonly ExtractionBand[];
}): VerifyExtractionResult {
  const spec = RTP_EXTRACTION_TARGETS[params.targetKind];
  const bands = params.bands ?? [];
  const byId = new Map(params.passages.map((passage) => [passage.chunkId, passage]));
  const specByKey = new Map(spec.fields.map((field) => [field.key, field]));

  const accepted: VerifiedExtractionCandidate[] = [];
  const discarded: RtpExtractionDiscard[] = [];

  const drop = (
    reason: RtpExtractionDiscardReason,
    field: string | null,
    chunkId: string | null
  ): void => {
    discarded.push({ targetKind: params.targetKind, reason, field, chunkId });
  };

  for (const candidate of params.candidates) {
    if (candidate.target_kind && candidate.target_kind !== params.targetKind) {
      drop("target_kind_mismatch", null, candidate.source_chunk_id);
      continue;
    }

    const passage = candidate.source_chunk_id ? byId.get(candidate.source_chunk_id) : undefined;
    if (!passage) {
      drop("unknown_passage", null, candidate.source_chunk_id);
      continue;
    }

    const quote = candidate.quote ?? "";
    const normalizedQuote = normalizeForQuoteMatch(quote);
    if (!normalizedQuote) {
      drop("empty_quote", null, passage.chunkId);
      continue;
    }
    if (!normalizeForQuoteMatch(passage.content).includes(normalizedQuote)) {
      drop("quote_not_in_passage", null, passage.chunkId);
      continue;
    }

    const entries = Object.entries(candidate.fields).filter(([, value]) => !isBlank(value));
    if (entries.length === 0) {
      drop("no_fields", null, passage.chunkId);
      continue;
    }

    const unknownKey = entries.find(([key]) => !specByKey.has(key));
    if (unknownKey) {
      drop("unknown_field", unknownKey[0], passage.chunkId);
      continue;
    }

    const present = new Set(entries.map(([key]) => key));
    const missing = spec.fields.find((field) => field.required && !present.has(field.key));
    if (missing) {
      drop("missing_required_field", missing.key, passage.chunkId);
      continue;
    }

    const quoteCores = numericCoresIn(normalizedQuote);
    const foldedQuote = normalizedQuote.toLowerCase();

    const proposedJson: Record<string, unknown> = {};
    let failure: { reason: RtpExtractionDiscardReason; field: string } | null = null;
    let bandUnresolved = false;

    for (const [key, rawValue] of entries) {
      const fieldSpec = specByKey.get(key)!;
      const outcome = verifyField(fieldSpec, rawValue, normalizedQuote, quoteCores, foldedQuote);
      if (!outcome.ok) {
        failure = { reason: outcome.reason, field: key };
        break;
      }
      proposedJson[key] = outcome.value;

      if (fieldSpec.resolvesHorizonBand && typeof outcome.value === "string") {
        const bandId = resolveBandId(outcome.value, bands);
        if (bandId) {
          // A uuid the VERIFIER resolved from the cycle's own rows, not one the
          // model produced. The distinction is the whole reason the model was
          // asked for a label.
          proposedJson.horizonBandId = bandId;
        } else {
          bandUnresolved = true;
        }
      }
    }

    if (failure) {
      drop(failure.reason, failure.field, passage.chunkId);
      continue;
    }

    accepted.push({
      targetKind: params.targetKind,
      proposedJson,
      chunkId: passage.chunkId,
      page: passage.page,
      quote: normalizedQuote,
      quoteVerified: true,
      modelPageMismatch: candidate.page !== null && candidate.page !== passage.page,
      horizonBandUnresolved: bandUnresolved,
    });
  }

  return { accepted, discarded };
}

/** Discards grouped by reason, for the run's counts and the review header. */
export function countDiscardsByReason(
  discarded: readonly RtpExtractionDiscard[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const discard of discarded) {
    counts[discard.reason] = (counts[discard.reason] ?? 0) + 1;
  }
  return counts;
}

/**
 * What each discard reason means, written for a planner reading the review
 * header — not for whoever wrote the code.
 *
 * One home, because copy with two homes drifts. These sentences say what the
 * machine did and why, and none of them apologises for it: a dropped candidate
 * is the feature working.
 */
export const RTP_EXTRACTION_DISCARD_SENTENCES: Record<RtpExtractionDiscardReason, string> = {
  target_kind_mismatch: "answered about something other than what was asked for",
  unknown_passage: "cited a page of the document that was not among the ones read",
  empty_quote: "quoted nothing from the document",
  quote_not_in_passage: "quoted words that are not in the page it cited",
  no_fields: "carried no values",
  unknown_field: "carried a field this kind of record does not have",
  missing_required_field: "left out something this kind of record cannot do without",
  value_not_a_number: "gave something other than a number where a number belongs",
  value_out_of_range: "gave a number outside what the field can hold",
  zero_is_not_unpriced:
    "recorded a zero where the plan gives no figure — unpriced is a real answer and it is not zero",
  figure_not_in_quote: "used a figure that does not appear in the text it quoted",
  text_not_in_quote: "used wording that does not appear in the text it quoted",
  text_too_long: "returned more text than the field can hold",
  not_a_verbatim_copy: "changed the plan's own words instead of copying them",
  unknown_classification: "used a category OpenPlan does not have",
  identifier_in_payload: "tried to supply a database id",
};
