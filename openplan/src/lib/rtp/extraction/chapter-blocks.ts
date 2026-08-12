/**
 * A BLOCK IS A QUOTE OR IT DOES NOT EXIST.
 *
 * Nathaniel's Q3 decision of 2026-08-11 put chapter narrative in scope for
 * document transcription and put one condition on it: verbatim blocks only,
 * never a summary, never a paraphrase, never two statements joined by a
 * sentence a model wrote to bridge them. This module is that condition
 * expressed as code, and it is the only path transcribed chapter prose has.
 *
 * WHERE THE TEXT LANDS, AND WHERE IT MAY NEVER LAND. A transcribed block does
 * NOT write `rtp_cycle_chapters.content_markdown`. It becomes a row in the
 * EXISTING `document_narrative_drafts` staging table (20260727000013 —
 * draft | accepted | dismissed), which the RTP chapter lane already uses for
 * model-drafted prose. So an adopted plan cannot quote itself into a published
 * chapter without a person accepting the draft first, and the published chapter
 * content stays what it has always been: text a planner wrote or pasted into
 * their own editor.
 *
 * That choice is worth stating plainly because the shortcut is so available.
 * Writing `content_markdown` straight from a verified quote would look safe —
 * the words ARE the plan's words. What it would actually do is let a machine
 * decide WHICH of the plan's words are this chapter's text, and that selection
 * is authorship. The staging row keeps the selection reviewable.
 *
 * WHAT THIS MODULE CHECKS, per block, with no model and no I/O:
 *   1. The candidate really is a `chapter_block`.
 *   2. Its quote was confirmed by the extraction verifier (`quote_verified`).
 *   3. It names a page.
 *   4. Its `text` is the SAME STRING as its quote after whitespace
 *      normalisation — not "contained in", the same. Anything else is the model
 *      having shortened, tidied or joined the plan's own words.
 *   5. And, when the cited passage is still in the document library, that the
 *      quote is a substring of that passage. This is the check re-run against
 *      the document rather than against the staging row, so a block staged
 *      today still has to match the page it claims.
 *
 * A block that fails ANY of those is refused whole, by a named reason a planner
 * can read. There is no partial repair: dropping a bad half and keeping the
 * rest would produce a "verbatim" quote that is not one.
 *
 * WHITESPACE, AND THE FIDELITY IT COSTS. `verify.ts` stores the quote after
 * `normalizeForQuoteMatch`, which collapses every run of whitespace — including
 * the paragraph breaks inside a long policy statement — into single spaces.
 * That is what makes a substring check safe across a PDF's text layer, and it
 * means a transcribed block arrives as one paragraph even when the plan printed
 * three. The words are the plan's; the line breaks are not preserved. A planner
 * re-inserting them is editing, which is exactly the state the draft is in.
 *
 * NO SCORE OF ANY KIND. Nothing here computes a confidence, a certainty, a
 * likelihood or a percentage. The question "is this the plan's own text?" has a
 * yes/no answer that a person can check by hand from the two strings stored
 * beside each other, and a number in front of that answer would only stop them
 * looking.
 */

import {
  RTP_EXTRACTION_TARGETS,
  type RtpExtractionTargetKind,
} from "./contract";
import { buildProvenanceChip, type TranscriptionRecord } from "./display";
import { normalizeForQuoteMatch } from "./verify";

/** The one target kind this module handles, spelled once. */
export const CHAPTER_BLOCK_TARGET_KIND: RtpExtractionTargetKind = "chapter_block";

/**
 * The ceiling on one block, DERIVED from the extraction contract rather than
 * repeated here. Two copies of a limit is how a block the model was allowed to
 * return becomes a block the stager refuses, with nothing to tell a planner
 * why.
 */
export const CHAPTER_BLOCK_MAX_CHARS: number =
  RTP_EXTRACTION_TARGETS.chapter_block.fields.find((field) => field.key === "text")?.maxChars ??
  4000;

/** Every way a staged block can fail to be the plan's own words. */
export const CHAPTER_BLOCK_REFUSAL_REASONS = [
  "not_a_chapter_block",
  "quote_unverified",
  "no_page",
  "empty_quote",
  "no_text",
  "text_too_long",
  "not_a_verbatim_copy",
  "quote_not_in_page",
] as const;

export type ChapterBlockRefusalReason = (typeof CHAPTER_BLOCK_REFUSAL_REASONS)[number];

/**
 * Why a block was refused, in the words a planner reading a review screen
 * needs. None of them apologises: a refused block is this feature working.
 */
export const CHAPTER_BLOCK_REFUSAL_SENTENCES: Record<ChapterBlockRefusalReason, string> = {
  not_a_chapter_block:
    "This passage was copied out of the document as something other than chapter text, so it cannot be staged as chapter text.",
  quote_unverified:
    "The words in this passage were never matched against the page they cite, so they cannot be staged as the plan's own text.",
  no_page:
    "This passage does not name a page of the document, and text that cannot cite a page cannot be staged.",
  empty_quote: "This passage quotes nothing from the document.",
  no_text: "This passage carries no text to stage.",
  text_too_long: "This passage is longer than one block of chapter text can hold.",
  not_a_verbatim_copy:
    "The text and the quoted page do not match word for word, so this is not a copy of the plan's own words. Nothing was staged.",
  quote_not_in_page:
    "These words are no longer on the page they cite in the document as it is now stored. Nothing was staged — read the document again to copy it as it currently reads.",
};

/** A staged candidate row, as `rtp_extraction_candidates` holds it. */
export type StoredChapterBlockCandidate = {
  id: string;
  target_kind: string;
  proposed_json: unknown;
  source_page: number | null;
  source_quote: string | null;
  quote_verified: boolean | null;
};

/**
 * Whether the cited passage could be re-read out of the document library.
 *
 * `chunk_no_longer_stored` is a real and ordinary state: `source_chunk_id` is
 * `ON DELETE SET NULL`, and re-reading a document replaces its passages. It is
 * NOT the same as a failed read of the chunk table, and the route must never
 * pass one for the other — a query that did not answer is not a document that
 * changed. The distinction is recorded on the draft so the difference survives
 * to whoever reads it later.
 */
export type ChapterBlockChunkRecheck = "matched" | "chunk_no_longer_stored";

export type VerifiedChapterBlock = {
  candidateId: string;
  /** The plan's own words. Identical to `quote`; both are kept so the record is checkable. */
  text: string;
  page: number;
  quote: string;
  chunkRecheck: ChapterBlockChunkRecheck;
};

export type ChapterBlockVerification =
  | { ok: true; block: VerifiedChapterBlock }
  | { ok: false; reason: ChapterBlockRefusalReason };

function readProposedText(proposedJson: unknown): string | null {
  if (!proposedJson || typeof proposedJson !== "object" || Array.isArray(proposedJson)) return null;
  const value = (proposedJson as Record<string, unknown>).text;
  return typeof value === "string" ? value : null;
}

/**
 * Re-run the verbatim check on a STORED candidate, at the moment somebody asks
 * for it to become chapter text.
 *
 * `chunk` is the passage the candidate cites, read out of the document library
 * by the caller: an object when it is still stored, and `null` when it is not.
 * A caller whose chunk READ FAILED must refuse the request instead of passing
 * `null` here — see `ChapterBlockChunkRecheck`.
 */
export function verifyStoredChapterBlock(
  candidate: StoredChapterBlockCandidate,
  chunk: { content: string | null } | null
): ChapterBlockVerification {
  if (candidate.target_kind !== CHAPTER_BLOCK_TARGET_KIND) {
    return { ok: false, reason: "not_a_chapter_block" };
  }
  if (candidate.quote_verified !== true) {
    return { ok: false, reason: "quote_unverified" };
  }
  if (
    typeof candidate.source_page !== "number" ||
    !Number.isInteger(candidate.source_page) ||
    candidate.source_page < 1
  ) {
    return { ok: false, reason: "no_page" };
  }

  const quote = normalizeForQuoteMatch(candidate.source_quote ?? "");
  if (!quote) return { ok: false, reason: "empty_quote" };

  const rawText = readProposedText(candidate.proposed_json);
  if (rawText === null || rawText.trim() === "") return { ok: false, reason: "no_text" };
  if (rawText.length > CHAPTER_BLOCK_MAX_CHARS) return { ok: false, reason: "text_too_long" };

  // THE RULE. Not "contained in" — the same string. A block that is a shortened
  // version of its own quote is a summary with a citation attached.
  if (normalizeForQuoteMatch(rawText) !== quote) {
    return { ok: false, reason: "not_a_verbatim_copy" };
  }

  let chunkRecheck: ChapterBlockChunkRecheck = "chunk_no_longer_stored";
  if (chunk) {
    const passage = normalizeForQuoteMatch(chunk.content ?? "");
    if (!passage || !passage.includes(quote)) {
      return { ok: false, reason: "quote_not_in_page" };
    }
    chunkRecheck = "matched";
  }

  return {
    ok: true,
    block: { candidateId: candidate.id, text: quote, page: candidate.source_page, quote, chunkRecheck },
  };
}

/** Where a block came from, as the citation needs to say it. */
export type ChapterBlockSource = {
  kbDocumentId: string | null;
  documentTitle: string | null;
};

function citationRecord(block: VerifiedChapterBlock, source: ChapterBlockSource): TranscriptionRecord {
  return {
    candidateId: block.candidateId,
    kbDocumentId: source.kbDocumentId,
    documentTitle: source.documentTitle,
    page: block.page,
    quote: block.quote,
    // A staged block has not been edited by anybody yet — that is what staging
    // means. Editing happens in the chapter editor, downstream of acceptance.
    divergentFields: [],
  };
}

/**
 * The citation line that travels WITH the block, in the public-audience wording
 * the provenance chip already uses (Q2: provenance everywhere, including the
 * body, and written for residents and board members rather than for operators).
 *
 * One home for the sentence. A second spelling of "copied from page 112" would
 * drift from the chip on the public plan page within one release.
 */
export function chapterBlockCitationLine(
  block: VerifiedChapterBlock,
  source: ChapterBlockSource
): string {
  return buildProvenanceChip(citationRecord(block, source), "public").headline;
}

/**
 * ONE BLOCK, AS MARKDOWN.
 *
 * A block quote and its citation, and nothing else — no heading a model chose,
 * no lead-in sentence, no "the plan states that". The citation sits INSIDE the
 * quote rather than beneath it so that a planner who selects and copies the
 * block cannot leave the attribution behind: this text ends up in a chapter of
 * a public document, and a quotation that arrives there without its source is
 * the plan appearing to say something in its own voice that it copied from
 * another one.
 */
export function renderTranscribedChapterBlock(
  block: VerifiedChapterBlock,
  source: ChapterBlockSource
): string {
  const quoted = block.text
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
  return `${quoted}\n>\n> — ${chapterBlockCitationLine(block, source)}`;
}

/**
 * The `grounding_json` of a transcribed draft.
 *
 * `document_narrative_drafts.grounding_json` was built for MODEL-DRAFTED prose:
 * it records which numbered workspace facts each sentence cited. None of that
 * happened here, and writing a grounding summary that says it did would be the
 * feature lying about its own provenance. So the record says what actually
 * happened instead — a passage of a named document, on a named page, copied
 * character for character and checked against the page — and marks itself
 * `mode: "transcription"` so any surface can tell the two apart.
 */
export type TranscribedChapterGrounding = {
  mode: "transcription";
  verbatim: true;
  extraction_candidate_id: string;
  kb_document_id: string | null;
  document_title: string | null;
  source_page: number;
  source_quote: string;
  chunk_recheck: ChapterBlockChunkRecheck;
  /**
   * ZERO, AND DELIBERATELY. These mirror the row's own NOT NULL counters, which
   * count sentences a model wrote and how many of them carried a validated
   * citation. A transcription has no model-written sentences at all, so both
   * are 0 — which reads oddly on a surface built for drafted prose, and that is
   * the safe direction. Claiming "every sentence grounded" would assert a check
   * that never ran.
   */
  grounded_sentence_count: 0;
  total_sentence_count: 0;
  note: string;
};

const TRANSCRIPTION_NOTE =
  "Nobody wrote this text. It was copied out of the plan document named here, from the page named here, and checked word for word against that page. It is waiting for a person to accept it or change it.";

export function buildTranscribedChapterGrounding(
  block: VerifiedChapterBlock,
  source: ChapterBlockSource
): TranscribedChapterGrounding {
  return {
    mode: "transcription",
    verbatim: true,
    extraction_candidate_id: block.candidateId,
    kb_document_id: source.kbDocumentId,
    document_title: source.documentTitle,
    source_page: block.page,
    source_quote: block.quote,
    chunk_recheck: block.chunkRecheck,
    grounded_sentence_count: 0,
    total_sentence_count: 0,
    note: TRANSCRIPTION_NOTE,
  };
}

/**
 * Read a stored `grounding_json` back as a transcription record, or `null` when
 * it is an ordinary drafted one.
 *
 * Defensive in the shape `parseStoredDraft` established: one malformed row may
 * never break a panel, and an unrecognised shape is answered "not a
 * transcription" rather than half-parsed.
 */
export function readTranscribedChapterGrounding(
  groundingJson: unknown
): TranscribedChapterGrounding | null {
  if (!groundingJson || typeof groundingJson !== "object" || Array.isArray(groundingJson)) return null;
  const record = groundingJson as Record<string, unknown>;
  if (record.mode !== "transcription") return null;
  if (typeof record.extraction_candidate_id !== "string") return null;
  if (typeof record.source_page !== "number") return null;
  if (typeof record.source_quote !== "string") return null;
  const recheck = record.chunk_recheck;
  return {
    mode: "transcription",
    verbatim: true,
    extraction_candidate_id: record.extraction_candidate_id,
    kb_document_id: typeof record.kb_document_id === "string" ? record.kb_document_id : null,
    document_title: typeof record.document_title === "string" ? record.document_title : null,
    source_page: record.source_page,
    source_quote: record.source_quote,
    chunk_recheck: recheck === "matched" ? "matched" : "chunk_no_longer_stored",
    grounded_sentence_count: 0,
    total_sentence_count: 0,
    note: typeof record.note === "string" ? record.note : TRANSCRIPTION_NOTE,
  };
}

export function isTranscribedChapterDraft(groundingJson: unknown): boolean {
  return readTranscribedChapterGrounding(groundingJson) !== null;
}

/**
 * The badge a transcribed draft carries until somebody accepts or edits it,
 * written for the person deciding.
 */
export function describeTranscribedChapterDraft(
  grounding: TranscribedChapterGrounding,
  status: string
): { badge: string; detail: string } {
  const record: TranscriptionRecord = {
    candidateId: grounding.extraction_candidate_id,
    kbDocumentId: grounding.kb_document_id,
    documentTitle: grounding.document_title,
    page: grounding.source_page,
    quote: grounding.source_quote,
    divergentFields: [],
  };
  const chip = buildProvenanceChip(record, "public");

  const accepted =
    status === "accepted"
      ? " Somebody has accepted it, so it is ready to put into the chapter."
      : status === "dismissed"
        ? " Somebody set it aside, so it is not going into the chapter."
        : " Nobody has accepted it yet.";

  const stale =
    grounding.chunk_recheck === "chunk_no_longer_stored"
      ? " The page it came from is no longer stored the way it was when this was copied, so it could not be checked against the document again."
      : "";

  return { badge: chip.headline, detail: `${grounding.note}${accepted}${stale}` };
}

/**
 * The canonical string a transcribed draft's `facts_hash` is taken over.
 *
 * `facts_hash` exists so a document can detect that what it was built from has
 * changed since somebody accepted it. For drafted prose that is the numbered
 * fact list; for a transcription it is the document, the page and the words —
 * the three things that would make an accepted block stop being a true quote.
 * Hashing happens in the route (node:crypto), so this module stays pure and
 * importable from a client component.
 */
export function transcribedChapterFactsInput(
  block: VerifiedChapterBlock,
  source: ChapterBlockSource
): string {
  return JSON.stringify([
    "rtp_chapter_transcription_v1",
    source.kbDocumentId ?? "",
    block.page,
    block.quote,
  ]);
}
