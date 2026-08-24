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
  | "uploaded_spreadsheet"
  | "pasted_text";

/**
 * Source kinds that may be stored without extraction. `uploaded_spreadsheet`
 * spans two byte formats deliberately: CSV is deterministically parsed and
 * ready; binary XLS/XLSX/ODS files remain stored and uncitable.
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
 * Where a document's indexed text came from — ONE vocabulary, written once.
 *
 * `text_layer` the characters the document's own author embedded.
 * `pasted`     a planner typed or pasted the text in.
 * `ocr`        a machine read pictures of words on a scanned page. Materially
 *              weaker provenance than `text_layer`: a 3 can be read as an 8,
 *              a decimal point can be lost in a scan artefact. Every surface
 *              that shows a transcribed figure has to be able to say which of
 *              these it was, which is why this is a vocabulary and not a
 *              boolean. Arrived with 20260811000010 and the OCR worker that
 *              actually implements it.
 * `none`       a stored file; no extraction was attempted.
 * `null` on a row means it predates 20260811000005 and the answer was not
 * recorded — "not known", never "none".
 *
 * `spreadsheet_parse` means deterministic CSV parsing. Binary spreadsheet
 * formats still use `none`; no cell values are inferred from them.
 *
 * THERE IS NO CONFIDENCE OR ACCURACY COMPANION TO THIS COLUMN, EVER. The
 * recogniser can emit per-word confidence figures and the worker deliberately
 * does not collect them: a number the machine invents about its own accuracy
 * reads to every human as a quality signal, and "OCR confidence 94%" beside a
 * dollar figure in an adopted plan is a machine vouching for a planning number.
 *
 * Pinned to BOTH database CHECKs — the original in 20260811000005 and the
 * widened one in 20260811000010 — by
 * `src/test/kb-ocr-extraction-source-vocabulary.test.ts`, in the shape
 * `GTFS_MEDIAN_HEADWAY_BASES` established: two copies of one vocabulary is the
 * shape that shipped a form the database refused at the end.
 *
 * NOTE for the RTP extraction lane: `rtp_extraction_runs.extraction_source`
 * carries a deliberate SUBSET of this vocabulary — only `text_layer` and `ocr`,
 * the two ways a document's text can reach an extraction run. That is a
 * narrowing, not a second vocabulary, and it must stay a subset of this one.
 */
export const KB_EXTRACTION_SOURCES = [
  "text_layer",
  "pasted",
  "ocr",
  "spreadsheet_parse",
  "none",
] as const;

export type KbExtractionSource = (typeof KB_EXTRACTION_SOURCES)[number];

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
