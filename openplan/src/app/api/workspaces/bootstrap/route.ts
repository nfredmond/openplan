import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { resolveStageGateTemplateBinding } from "@/lib/stage-gates/template-loader";

const bootstrapSchema = z.object({
  workspaceName: z.string().trim().min(1).max(120),
  plan: z.string().trim().min(1).max(40).optional(),
  stageGateTemplateId: z.string().trim().min(1).max(80).optional(),
});

const onboardingChecklist = [
  "Confirm primary workspace owner and backup admin contacts.",
  "Set pilot success metrics and first corridor delivery deadline.",
  "Upload at least one production corridor GeoJSON file.",
  "Run first corridor analysis and validate score transparency panel.",
  "Export PDF report and archive with timestamped run metadata.",
  "Schedule pilot readout and weekly KPI review cadence.",
];

const DUPLICATE_KEY_CODE = "23505";

type InsertWorkspaceResult = {
  id: string;
  slug: string;
  plan: string;
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

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.bootstrap", request);
  const startedAt = Date.now();

  try {
    const payload = await request.json().catch(() => null);
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
    const plan = parsed.data.plan ?? "pilot";
    const baseSlug = normalizeSlug(workspaceName);

    let stageGateBinding: ReturnType<typeof resolveStageGateTemplateBinding>;
    try {
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

      const { data, error } = await supabase
        .from("workspaces")
        .insert({
          name: workspaceName,
          slug,
          plan,
          stage_gate_template_id: stageGateBinding.templateId,
          stage_gate_template_version: stageGateBinding.templateVersion,
          stage_gate_binding_source: stageGateBinding.bindingMode,
        })
        .select("id, slug, plan, stage_gate_template_id, stage_gate_template_version")
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

    const { error: memberError } = await supabase
      .from("workspace_members")
      .insert({ workspace_id: workspace.id, user_id: user.id, role: "owner" });

    if (memberError) {
      audit.error("workspace_member_insert_failed", {
        workspaceId: workspace.id,
        message: memberError.message,
        code: memberError.code ?? null,
      });

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
        plan: workspace.plan,
        stageGateTemplate: {
          id: workspace.stage_gate_template_id,
          version: workspace.stage_gate_template_version,
          jurisdiction: stageGateBinding.jurisdiction,
          bindingMode: stageGateBinding.bindingMode,
          lapmFormIdsStatus: stageGateBinding.lapmFormIdsStatus,
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
