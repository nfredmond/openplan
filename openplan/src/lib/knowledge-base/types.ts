/**
 * Shared types for the Knowledge Base (Document Intelligence) module.
 *
 * Mirrors the DB schema in `20260723000001_knowledge_base.sql`. Uploaded
 * documents are extracted into page-anchored text chunks that become citable
 * evidence in the grounding contract (grants + assistant) via `retrieval.ts`.
 */

export type KbSourceKind =
  | "uploaded_pdf"
  | "uploaded_docx"
  | "uploaded_txt"
  | "uploaded_md"
  | "pasted_text";

export type KbDocKind =
  | "rtp"
  | "comment_letter"
  | "prior_study"
  | "nofo"
  | "staff_report"
  | "policy"
  | "other";

export type KbDocumentStatus = "pending" | "extracting" | "ready" | "failed" | "archived";

/** All doc-kind values, for zod enums / UI selects. Keep in sync with the CHECK constraint. */
export const KB_DOC_KINDS: readonly KbDocKind[] = [
  "rtp",
  "comment_letter",
  "prior_study",
  "nofo",
  "staff_report",
  "policy",
  "other",
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
