import { describe, expect, it } from "vitest";
import {
  buildGrantEvidenceReadinessCues,
  summarizeGrantEvidenceReadiness,
} from "@/lib/grants/evidence-readiness";
import { GRANT_MODELING_PLANNING_CAVEAT, type ProjectGrantModelingEvidence } from "@/lib/grants/modeling-evidence";
import type { FundingOpportunityRow } from "@/lib/grants/page-helpers";

const baseOpportunity = {
  id: "op-1",
  workspace_id: "ws-1",
  program_id: "program-1",
  project_id: "project-1",
  title: "Bridge Replacement HBP",
  opportunity_status: "open",
  decision_state: "monitor",
  agency_name: "Caltrans",
  owner_label: "Program lead",
  cadence_label: "Annual",
  expected_award_amount: 500000,
  opens_at: "2026-02-01T00:00:00Z",
  closes_at: "2027-06-30T00:00:00Z",
  decision_due_at: "2026-07-01T00:00:00Z",
  fit_notes: "Strong HBP fit because the bridge is structurally deficient.",
  readiness_notes: "Source memo saved; local match and reimbursement timing require finance review.",
  decision_rationale: "Monitor until board confirms match posture.",
  decided_at: null,
  summary: "Replace aging bridge.",
  updated_at: "2026-03-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  programs: null,
  projects: null,
  program: { id: "program-1", title: "HBP" },
  project: { id: "project-1", name: "Main St Bridge" },
} as unknown as FundingOpportunityRow & {
  program: { id: string; title: string };
  project: { id: string; name: string };
};

function buildEvidence(): ProjectGrantModelingEvidence {
  return {
    projectId: "project-1",
    comparisonBackedCount: 1,
    leadComparisonReport: {
      id: "report-1",
      title: "Bridge Grant Evidence Packet",
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
        latestComparisonSnapshotUpdatedAt: "2026-04-14T17:30:00.000Z",
      },
      comparisonDigest: {
        headline: "1 saved comparison · 1 ready",
        detail: "3 indicator deltas are already summarized.",
      },
    },
  };
}

describe("buildGrantEvidenceReadinessCues", () => {
  it("keeps documented evidence cues bounded to supervised grant review", () => {
    const cues = buildGrantEvidenceReadinessCues(baseOpportunity, buildEvidence());

    expect(cues).toHaveLength(4);
    expect(cues.map((cue) => cue.key)).toEqual([
      "funding-source-fit",
      "source-artifact-anchors",
      "modeling-boundary",
      "match-reimbursement-posture",
    ]);
    expect(cues.find((cue) => cue.key === "funding-source-fit")).toMatchObject({
      label: "Fit notes documented",
      tone: "success",
    });
    expect(cues.find((cue) => cue.key === "source-artifact-anchors")).toMatchObject({
      label: "Source anchors documented",
      tone: "success",
    });
    expect(cues.find((cue) => cue.key === "modeling-boundary")?.detail).toContain(
      GRANT_MODELING_PLANNING_CAVEAT
    );
    expect(cues.find((cue) => cue.key === "modeling-boundary")?.nextAction).toContain(
      "do not convert it into award likelihood"
    );
    expect(summarizeGrantEvidenceReadiness(cues)).toContain("supervised review");
  });

  it("flags missing source artifacts, modeling packet, and fiscal posture without overclaiming readiness", () => {
    const incomplete = {
      ...baseOpportunity,
      program_id: null,
      program: null,
      fit_notes: null,
      readiness_notes: null,
      decision_rationale: null,
    };

    const cues = buildGrantEvidenceReadinessCues(incomplete, null);

    expect(cues.find((cue) => cue.key === "funding-source-fit")).toMatchObject({
      label: "Fit notes missing",
      tone: "warning",
    });
    expect(cues.find((cue) => cue.key === "source-artifact-anchors")?.detail).toContain(
      "program/funding-source anchor"
    );
    expect(cues.find((cue) => cue.key === "modeling-boundary")).toMatchObject({
      label: "No modeling packet linked",
      tone: "neutral",
    });
    expect(cues.find((cue) => cue.key === "match-reimbursement-posture")?.detail).toContain(
      "No local match or reimbursement posture is stated"
    );
    expect(summarizeGrantEvidenceReadiness(cues)).toBe(
      "3 of 4 visible grant evidence cues need operator review before pursue, application, or reimbursement language is treated as ready."
    );
  });
});
