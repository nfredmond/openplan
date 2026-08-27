import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import {
  decisionPackageFreshness,
  decisionPackageReadiness,
} from "@/lib/project-evidence-bundles/decision-package-readiness";
import { loadProjectEvidenceCandidateInventory } from "@/lib/project-evidence-bundles/inventory";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadWorkspaceRoster, type RosterServiceClient } from "@/lib/workspaces/roster";

export const runtime = "nodejs";

const paramsSchema = z.object({ projectId: z.string().uuid() });
const submitSchema = z.object({
  bundleId: z.string().uuid(),
  bundleSha256: z.string().regex(/^[0-9a-f]{64}$/),
  assignedApproverId: z.string().uuid(),
  replacesSubmissionId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

async function access(projectId: string) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const projectAccess = await loadProjectAccess(client, projectId, user.id, "programs.read");
  if (projectAccess.error) return { response: NextResponse.json({ error: "Failed to verify project access" }, { status: 500 }) } as const;
  if (!projectAccess.project) return { response: NextResponse.json({ error: "Project not found" }, { status: 404 }) } as const;
  if (!projectAccess.membership || !projectAccess.allowed) {
    return { response: NextResponse.json({ error: "Workspace access denied" }, { status: 403 }) } as const;
  }
  return { client, user, project: projectAccess.project, membership: projectAccess.membership } as const;
}

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.decision_packages.list", request);
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  const checked = await access(parsed.data.projectId);
  if ("response" in checked) return checked.response;

  const service = createServiceRoleClient();
  const [bundles, submissions, decisions, roster, inventory] = await Promise.all([
    checked.client.from("project_evidence_bundles")
      .select("id, bundle_sha256, project_revision, manifest_json, generated_by, generated_at")
      .eq("workspace_id", checked.project.workspace_id).eq("project_id", checked.project.id)
      .eq("status", "ready").order("generated_at", { ascending: false }).limit(20),
    checked.client.from("project_decision_package_submissions")
      .select("id, bundle_id, bundle_sha256, submitted_by, assigned_approver_id, replaces_submission_id, note, submitted_at")
      .eq("workspace_id", checked.project.workspace_id).eq("project_id", checked.project.id)
      .order("submitted_at", { ascending: false }).limit(50),
    checked.client.from("project_decision_package_decisions")
      .select("id, submission_id, bundle_id, bundle_sha256, decision, reason, decided_by, receipt_sha256, decided_at")
      .eq("workspace_id", checked.project.workspace_id).eq("project_id", checked.project.id)
      .order("decided_at", { ascending: false }).limit(50),
    loadWorkspaceRoster(service as unknown as RosterServiceClient, checked.user.id, checked.project.workspace_id),
    loadProjectEvidenceCandidateInventory(checked.client, checked.project),
  ]);
  const failed = [bundles, submissions, decisions].find((result) => result.error);
  if (failed?.error) return NextResponse.json({ error: "Decision packages could not be read" }, { status: 503 });
  if (!roster.ok) return NextResponse.json({ error: "Decision package approvers could not be read" }, { status: 503 });
  audit.info("project_decision_packages_listed", {
    projectId: checked.project.id,
    bundleCount: bundles.data?.length ?? 0,
    submissionCount: submissions.data?.length ?? 0,
  });
  return NextResponse.json({
    currentUserId: checked.user.id,
    canApprove: canAccessWorkspaceAction("decision_packages.approve", checked.membership.role),
    bundles: (bundles.data ?? []).map((bundle) => {
      const freshnessError = decisionPackageFreshness(bundle.manifest_json, bundle.project_revision, inventory);
      return {
        ...bundle,
        readinessError: decisionPackageReadiness(bundle.manifest_json),
        freshnessError,
        staleForCurrentUse: Boolean(freshnessError),
      };
    }),
    submissions: submissions.data ?? [],
    decisions: decisions.data ?? [],
    approvers: roster.members
      .filter((member) => member.role === "owner" || member.role === "admin")
      .map((member) => ({
        user_id: member.userId,
        role: member.role,
        label: member.email ?? `${member.role === "owner" ? "Owner" : "Admin"} (identity unavailable)`,
      })),
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.decision_packages.submit", request);
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  const bodyRead = await readJsonWithLimit(request, BODY_LIMITS.normalJson);
  if (!bodyRead.ok) return bodyRead.response;
  const body = submitSchema.safeParse(bodyRead.data);
  if (!body.success) return NextResponse.json({ error: "Invalid decision package submission" }, { status: 400 });
  const checked = await access(parsed.data.projectId);
  if ("response" in checked) return checked.response;
  if (!canAccessWorkspaceAction("programs.write", checked.membership.role)) {
    return NextResponse.json({ error: "Viewers cannot submit decision packages." }, { status: 403 });
  }
  const bundle = await checked.client.from("project_evidence_bundles")
    .select("id, bundle_sha256, project_revision, manifest_json, status")
    .eq("id", body.data.bundleId).eq("workspace_id", checked.project.workspace_id)
    .eq("project_id", checked.project.id).maybeSingle();
  if (bundle.error) return NextResponse.json({ error: "Bundle could not be verified" }, { status: 503 });
  if (!bundle.data || bundle.data.status !== "ready" || bundle.data.bundle_sha256 !== body.data.bundleSha256) {
    return NextResponse.json({ error: "The exact ready bundle hash does not match." }, { status: 409 });
  }
  const readinessError = decisionPackageReadiness(bundle.data.manifest_json);
  if (readinessError) return NextResponse.json({ error: readinessError }, { status: 409 });
  const inventory = await loadProjectEvidenceCandidateInventory(checked.client, checked.project);
  const freshnessError = decisionPackageFreshness(
    bundle.data.manifest_json,
    bundle.data.project_revision,
    inventory,
  );
  if (freshnessError) return NextResponse.json({ error: freshnessError }, { status: 409 });
  const insert = await checked.client.from("project_decision_package_submissions").insert({
    workspace_id: checked.project.workspace_id,
    project_id: checked.project.id,
    bundle_id: body.data.bundleId,
    bundle_sha256: body.data.bundleSha256,
    submitted_by: checked.user.id,
    assigned_approver_id: body.data.assignedApproverId,
    replaces_submission_id: body.data.replacesSubmissionId ?? null,
    note: body.data.note || null,
  }).select("id").single();
  if (insert.error) return NextResponse.json({ error: insert.error.message }, { status: 409 });
  audit.info("project_decision_package_submitted", {
    projectId: checked.project.id,
    submissionId: insert.data.id,
    bundleId: body.data.bundleId,
    bundleSha256: body.data.bundleSha256,
  });
  return NextResponse.json({ submissionId: insert.data.id }, { status: 201 });
}
