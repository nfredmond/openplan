import { describe, expect, it } from "vitest";
import {
  buildScenarioLinkedReports,
  buildScenarioComparisonSummary,
  buildScenarioReportDraft,
  buildScenarioStudioHref,
  getScenarioComparisonReadiness,
  scenarioComparisonStatus,
} from "@/lib/scenarios/catalog";

describe("scenario comparison helpers", () => {
  it("marks a comparison ready only when baseline and alternative have distinct runs", () => {
    expect(
      getScenarioComparisonReadiness({
        baselineEntryId: "baseline-entry",
        baselineRunId: "baseline-run",
        candidateRunId: "alternative-run",
      })
    ).toMatchObject({
      status: "ready",
      ready: true,
      evidenceReady: true,
    });
  });

  it("explains when the baseline is missing", () => {
    expect(
      getScenarioComparisonReadiness({
        baselineEntryId: null,
        baselineRunId: null,
        candidateRunId: "alternative-run",
      })
    ).toMatchObject({
      status: "missing-baseline",
      ready: false,
      reason: "Register a baseline entry before comparing alternatives.",
    });
  });

  it("blocks comparisons when both entries point at the same run", () => {
    expect(scenarioComparisonStatus("shared-run", "shared-run", "baseline-entry")).toBe("same-run");
  });

  it("summarizes ready and blocked alternatives", () => {
    expect(
      buildScenarioComparisonSummary({
        baselineEntryId: "baseline-entry",
        baselineRunId: "baseline-run",
        candidateRunIds: ["alternative-run", null, "baseline-run"],
      })
    ).toEqual({
      totalAlternatives: 3,
      readyAlternatives: 1,
      blockedAlternatives: 2,
      baselineEntryPresent: true,
      baselineRunPresent: true,
    });
  });

  it("builds an Analysis Studio deep link for scenario review", () => {
    expect(
      buildScenarioStudioHref({
        runId: "alternative-run",
        baselineRunId: "baseline-run",
        scenarioSetId: "scenario-set",
        entryId: "entry-id",
      })
    ).toBe(
      "/explore?runId=alternative-run&baselineRunId=baseline-run&scenarioSetId=scenario-set&entryId=entry-id#analysis-run-history"
    );
  });

  it("matches reports to attached scenario runs", () => {
    const linkage = buildScenarioLinkedReports({
      reports: [
        {
          id: "report-1",
          title: "Alternative packet",
          status: "generated",
          report_type: "analysis_summary",
          generated_at: "2026-03-14T10:00:00.000Z",
          updated_at: "2026-03-14T10:00:00.000Z",
        },
      ],
      reportRuns: [
        { report_id: "report-1", run_id: "baseline-run" },
        { report_id: "report-1", run_id: "alternative-run" },
      ],
      entries: [
        { id: "baseline-entry", label: "Existing conditions", attached_run_id: "baseline-run" },
        { id: "alternative-entry", label: "Protected bike package", attached_run_id: "alternative-run" },
      ],
      baselineEntryId: "baseline-entry",
    });

    expect(linkage.linkedReports).toHaveLength(1);
    expect(linkage.linkedReports[0]).toMatchObject({
      id: "report-1",
      comparisonReady: true,
      matchedEntryLabels: ["Existing conditions", "Protected bike package"],
    });
    expect(linkage.entryReportSummary.get("alternative-entry")).toEqual({
      totalLinkedReports: 1,
      generatedLinkedReports: 1,
      latestReportId: "report-1",
    });
  });

  it("builds a lightweight report draft title and summary", () => {
    expect(
      buildScenarioReportDraft({
        scenarioSetTitle: "Downtown alternatives",
        planningQuestion: "Which package should move forward?",
        baselineLabel: "Existing conditions",
        candidateLabel: "Protected bike package",
      })
    ).toEqual({
      title: "Downtown alternatives: Protected bike package vs Existing conditions",
      summary:
        "Scenario evidence packet for Protected bike package compared against Existing conditions. Planning question: Which package should move forward?",
    });
  });
});
