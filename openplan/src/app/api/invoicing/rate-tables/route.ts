import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const RATE_TABLE_SELECT =
  "id, workspace_id, name, engagement_id, effective_date, notes, created_by, created_at, updated_at";
const RATE_ENTRY_SELECT = "id, rate_table_id, labor_category, hourly_rate";

const listRateTablesQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

const rateEntryInputSchema = z.object({
  laborCategory: z.string().trim().min(1).max(120),
  // Upper bound mirrors the column (hourly_rate NUMERIC(10, 2), max < 10^8):
  // an over-cap rate must fail validation here, never at the DB insert.
  hourlyRate: z.coerce.number().min(0).max(99_999_999.99),
});

const createRateTableSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  engagementId: z.string().uuid().optional(),
  effectiveDate: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(4000).optional(),
  entries: z.array(rateEntryInputSchema).max(200).optional(),
});

function hasDuplicateCategories(entries: { laborCategory: string }[]): boolean {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = entry.laborCategory.toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("invoicing.rate_tables.list", request);
  const startedAt = Date.now();

  try {
    const parsed = listRateTablesQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid rate table query" }, { status: 400 });
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

    if (!canAccessWorkspaceAction("invoices.read", membership.role)) {
      audit.warn("forbidden", { workspaceId: parsed.data.workspaceId, userId: user.id, role: membership.role });
      return NextResponse.json({ error: "Workspace role cannot read invoicing records" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("invoicing_rate_tables")
      .select(`${RATE_TABLE_SELECT}, invoicing_rate_entries(${RATE_ENTRY_SELECT})`)
      .eq("workspace_id", parsed.data.workspaceId)
      .order("updated_at", { ascending: false });

    if (error) {
      audit.error("invoicing_rate_tables_list_failed", {
        message: error.message,
        workspaceId: parsed.data.workspaceId,
      });
      return NextResponse.json({ error: "Failed to load rate tables" }, { status: 500 });
    }

    return NextResponse.json({ rateTables: data ?? [] });
  } catch (error) {
    audit.error("invoicing_rate_tables_list_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while loading rate tables" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("invoicing.rate_tables.create", request);
  const startedAt = Date.now();

  try {
    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = createRateTableSchema.safeParse(payloadBody.data);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid rate table payload" }, { status: 400 });
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

    const { data: rateTable, error } = await supabase
      .from("invoicing_rate_tables")
      .insert({
        workspace_id: parsed.data.workspaceId,
        name: parsed.data.name,
        engagement_id: parsed.data.engagementId ?? null,
        effective_date: parsed.data.effectiveDate?.trim() || null,
        notes: parsed.data.notes?.trim() || null,
        created_by: user.id,
      })
      .select(RATE_TABLE_SELECT)
      .single();

    if (error || !rateTable) {
      audit.error("invoicing_rate_table_insert_failed", {
        message: error?.message ?? "invoicing_rate_table_insert_returned_no_row",
        workspaceId: parsed.data.workspaceId,
      });
      return NextResponse.json({ error: "Failed to create rate table" }, { status: 500 });
    }

    let entries: unknown[] = [];
    if (parsed.data.entries && parsed.data.entries.length > 0) {
      const { data: insertedEntries, error: entriesError } = await supabase
        .from("invoicing_rate_entries")
        .insert(
          parsed.data.entries.map((entry) => ({
            rate_table_id: rateTable.id,
            labor_category: entry.laborCategory,
            hourly_rate: entry.hourlyRate,
          }))
        )
        .select(RATE_ENTRY_SELECT);

      if (entriesError) {
        audit.error("invoicing_rate_entries_insert_failed", {
          message: entriesError.message,
          rateTableId: rateTable.id,
          workspaceId: parsed.data.workspaceId,
        });
        return NextResponse.json({ error: "Failed to create rate table entries" }, { status: 500 });
      }

      entries = insertedEntries ?? [];
    }

    audit.info("invoicing_rate_table_created", {
      rateTableId: rateTable.id,
      workspaceId: parsed.data.workspaceId,
      entryCount: entries.length,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ rateTable: { ...rateTable, entries } }, { status: 201 });
  } catch (error) {
    audit.error("invoicing_rate_table_create_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while creating rate table" }, { status: 500 });
  }
}
