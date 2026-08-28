import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import {
  ProjectEvidenceBundleError,
  buildProjectEvidenceBundle,
  sha256,
} from "@/lib/project-evidence-bundles/archive";
import { resolveProjectEvidenceCandidateBytes } from "@/lib/project-evidence-bundles/bytes";
import { loadProjectEvidenceGeneratedFiles } from "@/lib/project-evidence-bundles/generated-records";
import { loadProjectEvidenceCandidateInventory } from "@/lib/project-evidence-bundles/inventory";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BUNDLE_BUCKET = "project-evidence-bundles";
const paramsSchema = z.object({ projectId: z.string().uuid() });
const bodySchema = z.object({
  projectRevision: z.string().datetime({ offset: true }),
  confirmed: z.literal(true),
  selectedPlanId: z.string().uuid(),
  selectedPlanRevisionToken: z.string().regex(/^[0-9a-f]{64}$/),
  selected: z.array(
    z.object({
      candidateId: z.string().min(1).max(200),
      revisionToken: z.string().regex(/^[0-9a-f]{64}$/),
    })
  ).min(1).max(201),
});

function errorStatus(error: ProjectEvidenceBundleError): number {
  if (error.code === "stale_review") return 409;
  if (["selected_file_limit", "file_too_large", "bundle_too_large"].includes(error.code)) return 413;
  return 422;
}

function assistantAttempt(request: NextRequest): boolean {
  return Boolean(
    request.headers.get("x-openplan-assistant-execution-source") ||
    request.headers.get("x-openplan-assistant-approval-id") ||
    request.headers.get("x-openplan-assistant-input-hash")
  );
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.evidence_bundles.create", request);
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  if (assistantAttempt(request)) {
    audit.warn("project_evidence_bundle_assistant_refused", { projectId: parsedParams.data.projectId });
    return NextResponse.json(
      {
        error: "human_review_required",
        detail: "An assistant cannot choose potentially sensitive project files. A planner must review and confirm the selection.",
      },
      { status: 403 }
    );
  }

  const bodyRead = await readJsonWithLimit(request, BODY_LIMITS.normalJson);
  if (!bodyRead.ok) return bodyRead.response;
  const body = bodySchema.safeParse(bodyRead.data);
  if (!body.success) return NextResponse.json({ error: "Invalid evidence bundle review" }, { status: 400 });
  if (new Set(body.data.selected.map((item) => item.candidateId)).size !== body.data.selected.length) {
    return NextResponse.json({ error: "A candidate may be selected only once" }, { status: 400 });
  }

  let bundleId: string | null = null;
  let caller: Awaited<ReturnType<typeof createClient>> | null = null;
  const service = createServiceRoleClient();
  let storagePath: string | null = null;
  try {
    caller = await createClient();
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const access = await loadProjectAccess(caller, parsedParams.data.projectId, user.id, "programs.read");
    if (access.error) return NextResponse.json({ error: "Failed to verify project access" }, { status: 500 });
    if (!access.project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }
    if (!canAccessWorkspaceAction("programs.write", access.membership.role)) {
      return NextResponse.json(
        { error: "Viewers may review and download evidence bundles but may not freeze a retained artifact." },
        { status: 403 }
      );
    }

    const inventory = await loadProjectEvidenceCandidateInventory(caller, access.project);
    if (inventory.readFailed) {
      return NextResponse.json(
        { error: "source_read_failed", detail: inventory.failureMessage },
        { status: 503 }
      );
    }
    if (
      !access.project.updated_at ||
      body.data.projectRevision !== access.project.updated_at ||
      inventory.projectRevision !== body.data.projectRevision
    ) {
      return NextResponse.json(
        { error: "stale_review", detail: "The project changed after this evidence review opened." },
        { status: 409 }
      );
    }

    const byId = new Map(inventory.candidates.map((candidate) => [candidate.id, candidate]));
    const selected = body.data.selected.map((selection) => {
      const current = byId.get(selection.candidateId);
      if (!current || current.revisionToken !== selection.revisionToken || !current.selectable) {
        throw new ProjectEvidenceBundleError("stale_review", "A selected record changed after review.");
      }
      return current;
    });
    const missingRequired = inventory.candidates.filter(
      (candidate) => candidate.required && !selected.some((item) => item.id === candidate.id)
    );
    if (missingRequired.length > 0) {
      return NextResponse.json({ error: "The project GeoPackage must remain selected." }, { status: 400 });
    }
    const selectableFiles = selected.filter((candidate) => candidate.sourceId !== "project_geopackage");
    const selectedReportPdfs = selectableFiles.filter(
      (candidate) => candidate.sourceId === "report_artifacts" && candidate.contentType === "application/pdf",
    );
    if (selectedReportPdfs.length !== 1) {
      return NextResponse.json({ error: "Select exactly one current board or report PDF." }, { status: 400 });
    }
    const selectedPlanInventory = inventory.linkedPlans.find(
      (plan) => plan.id === body.data.selectedPlanId && plan.revisionToken === body.data.selectedPlanRevisionToken,
    );
    if (!selectedPlanInventory) {
      return NextResponse.json({ error: "Select one current linked plan record." }, { status: 409 });
    }
    const selectedPlanRead = await caller.from("plans").select("*")
      .eq("id", selectedPlanInventory.id)
      .eq("workspace_id", access.project.workspace_id)
      .eq("project_id", access.project.id)
      .maybeSingle();
    if (selectedPlanRead.error || !selectedPlanRead.data || selectedPlanRead.data.updated_at !== selectedPlanInventory.updatedAt) {
      return NextResponse.json({ error: "The selected linked plan changed after review." }, { status: 409 });
    }
    if (selectableFiles.length > inventory.limits.selectedFileLimit) {
      throw new ProjectEvidenceBundleError("selected_file_limit", "Too many evidence files were selected.");
    }

    bundleId = randomUUID();
    storagePath = `${access.project.workspace_id}/${access.project.id}/${bundleId}.zip`;
    const selectionJson = body.data.selected.map((item) => ({
      candidateId: item.candidateId,
      revisionToken: item.revisionToken,
    }));
    const insert = await caller.from("project_evidence_bundles").insert({
      id: bundleId,
      workspace_id: access.project.workspace_id,
      project_id: access.project.id,
      project_revision: body.data.projectRevision,
      selection_json: selectionJson,
      // The GeoPackage is mandatory generated evidence, not one of the 200
      // optional source files the planner may select.
      selected_count: selectableFiles.length,
      generated_by: user.id,
      status: "preparing",
    });
    if (insert.error) {
      audit.error("project_evidence_bundle_row_create_failed", { message: insert.error.message });
      return NextResponse.json({ error: "Failed to retain the evidence review" }, { status: 500 });
    }

    const generatedAt = new Date();
    const generated = await loadProjectEvidenceGeneratedFiles(caller, access.project, generatedAt, selectedPlanRead.data);
    const resolved = [];
    let resolvedBytes = 0;
    for (const candidate of selectableFiles) {
      const file = await resolveProjectEvidenceCandidateBytes(caller, service, access.project, candidate);
      resolvedBytes += file.bytes.length;
      if (file.bytes.length > inventory.limits.perFileBytes) {
        throw new ProjectEvidenceBundleError("file_too_large", `${candidate.title} exceeds the per-file limit.`);
      }
      if (resolvedBytes > inventory.limits.totalSelectedFileBytes) {
        throw new ProjectEvidenceBundleError("bundle_too_large", "The selected files exceed the bundle byte limit.");
      }
      resolved.push(file);
    }

    const built = await buildProjectEvidenceBundle({
      bundleId,
      workspaceId: access.project.workspace_id,
      projectId: access.project.id,
      projectRevision: body.data.projectRevision,
      generatedAt,
      generatedBy: user.id,
      candidates: inventory.candidates,
      selectedFiles: resolved,
      generatedFiles: generated.files,
      inventoryTruncated: inventory.inventoryTruncated,
      knownLimits: [
        "This bundle is a retained evidence snapshot, not a backup, approval, adoption, or publication.",
        "The GeoPackage layer-status table distinguishes included, unavailable, reference-only, and not-selected evidence. Model link files remain separate bundle artifacts rather than inferred GeoPackage geometry.",
      ],
      selectedLinkedPlan: {
        id: selectedPlanInventory.id,
        revisionToken: selectedPlanInventory.revisionToken,
      },
    });

    const upload = await service.storage.from(BUNDLE_BUCKET).upload(storagePath, built.bytes, {
      contentType: "application/zip",
      upsert: false,
    });
    if (upload.error) {
      throw new ProjectEvidenceBundleError("missing_evidence", "The completed bundle could not be stored.");
    }

    const completedAt = new Date().toISOString();
    const finalize = await service
      .from("project_evidence_bundles")
      .update({
        status: "ready",
        manifest_json: built.manifest,
        manifest_sha256: built.manifestSha256,
        checksums_sha256: built.checksumsSha256,
        bundle_sha256: sha256(built.bytes),
        storage_bucket: BUNDLE_BUCKET,
        storage_path: storagePath,
        byte_count: built.bytes.length,
        completed_at: completedAt,
      })
      .eq("id", bundleId)
      .eq("workspace_id", access.project.workspace_id)
      .eq("project_id", access.project.id)
      .eq("status", "preparing")
      .select("id");
    if (finalize.error || finalize.data?.length !== 1) {
      await service.storage.from(BUNDLE_BUCKET).remove([storagePath]);
      throw new ProjectEvidenceBundleError("missing_evidence", "The completed bundle could not be finalized.");
    }

    audit.info("project_evidence_bundle_ready", {
      projectId: access.project.id,
      workspaceId: access.project.workspace_id,
      bundleId,
      selectedCount: selectableFiles.length,
      byteCount: built.bytes.length,
      inventoryTruncated: inventory.inventoryTruncated,
    });
    return NextResponse.json(
      {
        bundleId,
        downloadHref: `/api/projects/${access.project.id}/evidence-bundles/${bundleId}/download`,
      },
      { status: 201 }
    );
  } catch (error) {
    const failureCode = error instanceof ProjectEvidenceBundleError ? error.code : "generation_failed";
    if (bundleId) {
      const failed = await service
        .from("project_evidence_bundles")
        .update({ status: "failed", failure_code: failureCode, completed_at: new Date().toISOString() })
        .eq("id", bundleId)
        .eq("status", "preparing")
        .select("id");
      if (failed.error || failed.data?.length !== 1) {
        audit.error("project_evidence_bundle_failure_row_not_finalized", {
          bundleId,
          failureCode,
          message: failed.error?.message ?? null,
        });
      }
    }
    audit.error("project_evidence_bundle_failed", {
      projectId: parsedParams.data.projectId,
      bundleId,
      failureCode,
      storagePath,
      error,
    });
    if (error instanceof ProjectEvidenceBundleError) {
      return NextResponse.json({ error: error.code, detail: error.message }, { status: errorStatus(error) });
    }
    return NextResponse.json({ error: "Unexpected error while freezing the evidence bundle" }, { status: 500 });
  }
}
