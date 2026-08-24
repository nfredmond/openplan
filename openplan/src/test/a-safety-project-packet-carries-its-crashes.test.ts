import { describe, expect, it } from "vitest";

import {
  buildPacketSafetyEvidence,
  PROJECT_SAFETY_SECTION_KEY,
  PROJECT_SAFETY_SECTION_TITLE,
} from "@/lib/reports/safety-evidence-section";
import { buildReportHtml, type ReportGenerationData } from "@/lib/reports/html";
import {
  buildProjectStageGateSnapshot,
  buildProjectStageGateSummary,
} from "@/lib/stage-gates/summary";
import type { SafetyCrashEvidence } from "@/lib/safety/crash-evidence";

/**
 * A PROJECT'S PACKET MUST CARRY THE CRASH EVIDENCE ATTACHED TO IT.
 *
 * WHERE THIS CAME FROM. A tester attached real crash data to a project, named
 * the project "Safety Study", regenerated the Board/Binder packet, and got a
 * document with ZERO safety content. The generator pulled records, funding and
 * governance and never asked the safety module anything. A board member reading
 * only the PDF could not see that any crash work had been done at all.
 *
 * WHAT IS ASSERTED HERE is not that a section exists — that would pass with an
 * empty box. It is that the numbers arrive WITH the things that make them
 * defensible, and that the four ways of being absent stay distinguishable:
 *
 *   - a source that cannot separate serious injuries yields no KSI figure, and
 *     says why, rather than printing 0;
 *   - counts that could not be read say so, rather than printing 0;
 *   - a truncated retrieval says every figure is a FLOOR;
 *   - collisions with no coordinates are named, because quoting the mapped
 *     count as the total understates the problem being funded.
 *
 * Zero is the most flattering reading of every one of those, and the least
 * defensible in a document a board signs.
 */
function evidence(overrides: Partial<SafetyCrashEvidence> = {}): SafetyCrashEvidence {
  return {
    ingestId: "ing-1",
    projectId: "p1",
    status: "succeeded",
    severityCompleteness: "complete",
    truncated: false,
    sourceLabel: "Example crash source",
    attribution: "Example agency",
    years: [2022, 2023],
    severityCounts: { fatal: 4, severe_injury: 11, injury: 200, pdo: 90, unknown: 6 },
    roleCounts: null,
    ksi: 15,
    unclassifiedCount: 6,
    reportedTotal: 311,
    mappedTotal: 300,
    dimensionCoverage: null,
    citationText: "Example crash source (2022, 2023).",
    caveats: ["Counts come from the source's own records."],
    narrativeCaveat: "Screening-grade: reported collisions, not a safety analysis.",
    // The overrides were once accepted and never applied, which made every case
    // below silently test the base object. A fixture helper that ignores its
    // argument is a vacuous test generator.
    ...overrides,
  } as SafetyCrashEvidence;
}

describe("a safety project's packet carries its crashes", () => {
  it("has a stable section key the packet can order and a board can be pointed at", () => {
    expect(PROJECT_SAFETY_SECTION_KEY).toBe("project_safety_evidence");
  });

  it("tells a project with no crash data apart from one whose read failed", () => {
    // Two different sentences, because they mean different things to somebody
    // deciding whether the packet is complete.
    expect(buildPacketSafetyEvidence([]).kind).toBe("none");
    expect(buildPacketSafetyEvidence(null).kind).toBe("unreadable");
  });

  it("carries the figures with the caveats that qualify them", () => {
    const built = buildPacketSafetyEvidence([evidence()]);
    expect(built.kind).toBe("present");
    if (built.kind !== "present") return;
    const [acquisition] = built.acquisitions;

    const ksi = acquisition.figures.find((f) => /killed or seriously/i.test(f.label));
    expect(ksi?.value).toBe(15);
    expect(acquisition.caveats.length).toBeGreaterThan(0);
    expect(acquisition.citation).toContain("Example crash source");
  });

  it("prints no KSI figure when the source cannot separate serious injuries", () => {
    const built = buildPacketSafetyEvidence([evidence({ ksi: null })]);
    if (built.kind !== "present") throw new Error("expected present");
    const ksi = built.acquisitions[0].figures.find((f) => /killed or seriously/i.test(f.label));
    expect(ksi?.value).toBeNull();
    // The reason travels with the absence — a blank cell teaches nobody.
    expect(ksi?.absentBecause).toMatch(/does not separate/i);
  });

  it("prints no severity numbers when the counts could not be read", () => {
    const built = buildPacketSafetyEvidence([evidence({ severityCounts: null, unclassifiedCount: null })]);
    if (built.kind !== "present") throw new Error("expected present");
    const fatal = built.acquisitions[0].figures.find((f) => f.label === "Fatal");
    expect(fatal?.value).toBeNull();
    expect(fatal?.absentBecause).toMatch(/could not be read/i);
  });

  it("says the figures are a floor when the retrieval was truncated", () => {
    const built = buildPacketSafetyEvidence([evidence({ truncated: true })]);
    if (built.kind !== "present") throw new Error("expected present");
    expect(built.acquisitions[0].caveats.join(" ")).toMatch(/floor/i);
  });

  it("names the collisions that could not be placed on a map", () => {
    const built = buildPacketSafetyEvidence([evidence({ reportedTotal: 311, mappedTotal: 300 })]);
    if (built.kind !== "present") throw new Error("expected present");
    const said = built.acquisitions[0].caveats.join(" ");
    expect(said).toMatch(/11 reported collisions carried no coordinates/i);
  });

  it("does not invent that gap when every collision was mapped", () => {
    const built = buildPacketSafetyEvidence([evidence({ reportedTotal: 300, mappedTotal: 300 })]);
    if (built.kind !== "present") throw new Error("expected present");
    expect(built.acquisitions[0].caveats.join(" ")).not.toMatch(/carried no coordinates/i);
  });

  /**
   * THE BUILDER BEING RIGHT IS NOT THE PACKET BEING RIGHT.
   *
   * Everything above tests a pure function. Removing the section's renderer
   * from `html.ts` entirely left all of it green — 48 tests passing while the
   * packet printed no safety content at all, which is the exact defect this
   * file exists for. These render the real document.
   */
  describe("and the generated packet actually prints it", () => {
    function packetData(safetyEvidence: ReportGenerationData["safetyEvidence"]): ReportGenerationData {
      return {
        report: {
          id: "r1",
          title: "Safety Study Board Packet",
          summary: null,
          report_type: "board_packet",
          created_at: "2026-08-01T00:00:00.000Z",
        },
        workspace: { id: "ws-1", name: "Test Workspace" },
        project: {
          id: "p1",
          name: "Safety Study",
          summary: null,
          status: "active",
          plan_type: "corridor_plan",
          delivery_phase: "analysis",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:00:00.000Z",
        },
        runs: [],
        sections: [
          {
            id: "s1",
            section_key: PROJECT_SAFETY_SECTION_KEY,
            title: PROJECT_SAFETY_SECTION_TITLE,
            enabled: true,
            sort_order: 0,
            config_json: {},
          },
        ],
        deliverables: [],
        risks: [],
        issues: [],
        decisions: [],
        meetings: [],
        engagement: null,
        scenarioSetLinks: [],
        projectFundingSnapshot: null,
        projectRecordsSnapshot: {
          deliverables: { count: 0, latestTitle: null, latestAt: null },
          risks: { count: 0, latestTitle: null, latestAt: null },
          issues: { count: 0, latestTitle: null, latestAt: null },
          decisions: { count: 0, latestTitle: null, latestAt: null },
          meetings: { count: 0, latestTitle: null, latestAt: null },
        },
        stageGateSnapshot: buildProjectStageGateSnapshot(
          buildProjectStageGateSummary([], { templateId: "ca_stage_gates_v0_1" })
        ),
        modelingEvidence: [],
        safetyEvidence,
      } as unknown as ReportGenerationData;
    }

    it("prints the figures and the caveats into the document", () => {
      const html = buildReportHtml(packetData([evidence()]));
      expect(html).toContain("Example crash source");
      expect(html).toContain("311"); // reported total
      expect(html).toContain("15"); // KSI
      // The caveat is IN the packet, not left on a screen nobody prints.
      expect(html).toMatch(/carried no coordinates/i);
    });

    it("prints the sourced project estimate without calling it the management budget", () => {
      const base = packetData([evidence()]);
      const html = buildReportHtml({
        ...base,
        project: {
          ...base.project,
          estimated_cost_amount: 1_200_000,
          estimated_cost_currency: "CAD",
          estimated_cost_basis_year: 2026,
          estimated_cost_source_document_id: "doc-1",
          estimated_cost_source_title: "projects.csv",
        },
      });
      expect(html).toContain("CAD");
      expect(html).toContain("1,200,000");
      expect(html).toContain("Price year 2026");
      expect(html).toContain("Source: projects.csv");
      expect(html).toContain("separate from the project-management budget");
    });

    it("prints ranked project KSI concentrations with screening limits", () => {
      const html = buildReportHtml({
        ...packetData([evidence()]),
        safetyKsiConcentrations: [{
          rank: 1,
          longitude: -121.061,
          latitude: 39.219,
          crashCount: 7,
          fatalCrashCount: 2,
          seriousInjuryCrashCount: 5,
          radiusMeters: 150,
        }],
      });

      expect(html).toContain("Highest observed KSI concentrations");
      expect(html).toContain("7 KSI crashes");
      expect(html).toContain("screening locations, not named intersections");
    });

    it("prints tract-level community context with its non-causal limit", () => {
      const html = buildReportHtml({
        ...packetData([evidence()]),
        safetyKsiEquityTracts: [{
          rank: 1,
          geoid: "06019000100",
          tractName: "Census Tract 1",
          ksiCrashCount: 7,
          fatalCrashCount: 2,
          seriousInjuryCrashCount: 5,
          population: 3500,
          ksiPer100k: 200,
          pctPoverty: 24,
          pctNonwhite: 61,
          pctZeroVehicle: 9,
          areaMedianPctPoverty: 16,
          areaMedianPctNonwhite: 48,
          areaMedianPctZeroVehicle: 7,
        }],
        safetyKsiEquityDemographicSource: { label: "U.S. Census ACS 5-year", vintage: "2023" },
      });

      expect(html).toContain("Community burden screen");
      expect(html).toContain("poverty 24.0% vs area median 16.0%");
      expect(html).toContain("not a causal, protected-class, or legal disparity finding");
    });

    it("says why a figure is absent instead of printing a zero", () => {
      const html = buildReportHtml(packetData([evidence({ ksi: null })]));
      expect(html).toMatch(/does not separate suspected serious injuries/i);
    });

    it("tells a project with no crash data apart from a failed read", () => {
      expect(buildReportHtml(packetData([]))).toMatch(/no crash data is attached/i);
      expect(buildReportHtml(packetData(null))).toMatch(/could not be read/i);
    });
  });
});
