import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { SCENARIO_SET_STATUSES, scenarioComparisonStatus } from "@/lib/scenarios/catalog";
import { loadScenarioSetAccess } from "@/lib/scenarios/api";

const paramsSchema = z.object({
  scenarioSetId: z.string().uuid(),
});

const patchScenarioSetSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    summary: z.union([z.string().trim().max(2000), z.null()]).optional(),
    planningQuestion: z.union([z.string().trim().max(4000), z.null()]).optional(),
    status: z.enum(SCENARIO_SET_STATUSES).optional(),
    baselineEntryId: z.union([z.string().uuid(), z.null()]).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field must be updated",
  });

type RouteContext = {
  params: Promise<{ scenarioSetId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("scenarios.detail", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid scenario set id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadScenarioSetAccess(supabase, parsedParams.data.scenarioSetId, user.id, "scenarios.read");

    if (access.error) {
      audit.error("scenario_set_access_failed", {
        scenarioSetId: parsedParams.data.scenarioSetId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load scenario set" }, { status: 500 });
    }

    if (!access.scenarioSet) {
      return NextResponse.json({ error: "Scenario set not found" }, { status: 404 });
    }

    if (!access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
      .eq("id", access.scenarioSet.project_id)
      .maybeSingle();

    if (projectError) {
      audit.error("scenario_set_project_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: projectError.message,
        code: projectError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load linked project" }, { status: 500 });
    }

    const { data: entries, error: entriesError } = await supabase
      .from("scenario_entries")
      .select(
        "id, scenario_set_id, entry_type, label, slug, summary, assumptions_json, attached_run_id, status, sort_order, created_at, updated_at"
      )
      .eq("scenario_set_id", access.scenarioSet.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (entriesError) {
      audit.error("scenario_entries_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: entriesError.message,
        code: entriesError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load scenario entries" }, { status: 500 });
    }

    const runIds = (entries ?? [])
      .map((entry) => entry.attached_run_id)
      .filter((value): value is string => Boolean(value));

    const runsResult = runIds.length
      ? await supabase
          .from("runs")
          .select("id, workspace_id, title, summary_text, created_at")
          .in("id", runIds)
      : { data: [], error: null };

    if (runsResult.error) {
      audit.error("scenario_runs_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: runsResult.error.message,
        code: runsResult.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load attached runs" }, { status: 500 });
    }

    const runMap = new Map((runsResult.data ?? []).map((run) => [run.id, run]));
    const hydratedEntries = (entries ?? []).map((entry) => ({
      ...entry,
      attached_run: entry.attached_run_id ? runMap.get(entry.attached_run_id) ?? null : null,
    }));
    const baselineEntry =
      hydratedEntries.find((entry) => entry.id === access.scenarioSet?.baseline_entry_id) ??
      hydratedEntries.find((entry) => entry.entry_type === "baseline") ??
      null;
    const alternativeEntries = hydratedEntries.filter((entry) => entry.entry_type !== "baseline");

    return NextResponse.json(
      {
        scenarioSet: access.scenarioSet,
        project,
        entries: hydratedEntries,
        baselineEntry,
        alternativeEntries,
        comparisons: alternativeEntries.map((entry) => ({
          scenarioEntryId: entry.id,
          baselineEntryId: baselineEntry?.id ?? null,
          comparisonStatus: scenarioComparisonStatus(baselineEntry?.attached_run_id, entry.attached_run_id),
          baselineRunId: baselineEntry?.attached_run_id ?? null,
          candidateRunId: entry.attached_run_id ?? null,
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("scenarios_detail_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading scenario set" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("scenarios.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid scenario set id" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = patchScenarioSetSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid scenario set update payload" }, { status: 400 });
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

    if (parsed.data.baselineEntryId) {
      const { data: baselineEntry, error: baselineError } = await supabase
        .from("scenario_entries")
        .select("id, scenario_set_id, entry_type")
        .eq("id", parsed.data.baselineEntryId)
        .eq("scenario_set_id", access.scenarioSet.id)
        .maybeSingle();

      if (baselineError) {
        audit.error("baseline_entry_lookup_failed", {
          scenarioSetId: access.scenarioSet.id,
          entryId: parsed.data.baselineEntryId,
          message: baselineError.message,
          code: baselineError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify baseline entry" }, { status: 500 });
      }

      if (!baselineEntry || baselineEntry.entry_type !== "baseline") {
        return NextResponse.json({ error: "Baseline entry must be a baseline in this scenario set" }, { status: 400 });
      }
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) {
      updates.title = parsed.data.title;
    }
    if (parsed.data.summary !== undefined) {
      updates.summary = parsed.data.summary;
    }
    if (parsed.data.planningQuestion !== undefined) {
      updates.planning_question = parsed.data.planningQuestion;
    }
    if (parsed.data.status !== undefined) {
      updates.status = parsed.data.status;
    }
    if (parsed.data.baselineEntryId !== undefined) {
      updates.baseline_entry_id = parsed.data.baselineEntryId;
    }

    const { error: updateError } = await supabase.from("scenario_sets").update(updates).eq("id", access.scenarioSet.id);

    if (updateError) {
      audit.error("scenario_set_update_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: updateError.message,
        code: updateError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update scenario set" }, { status: 500 });
    }

    audit.info("scenario_set_updated", {
      userId: user.id,
      scenarioSetId: access.scenarioSet.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ success: true, scenarioSetId: access.scenarioSet.id }, { status: 200 });
  } catch (error) {
    audit.error("scenarios_patch_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while updating scenario set" }, { status: 500 });
  }
}
