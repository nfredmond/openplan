import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { RTP_PORTFOLIO_ROLE_OPTIONS } from "@/lib/rtp/catalog";

const PORTFOLIO_ROLES = RTP_PORTFOLIO_ROLE_OPTIONS.map((option) => option.value) as [string, ...string[]];

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const createLinkSchema = z.object({
  rtpCycleId: z.string().uuid(),
  portfolioRole: z.enum(PORTFOLIO_ROLES).optional(),
  priorityRationale: z.string().trim().max(2000).optional(),
});

const deleteLinkSchema = z.object({
  linkId: z.string().uuid(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.rtp_links.create", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      audit.warn("params_validation_failed", { issues: routeParams.error.issues });
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const payload = createLinkSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid RTP link payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, workspace_id, name")
      .eq("id", routeParams.data.projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .eq("workspace_id", project.workspace_id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", { error: membershipError.message, workspaceId: project.workspace_id });
      return NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 });
    }

    if (!membership || !canAccessWorkspaceAction("plans.write", membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: cycle, error: cycleError } = await supabase
      .from("rtp_cycles")
      .select("id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year")
      .eq("id", payload.data.rtpCycleId)
      .single();

    if (cycleError || !cycle) {
      return NextResponse.json({ error: "RTP cycle not found" }, { status: 404 });
    }

    if (cycle.workspace_id !== project.workspace_id) {
      return NextResponse.json({ error: "RTP cycle must belong to the same workspace" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("project_rtp_cycle_links")
      .insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        rtp_cycle_id: cycle.id,
        portfolio_role: payload.data.portfolioRole ?? "candidate",
        priority_rationale: payload.data.priorityRationale || null,
        created_by: user.id,
      })
      .select("id, project_id, rtp_cycle_id, portfolio_role, priority_rationale, created_at")
      .single();

    if (error) {
      const status = error.code === "23505" ? 409 : 500;
      audit.error("insert_failed", { error: error.message, code: error.code ?? null, status });
      return NextResponse.json(
        { error: status === 409 ? "This project is already linked to that RTP cycle" : "Failed to create RTP link" },
        { status }
      );
    }

    audit.info("created", { projectId: project.id, rtpCycleId: cycle.id, durationMs: Date.now() - startedAt });
    return NextResponse.json({
      link: {
        ...data,
        cycle,
      },
    });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to create RTP link" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.rtp_links.delete", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      audit.warn("params_validation_failed", { issues: routeParams.error.issues });
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const payload = deleteLinkSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid delete payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: link, error: linkError } = await supabase
      .from("project_rtp_cycle_links")
      .select("id, project_id, workspace_id")
      .eq("id", payload.data.linkId)
      .eq("project_id", routeParams.data.projectId)
      .maybeSingle();

    if (linkError) {
      audit.error("link_lookup_failed", { error: linkError.message });
      return NextResponse.json({ error: "Failed to load RTP link" }, { status: 500 });
    }

    if (!link) {
      return NextResponse.json({ error: "RTP link not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .eq("workspace_id", link.workspace_id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", { error: membershipError.message, workspaceId: link.workspace_id });
      return NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 });
    }

    if (!membership || !canAccessWorkspaceAction("plans.write", membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await supabase.from("project_rtp_cycle_links").delete().eq("id", link.id);
    if (error) {
      audit.error("delete_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to remove RTP link" }, { status: 500 });
    }

    audit.info("deleted", { projectId: routeParams.data.projectId, linkId: link.id, durationMs: Date.now() - startedAt });
    return NextResponse.json({ ok: true });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to remove RTP link" }, { status: 500 });
  }
}
