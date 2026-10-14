import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  describeStageGateBinding,
  resolveStageGateTemplateBinding,
} from "@/lib/stage-gates/template-loader";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
// The checklist itself lives in the shared onboarding module so the in-app
// Help page renders the same list this response carries — the bootstrap
// endpoint is off the real sign-up path (the handle_new_user trigger
// provisions the workspace), so a list that lived only here was unreachable.
import { NEW_WORKSPACE_GETTING_STARTED_STEPS } from "@/lib/onboarding/getting-started";
import {
  createOwnedWorkspace,
  ownedWorkspaceLimitMessage,
  resolveOwnedWorkspaceLimit,
  type OwnedWorkspaceCreation,
} from "@/lib/workspaces/owned-workspace-limit";

const bootstrapSchema = z.object({
  workspaceName: z.string().trim().min(1).max(120),
  stageGateTemplateId: z.string().trim().min(1).max(80).optional(),
});

const onboardingChecklist = NEW_WORKSPACE_GETTING_STARTED_STEPS;

const DUPLICATE_KEY_CODE = "23505";

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

    // The count of workspaces this person owns, the workspace and its owner
    // membership are written together in one database function, so parallel
    // requests cannot all pass the limit and a failed membership insert leaves
    // no workspace behind.
    const ownedLimit = resolveOwnedWorkspaceLimit();
    let workspace: Extract<OwnedWorkspaceCreation, { status: "created" }>["workspace"] | null = null;
    for (let attempt = 0; attempt <= 3; attempt += 1) {
      const slug = slugWithSuffix(baseSlug, attempt);

      const creation = await createOwnedWorkspace(serviceSupabase, {
        userId: user.id,
        name: workspaceName,
        slug,
        stageGateTemplateId: stageGateBinding.templateId,
        stageGateTemplateVersion: stageGateBinding.templateVersion,
        stageGateTemplateSelection: stageGateBinding.templateSelection,
        stageGateBindingSource: stageGateBinding.bindingMode,
        limit: ownedLimit,
      });

      if (creation.status === "created") {
        workspace = creation.workspace;
        break;
      }

      if (creation.status === "limit_reached") {
        audit.warn("owned_workspace_limit_reached", {
          userId: user.id,
          owned: creation.owned,
          limit: creation.limit,
        });
        return NextResponse.json(
          { error: ownedWorkspaceLimitMessage(creation.limit), limit: creation.limit },
          { status: 403 }
        );
      }

      if (isDuplicateSlugError(creation.error) && attempt < 3) {
        audit.warn("workspace_slug_conflict", { baseSlug, retryAttempt: attempt + 1 });
        continue;
      }

      audit.error("workspace_insert_failed", {
        message: creation.error.message ?? "unknown",
        code: creation.error.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to bootstrap workspace",
          details: creation.error.message ?? "Unknown workspace insert failure",
        },
        { status: 500 }
      );
    }

    if (!workspace) {
      audit.error("workspace_insert_exhausted", { baseSlug });
      return NextResponse.json({ error: "Failed to bootstrap workspace" }, { status: 500 });
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
