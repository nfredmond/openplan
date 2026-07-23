/**
 * Deterministic document text extraction for the Knowledge Base.
 *
 * Text-layer only, by design (honest boundary): a scanned / image-only PDF with
 * no embedded text yields `NoExtractableTextError` rather than a fabricated
 * empty document. OCR of raster images is a documented future enhancement, not
 * part of this slice. Every extractor returns page-anchored text so downstream
 * chunks (and the excerpts they become) can cite a page number.
 *
 *   PDF  -> unpdf (serverless pdf.js, zero native deps), per-page text.
 *   DOCX -> mammoth raw-text extraction (single logical page).
 *   txt/md -> UTF-8 decode (single logical page).
 *
 * These parsers are heavy and Node-only; they are declared in
 * `serverExternalPackages` (next.config.ts) so the webpack server build does not
 * try to bundle their internals.
 */

import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { ExtractedDocument, ExtractedPage, KbSourceKind } from "./types";

/** No extractable text layer (e.g. a scanned PDF) — surfaced honestly, never faked. */
export class NoExtractableTextError extends Error {
  constructor(
    message = "No extractable text layer was found. Scanned or image-only documents are not supported yet — OCR is not enabled."
  ) {
    super(message);
    this.name = "NoExtractableTextError";
  }
}

/** The bytes could not be parsed as the declared document type. */
export class DocumentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentParseError";
  }
}

/** Content-type -> source kind for the supported upload formats. */
const CONTENT_TYPE_SOURCE_KIND: Record<string, KbSourceKind> = {
  "application/pdf": "uploaded_pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "uploaded_docx",
  "text/plain": "uploaded_txt",
  "text/markdown": "uploaded_md",
  "text/x-markdown": "uploaded_md",
};

/** Filename extension -> source kind, used only when the content type is generic. */
const EXTENSION_SOURCE_KIND: Record<string, KbSourceKind> = {
  pdf: "uploaded_pdf",
  docx: "uploaded_docx",
  txt: "uploaded_txt",
  text: "uploaded_txt",
  md: "uploaded_md",
  markdown: "uploaded_md",
};

/**
 * Resolve the upload source kind from the declared content type, falling back to
 * the filename extension when the content type is missing or generic
 * (`application/octet-stream`). Returns null when the format is unsupported.
 */
export function resolveSourceKind(
  contentType: string | null | undefined,
  filename: string | null | undefined
): KbSourceKind | null {
  const normalizedType = (contentType ?? "").split(";")[0].trim().toLowerCase();
  const byType = CONTENT_TYPE_SOURCE_KIND[normalizedType];
  if (byType) return byType;

  const ext = (filename ?? "").toLowerCase().split(".").pop() ?? "";
  return EXTENSION_SOURCE_KIND[ext] ?? null;
}

/**
 * Drop C0 control characters except tab / newline / carriage-return. NUL in
 * particular MUST go — Postgres text columns reject it and would fail the chunk
 * insert. Done by char code (no control-char regex) so it stays lint-clean.
 */
function stripControlChars(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code >= 32 || code === 9 || code === 10 || code === 13) {
      out += ch;
    }
  }
  return out;
}

function normalizeWhitespace(input: string): string {
  return stripControlChars(input)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Join pages, compute counts, and enforce the "must have real text" boundary. */
function assembleExtracted(pages: ExtractedPage[], pageCount: number): ExtractedDocument {
  const kept = pages
    .map((p) => ({ page: p.page, text: normalizeWhitespace(p.text) }))
    .filter((p) => p.text.length > 0);

  const text = kept.map((p) => p.text).join("\n\n");
  if (!text.trim()) {
    throw new NoExtractableTextError();
  }

  return {
    pages: kept,
    text,
    pageCount: pageCount > 0 ? pageCount : kept.length,
    charCount: text.length,
  };
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // `.slice()` hands pdf.js its own buffer so it cannot detach the caller's
    // bytes (which the route still needs for checksum + storage upload).
    pdf = await getDocumentProxy(bytes.slice());
  } catch (error) {
    throw new DocumentParseError(
      `Could not parse the PDF (${error instanceof Error ? error.message : "unknown error"}).`
    );
  }

  // mergePages:false -> one text string per page, so the page index IS the anchor.
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages: ExtractedPage[] = text.map((pageText, index) => ({
    page: index + 1,
    text: pageText ?? "",
  }));
  return assembleExtracted(pages, totalPages ?? pages.length);
}

async function extractDocx(bytes: Uint8Array): Promise<ExtractedDocument> {
  let value: string;
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    value = result.value ?? "";
  } catch (error) {
    throw new DocumentParseError(
      `Could not parse the Word document (${error instanceof Error ? error.message : "unknown error"}).`
    );
  }
  // DOCX has no intrinsic page breaks; treat the whole document as one logical page.
  return assembleExtracted([{ page: 1, text: value }], 1);
}

function extractPlainText(bytes: Uint8Array): ExtractedDocument {
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return assembleExtracted([{ page: 1, text: decoded }], 1);
}

/**
 * Extract a document's text by source kind. `pasted_text` is handled by the
 * caller (the text arrives directly, not as bytes), so it is rejected here.
 */
export async function extractDocument(
  bytes: Uint8Array,
  sourceKind: KbSourceKind
): Promise<ExtractedDocument> {
  switch (sourceKind) {
    case "uploaded_pdf":
      return extractPdf(bytes);
    case "uploaded_docx":
      return extractDocx(bytes);
    case "uploaded_txt":
    case "uploaded_md":
      return extractPlainText(bytes);
    case "pasted_text":
      throw new DocumentParseError(
        "pasted_text has no bytes to extract; build an ExtractedDocument from the text directly."
      );
  }
}

/** Build an ExtractedDocument from already-in-hand text (pasted-text path). */
export function extractedFromText(rawText: string): ExtractedDocument {
  return assembleExtracted([{ page: 1, text: rawText }], 1);
}
