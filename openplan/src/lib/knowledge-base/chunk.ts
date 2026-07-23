/**
 * Deterministic, page-anchored chunking of an extracted document.
 *
 * Chunks are the retrieval + citation unit: each becomes an excerpt that the
 * grounding contract can cite by document title and page range. The algorithm is
 * intentionally deterministic (no LLM, no randomness) so re-ingesting the same
 * document always produces byte-identical chunks — a property the tests rely on.
 *
 * NOTE: this deliberately does NOT reuse `planner-pack/grounding.ts`'s
 * `splitSentences`. That splitter DROPS structural lines (headings, tables, code
 * fences) because it validates narrative prose; here we must PRESERVE every line
 * of the source so nothing a planner uploaded silently vanishes from the index.
 */

import type { DocumentChunk, ExtractedPage } from "./types";

/** Target chunk size in characters (~800 tokens at ~4 chars/token). */
export const TARGET_CHUNK_CHARS = 3200;
/** Hard ceiling for a single segment before it is windowed (~1050 tokens). */
export const MAX_SEGMENT_CHARS = 4200;

/** Rough token estimate (~4 chars/token) — used only for display + prompt budgeting. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Split an oversized run of text into <= maxChars windows on whitespace boundaries. */
function hardWindow(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const windows: string[] = [];
  let buffer: string[] = [];
  let length = 0;
  for (const word of words) {
    const sep = buffer.length > 0 ? 1 : 0;
    if (length > 0 && length + sep + word.length > maxChars) {
      windows.push(buffer.join(" "));
      buffer = [];
      length = 0;
    }
    buffer.push(word);
    length += (buffer.length > 1 ? 1 : 0) + word.length;
  }
  if (buffer.length > 0) windows.push(buffer.join(" "));
  return windows;
}

function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Break a page's text into content-preserving segments (paragraphs, falling back
 * to sentences then hard windows for oversized runs). Every non-blank character
 * survives into some segment.
 */
function splitIntoSegments(text: string): string[] {
  const segments: string[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length <= MAX_SEGMENT_CHARS) {
      segments.push(trimmed);
      continue;
    }
    for (const sentence of splitSentences(trimmed)) {
      if (sentence.length <= MAX_SEGMENT_CHARS) {
        segments.push(sentence);
      } else {
        segments.push(...hardWindow(sentence, MAX_SEGMENT_CHARS));
      }
    }
  }
  return segments;
}

/**
 * Greedily pack page-tagged segments into ~TARGET_CHUNK_CHARS chunks, recording
 * the page range and character offsets each chunk covers.
 */
export function chunkExtractedDocument(pages: ExtractedPage[]): DocumentChunk[] {
  const tagged: Array<{ text: string; page: number }> = [];
  for (const page of pages) {
    for (const segment of splitIntoSegments(page.text)) {
      tagged.push({ text: segment, page: page.page });
    }
  }

  const chunks: DocumentChunk[] = [];
  let buffer: string[] = [];
  let bufferLen = 0;
  let pageMin = Number.POSITIVE_INFINITY;
  let pageMax = Number.NEGATIVE_INFINITY;
  let offset = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    const content = buffer.join(" ");
    const charStart = offset;
    const charEnd = offset + content.length;
    chunks.push({
      chunkIndex: chunks.length,
      content,
      pageFrom: Number.isFinite(pageMin) ? pageMin : null,
      pageTo: Number.isFinite(pageMax) ? pageMax : null,
      charStart,
      charEnd,
      tokenEstimate: estimateTokens(content),
    });
    offset = charEnd + 1;
    buffer = [];
    bufferLen = 0;
    pageMin = Number.POSITIVE_INFINITY;
    pageMax = Number.NEGATIVE_INFINITY;
  };

  for (const segment of tagged) {
    const sep = buffer.length > 0 ? 1 : 0;
    const addLen = sep + segment.text.length;
    if (bufferLen > 0 && bufferLen + addLen > TARGET_CHUNK_CHARS) {
      flush();
      buffer.push(segment.text);
      bufferLen = segment.text.length;
    } else {
      buffer.push(segment.text);
      bufferLen += addLen;
    }
    pageMin = Math.min(pageMin, segment.page);
    pageMax = Math.max(pageMax, segment.page);
  }
  flush();

  return chunks;
}
