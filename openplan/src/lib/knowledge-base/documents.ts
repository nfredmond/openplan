/**
 * Server-side persistence + access helpers for Knowledge Base documents.
 *
 * Follows the app's per-domain access convention (see `src/lib/models/api.ts`):
 * the passed-in Supabase client is typed loosely and query results are cast,
 * avoiding the Database generic. Write authorization lives in the API routes
 * (workspace-membership check + service-role writes); RLS enforces read
 * isolation. Storage objects live in the private `kb-documents` bucket at
 * `<workspaceId>/<documentId>/<filename>` and are referenced from the DB as
 * `storage://kb-documents/...`.
 */

import type { DocumentChunk, KbDocKind, KbDocumentStatus, KbSourceKind } from "./types";

export const KB_DOCUMENTS_BUCKET = "kb-documents";

/** Insert chunks in bounded batches so a large document stays under the request cap. */
export const KB_CHUNK_INSERT_BATCH = 500;

/** Map deterministic chunks into insert rows for kb_document_chunks. */
export function buildKbChunkRows(
  documentId: string,
  workspaceId: string,
  chunks: DocumentChunk[]
): Array<Record<string, unknown>> {
  return chunks.map((chunk) => ({
    document_id: documentId,
    workspace_id: workspaceId,
    chunk_index: chunk.chunkIndex,
    page_from: chunk.pageFrom,
    page_to: chunk.pageTo,
    char_start: chunk.charStart,
    char_end: chunk.charEnd,
    content: chunk.content,
    token_estimate: chunk.tokenEstimate,
  }));
}

type ChunkInsertClient = {
  from: (table: string) => {
    insert: (rows: unknown) => PromiseLike<{ error: { message: string } | null }>;
  };
};

/** Persist chunk rows via the service-role client; returns the first error or null. */
export async function insertKbChunks(
  service: unknown,
  rows: Array<Record<string, unknown>>
): Promise<{ message: string } | null> {
  const client = service as ChunkInsertClient;
  for (let i = 0; i < rows.length; i += KB_CHUNK_INSERT_BATCH) {
    const { error } = await client
      .from("kb_document_chunks")
      .insert(rows.slice(i, i + KB_CHUNK_INSERT_BATCH));
    if (error) return error;
  }
  return null;
}

/** Columns returned for list / detail views (never the chunk bodies). */
export const KB_DOCUMENT_COLUMNS =
  "id, workspace_id, project_id, title, doc_kind, source_kind, original_filename, content_type, byte_size, storage_ref, page_count, chunk_count, char_count, status, extraction_error, citation_label, created_at, updated_at";

export type KbDocumentRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  doc_kind: KbDocKind;
  source_kind: KbSourceKind;
  original_filename: string | null;
  content_type: string | null;
  byte_size: number | null;
  storage_ref: string | null;
  page_count: number | null;
  chunk_count: number;
  char_count: number | null;
  status: KbDocumentStatus;
  extraction_error: string | null;
  citation_label: string | null;
  created_at: string;
  updated_at: string;
};

/** Strip a NUL / path separators, keep a safe basename for the storage object. */
export function sanitizeFilename(name: string | null | undefined): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._]+|_+$/g, "")
    .slice(0, 120);
  return cleaned || "document";
}

export function buildKbDocumentPath(
  workspaceId: string,
  documentId: string,
  filename: string | null | undefined
): string {
  return `${workspaceId}/${documentId}/${sanitizeFilename(filename)}`;
}

/**
 * Workspace-membership guard. Moved to `src/lib/workspaces/membership.ts` —
 * it is a generic workspace concern, not a Knowledge Base one, and the Safety
 * module needs the same guard. Re-exported here so existing imports keep
 * working.
 */
export {
  checkWorkspaceMembership,
  looksLikePendingSchema,
  type WorkspaceMembershipResult,
} from "@/lib/workspaces/membership";
