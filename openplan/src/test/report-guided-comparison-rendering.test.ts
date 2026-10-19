import { describe, expect, it } from "vitest";
import { buildProjectStageGateSnapshot, buildProjectStageGateSummary } from "@/lib/stage-gates/summary";
import { buildReportHtml, type ReportGenerationData } from "@/lib/reports/html";
import { htmlToPdfBlocks } from "@/lib/reports/pdf-text";
import { writeTextPdf } from "@/lib/reports/pdf-writer";
import { guidedReportCanonicalJson, includeGuidedScenarioBasis, readGuidedComparisonSelection, writeGuidedComparisonSelection } from "@/lib/reports/guided-comparison";
import { buildReportGenerationReadiness } from "@/lib/reports/generation-readiness";
import { resolveReportPacketRowFreshness } from "@/lib/reports/report-registry-freshness";
import { guidedReportSelectionFixture } from "@/test/fixtures/guided-report-evidence";

function data(): ReportGenerationData {
  const selection = guidedReportSelectionFixture();
  const empty = { count: 0, latestTitle: null, latestAt: null };
  return { report: { id: "report", title: "Comparison report", summary: null, report_type: "analysis_summary", created_at: "2026-10-19" },
    workspace: null, project: { id: selection.payload.projectId, name: "Synthetic project", summary: null, status: "active", plan_type: "transportation", delivery_phase: "planning", created_at: "2026-10-19", updated_at: "2026-10-19" },
    runs: [], sections: [], deliverables: [], risks: [], issues: [], decisions: [], meetings: [], engagement: null,
    scenarioSetLinks: includeGuidedScenarioBasis([], selection), projectFundingSnapshot: null,
    projectRecordsSnapshot: { deliverables: empty, risks: empty, issues: empty, decisions: empty, meetings: empty },
    stageGateSnapshot: buildProjectStageGateSnapshot(buildProjectStageGateSummary([], { templateId: "ca_stage_gates_v0_1" })), modelingEvidence: [], guidedComparison: selection };
}

describe("guided comparison HTML and portable PDF content", () => {
  it("retains fractional KPI values and ignores object key order in the canonical binding", () => {
    expect(guidedReportCanonicalJson({ value: 450909.6, unit: "vehicle-miles/day" })).toBe(guidedReportCanonicalJson({ unit: "vehicle-miles/day", value: 450909.6 }));
    expect(guidedReportCanonicalJson({ value: 450909.6 })).toBe('{"value":450909.6}');
    expect(() => guidedReportCanonicalJson({ value: NaN })).toThrow("nonfinite");
  });
  it("carries four VMT values, separate deltas, definitions, exact context and caveats into the mandatory HTML and PDF source", () => {
    const input = data();
    const html = buildReportHtml(input);
    for (const text of ["450,909.6", "443,317.9", "401,455.9", "398,090.6", "-7,591.7", "-3,365.3", "-1.7", "-0.8",
      "ActivitySim person-trip table rows", "not assigned vehicle trips", "prototype_mtc", "uncalibrated", "inconclusive", "Group quarters", "nationwide scientific acceptance",
      input.guidedComparison!.bindingSha256, input.guidedComparison!.payload.sources[0].runId, String(input.guidedComparison!.payload.sources[0].link.artifact_sha256),
      "Synthetic sensitivity assumption"]) expect(html).toContain(text);
    expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
    expect(html).not.toContain("<script>unsafe</script>");
    expect(html).toContain("No average or consensus result is calculated");
    expect(html.match(/<h3>AequilibraE<\/h3>/g)).toHaveLength(1);
    expect(html.match(/<h3>ActivitySim<\/h3>/g)).toHaveLength(1);
    const blocks = htmlToPdfBlocks(html);
    const pdfSource = JSON.stringify(blocks);
    for (const value of ["450,909.6", "398,090.6", "-7,591.7", "-0.8", "prototype_mtc", "household_residents"]) expect(pdfSource).toContain(value);
    const pdf = writeTextPdf({ title: "Synthetic comparison", generatedAt: "2026-10-19", blocks });
    expect(new TextDecoder("latin1").decode(pdf.bytes)).toContain("450,909.6");
    expect(new TextDecoder("latin1").decode(pdf.bytes)).toContain("398,090.6");
  });

  it("keeps ordinary reports absent selection and rejects unknown stored versions", () => {
    const input = data();
    const historicalHtml = buildReportHtml({ ...input, guidedComparison: null, scenarioSetLinks: [] });
    expect(historicalHtml).not.toContain('id="guided-comparison"');
    expect(readGuidedComparisonSelection({})).toBeNull();
    expect(readGuidedComparisonSelection({ guidedComparisonSelectionV1: null })).toBeNull();
    const metadata = writeGuidedComparisonSelection({ unrelated: "keep" }, input.guidedComparison!);
    expect(readGuidedComparisonSelection(metadata)).toEqual(input.guidedComparison);
    expect(writeGuidedComparisonSelection(metadata, null)).toEqual({ unrelated: "keep", guidedComparisonSelectionV1: null });
    expect(() => readGuidedComparisonSelection({ guidedComparisonSelectionV1: { version: 2 } })).toThrow("unsupported version");
  });

  it("projects one explicit scenario basis without claiming Analysis Studio readiness", () => {
    const input = data();
    const links = includeGuidedScenarioBasis(input.scenarioSetLinks, input.guidedComparison!);
    expect(links).toHaveLength(1);
    expect(links[0].matchedEntries).toEqual([]);
    expect(links[0].comparisonSummary.readyAlternatives).toBe(0);
    expect(links[0].comparisonSnapshots).toHaveLength(1);
    const ready = buildReportGenerationReadiness({ hasGeneratedArtifact: false, sourceContext: null, driftedSourceCount: 0,
      guidedComparison: { selected: true, problem: null } });
    expect(ready.checks.find((check) => check.id === "comparison_context")).toMatchObject({ status: "ready" });
    const stale = buildReportGenerationReadiness({ hasGeneratedArtifact: true, sourceContext: {}, driftedSourceCount: 0,
      guidedComparison: { selected: true, problem: "Artifact bytes changed" } });
    expect(stale.checks.find((check) => check.id === "comparison_context")).toMatchObject({ status: "blocked", detail: "Artifact bytes changed" });
    const report = { latest_artifact_kind: "pdf", generated_at: "2026-10-19", updated_at: "2026-10-19", metadata_json: writeGuidedComparisonSelection({}, input.guidedComparison!) };
    expect(resolveReportPacketRowFreshness(report, { generated_at: "2026-10-19", metadata_json: {} }).label).toBe("Refresh recommended");
  });
});
