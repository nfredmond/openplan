import { describe, expect, it } from "vitest";
import {
  buildEvidenceHighlights,
  describeEmploymentProvenance,
  employmentUsedSyntheticFallback,
  formatDurationSeconds,
  labelForArtifactType,
  labelForEngineKey,
  labelForKpiCategory,
  normalizeEvidencePacket,
} from "@/lib/models/evidence-packet";

const LODES_EMPLOYMENT = {
  primary: "lehd_lodes8_wac_s000_jt00",
  year: "2022",
  states_used: ["ca"],
  states_failed: [],
  tracts_from_lodes: 24,
  tracts_from_synthetic_fallback: 2,
  fallback_method: "jobs = round(0.47 × ACS population), floor 25",
  caveat: "Screening-grade. Total jobs are LODES WAC workplace counts where available.",
};

function normalizeMinimal(rawPacket: Record<string, unknown>) {
  return normalizeEvidencePacket({
    rawPacket,
    modelId: "model-123",
    modelRunId: "run-123",
    modelTitle: "Minimal",
    runRecord: { id: "run-123", status: "succeeded", engine_key: "aequilibrae" },
    artifacts: [],
    stages: [],
    kpis: [],
  });
}

const BENCHMARK_FIT_BLOCK = {
  grade: "sketch_screening",
  vmt_percent_error: -12.5,
  mode_split_rmse: 3.2,
  fit_score_0_100: 71.5,
  components: { vmt_score: 75, mode_split_score: 68 },
  reference: {
    vmt_per_capita: 22,
    mode_split_pct: { auto: 88, transit: 1.5, walk: 6, bike: 1.5, shared: 3 },
  },
  sources: ["Reference benchmark source note"],
  recommendation: "Directional only — review assumptions",
};

const NORMALIZED_BENCHMARK_FIT = {
  grade: "sketch_screening",
  vmt_percent_error: -12.5,
  mode_split_rmse: 3.2,
  fit_score_0_100: 71.5,
  components: { vmt_score: 75, mode_split_score: 68 },
  reference: BENCHMARK_FIT_BLOCK.reference,
  sources: ["Reference benchmark source note"],
  recommendation: "Directional only — review assumptions",
};

describe("benchmark fit mapping", () => {
  it("maps a top-level raw benchmark_fit block onto the normalized packet", () => {
    expect(normalizeMinimal({ benchmark_fit: BENCHMARK_FIT_BLOCK }).benchmark_fit).toEqual(
      NORMALIZED_BENCHMARK_FIT
    );
  });

  it("maps benchmark_fit from the run row's result_summary_json on the synthesized path", () => {
    const packet = normalizeEvidencePacket({
      modelId: "model-123",
      modelRunId: "run-123",
      modelTitle: "Sketch run",
      runRecord: {
        id: "run-123",
        status: "succeeded",
        engine_key: "sketch_abm",
        result_summary_json: {
          engine: "sketch_abm",
          benchmark_fit: BENCHMARK_FIT_BLOCK,
          caveats: ["Screening-grade sketch output over a synthetic population."],
        },
      },
      artifacts: [],
      stages: [],
      kpis: [],
    });

    expect(packet.benchmark_fit).toEqual(NORMALIZED_BENCHMARK_FIT);
    // result_summary_json.caveats surface on the packet caveat list.
    expect(packet.caveats).toContain("Screening-grade sketch output over a synthetic population.");
  });

  it("maps benchmark_fit from raw.outputs.result_summary (re-normalizing an API payload)", () => {
    const packet = normalizeMinimal({
      outputs: { result_summary: { benchmark_fit: BENCHMARK_FIT_BLOCK } },
    });

    expect(packet.benchmark_fit).toEqual(NORMALIZED_BENCHMARK_FIT);
  });

  it("leaves benchmark_fit null when no block is present anywhere", () => {
    expect(normalizeMinimal({ engine: "AequilibraE 1.6.1" }).benchmark_fit).toBeNull();
    expect(
      normalizeEvidencePacket({
        modelId: "model-123",
        modelRunId: "run-123",
        modelTitle: "No fit",
        runRecord: {
          id: "run-123",
          status: "succeeded",
          engine_key: "sketch_abm",
          result_summary_json: { engine: "sketch_abm", benchmark_fit: null },
        },
        artifacts: [],
        stages: [],
        kpis: [],
      }).benchmark_fit
    ).toBeNull();
  });

  it("maps malformed benchmark_fit fields defensively to nulls", () => {
    const packet = normalizeMinimal({
      benchmark_fit: {
        vmt_percent_error: "not-a-number",
        fit_score_0_100: Number.NaN,
        components: "broken",
        sources: [42, "kept"],
      },
    });

    expect(packet.benchmark_fit).toEqual({
      grade: "sketch_screening",
      vmt_percent_error: null,
      mode_split_rmse: null,
      fit_score_0_100: null,
      components: { vmt_score: null, mode_split_score: null },
      reference: {},
      sources: ["kept"],
      recommendation: null,
    });
  });
});

describe("employment provenance", () => {
  it("maps the worker packet employment block onto the normalized packet", () => {
    expect(normalizeMinimal({ employment: LODES_EMPLOYMENT }).employment).toEqual(LODES_EMPLOYMENT);
  });

  it("leaves employment null for packets without the block", () => {
    expect(normalizeMinimal({ engine: "AequilibraE 1.6.1" }).employment).toBeNull();
  });

  it("describes LODES coverage including the fallback tract count", () => {
    expect(describeEmploymentProvenance(LODES_EMPLOYMENT)).toBe(
      "LEHD LODES8 WAC S000/JT00 2022 — 24 tracts (states ca); 2 tracts from the population-share fallback"
    );
    expect(employmentUsedSyntheticFallback(LODES_EMPLOYMENT)).toBe(true);
  });

  it("labels a fully synthetic run and full LODES coverage correctly", () => {
    const synthetic = {
      ...LODES_EMPLOYMENT,
      tracts_from_lodes: 0,
      tracts_from_synthetic_fallback: 26,
      states_used: [],
    };
    expect(describeEmploymentProvenance(synthetic)).toContain("Synthetic employment");
    expect(employmentUsedSyntheticFallback(synthetic)).toBe(true);

    const fullCoverage = { ...LODES_EMPLOYMENT, tracts_from_synthetic_fallback: 0 };
    expect(describeEmploymentProvenance(fullCoverage)).toBe(
      "LEHD LODES8 WAC S000/JT00 2022 — 24 tracts (states ca)"
    );
    expect(employmentUsedSyntheticFallback(fullCoverage)).toBe(false);
  });
});

describe("evidence packet helpers", () => {
  it("normalizes legacy worker packet shape into planner-safe structure", () => {
    const packet = normalizeEvidencePacket({
      rawPacket: {
        run_id: "run-123",
        engine: "AequilibraE 1.6.1",
        network_source: "OpenStreetMap",
        algorithm: "BFW",
        vdf: "BPR",
        network: { zones: 14, links: 220, nodes: 180 },
        demand: { total_trips: 42000, routable_trips: 39900 },
        skims: { avg_time_min: 18.4, max_time_min: 61.2 },
        convergence: { final_gap: 0.0048, iterations: 11 },
        loaded_links: 95,
        model_area: "Dynamic study area",
        caveats: ["Uncalibrated"],
        created_at: "2026-03-20T23:00:00.000Z",
      },
      modelId: "model-123",
      modelRunId: "run-123",
      modelTitle: "Nevada County baseline",
      runRecord: {
        id: "run-123",
        status: "succeeded",
        engine_key: "aequilibrae",
        query_text: "Evaluate baseline",
        corridor_geojson: { type: "Polygon", coordinates: [] },
        input_snapshot_json: { launchedAt: "2026-03-20T22:59:00.000Z" },
        assumption_snapshot_json: { scenario: "baseline" },
        result_summary_json: { overallScore: 82 },
        started_at: "2026-03-20T22:59:00.000Z",
        completed_at: "2026-03-20T23:04:00.000Z",
      },
      artifacts: [
        {
          artifact_type: "skim_matrix",
          file_url: "local:///tmp/skims.omx",
          content_hash: "abc123",
          file_size_bytes: 2048,
        },
      ],
      stages: [
        {
          stage_name: "Network Assignment",
          status: "succeeded",
          started_at: "2026-03-20T23:00:00.000Z",
          completed_at: "2026-03-20T23:02:00.000Z",
        },
      ],
      kpis: [
        {
          kpi_category: "assignment",
          kpi_name: "avg_travel_time",
          kpi_label: "Avg Travel Time",
          value: 18.4,
          unit: "min",
        },
      ],
    });

    expect(packet.model_id).toBe("model-123");
    expect(packet.model_title).toBe("Nevada County baseline");
    expect(packet.inputs.zone_count).toBe(14);
    expect(packet.outputs.artifacts[0]).toMatchObject({
      type: "skim_matrix",
      file_url: "local:///tmp/skims.omx",
      hash: "abc123",
    });
    expect(packet.outputs.stages[0]).toMatchObject({
      name: "Network Assignment",
      status: "succeeded",
      duration_s: 120,
    });
    expect(packet.outputs.kpi_summary.assignment?.[0]).toMatchObject({
      label: "Avg Travel Time",
      value: 18.4,
      unit: "min",
    });
    expect(packet.outputs.engine_summary).toMatchObject({
      network: { zones: 14, links: 220, nodes: 180 },
      demand: { total_trips: 42000, routable_trips: 39900 },
      loaded_links: 95,
      algorithm: "BFW",
      vdf: "BPR",
    });
    expect(packet.provenance.source_packet_format).toBe("worker-legacy");
  });

  it("builds useful highlight cards from normalized evidence", () => {
    const packet = normalizeEvidencePacket({
      rawPacket: {
        outputs: {
          engine_summary: {
            network: { zones: 22, links: 340 },
            demand: { total_trips: 118000 },
            skims: { avg_time_min: 23.7 },
            convergence: { final_gap: 0.0082 },
            loaded_links: 140,
          },
        },
      },
      modelId: "model-456",
      modelRunId: "run-456",
      modelTitle: "Alternative A",
      runRecord: { id: "run-456", status: "succeeded", engine_key: "aequilibrae" },
      artifacts: [],
      stages: [],
      kpis: [],
    });

    expect(buildEvidenceHighlights(packet)).toEqual([
      expect.objectContaining({ label: "Zones", value: "22" }),
      expect.objectContaining({ label: "Links", value: "340" }),
      expect.objectContaining({ label: "Trips", value: "118,000" }),
      expect.objectContaining({ label: "Avg travel time", value: "23.7 min" }),
      expect.objectContaining({ label: "Loaded links", value: "140" }),
      expect.objectContaining({ label: "Relative gap", value: "0.0082" }),
    ]);
  });

  it("labels the Zones highlight with the worker-stamped zone geography", () => {
    const packet = normalizeEvidencePacket({
      rawPacket: {
        network: { zones: 24, links: 12154 },
        zones: { zone_geography: "block_group", count: 24, demand_method: "lodes_seeded_gravity_v1" },
      },
      modelId: "model-bg",
      modelRunId: "run-bg",
      modelTitle: "BG run",
      runRecord: { id: "run-bg", status: "succeeded", engine_key: "aequilibrae" },
      artifacts: [],
      stages: [],
      kpis: [],
    });

    const zonesHighlight = buildEvidenceHighlights(packet).find((h) => h.label === "Zones");
    expect(zonesHighlight?.detail).toBe("Dynamic block-group centroids carried into the model package.");
  });

  it("keeps the tract Zones wording for packets without a zone-geography stamp", () => {
    const packet = normalizeEvidencePacket({
      rawPacket: { network: { zones: 8 } },
      modelId: "model-legacy",
      modelRunId: "run-legacy",
      modelTitle: "Legacy run",
      runRecord: { id: "run-legacy", status: "succeeded", engine_key: "aequilibrae" },
      artifacts: [],
      stages: [],
      kpis: [],
    });

    const zonesHighlight = buildEvidenceHighlights(packet).find((h) => h.label === "Zones");
    expect(zonesHighlight?.detail).toBe("Dynamic tract centroids carried into the model package.");
  });

  it("falls back to behavioral-onramp KPI highlights when no engine summary is present", () => {
    const packet = normalizeEvidencePacket({
      modelId: "model-789",
      modelRunId: "run-789",
      modelTitle: "Behavioral onramp",
      runRecord: { id: "run-789", status: "succeeded", engine_key: "behavioral_demand" },
      artifacts: [],
      stages: [],
      kpis: [
        {
          kpi_category: "behavioral_onramp",
          kpi_name: "total_trips",
          kpi_label: "Total trips (behavioral)",
          value: 20668,
          unit: "trips",
        },
        {
          kpi_category: "behavioral_onramp",
          kpi_name: "loaded_links",
          kpi_label: "Loaded links",
          value: 1241,
          unit: "links",
        },
        {
          kpi_category: "behavioral_onramp",
          kpi_name: "final_gap",
          kpi_label: "Assignment final gap",
          value: 0.0068,
          unit: "ratio",
        },
        {
          kpi_category: "behavioral_onramp",
          kpi_name: "zone_count",
          kpi_label: "Zones with activity",
          value: 9,
          unit: "zones",
        },
      ],
    });

    expect(buildEvidenceHighlights(packet)).toEqual([
      expect.objectContaining({ label: "Behavioral trips", value: "20,668" }),
      expect.objectContaining({ label: "Loaded links", value: "1,241" }),
      expect.objectContaining({ label: "Relative gap", value: "0.0068" }),
      expect.objectContaining({ label: "Zones", value: "9" }),
    ]);
  });

  it("formats labels and durations for the run surface", () => {
    expect(labelForEngineKey("deterministic_corridor_v1")).toBe("Deterministic Corridor");
    expect(labelForEngineKey("aequilibrae")).toBe("AequilibraE");
    expect(labelForEngineKey("behavioral_demand")).toBe("Behavioral Demand");
    expect(labelForEngineKey("sketch_abm")).toBe("Sketch Activity Model");
    expect(labelForArtifactType("volumes_geojson")).toBe("Volumes Geojson");
    expect(labelForArtifactType("behavioral_kpi_summary_json")).toBe("Behavioral KPI Summary");
    expect(labelForKpiCategory("behavioral_onramp")).toBe("Behavioral Onramp");
    expect(labelForKpiCategory("scenario-equity_delta")).toBe("Scenario Equity Delta");
    expect(formatDurationSeconds(45)).toBe("45s");
    expect(formatDurationSeconds(125)).toBe("2m 5s");
    expect(formatDurationSeconds(7200)).toBe("2h");
  });
});
