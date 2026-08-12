import { describe, expect, it } from "vitest";

/**
 * A BLOCK IS A QUOTE OR IT DOES NOT EXIST.
 *
 * `chapter-blocks.ts` is the only path transcribed chapter prose has into
 * OpenPlan, and the thing it exists to make impossible is a paragraph that
 * LOOKS like the plan's own words and is not. So most of what is asserted here
 * is refusal: a block that was shortened, tidied, joined, re-cased or moved to
 * a different page is dropped whole, by a named reason a planner can read.
 *
 * The positive assertions are about what the accepted block carries — the page,
 * the document, and a citation written for the public rather than for an
 * operator — and about what it does NOT carry: no score, no certainty, no
 * grounding claim about a check that never ran.
 *
 * MUTATION RESULTS are recorded at the bottom of this file.
 */

import {
  CHAPTER_BLOCK_MAX_CHARS,
  CHAPTER_BLOCK_REFUSAL_REASONS,
  CHAPTER_BLOCK_REFUSAL_SENTENCES,
  buildTranscribedChapterGrounding,
  chapterBlockCitationLine,
  describeTranscribedChapterDraft,
  isTranscribedChapterDraft,
  readTranscribedChapterGrounding,
  renderTranscribedChapterBlock,
  transcribedChapterFactsInput,
  verifyStoredChapterBlock,
  type StoredChapterBlockCandidate,
} from "@/lib/rtp/extraction/chapter-blocks";
import { RTP_EXTRACTION_TARGETS } from "@/lib/rtp/extraction/contract";

const QUOTE =
  "Goal 3: Reduce fatalities and serious injuries on the regional roadway network to zero by 2050.";

const PAGE_TEXT = `Chapter 3 — Safety\n\n${QUOTE}\n\nThe agency will report progress annually.`;

function candidate(overrides: Partial<StoredChapterBlockCandidate> = {}): StoredChapterBlockCandidate {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    target_kind: "chapter_block",
    proposed_json: { text: QUOTE },
    source_page: 112,
    source_quote: QUOTE,
    quote_verified: true,
    ...overrides,
  };
}

const SOURCE = { kbDocumentId: "55555555-5555-4555-8555-555555555555", documentTitle: "2020 Regional Transportation Plan" };

describe("what a stored chapter block has to be", () => {
  it("accepts the plan's own sentence, quoting the page it is printed on", () => {
    const result = verifyStoredChapterBlock(candidate(), { content: PAGE_TEXT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.block.text).toBe(QUOTE);
    expect(result.block.page).toBe(112);
    expect(result.block.chunkRecheck).toBe("matched");
  });

  it("refuses a SUMMARY of its own quote — the defect this whole module exists for", () => {
    const result = verifyStoredChapterBlock(
      candidate({ proposed_json: { text: "Goal 3: eliminate traffic deaths by 2050." } }),
      { content: PAGE_TEXT }
    );
    expect(result).toEqual({ ok: false, reason: "not_a_verbatim_copy" });
  });

  it("refuses a TRUNCATION of its own quote", () => {
    // The other direction of the same loosening, and the one a paraphrase test
    // cannot see: a block that is literally the first half of the plan's
    // sentence is a substring of its quote, so any `quote.includes(text)` rule
    // waves it through. "Reduce fatalities and serious injuries" without "to
    // zero by 2050" is a different policy.
    const truncated = QUOTE.slice(0, 60);
    const result = verifyStoredChapterBlock(
      candidate({ proposed_json: { text: truncated } }),
      { content: PAGE_TEXT }
    );
    expect(result).toEqual({ ok: false, reason: "not_a_verbatim_copy" });
  });

  it("refuses a block that merely CONTAINS its quote, not equals it", () => {
    // The tempting looser rule. A block built by wrapping the plan's sentence in
    // a model's own lead-in reads as a quotation and is not one.
    const result = verifyStoredChapterBlock(
      candidate({ proposed_json: { text: `The plan states that ${QUOTE}` } }),
      { content: PAGE_TEXT }
    );
    expect(result).toEqual({ ok: false, reason: "not_a_verbatim_copy" });
  });

  it("refuses two of the plan's statements joined into one block", () => {
    const result = verifyStoredChapterBlock(
      candidate({
        proposed_json: { text: `${QUOTE} The agency will report progress annually.` },
      }),
      { content: PAGE_TEXT }
    );
    expect(result).toEqual({ ok: false, reason: "not_a_verbatim_copy" });
  });

  it("refuses a block whose words are no longer on the page it cites", () => {
    const result = verifyStoredChapterBlock(candidate(), {
      content: "Chapter 3 — Safety\n\nThis chapter was rewritten in the 2025 update.",
    });
    expect(result).toEqual({ ok: false, reason: "quote_not_in_page" });
  });

  it("refuses a quote the extraction verifier never confirmed", () => {
    const result = verifyStoredChapterBlock(candidate({ quote_verified: false }), { content: PAGE_TEXT });
    expect(result).toEqual({ ok: false, reason: "quote_unverified" });
    // A null is not a yes either — the column is NOT NULL, but a projection that
    // forgot it hands back undefined.
    expect(verifyStoredChapterBlock(candidate({ quote_verified: null }), { content: PAGE_TEXT })).toEqual({
      ok: false,
      reason: "quote_unverified",
    });
  });

  it("refuses a block that cannot name a page", () => {
    expect(verifyStoredChapterBlock(candidate({ source_page: null }), { content: PAGE_TEXT })).toEqual({
      ok: false,
      reason: "no_page",
    });
    expect(verifyStoredChapterBlock(candidate({ source_page: 0 }), { content: PAGE_TEXT })).toEqual({
      ok: false,
      reason: "no_page",
    });
  });

  it("refuses anything that is not a chapter block", () => {
    const result = verifyStoredChapterBlock(candidate({ target_kind: "financial_line" }), {
      content: PAGE_TEXT,
    });
    expect(result).toEqual({ ok: false, reason: "not_a_chapter_block" });
  });

  it("refuses an empty quote and a missing text", () => {
    expect(verifyStoredChapterBlock(candidate({ source_quote: "   " }), { content: PAGE_TEXT })).toEqual({
      ok: false,
      reason: "empty_quote",
    });
    expect(verifyStoredChapterBlock(candidate({ proposed_json: {} }), { content: PAGE_TEXT })).toEqual({
      ok: false,
      reason: "no_text",
    });
    expect(
      verifyStoredChapterBlock(candidate({ proposed_json: { text: 42 } }), { content: PAGE_TEXT })
    ).toEqual({ ok: false, reason: "no_text" });
  });

  it("refuses a block longer than the contract lets the model return", () => {
    const long = "x".repeat(CHAPTER_BLOCK_MAX_CHARS + 1);
    const result = verifyStoredChapterBlock(
      candidate({ proposed_json: { text: long }, source_quote: long }),
      { content: long }
    );
    expect(result).toEqual({ ok: false, reason: "text_too_long" });
  });

  it("takes its ceiling FROM the extraction contract rather than repeating it", () => {
    // Two copies of the limit is how a block the model was allowed to return
    // becomes a block the stager refuses, with nothing to tell a planner why.
    const declared = RTP_EXTRACTION_TARGETS.chapter_block.fields.find((field) => field.key === "text");
    expect(CHAPTER_BLOCK_MAX_CHARS).toBe(declared?.maxChars);
  });

  it("forgives only how the page was SPACED, never how it was worded", () => {
    // A PDF's text layer hands back non-breaking spaces and line wraps that no
    // model retypes identically; the same normaliser runs on both sides.
    const spaced = QUOTE.replace(/ /g, "  ");
    const result = verifyStoredChapterBlock(
      candidate({ proposed_json: { text: spaced } }),
      { content: PAGE_TEXT }
    );
    expect(result.ok).toBe(true);

    // Case is NOT forgiven: a copyist that recased the plan's text is not copying it.
    const recased = verifyStoredChapterBlock(
      candidate({ proposed_json: { text: QUOTE.toLowerCase() }, source_quote: QUOTE.toLowerCase() }),
      { content: PAGE_TEXT }
    );
    expect(recased).toEqual({ ok: false, reason: "quote_not_in_page" });
  });

  it("still stages when the cited passage is gone, and records that it could not re-check", () => {
    // `source_chunk_id` is ON DELETE SET NULL and re-reading a document replaces
    // its passages, so this is ordinary rather than suspicious — but it is a
    // different state from "checked and matched" and must not be recorded as one.
    const result = verifyStoredChapterBlock(candidate(), null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.block.chunkRecheck).toBe("chunk_no_longer_stored");
  });

  it("names every refusal in words a planner can act on", () => {
    for (const reason of CHAPTER_BLOCK_REFUSAL_REASONS) {
      const sentence = CHAPTER_BLOCK_REFUSAL_SENTENCES[reason];
      expect(sentence, reason).toBeTruthy();
      expect(sentence, reason).not.toMatch(/undefined|null|error code/i);
    }
  });
});

describe("what a staged block looks like", () => {
  const block = (() => {
    const result = verifyStoredChapterBlock(candidate(), { content: PAGE_TEXT });
    if (!result.ok) throw new Error("fixture should verify");
    return result.block;
  })();

  it("renders the quote and its source, and NOTHING a machine wrote", () => {
    const markdown = renderTranscribedChapterBlock(block, SOURCE);
    const lines = markdown.split("\n");

    // Every line is part of the block quote: quote, blank, attribution.
    expect(lines.every((line) => line.startsWith(">"))).toBe(true);
    expect(lines[0]).toBe(`> ${QUOTE}`);
    expect(markdown).toContain("2020 Regional Transportation Plan");
    expect(markdown).toContain("page 112");

    // No connective prose. If a lead-in like this ever appears, a machine has
    // started writing the chapter.
    expect(markdown).not.toMatch(/the plan (states|says)|in summary|this chapter|overall/i);
  });

  it("keeps the attribution INSIDE the quote so a copy cannot leave it behind", () => {
    const markdown = renderTranscribedChapterBlock(block, SOURCE);
    const attribution = markdown.split("\n").at(-1) ?? "";
    expect(attribution.startsWith("> — ")).toBe(true);
  });

  it("writes the citation in public-audience words, not operator words", () => {
    const line = chapterBlockCitationLine(block, SOURCE);
    expect(line).toBe('Copied from “2020 Regional Transportation Plan”, page 112');
    expect(line).not.toMatch(/candidate|extraction|chunk|proposed_json|target_kind|workspace/i);
  });

  it("names the document honestly when the document has no title", () => {
    const line = chapterBlockCitationLine(block, { kbDocumentId: null, documentTitle: null });
    expect(line).toContain("a document in this plan's library");
    expect(line).not.toContain("null");
    expect(line).toContain("page 112");
  });

  it("records a transcription, never a grounding check that did not run", () => {
    const grounding = buildTranscribedChapterGrounding(block, SOURCE);
    expect(grounding.mode).toBe("transcription");
    expect(grounding.verbatim).toBe(true);
    expect(grounding.source_page).toBe(112);
    expect(grounding.source_quote).toBe(QUOTE);
    expect(grounding.chunk_recheck).toBe("matched");
    // Zero model-written sentences, so zero of them were grounding-checked.
    // Claiming "all grounded" would assert a check nothing performed.
    expect(grounding.grounded_sentence_count).toBe(0);
    expect(grounding.total_sentence_count).toBe(0);
  });

  it("carries no score, certainty, likelihood or percentage anywhere", () => {
    const grounding = buildTranscribedChapterGrounding(block, SOURCE);
    const described = describeTranscribedChapterDraft(grounding, "draft");
    const surface = [
      JSON.stringify(grounding),
      renderTranscribedChapterBlock(block, SOURCE),
      described.badge,
      described.detail,
      ...Object.values(CHAPTER_BLOCK_REFUSAL_SENTENCES),
    ].join(" ");
    expect(surface).not.toMatch(/confiden|certaint|likelihood|probabilit|\bscore\b|\d+\s?%/i);
  });

  it("round-trips through storage, and answers `not a transcription` for a drafted one", () => {
    const grounding = buildTranscribedChapterGrounding(block, SOURCE);
    const stored = JSON.parse(JSON.stringify(grounding)) as unknown;
    expect(readTranscribedChapterGrounding(stored)).toEqual(grounding);
    expect(isTranscribedChapterDraft(stored)).toBe(true);

    // A model-drafted chapter's grounding record must never wear this badge.
    expect(isTranscribedChapterDraft({ grounded_sentence_count: 4, total_sentence_count: 4 })).toBe(false);
    expect(isTranscribedChapterDraft(null)).toBe(false);
    expect(isTranscribedChapterDraft("transcription")).toBe(false);
    expect(isTranscribedChapterDraft({ mode: "transcription" })).toBe(false);
  });

  it("says plainly that nobody wrote it, and whether it has been accepted", () => {
    const grounding = buildTranscribedChapterGrounding(block, SOURCE);
    expect(describeTranscribedChapterDraft(grounding, "draft").detail).toMatch(/Nobody wrote this text/i);
    expect(describeTranscribedChapterDraft(grounding, "draft").detail).toMatch(/Nobody has accepted it yet/i);
    expect(describeTranscribedChapterDraft(grounding, "accepted").detail).toMatch(/accepted it/i);
    expect(describeTranscribedChapterDraft(grounding, "dismissed").detail).toMatch(/set it aside/i);
  });

  it("discloses on the badge when the page could not be re-checked", () => {
    const unchecked = verifyStoredChapterBlock(candidate(), null);
    if (!unchecked.ok) throw new Error("fixture should verify");
    const grounding = buildTranscribedChapterGrounding(unchecked.block, SOURCE);
    expect(describeTranscribedChapterDraft(grounding, "draft").detail).toMatch(
      /no longer stored the way it was/i
    );
  });

  it("fingerprints the document, the page and the words — the three things that could stop being true", () => {
    const base = transcribedChapterFactsInput(block, SOURCE);
    expect(transcribedChapterFactsInput(block, SOURCE)).toBe(base);
    expect(transcribedChapterFactsInput({ ...block, page: 113 }, SOURCE)).not.toBe(base);
    expect(transcribedChapterFactsInput({ ...block, quote: `${QUOTE} ` }, SOURCE)).not.toBe(base);
    expect(
      transcribedChapterFactsInput(block, { ...SOURCE, kbDocumentId: "66666666-6666-4666-8666-666666666666" })
    ).not.toBe(base);
  });
});

/*
  MUTATION RESULTS — 2026-08-11, each applied to
  `src/lib/rtp/extraction/chapter-blocks.ts`, run, and reverted.

  THE FIRST ONE PROVED NOTHING, AND THAT IS RECORDED HERE RATHER THAN QUIETLY
  FIXED. The verbatim rule was loosened from `!==` to
  `!quote.includes(normalizeForQuoteMatch(rawText))` and all 24 tests stayed
  GREEN. The two tests aimed at that rule ("refuses a SUMMARY", "refuses a block
  that merely CONTAINS its quote") both use text that is not a substring of the
  quote in EITHER direction, so neither could see the loosening. A truncation
  test was added, and the mutation then failed. Both directions of the loosening
  are now covered separately, because they are separate defects:

  A. `!quote.includes(text)` — accepts a TRUNCATION →
     FAILED "refuses a TRUNCATION of its own quote" (1). Right reason: the first
     60 characters of the plan's sentence were accepted as the sentence.
  B. `!text.includes(quote)` — accepts a WRAPPED quote →
     FAILED "refuses a block that merely CONTAINS its quote" and "refuses two of
     the plan's statements joined into one block" (2). Right reason: a model's
     lead-in and a joined second statement both passed.
  C. `chunkRecheck` initialised to "matched" →
     FAILED "still stages when the cited passage is gone" and "discloses on the
     badge when the page could not be re-checked" (2). Right reason: a block
     nothing re-checked claimed it had been.
  D. The chunk substring check deleted →
     FAILED "refuses a block whose words are no longer on the page it cites" and
     "forgives only how the page was SPACED" (2). Right reason: a quote absent
     from the page, and a recased one, both passed.
  E. `grounded_sentence_count`/`total_sentence_count` set to 1 →
     FAILED "records a transcription, never a grounding check that did not run"
     and the round-trip test (2).
  F. The attribution moved OUTSIDE the block quote →
     FAILED "keeps the attribution INSIDE the quote" and "renders the quote and
     its source" (2).
  G. `quote_verified !== true` changed to `=== false` →
     FAILED "refuses a quote the extraction verifier never confirmed" (1), on
     the `null` case — the projection-forgot-the-column case.
  H. `CHAPTER_BLOCK_MAX_CHARS` hardcoded to 100000 instead of derived →
     FAILED "takes its ceiling FROM the extraction contract" (1).
*/
