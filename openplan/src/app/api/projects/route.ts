import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { resolveStageGateTemplateBinding } from "@/lib/stage-gates/template-loader";

const createProjectSchema = z.object({
  projectName: z.string().trim().min(1).max(120),
  plan: z.string().trim().min(1).max(40).optional(),
  summary: z.string().trim().max(2000).optional(),
  planType: z.string().trim().min(1).max(80).optional(),
  deliveryPhase: z.string().trim().min(1).max(40).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  stageGateTemplateId: z.string().trim().min(1).max(80).optional(),
});

const DUPLICATE_KEY_CODE = "23505";

type InsertWorkspaceResult = {
  id: string;
  slug: string;
  plan: string;
  stage_gate_template_id: string;
  stage_gate_template_version: string;
};

type InsertProjectRecordResult = {
  id: string;
  name: string;
  status: string;
  plan_type: string;
  delivery_phase: string;
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

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("projects.list", request);
  const startedAt = Date.now();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("projects")
      .select(
        "id, workspace_id, name, summary, status, plan_type, delivery_phase, created_at, updated_at, workspaces(name, plan, created_at)"
      )
      .order("updated_at", { ascending: false });

    if (error) {
      audit.error("projects_list_failed", {
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
    }

    audit.info("projects_list_loaded", {
      userId: user.id,
      count: data?.length ?? 0,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ projects: data ?? [] }, { status: 200 });
  } catch (error) {
    audit.error("projects_list_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json({ error: "Unexpected error while loading projects" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("projects.create", request);
  const startedAt = Date.now();

  try {
    const payload = await request.json().catch(() => null);
    const parsed = createProjectSchema.safeParse(payload);

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

    const projectName = parsed.data.projectName.trim();
    const plan = parsed.data.plan ?? "pilot";
    const summary = parsed.data.summary?.trim() || null;
    const planType = parsed.data.planType?.trim() || "corridor_plan";
    const deliveryPhase = parsed.data.deliveryPhase?.trim() || "scoping";
    const status = parsed.data.status?.trim() || "active";
    const baseSlug = normalizeSlug(projectName);

    let stageGateBinding: ReturnType<typeof resolveStageGateTemplateBinding>;
    try {
      stageGateBinding = resolveStageGateTemplateBinding(parsed.data.stageGateTemplateId, {
        bindingMode: "project_create_v0_2",
      });
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
          name: projectName,
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
        audit.warn("project_slug_conflict", { baseSlug, retryAttempt: attempt + 1 });
        continue;
      }

      audit.error("project_insert_failed", {
        message: error?.message ?? "unknown",
        code: error?.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to create project",
          details: error?.message ?? "Unknown project insert failure",
        },
        { status: 500 }
      );
    }

    if (!workspace) {
      audit.error("project_insert_exhausted", { baseSlug });
      return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
    }

    const { error: memberError } = await supabase
      .from("workspace_members")
      .insert({ workspace_id: workspace.id, user_id: user.id, role: "owner" });

    if (memberError) {
      audit.error("project_owner_member_insert_failed", {
        workspaceId: workspace.id,
        message: memberError.message,
        code: memberError.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to create project",
          details: memberError.message,
        },
        { status: 500 }
      );
    }

    const { data: projectRecord, error: projectRecordError } = await supabase
      .from("projects")
      .insert({
        workspace_id: workspace.id,
        name: projectName,
        summary,
        status,
        plan_type: planType,
        delivery_phase: deliveryPhase,
        created_by: user.id,
      })
      .select("id, name, status, plan_type, delivery_phase")
      .single();

    if (projectRecordError) {
      audit.error("project_record_insert_failed", {
        workspaceId: workspace.id,
        message: projectRecordError.message,
        code: projectRecordError.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to create project record",
          details: projectRecordError.message,
        },
        { status: 500 }
      );
    }

    audit.info("project_created", {
      projectId: workspace.id,
      projectRecordId: (projectRecord as InsertProjectRecordResult).id,
      userId: user.id,
      slug: workspace.slug,
      stageGateTemplateId: workspace.stage_gate_template_id,
      stageGateTemplateVersion: workspace.stage_gate_template_version,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        projectId: workspace.id,
        workspaceId: workspace.id,
        projectRecordId: (projectRecord as InsertProjectRecordResult).id,
        projectRecord: {
          id: (projectRecord as InsertProjectRecordResult).id,
          name: (projectRecord as InsertProjectRecordResult).name,
          status: (projectRecord as InsertProjectRecordResult).status,
          planType: (projectRecord as InsertProjectRecordResult).plan_type,
          deliveryPhase: (projectRecord as InsertProjectRecordResult).delivery_phase,
        },
        slug: workspace.slug,
        plan: workspace.plan,
        stageGateTemplate: {
          id: workspace.stage_gate_template_id,
          version: workspace.stage_gate_template_version,
          jurisdiction: stageGateBinding.jurisdiction,
          bindingMode: stageGateBinding.bindingMode,
          lapmFormIdsStatus: stageGateBinding.lapmFormIdsStatus,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("projects_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json({ error: "Unexpected error while creating project" }, { status: 500 });
  }
}
