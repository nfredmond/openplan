/**
 * The Document Library — one index over every FILE OpenPlan holds or can
 * produce for a workspace, read live from each owning module's own table.
 *
 * This is an INDEX, not a warehouse (design memo 2026-08-11): there is no
 * mirror table, no write-time hook, and no second copy of anyone's bytes. Each
 * source is read with the CALLER'S RLS client, each source's own row-level
 * security does the tenant scoping, and a read that fails is disclosed per
 * source rather than rendered as an empty shelf.
 *
 * Two invariants every consumer can rely on:
 *
 * 1. `downloadHref` is ALWAYS an app route (`/api/...`), never a constructed
 *    storage URL. Two of the sources carry member-writable or untrusted path
 *    columns (`funding_opportunity_application_exports.storage_path`,
 *    `model_run_artifacts.file_url`); the routes re-verify scope on every
 *    dereference, so the library links the route and nothing else.
 * 2. Listing a file here never makes it citable. Grounding is decided by the
 *    retrieval RPC's `status = 'ready'` filter over kb_document_chunks; the
 *    library only REPORTS `groundable` — it can neither grant it nor write
 *    anything at all.
 */

import type { ReadFailureLog } from "@/lib/ui/read-failures";

/**
 * The phase-1 sources, in the order the merged list presents them (the memo's
 * source numbering: 1, 2, 3, 5, 8, 9, 10). Engagement photos are EXCLUDED
 * (privacy decision — moderation status lives on the comment), datasets are
 * excluded (files only), and network packages / GTFS archives are deferred
 * until they have download routes — listing unopenable rows is its own
 * honesty debt.
 */
export const DOCUMENT_LIBRARY_SOURCE_IDS = [
  "knowledge_base",
  "report_artifacts",
  "grant_application_exports",
  "invoice_pdfs",
  "aerial_imagery",
  "aerial_artifact_custody",
  "model_run_artifacts",
] as const;

export type DocumentLibrarySourceId = (typeof DOCUMENT_LIBRARY_SOURCE_IDS)[number];

export type DocumentLibraryBadgeTone = "positive" | "neutral" | "warning" | "critical";

/** The state chip an entry renders with — planner words, one per row. */
export type DocumentLibraryBadge = {
  label: string;
  tone: DocumentLibraryBadgeTone;
};

/** One file (or file-producing record) in the merged library listing. */
export type DocumentLibraryEntry = {
  sourceId: DocumentLibrarySourceId;
  /** The row's id in ITS OWN table — unique within a source, not across sources. */
  id: string;
  title: string;
  /** Null = a workspace-level record not attached to any project. */
  projectId: string | null;
  /** The source's own recency timestamp (created_at / generated_at), ISO. */
  createdAt: string;
  /** Bytes as recorded by the owning module; null = the module does not record a size. */
  byteSize: number | null;
  /**
   * Whether OpenPlan holds stored bytes behind this entry. False for invoice
   * PDFs (rendered on request — a `downloadHref` with no stored file) and for
   * aerial deliverables not in custody (no link at all). For model-run
   * artifacts this reports the RUN'S claim; the download route is the arbiter
   * and refuses honestly when the registered reference cannot be resolved.
   */
  hasBytes: boolean;
  /**
   * An app ROUTE that serves the file, or null when nothing can be served
   * (a knowledge-base paste with no stored original, a deliverable whose
   * custody failed). Never a storage URL — see the module header.
   */
  downloadHref: string | null;
  badge: DocumentLibraryBadge;
  /**
   * One extra planner-facing sentence when the row needs it: the stored-file
   * notice, a custody failure reason (assembled server-side from the fixed
   * failure vocabulary, never a raw fetch error), the rendered-on-request
   * note on invoices. Null when the badge says it all.
   */
  detail: string | null;
  /**
   * True only for knowledge-base rows whose status is 'ready' — the one kind
   * of entry the grounding contract can cite. Display metadata ONLY: the
   * enforcement lives in the retrieval RPC's status filter, not here.
   */
  groundable: boolean;
};

/**
 * What one source's read established: how many entries it contributed and BOTH
 * ways it can have failed to contribute them. `pending` (deployment behind a
 * migration) and `failed` (anything else, disclosed via the ReadFailureLog)
 * are mutually exclusive by construction — the classifier owns the pending
 * case and the collector takes what is left, exactly as the project page's
 * read lanes do.
 */
export type DocumentSourceOutcome = {
  count: number;
  pending: boolean;
  failed: boolean;
};

/**
 * The merged listing. The shape carries its own caveats so a caller cannot
 * present it as something it is not:
 *
 * - `limitPerSource` is the cap EACH source was read with. The merged list is
 *   per-source-capped — "the most recent N from each source" — and must be
 *   labeled that way, never as a globally sorted or complete inventory.
 * - `perSource` has a key for every source that was QUERIED; an absent key
 *   means the caller excluded that source, which is different from a source
 *   that answered zero rows.
 * - `reads` names every source whose read failed, in the planner's words.
 *   Render `reads.describe()` whenever `reads.any` — an empty lane under a
 *   failed read is not a finding.
 */
export type DocumentLibraryResult = {
  /**
   * Grouped by source in `DOCUMENT_LIBRARY_SOURCE_IDS` order, each source's
   * entries most-recent-first. NOT a global sort across sources.
   */
  entries: DocumentLibraryEntry[];
  reads: ReadFailureLog;
  perSource: Partial<Record<DocumentLibrarySourceId, DocumentSourceOutcome>>;
  limitPerSource: number;
};

/**
 * The header label for the merged list — worded once here so every surface
 * says the same true thing about the ordering (memo decision: the merged
 * ordering is LABELED, never presented as a global sort).
 */
export function describeDocumentLibraryOrdering(limitPerSource: number): string {
  return `Showing up to the ${limitPerSource} most recent files from each source — grouped by source, not sorted across them.`;
}
