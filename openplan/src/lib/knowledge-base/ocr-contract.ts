/**
 * TypeScript/zod mirror of schemas/ocr_extraction_contract.schema.json
 * (openplan-ocr-extraction.v1) — the service contract between OpenPlan and an
 * OCR worker (workers/ocr_worker, or any worker that speaks it).
 *
 * The JSON schema at the repository root is the single source of truth; the
 * Python worker mirrors it too, and each side's test suite cross-checks its own
 * mirror against that file so the three cannot drift silently.
 *
 * THE PAGE INVARIANT IS THE CONTRACT. A succeeded callback carries one entry
 * per page of the source, numbered 1..pageCount ascending with no gaps and no
 * duplicates — INCLUDING pages that recognised nothing, which arrive as empty
 * strings. `ocrCallbackSchema` refuses anything else. The reason is not
 * tidiness: a dropped blank page renumbers every page after it, and the
 * renumbering is invisible from that moment on. Every citation made from the
 * document would name the wrong page, and no screen, no test and no reader
 * downstream could tell.
 *
 * WHAT THIS CONTRACT DOES NOT CARRY, ON PURPOSE: any confidence, certainty or
 * likelihood figure. `.strict()` below is what enforces it — a worker that
 * started sending one would be refused at the door rather than having the field
 * quietly ignored and then, one release later, quietly displayed.
 */

import { z } from "zod";
import type { ExtractedPage } from "./types";

export const OCR_CONTRACT_SCHEMA_VERSION = "openplan-ocr-extraction.v1" as const;
export const OCR_CONTRACT_SCHEMA_VERSIONS = [OCR_CONTRACT_SCHEMA_VERSION] as const;

export const OCR_CALLBACK_STATUSES = [
  "accepted",
  "running",
  "succeeded",
  "failed",
  "canceled",
] as const;
export type OcrCallbackStatus = (typeof OCR_CALLBACK_STATUSES)[number];

/**
 * The vocabulary of `kb_ocr_jobs.status` (20260811000010), which is NOT the
 * contract's vocabulary and deliberately so. A planner looking at this row is
 * asking one question — is text coming? — so `accepted` folds into `running`
 * (the worker has it) and `canceled` folds into `failed` with the reason (it is
 * not coming). Keeping a fifth state a planner cannot act on would be schema
 * mirroring a protocol rather than answering a question.
 */
export const KB_OCR_JOB_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export type KbOcrJobStatus = (typeof KB_OCR_JOB_STATUSES)[number];

/** Contract status -> stored job status. Total by construction. */
export const OCR_STATUS_TO_JOB_STATUS: Record<OcrCallbackStatus, KbOcrJobStatus> = {
  accepted: "running",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  canceled: "failed",
};

/** Terminal job states: a later callback may not walk one backwards. */
export const TERMINAL_KB_OCR_JOB_STATUSES: readonly KbOcrJobStatus[] = ["succeeded", "failed"];

/**
 * Columns returned for the job a surface shows. Named once so the request
 * route and any future reader select the same shape — a `.select()` string is
 * not type-checked (Supabase clients are intentionally untyped here), so a
 * column typo surfaces at runtime and a second copy of the list is a second
 * chance to make one.
 */
export const KB_OCR_JOB_COLUMNS =
  "id, document_id, request_id, worker_job_id, status, progress, message, page_count, pages_with_text, engine_name, engine_version, languages, failure_detail, last_callback_id, last_callback_at, requested_by, created_at, updated_at";

export type KbOcrJobRow = {
  id: string;
  document_id: string;
  request_id: string;
  worker_job_id: string | null;
  status: KbOcrJobStatus;
  progress: number | null;
  message: string | null;
  page_count: number | null;
  pages_with_text: number | null;
  engine_name: string | null;
  engine_version: string | null;
  languages: string[] | null;
  failure_detail: string | null;
  last_callback_id: string | null;
  last_callback_at: string | null;
  requested_by: string | null;
  created_at: string;
  updated_at: string;
};

export const OCR_MAX_PAGES = 5000;
export const OCR_MAX_PAGE_CHARS = 200_000;
export const OCR_MAX_LANGUAGES = 8;

const ocrPageSchema = z
  .object({
    page: z.number().int().min(1),
    text: z.string().max(OCR_MAX_PAGE_CHARS),
  })
  .strict();

export const ocrCallbackSchema = z
  .object({
    schemaVersion: z.enum(OCR_CONTRACT_SCHEMA_VERSIONS),
    requestId: z.string().min(8).max(128),
    callbackId: z.string().min(8).max(128),
    jobReference: z.string().min(1).max(128),
    status: z.enum(OCR_CALLBACK_STATUSES),
    occurredAt: z.string().datetime({ offset: true }),
    progress: z.number().int().min(0).max(100).optional(),
    message: z.string().max(2048).optional(),
    pageCount: z.number().int().min(0).optional(),
    pages: z.array(ocrPageSchema).max(OCR_MAX_PAGES).optional(),
    engine: z
      .object({
        name: z.string().max(64),
        version: z.string().max(64).optional(),
        languages: z.array(z.string().max(32)).max(OCR_MAX_LANGUAGES).optional(),
        pagesWithText: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status !== "succeeded") {
      if (value.pages !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["pages"],
          message: `a ${value.status} callback must not carry pages`,
        });
      }
      return;
    }

    if (value.pages === undefined || value.pageCount === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["pages"],
        message:
          "pages and pageCount are required when status is 'succeeded' — a success with no pages is a failure that did not say so",
      });
      return;
    }

    if (value.pages.length !== value.pageCount) {
      ctx.addIssue({
        code: "custom",
        path: ["pageCount"],
        message: `pageCount is ${value.pageCount} but ${value.pages.length} pages arrived; refusing text whose page numbers may have shifted`,
      });
      return;
    }

    // 1..N ascending, no gaps, no duplicates. The whole feature rests here.
    for (let index = 0; index < value.pages.length; index += 1) {
      if (value.pages[index].page !== index + 1) {
        ctx.addIssue({
          code: "custom",
          path: ["pages", index, "page"],
          message: `page ${value.pages[index].page} arrived where page ${index + 1} was expected — a gap or a duplicate renumbers every page after it, and nothing downstream could detect that`,
        });
        return;
      }
    }
  });

export type OcrCallback = z.infer<typeof ocrCallbackSchema>;

export type BuildOcrRequestInput = {
  requestId: string;
  callbackUrl: string;
  documentId: string;
  workspaceId: string;
  projectId?: string | null;
  documentTitle: string;
  sourceUrl: string;
  filename?: string | null;
  sizeBytes?: number | null;
  checksumSha256?: string | null;
  languages: string[];
  maxCallbackBytes: number;
};

/**
 * Assemble the OcrRequest body. Optional fields are omitted rather than sent as
 * null: the worker's validator is strict about types, and `null` is not
 * "absent" to it.
 */
export function buildOcrRequest(input: BuildOcrRequestInput): Record<string, unknown> {
  const source: Record<string, unknown> = { url: input.sourceUrl };
  if (input.filename) source.filename = input.filename.slice(0, 512);
  if (typeof input.sizeBytes === "number" && input.sizeBytes > 0) source.sizeBytes = input.sizeBytes;
  if (input.checksumSha256) source.checksumSha256 = input.checksumSha256;

  const externalRef: Record<string, unknown> = {
    system: "openplan",
    documentId: input.documentId,
    workspaceId: input.workspaceId,
  };
  if (input.projectId) externalRef.projectId = input.projectId;

  return {
    schemaVersion: OCR_CONTRACT_SCHEMA_VERSION,
    requestId: input.requestId,
    callbackUrl: input.callbackUrl,
    externalRef,
    documentTitle: input.documentTitle.slice(0, 256) || "Untitled document",
    source,
    languages: input.languages.slice(0, OCR_MAX_LANGUAGES),
    // Declared so the worker can MEASURE its payload before sending: over the
    // ceiling it fails with both numbers instead of meeting a 413 it cannot
    // learn anything from, leaving the job `running` forever.
    maxCallbackBytes: input.maxCallbackBytes,
  };
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

/**
 * Normalize one page of recognised text EXACTLY as the text-layer path does.
 *
 * THIS IS A SECOND COPY OF `normalizeWhitespace` FROM extract.ts, and that is a
 * problem stated rather than hidden. It is duplicated because extract.ts keeps
 * the function private and this lane may not modify that file; the honest fix
 * is to export it from one place and have both callers import it, which is a
 * one-line change for whoever next owns extract.ts.
 *
 * Until then the duplication is held by a MECHANISM, not a comment:
 * `kb-ocr-normalization-matches-the-text-layer.test.ts` runs both
 * implementations over the same fixtures — the other one through its exported
 * `extractedFromText` — and fails if they ever disagree. Two chunkers producing
 * different text for the same input would break the property the RTP extraction
 * lane's verifier depends on, which is that a quote is a substring of the chunk
 * that carries it.
 */
export function normalizeOcrPageText(input: string): string {
  return stripControlChars(input)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Turn a succeeded callback's pages into the `ExtractedPage[]` the shared
 * chunker takes.
 *
 * Pages that normalize to nothing are dropped from the CHUNKING input — a page
 * with no text produces no chunk, exactly as in the text-layer path — but every
 * surviving page keeps its OWN page number. The two are not the same operation:
 * dropping the entry is fine, renumbering the rest is the bug.
 */
export function ocrPagesToExtractedPages(
  pages: ReadonlyArray<{ page: number; text: string }>
): ExtractedPage[] {
  return pages
    .map((page) => ({ page: page.page, text: normalizeOcrPageText(page.text) }))
    .filter((page) => page.text.length > 0);
}
