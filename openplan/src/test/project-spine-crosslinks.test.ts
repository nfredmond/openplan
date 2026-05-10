import { describe, expect, it } from "vitest";
import { buildProjectSpineCrosslinkSummary } from "@/lib/projects/project-spine-crosslinks";

const baseInput = {
  projectId: "project-1",
  linkedRtpCycleCount: 1,
  reportRecordCount: 2,
  reportAttentionCount: 0,
  evidenceBackedReportCount: 2,
  comparisonBackedReportCount: 1,
  rtpLinks: {
    constrainedCount: 1,
    illustrativeCount: 0,
    candidateCount: 0,
  },
  scenarios: {
    scenarioSetCount: 1,
    activeScenarioSetCount: 1,
    baselineCount: 1,
    readyAlternativeCount: 1,
    attachedRunCount: 2,
  },
  funding: {
    hasTargetNeed: true,
    label: "Gap remains",
    reason: "Committed awards plus pursued opportunities cover part of the current funding need, but a gap still remains.",
    awardCount: 1,
    opportunityCount: 2,
    reimbursementPacketCount: 1,
    unfundedAfterLikelyAmount: 250000,
    awardRiskCount: 0,
  },
  engagement: {
    label: "Active",
    itemCount: 9,
    handoffReadyCount: 4,
  },
  analysis: {
    recentRunCount: 2,
    comparisonBackedReportCount: 1,
  },
  aerial: {
    missionCount: 1,
    activeMissionCount: 0,
    readyPackageCount: 1,
    verificationReadiness: "ready" as const,
  },
};

describe("buildProjectSpineCrosslinkSummary", () => {
  it("orders attention rows ahead of ready crosslinks", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      reportAttentionCount: 1,
    });

    expect(summary.rows).toHaveLength(6);
    expect(summary.attentionCount).toBe(3);
    expect(summary.readyCount).toBe(3);
    expect(summary.missingCount).toBe(0);
    expect(summary.leadAction.id).toBe("rtp_packets");
    expect(summary.rows.find((row) => row.id === "engagement_evidence")?.statusLabel).toBe(
      "Moderation/handoff pending"
    );
    expect(summary.rows.find((row) => row.id === "funding_profile")?.evidence).toContain("$250,000 remains");
    expect(summary.rows.find((row) => row.id === "rtp_packets")?.detail).toContain(
      "roles 1 constrained / 0 illustrative / 0 candidate"
    );
    expect(summary.rows.find((row) => row.id === "scenario_sets")?.nextAction).toMatch(
      /confirm downstream report packets/i
    );
    expect(summary.leadAction.caveat).toMatch(/not adopted policy/i);
  });

  it("marks unlinked lanes as missing without overstating readiness", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      linkedRtpCycleCount: 0,
      reportRecordCount: 0,
      reportAttentionCount: 0,
      evidenceBackedReportCount: 0,
      comparisonBackedReportCount: 0,
      rtpLinks: {
        constrainedCount: 0,
        illustrativeCount: 0,
        candidateCount: 0,
      },
      scenarios: {
        scenarioSetCount: 0,
        activeScenarioSetCount: 0,
        baselineCount: 0,
        readyAlternativeCount: 0,
        attachedRunCount: 0,
      },
      funding: {
        ...baseInput.funding,
        hasTargetNeed: false,
        awardCount: 0,
        opportunityCount: 0,
        reimbursementPacketCount: 0,
        unfundedAfterLikelyAmount: 0,
      },
      engagement: {
        label: "Not linked",
        itemCount: 0,
        handoffReadyCount: 0,
      },
      analysis: {
        recentRunCount: 0,
        comparisonBackedReportCount: 0,
      },
      aerial: {
        missionCount: 0,
        activeMissionCount: 0,
        readyPackageCount: 0,
        verificationReadiness: "none",
      },
    });

    expect(summary.readyCount).toBe(0);
    expect(summary.attentionCount).toBe(0);
    expect(summary.missingCount).toBe(6);
    expect(summary.boardState).toBe("empty");
    expect(summary.stateHeadline).toMatch(/No downstream outputs/i);
    expect(summary.stateProofReference.label).toBe("Phase 1 shared spine proof");
    expect(summary.stateProofReference.artifact).toBe("docs/ops/2026-05-02-openplan-local-spine-smoke.md");
    expect(summary.stateProofReference.relevance).toMatch(/own scoped acceptance rerun/i);
    expect(summary.emptyCount).toBe(6);
    expect(summary.leadAction.id).toBe("rtp_packets");
    expect(summary.rows.map((row) => row.statusLabel)).toContain("Funding target missing");
    expect(summary.rows.find((row) => row.id === "funding_profile")?.sourceLabel).toBe("No evidence yet");
    expect(summary.rows.find((row) => row.id === "funding_profile")?.proofReference.artifact).toBe(
      "docs/ops/2026-05-01-openplan-local-grants-flow-smoke.md"
    );
    expect(summary.rows.find((row) => row.id === "analysis_modeling")?.evidence).toMatch(/no validated behavioral forecast/i);
    expect(summary.rows.find((row) => row.id === "scenario_sets")?.caveat).toMatch(/planning-support context/i);
  });

  it("turns pending schema lanes into setup actions instead of false missing evidence", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      linkedRtpCycleCount: 0,
      reportRecordCount: 0,
      reportAttentionCount: 0,
      evidenceBackedReportCount: 0,
      comparisonBackedReportCount: 0,
      rtpLinks: {
        constrainedCount: 0,
        illustrativeCount: 0,
        candidateCount: 0,
      },
      scenarios: {
        scenarioSetCount: 0,
        activeScenarioSetCount: 0,
        baselineCount: 0,
        readyAlternativeCount: 0,
        attachedRunCount: 0,
      },
      funding: {
        ...baseInput.funding,
        hasTargetNeed: false,
        awardCount: 0,
        opportunityCount: 0,
        reimbursementPacketCount: 0,
        unfundedAfterLikelyAmount: 0,
        awardRiskCount: 0,
      },
      engagement: {
        label: "Not linked",
        itemCount: 0,
        handoffReadyCount: 0,
      },
      analysis: {
        recentRunCount: 0,
        comparisonBackedReportCount: 0,
      },
      aerial: {
        missionCount: 0,
        activeMissionCount: 0,
        readyPackageCount: 0,
        verificationReadiness: "none",
      },
      pendingSchema: {
        scenario_sets: true,
        funding_profile: true,
      },
    });

    const scenarioRow = summary.rows.find((row) => row.id === "scenario_sets");
    const fundingRow = summary.rows.find((row) => row.id === "funding_profile");

    expect(summary.boardState).toBe("schema_pending");
    expect(summary.schemaPendingCount).toBe(2);
    expect(summary.attentionCount).toBe(2);
    expect(summary.missingCount).toBe(4);
    expect(summary.schemaPendingLanes).toEqual(["Scenario sets", "Grants / funding profile"]);
    expect(summary.stateDetail).toMatch(/showing setup actions instead of pretending those lanes are empty/i);
    expect(summary.stateProofReference.label).toBe("Migration inventory preflight proof");
    expect(summary.stateProofReference.href).toBe("/admin/pilot-readiness");
    expect(summary.leadAction.id).toBe("scenario_sets");
    expect(scenarioRow?.statusLabel).toBe("Schema setup pending");
    expect(scenarioRow?.sourceLabel).toBe("Schema setup");
    expect(scenarioRow?.evidence).toMatch(/did not treat this as missing evidence/i);
    expect(scenarioRow?.nextAction).toMatch(/Apply the scenario spine tables/i);
    expect(scenarioRow?.proofReference.label).toBe("Analysis/report linkage smoke");
    expect(fundingRow?.nextAction).toMatch(/funding profile, award, opportunity, and invoice tables/i);
  });

  it("keeps scenario sets in review posture until baseline and ready alternative evidence exist", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      scenarios: {
        scenarioSetCount: 2,
        activeScenarioSetCount: 1,
        baselineCount: 1,
        readyAlternativeCount: 0,
        attachedRunCount: 1,
      },
    });

    const scenarioRow = summary.rows.find((row) => row.id === "scenario_sets");

    expect(scenarioRow?.readiness).toBe("attention");
    expect(scenarioRow?.statusLabel).toBe("Scenario basis incomplete");
    expect(scenarioRow?.nextAction).toMatch(/baseline and at least one alternative/i);
    expect(scenarioRow?.evidence).toContain("1 attached run");
  });
});
