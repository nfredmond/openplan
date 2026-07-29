import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";

const RATE_TABLE_SELECT =
  "id, workspace_id, name, engagement_id, effective_date, notes, created_by, created_at, updated_at";
const RATE_ENTRY_SELECT = "id, rate_table_id, labor_category, hourly_rate";

const paramsSchema = z.object({
  rateTableId: z.string().uuid(),
});

const rateEntryInputSchema = z.object({
  laborCategory: z.string().trim().min(1).max(120),
  // Upper bound mirrors the column (hourly_rate NUMERIC(10, 2), max < 10^8):
  // an over-cap rate must fail validation here, never at the DB insert —
  // especially in this route, where the replacement delete has already run
  // by the time an insert can fail.
  hourlyRate: z.coerce.number().min(0).max(99_999_999.99),
});

const patchRateTableSchema = z
  .object({
    workspaceId: z.string().uuid(),
    name: z.string().trim().min(1).max(160).optional(),
    engagementId: z.union([z.string().uuid(), z.null()]).optional(),
    effectiveDate: z.union([z.string().trim().max(30), z.null()]).optional(),
    notes: z.union([z.string().trim().max(4000), z.null()]).optional(),
    /** When present, REPLACES the table's whole entry set (may be empty). */
    entries: z.array(rateEntryInputSchema).max(200).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.engagementId !== undefined ||
      value.effectiveDate !== undefined ||
      value.notes !== undefined ||
      value.entries !== undefined,
    { message: "At least one rate table patch field is required", path: ["name"] }
  );

function hasDuplicateCategories(entries: { laborCategory: string }[]): boolean {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = entry.laborCategory.toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

type RouteContext = {
  params: Promise<{ rateTableId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("invoicing.rate_tables.patch", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid rate table id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = patchRateTableSchema.safeParse(payloadBody.data);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid rate table patch payload" }, { status: 400 });
    }

    if (parsed.data.entries && hasDuplicateCategories(parsed.data.entries)) {
      audit.warn("duplicate_labor_categories", { workspaceId: parsed.data.workspaceId });
      return NextResponse.json({ error: "Labor categories must be unique within a rate table" }, { status: 400 });
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

    const { data: rateTable, error: rateTableError } = await supabase
      .from("invoicing_rate_tables")
      .select("id, workspace_id")
      .eq("id", parsedParams.data.rateTableId)
      .single();

    if (rateTableError || !rateTable || rateTable.workspace_id !== parsed.data.workspaceId) {
      audit.warn("rate_table_workspace_mismatch", {
        rateTableId: parsedParams.data.rateTableId,
        workspaceId: parsed.data.workspaceId,
        message: rateTableError?.message ?? null,
      });
      return NextResponse.json({ error: "Rate table is not available in the requested workspace" }, { status: 404 });
    }

    if (parsed.data.engagementId) {
      const { data: engagement, error: engagementError } = await supabase
        .from("invoicing_engagements")
        .select("id, workspace_id")
        .eq("id", parsed.data.engagementId)
        .single();

      if (engagementError || !engagement || engagement.workspace_id !== parsed.data.workspaceId) {
        audit.warn("engagement_workspace_mismatch", {
          workspaceId: parsed.data.workspaceId,
          engagementId: parsed.data.engagementId,
          message: engagementError?.message ?? null,
        });
        return NextResponse.json({ error: "Engagement is not available in the requested workspace" }, { status: 400 });
      }
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) update.name = parsed.data.name;
    if (parsed.data.engagementId !== undefined) update.engagement_id = parsed.data.engagementId;
    if (parsed.data.effectiveDate !== undefined) {
      update.effective_date = parsed.data.effectiveDate === null ? null : parsed.data.effectiveDate.trim() || null;
    }
    if (parsed.data.notes !== undefined) {
      update.notes = parsed.data.notes === null ? null : parsed.data.notes.trim() || null;
    }

    let updatedTable = null as Record<string, unknown> | null;
    if (Object.keys(update).length > 0) {
      const { data, error } = await supabase
        .from("invoicing_rate_tables")
        .update(update)
        .eq("id", rateTable.id)
        .select(RATE_TABLE_SELECT)
        .single();

      if (isWriteFailure(error)) {
        audit.error("invoicing_rate_table_update_failed", {
          rateTableId: rateTable.id,
          workspaceId: parsed.data.workspaceId,
          message: error?.message ?? "invoicing_rate_table_update_returned_no_row",
        });
        return NextResponse.json({ error: "Failed to update rate table" }, { status: 500 });
      }

      if (writeMatchedNoRows({ data, error })) {
        // The rate table was read back through the caller's own client above and
        // cleared the membership and role checks, so an update that changes
        // nothing is the database refusing a write the application had allowed.
        // Returning here also leaves the entry set untouched — a table whose
        // header could not be saved must not have its entries replaced.
        audit.error("invoicing_rate_table_update_matched_no_rows", {
          rateTableId: rateTable.id,
          workspaceId: parsed.data.workspaceId,
          userId: user.id,
        });
        return noRowsMatchedResponse({ subject: "rate table", targetWasVerified: true });
      }
      updatedTable = data as Record<string, unknown>;
    } else {
      const { data, error } = await supabase
        .from("invoicing_rate_tables")
        .select(RATE_TABLE_SELECT)
        .eq("id", rateTable.id)
        .single();

      if (error || !data) {
        audit.error("invoicing_rate_table_reload_failed", {
          rateTableId: rateTable.id,
          message: error?.message ?? null,
        });
        return NextResponse.json({ error: "Failed to load rate table" }, { status: 500 });
      }
      updatedTable = data as Record<string, unknown>;
    }

    // Entry replacement: the payload's entry set is authoritative — snapshot
    // the current set, delete it, insert the new one. This is why rate entries
    // (alone among the rate tables) carry a DELETE policy. Supabase offers no
    // client-side transaction, so the replacement is COMPENSATING, following
    // replaceLinkSet (src/lib/api/link-replacement.ts): if the insert fails,
    // the snapshot is re-inserted so a rejected payload cannot destroy the
    // table's previous entries.
    let entries: unknown[] | undefined;
    if (parsed.data.entries !== undefined) {
      const { data: previousEntries, error: snapshotError } = await supabase
        .from("invoicing_rate_entries")
        .select("labor_category, hourly_rate")
        .eq("rate_table_id", rateTable.id);

      if (snapshotError) {
        audit.error("invoicing_rate_entries_snapshot_failed", {
          rateTableId: rateTable.id,
          message: snapshotError.message,
        });
        return NextResponse.json(
          { error: "Failed to load the current rate table entries; nothing was changed" },
          { status: 500 }
        );
      }

      const snapshot = (previousEntries ?? []) as { labor_category: string; hourly_rate: number }[];

      const { error: deleteError } = await supabase
        .from("invoicing_rate_entries")
        .delete()
        .eq("rate_table_id", rateTable.id);

      if (deleteError) {
        audit.error("invoicing_rate_entries_delete_failed", {
          rateTableId: rateTable.id,
          message: deleteError.message,
        });
        return NextResponse.json({ error: "Failed to replace rate table entries" }, { status: 500 });
      }

      entries = [];
      if (parsed.data.entries.length > 0) {
        const { data: insertedEntries, error: insertError } = await supabase
          .from("invoicing_rate_entries")
          .insert(
            parsed.data.entries.map((entry) => ({
              rate_table_id: rateTable.id,
              labor_category: entry.laborCategory,
              hourly_rate: entry.hourlyRate,
            }))
          )
          .select(RATE_ENTRY_SELECT);

        if (insertError) {
          // Compensate: put the previous entry set back before answering.
          let restoreFailed = false;
          if (snapshot.length > 0) {
            const { error: restoreError } = await supabase.from("invoicing_rate_entries").insert(
              snapshot.map((entry) => ({
                rate_table_id: rateTable.id,
                labor_category: entry.labor_category,
                hourly_rate: entry.hourly_rate,
              }))
            );
            restoreFailed = restoreError !== null;
          }

          audit.error("invoicing_rate_entries_insert_failed", {
            rateTableId: rateTable.id,
            message: insertError.message,
            code: insertError.code ?? null,
            rollbackRestored: !restoreFailed,
          });
          return NextResponse.json(
            {
              error: restoreFailed
                ? "Failed to replace rate table entries, and restoring the previous entries also failed."
                : "Failed to replace rate table entries. The previous entries were restored.",
            },
            { status: 500 }
          );
        }
        entries = insertedEntries ?? [];
      }
    } else {
      const { data: existingEntries, error: entriesError } = await supabase
        .from("invoicing_rate_entries")
        .select(RATE_ENTRY_SELECT)
        .eq("rate_table_id", rateTable.id);

      if (entriesError) {
        audit.error("invoicing_rate_entries_load_failed", {
          rateTableId: rateTable.id,
          message: entriesError.message,
        });
        return NextResponse.json({ error: "Failed to load rate table entries" }, { status: 500 });
      }
      entries = existingEntries ?? [];
    }

    audit.info("invoicing_rate_table_updated", {
      rateTableId: rateTable.id,
      workspaceId: parsed.data.workspaceId,
      entriesReplaced: parsed.data.entries !== undefined,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ rateTable: { ...updatedTable, entries } });
  } catch (error) {
    audit.error("invoicing_rate_table_patch_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while updating rate table" }, { status: 500 });
  }
}
