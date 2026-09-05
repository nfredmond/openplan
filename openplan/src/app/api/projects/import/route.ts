import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { KB_DOCUMENTS_BUCKET } from "@/lib/knowledge-base/documents";
import { parseStorageRef, storageRefAllowed } from "@/lib/models/artifact-source";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  PORTFOLIO_COST_SCALES,
  PortfolioImportError,
  reviewPortfolioWorkbook,
  type PortfolioSheetConfiguration,
  type PortfolioWorkbookRowReview,
  type PreviouslyCreatedWorkbookRow,
} from "@/lib/projects/portfolio-import";
import { inspectPortfolioWorkbook, PortfolioWorkbookError } from "@/lib/projects/portfolio-workbook";
import { PROJECT_DELIVERY_PHASES, PROJECT_STATUSES } from "@/lib/projects/project-record-fields";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";

export const runtime = "nodejs";
export const maxDuration = 60;
const POSTGRES_INSUFFICIENT_PRIVILEGE = "42" + "501";

const mappingSchema = z.object({
  name: z.number().int().nonnegative(),
  sourceId: z.number().int().nonnegative().optional(),
  description: z.number().int().nonnegative().optional(),
  estimatedCost: z.number().int().nonnegative().optional(),
  costCurrency: z.number().int().nonnegative().optional(),
  costPriceYear: z.number().int().nonnegative().optional(),
  planType: z.number().int().nonnegative().optional(),
  status: z.number().int().nonnegative().optional(),
  deliveryPhase: z.number().int().nonnegative().optional(),
  sourceLocation: z.number().int().nonnegative().optional(),
}).strict();
const defaultsSchema = z.object({
  planType: z.string().trim().min(1).max(80),
  status: z.enum(PROJECT_STATUSES),
  deliveryPhase: z.enum(PROJECT_DELIVERY_PHASES),
  cost: z.object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    scale: z.enum(PORTFOLIO_COST_SCALES),
    priceYear: z.number().int().min(1800).max(3000).nullable(),
  }).strict().optional(),
}).strict();
const configurationSchema = z.object({
  worksheetIndex: z.number().int().min(0),
  headerRow: z.number().int().min(1),
  mapping: mappingSchema,
  defaults: defaultsSchema,
}).strict();
const rowReviewSchema = z.object({
  worksheetIndex: z.number().int().min(0),
  rowNumber: z.number().int().min(1),
  decision: z.enum(["skip", "create"]),
  confirmNameMatch: z.boolean().optional(),
  confirmFormula: z.boolean().optional(),
  planType: z.string().trim().min(1).max(80).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  deliveryPhase: z.enum(PROJECT_DELIVERY_PHASES).optional(),
}).strict();
const requestSchema = z.object({
  mode: z.enum(["inspect", "preview", "commit"]),
  workspaceId: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
  originalWorkbookDocumentId: z.string().uuid().optional(),
  worksheetIndex: z.number().int().min(0).optional(),
  configurations: z.array(configurationSchema).max(256).optional(),
  rowReviews: z.array(rowReviewSchema).max(2_000).optional(),
  approvedPreviewHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).strict().superRefine((value, context) => {
  if (value.mode !== "inspect" && (!value.configurations || value.configurations.length === 0)) {
    context.addIssue({ code: "custom", message: "Preview and commit require selected worksheet configurations." });
  }
  if (value.mode === "commit" && !value.approvedPreviewHash) {
    context.addIssue({ code: "custom", message: "Commit requires the approved preview hash." });
  }
  for (const config of value.configurations ?? []) {
    if (config.mapping.estimatedCost !== undefined && !config.defaults.cost) {
      context.addIssue({ code: "custom", message: "Every mapped cost needs currency, scale, and price year." });
    }
    if (
      config.mapping.estimatedCost === undefined &&
      (config.mapping.costCurrency !== undefined || config.mapping.costPriceYear !== undefined)
    ) {
      context.addIssue({ code: "custom", message: "Cost currency and price-year columns require a mapped estimated-cost column." });
    }
  }
});

type SourceDocumentRow = {
  id: string; workspace_id: string; project_id: string | null; title: string;
  original_filename: string | null; source_kind: string; status: string;
  extraction_source: string | null; checksum: string | null; byte_size: number | null;
  content_type: string | null; storage_ref: string | null;
};
type PriorImportRow = {
  source_sha256: string; worksheet_index: number; source_row_number: number;
  row_fingerprint: string; created_project_id: string;
};

function importError(error: PortfolioImportError | PortfolioWorkbookError): NextResponse {
  return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "size_limit" ? 413 : 400 });
}

async function loadStoredSource(service: ReturnType<typeof createServiceRoleClient>, document: SourceDocumentRow) {
  const storageRef = document.storage_ref ? parseStorageRef(document.storage_ref) : null;
  const scope = { bucket: KB_DOCUMENTS_BUCKET, objectPathPrefix: `${document.workspace_id}/${document.id}/` };
  if (!storageRef || !storageRefAllowed(storageRef, scope)) {
    throw new PortfolioImportError("invalid_mapping", "The stored source does not have a confined Knowledge Base file reference.");
  }
  const { data, error } = await service.storage.from(storageRef.bucket).download(storageRef.objectPath);
  if (error || !data) throw new Error("stored_source_download_failed");
  return new Uint8Array(await data.arrayBuffer());
}

function sourceStateAllowed(source: SourceDocumentRow): boolean {
  const ext = (source.original_filename ?? "").toLowerCase().split(".").pop();
  if (ext === "csv") return source.status === "ready" && source.extraction_source === "spreadsheet_parse";
  if (ext === "xls" || ext === "xlsx" || ext === "ods") return source.status === "stored" && source.extraction_source === "none";
  return false;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const audit = createApiAuditLogger("projects.portfolio_import", request);
  const startedAt = Date.now();
  try {
    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.portfolioImportJson);
    if (!body.ok) return body.response;
    const parsed = requestSchema.safeParse(body.data);
    if (!parsed.success) {
      audit.warn("portfolio_import_request_invalid", { issueCodes: parsed.error.issues.map((entry) => entry.code) });
      return NextResponse.json({ error: "Invalid portfolio import request" }, { status: 400 });
    }
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const membership = await checkWorkspaceMembership(supabase, user.id, parsed.data.workspaceId);
    if (!membership.ok) {
      if (membership.kind === "not_member") return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      audit.error("portfolio_import_membership_check_failed", { kind: membership.kind });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }
    if (isReadOnlyWorkspaceRole(membership.role)) {
      return NextResponse.json({ error: "Viewers have read-only access to this workspace" }, { status: 403 });
    }

    const columns = "id, workspace_id, project_id, title, original_filename, source_kind, status, extraction_source, checksum, byte_size, content_type, storage_ref";
    const sourceResult = await supabase.from("kb_documents").select(columns)
      .eq("id", parsed.data.sourceDocumentId).eq("workspace_id", parsed.data.workspaceId)
      .is("project_id", null).maybeSingle();
    if (sourceResult.error) {
      audit.error("portfolio_import_source_lookup_failed", { code: sourceResult.error.code ?? null });
      return NextResponse.json({ error: "Failed to load the stored project-list source" }, { status: 500 });
    }
    const source = (sourceResult.data ?? null) as SourceDocumentRow | null;
    if (!source || source.project_id !== null || source.source_kind !== "uploaded_spreadsheet" || !source.checksum || !source.storage_ref || !sourceStateAllowed(source)) {
      return NextResponse.json({ error: "The source must be a stored workspace-level CSV, XLS, XLSX, or ODS file." }, { status: 404 });
    }

    let originalWorkbook: SourceDocumentRow | null = null;
    if (parsed.data.originalWorkbookDocumentId) {
      if (!/\.csv$/i.test(source.original_filename ?? "")) {
        return NextResponse.json({ error: "Only a primary CSV may link a separate authoritative workbook." }, { status: 400 });
      }
      const originalResult = await supabase.from("kb_documents").select(columns)
        .eq("id", parsed.data.originalWorkbookDocumentId).eq("workspace_id", parsed.data.workspaceId)
        .is("project_id", null).maybeSingle();
      if (originalResult.error) return NextResponse.json({ error: "Failed to load the authoritative workbook" }, { status: 500 });
      originalWorkbook = (originalResult.data ?? null) as SourceDocumentRow | null;
      if (!originalWorkbook || originalWorkbook.project_id !== null || originalWorkbook.id === source.id || originalWorkbook.source_kind !== "uploaded_spreadsheet" || originalWorkbook.status !== "stored" || originalWorkbook.extraction_source !== "none" || !/\.(xls|xlsx|ods)$/i.test(originalWorkbook.original_filename ?? "")) {
        return NextResponse.json({ error: "The authoritative original must be a stored workspace-level XLS, XLSX, or ODS workbook." }, { status: 404 });
      }
    }

    const service = createServiceRoleClient();
    let sourceBytes: Uint8Array;
    try {
      sourceBytes = await loadStoredSource(service, source);
    } catch (error) {
      if (error instanceof PortfolioImportError) return importError(error);
      audit.error("portfolio_import_source_download_failed", { sourceDocumentId: source.id, code: "stored_source_download_failed" });
      return NextResponse.json({ error: "Failed to read the stored project-list source" }, { status: 500 });
    }

    let inspection;
    try {
      inspection = await inspectPortfolioWorkbook({
        bytes: sourceBytes,
        filename: source.original_filename,
        contentType: source.content_type,
        worksheetIndex: parsed.data.mode === "inspect" ? parsed.data.worksheetIndex : undefined,
      });
    } catch (error) {
      if (error instanceof PortfolioWorkbookError) {
        audit.warn("portfolio_import_inspection_refused", { code: error.code });
        return importError(error);
      }
      throw error;
    }
    if (inspection.sourceHash !== source.checksum) {
      audit.error("portfolio_import_source_hash_mismatch", { sourceDocumentId: source.id, recordedHash: source.checksum, actualHash: inspection.sourceHash });
      return NextResponse.json({ error: "The stored source bytes no longer match the Knowledge Base checksum. Nothing was imported.", code: "source_hash_mismatch" }, { status: 409 });
    }
    const sourceMetadata = {
      id: source.id, title: source.title, filename: source.original_filename, format: inspection.format,
      sha256: inspection.sourceHash, byteLength: inspection.byteLength,
      originalWorkbook: originalWorkbook ? { id: originalWorkbook.id, title: originalWorkbook.title, filename: originalWorkbook.original_filename, sha256: originalWorkbook.checksum } : null,
    };
    if (parsed.data.mode === "inspect") {
      audit.info("portfolio_import_inspected", {
        workspaceId: parsed.data.workspaceId, sourceDocumentId: source.id, sourceHash: inspection.sourceHash,
        format: inspection.format, sheetCount: inspection.worksheets.length, durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ source: sourceMetadata, inspection }, { status: 200 });
    }

    const [projectsResult, priorResult] = await Promise.all([
      supabase.from("projects").select("id, name").eq("workspace_id", parsed.data.workspaceId),
      supabase.from("project_portfolio_import_rows")
        .select("source_sha256, worksheet_index, source_row_number, row_fingerprint, created_project_id")
        .eq("workspace_id", parsed.data.workspaceId).eq("source_sha256", source.checksum).eq("outcome", "created"),
    ]);
    if (projectsResult.error || priorResult.error) {
      audit.error("portfolio_import_duplicate_check_failed", { code: projectsResult.error?.code ?? priorResult.error?.code ?? null });
      return NextResponse.json({ error: "Could not check current duplicates, so the review stopped" }, { status: 500 });
    }
    let review;
    try {
      review = await reviewPortfolioWorkbook({
        bytes: sourceBytes,
        filename: source.original_filename,
        contentType: source.content_type,
        configurations: parsed.data.configurations as PortfolioSheetConfiguration[],
        rowReviews: (parsed.data.rowReviews ?? []) as PortfolioWorkbookRowReview[],
        existingProjects: (projectsResult.data ?? []) as Array<{ id: string; name: string }>,
        previouslyCreatedRows: (priorResult.data ?? []).map((row) => {
          const typed = row as PriorImportRow;
          return { sourceHash: typed.source_sha256, worksheetIndex: typed.worksheet_index, rowNumber: typed.source_row_number, rowFingerprint: typed.row_fingerprint, projectId: typed.created_project_id } satisfies PreviouslyCreatedWorkbookRow;
        }),
      });
    } catch (error) {
      if (error instanceof PortfolioImportError || error instanceof PortfolioWorkbookError) {
        audit.warn("portfolio_import_review_refused", { code: error.code });
        return importError(error);
      }
      throw error;
    }
    if (parsed.data.mode === "preview") {
      audit.info("portfolio_import_previewed", {
        workspaceId: parsed.data.workspaceId, sourceDocumentId: source.id, sourceHash: review.sourceHash,
        previewHash: review.previewHash, format: review.format, sheetCount: review.sheets.length,
        rowCount: review.counts.rows, selectedCount: review.counts.selectedForCreate,
        invalidCount: review.counts.invalid, conflictCount: review.counts.conflicted, durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ source: sourceMetadata, review }, { status: 200 });
    }
    if (review.previewHash !== parsed.data.approvedPreviewHash) {
      audit.warn("portfolio_import_stale_preview", { workspaceId: parsed.data.workspaceId, sourceDocumentId: source.id, approvedPreviewHash: parsed.data.approvedPreviewHash, currentPreviewHash: review.previewHash });
      return NextResponse.json({ error: "The source, worksheet setup, row decisions, formula warnings, or duplicate checks changed after review. Review again before creating projects.", code: "stale_preview", currentPreviewHash: review.previewHash }, { status: 409 });
    }
    const unconfirmed = review.rows.filter((row) => row.decision === "create" && !row.canCreate);
    if (unconfirmed.length > 0) {
      return NextResponse.json({ error: "One or more selected rows are blocked or still require individual confirmation.", code: "unconfirmed_rows", rows: unconfirmed.map((row) => ({ worksheetIndex: row.worksheetIndex, rowNumber: row.rowNumber })) }, { status: 400 });
    }
    const rpcRows = review.rows.map((row) => ({
      worksheetIndex: row.worksheetIndex, worksheetName: row.worksheetName, headerRow: row.headerRow,
      rowNumber: row.rowNumber, fingerprint: row.fingerprint, name: row.name, sourceId: row.sourceId,
      description: row.description, sourceLocationText: row.sourceLocationText, estimatedCost: row.estimatedCost,
      planType: row.planType, status: row.status, deliveryPhase: row.deliveryPhase, decision: row.decision,
      state: row.state, canCreate: row.canCreate, confirmNameMatch: row.confirmNameMatch,
      confirmFormula: row.confirmFormula, formulaFields: row.formulaFields,
      errors: row.errors, warnings: row.warnings,
    }));
    const { data: committed, error: commitError } = await service.rpc("commit_project_portfolio_import_v2", {
      p_workspace_id: parsed.data.workspaceId,
      p_actor_id: user.id,
      p_source_document_id: source.id,
      p_original_workbook_document_id: originalWorkbook?.id ?? null,
      p_source_hash: review.sourceHash,
      p_source_format: review.format,
      p_preview_hash: review.previewHash,
      p_sheet_configurations: review.configurations.map((configuration) => ({
        ...configuration,
        worksheetName: review.sheets.find((sheet) => sheet.worksheetIndex === configuration.worksheetIndex)?.worksheetName,
      })),
      p_rows: rpcRows,
    });
    if (commitError) {
      const code = commitError.code ?? "database_error";
      audit.error("portfolio_import_commit_failed", {
        workspaceId: parsed.data.workspaceId, sourceDocumentId: source.id, sourceHash: review.sourceHash,
        previewHash: review.previewHash, format: review.format, sheetCount: review.sheets.length,
        rowCount: review.counts.rows, code, durationMs: Date.now() - startedAt,
      });
      if (code === "23505") return NextResponse.json({ error: "Another import created one of these source rows first. No part of this batch was saved; review again.", code: "import_race" }, { status: 409 });
      if (code === "22023") return NextResponse.json({ error: "The source or current duplicate checks changed before the transaction. No part of this batch was saved; review again.", code: "import_stale" }, { status: 409 });
      if (code === POSTGRES_INSUFFICIENT_PRIVILEGE) return NextResponse.json({ error: "Your current workspace role no longer allows project imports" }, { status: 403 });
      return NextResponse.json({ error: "The portfolio import transaction failed. No projects or import batch were saved." }, { status: 500 });
    }
    const summary = committed as { batchId: string; created: number; skipped: number; conflicted: number; invalid: number; previouslyCreated: number; projectIds: string[] };
    audit.info("portfolio_import_committed", {
      workspaceId: parsed.data.workspaceId, sourceDocumentId: source.id, sourceHash: review.sourceHash,
      previewHash: review.previewHash, format: review.format, sheetCount: review.sheets.length,
      rowCount: review.counts.rows, batchId: summary.batchId, createdCount: summary.created,
      skippedCount: summary.skipped, conflictCount: summary.conflicted, invalidCount: summary.invalid,
      previouslyCreatedCount: summary.previouslyCreated, durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ source: sourceMetadata, review, committed: summary }, { status: 201 });
  } catch (error) {
    audit.error("portfolio_import_unhandled_error", { code: error instanceof Error ? error.name : "unknown_error", durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while reviewing the portfolio import" }, { status: 500 });
  }
}
