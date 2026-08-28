import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { decisionPackageFreshness, decisionPackageReadiness } from "@/lib/project-evidence-bundles/decision-package-readiness";
import { loadProjectEvidenceCandidateInventory } from "@/lib/project-evidence-bundles/inventory";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const paramsSchema = z.object({ projectId: z.string().uuid(), submissionId: z.string().uuid() });
const bodySchema = z.object({
  bundleId: z.string().uuid(),
  bundleSha256: z.string().regex(/^[0-9a-f]{64}$/),
  decision: z.enum(["approved", "returned"]),
  reason: z.string().trim().max(4000).nullable().optional(),
}).superRefine((value, context) => {
  if (value.decision === "returned" && (!value.reason || value.reason.length < 3)) {
    context.addIssue({ code: "custom", path: ["reason"], message: "A return reason is required." });
  }
});

type StoredDecisionBundle = {
  bundle_sha256: string;
  storage_bucket: string | null;
  storage_path: string | null;
  byte_count: number | null;
};

function assistantAttempt(request: NextRequest): boolean {
  return Boolean(
    request.headers.get("x-openplan-assistant-execution-source") ||
    request.headers.get("x-openplan-assistant-approval-id") ||
    request.headers.get("x-openplan-assistant-input-hash")
  );
}

async function verifyStoredBundle(bundle: StoredDecisionBundle): Promise<string | null> {
  if (
    bundle.storage_bucket !== "project-evidence-bundles" ||
    !bundle.storage_path ||
    bundle.byte_count === null
  ) {
    return "The frozen bundle has no verifiable stored ZIP.";
  }
  const service = createServiceRoleClient();
  const downloaded = await service.storage.from(bundle.storage_bucket).download(bundle.storage_path);
  if (downloaded.error || !downloaded.data) {
    return "The stored bundle ZIP could not be read for exact-hash verification.";
  }
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== bundle.byte_count || actualSha256 !== bundle.bundle_sha256) {
    return "The stored bundle ZIP bytes no longer match the retained size and SHA-256.";
  }
  return null;
}

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string; submissionId: string }> }) {
  const audit = createApiAuditLogger("projects.decision_packages.receipt", request);
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid decision package id" }, { status: 400 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadProjectAccess(client, parsed.data.projectId, user.id, "programs.read");
  if (access.error) return NextResponse.json({ error: "Failed to verify project access" }, { status: 500 });
  if (!access.project || !access.membership || !access.allowed) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const decision = await client.from("project_decision_package_decisions")
    .select("receipt_canonical_json, receipt_sha256")
    .eq("workspace_id", access.project.workspace_id)
    .eq("project_id", access.project.id)
    .eq("submission_id", parsed.data.submissionId)
    .maybeSingle();
  if (decision.error) return NextResponse.json({ error: "Decision receipt could not be read" }, { status: 503 });
  if (!decision.data) return NextResponse.json({ error: "Decision receipt not found" }, { status: 404 });
  const actualReceiptSha256 = createHash("sha256")
    .update(decision.data.receipt_canonical_json, "utf8")
    .digest("hex");
  if (actualReceiptSha256 !== decision.data.receipt_sha256) {
    return NextResponse.json({ error: "Decision receipt bytes failed exact-hash verification" }, { status: 409 });
  }
  audit.info("project_decision_package_receipt_downloaded", {
    projectId: access.project.id,
    submissionId: parsed.data.submissionId,
    receiptSha256: decision.data.receipt_sha256,
  });
  return new NextResponse(decision.data.receipt_canonical_json, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="openplan-decision-receipt-${parsed.data.submissionId}.json"`,
      "x-openplan-receipt-sha256": decision.data.receipt_sha256,
    },
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string; submissionId: string }> }) {
  const audit = createApiAuditLogger("projects.decision_packages.decide", request);
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid decision package id" }, { status: 400 });
  if (assistantAttempt(request)) {
    audit.warn("project_decision_package_decision_assistant_refused", {
      projectId: parsed.data.projectId,
      submissionId: parsed.data.submissionId,
    });
    return NextResponse.json(
      {
        error: "human_review_required",
        detail: "An assistant cannot approve or return an agency decision package. The assigned human approver must decide it.",
      },
      { status: 403 },
    );
  }
  const bodyRead = await readJsonWithLimit(request, BODY_LIMITS.normalJson);
  if (!bodyRead.ok) return bodyRead.response;
  const body = bodySchema.safeParse(bodyRead.data);
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid decision" }, { status: 400 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadProjectAccess(client, parsed.data.projectId, user.id, "programs.read");
  if (access.error) return NextResponse.json({ error: "Failed to verify project access" }, { status: 500 });
  if (!access.project || !access.membership || !access.allowed) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!canAccessWorkspaceAction("decision_packages.approve", access.membership.role)) {
    return NextResponse.json({ error: "Only an owner or admin assigned to this package may decide it." }, { status: 403 });
  }
  const bundle = await client.from("project_evidence_bundles")
    .select("id, bundle_sha256, project_revision, manifest_json, status, storage_bucket, storage_path, byte_count")
    .eq("id", body.data.bundleId)
    .eq("workspace_id", access.project.workspace_id)
    .eq("project_id", access.project.id)
    .maybeSingle();
  if (bundle.error) return NextResponse.json({ error: "Bundle could not be verified" }, { status: 503 });
  if (!bundle.data || bundle.data.status !== "ready" || bundle.data.bundle_sha256 !== body.data.bundleSha256) {
    return NextResponse.json({ error: "The exact ready bundle hash does not match." }, { status: 409 });
  }
  if (body.data.decision === "approved") {
    const readinessError = decisionPackageReadiness(bundle.data.manifest_json);
    if (readinessError) return NextResponse.json({ error: readinessError }, { status: 409 });
    const inventory = await loadProjectEvidenceCandidateInventory(client, access.project);
    const freshnessError = decisionPackageFreshness(
      bundle.data.manifest_json,
      bundle.data.project_revision,
      inventory,
    );
    if (freshnessError) return NextResponse.json({ error: freshnessError }, { status: 409 });
    const storageError = await verifyStoredBundle(bundle.data);
    if (storageError) return NextResponse.json({ error: storageError }, { status: 409 });
  }
  const insert = await client.from("project_decision_package_decisions").insert({
    workspace_id: access.project.workspace_id,
    project_id: access.project.id,
    submission_id: parsed.data.submissionId,
    bundle_id: body.data.bundleId,
    bundle_sha256: body.data.bundleSha256,
    decision: body.data.decision,
    reason: body.data.reason || null,
    decided_by: user.id,
  }).select("id, receipt_sha256").single();
  if (insert.error) return NextResponse.json({ error: insert.error.message }, { status: 409 });
  audit.info("project_decision_package_decided", {
    projectId: access.project.id,
    submissionId: parsed.data.submissionId,
    decision: body.data.decision,
    receiptSha256: insert.data.receipt_sha256,
  });
  return NextResponse.json({ decisionId: insert.data.id, receiptSha256: insert.data.receipt_sha256 }, { status: 201 });
}
