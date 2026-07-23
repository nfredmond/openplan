import { describe, expect, it } from "vitest";
import {
  chunkExtractedDocument,
  estimateTokens,
  MAX_SEGMENT_CHARS,
  TARGET_CHUNK_CHARS,
} from "@/lib/knowledge-base/chunk";
import type { ExtractedPage } from "@/lib/knowledge-base/types";

describe("chunkExtractedDocument", () => {
  it("is deterministic — identical input yields byte-identical chunks", () => {
    const pages: ExtractedPage[] = [{ page: 1, text: "Corridor safety sentence. ".repeat(400) }];
    expect(chunkExtractedDocument(pages)).toEqual(chunkExtractedDocument(pages));
  });

  it("emits sequential chunk indices and strictly increasing offsets", () => {
    const chunks = chunkExtractedDocument([{ page: 1, text: "word ".repeat(6000) }]);
    expect(chunks.length).toBeGreaterThan(1);
    let prevEnd = -1;
    chunks.forEach((chunk, index) => {
      expect(chunk.chunkIndex).toBe(index);
      expect(chunk.charStart).toBeGreaterThanOrEqual(prevEnd + 1 - 1);
      expect(chunk.charEnd).toBeGreaterThan(chunk.charStart);
      expect(chunk.charEnd - chunk.charStart).toBe(chunk.content.length);
      prevEnd = chunk.charEnd;
    });
  });

  it("anchors a coalesced chunk to the full span of pages it covers", () => {
    const pages: ExtractedPage[] = [
      { page: 1, text: "First page about corridors." },
      { page: 2, text: "Second page about safety." },
      { page: 3, text: "Third page about transit." },
    ];
    const chunks = chunkExtractedDocument(pages);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].pageFrom).toBe(1);
    expect(chunks[0].pageTo).toBe(3);
  });

  it("keeps whitespace-separated chunks within the segment ceiling", () => {
    const chunks = chunkExtractedDocument([{ page: 1, text: "word ".repeat(5000) }]);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_SEGMENT_CHARS);
    }
  });

  it("preserves every character of an oversized no-whitespace blob", () => {
    const blob = "x".repeat(9000);
    const chunks = chunkExtractedDocument([{ page: 1, text: blob }]);
    expect(chunks.map((c) => c.content).join("")).toBe(blob);
  });

  it("returns no chunks for blank pages", () => {
    expect(chunkExtractedDocument([{ page: 1, text: "   \n\n  " }])).toEqual([]);
  });

  it("starts a new chunk once the target size is exceeded", () => {
    // Two ~2000-char paragraphs: the second pushes past TARGET_CHUNK_CHARS.
    const para = "sentence ".repeat(220).trim(); // ~1980 chars
    const chunks = chunkExtractedDocument([{ page: 1, text: `${para}\n\n${para}` }]);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].content.length).toBeLessThanOrEqual(TARGET_CHUNK_CHARS + MAX_SEGMENT_CHARS);
  });
});

describe("estimateTokens", () => {
  it("approximates ~4 chars per token with a floor of 1", () => {
    expect(estimateTokens("")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(40))).toBe(10);
  });
});
