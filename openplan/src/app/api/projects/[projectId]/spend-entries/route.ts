import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";

/**
 * Project spend ledger — direct costs (subconsultant charges, expenses)
 * recorded against a project, optionally attributed to one of the project's
 * OWN deliverables. The schema's deliverable_id FK cannot enforce that the
 * deliverable belongs to the same project, so this route closes that
 * integrity gap: any deliverableId that resolves to another project is
 * refused before it can pollute another project's burn math.
 *
 * DELETE is allowed by design — a ledger row is a bookkeeping entry and
 * correcting a mistake is legitimate (unlike invoices, which are voided).
 */

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

// NUMERIC(14,2); entry_date is a plain DATE string.
const amountSchema = z.number().min(0).max(999_999_999_999.99);
const entryDateSchema = z.string().trim().min(1).max(30);

const createSpendEntrySchema = z.object({
  amount: amountSchema,
  description: z.string().trim().min(1).max(2000),
  entryDate: entryDateSchema.optional(),
  vendorLabel: z.string().trim().max(160).optional(),
  deliverableId: z.string().uuid().optional(),
});

const updateSpendEntrySchema = z
  .object({
    entryId: z.string().uuid(),
    amount: amountSchema.optional(),
    description: z.string().trim().min(1).max(2000).optional(),
    entryDate: entryDateSchema.optional(),
    vendorLabel: z.string().trim().max(160).nullable().optional(),
    deliverableId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (value) =>
      value.amount !== undefined ||
      value.description !== undefined ||
      value.entryDate !== undefined ||
      value.vendorLabel !== undefined ||
      value.deliverableId !== undefined,
    { message: "Nothing to update" }
  );

const SPEND_ENTRY_SELECT =
  "id, project_id, deliverable_id, entry_date, amount, description, vendor_label, created_by, created_at, updated_at";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

type ProjectAccess =
  | { ok: true; supabase: SupabaseLike; userId: string; project: { id: string; workspace_id: string } }
  | { ok: false; response: NextResponse };

/** Shared gate: auth → project (RLS-scoped) → membership → invoices.write. */
async function loadSpendEntryAccess(
  projectId: string,
  audit: ReturnType<typeof createApiAuditLogger>
): Promise<ProjectAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    audit.warn("unauthorized", { projectId });
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, workspace_id")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    audit.error("project_lookup_failed", { projectId, message: projectError.message });
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 }),
    };
  }
  if (!project) {
    return { ok: false, response: NextResponse.json({ error: "Project not found" }, { status: 404 }) };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", project.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    audit.error("membership_lookup_failed", { projectId, message: membershipError.message });
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 }),
    };
  }
  if (!membership || !canAccessWorkspaceAction("invoices.write", membership.role)) {
    audit.warn("forbidden", { projectId, userId: user.id, role: membership?.role ?? null });
    return {
      ok: false,
      response: NextResponse.json({ error: "Owner or admin role required for spend ledger writes" }, { status: 403 }),
    };
  }

  return { ok: true, supabase, userId: user.id, project };
}

/**
 * The integrity check the schema cannot express: a spend entry may only be
 * attributed to a deliverable of ITS OWN project.
 */
async function deliverableBelongsToProject(
  supabase: SupabaseLike,
  deliverableId: string,
  projectId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("project_deliverables")
    .select("id, project_id")
    .eq("id", deliverableId)
    .maybeSingle();

  if (error || !data) return false;
  return (data as { project_id: string }).project_id === projectId;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("projects.spend-entries.create", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsed = createSpendEntrySchema.safeParse(payloadBody.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid spend entry payload" }, { status: 400 });
    }

    const access = await loadSpendEntryAccess(parsedParams.data.projectId, audit);
    if (!access.ok) return access.response;
    const { supabase, userId, project } = access;

    if (parsed.data.deliverableId) {
      const belongs = await deliverableBelongsToProject(supabase, parsed.data.deliverableId, project.id);
      if (!belongs) {
        audit.warn("deliverable_project_mismatch", {
          projectId: project.id,
          deliverableId: parsed.data.deliverableId,
        });
        return NextResponse.json(
          { error: "Deliverable does not belong to this project" },
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabase
      .from("project_spend_entries")
      .insert({
        project_id: project.id,
        deliverable_id: parsed.data.deliverableId ?? null,
        // Omitted → the column's CURRENT_DATE default applies.
        ...(parsed.data.entryDate ? { entry_date: parsed.data.entryDate } : {}),
        amount: parsed.data.amount,
        description: parsed.data.description,
        vendor_label: parsed.data.vendorLabel?.trim() || null,
        created_by: userId,
      })
      .select(SPEND_ENTRY_SELECT)
      .single();

    if (error) {
      audit.error("spend_entry_insert_failed", { projectId: project.id, message: error.message });
      return NextResponse.json({ error: "Failed to record spend entry", details: error.message }, { status: 500 });
    }

    audit.info("spend_entry_created", {
      projectId: project.id,
      userId,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ spendEntry: data }, { status: 201 });
  } catch (error) {
    audit.error("projects_spend_entries_create_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while recording spend entry" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("projects.spend-entries.update", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsed = updateSpendEntrySchema.safeParse(payloadBody.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid spend entry payload" }, { status: 400 });
    }

    const access = await loadSpendEntryAccess(parsedParams.data.projectId, audit);
    if (!access.ok) return access.response;
    const { supabase, userId, project } = access;

    if (typeof parsed.data.deliverableId === "string") {
      const belongs = await deliverableBelongsToProject(supabase, parsed.data.deliverableId, project.id);
      if (!belongs) {
        audit.warn("deliverable_project_mismatch", {
          projectId: project.id,
          deliverableId: parsed.data.deliverableId,
        });
        return NextResponse.json(
          { error: "Deliverable does not belong to this project" },
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabase
      .from("project_spend_entries")
      .update({
        ...(parsed.data.amount !== undefined ? { amount: parsed.data.amount } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.entryDate !== undefined ? { entry_date: parsed.data.entryDate } : {}),
        ...(parsed.data.vendorLabel !== undefined ? { vendor_label: parsed.data.vendorLabel?.trim() || null } : {}),
        ...(parsed.data.deliverableId !== undefined ? { deliverable_id: parsed.data.deliverableId } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", parsed.data.entryId)
      .eq("project_id", project.id)
      .select(SPEND_ENTRY_SELECT)
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      audit.error("spend_entry_update_failed", {
        projectId: project.id,
        entryId: parsed.data.entryId,
        message: error.message,
      });
      return NextResponse.json({ error: "Failed to update spend entry", details: error.message }, { status: 500 });
    }
    // The access gate verified the PROJECT and the caller's role, never this
    // ledger row — entryId comes from the payload and is written straight at.
    if (writeMatchedNoRows({ data, error })) {
      audit.warn("spend_entry_update_matched_no_rows", { projectId: project.id, entryId: parsed.data.entryId });
      return noRowsMatchedResponse({ subject: "spend entry", targetWasVerified: false });
    }

    audit.info("spend_entry_updated", {
      projectId: project.id,
      entryId: parsed.data.entryId,
      userId,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ spendEntry: data });
  } catch (error) {
    audit.error("projects_spend_entries_update_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while updating spend entry" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("projects.spend-entries.delete", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const entryIdParse = z.string().uuid().safeParse(request.nextUrl.searchParams.get("entryId"));
    if (!entryIdParse.success) {
      audit.warn("entry_id_validation_failed", { projectId: parsedParams.data.projectId });
      return NextResponse.json({ error: "Invalid spend entry id" }, { status: 400 });
    }

    const access = await loadSpendEntryAccess(parsedParams.data.projectId, audit);
    if (!access.ok) return access.response;
    const { supabase, userId, project } = access;

    const { data, error } = await supabase
      .from("project_spend_entries")
      .delete()
      .eq("id", entryIdParse.data)
      .eq("project_id", project.id)
      .select("id")
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      audit.error("spend_entry_delete_failed", {
        projectId: project.id,
        entryId: entryIdParse.data,
        message: error.message,
      });
      return NextResponse.json({ error: "Failed to delete spend entry", details: error.message }, { status: 500 });
    }
    if (writeMatchedNoRows({ data, error })) {
      audit.warn("spend_entry_delete_matched_no_rows", { projectId: project.id, entryId: entryIdParse.data });
      return noRowsMatchedResponse({ subject: "spend entry", targetWasVerified: false });
    }

    audit.info("spend_entry_deleted", {
      projectId: project.id,
      entryId: entryIdParse.data,
      userId,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ deleted: true, id: entryIdParse.data });
  } catch (error) {
    audit.error("projects_spend_entries_delete_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while deleting spend entry" }, { status: 500 });
  }
}
