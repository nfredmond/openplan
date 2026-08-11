/**
 * `loadDocumentLibrary` — the one read path of the Document Library.
 *
 * A LIVE UNION over the source tables, never a mirror: each source is read in
 * parallel with the CALLER'S client, capped per source, and classified per
 * source. There is deliberately no service-role client anywhere in this module
 * (a test greps for it): two of the sources have no workspace_id column, so a
 * service-role read of them would be a cross-tenant leak — the caller's RLS is
 * the outer wall and the descriptor's workspace filter is the inner one.
 *
 * READ-FAILURE ≠ EMPTY, PER SOURCE. One module's failed read must not empty
 * the whole shelf, and must not let its own lane render as "no files". Each
 * read's error is bound into the source's outcome: `pending` when the
 * deployment is behind a migration (a known state with a named operator move),
 * `failed` for everything else — collected into the `ReadFailureLog` so the
 * page can say which lanes to disbelieve. This is the project page's
 * classify-first-then-collect rule (`_read-lanes.ts`), applied per source; it
 * is rebuilt here from the same primitives (`looksLikePendingSchema` +
 * `ReadFailureLog.check`) because a lib module cannot import from a page's
 * `_components` directory.
 *
 * THIS MODULE WRITES NOTHING. No insert, no upsert, no storage access. A
 * stored document can therefore never become groundable through the library —
 * chunks are only ever written by the knowledge-base ingest path, and the
 * retrieval RPC's `status = 'ready'` filter is the wall this module never
 * touches.
 */

import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { ReadFailureLog } from "@/lib/ui/read-failures";

import { DOCUMENT_LIBRARY_SOURCES, type DocumentLibrarySource } from "./sources";
import type {
  DocumentLibraryEntry,
  DocumentLibraryResult,
  DocumentLibrarySourceId,
  DocumentSourceOutcome,
} from "./types";

/**
 * Default per-source cap. Bounded on both ends: the library is an index page,
 * not an export, and seven uncapped reads on one render is how a page falls
 * over on its thousandth artifact.
 */
export const DOCUMENT_LIBRARY_DEFAULT_LIMIT_PER_SOURCE = 20;
export const DOCUMENT_LIBRARY_MAX_LIMIT_PER_SOURCE = 100;

/**
 * The slice of a supabase-js query chain this module uses. Structural, like
 * every per-domain access module in this repo (`src/lib/models/api.ts`
 * convention): the client is untyped by design and results are cast.
 */
type LibraryReadResult = {
  data: unknown;
  error: { message?: string | null } | null;
};

type LibraryQuery = PromiseLike<LibraryReadResult> & {
  eq(column: string, value: string): LibraryQuery;
  order(column: string, options: { ascending: boolean }): LibraryQuery;
  limit(count: number): LibraryQuery;
};

type LibraryReadClient = {
  from(table: string): { select(columns: string): LibraryQuery };
};

export type LoadDocumentLibraryOptions = {
  workspaceId: string;
  /** Scope every source to one project. Rows not attached to any project are excluded when set. */
  projectId?: string | null;
  /** Which sources to read; omitted = all phase-1 sources. Order is canonical regardless of the array's order. */
  sources?: readonly DocumentLibrarySourceId[];
  /** Per-source cap, clamped to 1..DOCUMENT_LIBRARY_MAX_LIMIT_PER_SOURCE. */
  limitPerSource?: number;
};

function clampLimit(requested: number | undefined): number {
  if (
    typeof requested !== "number" ||
    !Number.isFinite(requested) ||
    !Number.isInteger(requested) ||
    requested < 1
  ) {
    return DOCUMENT_LIBRARY_DEFAULT_LIMIT_PER_SOURCE;
  }
  return Math.min(requested, DOCUMENT_LIBRARY_MAX_LIMIT_PER_SOURCE);
}

async function readSource(
  client: LibraryReadClient,
  source: DocumentLibrarySource,
  workspaceId: string,
  projectId: string | null,
  limitPerSource: number
): Promise<LibraryReadResult> {
  try {
    let query = client
      .from(source.table)
      .select(source.select)
      .eq(source.workspaceFilterColumn, workspaceId);
    if (projectId) query = query.eq(source.projectFilterColumn, projectId);
    return await query.order(source.orderColumn, { ascending: false }).limit(limitPerSource);
  } catch (error) {
    // A thrown read (network, malformed response) is still a failed read, not
    // an empty source; shape it like one so the classification below sees it.
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : "read threw" },
    };
  }
}

/**
 * Read the library. Every queried source appears in `perSource` — with its
 * entry count, or with the honest reason it contributed nothing — and
 * `entries` holds the per-source-capped union, grouped by source,
 * most-recent-first within each. See `DocumentLibraryResult` for the caveats
 * the shape forces on callers.
 */
export async function loadDocumentLibrary(
  supabase: unknown,
  options: LoadDocumentLibraryOptions
): Promise<DocumentLibraryResult> {
  const client = supabase as LibraryReadClient;
  const limitPerSource = clampLimit(options.limitPerSource);
  const projectId = options.projectId ?? null;
  const requested = options.sources ? new Set(options.sources) : null;
  const sources = DOCUMENT_LIBRARY_SOURCES.filter(
    (source) => requested === null || requested.has(source.id)
  );

  const reads = new ReadFailureLog();
  const results = await Promise.all(
    sources.map((source) =>
      readSource(client, source, options.workspaceId, projectId, limitPerSource)
    )
  );

  const entries: DocumentLibraryEntry[] = [];
  const perSource: Partial<Record<DocumentLibrarySourceId, DocumentSourceOutcome>> = {};

  sources.forEach((source, index) => {
    const result = results[index];
    // Classify first (a pending migration has a truer thing to say than
    // "could not be read"), collect what is left.
    const pending = looksLikePendingSchema(result.error?.message);
    const failed = pending ? false : reads.check(source.readLabel, result);
    const rows = pending || failed ? [] : ((result.data ?? []) as Array<Record<string, unknown>>);
    const sourceEntries = rows.map((row) => source.toEntry(row));
    entries.push(...sourceEntries);
    perSource[source.id] = { count: sourceEntries.length, pending, failed };
  });

  return { entries, reads, perSource, limitPerSource };
}
