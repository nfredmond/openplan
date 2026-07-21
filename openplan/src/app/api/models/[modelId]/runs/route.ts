import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadModelAccess } from "@/lib/models/api";
import {
  buildModelRunResultSummary,
  corridorGeojsonSchema,
  extractModelLaunchTemplate,
  looksLikePendingSchema,
  mergeScenarioLaunchPayload,
} from "@/lib/models/run-launch";
import { MANAGED_RUN_MODE_KEYS, getManagedRunModeDefinition } from "@/lib/models/run-modes";
import { fetchCensusForCorridor } from "@/lib/data-sources/census";
import { fetchLODESForCorridor } from "@/lib/data-sources/lodes";
import { runABM, DEFAULT_ABM_SEED } from "@/lib/models/sketch-abm/abm-runner";
import {
  DEFAULT_SKETCH_REFERENCE_BENCHMARKS,
  computeBenchmarkFit,
  type SketchModeSplitPct,
} from "@/lib/models/sketch-abm/benchmark-fit";
import { buildSketchAbmInputs, seedFromRunId } from "@/lib/models/sketch-abm/sketch-abm-inputs";
import {
  ITE_TRIP_GEN_SCREENING_CAVEAT,
  TRIP_GEN_COMPARISON_BASES,
  buildIteTripGenerationKpiRows,
  computeTripGeneration,
  type TripGenProgramInput,
} from "@/lib/models/ite-trip-generation";
import { TRIP_GEN_UNIT_BASES } from "@/lib/models/ite-rates";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  checkMonthlyRunQuota,
  isQuotaExceeded,
  isQuotaLookupError,
  QUOTA_WEIGHTS,
} from "@/lib/billing/quota";
import {
  isWorkspaceSubscriptionActive,
  resolveWorkspaceEntitlements,
  subscriptionGateMessage,
} from "@/lib/billing/subscription";
import { recordUsageEventBestEffort } from "@/lib/billing/usage-recording";
import {
  markScenarioLinkedReportsBasisStale,
  type ScenarioReportWritebackSupabaseLike,
} from "@/lib/reports/scenario-writeback";

const paramsSchema = z.object({
  modelId: z.string().uuid(),
});

/** Land-use program shape for the ite_trip_generation engine. Numeric-range
 * validation (shares 0–1, non-negative rates/quantities) lives in
 * computeTripGeneration; this schema gates structure only. */
const tripGenRateSchema = z.object({
  key: z.string().trim().min(1).max(80),
  landUse: z.string().trim().min(1).max(160),
  unitBasis: z.enum(TRIP_GEN_UNIT_BASES),
  dailyTripsPerUnit: z.number().finite(),
  amPeakShareOfDaily: z.number().finite(),
  amInboundShare: z.number().finite(),
  pmPeakShareOfDaily: z.number().finite(),
  pmInboundShare: z.number().finite(),
});

const tripGenLineItemSchema = z.object({
  rateKey: z.string().trim().min(1).max(80).optional(),
  rate: tripGenRateSchema.optional(),
  quantity: z.number().finite(),
  internalCaptureShare: z.number().finite().optional(),
  passByShare: z.number().finite().optional(),
});

const tripGenProgramSchema = z.object({
  lineItems: z.array(tripGenLineItemSchema).max(50),
  avgTripLengthMiles: z.number().finite(),
  comparisonBasis: z.enum(TRIP_GEN_COMPARISON_BASES),
});

const launchModelRunSchema = z.object({
  scenarioEntryId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(160).optional(),
  queryText: z.string().trim().min(1).max(5000).optional(),
  corridorGeojson: corridorGeojsonSchema.optional(),
  attachToScenarioEntry: z.boolean().optional(),
  engineKey: z.enum(MANAGED_RUN_MODE_KEYS).optional().default("deterministic_corridor_v1"),
  /** ite_trip_generation only: an inline land-use program (API/tests). */
  tripGenProgram: tripGenProgramSchema.optional(),
  /** ite_trip_generation only: read the program from a scenario_assumption_sets row. */
  assumptionSetId: z.string().uuid().optional(),
});

type RouteContext = {
  params: Promise<{ modelId: string }>;
};

type ScenarioEntryRow = {
  id: string;
  scenario_set_id: string;
  label: string;
  entry_type: string;
  status: string;
  assumptions_json: Record<string, unknown> | null;
};

/** Kilometres → miles for the sketch VMT KPI derivation. */
const KM_TO_MILES = 0.621371;

/** Hard cap on census-tract zones for the synchronous in-process sketch
 * lane. Skim building is O(zones²) and the run executes inside the request
 * cycle, so larger study areas must be redrawn smaller instead of silently
 * degrading. */
const SKETCH_ABM_MAX_ZONES = 150;

/**
 * Screening occupancy assumptions for converting sketch person-trip distance
 * to vehicle-miles: auto_sov ×1.0; auto_hov2 ÷2 (two occupants per vehicle);
 * auto_hov3 ÷3.2 (average 3.2 occupants for the 3+ class); taxi_tnc ×1.0
 * (each taxi/TNC person-trip is a vehicle trip). transit_drive is excluded —
 * the sketch skims carry no separate drive-access distance for its park-and-
 * ride leg. Modes absent from this table contribute zero vehicle-miles.
 */
const SKETCH_VEHICLE_MILE_FACTORS: Record<string, number> = {
  auto_sov: 1,
  auto_hov2: 1 / 2,
  auto_hov3: 1 / 3.2,
  taxi_tnc: 1,
};

/** Occupancy assumptions surfaced in KPI breakdowns (persons per vehicle). */
const SKETCH_OCCUPANCY_ASSUMPTIONS = {
  auto_sov: 1,
  auto_hov2: 2,
  auto_hov3: 3.2,
  taxi_tnc: 1,
} as const;

/**
 * Expansion factor scaling the capped synthetic-household sample back to the
 * full ACS household base. Factor 1 when the sample covers (or exceeds, via
 * per-zone minimums) the real household count, or when the sample is empty.
 */
function sketchExpansionFactor(totalRealHouseholds: number, syntheticHouseholds: number): number {
  if (syntheticHouseholds <= 0) return 1;
  return totalRealHouseholds > syntheticHouseholds
    ? totalRealHouseholds / syntheticHouseholds
    : 1;
}

type SketchAbmKpiRow = {
  run_id: string;
  kpi_name: string;
  kpi_label: string;
  kpi_category: "sketch_abm";
  value: number | null;
  unit: string;
  breakdown_json: Record<string, unknown>;
};

/**
 * Shape sketch ABM outputs into `model_run_kpis` rows. KPI names
 * `daily_vmt`, `vmt_per_capita`, and `population_total` are load-bearing —
 * the CEQA §15064.3 screen consumes them by exact name.
 *
 * Trip-derived totals (total_tours, total_trips, daily_vmt) are computed at
 * the capped synthetic-sample scale and expansion-weighted back to the full
 * ACS household base; vmt_per_capita divides the EXPANDED daily_vmt by the
 * full ACS population so the numerator and denominator are at the same scale.
 */
function buildSketchAbmKpiRows(params: {
  modelRunId: string;
  summary: Awaited<ReturnType<typeof runABM>>["summary"];
  sampleVehicleKm: number;
  populationTotal: number;
  totalRealHouseholds: number;
  syntheticHouseholds: number;
  expansionFactor: number;
}): SketchAbmKpiRow[] {
  const {
    modelRunId,
    summary,
    sampleVehicleKm,
    populationTotal,
    totalRealHouseholds,
    syntheticHouseholds,
    expansionFactor,
  } = params;
  const dailyVmt = sampleVehicleKm * expansionFactor * KM_TO_MILES;
  const vmtPerCapita = populationTotal > 0 ? dailyVmt / populationTotal : null;
  const totalTours = Math.round(summary.total_tours * expansionFactor);
  const totalTrips = Math.round(summary.total_trips * expansionFactor);

  const expansionBreakdown = {
    expansion_factor: expansionFactor,
    synthetic_households: syntheticHouseholds,
    total_real_households: totalRealHouseholds,
  };

  const row = (
    kpiName: string,
    kpiLabel: string,
    value: number | null,
    unit: string,
    breakdown: Record<string, unknown> = {}
  ): SketchAbmKpiRow => ({
    run_id: modelRunId,
    kpi_name: kpiName,
    kpi_label: kpiLabel,
    kpi_category: "sketch_abm",
    value,
    unit,
    breakdown_json: breakdown,
  });

  // summary.mode_split values are percentages (0–100); KPIs store 0–1 shares.
  const share = (mode: string) => (summary.mode_split[mode] ?? 0) / 100;

  return [
    row("total_tours", "Total tours (sketch)", totalTours, "tours", {
      provenance:
        "Screening-grade sketch output: tours from a capped synthetic-household sample, expansion-weighted to the full ACS household base (factor = real households / synthetic households).",
      sample_tours: summary.total_tours,
      ...expansionBreakdown,
    }),
    row("total_trips", "Total trips (sketch)", totalTrips, "trips", {
      provenance:
        "Screening-grade sketch output: trips from a capped synthetic-household sample, expansion-weighted to the full ACS household base (factor = real households / synthetic households).",
      sample_trips: summary.total_trips,
      ...expansionBreakdown,
    }),
    row("mode_share_auto", "Auto mode share (sketch)", share("auto"), "share"),
    row("mode_share_transit", "Transit mode share (sketch)", share("transit"), "share"),
    row("mode_share_walk", "Walk mode share (sketch)", share("walk"), "share"),
    row("mode_share_bike", "Bike mode share (sketch)", share("bike"), "share"),
    row("mode_share_shared", "Shared-ride mode share (sketch)", share("shared"), "share"),
    row("daily_vmt", "Daily VMT (sketch)", dailyVmt, "vehicle-miles/day", {
      provenance:
        "Screening-grade sketch output: vehicle-miles from a synthetic-population sketch activity model over distance-based screening skims, expansion-weighted from the capped household sample to the full ACS household base (factor = real households / synthetic households). Person-trip distances convert to vehicle-miles under screening occupancy assumptions: auto_sov x1.0, auto_hov2 /2, auto_hov3 /3.2, taxi_tnc x1.0 (a vehicle trip); transit_drive access legs are excluded because the skims carry no separate drive-access distance. Converted km to miles (x 0.621371). Not a validated travel model or calibrated forecast.",
      sample_vehicle_km: sampleVehicleKm,
      km_to_miles: KM_TO_MILES,
      occupancy_assumptions: SKETCH_OCCUPANCY_ASSUMPTIONS,
      excluded_modes: ["transit_drive"],
      ...expansionBreakdown,
    }),
    row("vmt_per_capita", "VMT per capita (sketch)", vmtPerCapita, "vehicle-miles/person/day", {
      provenance:
        "Screening-grade sketch output: expansion-weighted daily_vmt divided by total ACS population across the county-bbox-scale tract set (every tract in the counties overlapping the study-area bounding box, not clipped to the drawn corridor). Not a validated travel model or calibrated forecast.",
      population_total: populationTotal,
      ...expansionBreakdown,
    }),
    row("population_total", "Population (zones)", populationTotal, "persons", {
      provenance:
        "Total ACS population across the county-bbox-scale tract set (every tract in the counties overlapping the study-area bounding box, not clipped to the drawn corridor).",
    }),
  ];
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("model_runs.list", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid model id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadModelAccess(supabase, parsedParams.data.modelId, user.id, "models.read");
    if (access.error) {
      return NextResponse.json({ error: "Failed to load model" }, { status: 500 });
    }
    if (!access.model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }
    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("model_runs")
      .select(
        "id, model_id, scenario_set_id, scenario_entry_id, source_analysis_run_id, engine_key, launch_source, status, run_title, query_text, result_summary_json, error_message, started_at, completed_at, created_at"
      )
      .eq("model_id", access.model.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      if (looksLikePendingSchema(error.message)) {
        return NextResponse.json({ modelRuns: [], schemaPending: true }, { status: 200 });
      }
      audit.error("model_runs_list_failed", {
        modelId: access.model.id,
        userId: user.id,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load model runs" }, { status: 500 });
    }

    return NextResponse.json({ modelRuns: data ?? [], schemaPending: false }, { status: 200 });
  } catch (error) {
    audit.error("model_runs_list_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading model runs" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("model_runs.launch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid model id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);

    if (!payloadBody.ok) return payloadBody.response;

    const payload = payloadBody.data;
    const parsed = launchModelRunSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid model run launch payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadModelAccess(supabase, parsedParams.data.modelId, user.id, "models.write");

    if (access.error) {
      audit.error("model_access_failed", {
        modelId: parsedParams.data.modelId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load model" }, { status: 500 });
    }

    if (!access.model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    let scenarioEntry: ScenarioEntryRow | null = null;
    if (parsed.data.scenarioEntryId) {
      const { data: entry, error: entryError } = await supabase
        .from("scenario_entries")
        .select("id, scenario_set_id, label, entry_type, status, assumptions_json")
        .eq("id", parsed.data.scenarioEntryId)
        .maybeSingle();

      if (entryError) {
        audit.error("scenario_entry_lookup_failed", {
          modelId: access.model.id,
          scenarioEntryId: parsed.data.scenarioEntryId,
          message: entryError.message,
          code: entryError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify scenario entry" }, { status: 500 });
      }

      if (!entry) {
        return NextResponse.json({ error: "Scenario entry not found" }, { status: 404 });
      }

      if (access.model.scenario_set_id && entry.scenario_set_id !== access.model.scenario_set_id) {
        return NextResponse.json({ error: "Scenario entry does not belong to the model's primary scenario set" }, { status: 400 });
      }

      scenarioEntry = entry as ScenarioEntryRow;
    }

    let assumptionSet: { id: string; assumptions_json: Record<string, unknown> | null } | null = null;
    if (parsed.data.assumptionSetId) {
      const { data: setRow, error: setError } = await supabase
        .from("scenario_assumption_sets")
        .select("id, scenario_set_id, assumptions_json, scenario_sets(workspace_id)")
        .eq("id", parsed.data.assumptionSetId)
        .maybeSingle();

      if (setError) {
        audit.error("assumption_set_lookup_failed", {
          modelId: access.model.id,
          assumptionSetId: parsed.data.assumptionSetId,
          message: setError.message,
          code: setError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify assumption set" }, { status: 500 });
      }

      if (!setRow) {
        return NextResponse.json({ error: "Assumption set not found" }, { status: 404 });
      }

      if (access.model.scenario_set_id && setRow.scenario_set_id !== access.model.scenario_set_id) {
        return NextResponse.json(
          { error: "Assumption set does not belong to the model's primary scenario set" },
          { status: 400 }
        );
      }

      // RLS only proves the CALLER can read the set (any of their workspaces),
      // and models without a primary scenario set skip the check above — so a
      // member of two workspaces could otherwise execute workspace B's land-use
      // program under workspace A's model. Always pin the set to the model's
      // workspace.
      const setWorkspace = Array.isArray(setRow.scenario_sets)
        ? setRow.scenario_sets[0]
        : setRow.scenario_sets;
      if (!setWorkspace || setWorkspace.workspace_id !== access.model.workspace_id) {
        return NextResponse.json(
          { error: "Assumption set does not belong to the model's workspace" },
          { status: 400 }
        );
      }

      assumptionSet = { id: setRow.id, assumptions_json: setRow.assumptions_json ?? null };
    }

    const modelTemplate = extractModelLaunchTemplate(access.model.config_json ?? {});
    const launchPayload = mergeScenarioLaunchPayload({
      modelTemplate,
      scenarioAssumptions: scenarioEntry?.assumptions_json,
      overrideQueryText: parsed.data.queryText,
      overrideCorridorGeojson: parsed.data.corridorGeojson,
    });
    launchPayload.engineKey = parsed.data.engineKey;
    const runMode = getManagedRunModeDefinition(launchPayload.engineKey);
    const isIteTripGenRun = launchPayload.engineKey === "ite_trip_generation";

    // Trip generation runs on a land-use program, not a corridor — it is the
    // one engine exempt from the query/corridor requirement.
    if (!isIteTripGenRun && (!launchPayload.queryText || !launchPayload.corridorGeojson)) {
      return NextResponse.json(
        {
          error:
            "Launch configuration is incomplete. Provide query text and corridor GeoJSON, or store them in model.config_json.runTemplate.",
        },
        { status: 400 }
      );
    }

    const modelRunId = crypto.randomUUID();
    const launchTitle =
      parsed.data.title?.trim() ||
      scenarioEntry?.label?.trim() ||
      `${access.model.title} run`;
    const launchedAt = new Date().toISOString();
    const isAequilibraeRun = launchPayload.engineKey === "aequilibrae";
    const isBehavioralDemandRun = launchPayload.engineKey === "behavioral_demand";
    const isSketchAbmRun = launchPayload.engineKey === "sketch_abm";

    if (isBehavioralDemandRun) {
      audit.info("behavioral_demand_launch_blocked", {
        modelId: access.model.id,
        userId: user.id,
        runMode: launchPayload.engineKey,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json(
        {
          error:
            "Behavioral Demand is currently surfaced as a prototype/preflight-backed run mode. Managed launch from this form is not wired through the production model-run API yet.",
          runMode: runMode.label,
          runtimeExpectation: runMode.runtimeExpectation,
          caveat: runMode.caveatSummary,
        },
        { status: 409 }
      );
    }

    // Subscription + quota gate for the synchronous in-process branches only —
    // mirrors /runs/[modelRunId]/launch. The deterministic path is gated by
    // /api/analysis downstream and the aequilibrae path by the launch route,
    // so neither is re-gated here.
    if (isSketchAbmRun || isIteTripGenRun) {
      const { data: workspaceBilling, error: billingError } = await supabase
        .from("workspaces")
        .select("plan, subscription_plan, subscription_status")
        .eq("id", access.model.workspace_id)
        .maybeSingle();

      if (billingError) {
        audit.error("workspace_billing_lookup_failed", {
          workspaceId: access.model.workspace_id,
          userId: user.id,
          message: billingError.message,
          code: billingError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify workspace billing" }, { status: 500 });
      }

      if (!isWorkspaceSubscriptionActive(workspaceBilling ?? {})) {
        const gateMessage = subscriptionGateMessage(workspaceBilling ?? {});
        audit.warn("subscription_inactive", {
          workspaceId: access.model.workspace_id,
          userId: user.id,
          subscriptionStatus: workspaceBilling?.subscription_status ?? null,
        });
        return NextResponse.json({ error: gateMessage }, { status: 402 });
      }

      const { plan } = resolveWorkspaceEntitlements(workspaceBilling ?? {});
      const quota = await checkMonthlyRunQuota(supabase, {
        workspaceId: access.model.workspace_id,
        plan,
        tableName: "model_runs",
        weight: QUOTA_WEIGHTS.MODEL_RUN_LAUNCH,
      });

      if (isQuotaLookupError(quota)) {
        audit.error("run_limit_count_failed", {
          workspaceId: access.model.workspace_id,
          userId: user.id,
          message: quota.message,
          code: quota.code,
        });
        return NextResponse.json({ error: "Failed to validate plan limits" }, { status: 500 });
      }

      if (isQuotaExceeded(quota)) {
        audit.warn("run_limit_reached", {
          workspaceId: access.model.workspace_id,
          userId: user.id,
          plan: quota.plan,
          usedRuns: quota.usedRuns,
          monthlyLimit: quota.monthlyLimit,
        });
        return NextResponse.json({ error: quota.message }, { status: 429 });
      }
    }

    const { error: createModelRunError } = await supabase.from("model_runs").insert({
      id: modelRunId,
      workspace_id: access.model.workspace_id,
      model_id: access.model.id,
      scenario_set_id: access.model.scenario_set_id,
      scenario_entry_id: scenarioEntry?.id ?? null,
      engine_key: launchPayload.engineKey || "deterministic_corridor_v1",
      launch_source: scenarioEntry ? "scenario_entry" : "model_detail",
      status: isAequilibraeRun ? "queued" : "running",
      run_title: launchTitle,
      query_text: launchPayload.queryText,
      corridor_geojson: launchPayload.corridorGeojson,
      input_snapshot_json: {
        modelId: access.model.id,
        modelTitle: access.model.title,
        modelFamily: access.model.model_family ?? null,
        configVersion: access.model.config_version ?? null,
        launchedAt,
      },
      assumption_snapshot_json: launchPayload.assumptionSnapshot,
      started_at: isAequilibraeRun ? null : launchedAt,
      created_by: user.id,
    });

    
    if (createModelRunError) {
      if (looksLikePendingSchema(createModelRunError.message)) {
        return NextResponse.json(
          { error: "model_runs migration is not applied yet. Apply the latest database migration first." },
          { status: 503 }
        );
      }

      audit.error("model_run_insert_failed", {
        modelId: access.model.id,
        userId: user.id,
        message: createModelRunError.message,
        code: createModelRunError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create model run" }, { status: 500 });
    }

    if (isAequilibraeRun) {
      // Async run. Create stages and return immediately.
      const { error: stageInsertError } = await supabase.from("model_run_stages").insert([
        { run_id: modelRunId, stage_name: "AequilibraE Setup", sort_order: 1, status: "queued" },
        { run_id: modelRunId, stage_name: "Network Assignment", sort_order: 2, status: "queued" },
        { run_id: modelRunId, stage_name: "Artifact Extraction", sort_order: 3, status: "queued" },
      ]);

      if (stageInsertError) {
        await supabase
          .from("model_runs")
          .update({
            status: "failed",
            error_message: "Failed to initialize AequilibraE run stages",
            completed_at: new Date().toISOString(),
          })
          .eq("id", modelRunId);

        audit.error("model_run_stage_insert_failed", {
          modelId: access.model.id,
          modelRunId,
          message: stageInsertError.message,
          code: stageInsertError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to initialize model run stages" }, { status: 500 });
      }

      return NextResponse.json(
        { modelRunId, status: "queued" },
        { status: 201 }
      );
    }

    if (isSketchAbmRun) {
      // Synchronous in-process sketch activity model run, mirroring the
      // deterministic branch shape: run row is already inserted as running;
      // execute, then update to succeeded/failed.
      try {
        const corridorForApi = launchPayload.corridorGeojson as {
          type: string;
          coordinates: number[][][] | number[][][][];
        };
        const census = await fetchCensusForCorridor(corridorForApi);
        if (!census.tracts.length) {
          throw new Error("Census returned no census tracts in the study-area counties; the sketch activity model has no zones to run.");
        }

        if (census.tracts.length > SKETCH_ABM_MAX_ZONES) {
          const zoneCapMessage = `Study area resolves to ${census.tracts.length} census tracts; the in-process sketch lane caps at ${SKETCH_ABM_MAX_ZONES} — draw a smaller corridor.`;
          await supabase
            .from("model_runs")
            .update({
              status: "failed",
              error_message: zoneCapMessage,
              completed_at: new Date().toISOString(),
            })
            .eq("id", modelRunId);

          audit.warn("sketch_abm_zone_cap_exceeded", {
            modelId: access.model.id,
            modelRunId,
            tractCount: census.tracts.length,
            maxZones: SKETCH_ABM_MAX_ZONES,
          });

          return NextResponse.json({ error: zoneCapMessage }, { status: 422 });
        }

        const lodes = await fetchLODESForCorridor(
          corridorForApi,
          census.totalPopulation,
          census.totalCommuters
        );

        const {
          inputs: abmInputs,
          totalRealHouseholds,
          syntheticHouseholds,
        } = buildSketchAbmInputs({
          censusTracts: census.tracts,
          lodesJobs: lodes,
          seed: seedFromRunId(modelRunId),
        });
        // Fixed seed → reproducible: the same package produces the same run.
        const abmOutputs = await runABM(abmInputs, { seed: DEFAULT_ABM_SEED });

        const populationTotal = abmInputs.zones.reduce((sum, zone) => sum + zone.population, 0);
        // Sample-scale vehicle-km: person-trip distance weighted by the
        // per-mode vehicle-mile factors (occupancy-adjusted; see
        // SKETCH_VEHICLE_MILE_FACTORS for the documented assumptions).
        const sampleVehicleKm = abmOutputs.trips.reduce(
          (sum, trip) => sum + trip.distance_km * (SKETCH_VEHICLE_MILE_FACTORS[trip.mode] ?? 0),
          0
        );
        const expansionFactor = sketchExpansionFactor(totalRealHouseholds, syntheticHouseholds);

        const kpiRows = buildSketchAbmKpiRows({
          modelRunId,
          summary: abmOutputs.summary,
          sampleVehicleKm,
          populationTotal,
          totalRealHouseholds,
          syntheticHouseholds,
          expansionFactor,
        });

        const { error: kpiInsertError } = await supabase.from("model_run_kpis").insert(kpiRows);
        if (kpiInsertError) {
          throw new Error(`Failed to record sketch activity model KPIs: ${kpiInsertError.message}`);
        }

        // Benchmark fit — screening diagnostic against reference benchmarks
        // (not local observations). Modeled VMT per capita is the EXPANDED
        // KPI value computed above (reused verbatim, never recomputed);
        // modeled mode split is the runner's aggregate split, already in
        // percentage points (0–100) as computeBenchmarkFit expects.
        const modeledVmtPerCapita =
          kpiRows.find((row) => row.kpi_name === "vmt_per_capita")?.value ?? null;
        const modeledModeSplitPct: SketchModeSplitPct = {
          auto: abmOutputs.summary.mode_split.auto ?? 0,
          transit: abmOutputs.summary.mode_split.transit ?? 0,
          walk: abmOutputs.summary.mode_split.walk ?? 0,
          bike: abmOutputs.summary.mode_split.bike ?? 0,
          shared: abmOutputs.summary.mode_split.shared ?? 0,
        };
        const benchmarkFit =
          modeledVmtPerCapita !== null && Number.isFinite(modeledVmtPerCapita)
            ? computeBenchmarkFit({
                modeled: {
                  vmt_per_capita: modeledVmtPerCapita,
                  mode_split_pct: modeledModeSplitPct,
                },
                reference: DEFAULT_SKETCH_REFERENCE_BENCHMARKS,
              })
            : null;

        const sketchCompletedAt = new Date().toISOString();
        const { error: sketchRunUpdateError } = await supabase
          .from("model_runs")
          .update({
            status: "succeeded",
            result_summary_json: {
              engine: "sketch_abm",
              caveat: runMode.caveatSummary,
              // Consumed by the evidence-packet normalizer so the packet for
              // a sketch run always carries the sketch-grade caveats.
              caveats: [runMode.caveatSummary],
              synthetic_households: abmOutputs.summary.total_households,
              synthetic_persons: abmOutputs.summary.total_persons,
              total_real_households: totalRealHouseholds,
              expansion_factor: expansionFactor,
              total_tours: Math.round(abmOutputs.summary.total_tours * expansionFactor),
              total_trips: Math.round(abmOutputs.summary.total_trips * expansionFactor),
              zone_count: abmInputs.zones.length,
              // Screening diagnostic against reference benchmarks; null when
              // the run had no finite VMT-per-capita KPI to score.
              benchmark_fit: benchmarkFit,
            },
            completed_at: sketchCompletedAt,
          })
          .eq("id", modelRunId);

        if (sketchRunUpdateError) {
          audit.error("sketch_abm_run_update_failed", {
            modelId: access.model.id,
            modelRunId,
            message: sketchRunUpdateError.message,
            code: sketchRunUpdateError.code ?? null,
          });
          return NextResponse.json(
            { error: "Sketch activity model run completed, but provenance update failed" },
            { status: 500 }
          );
        }

        const { error: sketchModelTouchError } = await supabase
          .from("models")
          .update({ last_run_recorded_at: sketchCompletedAt })
          .eq("id", access.model.id);

        if (sketchModelTouchError) {
          audit.warn("model_last_run_touch_failed", {
            modelId: access.model.id,
            modelRunId,
            message: sketchModelTouchError.message,
            code: sketchModelTouchError.code ?? null,
          });
        }

        audit.info("sketch_abm_model_run_succeeded", {
          modelId: access.model.id,
          modelRunId,
          zoneCount: abmInputs.zones.length,
          syntheticHouseholds,
          totalRealHouseholds,
          expansionFactor,
          sampleTrips: abmOutputs.summary.total_trips,
          durationMs: Date.now() - startedAt,
        });

        await recordUsageEventBestEffort(
          {
            workspaceId: access.model.workspace_id,
            eventKey: "model_run.launch",
            bucketKey: "runs",
            weight: QUOTA_WEIGHTS.MODEL_RUN_LAUNCH,
            sourceRoute: "/api/models/[modelId]/runs",
            idempotencyKey: `model_run:${modelRunId}:launch`,
            metadata: { modelId: access.model.id, modelRunId, engineKey: "sketch_abm" },
          },
          audit
        );

        // scenario_attach is honest surface metadata: the sketch branch
        // records the run only — attach-as-evidence wiring does not run here.
        return NextResponse.json(
          { modelRunId, status: "succeeded", scenario_attach: "recorded-only" },
          { status: 201 }
        );
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Sketch activity model run failed";

        await supabase
          .from("model_runs")
          .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
          .eq("id", modelRunId);

        audit.error("sketch_abm_model_run_failed", {
          modelId: access.model.id,
          modelRunId,
          message,
          durationMs: Date.now() - startedAt,
        });

        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    if (isIteTripGenRun) {
      // Synchronous in-process trip-generation worksheet, mirroring the sketch
      // branch shape: run row is already inserted as running; resolve the
      // land-use program, compute, then update to succeeded/failed. No
      // corridor and no external fetches — pure rate-table arithmetic.
      const failRun = async (message: string) => {
        await supabase
          .from("model_runs")
          .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
          .eq("id", modelRunId);
      };

      // Program source priority: inline (API/tests) → assumption set → the
      // scenario entry's assumptions_json.tripGenProgram (the primary UX path;
      // the entry's full assumptions already ride in assumption_snapshot_json).
      // The resolved source is recorded so provenance never claims a program
      // origin that was not actually used.
      const setCandidate = (assumptionSet?.assumptions_json ?? {})["tripGenProgram"];
      const entryCandidate = (scenarioEntry?.assumptions_json ?? {})["tripGenProgram"];

      let program: TripGenProgramInput | null = parsed.data.tripGenProgram ?? null;
      let programSource: "inline" | "assumption_set" | "scenario_entry" | null = program ? "inline" : null;
      if (!program) {
        const storedCandidate = setCandidate !== undefined ? setCandidate : entryCandidate;
        const storedSource = setCandidate !== undefined ? ("assumption_set" as const) : ("scenario_entry" as const);
        if (storedCandidate !== undefined) {
          const parsedProgram = tripGenProgramSchema.safeParse(storedCandidate);
          if (!parsedProgram.success) {
            const message =
              "Stored land-use program (assumptions_json.tripGenProgram) is malformed for the trip-generation engine.";
            await failRun(message);
            audit.warn("ite_trip_gen_program_invalid", {
              modelId: access.model.id,
              modelRunId,
              issues: parsedProgram.error.issues.slice(0, 5),
            });
            return NextResponse.json({ error: message, issues: parsedProgram.error.issues }, { status: 422 });
          }
          program = parsedProgram.data;
          programSource = storedSource;
        }
      }

      if (!program) {
        const message =
          "No land-use program found. Provide tripGenProgram inline, reference an assumptionSetId, or store one at the scenario entry's assumptions_json.tripGenProgram.";
        await failRun(message);
        return NextResponse.json({ error: message }, { status: 422 });
      }

      try {
        let result: ReturnType<typeof computeTripGeneration>;
        try {
          result = computeTripGeneration(program);
        } catch (computeError) {
          // computeTripGeneration throws only on invalid input — operator-fixable.
          const message =
            computeError instanceof Error ? computeError.message : "Invalid trip-generation program";
          await failRun(message);
          audit.warn("ite_trip_gen_program_rejected", {
            modelId: access.model.id,
            modelRunId,
            message,
          });
          return NextResponse.json({ error: message }, { status: 422 });
        }

        const iteKpiRows = buildIteTripGenerationKpiRows(modelRunId, result);
        const { error: kpiInsertError } = await supabase.from("model_run_kpis").insert(iteKpiRows);
        if (kpiInsertError) {
          throw new Error(`Failed to record trip-generation KPIs: ${kpiInsertError.message}`);
        }

        const iteCompletedAt = new Date().toISOString();
        const { error: iteRunUpdateError } = await supabase
          .from("model_runs")
          .update({
            status: "succeeded",
            result_summary_json: {
              engine: "ite_trip_generation",
              // The engine module's full screening caveat is the single source
              // of truth here (the run-mode caveatSummary is its short form).
              // Consumed by the evidence-packet normalizer via `caveats`.
              caveat: ITE_TRIP_GEN_SCREENING_CAVEAT,
              caveats: [ITE_TRIP_GEN_SCREENING_CAVEAT],
              comparison_basis: result.comparisonBasis,
              avg_trip_length_miles: result.avgTripLengthMiles,
              net_daily_trip_ends: result.totals.netDailyTrips,
              am_peak_trip_ends: result.totals.amPeakTrips,
              pm_peak_trip_ends: result.totals.pmPeakTrips,
              daily_vmt_screen: result.totals.dailyVmt,
              line_item_count: result.lineItems.length,
              program_source: programSource,
              // Only stamped when the program actually CAME from the set —
              // never a pointer to a set that was loaded but unused.
              assumption_set_id: programSource === "assumption_set" ? (assumptionSet?.id ?? null) : null,
            },
            completed_at: iteCompletedAt,
          })
          .eq("id", modelRunId);

        if (iteRunUpdateError) {
          audit.error("ite_trip_gen_run_update_failed", {
            modelId: access.model.id,
            modelRunId,
            message: iteRunUpdateError.message,
            code: iteRunUpdateError.code ?? null,
          });
          return NextResponse.json(
            { error: "Trip-generation run completed, but provenance update failed" },
            { status: 500 }
          );
        }

        const { error: iteModelTouchError } = await supabase
          .from("models")
          .update({ last_run_recorded_at: iteCompletedAt })
          .eq("id", access.model.id);

        if (iteModelTouchError) {
          audit.warn("model_last_run_touch_failed", {
            modelId: access.model.id,
            modelRunId,
            message: iteModelTouchError.message,
            code: iteModelTouchError.code ?? null,
          });
        }

        audit.info("ite_trip_gen_model_run_succeeded", {
          modelId: access.model.id,
          modelRunId,
          lineItemCount: result.lineItems.length,
          netDailyTrips: result.totals.netDailyTrips,
          comparisonBasis: result.comparisonBasis,
          durationMs: Date.now() - startedAt,
        });

        await recordUsageEventBestEffort(
          {
            workspaceId: access.model.workspace_id,
            eventKey: "model_run.launch",
            bucketKey: "runs",
            weight: QUOTA_WEIGHTS.MODEL_RUN_LAUNCH,
            sourceRoute: "/api/models/[modelId]/runs",
            idempotencyKey: `model_run:${modelRunId}:launch`,
            metadata: { modelId: access.model.id, modelRunId, engineKey: "ite_trip_generation" },
          },
          audit
        );

        // Mirrors the sketch branch: the run is recorded only — comparison
        // snapshots are saved explicitly through the scenario spine routes.
        return NextResponse.json(
          { modelRunId, status: "succeeded", scenario_attach: "recorded-only" },
          { status: 201 }
        );
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : "Trip-generation run failed";

        await failRun(message);

        audit.error("ite_trip_gen_model_run_failed", {
          modelId: access.model.id,
          modelRunId,
          message,
          durationMs: Date.now() - startedAt,
        });

        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    const analysisResponse = await fetch(new URL("/api/analysis", request.nextUrl.origin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({
        workspaceId: access.model.workspace_id,
        queryText: launchPayload.queryText,
        corridorGeojson: launchPayload.corridorGeojson,
      }),
      cache: "no-store",
    });

    const analysisPayload = (await analysisResponse.json().catch(() => null)) as {
      error?: string;
      runId?: string;
      metrics?: Record<string, unknown>;
      summary?: string;
    } | null;

    if (!analysisResponse.ok || !analysisPayload?.runId) {
      const errorMessage = analysisPayload?.error || "Analysis launch failed";
      await supabase
        .from("model_runs")
        .update({ status: "failed", error_message: errorMessage, completed_at: new Date().toISOString() })
        .eq("id", modelRunId);

      return NextResponse.json({ error: errorMessage }, { status: analysisResponse.status || 500 });
    }

    const completedAt = new Date().toISOString();
    const resultSummary = buildModelRunResultSummary({
      runId: analysisPayload.runId,
      metrics: analysisPayload.metrics,
      summary: analysisPayload.summary,
    });

    const { error: modelRunUpdateError } = await supabase
      .from("model_runs")
      .update({
        status: "succeeded",
        source_analysis_run_id: analysisPayload.runId,
        result_summary_json: resultSummary,
        completed_at: completedAt,
      })
      .eq("id", modelRunId);

    if (modelRunUpdateError) {
      audit.error("model_run_update_failed", {
        modelId: access.model.id,
        modelRunId,
        message: modelRunUpdateError.message,
        code: modelRunUpdateError.code ?? null,
      });
      return NextResponse.json({ error: "Managed run launched, but provenance update failed" }, { status: 500 });
    }

    const { error: modelTouchError } = await supabase
      .from("models")
      .update({ last_run_recorded_at: completedAt })
      .eq("id", access.model.id);

    if (modelTouchError) {
      audit.warn("model_last_run_touch_failed", {
        modelId: access.model.id,
        modelRunId,
        message: modelTouchError.message,
        code: modelTouchError.code ?? null,
      });
    }

    const { data: existingRunLink } = await supabase
      .from("model_links")
      .select("id")
      .eq("model_id", access.model.id)
      .eq("link_type", "run")
      .eq("linked_id", analysisPayload.runId)
      .maybeSingle();

    if (!existingRunLink) {
      const { error: insertLinkError } = await supabase.from("model_links").insert({
        model_id: access.model.id,
        link_type: "run",
        linked_id: analysisPayload.runId,
        label: launchTitle,
        created_by: user.id,
      });

      if (insertLinkError) {
        audit.warn("model_run_link_insert_failed", {
          modelId: access.model.id,
          modelRunId,
          runId: analysisPayload.runId,
          message: insertLinkError.message,
          code: insertLinkError.code ?? null,
        });
      }
    }

    if (parsed.data.attachToScenarioEntry && scenarioEntry) {
      const nextScenarioStatus = scenarioEntry.status === "draft" ? "ready" : scenarioEntry.status;
      const { error: attachError } = await supabase
        .from("scenario_entries")
        .update({ attached_run_id: analysisPayload.runId, status: nextScenarioStatus })
        .eq("id", scenarioEntry.id);

      if (attachError) {
        audit.warn("scenario_entry_attach_failed", {
          modelId: access.model.id,
          modelRunId,
          scenarioEntryId: scenarioEntry.id,
          runId: analysisPayload.runId,
          message: attachError.message,
          code: attachError.code ?? null,
        });
      }

      const staleReason = `Linked model run ${launchTitle} succeeded`;
      const { staleReportIds, error: staleError } = await markScenarioLinkedReportsBasisStale({
        supabase: supabase as unknown as ScenarioReportWritebackSupabaseLike,
        scenarioSetId: scenarioEntry.scenario_set_id,
        workspaceId: access.model.workspace_id,
        runId: modelRunId,
        reason: staleReason,
        markedAt: completedAt,
      });

      if (staleError) {
        audit.warn("scenario_report_basis_stale_failed", {
          modelId: access.model.id,
          modelRunId,
          scenarioEntryId: scenarioEntry.id,
          message: staleError.message,
          code: staleError.code ?? null,
        });
      } else if (staleReportIds.length > 0) {
        audit.info("scenario_report_basis_stale_marked", {
          modelId: access.model.id,
          modelRunId,
          scenarioEntryId: scenarioEntry.id,
          staleReportCount: staleReportIds.length,
        });
      }
    }

    audit.info("model_run_succeeded", {
      modelId: access.model.id,
      modelRunId,
      runId: analysisPayload.runId,
      scenarioEntryId: scenarioEntry?.id ?? null,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        modelRunId,
        runId: analysisPayload.runId,
        attachedScenarioEntryId: parsed.data.attachToScenarioEntry ? scenarioEntry?.id ?? null : null,
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("model_run_launch_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while launching model run" }, { status: 500 });
  }
}
