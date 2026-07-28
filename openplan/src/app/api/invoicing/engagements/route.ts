import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const ENGAGEMENT_SELECT =
  "id, workspace_id, client_id, project_id, parent_engagement_id, title, reference_code, engagement_kind, billing_basis, not_to_exceed_amount, start_date, end_date, status, notes, created_by, created_at, updated_at";

const createEngagementSchema = z.object({
  workspaceId: z.string().uuid(),
  clientId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(300),
  referenceCode: z.string().trim().max(120).optional(),
  engagementKind: z.enum(["contract", "task_order", "on_call", "other"]).optional(),
  // Same basis vocabulary as billing_invoice_records: one billing-basis
  // language across both invoicing directions.
  billingBasis: z.enum(["lump_sum", "time_and_materials", "cost_plus", "milestone", "progress_payment"]).optional(),
  notToExceedAmount: z.coerce.number().min(0).optional(),
  startDate: z.string().trim().max(30).optional(),
  endDate: z.string().trim().max(30).optional(),
  status: z.enum(["pending", "active", "closed"]).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("invoicing.engagements.create", request);
  const startedAt = Date.now();

  try {
    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = createEngagementSchema.safeParse(payloadBody.data);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid engagement payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError || !membership) {
      audit.warn("workspace_membership_missing", {
        workspaceId: parsed.data.workspaceId,
        userId: user.id,
        message: membershipError?.message ?? null,
      });
      return NextResponse.json({ error: "Workspace access not found" }, { status: 403 });
    }

    if (!canAccessWorkspaceAction("invoices.write", membership.role)) {
      audit.warn("forbidden", { workspaceId: parsed.data.workspaceId, userId: user.id, role: membership.role });
      return NextResponse.json({ error: "Owner or admin role required for invoice writes" }, { status: 403 });
    }

    const { data: clientRow, error: clientError } = await supabase
      .from("invoicing_clients")
      .select("id, workspace_id")
      .eq("id", parsed.data.clientId)
      .single();

    if (clientError || !clientRow || clientRow.workspace_id !== parsed.data.workspaceId) {
      audit.warn("client_workspace_mismatch", {
        workspaceId: parsed.data.workspaceId,
        clientId: parsed.data.clientId,
        message: clientError?.message ?? null,
      });
      return NextResponse.json({ error: "Client is not available in the requested workspace" }, { status: 400 });
    }

    if (parsed.data.projectId) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id, workspace_id")
        .eq("id", parsed.data.projectId)
        .single();

      if (projectError || !project || project.workspace_id !== parsed.data.workspaceId) {
        audit.warn("project_workspace_mismatch", {
          workspaceId: parsed.data.workspaceId,
          projectId: parsed.data.projectId,
          message: projectError?.message ?? null,
        });
        return NextResponse.json({ error: "Project is not available in the requested workspace" }, { status: 400 });
      }
    }

    const { data, error } = await supabase
      .from("invoicing_engagements")
      .insert({
        workspace_id: parsed.data.workspaceId,
        client_id: parsed.data.clientId,
        project_id: parsed.data.projectId ?? null,
        title: parsed.data.title,
        reference_code: parsed.data.referenceCode?.trim() || null,
        engagement_kind: parsed.data.engagementKind ?? "contract",
        billing_basis: parsed.data.billingBasis ?? null,
        not_to_exceed_amount: parsed.data.notToExceedAmount ?? null,
        start_date: parsed.data.startDate?.trim() || null,
        end_date: parsed.data.endDate?.trim() || null,
        status: parsed.data.status ?? "active",
        notes: parsed.data.notes?.trim() || null,
        created_by: user.id,
      })
      .select(ENGAGEMENT_SELECT)
      .single();

    if (error) {
      audit.error("invoicing_engagement_insert_failed", {
        message: error.message,
        code: error.code ?? null,
        workspaceId: parsed.data.workspaceId,
      });
      return NextResponse.json({ error: "Failed to create engagement", details: error.message }, { status: 500 });
    }

    audit.info("invoicing_engagement_created", {
      workspaceId: parsed.data.workspaceId,
      clientId: parsed.data.clientId,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ engagement: data }, { status: 201 });
  } catch (error) {
    audit.error("invoicing_engagement_create_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while creating engagement" }, { status: 500 });
  }
}
