import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const fetchCensusForCorridorMock = vi.fn();
const fetchLODESForCorridorMock = vi.fn();
const recordUsageEventBestEffortMock = vi.fn();

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

const modelMaybeSingleMock = vi.fn();
const modelEqMock = vi.fn(() => ({ maybeSingle: modelMaybeSingleMock }));
const modelSelectMock = vi.fn(() => ({ eq: modelEqMock }));
const modelUpdateEqMock = vi.fn();
const modelUpdateMock = vi.fn(() => ({ eq: modelUpdateEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const modelRunInsertMock = vi.fn();
const modelRunUpdateEqMock = vi.fn();
const modelRunUpdateMock = vi.fn(() => ({ eq: modelRunUpdateEqMock }));
// Monthly quota count: from("model_runs").select("id", …).eq(…).gte(…)
const modelRunQuotaGteMock = vi.fn();
const modelRunQuotaEqMock = vi.fn(() => ({ gte: modelRunQuotaGteMock }));
const modelRunSelectMock = vi.fn(() => ({ eq: modelRunQuotaEqMock }));

const modelRunKpisInsertMock = vi.fn();
const modelRunStagesInsertMock = vi.fn();

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const scenarioEntryMaybeSingleMock = vi.fn();
const scenarioEntryEqMock = vi.fn(() => ({ maybeSingle: scenarioEntryMaybeSingleMock }));
const scenarioEntrySelectMock = vi.fn(() => ({ eq: scenarioEntryEqMock }));

const assumptionSetMaybeSingleMock = vi.fn();
const assumptionSetEqMock = vi.fn(() => ({ maybeSingle: assumptionSetMaybeSingleMock }));
const assumptionSetSelectMock = vi.fn(() => ({ eq: assumptionSetEqMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "models") {
    return { select: modelSelectMock, update: modelUpdateMock };
  }
  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }
  if (table === "model_runs") {
    return { insert: modelRunInsertMock, update: modelRunUpdateMock, select: modelRunSelectMock };
  }
  if (table === "model_run_kpis") {
    return { insert: modelRunKpisInsertMock };
  }
  if (table === "model_run_stages") {
    return { insert: modelRunStagesInsertMock };
  }
  if (table === "workspaces") {
    return { select: workspaceSelectMock };
  }
  if (table === "scenario_entries") {
    return { select: scenarioEntrySelectMock };
  }
  if (table === "scenario_assumption_sets") {
    return { select: assumptionSetSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/data-sources/census", () => ({
  fetchCensusForCorridor: (...args: unknown[]) => fetchCensusForCorridorMock(...args),
}));

vi.mock("@/lib/data-sources/lodes", () => ({
  fetchLODESForCorridor: (...args: unknown[]) => fetchLODESForCorridorMock(...args),
}));

vi.mock("@/lib/billing/usage-recording", () => ({
  recordUsageEventBestEffort: (...args: unknown[]) => recordUsageEventBestEffortMock(...args),
}));

import { POST as postModelRun } from "@/app/api/models/[modelId]/runs/route";

/** Three-tract corridor fixture (real runABM runs over these zones). The
 * 2,700 real households deliberately exceed the 2,000 synthetic-household
 * cap so the expansion weighting (real / synthetic > 1) is exercised. */
const SKETCH_CENSUS_FIXTURE = {
  tracts: [
    { geoid: "06021010100", population: 3200, totalHouseholds: 1250 },
    { geoid: "06021010200", population: 2100, totalHouseholds: 830 },
    { geoid: "06021010300", population: 1500, totalHouseholds: 620 },
  ],
  totalPopulation: 6800,
  totalCommuters: 2900,
};

const SKETCH_FIXTURE_REAL_HOUSEHOLDS = SKETCH_CENSUS_FIXTURE.tracts.reduce(
  (sum, tract) => sum + tract.totalHouseholds,
  0
);

function launchRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/models/${MODEL_ID}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/models/[modelId]/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "33333333-3333-4333-8333-333333333333" },
      },
    });

    modelMaybeSingleMock.mockResolvedValue({
      data: {
        id: MODEL_ID,
        workspace_id: WORKSPACE_ID,
        scenario_set_id: null,
        title: "County mobility model",
        model_family: "travel_demand",
        config_version: "v1",
        config_json: {
          runTemplate: {
            queryText: "Evaluate county demand shifts",
            corridorGeojson: {
              type: "Polygon",
              coordinates: [
                [
                  [-121.5, 39.1],
                  [-121.4, 39.1],
                  [-121.4, 39.2],
                  [-121.5, 39.1],
                ],
              ],
            },
          },
        },
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: WORKSPACE_ID,
        role: "member",
      },
      error: null,
    });

    modelRunInsertMock.mockResolvedValue({ error: null });
    modelRunStagesInsertMock.mockResolvedValue({ error: null });
    modelRunUpdateEqMock.mockResolvedValue({ error: null });
    modelUpdateEqMock.mockResolvedValue({ error: null });
    modelRunKpisInsertMock.mockResolvedValue({ error: null });
    modelRunQuotaGteMock.mockResolvedValue({ count: 0, error: null });
    recordUsageEventBestEffortMock.mockResolvedValue(undefined);

    workspaceMaybeSingleMock.mockResolvedValue({
      data: { plan: "pilot", subscription_plan: "pilot", subscription_status: "active" },
      error: null,
    });

    fetchCensusForCorridorMock.mockResolvedValue(SKETCH_CENSUS_FIXTURE);
    fetchLODESForCorridorMock.mockResolvedValue({ totalJobs: 1800 });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("enqueues behavioral demand as an async ActivitySim preflight (not a forecast)", async () => {
    const response = await postModelRun(
      launchRequest({ engineKey: "behavioral_demand" }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      modelRunId: expect.any(String),
      status: "queued",
      engineKey: "behavioral_demand",
      mode: "preflight",
    });

    // The run row is queued (worker-backed), never started in-process.
    expect(modelRunInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        engine_key: "behavioral_demand",
        status: "queued",
        started_at: null,
      })
    );

    // Stages: 3 AequilibraE screening stages (owned by the aeq worker) + 1
    // ActivitySim bundle/preflight stage. Named honestly — never "run demand model".
    expect(modelRunStagesInsertMock).toHaveBeenCalledTimes(1);
    const stages = modelRunStagesInsertMock.mock.calls[0][0] as Array<{ stage_name: string }>;
    expect(stages.map((s) => s.stage_name)).toEqual([
      "AequilibraE Setup",
      "Network Assignment",
      "Artifact Extraction",
      "ActivitySim Bundle & Preflight",
    ]);
  });

  it("runs the sketch activity model in-process and records screening KPIs", async () => {
    const response = await postModelRun(
      launchRequest({ engineKey: "sketch_abm" }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(201);
    // scenario_attach tells callers the sketch branch records the run only —
    // attach-as-evidence wiring did not execute.
    expect(await response.json()).toMatchObject({
      modelRunId: expect.any(String),
      status: "succeeded",
      scenario_attach: "recorded-only",
    });

    // Run row inserted as running with the sketch engine key.
    expect(modelRunInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ engine_key: "sketch_abm", status: "running" })
    );

    // KPI rows registered in one insert, all run-scoped in the sketch category.
    expect(modelRunKpisInsertMock).toHaveBeenCalledTimes(1);
    const kpiRows = modelRunKpisInsertMock.mock.calls[0][0] as Array<{
      run_id: string;
      kpi_name: string;
      kpi_category: string;
      value: number | null;
      unit: string;
      breakdown_json: Record<string, unknown>;
    }>;

    for (const row of kpiRows) {
      expect(row.kpi_category).toBe("sketch_abm");
      expect(row.run_id).toEqual(expect.any(String));
    }

    const byName = new Map(kpiRows.map((row) => [row.kpi_name, row]));
    for (const required of [
      "total_tours",
      "total_trips",
      "mode_share_auto",
      "mode_share_transit",
      "mode_share_walk",
      "mode_share_bike",
      "mode_share_shared",
      "daily_vmt",
      "vmt_per_capita",
      "population_total",
    ]) {
      expect(byName.has(required)).toBe(true);
    }

    // Real runABM over the 3-zone fixture produced actual travel.
    expect(byName.get("total_trips")!.value).toBeGreaterThan(0);

    // Expansion weighting: the 2,700-household fixture exceeds the 2,000
    // synthetic cap, so trip-derived KPIs must be scaled by the
    // real-vs-synthetic household ratio (> 1), not reported at sample scale.
    const totalTrips = byName.get("total_trips")!;
    const tripsBreakdown = totalTrips.breakdown_json as {
      sample_trips: number;
      expansion_factor: number;
      synthetic_households: number;
      total_real_households: number;
    };
    expect(tripsBreakdown.total_real_households).toBe(SKETCH_FIXTURE_REAL_HOUSEHOLDS);
    expect(tripsBreakdown.synthetic_households).toBeGreaterThan(0);
    expect(tripsBreakdown.synthetic_households).toBeLessThan(SKETCH_FIXTURE_REAL_HOUSEHOLDS);
    expect(tripsBreakdown.expansion_factor).toBeCloseTo(
      SKETCH_FIXTURE_REAL_HOUSEHOLDS / tripsBreakdown.synthetic_households,
      9
    );
    expect(tripsBreakdown.expansion_factor).toBeGreaterThan(1.3);
    // Trips KPI = sample trips × expansion factor (rounded to whole trips).
    expect(totalTrips.value).toBe(
      Math.round(tripsBreakdown.sample_trips * tripsBreakdown.expansion_factor)
    );

    const totalTours = byName.get("total_tours")!;
    const toursBreakdown = totalTours.breakdown_json as {
      sample_tours: number;
      expansion_factor: number;
    };
    expect(toursBreakdown.expansion_factor).toBeCloseTo(tripsBreakdown.expansion_factor, 9);
    expect(totalTours.value).toBe(
      Math.round(toursBreakdown.sample_tours * toursBreakdown.expansion_factor)
    );

    const shareSum = [
      "mode_share_auto",
      "mode_share_transit",
      "mode_share_walk",
      "mode_share_bike",
      "mode_share_shared",
    ].reduce((sum, name) => sum + (byName.get(name)!.value ?? 0), 0);
    expect(shareSum).toBeCloseTo(1, 6);

    // VMT family: exact names, screening-grade provenance, consistent values.
    const dailyVmt = byName.get("daily_vmt")!;
    expect(dailyVmt.unit).toBe("vehicle-miles/day");
    expect(dailyVmt.value).toBeGreaterThan(0);
    const dailyVmtProvenance = String(dailyVmt.breakdown_json.provenance);
    expect(dailyVmtProvenance).toContain("Screening-grade");
    expect(dailyVmtProvenance).toContain("expansion-weighted");
    // Vehicle-mile honesty: occupancy-adjusted HOV, taxi_tnc counted as a
    // vehicle trip, transit_drive access legs documented as excluded.
    expect(dailyVmtProvenance).toContain("auto_hov2 /2");
    expect(dailyVmtProvenance).toContain("auto_hov3 /3.2");
    expect(dailyVmtProvenance).toContain("taxi_tnc x1.0");
    expect(dailyVmtProvenance).toContain("transit_drive");
    expect(dailyVmt.breakdown_json.occupancy_assumptions).toEqual({
      auto_sov: 1,
      auto_hov2: 2,
      auto_hov3: 3.2,
      taxi_tnc: 1,
    });
    expect(dailyVmt.breakdown_json.excluded_modes).toEqual(["transit_drive"]);

    // daily_vmt = sample vehicle-km × expansion factor × km→miles.
    const vmtBreakdown = dailyVmt.breakdown_json as {
      sample_vehicle_km: number;
      expansion_factor: number;
      km_to_miles: number;
    };
    expect(vmtBreakdown.sample_vehicle_km).toBeGreaterThan(0);
    expect(vmtBreakdown.expansion_factor).toBeCloseTo(tripsBreakdown.expansion_factor, 9);
    expect(dailyVmt.value).toBeCloseTo(
      vmtBreakdown.sample_vehicle_km * vmtBreakdown.expansion_factor * vmtBreakdown.km_to_miles,
      6
    );

    const vmtPerCapita = byName.get("vmt_per_capita")!;
    expect(vmtPerCapita.unit).toBe("vehicle-miles/person/day");
    const vmtPerCapitaProvenance = String(vmtPerCapita.breakdown_json.provenance);
    expect(vmtPerCapitaProvenance).toContain("Screening-grade");
    expect(vmtPerCapitaProvenance).toContain("expansion-weighted");
    // Tract set is county-bbox-scale, not a corridor-clipped summary.
    expect(vmtPerCapitaProvenance).toContain("county-bbox-scale");
    expect(vmtPerCapitaProvenance).not.toContain("corridor ACS tract summary");

    const populationTotal = byName.get("population_total")!;
    expect(populationTotal.unit).toBe("persons");
    expect(populationTotal.value).toBe(SKETCH_CENSUS_FIXTURE.totalPopulation);
    // vmt_per_capita divides the EXPANDED daily_vmt by full ACS population.
    expect(vmtPerCapita.value).toBeCloseTo(
      (dailyVmt.value ?? 0) / SKETCH_CENSUS_FIXTURE.totalPopulation,
      9
    );

    // Run row transitioned to succeeded with a caveated summary.
    expect(modelRunUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        result_summary_json: expect.objectContaining({
          engine: "sketch_abm",
          caveat: expect.stringContaining("Screening-grade"),
          // Sketch-grade caveats stored where the evidence-packet
          // normalizer reads them (result_summary_json.caveats).
          caveats: [expect.stringContaining("Screening-grade")],
          total_real_households: SKETCH_FIXTURE_REAL_HOUSEHOLDS,
          expansion_factor: tripsBreakdown.expansion_factor,
        }),
      })
    );

    // Benchmark fit lands in result_summary_json as a screening diagnostic
    // against reference benchmarks (never local observations).
    const succeededUpdate = (
      modelRunUpdateMock.mock.calls as unknown as Array<[Record<string, unknown>]>
    )
      .map((call) => call[0])
      .find((update) => update.status === "succeeded")!;
    const benchmarkFit = (succeededUpdate.result_summary_json as Record<string, unknown>)
      .benchmark_fit as {
      grade: string;
      vmt_percent_error: number;
      mode_split_rmse: number;
      fit_score_0_100: number;
      components: { vmt_score: number; mode_split_score: number };
      modeled: { vmt_per_capita: number; mode_split_pct: Record<string, number> };
      reference: { vmt_per_capita: number; mode_split_pct: Record<string, number> };
      sources: string[];
      recommendation: string;
    };

    expect(benchmarkFit.grade).toBe("sketch_screening");
    // Modeled VMT per capita is the EXPANDED KPI value, reused verbatim.
    expect(benchmarkFit.modeled.vmt_per_capita).toBe(vmtPerCapita.value);
    // Scored against the CEQA-screen operator-default reference (22.0).
    expect(benchmarkFit.reference.vmt_per_capita).toBe(22);
    expect(benchmarkFit.vmt_percent_error).toBeCloseTo(
      (((vmtPerCapita.value ?? 0) - 22) / 22) * 100,
      9
    );
    expect(benchmarkFit.components.vmt_score).toBeCloseTo(
      Math.max(0, 100 - Math.abs(benchmarkFit.vmt_percent_error) * 2),
      9
    );
    expect(benchmarkFit.components.mode_split_score).toBeCloseTo(
      Math.max(0, 100 - benchmarkFit.mode_split_rmse * 10),
      9
    );
    expect(benchmarkFit.fit_score_0_100).toBeCloseTo(
      (benchmarkFit.components.vmt_score + benchmarkFit.components.mode_split_score) / 2,
      9
    );
    // Modeled split is in percentage points and matches the KPI shares (0–1).
    const modeledSplitSum = Object.values(benchmarkFit.modeled.mode_split_pct).reduce(
      (sum, share) => sum + share,
      0
    );
    expect(modeledSplitSum).toBeCloseTo(100, 6);
    expect(benchmarkFit.modeled.mode_split_pct.auto / 100).toBeCloseTo(
      byName.get("mode_share_auto")!.value ?? 0,
      9
    );
    expect(benchmarkFit.sources.join(" ")).toContain("not a local observation");
    expect(typeof benchmarkFit.recommendation).toBe("string");
    // Screening claim boundary: no strong-claim vocabulary in the block.
    expect(JSON.stringify(benchmarkFit)).not.toMatch(/validat|calibrat|forecast/i);

    // Successful sketch launch records a quota-weighted usage event.
    expect(recordUsageEventBestEffortMock).toHaveBeenCalledTimes(1);
    expect(recordUsageEventBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        eventKey: "model_run.launch",
        bucketKey: "runs",
        weight: 5,
        idempotencyKey: expect.stringMatching(/^model_run:.+:launch$/),
      }),
      expect.anything()
    );
  });

  it("marks the run failed and returns 500 when sketch input fetch fails", async () => {
    fetchCensusForCorridorMock.mockRejectedValue(new Error("census upstream unavailable"));

    const response = await postModelRun(
      launchRequest({ engineKey: "sketch_abm" }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "census upstream unavailable" });

    expect(modelRunKpisInsertMock).not.toHaveBeenCalled();
    expect(modelRunUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_message: "census upstream unavailable",
      })
    );
    expect(mockAudit.error).toHaveBeenCalledWith(
      "sketch_abm_model_run_failed",
      expect.objectContaining({ modelId: MODEL_ID, message: "census upstream unavailable" })
    );
  });

  it("reroutes to the AequilibraE worker when the study area exceeds the 150-tract sketch zone cap", async () => {
    fetchCensusForCorridorMock.mockResolvedValue({
      tracts: Array.from({ length: 151 }, (_, index) => ({
        geoid: `06021${String(index + 1).padStart(6, "0")}`,
        population: 100,
        totalHouseholds: 40,
      })),
      totalPopulation: 15100,
      totalCommuters: 6000,
    });

    const response = await postModelRun(
      launchRequest({ engineKey: "sketch_abm" }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    // Non-silent handoff, not a 422 refusal: the run is queued on the worker.
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      status?: string;
      engineKey?: string;
      reroutedFrom?: string;
      reason?: string;
      notice?: string;
    };
    expect(payload.status).toBe("queued");
    expect(payload.engineKey).toBe("aequilibrae");
    expect(payload.reroutedFrom).toBe("sketch_abm");
    expect(payload.reason).toBe("large_study_area");
    expect(payload.notice).toContain("151 census tracts");
    expect(payload.notice).toContain("AequilibraE");

    // The run row is flipped to a queued aequilibrae run with stamped provenance.
    expect(modelRunUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        engine_key: "aequilibrae",
        status: "queued",
        started_at: null,
        input_snapshot_json: expect.objectContaining({
          reroutedFromEngine: "sketch_abm",
          rerouteReason: "large_study_area",
          requestedTractCount: 151,
        }),
        result_summary_json: expect.objectContaining({
          rerouted_from: "sketch_abm",
          reroute_reason: "large_study_area",
        }),
      })
    );

    // Worker stages are queued; no sketch KPIs; the launch is metered once.
    expect(modelRunStagesInsertMock).toHaveBeenCalledTimes(1);
    const stages = modelRunStagesInsertMock.mock.calls[0][0] as Array<{ stage_name: string }>;
    expect(stages.map((s) => s.stage_name)).toEqual([
      "AequilibraE Setup",
      "Network Assignment",
      "Artifact Extraction",
    ]);
    expect(modelRunKpisInsertMock).not.toHaveBeenCalled();
    expect(recordUsageEventBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ engineKey: "aequilibrae", reroutedFrom: "sketch_abm" }),
      }),
      expect.anything()
    );
    expect(mockAudit.info).toHaveBeenCalledWith(
      "sketch_abm_rerouted_to_worker",
      expect.objectContaining({ modelId: MODEL_ID, tractCount: 151 })
    );
  });

  it("gates the sketch branch behind an active subscription with 402", async () => {
    workspaceMaybeSingleMock.mockResolvedValue({
      data: { plan: "pilot", subscription_plan: "pilot", subscription_status: "canceled" },
      error: null,
    });

    const response = await postModelRun(
      launchRequest({ engineKey: "sketch_abm" }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({
      error: "Workspace subscription is not active. Start or resume billing to run analyses.",
    });

    // Gated before any run row, upstream fetch, or usage recording.
    expect(modelRunInsertMock).not.toHaveBeenCalled();
    expect(fetchCensusForCorridorMock).not.toHaveBeenCalled();
    expect(modelRunKpisInsertMock).not.toHaveBeenCalled();
    expect(recordUsageEventBestEffortMock).not.toHaveBeenCalled();
  });

  const TRIP_GEN_PROGRAM = {
    lineItems: [
      { rateKey: "single_family_detached", quantity: 100 },
      { rateKey: "retail_neighborhood", quantity: 20, internalCaptureShare: 0.1, passByShare: 0.3 },
    ],
    avgTripLengthMiles: 5,
    comparisonBasis: "no_build_zero",
  };

  it("runs the trip-generation engine in-process with no corridor and records namespaced KPIs", async () => {
    const response = await postModelRun(
      launchRequest({ engineKey: "ite_trip_generation", tripGenProgram: TRIP_GEN_PROGRAM }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      status: "succeeded",
      scenario_attach: "recorded-only",
    });

    // No corridor-dependent fetches for a land-use program engine.
    expect(fetchCensusForCorridorMock).not.toHaveBeenCalled();
    expect(fetchLODESForCorridorMock).not.toHaveBeenCalled();

    expect(modelRunInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ engine_key: "ite_trip_generation", status: "running" })
    );

    const kpiRows = modelRunKpisInsertMock.mock.calls[0][0] as Array<{
      kpi_name: string;
      kpi_category: string;
      value: number | null;
      breakdown_json: Record<string, unknown>;
    }>;
    expect(kpiRows.map((row) => row.kpi_name).sort()).toEqual([
      "project_am_peak_hour_trip_ends",
      "project_daily_trip_ends",
      "project_daily_vmt_screen",
      "project_pm_peak_hour_trip_ends",
      "project_program_units",
    ]);
    for (const row of kpiRows) {
      expect(row.kpi_category).toBe("ite_trip_generation");
      expect(row.breakdown_json.caveat).toEqual(expect.stringContaining("NOT a CEQA"));
    }
    // 100 SFD × 10 = 1000 gross; retail 20 ksf × 120 × 0.9 × 0.7 = 1512; net 2512.
    const daily = kpiRows.find((row) => row.kpi_name === "project_daily_trip_ends");
    expect(daily?.value).toBe(2512);
    const vmt = kpiRows.find((row) => row.kpi_name === "project_daily_vmt_screen");
    expect(vmt?.value).toBe(12560);

    // Provenance update stamps the full screening caveat for evidence packets.
    expect(modelRunUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        result_summary_json: expect.objectContaining({
          engine: "ite_trip_generation",
          caveats: [expect.stringContaining("NOT a traffic impact study")],
          net_daily_trip_ends: 2512,
          comparison_basis: "no_build_zero",
          program_source: "inline",
          assumption_set_id: null,
        }),
      })
    );

    expect(recordUsageEventBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ engineKey: "ite_trip_generation" }),
      }),
      mockAudit
    );
  });

  it("fails the run with 422 when no land-use program is available", async () => {
    const response = await postModelRun(
      launchRequest({ engineKey: "ite_trip_generation" }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("No land-use program"),
    });
    // The run row was created, then honestly marked failed.
    expect(modelRunInsertMock).toHaveBeenCalled();
    expect(modelRunUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error_message: expect.stringContaining("No land-use program") })
    );
    expect(modelRunKpisInsertMock).not.toHaveBeenCalled();
    expect(recordUsageEventBestEffortMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid program (negative quantity) with 422, never a silent zero", async () => {
    const response = await postModelRun(
      launchRequest({
        engineKey: "ite_trip_generation",
        tripGenProgram: {
          ...TRIP_GEN_PROGRAM,
          lineItems: [{ rateKey: "single_family_detached", quantity: -5 }],
        },
      }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("Invalid quantity"),
    });
    expect(modelRunUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    );
    expect(modelRunKpisInsertMock).not.toHaveBeenCalled();
  });

  it("still requires query/corridor for non-trip-gen engines", async () => {
    modelMaybeSingleMock.mockResolvedValue({
      data: {
        id: MODEL_ID,
        workspace_id: WORKSPACE_ID,
        scenario_set_id: null,
        title: "Bare model",
        model_family: "travel_demand",
        config_version: "v1",
        config_json: {},
      },
      error: null,
    });

    const response = await postModelRun(
      launchRequest({ engineKey: "sketch_abm" }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("Launch configuration is incomplete"),
    });
    expect(modelRunInsertMock).not.toHaveBeenCalled();
  });

  const SET_ID = "55555555-5555-4555-8555-555555555555";
  const ENTRY_ID = "66666666-6666-4666-8666-666666666666";

  it("resolves the program from an assumption set and stamps honest provenance", async () => {
    assumptionSetMaybeSingleMock.mockResolvedValue({
      data: {
        id: SET_ID,
        scenario_set_id: "77777777-7777-4777-8777-777777777777",
        assumptions_json: { tripGenProgram: TRIP_GEN_PROGRAM },
        scenario_sets: { workspace_id: WORKSPACE_ID },
      },
      error: null,
    });

    const response = await postModelRun(
      launchRequest({ engineKey: "ite_trip_generation", assumptionSetId: SET_ID }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(201);
    expect(modelRunUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        result_summary_json: expect.objectContaining({
          program_source: "assumption_set",
          assumption_set_id: SET_ID,
        }),
      })
    );
  });

  it("rejects an assumption set from another workspace with 400 before any run insert", async () => {
    assumptionSetMaybeSingleMock.mockResolvedValue({
      data: {
        id: SET_ID,
        scenario_set_id: "77777777-7777-4777-8777-777777777777",
        assumptions_json: { tripGenProgram: TRIP_GEN_PROGRAM },
        // The caller can READ this set via RLS (they are a member of its
        // workspace) — but it is not the model's workspace.
        scenario_sets: { workspace_id: "88888888-8888-4888-8888-888888888888" },
      },
      error: null,
    });

    const response = await postModelRun(
      launchRequest({ engineKey: "ite_trip_generation", assumptionSetId: SET_ID }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("model's workspace"),
    });
    expect(modelRunInsertMock).not.toHaveBeenCalled();
    expect(modelRunKpisInsertMock).not.toHaveBeenCalled();
  });

  it("resolves the program from the scenario entry's assumptions (the primary UX path)", async () => {
    scenarioEntryMaybeSingleMock.mockResolvedValue({
      data: {
        id: ENTRY_ID,
        scenario_set_id: "77777777-7777-4777-8777-777777777777",
        label: "Proposed project",
        entry_type: "alternative",
        status: "draft",
        assumptions_json: { tripGenProgram: TRIP_GEN_PROGRAM },
      },
      error: null,
    });

    const response = await postModelRun(
      launchRequest({ engineKey: "ite_trip_generation", scenarioEntryId: ENTRY_ID }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(201);
    expect(modelRunUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        result_summary_json: expect.objectContaining({
          program_source: "scenario_entry",
          assumption_set_id: null,
        }),
      })
    );
  });

  it("fails the run with 422 when the stored entry program is malformed", async () => {
    scenarioEntryMaybeSingleMock.mockResolvedValue({
      data: {
        id: ENTRY_ID,
        scenario_set_id: "77777777-7777-4777-8777-777777777777",
        label: "Proposed project",
        entry_type: "alternative",
        status: "draft",
        assumptions_json: { tripGenProgram: { lineItems: "not-an-array" } },
      },
      error: null,
    });

    const response = await postModelRun(
      launchRequest({ engineKey: "ite_trip_generation", scenarioEntryId: ENTRY_ID }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("malformed"),
    });
    expect(modelRunUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    );
    expect(modelRunKpisInsertMock).not.toHaveBeenCalled();
  });

  it("gates the trip-generation branch behind an active subscription with 402", async () => {
    workspaceMaybeSingleMock.mockResolvedValue({
      data: { plan: "pilot", subscription_plan: "pilot", subscription_status: "canceled" },
      error: null,
    });

    const response = await postModelRun(
      launchRequest({ engineKey: "ite_trip_generation", tripGenProgram: TRIP_GEN_PROGRAM }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(402);
    expect(modelRunInsertMock).not.toHaveBeenCalled();
    expect(modelRunKpisInsertMock).not.toHaveBeenCalled();
  });

  it("queues an aequilibrae run and stamps zoneGeography into the input snapshot", async () => {
    const response = await postModelRun(
      launchRequest({ engineKey: "aequilibrae", zoneGeography: "block_group" }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { status?: string };
    expect(payload.status).toBe("queued");

    expect(modelRunInsertMock).toHaveBeenCalledTimes(1);
    const inserted = modelRunInsertMock.mock.calls[0][0] as {
      engine_key: string;
      status: string;
      input_snapshot_json: Record<string, unknown>;
    };
    expect(inserted.engine_key).toBe("aequilibrae");
    expect(inserted.status).toBe("queued");
    expect(inserted.input_snapshot_json.zoneGeography).toBe("block_group");

    expect(modelRunStagesInsertMock).toHaveBeenCalledTimes(1);
    const stages = modelRunStagesInsertMock.mock.calls[0][0] as Array<{ stage_name: string }>;
    expect(stages.map((s) => s.stage_name)).toEqual([
      "AequilibraE Setup",
      "Network Assignment",
      "Artifact Extraction",
    ]);
  });

  it("omits zoneGeography from the snapshot when not requested (worker env fallback stays in charge)", async () => {
    const response = await postModelRun(
      launchRequest({ engineKey: "aequilibrae" }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(201);
    const inserted = modelRunInsertMock.mock.calls[0][0] as {
      input_snapshot_json: Record<string, unknown>;
    };
    expect("zoneGeography" in inserted.input_snapshot_json).toBe(false);
  });

  it("ignores zoneGeography for engines that don't consume it", async () => {
    const response = await postModelRun(
      launchRequest({ engineKey: "sketch_abm", zoneGeography: "block_group" }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(201);
    const inserted = modelRunInsertMock.mock.calls[0][0] as {
      engine_key: string;
      input_snapshot_json: Record<string, unknown>;
    };
    expect(inserted.engine_key).toBe("sketch_abm");
    expect("zoneGeography" in inserted.input_snapshot_json).toBe(false);
  });

  it("rejects an invalid zoneGeography value with 400", async () => {
    const response = await postModelRun(
      launchRequest({ engineKey: "aequilibrae", zoneGeography: "county" }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(400);
    expect(modelRunInsertMock).not.toHaveBeenCalled();
  });
});
