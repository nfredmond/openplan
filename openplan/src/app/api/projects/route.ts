import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";

const createProjectSchema = z.object({
  projectName: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(2000).optional(),
  planType: z.string().trim().min(1).max(80).optional(),
  deliveryPhase: z.string().trim().min(1).max(40).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  /**
   * Which workspace the project belongs to. Optional and defaults to the
   * caller's current workspace; the workspace switcher passes it explicitly.
   * A project NEVER creates a workspace (see the POST handler).
   */
  workspaceId: z.string().uuid().optional(),
});

type InsertProjectRecordResult = {
  id: string;
  name: string;
  status: string;
  plan_type: string;
  delivery_phase: string;
};

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
    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const payload = payloadBody.data;
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
    const summary = parsed.data.summary?.trim() || null;
    const planType = parsed.data.planType?.trim() || "corridor_plan";
    const deliveryPhase = parsed.data.deliveryPhase?.trim() || "scoping";
    const status = parsed.data.status?.trim() || "active";

    // A project lives INSIDE the caller's workspace; it never creates one. The
    // prior behavior inserted a new `workspaces` row per project, which — with
    // "current workspace" resolving newest-first — silently relocated the caller
    // and 404'd every earlier project the moment a new one was made. The project
    // inherits the workspace's existing stage-gate binding.
    let workspaceId: string;
    if (parsed.data.workspaceId) {
      // Explicit target (the workspace switcher passes this). Verify membership
      // for a clean 403/503 rather than leaning only on the RLS insert guard.
      const membership = await checkWorkspaceMembership(supabase, user.id, parsed.data.workspaceId);
      if (!membership.ok) {
        if (membership.kind === "schema_pending") {
          return NextResponse.json(
            { error: "Workspace schema is not available yet" },
            { status: 503 }
          );
        }
        if (membership.kind === "not_member") {
          return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
        }
        audit.error("project_workspace_membership_failed", {
          workspaceId: parsed.data.workspaceId,
          message: membership.message,
        });
        return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
      }
      workspaceId = parsed.data.workspaceId;
    } else {
      const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);
      if (!membership) {
        audit.warn("project_create_no_workspace", { userId: user.id });
        return NextResponse.json(
          { error: "No workspace is attached to this account yet." },
          { status: 409 }
        );
      }
      workspaceId = membership.workspace_id;
    }

    // User (RLS) client: the projects_insert policy (20260717000082) enforces
    // membership of `workspace_id`, so a forged workspaceId cannot plant a
    // project in a workspace the caller does not belong to — defense in depth
    // behind the explicit check above.
    const { data: projectRecord, error: projectRecordError } = await supabase
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: projectName,
        summary,
        status,
        plan_type: planType,
        delivery_phase: deliveryPhase,
        created_by: user.id,
      })
      .select("id, name, status, plan_type, delivery_phase")
      .single();

    if (projectRecordError || !projectRecord) {
      audit.error("project_record_insert_failed", {
        workspaceId,
        message: projectRecordError?.message ?? "unknown",
        code: projectRecordError?.code ?? null,
      });
      return NextResponse.json(
        {
          error: "Failed to create project",
          details: projectRecordError?.message ?? "Unknown project insert failure",
        },
        { status: 500 }
      );
    }

    const record = projectRecord as InsertProjectRecordResult;

    audit.info("project_created", {
      projectRecordId: record.id,
      workspaceId,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        projectRecordId: record.id,
        workspaceId,
        projectRecord: {
          id: record.id,
          name: record.name,
          status: record.status,
          planType: record.plan_type,
          deliveryPhase: record.delivery_phase,
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
