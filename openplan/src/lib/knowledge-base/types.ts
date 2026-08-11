/**
 * Shared types for the Knowledge Base (Document Intelligence) module.
 *
 * Mirrors the DB schema in `20260723000001_knowledge_base.sql`. Uploaded
 * documents are extracted into page-anchored text chunks that become citable
 * evidence in the grounding contract (grants + assistant) via `retrieval.ts`.
 */

/** Source kinds the extractor can pull a text layer from. These become `ready` (citable). */
export type KbExtractableSourceKind =
  | "uploaded_pdf"
  | "uploaded_docx"
  | "uploaded_txt"
  | "uploaded_md"
  | "pasted_text";

/**
 * Source kinds OpenPlan STORES without attempting extraction. These become
 * `stored`: findable and downloadable, never citable — no chunks are ever
 * written for them, and the retrieval RPC filters on `status = 'ready'`, so a
 * stored file cannot enter grounding by accident.
 */
export type KbStoredSourceKind =
  | "uploaded_image"
  | "uploaded_spreadsheet"
  | "uploaded_cad"
  | "uploaded_other";

export type KbSourceKind = KbExtractableSourceKind | KbStoredSourceKind;

export type KbDocKind =
  | "rtp"
  | "comment_letter"
  | "prior_study"
  | "nofo"
  | "staff_report"
  | "policy"
  | "other"
  | "drawing"
  | "exhibit";

/**
 * `stored` = kept for download and reference, extraction deliberately not
 * attempted (distinct from `failed` = attempted and no text layer found).
 */
export type KbDocumentStatus =
  | "pending"
  | "extracting"
  | "ready"
  | "failed"
  | "archived"
  | "stored";

/**
 * Where a document's indexed text came from. `none` marks a stored file (no
 * extraction attempted); `null` on a row means it predates the column and the
 * answer was not recorded. Future values (`ocr`, `spreadsheet_parse`) arrive
 * with the worker that actually implements them — they are deliberately not
 * promised here.
 */
export type KbExtractionSource = "text_layer" | "pasted" | "none";

/** All doc-kind values, for zod enums / UI selects. Keep in sync with the CHECK constraint. */
export const KB_DOC_KINDS: readonly KbDocKind[] = [
  "rtp",
  "comment_letter",
  "prior_study",
  "nofo",
  "staff_report",
  "policy",
  "other",
  "drawing",
  "exhibit",
] as const;

/** One page of extracted text (1-based). DOCX / txt / md collapse to a single page. */
export type ExtractedPage = { page: number; text: string };

/** Result of extracting a document's text layer. */
export type ExtractedDocument = {
  pages: ExtractedPage[];
  /** Concatenated page text (pages joined by a blank line). */
  text: string;
  /** Number of pages in the source (PDF); 1 for single-page formats. */
  pageCount: number;
  charCount: number;
};

/** A deterministic, page-anchored text chunk ready to persist to kb_document_chunks. */
export type DocumentChunk = {
  chunkIndex: number;
  content: string;
  /** Smallest / largest source page contributing to this chunk (null when unknown). */
  pageFrom: number | null;
  pageTo: number | null;
  /** Character offsets into the reconstructable chunk-joined document text. */
  charStart: number;
  charEnd: number;
  tokenEstimate: number;
};
