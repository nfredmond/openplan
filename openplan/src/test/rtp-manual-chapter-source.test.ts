import { describe, expect, it } from "vitest";
import { verifyStoredChapterBlock, buildTranscribedChapterGrounding, readTranscribedChapterGrounding, transcribedChapterFactsInput } from "@/lib/rtp/extraction/chapter-blocks";
import { parseStoredDraft } from "@/lib/reports/narrative-drafts";

const candidate = { id: "candidate", target_kind: "chapter_block", proposed_json: { text: "Improve access." }, source_page: 112, source_quote: "Improve access.", quote_verified: true };
const source = { kbDocumentId: "doc", documentTitle: "SYNTHETIC plan", retainedPage: { extractionId: "version-1", checksum: "original", contentSha256: "pages" } };
describe("explicit retained-page chapter variant (source tests, not executed)", () => {
  it("MANUAL_CHAPTER_MISSING: refuses a missing retained page while preserving old chunk behavior", () => {
    expect(verifyStoredChapterBlock(candidate, null, "retained_page")).toEqual({ ok: false, reason: "retained_page_missing" });
    expect(verifyStoredChapterBlock(candidate, null)).toMatchObject({ ok: true, block: { chunkRecheck: "chunk_no_longer_stored" } });
  });
  it("MANUAL_CHAPTER_RECHECK: requires actual page text and records explicit retained provenance", () => {
    expect(verifyStoredChapterBlock(candidate, { content: "Different text." }, "retained_page")).toEqual({ ok: false, reason: "quote_not_in_page" });
    const verified = verifyStoredChapterBlock(candidate, { content: candidate.source_quote }, "retained_page");
    expect(verified.ok).toBe(true); if (!verified.ok) throw new Error("fixture must verify");
    const grounding = buildTranscribedChapterGrounding(verified.block, source);
    expect(readTranscribedChapterGrounding(grounding)).toMatchObject({ source_method: "manual_retained_page", chunk_recheck: "retained_page_matched", retained_source: source.retainedPage });
    expect(transcribedChapterFactsInput(verified.block, source)).not.toBe(transcribedChapterFactsInput(verified.block, { ...source, retainedPage: { ...source.retainedPage, extractionId: "version-2" } }));
    const draft = { id: "draft", target_kind: "rtp_chapter", target_id: "chapter", model: null, grounding_json: grounding,
      draft_markdown: "Improve access.", facts_hash: "bound-hash", status: "draft", grounded_sentence_count: 0, total_sentence_count: 0 };
    expect(parseStoredDraft(draft)?.model).toBeNull();
    expect(parseStoredDraft({ ...draft, target_kind: "report_section" })).toBeNull();
    expect(parseStoredDraft({ ...draft, grounding_json: {} })).toBeNull();
  });
});
