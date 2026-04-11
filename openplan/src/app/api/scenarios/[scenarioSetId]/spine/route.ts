import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadScenarioSetAccess, looksLikePendingScenarioSpineSchema } from "@/lib/scenarios/api";

const paramsSchema = z.object({
  scenarioSetId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ scenarioSetId: string }>;
};

type ScenarioEntryRow = {
  id: string;
  scenario_set_id: string;
  entry_type: string;
  label: string;
  slug: string;
  summary: string | null;
  assumptions_json: Record<string, unknown> | null;
  attached_run_id: string | null;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function summarizeEntry(entry: ScenarioEntryRow | null) {
  if (!entry) return null;

  return {
    id: entry.id,
    label: entry.label,
    summary: entry.summary,
    status: entry.status,
    attachedRunId: entry.attached_run_id,
    assumptionCount: Object.keys(entry.assumptions_json ?? {}).length,
  };
}

function schemaPendingResponse(scenarioSet: unknown, entries: ScenarioEntryRow[], baselineEntry: ScenarioEntryRow | null) {
  return NextResponse.json(
    {
      scenarioSet,
      baseline: summarizeEntry(baselineEntry),
      branches: entries.filter((entry) => entry.entry_type !== "baseline").map(summarizeEntry),
      counts: {
        assumptionSets: 0,
        dataPackages: 0,
        indicatorSnapshots: 0,
        comparisonSnapshots: 0,
      },
      assumptionSets: [],
      dataPackages: [],
      indicatorSnapshots: [],
      comparisonSnapshots: [],
      schemaPending: true,
    },
    { status: 200 }
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("scenarios.spine.summary", request);
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
      return NextResponse.json({ error: "Failed to verify scenario set access" }, { status: 500 });
    }

    if (!access.scenarioSet) {
      return NextResponse.json({ error: "Scenario set not found" }, { status: 404 });
    }

    if (!access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
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

    const scenarioEntries = (entries ?? []) as ScenarioEntryRow[];
    const baselineEntry =
      scenarioEntries.find((entry) => entry.id === access.scenarioSet?.baseline_entry_id) ??
      scenarioEntries.find((entry) => entry.entry_type === "baseline") ??
      null;
    const branchEntries = scenarioEntries.filter((entry) => entry.entry_type !== "baseline");

    const [assumptionSetsResult, dataPackagesResult, indicatorSnapshotsResult, comparisonSnapshotsResult] = await Promise.all([
      supabase
        .from("scenario_assumption_sets")
        .select("id, scenario_set_id, scenario_entry_id, label, summary, assumptions_json, status, created_at, updated_at")
        .eq("scenario_set_id", access.scenarioSet.id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("scenario_data_packages")
        .select(
          "id, scenario_set_id, scenario_entry_id, label, package_type, source_url, storage_path, metadata_json, status, created_at, updated_at"
        )
        .eq("scenario_set_id", access.scenarioSet.id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("scenario_indicator_snapshots")
        .select(
          "id, scenario_set_id, scenario_entry_id, indicator_key, indicator_label, value_json, unit_label, geography_label, source_label, snapshot_at, metadata_json, created_at, updated_at"
        )
        .eq("scenario_set_id", access.scenarioSet.id)
        .order("snapshot_at", { ascending: false }),
      supabase
        .from("scenario_comparison_snapshots")
        .select(
          "id, scenario_set_id, baseline_entry_id, candidate_entry_id, assumption_set_id, data_package_id, label, summary, narrative, caveats_json, metadata_json, status, created_at, updated_at"
        )
        .eq("scenario_set_id", access.scenarioSet.id)
        .order("updated_at", { ascending: false }),
    ]);

    const pendingSchemaError = [
      assumptionSetsResult.error,
      dataPackagesResult.error,
      indicatorSnapshotsResult.error,
      comparisonSnapshotsResult.error,
    ].find((error) => looksLikePendingScenarioSpineSchema(error?.message));

    if (pendingSchemaError) {
      audit.warn("scenario_spine_schema_pending", {
        scenarioSetId: access.scenarioSet.id,
        message: pendingSchemaError.message,
        code: pendingSchemaError.code ?? null,
      });
      return schemaPendingResponse(access.scenarioSet, scenarioEntries, baselineEntry);
    }

    const spineError =
      assumptionSetsResult.error ??
      dataPackagesResult.error ??
      indicatorSnapshotsResult.error ??
      comparisonSnapshotsResult.error;
    if (spineError) {
      audit.error("scenario_spine_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: spineError.message,
        code: spineError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load scenario spine" }, { status: 500 });
    }

    const assumptionSets = assumptionSetsResult.data ?? [];
    const dataPackages = dataPackagesResult.data ?? [];
    const indicatorSnapshots = indicatorSnapshotsResult.data ?? [];
    const comparisonSnapshots = comparisonSnapshotsResult.data ?? [];

    return NextResponse.json(
      {
        scenarioSet: access.scenarioSet,
        baseline: summarizeEntry(baselineEntry),
        branches: branchEntries.map(summarizeEntry),
        counts: {
          assumptionSets: assumptionSets.length,
          dataPackages: dataPackages.length,
          indicatorSnapshots: indicatorSnapshots.length,
          comparisonSnapshots: comparisonSnapshots.length,
        },
        assumptionSets,
        dataPackages,
        indicatorSnapshots,
        comparisonSnapshots,
        schemaPending: false,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("scenario_spine_summary_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading scenario spine" }, { status: 500 });
  }
}
