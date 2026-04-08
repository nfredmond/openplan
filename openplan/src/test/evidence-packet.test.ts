import { describe, expect, it } from "vitest";
import {
  buildEvidenceHighlights,
  formatDurationSeconds,
  labelForArtifactType,
  labelForEngineKey,
  normalizeEvidencePacket,
} from "@/lib/models/evidence-packet";

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

  it("formats labels and durations for the run surface", () => {
    expect(labelForEngineKey("deterministic_corridor_v1")).toBe("Deterministic Corridor");
    expect(labelForEngineKey("aequilibrae")).toBe("AequilibraE");
    expect(labelForEngineKey("behavioral_demand")).toBe("Behavioral Demand");
    expect(labelForArtifactType("volumes_geojson")).toBe("Volumes Geojson");
    expect(labelForArtifactType("behavioral_kpi_summary_json")).toBe("Behavioral KPI Summary");
    expect(formatDurationSeconds(45)).toBe("45s");
    expect(formatDurationSeconds(125)).toBe("2m 5s");
    expect(formatDurationSeconds(7200)).toBe("2h");
  });
});
