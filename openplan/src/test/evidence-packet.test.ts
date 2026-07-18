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
