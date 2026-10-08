import { describe, expect, it } from "vitest";
import { verifySynthesisProgress } from "@/lib/engagement/synthesis-progress";
import type { SynthesisExecutionScope } from "@/lib/engagement/synthesis-execution-records";

const id = (n: number) => `c7600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope: SynthesisExecutionScope = { campaignId: id(1), workspaceId: id(2), requestId: id(3), actorId: id(4), sourceId: id(5),
  sourceSha256: "a".repeat(64), requestIntentSha256: "b".repeat(64), stage: "segment" };
const original = { schemaVersion: 1, ...scope, checkedAt: "2026-10-07T01:00:00Z", cancelled: false,
  status: "incomplete", interpretation: "not_assessed", selectionSequence: 2, manifestSha256: "c".repeat(64), taskCount: 3,
  counts: [{ disposition: "validated_output", count: 1 }, { disposition: "awaiting_result", count: 1 }, { disposition: "not_started", count: 1 }] };

describe("private synthesis progress transport", () => {
  it.each(["context", "thematic"] as const)("validates a separate %s resource assessment", stage => {
    const next = { ...original, stage, interpretation: "machine_unreviewed", counts: [{ disposition: "unselected", count: 3 }],
      resourceAssessment: { taskIndex: 0, requiredTaskBytes: 68699, taskByteLimit: 65536 } };
    expect(verifySynthesisProgress(next, { ...scope, stage })).toEqual(next);
    for (const patch of [{ taskIndex: 3 }, { requiredTaskBytes: 65536 }, { requiredTaskBytes: 65535 }, { taskByteLimit: 0 }, { requiredTaskBytes: 1.5 }]) {
      expect(() => verifySynthesisProgress({ ...next, resourceAssessment: { ...next.resourceAssessment, ...patch } }, { ...scope, stage })).toThrow();
    }
    expect(() => verifySynthesisProgress({ ...original, resourceAssessment: next.resourceAssessment }, scope)).toThrow(/resource assessment/);
  });

  it("keeps incomplete work distinct from successful output and no selected attempt", () => {
    expect(verifySynthesisProgress(original, scope)).toEqual(original);
  });
  it.each(["campaignId", "workspaceId", "requestId", "actorId", "sourceId", "sourceSha256", "requestIntentSha256", "stage"])("rejects different %s", field => {
    const value = field.endsWith("Sha256") ? "d".repeat(64) : field === "stage" ? "context" : id(99);
    expect(() => verifySynthesisProgress({ ...original, [field]: value }, scope)).toThrow(/another request/);
  });
  it.each([
    { taskCount: 2 }, { counts: [{ disposition: "not_started", count: 3 }, { disposition: "not_started", count: 1 }], taskCount: 4 },
    { status: "ready_for_record_consolidation" }, { interpretation: "machine_unreviewed" }, { status: "frames_complete" },
    { status: "empty_selection" }, { counts: [{ disposition: "claimed", count: 3 }] },
  ])("refuses contradictory counts or claim tiers: %j", change => {
    expect(() => verifySynthesisProgress({ ...original, ...change }, scope)).toThrow();
  });
  it.each(["context", "thematic"] as const)("accepts completed unreviewed %s outputs", stage => {
    const next = { ...original, stage, status: stage === "context" ? "frames_complete" : "proposal_complete", interpretation: "machine_unreviewed",
      counts: [{ disposition: "verified", count: 3 }], cancelled: true };
    expect(verifySynthesisProgress(next, { ...scope, stage })).toEqual(next);
  });
  it("keeps unsealed thematic task counts unknown", () => {
    const next = { ...original, stage: "thematic" as const, status: "inputs_not_sealed", interpretation: "machine_unreviewed",
      taskCount: null, selectionSequence: null, counts: [] };
    expect(verifySynthesisProgress(next, { ...scope, stage: "thematic" }).taskCount).toBeNull();
    expect(() => verifySynthesisProgress({ ...next, taskCount: 0 }, { ...scope, stage: "thematic" })).toThrow(/accounting/);
  });
  it("does not accept zero-task completion or unknown transport fields", () => {
    expect(() => verifySynthesisProgress({ ...original, status: "ready_for_record_consolidation", taskCount: 0, counts: [] }, scope)).toThrow(/completion/);
    expect(() => verifySynthesisProgress({ ...original, providerSecret: "PRIVATE" }, scope)).toThrow();
  });
});
