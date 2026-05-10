import { describe, expect, it } from "vitest";

import {
  buildPlannerReadableModelingEvidenceSummary,
  buildReportModelingEvidenceExportProof,
  summarizeReportModelingEvidenceForMetadata,
  type ReportModelingEvidence,
} from "@/lib/reports/modeling-evidence";

function linkedEvidence(overrides: Partial<ReportModelingEvidence> = {}): ReportModelingEvidence {
  return {
    countyRunId: "county-run-1",
    runName: "Nevada validated screening run",
    geographyLabel: "Nevada County, CA",
    stage: "validated-screening",
    updatedAt: "2026-05-09T18:00:00.000Z",
    evidence: {
      reportLanguage:
        "Screening-grade modeling result. Use for planning context only, and include the validation caveats before making any outward claim.",
      claimDecision: {
        track: "assignment",
        claimStatus: "screening_grade",
        statusReason: "Worst matched facility APE 237.62% exceeds the 50% threshold.",
        reasons: ["Worst matched facility APE 237.62% exceeds the 50% threshold."],
        validationSummary: {
          passed: 3,
          warned: 1,
          failed: 1,
          missingRequiredMetricKeys: [],
          requiredMetricKeys: ["assignment_final_gap", "critical_absolute_percent_error"],
        },
        decidedAt: "2026-05-09T18:01:00.000Z",
      },
      sourceManifests: [
        {
          id: "source-1",
          sourceKey: "observed_count_validation",
          sourceKind: "caltrans_counts",
          sourceLabel: "Caltrans 2023 priority counts",
          sourceUrl: "https://example.test/counts.csv",
          sourceVintage: "2023",
          geographyId: "06057",
          geographyLabel: "Nevada County, CA",
          licenseNote: "Public data",
          citationText: "Caltrans, 2023 traffic counts.",
        },
      ],
      validationResults: [
        {
          id: "validation-1",
          track: "assignment",
          metricKey: "critical_absolute_percent_error",
          metricLabel: "Critical facility APE",
          observedValue: 237.62,
          thresholdValue: 50,
          thresholdMaxValue: null,
          thresholdComparator: "lte",
          status: "fail",
          blocksClaimGrade: true,
          detail: "Worst matched facility APE 237.62% exceeds the 50% threshold.",
          sourceManifestId: "source-1",
          evaluatedAt: "2026-05-09T18:00:00.000Z",
        },
      ],
    },
    ...overrides,
  };
}

describe("buildPlannerReadableModelingEvidenceSummary", () => {
  it("turns linked county-run evidence into trust-first planner language", () => {
    const summary = buildPlannerReadableModelingEvidenceSummary([linkedEvidence()]);

    expect(summary.label).toBe("1 linked modeling run · strongest: Screening-grade");
    expect(summary.tone).toBe("warning");
    expect(summary.headline).toBe("Modeling evidence is suitable for planning context only.");
    expect(summary.caveats).toContain("Worst matched facility APE 237.62% exceeds the 50% threshold.");
    expect(summary.plannerReadout).toContain("Nevada County, CA");
    expect(summary.plannerReadout).toContain("1 public source");
    expect(summary.plannerReadout).toContain("5 validation checks");
  });

  it("is explicit when a report has no linked modeling evidence", () => {
    const summary = buildPlannerReadableModelingEvidenceSummary([]);

    expect(summary.tone).toBe("neutral");
    expect(summary.label).toBe("No linked modeling evidence");
    expect(summary.headline).toBe("No county-run modeling evidence is attached to this report.");
    expect(summary.caveats[0]).toContain("Do not describe this report as model-backed");
  });

  it("builds export-proof language with source context, caveats, and stale-packet warning", () => {
    const proof = buildReportModelingEvidenceExportProof(linkedEvidence());

    expect(proof.exportReady).toBe(true);
    expect(proof.sourceContext).toContain("1 source manifest");
    expect(proof.sourceContext).toContain("5 validation checks");
    expect(proof.sourceContext).toContain("No raw behavioral-onramp KPI rows are read");
    expect(proof.exportReadiness).toContain("validated behavioral forecast or certified calibration");
    expect(proof.caveatCarryThrough).toContain(
      "Planning analysis and evidence triage only; not a validated behavioral forecast or certified model calibration."
    );
    expect(proof.caveatCarryThrough).toContain("Worst matched facility APE 237.62% exceeds the 50% threshold.");
    expect(proof.stalePacketLanguage).toContain("regenerate the packet if county-run evidence");
  });

  it("persists export-proof posture in compact report artifact metadata", () => {
    const [metadata] = summarizeReportModelingEvidenceForMetadata([linkedEvidence()]);

    expect(metadata.exportProof.exportReady).toBe(true);
    expect(metadata.exportProof.sourceContext).toContain("Nevada County, CA carries 1 source manifest");
    expect(metadata.exportProof.caveatCarryThrough).toContain(
      "Planning analysis and evidence triage only; not a validated behavioral forecast or certified model calibration."
    );
  });
});
