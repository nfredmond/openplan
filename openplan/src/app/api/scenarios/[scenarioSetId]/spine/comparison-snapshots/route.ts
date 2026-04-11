import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadScenarioSetAccess, looksLikePendingScenarioSpineSchema } from "@/lib/scenarios/api";
import { SCENARIO_COMPARISON_SNAPSHOT_STATUSES } from "@/lib/scenarios/catalog";

const paramsSchema = z.object({
  scenarioSetId: z.string().uuid(),
});

const indicatorDeltaSchema = z.object({
  baselineIndicatorSnapshotId: z.string().uuid().optional(),
  candidateIndicatorSnapshotId: z.string().uuid().optional(),
  indicatorKey: z.string().trim().min(1).max(120),
  indicatorLabel: z.string().trim().min(1).max(160),
  unitLabel: z.string().trim().max(80).optional(),
  delta: z.record(z.string(), z.unknown()).optional(),
  summary: z.string().trim().max(1000).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

const createComparisonSnapshotSchema = z.object({
  baselineEntryId: z.string().uuid(),
  candidateEntryId: z.string().uuid(),
  assumptionSetId: z.string().uuid().optional(),
  dataPackageId: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(2000).optional(),
  narrative: z.string().trim().max(8000).optional(),
  caveats: z.array(z.string().trim().min(1).max(400)).max(25).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(SCENARIO_COMPARISON_SNAPSHOT_STATUSES).optional(),
  indicatorDeltas: z.array(indicatorDeltaSchema).max(100).optional(),
});

type RouteContext = {
  params: Promise<{ scenarioSetId: string }>;
};

async function loadScenarioEntry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scenarioSetId: string,
  scenarioEntryId: string
) {
  const { data, error } = await supabase
    .from("scenario_entries")
    .select("id, scenario_set_id, entry_type, label")
    .eq("id", scenarioEntryId)
    .eq("scenario_set_id", scenarioSetId)
    .maybeSingle();

  return { entry: data, error };
}

async function loadScenarioAssumptionSet(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scenarioSetId: string,
  assumptionSetId: string | undefined
) {
  if (!assumptionSetId) return { assumptionSet: null, error: null };

  const { data, error } = await supabase
    .from("scenario_assumption_sets")
    .select("id, scenario_set_id")
    .eq("id", assumptionSetId)
    .eq("scenario_set_id", scenarioSetId)
    .maybeSingle();

  return { assumptionSet: data, error };
}

async function loadScenarioDataPackage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scenarioSetId: string,
  dataPackageId: string | undefined
) {
  if (!dataPackageId) return { dataPackage: null, error: null };

  const { data, error } = await supabase
    .from("scenario_data_packages")
    .select("id, scenario_set_id")
    .eq("id", dataPackageId)
    .eq("scenario_set_id", scenarioSetId)
    .maybeSingle();

  return { dataPackage: data, error };
}

async function loadIndicatorSnapshotIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scenarioSetId: string,
  snapshotIds: string[]
) {
  if (!snapshotIds.length) {
    return { snapshotIds: new Set<string>(), error: null };
  }

  const { data, error } = await supabase
    .from("scenario_indicator_snapshots")
    .select("id")
    .eq("scenario_set_id", scenarioSetId)
    .in("id", snapshotIds);

  return {
    snapshotIds: new Set((data ?? []).map((item) => item.id as string)),
    error,
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("scenarios.spine.comparison_snapshots.create", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid scenario set id" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = createComparisonSnapshotSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid comparison snapshot payload" }, { status: 400 });
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

    const [baselineEntryResult, candidateEntryResult, assumptionSetResult, dataPackageResult] = await Promise.all([
      loadScenarioEntry(supabase, access.scenarioSet.id, parsed.data.baselineEntryId),
      loadScenarioEntry(supabase, access.scenarioSet.id, parsed.data.candidateEntryId),
      loadScenarioAssumptionSet(supabase, access.scenarioSet.id, parsed.data.assumptionSetId),
      loadScenarioDataPackage(supabase, access.scenarioSet.id, parsed.data.dataPackageId),
    ]);

    const validationLookupError =
      baselineEntryResult.error ??
      candidateEntryResult.error ??
      assumptionSetResult.error ??
      dataPackageResult.error;

    if (validationLookupError) {
      audit.error("comparison_snapshot_dependency_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: validationLookupError.message,
        code: validationLookupError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify comparison snapshot dependencies" }, { status: 500 });
    }

    if (!baselineEntryResult.entry || baselineEntryResult.entry.entry_type !== "baseline") {
      return NextResponse.json(
        { error: "Baseline entry must be a baseline in this scenario set" },
        { status: 400 }
      );
    }

    if (!candidateEntryResult.entry || candidateEntryResult.entry.entry_type === "baseline") {
      return NextResponse.json(
        { error: "Candidate entry must be an alternative in this scenario set" },
        { status: 400 }
      );
    }

    if (baselineEntryResult.entry.id === candidateEntryResult.entry.id) {
      return NextResponse.json(
        { error: "Baseline and candidate entries must be different" },
        { status: 400 }
      );
    }

    if (parsed.data.assumptionSetId && !assumptionSetResult.assumptionSet) {
      return NextResponse.json(
        { error: "Assumption set must belong to this scenario set" },
        { status: 400 }
      );
    }

    if (parsed.data.dataPackageId && !dataPackageResult.dataPackage) {
      return NextResponse.json(
        { error: "Data package must belong to this scenario set" },
        { status: 400 }
      );
    }

    const indicatorSnapshotIds = Array.from(
      new Set(
        (parsed.data.indicatorDeltas ?? []).flatMap((delta) => [
          delta.baselineIndicatorSnapshotId,
          delta.candidateIndicatorSnapshotId,
        ])
      )
    ).filter((value): value is string => Boolean(value));

    const indicatorSnapshotResult = await loadIndicatorSnapshotIds(
      supabase,
      access.scenarioSet.id,
      indicatorSnapshotIds
    );

    if (indicatorSnapshotResult.error) {
      audit.error("comparison_snapshot_indicator_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: indicatorSnapshotResult.error.message,
        code: indicatorSnapshotResult.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify indicator snapshots" }, { status: 500 });
    }

    const missingIndicatorReference = indicatorSnapshotIds.find(
      (snapshotId) => !indicatorSnapshotResult.snapshotIds.has(snapshotId)
    );
    if (missingIndicatorReference) {
      return NextResponse.json(
        { error: "Indicator snapshots must belong to this scenario set" },
        { status: 400 }
      );
    }

    const { data: comparisonSnapshot, error: insertError } = await supabase
      .from("scenario_comparison_snapshots")
      .insert({
        scenario_set_id: access.scenarioSet.id,
        baseline_entry_id: parsed.data.baselineEntryId,
        candidate_entry_id: parsed.data.candidateEntryId,
        assumption_set_id: parsed.data.assumptionSetId ?? null,
        data_package_id: parsed.data.dataPackageId ?? null,
        label: parsed.data.label.trim(),
        summary: parsed.data.summary?.trim() || null,
        narrative: parsed.data.narrative?.trim() || null,
        caveats_json: parsed.data.caveats ?? [],
        metadata_json: parsed.data.metadata ?? {},
        status: parsed.data.status ?? "draft",
        created_by: user.id,
      })
      .select(
        "id, scenario_set_id, baseline_entry_id, candidate_entry_id, assumption_set_id, data_package_id, label, summary, narrative, caveats_json, metadata_json, status, created_at, updated_at"
      )
      .single();

    if (insertError || !comparisonSnapshot) {
      if (looksLikePendingScenarioSpineSchema(insertError?.message)) {
        return NextResponse.json(
          {
            error: "Scenario comparison schema is not available yet",
            hint: "Apply the latest Supabase migrations for the scenarios module before creating comparison snapshots.",
          },
          { status: 503 }
        );
      }

      audit.error("comparison_snapshot_insert_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: insertError?.message ?? "unknown",
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create comparison snapshot" }, { status: 500 });
    }

    let comparisonIndicatorDeltas: Array<Record<string, unknown>> = [];

    if ((parsed.data.indicatorDeltas?.length ?? 0) > 0) {
      const { data: insertedDeltas, error: deltaInsertError } = await supabase
        .from("scenario_comparison_indicator_deltas")
        .insert(
          (parsed.data.indicatorDeltas ?? []).map((delta, index) => ({
            comparison_snapshot_id: comparisonSnapshot.id,
            indicator_key: delta.indicatorKey.trim(),
            indicator_label: delta.indicatorLabel.trim(),
            unit_label: delta.unitLabel?.trim() || null,
            baseline_indicator_snapshot_id: delta.baselineIndicatorSnapshotId ?? null,
            candidate_indicator_snapshot_id: delta.candidateIndicatorSnapshotId ?? null,
            delta_json: delta.delta ?? {},
            summary_text: delta.summary?.trim() || null,
            sort_order: delta.sortOrder ?? index,
          }))
        )
        .select(
          "id, comparison_snapshot_id, indicator_key, indicator_label, unit_label, baseline_indicator_snapshot_id, candidate_indicator_snapshot_id, delta_json, summary_text, sort_order, created_at, updated_at"
        );

      if (deltaInsertError) {
        if (looksLikePendingScenarioSpineSchema(deltaInsertError.message)) {
          return NextResponse.json(
            {
              error: "Scenario comparison schema is not available yet",
              hint: "Apply the latest Supabase migrations for the scenarios module before creating comparison indicator deltas.",
            },
            { status: 503 }
          );
        }

        audit.error("comparison_indicator_delta_insert_failed", {
          scenarioSetId: access.scenarioSet.id,
          comparisonSnapshotId: comparisonSnapshot.id,
          message: deltaInsertError.message,
          code: deltaInsertError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to create comparison indicator deltas" }, { status: 500 });
      }

      comparisonIndicatorDeltas = (insertedDeltas ?? []) as Array<Record<string, unknown>>;
    }

    audit.info("comparison_snapshot_created", {
      userId: user.id,
      scenarioSetId: access.scenarioSet.id,
      comparisonSnapshotId: comparisonSnapshot.id,
      indicatorDeltaCount: comparisonIndicatorDeltas.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        comparisonSnapshotId: comparisonSnapshot.id,
        comparisonSnapshot,
        comparisonIndicatorDeltas,
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("comparison_snapshot_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while creating comparison snapshot" },
      { status: 500 }
    );
  }
}
