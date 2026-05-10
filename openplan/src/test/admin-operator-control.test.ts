import { describe, expect, it } from "vitest";
import { buildPilotReadinessControlSummary } from "@/lib/operations/admin-operator-control";
import { finalPilotReadinessChecklistSync, releaseProofPosture } from "@/lib/operations/release-proof-packet";
import type { SmokeStatus } from "@/lib/operations/pilot-readiness";

function lane(laneName: string, status: SmokeStatus["status"], lastRun = "2026-05-10"): SmokeStatus {
  return {
    lane: laneName,
    status,
    lastRun,
    details: `${laneName.toLowerCase().replaceAll(" ", "-")}.md`,
  };
}

describe("admin operator control summary", () => {
  it("summarizes supervised pilot readiness without implying self-serve activation", () => {
    const summary = buildPilotReadinessControlSummary([
      lane("Authenticated Auth", "PASS", "2026-05-09"),
      lane("Production Admin Operations Auth", "PASS", "2026-05-10"),
    ]);

    expect(summary.label).toBe("Ready for supervised review");
    expect(summary.tone).toBe("success");
    expect(summary.latestEvidenceDate).toBe("2026-05-10");
    expect(summary.counts).toMatchObject({ total: 2, pass: 2, fail: 0, pending: 0, unknown: 0 });
    expect(summary.preflightCommand).toContain("pnpm ops:check-pilot-preflight");
    expect(summary.preflightProofArtifact).toBe("docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md");
    expect(summary.preflightProofScope).toContain("Read-only pre-conversation readiness bundle");
    expect(summary.preflightOperatorInstruction).toContain("Run this in a terminal");
    expect(summary.preflightPosture).toContain("read-only preflight");
    expect(summary.detail).toContain("not an autonomous launch certificate");
    expect(summary.supervisedBoundary).toBe(releaseProofPosture.wedge);
    expect(summary.proofPacketCaveat).toBe(finalPilotReadinessChecklistSync.supervisedOnboardingCaveat);
    expect(summary.proofPacketCaveat).toContain("no broad self-serve municipal SaaS claim");
    expect(summary.requiredCaveatCount).toBe(releaseProofPosture.caveats.length);
    expect(summary.proofArtifactCount).toBe(releaseProofPosture.proofItems.length);
  });

  it("holds readiness when any tracked lane is failing", () => {
    const summary = buildPilotReadinessControlSummary([
      lane("Authenticated Auth", "PASS"),
      lane("Managed Run", "FAIL"),
      lane("Aerial Evidence Spine", "PENDING"),
    ]);

    expect(summary.label).toBe("Hold for proof repair");
    expect(summary.tone).toBe("danger");
    expect(summary.counts).toMatchObject({ total: 3, pass: 1, fail: 1, pending: 1, unknown: 0 });
    expect(summary.openProofLaneLabels).toEqual(["Managed Run", "Aerial Evidence Spine"]);
    expect(summary.preflightPosture).toContain("do not provision workspaces");
  });

  it("keeps pending or unknown lanes visible as open proof gaps", () => {
    const summary = buildPilotReadinessControlSummary([
      lane("Authenticated Auth", "PASS"),
      lane("Layout Audit", "UNKNOWN", "Unknown"),
      lane("Grants Flow", "PENDING", "N/A"),
    ]);

    expect(summary.label).toBe("Current with open proof gaps");
    expect(summary.tone).toBe("warning");
    expect(summary.latestEvidenceDate).toBe("2026-05-10");
    expect(summary.detail).toContain("2 still need fresh proof");
    expect(summary.openProofLaneLabels).toEqual(["Layout Audit", "Grants Flow"]);
  });
});
