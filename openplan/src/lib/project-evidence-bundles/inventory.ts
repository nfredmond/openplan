import { DOCUMENT_LIBRARY_SOURCES } from "@/lib/document-library/sources";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { parseStorageRef, workerLocalRoot } from "@/lib/models/artifact-source";
import {
  PROJECT_EVIDENCE_CANDIDATE_LIMIT,
  PROJECT_EVIDENCE_FILE_BYTE_LIMIT,
  PROJECT_EVIDENCE_SELECTED_FILE_LIMIT,
  PROJECT_EVIDENCE_TOTAL_BYTE_LIMIT,
  projectEvidenceCandidateId,
  projectEvidenceRevisionToken,
  type ProjectEvidenceCandidate,
  type ProjectEvidenceCandidateInventory,
  type ProjectEvidenceCandidateSourceId,
  type ProjectEvidencePriorBundle,
} from "./contracts";

const READ_LIMIT = PROJECT_EVIDENCE_CANDIDATE_LIMIT + 1;

type ReadResult = { data: unknown; error: { message?: string | null } | null };
type Query = PromiseLike<ReadResult> & {
  eq(column: string, value: string): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
};
type ReadClient = { from(table: string): { select(columns: string): Query } };

type ProjectIdentity = {
  id: string;
  workspace_id: string;
  name?: string | null;
  updated_at?: string | null;
};

type EvidenceDescriptor = {
  id: Exclude<ProjectEvidenceCandidateSourceId, "project_geopackage">;
  select: string;
};

const SELECTS: Record<EvidenceDescriptor["id"], string> = {
  knowledge_base:
    "id, project_id, title, doc_kind, source_kind, original_filename, content_type, byte_size, storage_ref, checksum, status, extraction_error, citation_label, created_at, updated_at",
  report_artifacts:
    "id, report_id, artifact_kind, storage_path, generated_at, metadata_json, updated_at, reports!inner(workspace_id, project_id, title)",
  grant_application_exports:
    "id, opportunity_id, page_count, pdf_engine, generated_at, funding_opportunities!inner(project_id, title)",
  invoice_pdfs:
    "id, project_id, invoice_number, status, invoice_date, created_at, updated_at",
  aerial_imagery:
    "id, mission_id, original_filename, content_type, byte_size, checksum_sha256, captured_at, created_at, updated_at, aerial_missions!inner(project_id, title)",
  aerial_artifact_custody:
    "id, processing_job_id, kind, ordinal, state, storage_bucket, storage_path, byte_size, checksum_sha256, content_type, source_expires_at, failure_code, failure_detail, created_at, held_at, aerial_missions!inner(title), aerial_processing_jobs!inner(project_id)",
  model_run_artifacts:
    "id, run_id, artifact_type, file_url, file_size_bytes, created_at, model_runs!inner(workspace_id, model_id, run_title, models!inner(project_id, title))",
};

function record(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return record(value[0]);
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function metadataChecksum(value: unknown): string | null {
  const metadata = record(value);
  return text(metadata?.checksumSha256) ?? text(metadata?.checksum_sha256) ?? null;
}

function candidate(
  value: Omit<ProjectEvidenceCandidate, "id" | "revisionToken">
): ProjectEvidenceCandidate {
  const exceedsRecordedLimit =
    value.byteSize !== null && value.byteSize > PROJECT_EVIDENCE_FILE_BYTE_LIMIT;
  const withId = {
    ...value,
    ...(exceedsRecordedLimit
      ? {
          retrievalState: "reference_only" as const,
          defaultSelected: false,
          selectable: false,
          knownLimits: [
            ...value.knownLimits,
            `Recorded size exceeds the ${PROJECT_EVIDENCE_FILE_BYTE_LIMIT}-byte per-file bundle limit.`,
          ],
          exclusionReason: "The source remains listed as reference-only because it exceeds the per-file bundle limit.",
        }
      : {}),
    id: projectEvidenceCandidateId(value.sourceId, value.recordId),
  };
  return { ...withId, revisionToken: projectEvidenceRevisionToken(withId) };
}

function kbCandidate(row: Record<string, unknown>, projectId: string): ProjectEvidenceCandidate {
  const storageRef = text(row.storage_ref);
  const available = Boolean(storageRef);
  const status = text(row.status);
  return candidate({
    sourceId: "knowledge_base",
    sourceLabel: "Knowledge Base",
    owningModule: "knowledge_base",
    recordId: String(row.id),
    parentRecordId: null,
    projectId,
    title: text(row.title) ?? "(untitled document)",
    originalFilename: text(row.original_filename),
    contentType: text(row.content_type),
    byteSize: numberValue(row.byte_size),
    recordedChecksumSha256: text(row.checksum),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    sourceKind: text(row.source_kind) ?? text(row.doc_kind),
    sourceVintage: null,
    citation: text(row.citation_label),
    retrievalState: available ? "available" : "unavailable",
    claimTier: null,
    custodyState: available ? "openplan_stored" : "unavailable",
    uncertainty: status === "failed" ? [text(row.extraction_error) ?? "Text extraction failed."] : [],
    knownLimits: status === "ready" ? [] : ["This source is not currently citable through Knowledge Base retrieval."],
    defaultSelected: false,
    required: false,
    selectable: available,
    exclusionReason: available ? null : "No original file bytes are stored for this record.",
  });
}

function reportCandidate(row: Record<string, unknown>, projectId: string): ProjectEvidenceCandidate {
  const report = record(row.reports);
  const kind = text(row.artifact_kind) ?? "artifact";
  const stored = Boolean(text(row.storage_path));
  const inline = kind === "html" && Boolean(text(record(row.metadata_json)?.htmlContent));
  const available = stored || inline;
  return candidate({
    sourceId: "report_artifacts",
    sourceLabel: "Reports",
    owningModule: "reports",
    recordId: String(row.id),
    parentRecordId: text(row.report_id),
    projectId,
    title: text(report?.title) ?? "(report unavailable)",
    originalFilename: null,
    contentType: kind === "pdf" ? "application/pdf" : "text/html; charset=utf-8",
    byteSize: null,
    recordedChecksumSha256: metadataChecksum(row.metadata_json),
    createdAt: text(row.generated_at),
    updatedAt: text(row.updated_at),
    sourceKind: kind,
    sourceVintage: text(row.generated_at)?.slice(0, 10) ?? null,
    citation: null,
    retrievalState: available ? "available" : "unavailable",
    claimTier: text(record(row.metadata_json)?.modelingClaimStatus),
    custodyState: available ? "openplan_stored" : "unavailable",
    uncertainty: [],
    knownLimits: [],
    defaultSelected: false,
    required: false,
    selectable: available,
    exclusionReason: available ? null : "The report artifact record has no stored or inline content.",
  });
}

function grantCandidate(row: Record<string, unknown>, projectId: string): ProjectEvidenceCandidate {
  const opportunity = record(row.funding_opportunities);
  return candidate({
    sourceId: "grant_application_exports",
    sourceLabel: "Grant applications",
    owningModule: "grants",
    recordId: String(row.id),
    parentRecordId: text(row.opportunity_id),
    projectId,
    title: text(opportunity?.title) ?? "(grant application unavailable)",
    originalFilename: null,
    contentType: "application/pdf",
    byteSize: null,
    recordedChecksumSha256: null,
    createdAt: text(row.generated_at),
    updatedAt: null,
    sourceKind: "application_pdf",
    sourceVintage: text(row.generated_at)?.slice(0, 10) ?? null,
    citation: null,
    retrievalState: "available",
    claimTier: null,
    custodyState: "openplan_stored",
    uncertainty: [],
    knownLimits: text(row.pdf_engine) ? [`Rendered with ${text(row.pdf_engine)}.`] : [],
    defaultSelected: false,
    required: false,
    selectable: true,
    exclusionReason: null,
  });
}

function invoiceCandidate(row: Record<string, unknown>, projectId: string): ProjectEvidenceCandidate {
  return candidate({
    sourceId: "invoice_pdfs",
    sourceLabel: "Client invoices",
    owningModule: "invoicing",
    recordId: String(row.id),
    parentRecordId: null,
    projectId,
    title: `Invoice ${text(row.invoice_number) ?? "(unnumbered)"}`,
    originalFilename: null,
    contentType: "application/pdf",
    byteSize: null,
    recordedChecksumSha256: null,
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    sourceKind: "generated_invoice_pdf",
    sourceVintage: text(row.invoice_date),
    citation: null,
    retrievalState: "rendered_on_freeze",
    claimTier: null,
    custodyState: "rendered_on_freeze",
    uncertainty: [],
    knownLimits: ["The PDF is frozen from the invoice record during bundle creation."],
    defaultSelected: false,
    required: false,
    selectable: true,
    exclusionReason: null,
  });
}

function imageryCandidate(row: Record<string, unknown>, projectId: string): ProjectEvidenceCandidate {
  const mission = record(row.aerial_missions);
  return candidate({
    sourceId: "aerial_imagery",
    sourceLabel: "Aerial imagery",
    owningModule: "aerial_imagery",
    recordId: String(row.id),
    parentRecordId: text(row.mission_id),
    projectId,
    title: text(row.original_filename) ?? "(unnamed photo)",
    originalFilename: text(row.original_filename),
    contentType: text(row.content_type),
    byteSize: numberValue(row.byte_size),
    recordedChecksumSha256: text(row.checksum_sha256),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    sourceKind: "raw_aerial_photo",
    sourceVintage: text(row.captured_at),
    citation: text(mission?.title),
    retrievalState: "available",
    claimTier: null,
    custodyState: "openplan_stored",
    uncertainty: [],
    knownLimits: ["Raw aerial photos are unchecked by default because they may contain sensitive imagery or metadata."],
    defaultSelected: false,
    required: false,
    selectable: true,
    exclusionReason: null,
  });
}

function custodyCandidate(row: Record<string, unknown>, projectId: string): ProjectEvidenceCandidate {
  const state = text(row.state) ?? "pending";
  const held = state === "held";
  const mission = record(row.aerial_missions);
  const ordinal = numberValue(row.ordinal) ?? 0;
  const kind = text(row.kind) ?? "deliverable";
  return candidate({
    sourceId: "aerial_artifact_custody",
    sourceLabel: "Aerial deliverables",
    owningModule: "aerial_processing",
    recordId: String(row.id),
    parentRecordId: text(row.processing_job_id),
    projectId,
    title: `${kind}${ordinal ? ` ${ordinal + 1}` : ""}${text(mission?.title) ? `: ${text(mission?.title)}` : ""}`,
    originalFilename: text(row.storage_path)?.split("/").pop() ?? null,
    contentType: text(row.content_type),
    byteSize: held ? numberValue(row.byte_size) : null,
    recordedChecksumSha256: held ? text(row.checksum_sha256) : null,
    createdAt: text(row.created_at),
    updatedAt: text(row.held_at),
    sourceKind: kind,
    sourceVintage: null,
    citation: null,
    retrievalState: held ? "available" : "reference_only",
    claimTier: null,
    custodyState: held ? "openplan_stored" : "unavailable",
    uncertainty: held ? [] : [text(row.failure_detail) ?? `Custody state is ${state}.`],
    knownLimits: [],
    defaultSelected: false,
    required: false,
    selectable: held,
    exclusionReason: held ? null : "OpenPlan does not hold bytes for this deliverable.",
  });
}

function modelCandidate(row: Record<string, unknown>, projectId: string): ProjectEvidenceCandidate {
  const run = record(row.model_runs);
  const fileUrl = text(row.file_url);
  const storage = fileUrl ? parseStorageRef(fileUrl) : null;
  const remote = Boolean(fileUrl?.startsWith("http://") || fileUrl?.startsWith("https://"));
  const local = Boolean(fileUrl && !storage && !remote);
  const available = Boolean(storage || (local && workerLocalRoot()));
  return candidate({
    sourceId: "model_run_artifacts",
    sourceLabel: "Model runs",
    owningModule: "travel_modeling",
    recordId: String(row.id),
    parentRecordId: text(row.run_id),
    projectId,
    title: `${text(run?.run_title) ?? "Model run"}: ${text(row.artifact_type) ?? "artifact"}`,
    originalFilename: storage?.objectPath.split("/").pop() ?? fileUrl?.split("/").pop() ?? null,
    contentType: null,
    byteSize: numberValue(row.file_size_bytes),
    recordedChecksumSha256: null,
    createdAt: text(row.created_at),
    updatedAt: null,
    sourceKind: text(row.artifact_type),
    sourceVintage: null,
    citation: text(record(run?.models)?.title),
    retrievalState: available ? "available" : "reference_only",
    claimTier: null,
    custodyState: storage
      ? "openplan_stored"
      : local
        ? available
          ? "worker_local"
          : "external_reference"
        : "external_reference",
    uncertainty: [],
    knownLimits: remote ? ["Remote artifact URLs are never followed by evidence bundle generation."] : [],
    defaultSelected: false,
    required: false,
    selectable: available,
    exclusionReason: available ? null : "The artifact bytes are not held where this OpenPlan app can read them.",
  });
}

const MAPPERS: Record<
  EvidenceDescriptor["id"],
  (row: Record<string, unknown>, projectId: string) => ProjectEvidenceCandidate
> = {
  knowledge_base: kbCandidate,
  report_artifacts: reportCandidate,
  grant_application_exports: grantCandidate,
  invoice_pdfs: invoiceCandidate,
  aerial_imagery: imageryCandidate,
  aerial_artifact_custody: custodyCandidate,
  model_run_artifacts: modelCandidate,
};

async function readSource(
  client: ReadClient,
  source: (typeof DOCUMENT_LIBRARY_SOURCES)[number],
  project: ProjectIdentity
): Promise<ReadResult> {
  try {
    return await client
      .from(source.table)
      .select(SELECTS[source.id])
      .eq(source.workspaceFilterColumn, project.workspace_id)
      .eq(source.projectFilterColumn, project.id)
      .order(source.orderColumn, { ascending: false })
      .limit(READ_LIMIT);
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "read threw" } };
  }
}

async function readPriorBundles(
  client: ReadClient,
  project: ProjectIdentity
): Promise<{ bundles: ProjectEvidencePriorBundle[]; error: { message?: string | null } | null }> {
  try {
    const result = await client
      .from("project_evidence_bundles")
      .select("id, status, byte_count, manifest_sha256, selected_count, failure_code, generated_at")
      .eq("workspace_id", project.workspace_id)
      .eq("project_id", project.id)
      .order("generated_at", { ascending: false })
      .limit(20);
    const bundles = ((result.data ?? []) as Record<string, unknown>[]).map((row) => {
      const status = (text(row.status) ?? "failed") as ProjectEvidencePriorBundle["status"];
      const id = String(row.id);
      return {
        id,
        generatedAt: text(row.generated_at) ?? "",
        byteCount: numberValue(row.byte_count),
        manifestSha256: text(row.manifest_sha256),
        selectedCount: numberValue(row.selected_count) ?? 0,
        status,
        failureCode: text(row.failure_code),
        downloadHref: status === "ready" ? `/api/projects/${project.id}/evidence-bundles/${id}/download` : null,
      };
    });
    return { bundles, error: result.error };
  } catch (error) {
    return { bundles: [], error: { message: error instanceof Error ? error.message : "read threw" } };
  }
}

function geoPackageCandidate(project: ProjectIdentity): ProjectEvidenceCandidate {
  return candidate({
    sourceId: "project_geopackage",
    sourceLabel: "Project record",
    owningModule: "projects",
    recordId: project.id,
    parentRecordId: null,
    projectId: project.id,
    title: `${project.name?.trim() || "Project"} GeoPackage`,
    originalFilename: "project.gpkg",
    contentType: "application/geopackage+sqlite3",
    byteSize: null,
    recordedChecksumSha256: null,
    createdAt: null,
    updatedAt: project.updated_at ?? null,
    sourceKind: "project_geopackage",
    sourceVintage: project.updated_at ?? null,
    citation: null,
    retrievalState: "rendered_on_freeze",
    claimTier: null,
    custodyState: "rendered_on_freeze",
    uncertainty: [],
    knownLimits: [
      "The GeoPackage contains the stored project area, location, and cartographic corridors. Other geographic layers remain outside this release.",
    ],
    defaultSelected: true,
    required: true,
    selectable: true,
    exclusionReason: null,
  });
}

function markLatestReports(candidates: ProjectEvidenceCandidate[]): ProjectEvidenceCandidate[] {
  const seen = new Set<string>();
  return candidates.map((item) => {
    if (item.sourceId !== "report_artifacts" || !item.parentRecordId || !item.selectable) return item;
    if (seen.has(item.parentRecordId)) return item;
    seen.add(item.parentRecordId);
    const changed = { ...item, defaultSelected: true };
    const { revisionToken: _ignored, ...withoutToken } = changed;
    return { ...changed, revisionToken: projectEvidenceRevisionToken(withoutToken) };
  });
}

/**
 * Read up to 501 rows from every existing Document Library source, then apply
 * one visible 500-candidate stop. This does not inherit the display list's
 * 20-per-source cap.
 */
export async function loadProjectEvidenceCandidateInventory(
  supabase: unknown,
  project: ProjectIdentity
): Promise<ProjectEvidenceCandidateInventory & { readFailed: boolean; failureMessage: string | null }> {
  const client = supabase as ReadClient;
  const [sourceResults, prior] = await Promise.all([
    Promise.all(DOCUMENT_LIBRARY_SOURCES.map((source) => readSource(client, source, project))),
    readPriorBundles(client, project),
  ]);

  const sourceOutcomes: ProjectEvidenceCandidateInventory["sourceOutcomes"] = {};
  const all: ProjectEvidenceCandidate[] = [geoPackageCandidate(project)];
  const failures: string[] = [];
  let hitSourceLimit = false;

  DOCUMENT_LIBRARY_SOURCES.forEach((source, index) => {
    const result = sourceResults[index];
    const pending = looksLikePendingSchema(result.error?.message);
    const failed = Boolean(result.error) && !pending;
    const rows = pending || failed ? [] : ((result.data ?? []) as Record<string, unknown>[]);
    if (rows.length >= READ_LIMIT) hitSourceLimit = true;
    const mapped = rows.slice(0, PROJECT_EVIDENCE_CANDIDATE_LIMIT).map((row) => MAPPERS[source.id](row, project.id));
    all.push(...mapped);
    sourceOutcomes[source.id] = { count: mapped.length, failed, pending };
    if (result.error) failures.push(`${source.label}: ${result.error.message ?? "read failed"}`);
  });

  if (prior.error && !looksLikePendingSchema(prior.error.message)) {
    failures.push(`Prior evidence bundles: ${prior.error.message ?? "read failed"}`);
  }

  const withDefaults = markLatestReports(all);
  const inventoryTruncated = hitSourceLimit || withDefaults.length > PROJECT_EVIDENCE_CANDIDATE_LIMIT;
  const candidates = withDefaults.slice(0, PROJECT_EVIDENCE_CANDIDATE_LIMIT);

  return {
    projectId: project.id,
    projectRevision: project.updated_at ?? "",
    candidates,
    sourceOutcomes,
    inventoryTruncated,
    limits: {
      reviewCandidateLimit: PROJECT_EVIDENCE_CANDIDATE_LIMIT,
      selectedFileLimit: PROJECT_EVIDENCE_SELECTED_FILE_LIMIT,
      perFileBytes: PROJECT_EVIDENCE_FILE_BYTE_LIMIT,
      totalSelectedFileBytes: PROJECT_EVIDENCE_TOTAL_BYTE_LIMIT,
    },
    priorBundles: prior.error && looksLikePendingSchema(prior.error.message) ? [] : prior.bundles,
    readFailed: failures.length > 0,
    failureMessage: failures.length > 0 ? failures.join("; ") : null,
  };
}
