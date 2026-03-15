import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { SCENARIO_ENTRY_STATUSES, SCENARIO_ENTRY_TYPES, makeScenarioEntrySlug } from "@/lib/scenarios/catalog";
import { loadScenarioSetAccess, validateRunAccess } from "@/lib/scenarios/api";

const paramsSchema = z.object({
  scenarioSetId: z.string().uuid(),
});

const createScenarioEntrySchema = z.object({
  entryType: z.enum(SCENARIO_ENTRY_TYPES),
  label: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(2000).optional(),
  attachedRunId: z.string().uuid().optional(),
  assumptions: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(SCENARIO_ENTRY_STATUSES).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

const DUPLICATE_KEY_CODE = "23505";

type RouteContext = {
  params: Promise<{ scenarioSetId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("scenarios.entries.create", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid scenario set id" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = createScenarioEntrySchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid scenario entry payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadScenarioSetAccess(supabase, parsedParams.data.scenarioSetId, user.id, "scenarios.write");

    if (access.error) {
      audit.error("scenario_set_access_failed", {
        scenarioSetId: parsedParams.data.scenarioSetId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify scenario set access" }, { status: 500 });
    }

    if (!access.scenarioSet) {
      return NextResponse.json({ error: "Scenario set not found" }, { status: 404 });
    }

    if (!access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    if (parsed.data.entryType === "baseline" && access.scenarioSet.baseline_entry_id) {
      return NextResponse.json({ error: "This scenario set already has a baseline entry" }, { status: 400 });
    }

    const { run, error: runError } = await validateRunAccess(
      supabase,
      access.scenarioSet.workspace_id,
      parsed.data.attachedRunId
    );

    if (runError) {
      audit.error("scenario_entry_run_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        runId: parsed.data.attachedRunId ?? null,
        message: runError.message,
        code: runError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify attached run" }, { status: 500 });
    }

    if (parsed.data.attachedRunId && !run) {
      return NextResponse.json({ error: "Attached run is invalid for this workspace" }, { status: 400 });
    }

    const { data: entry, error: insertError } = await supabase
      .from("scenario_entries")
      .insert({
        scenario_set_id: access.scenarioSet.id,
        entry_type: parsed.data.entryType,
        label: parsed.data.label.trim(),
        slug: makeScenarioEntrySlug(parsed.data.label),
        summary: parsed.data.summary?.trim() || null,
        assumptions_json: parsed.data.assumptions ?? {},
        attached_run_id: parsed.data.attachedRunId ?? null,
        status: parsed.data.status ?? "draft",
        sort_order: parsed.data.sortOrder ?? 0,
        created_by: user.id,
      })
      .select(
        "id, scenario_set_id, entry_type, label, slug, summary, assumptions_json, attached_run_id, status, sort_order, created_at, updated_at"
      )
      .single();

    if (insertError || !entry) {
      if (insertError?.code === DUPLICATE_KEY_CODE && parsed.data.entryType === "baseline") {
        return NextResponse.json({ error: "This scenario set already has a baseline entry" }, { status: 409 });
      }

      audit.error("scenario_entry_insert_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: insertError?.message ?? "unknown",
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create scenario entry" }, { status: 500 });
    }

    audit.info("scenario_entry_created", {
      userId: user.id,
      scenarioSetId: access.scenarioSet.id,
      entryId: entry.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ entryId: entry.id, entry }, { status: 201 });
  } catch (error) {
    audit.error("scenario_entries_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while creating scenario entry" }, { status: 500 });
  }
}
