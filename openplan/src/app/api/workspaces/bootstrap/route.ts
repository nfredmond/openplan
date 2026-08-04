import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  describeStageGateBinding,
  resolveStageGateTemplateBinding,
} from "@/lib/stage-gates/template-loader";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const bootstrapSchema = z.object({
  workspaceName: z.string().trim().min(1).max(120),
  stageGateTemplateId: z.string().trim().min(1).max(80).optional(),
});

/**
 * The first six things to do in a new workspace.
 *
 * REWRITTEN because the original was written for a supervised single-county
 * pilot that no longer exists: it told every new workspace in the country to
 * "set pilot success metrics", "schedule pilot readout", and hold a "weekly KPI
 * review cadence" — steps that belong to one agency's engagement, not to the
 * product. OpenPlan is self-serve now (non-negotiable #4), so the first thing a
 * planner sees on sign-up cannot assume a founder, a pilot period, a readout
 * meeting, or a reporting cadence somebody else set.
 *
 * These are jurisdiction-neutral on purpose: no place, agency, or program is
 * named, because the same list is the first thing a city planner in Ohio, a
 * tribal transportation department, and a two-person consultancy will read.
 */
const onboardingChecklist = [
  "Confirm the workspace owner and add at least one other admin.",
  "Set your workspace's home geography so analyses start in your area.",
  "Invite the teammates who will review and approve work.",
  "Draw or upload a corridor, then run your first corridor analysis.",
  "Read the source transparency panel and check what was measured and what was not.",
  "Export a report and confirm the run metadata and disclosures read the way you need.",
];

const DUPLICATE_KEY_CODE = "23505";

type InsertWorkspaceResult = {
  id: string;
  slug: string;
  stage_gate_template_id: string;
  stage_gate_template_version: string;
};

function normalizeSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return normalized || "workspace";
}

function slugWithSuffix(baseSlug: string, attempt: number): string {
  if (attempt === 0) {
    return baseSlug;
  }

  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 4);
  const maxBaseLength = 48 - 1 - suffix.length;
  const trimmedBase = baseSlug.slice(0, Math.max(1, maxBaseLength));
  return `${trimmedBase}-${suffix}`;
}

function isDuplicateSlugError(error: { code?: string | null; message?: string } | null): boolean {
  if (!error) {
    return false;
  }

  if (error.code === DUPLICATE_KEY_CODE) {
    return true;
  }

  return /duplicate key/i.test(error.message ?? "") && /slug/i.test(error.message ?? "");
}

async function cleanupProvisionedWorkspace(
  serviceSupabase: ReturnType<typeof createServiceRoleClient>,
  workspaceId: string,
  audit: ReturnType<typeof createApiAuditLogger>
) {
  const { error: memberCleanupError } = await serviceSupabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId);

  if (memberCleanupError) {
    audit.warn("workspace_bootstrap_cleanup_members_failed", {
      workspaceId,
      message: memberCleanupError.message,
      code: memberCleanupError.code ?? null,
    });
  }

  const { error: workspaceCleanupError } = await serviceSupabase
    .from("workspaces")
    .delete()
    .eq("id", workspaceId);

  if (workspaceCleanupError) {
    audit.warn("workspace_bootstrap_cleanup_workspace_failed", {
      workspaceId,
      message: workspaceCleanupError.message,
      code: workspaceCleanupError.code ?? null,
    });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.bootstrap", request);
  const startedAt = Date.now();

  try {
    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!payloadBody.ok) return payloadBody.response;
    const payload = payloadBody.data;
    const parsed = bootstrapSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspaceName = parsed.data.workspaceName.trim();
    const baseSlug = normalizeSlug(workspaceName);
    const serviceSupabase = createServiceRoleClient();

    let stageGateBinding: ReturnType<typeof resolveStageGateTemplateBinding>;
    try {
      // No jurisdiction is passed, and that is the truth rather than an omission:
      // the workspace does not exist yet, so it has no home geography to match a
      // pack against. Unless the caller named a template, this resolves to the
      // labeled interim default with reason `no_workspace_jurisdiction` — which
      // the response carries, so whoever bootstrapped can say so. Once the
      // workspace has a geography, `resolveWorkspaceStageGateBinding` re-answers
      // the question from the row.
      stageGateBinding = resolveStageGateTemplateBinding(parsed.data.stageGateTemplateId);
    } catch {
      audit.warn("unsupported_stage_gate_template", {
        requestedTemplateId: parsed.data.stageGateTemplateId ?? null,
      });
      return NextResponse.json({ error: "Unsupported stage-gate template" }, { status: 400 });
    }

    let workspace: InsertWorkspaceResult | null = null;
    for (let attempt = 0; attempt <= 3; attempt += 1) {
      const slug = slugWithSuffix(baseSlug, attempt);

      const { data, error } = await serviceSupabase
        .from("workspaces")
        .insert({
          name: workspaceName,
          slug,
          stage_gate_template_id: stageGateBinding.templateId,
          stage_gate_template_version: stageGateBinding.templateVersion,
          stage_gate_binding_source: stageGateBinding.bindingMode,
        })
        .select("id, slug, stage_gate_template_id, stage_gate_template_version")
        .single();

      if (!error && data) {
        workspace = data as InsertWorkspaceResult;
        break;
      }

      if (isDuplicateSlugError(error) && attempt < 3) {
        audit.warn("workspace_slug_conflict", { baseSlug, retryAttempt: attempt + 1 });
        continue;
      }

      audit.error("workspace_insert_failed", {
        message: error?.message ?? "unknown",
        code: error?.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to bootstrap workspace",
          details: error?.message ?? "Unknown workspace insert failure",
        },
        { status: 500 }
      );
    }

    if (!workspace) {
      audit.error("workspace_insert_exhausted", { baseSlug });
      return NextResponse.json({ error: "Failed to bootstrap workspace" }, { status: 500 });
    }

    const { error: memberError } = await serviceSupabase
      .from("workspace_members")
      .insert({ workspace_id: workspace.id, user_id: user.id, role: "owner" });

    if (memberError) {
      audit.error("workspace_member_insert_failed", {
        workspaceId: workspace.id,
        message: memberError.message,
        code: memberError.code ?? null,
      });

      await cleanupProvisionedWorkspace(serviceSupabase, workspace.id, audit);

      return NextResponse.json(
        {
          error: "Failed to bootstrap workspace",
          details: memberError.message,
        },
        { status: 500 }
      );
    }

    audit.info("workspace_bootstrapped", {
      workspaceId: workspace.id,
      userId: user.id,
      slug: workspace.slug,
      stageGateTemplateId: workspace.stage_gate_template_id,
      stageGateTemplateVersion: workspace.stage_gate_template_version,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        workspaceId: workspace.id,
        slug: workspace.slug,
        stageGateTemplate: {
          id: workspace.stage_gate_template_id,
          version: workspace.stage_gate_template_version,
          jurisdiction: stageGateBinding.jurisdiction,
          bindingMode: stageGateBinding.bindingMode,
          lapmFormIdsStatus: stageGateBinding.lapmFormIdsStatus,
          // Whether anyone chose this template, and why not when nobody did. A
          // client that shows the new workspace its gates needs both to avoid
          // presenting an assumed jurisdiction as a selected one.
          templateSelection: stageGateBinding.templateSelection,
          interimDefaultReason: stageGateBinding.interimDefaultReason,
          disclosure: describeStageGateBinding(stageGateBinding),
        },
        onboardingChecklist,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("workspaces_bootstrap_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json({ error: "Unexpected error while bootstrapping workspace" }, { status: 500 });
  }
}
