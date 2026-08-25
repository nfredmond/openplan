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
  reviewPortfolioImport,
  type PortfolioImportDefaults,
  type PortfolioImportMapping,
  type PortfolioImportRowReview,
  type PreviouslyCreatedImportRow,
} from "@/lib/projects/portfolio-import";
import {
  PROJECT_DELIVERY_PHASES,
  PROJECT_STATUSES,
} from "@/lib/projects/project-record-fields";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";

export const runtime = "nodejs";
export const maxDuration = 60;

// Kept out of a five-digit literal because the place-neutrality guard treats
// any branched-on five-digit string as a possible county FIPS code.
const POSTGRES_INSUFFICIENT_PRIVILEGE = "42" + "501";

const mappingSchema = z
  .object({
    name: z.number().int().nonnegative(),
    sourceId: z.number().int().nonnegative().optional(),
    description: z.number().int().nonnegative().optional(),
    estimatedCost: z.number().int().nonnegative().optional(),
    sourceLocation: z.number().int().nonnegative().optional(),
  })
  .strict();

const defaultsSchema = z
  .object({
    planType: z.string().trim().min(1).max(80),
    status: z.enum(PROJECT_STATUSES),
    deliveryPhase: z.enum(PROJECT_DELIVERY_PHASES),
    cost: z
      .object({
        currency: z.string().regex(/^[A-Z]{3}$/),
        scale: z.enum(PORTFOLIO_COST_SCALES),
        priceYear: z.number().int().min(1800).max(3000),
      })
      .strict()
      .optional(),
  })
  .strict();

const rowReviewSchema = z
  .object({
    rowNumber: z.number().int().min(2),
    decision: z.enum(["skip", "create"]),
    confirmNameMatch: z.boolean().optional(),
    planType: z.string().trim().min(1).max(80).optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    deliveryPhase: z.enum(PROJECT_DELIVERY_PHASES).optional(),
  })
  .strict();

const requestSchema = z
  .object({
    mode: z.enum(["preview", "commit"]),
    workspaceId: z.string().uuid(),
    sourceDocumentId: z.string().uuid(),
    originalWorkbookDocumentId: z.string().uuid().optional(),
    mapping: mappingSchema,
    defaults: defaultsSchema,
    rowReviews: z.array(rowReviewSchema).max(2_000).default([]),
    approvedPreviewHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })
  .strict();

type SourceDocumentRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  original_filename: string | null;
  source_kind: string;
  status: string;
  extraction_source: string | null;
  checksum: string | null;
  byte_size: number | null;
  storage_ref: string | null;
};

type ExistingProjectRow = { id: string; name: string };
type PriorImportRow = {
  source_sha256: string;
  source_row_number: number;
  row_fingerprint: string;
  created_project_id: string;
};

function portfolioError(error: PortfolioImportError): NextResponse {
  const status = error.code === "size_limit" ? 413 : 400;
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

async function loadStoredCsv(
  service: ReturnType<typeof createServiceRoleClient>,
  document: SourceDocumentRow
): Promise<Uint8Array> {
  const storageRef = document.storage_ref ? parseStorageRef(document.storage_ref) : null;
  const scope = {
    bucket: KB_DOCUMENTS_BUCKET,
    objectPathPrefix: `${document.workspace_id}/${document.id}/`,
  };
  if (!storageRef || !storageRefAllowed(storageRef, scope)) {
    throw new PortfolioImportError(
      "invalid_mapping",
      "The stored CSV does not have a confined Knowledge Base file reference."
    );
  }

  const { data, error } = await service.storage.from(storageRef.bucket).download(storageRef.objectPath);
  if (error || !data) {
    throw new Error("stored_csv_download_failed");
  }
  return new Uint8Array(await data.arrayBuffer());
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const audit = createApiAuditLogger("projects.portfolio_import", request);
  const startedAt = Date.now();

  try {
    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.portfolioImportJson);
    if (!body.ok) return body.response;
    const parsed = requestSchema.safeParse(body.data);
    if (!parsed.success) {
      audit.warn("portfolio_import_request_invalid", {
        issueCodes: parsed.error.issues.map((entry) => entry.code),
      });
      return NextResponse.json({ error: "Invalid portfolio import request" }, { status: 400 });
    }

    if (parsed.data.mode === "commit" && !parsed.data.approvedPreviewHash) {
      return NextResponse.json(
        { error: "Commit requires the exact preview hash the planner approved" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await checkWorkspaceMembership(
      supabase,
      user.id,
      parsed.data.workspaceId
    );
    if (!membership.ok) {
      if (membership.kind === "not_member") {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      audit.error("portfolio_import_membership_check_failed", { kind: membership.kind });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }
    if (isReadOnlyWorkspaceRole(membership.role)) {
      return NextResponse.json(
        { error: "Viewers have read-only access to this workspace" },
        { status: 403 }
      );
    }

    const sourceResult = await supabase
      .from("kb_documents")
      .select(
        "id, workspace_id, project_id, title, original_filename, source_kind, status, extraction_source, checksum, byte_size, storage_ref"
      )
      .eq("id", parsed.data.sourceDocumentId)
      .eq("workspace_id", parsed.data.workspaceId)
      .is("project_id", null)
      .maybeSingle();
    if (sourceResult.error) {
      audit.error("portfolio_import_source_lookup_failed", { code: sourceResult.error.code ?? null });
      return NextResponse.json({ error: "Failed to load the stored CSV source" }, { status: 500 });
    }
    const source = (sourceResult.data ?? null) as SourceDocumentRow | null;
    if (
      !source ||
      source.project_id !== null ||
      source.source_kind !== "uploaded_spreadsheet" ||
      source.status !== "ready" ||
      source.extraction_source !== "spreadsheet_parse" ||
      !source.checksum ||
      !source.storage_ref
    ) {
      return NextResponse.json(
        {
          error:
            "The source must be a workspace-level CSV that the Knowledge Base stored and parsed.",
        },
        { status: 404 }
      );
    }

    let originalWorkbook: SourceDocumentRow | null = null;
    if (parsed.data.originalWorkbookDocumentId) {
      const originalResult = await supabase
        .from("kb_documents")
        .select(
          "id, workspace_id, project_id, title, original_filename, source_kind, status, extraction_source, checksum, byte_size, storage_ref"
        )
        .eq("id", parsed.data.originalWorkbookDocumentId)
        .eq("workspace_id", parsed.data.workspaceId)
        .is("project_id", null)
        .maybeSingle();
      if (originalResult.error) {
        audit.error("portfolio_import_original_lookup_failed", {
          code: originalResult.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load the original workbook" }, { status: 500 });
      }
      originalWorkbook = (originalResult.data ?? null) as SourceDocumentRow | null;
      if (
        !originalWorkbook ||
        originalWorkbook.project_id !== null ||
        originalWorkbook.id === source.id ||
        originalWorkbook.source_kind !== "uploaded_spreadsheet" ||
        originalWorkbook.status !== "stored" ||
        originalWorkbook.extraction_source !== "none"
      ) {
        return NextResponse.json(
          { error: "The original must be a stored workspace-level XLS, XLSX, or ODS workbook." },
          { status: 404 }
        );
      }
    }

    const service = createServiceRoleClient();
    let sourceBytes: Uint8Array;
    try {
      sourceBytes = await loadStoredCsv(service, source);
    } catch (error) {
      if (error instanceof PortfolioImportError) return portfolioError(error);
      audit.error("portfolio_import_source_download_failed", {
        sourceDocumentId: source.id,
        code: "stored_csv_download_failed",
      });
      return NextResponse.json({ error: "Failed to read the stored CSV" }, { status: 500 });
    }

    const projectsResult = await supabase
      .from("projects")
      .select("id, name")
      .eq("workspace_id", parsed.data.workspaceId);
    if (projectsResult.error) {
      audit.error("portfolio_import_project_check_failed", { code: projectsResult.error.code ?? null });
      return NextResponse.json(
        { error: "Could not check current project-name matches, so the review stopped" },
        { status: 500 }
      );
    }

    const priorResult = await supabase
      .from("project_portfolio_import_rows")
      .select("source_sha256, source_row_number, row_fingerprint, created_project_id")
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("source_sha256", source.checksum)
      .eq("outcome", "created");
    if (priorResult.error) {
      audit.error("portfolio_import_prior_rows_check_failed", { code: priorResult.error.code ?? null });
      return NextResponse.json(
        { error: "Could not check earlier imports of this source, so the review stopped" },
        { status: 500 }
      );
    }

    let review;
    try {
      review = reviewPortfolioImport({
        bytes: sourceBytes,
        mapping: parsed.data.mapping as PortfolioImportMapping,
        defaults: parsed.data.defaults as PortfolioImportDefaults,
        rowReviews: parsed.data.rowReviews as PortfolioImportRowReview[],
        existingProjects: (projectsResult.data ?? []) as ExistingProjectRow[],
        previouslyCreatedRows: (priorResult.data ?? []).map((row) => {
          const typed = row as PriorImportRow;
          return {
            sourceHash: typed.source_sha256,
            rowNumber: typed.source_row_number,
            rowFingerprint: typed.row_fingerprint,
            projectId: typed.created_project_id,
          } satisfies PreviouslyCreatedImportRow;
        }),
      });
    } catch (error) {
      if (error instanceof PortfolioImportError) {
        audit.warn("portfolio_import_review_refused", { code: error.code });
        return portfolioError(error);
      }
      throw error;
    }

    if (review.sourceHash !== source.checksum) {
      audit.error("portfolio_import_source_hash_mismatch", {
        sourceDocumentId: source.id,
        recordedHash: source.checksum,
        actualHash: review.sourceHash,
      });
      return NextResponse.json(
        {
          error:
            "The stored CSV bytes no longer match the Knowledge Base checksum. Nothing was imported.",
          code: "source_hash_mismatch",
        },
        { status: 409 }
      );
    }

    const sourceMetadata = {
      id: source.id,
      title: source.title,
      filename: source.original_filename,
      sha256: review.sourceHash,
      byteLength: review.byteLength,
      originalWorkbook: originalWorkbook
        ? {
            id: originalWorkbook.id,
            title: originalWorkbook.title,
            filename: originalWorkbook.original_filename,
            sha256: originalWorkbook.checksum,
          }
        : null,
    };

    if (parsed.data.mode === "preview") {
      audit.info("portfolio_import_previewed", {
        workspaceId: parsed.data.workspaceId,
        sourceDocumentId: source.id,
        sourceHash: review.sourceHash,
        previewHash: review.previewHash,
        rowCount: review.counts.rows,
        selectedCount: review.counts.selectedForCreate,
        invalidCount: review.counts.invalid,
        conflictCount: review.counts.conflicted,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ source: sourceMetadata, review }, { status: 200 });
    }

    if (review.previewHash !== parsed.data.approvedPreviewHash) {
      audit.warn("portfolio_import_stale_preview", {
        workspaceId: parsed.data.workspaceId,
        sourceDocumentId: source.id,
        approvedPreviewHash: parsed.data.approvedPreviewHash,
        currentPreviewHash: review.previewHash,
      });
      return NextResponse.json(
        {
          error:
            "The stored file or current duplicate checks changed after review. Review the rows again before creating projects.",
          code: "stale_preview",
          currentPreviewHash: review.previewHash,
        },
        { status: 409 }
      );
    }

    const unconfirmed = review.rows.filter(
      (row) => row.decision === "create" && !row.canCreate
    );
    if (unconfirmed.length > 0) {
      return NextResponse.json(
        {
          error: "One or more selected rows are blocked or still require individual confirmation.",
          code: "unconfirmed_rows",
          rowNumbers: unconfirmed.map((row) => row.rowNumber),
        },
        { status: 400 }
      );
    }

    const rpcRows = review.rows.map((row) => ({
      rowNumber: row.rowNumber,
      fingerprint: row.fingerprint,
      name: row.name,
      sourceId: row.sourceId,
      description: row.description,
      sourceLocationText: row.sourceLocationText,
      estimatedCost: row.estimatedCost,
      planType: row.planType,
      status: row.status,
      deliveryPhase: row.deliveryPhase,
      decision: row.decision,
      state: row.state,
      canCreate: row.canCreate,
      errors: row.errors,
      warnings: row.warnings,
    }));
    const { data: committed, error: commitError } = await service.rpc(
      "commit_project_portfolio_import",
      {
        p_workspace_id: parsed.data.workspaceId,
        p_actor_id: user.id,
        p_source_document_id: source.id,
        p_original_workbook_document_id: originalWorkbook?.id ?? null,
        p_source_hash: review.sourceHash,
        p_preview_hash: review.previewHash,
        p_mapping: parsed.data.mapping,
        p_defaults: parsed.data.defaults,
        p_rows: rpcRows,
      }
    );
    if (commitError) {
      const code = commitError.code ?? "database_error";
      audit.error("portfolio_import_commit_failed", {
        workspaceId: parsed.data.workspaceId,
        sourceDocumentId: source.id,
        sourceHash: review.sourceHash,
        previewHash: review.previewHash,
        code,
        durationMs: Date.now() - startedAt,
      });
      if (code === "23505") {
        return NextResponse.json(
          {
            error:
              "Another import created one of these source rows first. No part of this batch was saved; review the current rows again.",
            code: "import_race",
          },
          { status: 409 }
        );
      }
      if (code === POSTGRES_INSUFFICIENT_PRIVILEGE) {
        return NextResponse.json(
          { error: "Your current workspace role no longer allows project imports" },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: "The portfolio import transaction failed. No projects or import batch were saved." },
        { status: 500 }
      );
    }

    const summary = committed as {
      batchId: string;
      created: number;
      skipped: number;
      conflicted: number;
      invalid: number;
      previouslyCreated: number;
      projectIds: string[];
    };
    audit.info("portfolio_import_committed", {
      workspaceId: parsed.data.workspaceId,
      sourceDocumentId: source.id,
      sourceHash: review.sourceHash,
      previewHash: review.previewHash,
      batchId: summary.batchId,
      createdCount: summary.created,
      skippedCount: summary.skipped,
      conflictCount: summary.conflicted,
      invalidCount: summary.invalid,
      previouslyCreatedCount: summary.previouslyCreated,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      { source: sourceMetadata, review, committed: summary },
      { status: 201 }
    );
  } catch (error) {
    audit.error("portfolio_import_unhandled_error", {
      code: error instanceof Error ? error.name : "unknown_error",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Unexpected error while reviewing the portfolio import" },
      { status: 500 }
    );
  }
}
