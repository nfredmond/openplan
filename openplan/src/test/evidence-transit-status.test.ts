import { describe, expect, it } from "vitest";
import { evidenceTransitStatus, normalizeEvidencePacket } from "@/lib/models/evidence-packet";

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

describe("evidenceTransitStatus", () => {
  it("carries mode_split into engine_summary and reads transit_status", () => {
    const packet = normalizeMinimal({
      engine: "aequilibrae",
      mode_split: { transit_status: "no_local_feed", auto_mode_share_pct: 94.5 },
    });
    expect((packet.outputs.engine_summary as Record<string, unknown>).mode_split).toMatchObject({
      transit_status: "no_local_feed",
    });
    expect(evidenceTransitStatus(packet)).toBe("no_local_feed");
  });

  it("recognizes each valid worker transit status", () => {
    for (const status of ["modeled", "no_local_feed", "feed_unavailable", "not_run"]) {
      const packet = normalizeMinimal({ engine: "aequilibrae", mode_split: { transit_status: status } });
      expect(evidenceTransitStatus(packet)).toBe(status);
    }
  });

  it("returns null when the packet records no transit status (e.g. sketch/ite)", () => {
    expect(evidenceTransitStatus(normalizeMinimal({ engine: "sketch_abm" }))).toBeNull();
  });

  it("ignores an unrecognized transit_status value rather than surfacing garbage", () => {
    const packet = normalizeMinimal({ engine: "aequilibrae", mode_split: { transit_status: "bogus" } });
    expect(evidenceTransitStatus(packet)).toBeNull();
  });
});
