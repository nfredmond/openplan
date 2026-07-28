import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const CLIENT_SELECT =
  "id, workspace_id, name, client_kind, billing_address, contact_name, contact_email, notes, created_by, created_at, updated_at";

const createInvoicingClientSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  clientKind: z
    .enum(["public_agency", "tribal_government", "prime_contractor", "nonprofit", "private", "other"])
    .optional(),
  billingAddress: z.string().trim().max(1000).optional(),
  contactName: z.string().trim().max(160).optional(),
  contactEmail: z.string().trim().max(320).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("invoicing.clients.create", request);
  const startedAt = Date.now();

  try {
    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = createInvoicingClientSchema.safeParse(payloadBody.data);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid client payload" }, { status: 400 });
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

    const { data, error } = await supabase
      .from("invoicing_clients")
      .insert({
        workspace_id: parsed.data.workspaceId,
        name: parsed.data.name,
        client_kind: parsed.data.clientKind ?? "public_agency",
        billing_address: parsed.data.billingAddress?.trim() || null,
        contact_name: parsed.data.contactName?.trim() || null,
        contact_email: parsed.data.contactEmail?.trim() || null,
        notes: parsed.data.notes?.trim() || null,
        created_by: user.id,
      })
      .select(CLIENT_SELECT)
      .single();

    if (error) {
      audit.error("invoicing_client_insert_failed", {
        message: error.message,
        code: error.code ?? null,
        workspaceId: parsed.data.workspaceId,
      });
      return NextResponse.json({ error: "Failed to create client", details: error.message }, { status: 500 });
    }

    audit.info("invoicing_client_created", {
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ client: data }, { status: 201 });
  } catch (error) {
    audit.error("invoicing_client_create_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while creating client" }, { status: 500 });
  }
}
