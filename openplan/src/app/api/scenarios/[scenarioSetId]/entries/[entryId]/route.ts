import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  markScenarioLinkedReportsBasisStale,
  type ScenarioReportWritebackSupabaseLike,
} from "@/lib/reports/scenario-writeback";
import { SCENARIO_ENTRY_STATUSES, SCENARIO_ENTRY_TYPES, makeScenarioEntrySlug } from "@/lib/scenarios/catalog";
import { loadScenarioSetAccess, validateRunAccess } from "@/lib/scenarios/api";

const paramsSchema = z.object({
  scenarioSetId: z.string().uuid(),
  entryId: z.string().uuid(),
});

const patchScenarioEntrySchema = z
  .object({
    entryType: z.enum(SCENARIO_ENTRY_TYPES).optional(),
    label: z.string().trim().min(1).max(160).optional(),
    summary: z.union([z.string().trim().max(2000), z.null()]).optional(),
    attachedRunId: z.union([z.string().uuid(), z.null()]).optional(),
    assumptions: z.union([z.record(z.string(), z.unknown()), z.null()]).optional(),
    status: z.enum(SCENARIO_ENTRY_STATUSES).optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field must be updated",
  });

const DUPLICATE_KEY_CODE = "23505";

type RouteContext = {
  params: Promise<{ scenarioSetId: string; entryId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("scenarios.entries.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid scenario entry route params" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = patchScenarioEntrySchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid scenario entry update payload" }, { status: 400 });
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

    const { data: existingEntry, error: entryLookupError } = await supabase
      .from("scenario_entries")
      .select("id, scenario_set_id, entry_type, label, attached_run_id")
      .eq("id", parsedParams.data.entryId)
      .eq("scenario_set_id", access.scenarioSet.id)
      .maybeSingle();

    if (entryLookupError) {
      audit.error("scenario_entry_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        entryId: parsedParams.data.entryId,
        message: entryLookupError.message,
        code: entryLookupError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load scenario entry" }, { status: 500 });
    }

    if (!existingEntry) {
      return NextResponse.json({ error: "Scenario entry not found" }, { status: 404 });
    }

    const nextEntryType = parsed.data.entryType ?? existingEntry.entry_type;
    if (
      nextEntryType === "baseline" &&
      access.scenarioSet.baseline_entry_id &&
      access.scenarioSet.baseline_entry_id !== existingEntry.id
    ) {
      return NextResponse.json({ error: "This scenario set already has a baseline entry" }, { status: 400 });
    }

    const nextRunId = parsed.data.attachedRunId === undefined ? existingEntry.attached_run_id : parsed.data.attachedRunId;
    const { run, error: runError } = await validateRunAccess(supabase, access.scenarioSet.workspace_id, nextRunId);

    if (runError) {
      audit.error("scenario_entry_run_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        entryId: existingEntry.id,
        runId: nextRunId,
        message: runError.message,
        code: runError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify attached run" }, { status: 500 });
    }

    if (nextRunId && !run) {
      return NextResponse.json({ error: "Attached run is invalid for this workspace" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.entryType !== undefined) {
      updates.entry_type = parsed.data.entryType;
    }
    if (parsed.data.label !== undefined) {
      updates.label = parsed.data.label;
      updates.slug = makeScenarioEntrySlug(parsed.data.label);
    }
    if (parsed.data.summary !== undefined) {
      updates.summary = parsed.data.summary;
    }
    if (parsed.data.attachedRunId !== undefined) {
      updates.attached_run_id = parsed.data.attachedRunId;
    }
    if (parsed.data.assumptions !== undefined) {
      updates.assumptions_json = parsed.data.assumptions ?? {};
    }
    if (parsed.data.status !== undefined) {
      updates.status = parsed.data.status;
    }
    if (parsed.data.sortOrder !== undefined) {
      updates.sort_order = parsed.data.sortOrder;
    }

    const { error: updateError } = await supabase.from("scenario_entries").update(updates).eq("id", existingEntry.id);

    if (updateError) {
      if (updateError.code === DUPLICATE_KEY_CODE && nextEntryType === "baseline") {
        return NextResponse.json({ error: "This scenario set already has a baseline entry" }, { status: 409 });
      }

      audit.error("scenario_entry_update_failed", {
        scenarioSetId: access.scenarioSet.id,
        entryId: existingEntry.id,
        message: updateError.message,
        code: updateError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update scenario entry" }, { status: 500 });
    }

    const staleWriteback = await markScenarioLinkedReportsBasisStale({
      supabase: supabase as unknown as ScenarioReportWritebackSupabaseLike,
      scenarioSetId: access.scenarioSet.id,
      workspaceId: access.scenarioSet.workspace_id,
      runId: null,
      reason: `Scenario entry ${String(parsed.data.label ?? existingEntry.label)} changed the linked RTP packet basis.`,
    });

    if (staleWriteback.error) {
      audit.warn("scenario_entry_report_basis_stale_failed", {
        scenarioSetId: access.scenarioSet.id,
        entryId: existingEntry.id,
        message: staleWriteback.error.message,
        code: staleWriteback.error.code ?? null,
      });
    }

    audit.info("scenario_entry_updated", {
      userId: user.id,
      scenarioSetId: access.scenarioSet.id,
      entryId: existingEntry.id,
      staleReportCount: staleWriteback.staleReportIds.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ success: true, entryId: existingEntry.id }, { status: 200 });
  } catch (error) {
    audit.error("scenario_entries_patch_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while updating scenario entry" }, { status: 500 });
  }
}
