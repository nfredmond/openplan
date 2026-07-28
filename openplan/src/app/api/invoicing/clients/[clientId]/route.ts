import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const CLIENT_SELECT =
  "id, workspace_id, name, client_kind, billing_address, contact_name, contact_email, notes, created_by, created_at, updated_at";

const paramsSchema = z.object({
  clientId: z.string().uuid(),
});

const patchInvoicingClientSchema = z
  .object({
    workspaceId: z.string().uuid(),
    name: z.string().trim().min(1).max(200).optional(),
    clientKind: z
      .enum(["public_agency", "tribal_government", "prime_contractor", "nonprofit", "private", "other"])
      .optional(),
    billingAddress: z.union([z.string().trim().max(1000), z.null()]).optional(),
    contactName: z.union([z.string().trim().max(160), z.null()]).optional(),
    contactEmail: z.union([z.string().trim().max(320), z.null()]).optional(),
    notes: z.union([z.string().trim().max(4000), z.null()]).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.clientKind !== undefined ||
      value.billingAddress !== undefined ||
      value.contactName !== undefined ||
      value.contactEmail !== undefined ||
      value.notes !== undefined,
    { message: "At least one client patch field is required", path: ["name"] }
  );

type RouteContext = {
  params: Promise<{ clientId: string }>;
};

/** A nullable text patch: null clears, a blank string also clears, text stores trimmed. */
function nullableText(value: string | null): string | null {
  return value === null ? null : value.trim() || null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("invoicing.clients.patch", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = patchInvoicingClientSchema.safeParse(payloadBody.data);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid client patch payload" }, { status: 400 });
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
      .eq("id", parsedParams.data.clientId)
      .single();

    if (clientError || !clientRow || clientRow.workspace_id !== parsed.data.workspaceId) {
      audit.warn("client_workspace_mismatch", {
        clientId: parsedParams.data.clientId,
        workspaceId: parsed.data.workspaceId,
        message: clientError?.message ?? null,
      });
      return NextResponse.json({ error: "Client is not available in the requested workspace" }, { status: 404 });
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) update.name = parsed.data.name;
    if (parsed.data.clientKind !== undefined) update.client_kind = parsed.data.clientKind;
    if (parsed.data.billingAddress !== undefined) update.billing_address = nullableText(parsed.data.billingAddress);
    if (parsed.data.contactName !== undefined) update.contact_name = nullableText(parsed.data.contactName);
    if (parsed.data.contactEmail !== undefined) update.contact_email = nullableText(parsed.data.contactEmail);
    if (parsed.data.notes !== undefined) update.notes = nullableText(parsed.data.notes);

    const { data, error } = await supabase
      .from("invoicing_clients")
      .update(update)
      .eq("id", clientRow.id)
      .select(CLIENT_SELECT)
      .single();

    if (error || !data) {
      audit.error("invoicing_client_update_failed", {
        clientId: clientRow.id,
        workspaceId: parsed.data.workspaceId,
        message: error?.message ?? "invoicing_client_update_returned_no_row",
      });
      return NextResponse.json({ error: "Failed to update client" }, { status: 500 });
    }

    audit.info("invoicing_client_updated", {
      clientId: clientRow.id,
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ client: data });
  } catch (error) {
    audit.error("invoicing_client_patch_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while updating client" }, { status: 500 });
  }
}
