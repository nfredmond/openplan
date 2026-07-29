import { describe, expect, it } from "vitest";
import { buildProjectSpineCrosslinkSummary } from "@/lib/projects/project-spine-crosslinks";

const baseInput = {
  projectId: "project-1",
  geography: {
    label: "Franklin County",
    isDrawn: false,
    hasResolvableIdentity: true,
    workspaceFallbackLabel: null,
  },
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
  safety: {
    ingestCount: 1,
    crashCount: 1180,
    geocodedCount: 1089,
    coverageLabel: "Statewide reported collisions from the source agency.",
    sourceLabel: "Statewide crash reporting system",
  },
  aerial: {
    missionCount: 1,
    activeMissionCount: 0,
    readyPackageCount: 1,
    verificationReadiness: "ready" as const,
  },
};

const emptySafety = {
  ingestCount: 0,
  crashCount: 0,
  geocodedCount: 0,
  coverageLabel: null,
  sourceLabel: null,
};

describe("buildProjectSpineCrosslinkSummary", () => {
  it("orders attention rows ahead of ready crosslinks", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      reportAttentionCount: 1,
    });

    // Eight lanes: the seven downstream ones plus the study area they all
    // start from. baseInput carries a resolved place, so geography is ready.
    expect(summary.rows).toHaveLength(8);
    expect(summary.rows[0].id).toBe("geography");
    expect(summary.attentionCount).toBe(3);
    expect(summary.readyCount).toBe(5);
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
      safety: emptySafety,
      aerial: {
        missionCount: 0,
        activeMissionCount: 0,
        readyPackageCount: 0,
        verificationReadiness: "none",
      },
      // Unset too, so this case is what it says it is: a project with nothing
      // linked anywhere, including the area the other lanes start from.
      geography: {
        label: null,
        isDrawn: false,
        hasResolvableIdentity: false,
        workspaceFallbackLabel: null,
      },
    });

    expect(summary.readyCount).toBe(0);
    expect(summary.attentionCount).toBe(0);
    expect(summary.missingCount).toBe(8);
    expect(summary.boardState).toBe("empty");
    expect(summary.stateHeadline).toMatch(/No downstream outputs/i);
    // With nothing set anywhere, the first move is the study area rather than
    // the RTP cycle: geography is upstream of every other lane, and attaching a
    // project to a cycle before anyone has said where it is only defers the
    // question. This is the ordering the geography lane exists to produce.
    expect(summary.stateNextAction).toMatch(/study area/i);
    expect(summary.emptyCount).toBe(8);
    expect(summary.leadAction.id).toBe("geography");
    expect(summary.rows.map((row) => row.statusLabel)).toContain("Funding target missing");
    expect(summary.rows.find((row) => row.id === "funding_profile")?.sourceLabel).toBe("No evidence yet");
    expect(summary.rows.find((row) => row.id === "analysis_modeling")?.evidence).toMatch(/no validated behavioral forecast/i);
    expect(summary.rows.find((row) => row.id === "scenario_sets")?.caveat).toMatch(/planning-support context/i);
  });

  it("puts the study area first, because every other lane starts from it", () => {
    const summary = buildProjectSpineCrosslinkSummary(baseInput);
    const geography = summary.rows.find((row) => row.id === "geography");

    expect(summary.rows[0].id).toBe("geography");
    expect(geography?.readiness).toBe("ready");
    expect(geography?.headline).toContain("Franklin County");
    expect(geography?.href).toBe("#project-identity");
  });

  it("calls a drawn area attention, not ready — it has extent but no identity", () => {
    // A hand-drawn shape cannot be re-resolved, so no county filter, no
    // jurisdiction rule and no eligibility check downstream can be derived from
    // it. Reporting that as "ready" would hide a real limit on the other lanes.
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      geography: {
        label: "Drawn corridor",
        isDrawn: true,
        hasResolvableIdentity: false,
        workspaceFallbackLabel: "Franklin County",
      },
    });
    const geography = summary.rows.find((row) => row.id === "geography");

    expect(geography?.readiness).toBe("attention");
    expect(geography?.statusLabel).toBe("Drawn area only");
    expect(geography?.detail).toMatch(/no boundary to re-resolve/i);
    expect(geography?.nextAction).toMatch(/keep the drawn shape if the extent is the point/i);
  });

  it("names the real fallback when no study area is set", () => {
    // "Missing" must say what actually happens next, and what happens is that
    // downstream lanes fall back to the workspace's home geography — by name,
    // so nobody has to guess which place their run will use.
    const withFallback = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      geography: {
        label: null,
        isDrawn: false,
        hasResolvableIdentity: false,
        workspaceFallbackLabel: "Delaware County",
      },
    });
    expect(withFallback.rows.find((row) => row.id === "geography")?.headline).toContain(
      "Delaware County"
    );

    const withoutFallback = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      geography: {
        label: null,
        isDrawn: false,
        hasResolvableIdentity: false,
        workspaceFallbackLabel: null,
      },
    });
    expect(withoutFallback.rows.find((row) => row.id === "geography")?.headline).toMatch(
      /every module will ask for a place each time/i
    );
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
    expect(summary.stateNextAction).toMatch(/decide which evidence is genuinely absent/i);
    expect(summary.leadAction.id).toBe("scenario_sets");
    expect(scenarioRow?.statusLabel).toBe("Schema setup pending");
    expect(scenarioRow?.sourceLabel).toBe("Schema setup");
    expect(scenarioRow?.evidence).toMatch(/did not treat this as missing evidence/i);
    expect(scenarioRow?.nextAction).toMatch(/Apply the scenario spine tables/i);
    expect(fundingRow?.nextAction).toMatch(/funding profile, award, opportunity, and invoice tables/i);
  });

  it("renders safety evidence with the reported-vs-geocoded gap disclosed, never hidden", () => {
    const summary = buildProjectSpineCrosslinkSummary(baseInput);
    const safetyRow = summary.rows.find((row) => row.id === "safety_evidence");

    expect(safetyRow?.readiness).toBe("ready");
    expect(safetyRow?.statusLabel).toBe("Crash evidence linked");
    // Both counts, always — 1,089 mapped points must never pass as the 1,180
    // reported crashes.
    expect(safetyRow?.headline).toContain("1,180 crashes ingested, 1,089 geocoded");
    expect(safetyRow?.detail).toContain("1 acquisition");
    expect(safetyRow?.detail).toContain("Statewide crash reporting system");
    expect(safetyRow?.evidence).toContain("Statewide reported collisions");
    expect(safetyRow?.caveat).toMatch(/none of this is an adopted safety plan/i);
    expect(safetyRow?.href).toBe("/safety");
  });

  it("treats a zero-crash acquisition as review work, not proof of zero crashes", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      safety: { ...emptySafety, ingestCount: 1 },
    });
    const safetyRow = summary.rows.find((row) => row.id === "safety_evidence");

    expect(safetyRow?.readiness).toBe("attention");
    expect(safetyRow?.statusLabel).toBe("Acquisition needs review");
    expect(safetyRow?.headline).toMatch(/check its coverage state/i);
    expect(safetyRow?.headline).not.toMatch(/no crashes occurred/i);
  });

  it("marks an unlinked safety lane missing with an honest empty-evidence line", () => {
    const summary = buildProjectSpineCrosslinkSummary({ ...baseInput, safety: emptySafety });
    const safetyRow = summary.rows.find((row) => row.id === "safety_evidence");

    expect(safetyRow?.readiness).toBe("missing");
    expect(safetyRow?.statusLabel).toBe("No crash acquisition");
    expect(safetyRow?.evidence).toMatch(/not evidence that no crashes occurred/i);
    expect(safetyRow?.nextAction).toMatch(/Run a crash acquisition/i);
  });

  it("turns a pending safety schema into a setup action for the safety lane", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      safety: emptySafety,
      pendingSchema: { safety_evidence: true },
    });
    const safetyRow = summary.rows.find((row) => row.id === "safety_evidence");

    expect(safetyRow?.sourceState).toBe("schema_pending");
    expect(safetyRow?.statusLabel).toBe("Schema setup pending");
    expect(safetyRow?.nextAction).toMatch(/Apply the safety crash tables/i);
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
