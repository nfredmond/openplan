import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildActivitySimHandoffPayload } from "@/lib/models/activitysim-handoff";

describe("ActivitySim handoff helpers", () => {
  it("summarizes artifact readiness without pretending ActivitySim ran", () => {
    const payload = buildActivitySimHandoffPayload({
      modelId: "model-123",
      modelRunId: "run-123",
      repoRoot: path.resolve(process.cwd()),
      runRecord: {
        id: "run-123",
        status: "succeeded",
        engine_key: "aequilibrae",
        input_snapshot_json: {
          orchestration: {
            pipelineKey: "aequilibrae_activitysim_handoff_v1",
            honestCapability: "Builds a handoff package only.",
          },
        },
      },
      artifacts: [
        {
          artifact_type: "skim_matrix",
          file_url: "local:///tmp/skims.omx",
          content_hash: "skim123",
          file_size_bytes: 2048,
        },
        {
          artifact_type: "demand_matrix",
          file_url: "local:///tmp/demand.omx",
          content_hash: "demand123",
          file_size_bytes: 1024,
        },
        {
          artifact_type: "evidence_packet",
          file_url: "local:///tmp/evidence.json",
          content_hash: "evidence123",
          file_size_bytes: 512,
        },
      ],
      stages: [
        {
          stage_name: "ActivitySim Handoff Package",
          status: "succeeded",
        },
      ],
    });

    expect(payload.pipelineKey).toBe("aequilibrae_activitysim_handoff_v1");
    expect(payload.aequilibraeArtifacts.map((artifact) => artifact.artifactType)).toEqual(
      expect.arrayContaining(["skim_matrix", "demand_matrix", "evidence_packet"])
    );
    expect(payload.readyChecks.find((check) => check.key === "aequilibrae-skims")).toMatchObject({ status: "ready" });
    expect(payload.notes.join(" ")).toContain("handoff package only");
    expect(payload.summary).toContain("adapter packaging");
  });
});
