import { describe, expect, it } from "vitest";
import type { ProjectGrantModelingEvidence } from "@/lib/grants/modeling-evidence";

import {
  buildGrantEvidenceReadinessCues,
  summarizeGrantEvidenceReadiness,
} from "@/lib/grants/evidence-readiness";


function modelingEvidence(): ProjectGrantModelingEvidence {
  return {
    projectId: "project-1",
    comparisonBackedCount: 1,
    leadComparisonReport: {
      id: "report-1",
      title: "Scenario comparison packet",
      href: "/reports/report-1#packet-release-review",
      packetFreshness: {
        label: "Packet current",
        tone: "success",
        detail: "Packet is current.",
      },
      comparisonAggregate: {
        comparisonSnapshotCount: 1,
        readyComparisonSnapshotCount: 1,
        indicatorDeltaCount: 3,
        latestComparisonSnapshotUpdatedAt: "2026-05-09T12:00:00.000Z",
      },
      comparisonDigest: {
        headline: "1 saved comparison · 1 ready",
        detail: "3 indicator deltas are already summarized.",
      },
    },
  };
}

function opportunity(overrides = {}) {
  return {
    fit_notes: null,
    readiness_notes: null,
    decision_rationale: null,
    expected_award_amount: null,
    project_id: null,
    program_id: null,
    closes_at: null,
    decision_due_at: null,
    project: null,
    program: null,
    ...overrides,
  };
}

describe("grant evidence readiness", () => {
  it("keeps incomplete opportunities in supervised operator review", () => {
    const cues = buildGrantEvidenceReadinessCues(opportunity(), null);

    expect(cues.map((cue) => cue.key)).toEqual([
      "funding-source-fit",
      "source-artifact-anchors",
      "modeling-boundary",
      "match-reimbursement-posture",
    ]);
    expect(cues.filter((cue) => cue.tone === "warning")).toHaveLength(3);
    expect(cues.find((cue) => cue.key === "modeling-boundary")?.detail).toContain(
      "planning support only"
    );
    expect(summarizeGrantEvidenceReadiness(cues)).toContain("operator review");
  });

  it("surfaces fit, anchors, fiscal posture, and modeling caveats without certifying the grant", () => {
    const cues = buildGrantEvidenceReadinessCues(
      opportunity({
        fit_notes: "Rural safety project aligns with the program purpose.",
        readiness_notes: "Source artifacts include cost estimate, scope, and local match note.",
        decision_rationale: "Proceed if reimbursement timing and obligation risk are acceptable.",
        expected_award_amount: 250000,
        project: { id: "project-1", name: "Main Street Safety" },
        program: { id: "program-1", title: "ATP" },
      }),
modelingEvidence()
    );

    expect(cues.map((cue) => cue.tone)).toEqual(["success", "success", "success", "info"]);
    expect(cues.find((cue) => cue.key === "funding-source-fit")?.detail).toContain(
      "not an eligibility determination"
    );
    expect(cues.find((cue) => cue.key === "match-reimbursement-posture")?.detail).toContain(
      "does not certify fiscal compliance"
    );
    expect(summarizeGrantEvidenceReadiness(cues)).toContain("human source review");
  });
});
