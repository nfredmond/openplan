/**
 * The Document Library's source descriptors — one entry per module that holds
 * files, each declaring exactly how its table is read and how a row becomes a
 * `DocumentLibraryEntry`.
 *
 * TENANCY IS PER-SOURCE AND DELIBERATE. Two of these tables carry NO
 * workspace_id of their own (`report_artifacts`, `model_run_artifacts`) —
 * their RLS policies join through the parent (`reports`, `model_runs`). The
 * library therefore reads them with a `!inner` embed on that parent and
 * filters the workspace THROUGH the embed. The `!inner` is load-bearing: a
 * plain embed would keep the artifact row and null the parent when the filter
 * misses, and a member of two workspaces would see one workspace's artifacts
 * listed under the other. RLS is the outer wall; the inner join is what scopes
 * the LIST to the workspace being viewed. (Proven by fixture in
 * `src/test/document-library-query.test.ts` — a decoy whose parent lives in
 * another workspace.)
 *
 * PATH COLUMNS STAY OUT OF THE ENTRIES. `funding_opportunity_application_exports.storage_path`
 * is member-INSERTable and `model_run_artifacts.file_url` is untrusted data
 * (`src/lib/models/artifact-source.ts`), so no descriptor selects a path it
 * does not need and no entry ever carries one — `downloadHref` is always the
 * owning module's download ROUTE, which re-verifies scope on dereference.
 * (`report_artifacts.storage_path` is selected ONLY to distinguish "bytes
 * exist" from "no artifact was stored"; the value itself goes nowhere.)
 */

import type { AerialArtifactCustodyState } from "@/lib/aerial/artifact-custody";
import { formatArtifactKindLabel } from "@/lib/aerial/catalog";
import { KB_STORED_DOCUMENT_NOTICE } from "@/lib/knowledge-base/documents";
import type { KbDocumentStatus } from "@/lib/knowledge-base/types";

import type {
  DocumentLibraryBadge,
  DocumentLibraryEntry,
  DocumentLibrarySourceId,
} from "./types";

/**
 * How one module's files are read and presented. `select` strings are PostgREST
 * projections (embeds included) — they are asserted against fixtures in the
 * query tests, because untyped Supabase clients do not check them at build time.
 */
export type DocumentLibrarySource = {
  id: DocumentLibrarySourceId;
  /** Chip / group heading, planner voice. */
  label: string;
  /**
   * What a failed read of this source is called in the disclosure sentence:
   * plural, lowercase, no trailing period (`ReadFailureLog` renders it
   * mid-sentence).
   */
  readLabel: string;
  table: string;
  select: string;
  /**
   * The column the workspace filter binds to — a dotted embed path for the
   * two tables that have no workspace_id of their own.
   */
  workspaceFilterColumn: string;
  /** The column an optional project scope binds to (dotted embed path where the project lives on a parent). */
  projectFilterColumn: string;
  /** Recency column the per-source cap is taken against, descending. */
  orderColumn: string;
  /** Whether this source ever holds stored bytes (invoices render on request instead). */
  hasBytes: boolean;
  /** Whether this source can ever contribute citable (groundable) entries. Knowledge Base only. */
  groundable: boolean;
  toEntry: (row: Record<string, unknown>) => DocumentLibraryEntry;
};

/**
 * A to-one PostgREST embed arrives as an object, but supabase-js types it
 * loosely and an ambiguous relationship can yield an array. Normalize to the
 * single record — or null, which after a `!inner` select should be impossible
 * and is treated as "parent unavailable" rather than hidden, so a broken join
 * shows up on screen instead of silently narrowing the list.
 */
function embedded(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** What a row whose `!inner` parent came back empty is titled — visible, not hidden. */
const PARENT_UNAVAILABLE = "(record unavailable)";

// ---------------------------------------------------------------------------
// 1. Knowledge Base — the one store the library OWNS.
// ---------------------------------------------------------------------------

function kbBadge(status: KbDocumentStatus): DocumentLibraryBadge {
  switch (status) {
    case "ready":
      return { label: "Citable", tone: "positive" };
    case "stored":
      return { label: "Stored", tone: "neutral" };
    case "pending":
      return { label: "Awaiting indexing", tone: "neutral" };
    case "extracting":
      return { label: "Indexing", tone: "neutral" };
    case "failed":
      return { label: "Indexing failed", tone: "warning" };
    case "archived":
      return { label: "Archived", tone: "neutral" };
    default:
      // A status this build does not know is still a real row; show it verbatim.
      return { label: String(status), tone: "neutral" };
  }
}

const knowledgeBaseSource: DocumentLibrarySource = {
  id: "knowledge_base",
  label: "Knowledge Base",
  readLabel: "knowledge base documents",
  table: "kb_documents",
  select:
    "id, project_id, title, doc_kind, source_kind, byte_size, storage_ref, status, extraction_error, created_at",
  workspaceFilterColumn: "workspace_id",
  projectFilterColumn: "project_id",
  orderColumn: "created_at",
  hasBytes: true,
  groundable: true,
  toEntry: (row) => {
    const status = (asString(row.status) ?? "pending") as KbDocumentStatus;
    const hasBytes = asString(row.storage_ref) !== null;
    const detail =
      status === "stored"
        ? KB_STORED_DOCUMENT_NOTICE
        : status === "failed"
          ? (asString(row.extraction_error) ?? "Text indexing failed; the file itself is kept.")
          : null;
    return {
      sourceId: "knowledge_base",
      id: String(row.id),
      title: asString(row.title) ?? "(untitled document)",
      projectId: asString(row.project_id),
      createdAt: asString(row.created_at) ?? "",
      byteSize: asNumber(row.byte_size),
      hasBytes,
      // Pasted text has no stored original: nothing to download, honestly none.
      downloadHref: hasBytes ? `/api/knowledge-base/documents/${row.id}/download` : null,
      badge: kbBadge(status),
      detail,
      groundable: status === "ready",
    };
  },
};

// ---------------------------------------------------------------------------
// 2. Report artifacts — NO workspace_id on the table; scoped through reports.
// ---------------------------------------------------------------------------

const reportArtifactsSource: DocumentLibrarySource = {
  id: "report_artifacts",
  label: "Reports",
  readLabel: "report files",
  table: "report_artifacts",
  select:
    "id, report_id, artifact_kind, storage_path, generated_at, reports!inner(workspace_id, project_id, title)",
  workspaceFilterColumn: "reports.workspace_id",
  projectFilterColumn: "reports.project_id",
  orderColumn: "generated_at",
  hasBytes: true,
  groundable: false,
  toEntry: (row) => {
    const report = embedded(row.reports);
    const kind = asString(row.artifact_kind) ?? "pdf";
    const hasBytes = asString(row.storage_path) !== null;
    return {
      sourceId: "report_artifacts",
      id: String(row.id),
      title: asString(report?.title) ?? PARENT_UNAVAILABLE,
      projectId: asString(report?.project_id),
      createdAt: asString(row.generated_at) ?? "",
      byteSize: null,
      hasBytes,
      downloadHref: hasBytes
        ? `/api/reports/${row.report_id}/artifacts/${row.id}/download`
        : null,
      badge: { label: kind === "html" ? "HTML" : "PDF", tone: "neutral" },
      detail: null,
      groundable: false,
    };
  },
};

// ---------------------------------------------------------------------------
// 3. Grant application exports — workspace_id on the row; project via the
// opportunity. storage_path is member-INSERTable and is NOT selected.
// ---------------------------------------------------------------------------

const grantExportsSource: DocumentLibrarySource = {
  id: "grant_application_exports",
  label: "Grant applications",
  readLabel: "grant application exports",
  table: "funding_opportunity_application_exports",
  select:
    "id, opportunity_id, page_count, generated_at, funding_opportunities!inner(project_id, title)",
  workspaceFilterColumn: "workspace_id",
  projectFilterColumn: "funding_opportunities.project_id",
  orderColumn: "generated_at",
  hasBytes: true,
  groundable: false,
  toEntry: (row) => {
    const opportunity = embedded(row.funding_opportunities);
    const pageCount = asNumber(row.page_count);
    return {
      sourceId: "grant_application_exports",
      id: String(row.id),
      title: asString(opportunity?.title) ?? PARENT_UNAVAILABLE,
      projectId: asString(opportunity?.project_id),
      createdAt: asString(row.generated_at) ?? "",
      byteSize: null,
      hasBytes: true,
      downloadHref: `/api/funding-opportunities/${row.opportunity_id}/application/export/${row.id}/download`,
      badge: { label: "Application PDF", tone: "neutral" },
      detail: pageCount !== null ? `${pageCount} page${pageCount === 1 ? "" : "s"}` : null,
      groundable: false,
    };
  },
};

// ---------------------------------------------------------------------------
// 5. Invoice PDFs — NOT stored; the route renders the document on request.
// The index row points at the route and claims no bytes.
// ---------------------------------------------------------------------------

function invoiceBadge(status: string): DocumentLibraryBadge {
  switch (status) {
    case "draft":
      return { label: "Draft", tone: "neutral" };
    case "sent":
      return { label: "Sent", tone: "positive" };
    case "paid":
      return { label: "Paid", tone: "positive" };
    case "void":
      return { label: "Void", tone: "warning" };
    default:
      return { label: status, tone: "neutral" };
  }
}

const invoicePdfsSource: DocumentLibrarySource = {
  id: "invoice_pdfs",
  label: "Client invoices",
  readLabel: "client invoices",
  table: "client_invoices",
  select: "id, project_id, invoice_number, status, invoice_date, created_at",
  workspaceFilterColumn: "workspace_id",
  projectFilterColumn: "project_id",
  orderColumn: "created_at",
  hasBytes: false,
  groundable: false,
  toEntry: (row) => ({
    sourceId: "invoice_pdfs",
    id: String(row.id),
    title: `Invoice ${asString(row.invoice_number) ?? "(unnumbered)"}`,
    projectId: asString(row.project_id),
    createdAt: asString(row.created_at) ?? "",
    byteSize: null,
    hasBytes: false,
    downloadHref: `/api/invoicing/client-invoices/${row.id}/pdf`,
    badge: invoiceBadge(asString(row.status) ?? "draft"),
    detail: "Rendered on request — OpenPlan stores the invoice record, not a file.",
    groundable: false,
  }),
};

// ---------------------------------------------------------------------------
// 8. Aerial imagery — workspace_id on the row; project + title via the mission.
// ---------------------------------------------------------------------------

const aerialImagerySource: DocumentLibrarySource = {
  id: "aerial_imagery",
  label: "Aerial imagery",
  readLabel: "aerial mission photos",
  table: "aerial_imagery",
  select:
    "id, mission_id, original_filename, byte_size, captured_at, created_at, aerial_missions!inner(project_id, title)",
  workspaceFilterColumn: "workspace_id",
  projectFilterColumn: "aerial_missions.project_id",
  orderColumn: "created_at",
  hasBytes: true,
  groundable: false,
  toEntry: (row) => {
    const mission = embedded(row.aerial_missions);
    const missionTitle = asString(mission?.title);
    return {
      sourceId: "aerial_imagery",
      id: String(row.id),
      title: asString(row.original_filename) ?? "(unnamed photo)",
      projectId: asString(mission?.project_id),
      createdAt: asString(row.created_at) ?? "",
      byteSize: asNumber(row.byte_size),
      hasBytes: true,
      downloadHref: `/api/aerial/missions/${row.mission_id}/imagery/${row.id}/download`,
      badge: { label: "Mission photo", tone: "neutral" },
      detail: missionTitle ? `From mission "${missionTitle}"` : null,
      groundable: false,
    };
  },
};

// ---------------------------------------------------------------------------
// 9. Aerial artifact custody — ONLY `held` rows have bytes. Non-held rows are
// listed WITH their failure vocabulary and NO link: a deliverable OpenPlan
// could not take custody of is a fact the planner needs, not a row to hide.
// `failure_detail` is assembled server-side from a fixed vocabulary
// (src/lib/aerial/artifact-custody.ts) — it can never carry a signed URL.
// ---------------------------------------------------------------------------

function custodyBadge(state: AerialArtifactCustodyState): DocumentLibraryBadge {
  switch (state) {
    case "held":
      return { label: "Held", tone: "positive" };
    case "pending":
      return { label: "Custody pending", tone: "neutral" };
    case "failed":
      return { label: "Custody failed", tone: "critical" };
    case "refused":
      return { label: "Custody refused", tone: "warning" };
    default:
      return { label: String(state), tone: "neutral" };
  }
}

function custodyDetail(state: AerialArtifactCustodyState, row: Record<string, unknown>): string | null {
  if (state === "held") return null;
  if (state === "pending") return "OpenPlan has not taken custody of this file yet.";
  const reason = asString(row.failure_detail) ?? asString(row.failure_code);
  return reason ?? "No reason was recorded.";
}

const aerialCustodySource: DocumentLibrarySource = {
  id: "aerial_artifact_custody",
  label: "Aerial deliverables",
  readLabel: "aerial processing deliverables",
  table: "aerial_artifact_custody",
  select:
    "id, processing_job_id, kind, state, byte_size, failure_code, failure_detail, created_at, aerial_missions!inner(title), aerial_processing_jobs!inner(project_id)",
  workspaceFilterColumn: "workspace_id",
  projectFilterColumn: "aerial_processing_jobs.project_id",
  orderColumn: "created_at",
  hasBytes: true,
  groundable: false,
  toEntry: (row) => {
    const mission = embedded(row.aerial_missions);
    const job = embedded(row.aerial_processing_jobs);
    const state = (asString(row.state) ?? "pending") as AerialArtifactCustodyState;
    const held = state === "held";
    const kindLabel = formatArtifactKindLabel(asString(row.kind) ?? "");
    const missionTitle = asString(mission?.title);
    return {
      sourceId: "aerial_artifact_custody",
      id: String(row.id),
      title: missionTitle ? `${kindLabel} — ${missionTitle}` : kindLabel,
      projectId: asString(job?.project_id),
      createdAt: asString(row.created_at) ?? "",
      byteSize: held ? asNumber(row.byte_size) : null,
      hasBytes: held,
      downloadHref: held
        ? `/api/aerial/processing-jobs/${row.processing_job_id}/artifacts/${row.id}/download`
        : null,
      badge: custodyBadge(state),
      detail: custodyDetail(state, row),
      groundable: false,
    };
  },
};

// ---------------------------------------------------------------------------
// 10. Model-run artifacts — NO workspace_id on the table; scoped through
// model_runs. file_url is UNTRUSTED and is not selected; the download route
// confines every dereference (artifact-source.ts).
// ---------------------------------------------------------------------------

const modelRunArtifactsSource: DocumentLibrarySource = {
  id: "model_run_artifacts",
  label: "Model runs",
  readLabel: "model run outputs",
  table: "model_run_artifacts",
  select:
    "id, run_id, artifact_type, file_size_bytes, created_at, model_runs!inner(workspace_id, model_id, run_title, models!inner(project_id, title))",
  workspaceFilterColumn: "model_runs.workspace_id",
  projectFilterColumn: "model_runs.models.project_id",
  orderColumn: "created_at",
  hasBytes: true,
  groundable: false,
  toEntry: (row) => {
    const run = embedded(row.model_runs);
    const model = embedded(run?.models);
    const runTitle = asString(run?.run_title);
    const artifactType = asString(row.artifact_type) ?? "artifact";
    return {
      sourceId: "model_run_artifacts",
      id: String(row.id),
      title: runTitle ? `${runTitle} — ${artifactType}` : PARENT_UNAVAILABLE,
      projectId: asString(model?.project_id),
      createdAt: asString(row.created_at) ?? "",
      byteSize: asNumber(row.file_size_bytes),
      hasBytes: true,
      downloadHref: run
        ? `/api/models/${run.model_id}/runs/${row.run_id}/artifacts/${row.id}/download`
        : null,
      badge: { label: artifactType, tone: "neutral" },
      detail: null,
      groundable: false,
    };
  },
};

/**
 * Phase-1 sources in presentation order. This array IS the library's scope:
 * `loadDocumentLibrary` reads exactly these, nothing else, and the confinement
 * test greps this file to prove no reader-inventory-guarded table (participant
 * PII, survey responses, the KPI chain) is named here, even inside an embed.
 */
export const DOCUMENT_LIBRARY_SOURCES: readonly DocumentLibrarySource[] = [
  knowledgeBaseSource,
  reportArtifactsSource,
  grantExportsSource,
  invoicePdfsSource,
  aerialImagerySource,
  aerialCustodySource,
  modelRunArtifactsSource,
];
