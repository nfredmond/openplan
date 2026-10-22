/**
 * The "Safety action plan (draft)" report section: built by code from the
 * crash summary, the high-injury network and the attached countermeasures,
 * with a source line on every figure and the uncovered SS4A components listed.
 *
 * Blind category: this proves the builder and its HTML on fixed inputs. It does
 * not prove the generate route loads the right acquisition; the route test and
 * a real packet do that.
 */
import { describe, expect, it } from "vitest";
import { buildSafetyCrashEvidence, type SafetyCrashEvidenceIngest } from "@/lib/safety/crash-evidence";
import type { HighInjuryNetwork } from "@/lib/safety/high-injury-network";
import { HIGH_INJURY_NETWORK_PARAMETERS } from "@/lib/safety/high-injury-network";
import {
  buildSafetyActionPlanSection,
  normalizeSafetyActionPlanAttachments,
  readReportSafetyActionPlan,
  SAFETY_ACTION_PLAN_COMPONENT_COVERAGE,
  writeReportSafetyActionPlan,
  type ReportSafetyActionPlan,
} from "@/lib/reports/safety-action-plan";
import { safetyActionPlanMarkup } from "@/lib/reports/html";

const INGEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function ingest(severityCompleteness: string): SafetyCrashEvidenceIngest {
  return {
    id: INGEST_ID,
    projectId: "p-1",
    status: "ready",
    sourceLabel: "Statewide crash file",
    attribution: null,
    severityCompleteness,
    crashCount: 120,
    geocodedCount: 120,
    storedCount: 120,
    truncated: false,
    yearsRequested: [2022, 2023, 2024],
    createdAt: "2026-10-01T00:00:00.000Z",
    dimensionCoverage: null,
    partyCompleteness: "not_supported",
    partyCount: null,
    involvementBasis: null,
  };
}

function evidence(severityCompleteness = "kabco_full") {
  return buildSafetyCrashEvidence(ingest(severityCompleteness), {
    severity: { fatal: 4, severe_injury: 11, injury: 60, pdo: 40, unknown: 5 },
    role: null,
  });
}

function network(basis: "ksi" | "fatal_only" = "ksi"): HighInjuryNetwork {
  return {
    status: "computed",
    basis,
    method: "road_segments",
    years: [2022, 2023, 2024],
    segments: [
      {
        id: "road:0000abcd:0",
        rank: 1,
        tied: false,
        label: "Main Street",
        geometry: { type: "LineString", coordinates: [[0, 0], [0.007, 0]] },
        lengthMiles: 0.5,
        crashCount: 3,
        fatalCrashCount: 1,
        seriousInjuryCrashCount: basis === "ksi" ? 2 : null,
        crashesPerMile: 6,
        roadSource: "U.S. Census TIGER/Line roads 2025-01-01",
      },
    ],
    crashesConsidered: 15,
    crashesPlaced: 9,
    segmentsWithCrashes: 4,
    roadMilesReviewed: 12.3,
    listedMiles: 0.5,
    listedCrashes: 3,
    roadSources: ["U.S. Census TIGER/Line roads 2025-01-01"],
    parameters: HIGH_INJURY_NETWORK_PARAMETERS,
  };
}

const PLAN: ReportSafetyActionPlan = {
  ingestId: INGEST_ID,
  attachments: [
    { segmentId: "road:0000abcd:0", segmentLabel: "Main Street", countermeasureIds: ["lighting", "leading-pedestrian-interval"] },
    { segmentId: "road:ffff0000:2", segmentLabel: "Old Road", countermeasureIds: ["walkways"] },
  ],
};

describe("the draft section", () => {
  it("puts a source line beside the crash summary and the network", () => {
    const draft = buildSafetyActionPlanSection({ plan: PLAN, evidence: evidence(), network: network() });
    if (draft.crashSummary.kind !== "present") throw new Error("expected a crash summary");
    expect(draft.crashSummary.sourceLine).toMatch(/^Source: /);
    expect(draft.crashSummary.sourceLine).toContain(evidence().citationText);
    expect(draft.crashSummary.figures.find((figure) => figure.label === "Fatal or serious-injury crashes")?.value).toBe(15);
    if (draft.network.kind !== "computed") throw new Error("expected a network");
    expect(draft.network.sourceLine).toBe("Source: Statewide crash file. Requested crash years: 2022–2024. Road lines: U.S. Census TIGER/Line roads 2025-01-01.");
    expect(draft.network.measureLabel).toBe("Fatal and serious-injury crashes per mile");
    expect(draft.network.rows[0].countermeasureNames).toEqual(["Lighting", "Leading Pedestrian Interval"]);
    expect(draft.countermeasureSourceLine).toContain("Retrieved");
  });

  it("lists sparse requested years without asserting complete coverage or an annual denominator", () => {
    const sparse = { ...network(), years: [2024, 2020, 2022] } as HighInjuryNetwork;
    const draft = buildSafetyActionPlanSection({ plan: PLAN, evidence: evidence(), network: sparse });
    if (draft.network.kind !== "computed") throw new Error("expected a network");
    expect(draft.network.years).toBe("Requested crash years: 2020, 2022, 2024");
    expect(draft.network.sourceLine).not.toContain("2020–2024");
    expect(draft.network.coverage).toContain("do not establish complete observation coverage or an annual denominator");
    const html = safetyActionPlanMarkup(draft);
    expect(html).toContain("Requested crash years: 2020, 2022, 2024");
    expect(html).toContain("do not establish complete observation coverage");
  });

  it("keeps an attachment whose segment left the list, with no rank", () => {
    const draft = buildSafetyActionPlanSection({ plan: PLAN, evidence: evidence(), network: network() });
    expect(draft.treatments.map((treatment) => [treatment.segmentLabel, treatment.rank])).toEqual([
      ["Main Street", 1],
      ["Old Road", null],
    ]);
    expect(draft.treatments[0].countermeasures[0].cmfNote).toContain("[VERIFY]");
  });

  it("lists the components it does not cover and marks none as covered", () => {
    const draft = buildSafetyActionPlanSection({ plan: PLAN, evidence: evidence(), network: network() });
    const names = draft.components.map((component) => component.component);
    expect(names).toEqual(expect.arrayContaining([
      "Engagement and collaboration",
      "Equity analysis",
      "Progress and transparency",
      "Leadership commitment and goal setting",
    ]));
    expect(draft.components.every((component) => component.status !== ("covered" as string))).toBe(true);
    expect(SAFETY_ACTION_PLAN_COMPONENT_COVERAGE.filter((component) => component.status === "partial").map((c) => c.component))
      .toEqual(["Safety analysis", "Strategy and project selections"]);
    expect(draft.componentSourceLine).toContain("https://www.transportation.gov/grants/ss4a/comprehensive-safety-action-plans");
    expect(draft.draftNotice).toMatch(/not an adopted safety action plan/);
  });

  it("states a failed crash read and an unranked network instead of printing zeros", () => {
    const draft = buildSafetyActionPlanSection({
      plan: PLAN,
      evidence: null,
      network: { status: "unavailable", reason: "crash_read_failed", basis: "ksi" },
    });
    expect(draft.crashSummary).toMatchObject({ kind: "absent", reason: expect.stringMatching(/failed read/) });
    expect(draft.network).toMatchObject({ kind: "unavailable", reason: expect.stringMatching(/failed read/) });
  });

  it("labels a fatal-only network at the figure", () => {
    const draft = buildSafetyActionPlanSection({ plan: PLAN, evidence: evidence("fatal_only"), network: network("fatal_only") });
    if (draft.network.kind !== "computed") throw new Error("expected a network");
    expect(draft.network.measureLabel).toBe("Fatal crashes per mile (fatal crashes only)");
    expect(draft.network.rows[0].seriousInjuryCrashCount).toBeNull();
  });
});

describe("the printed section", () => {
  it("prints every source line and the fatal-only label", () => {
    const html = safetyActionPlanMarkup(
      buildSafetyActionPlanSection({ plan: PLAN, evidence: evidence("fatal_only"), network: network("fatal_only") }),
    );
    expect(html).toContain('<section id="safety_action_plan">');
    expect(html).toContain("Safety action plan (draft)");
    expect(html).toContain("Fatal crashes per mile (fatal crashes only)");
    expect(html).toContain("Not in source (fatal crashes only)");
    expect(html.match(/class="source-line"/g)).toHaveLength(4);
    expect(html).toContain("Action plan components not yet covered");
    expect(html).toContain("not among the listed segments");
  });

  it("prints a stale plan as a notice, and nothing at all with no plan", () => {
    expect(safetyActionPlanMarkup({ kind: "stale_acquisition" })).toMatch(/different crash acquisition/);
    expect(safetyActionPlanMarkup({ kind: "stale_acquisition" })).not.toContain("Main Street");
    expect(safetyActionPlanMarkup(null)).toBe("");
    expect(safetyActionPlanMarkup(undefined)).toBe("");
  });

  it("escapes a road name", () => {
    const hostile = network();
    if (hostile.status !== "computed") throw new Error("fixture");
    hostile.segments[0].label = "<script>x</script>";
    const html = safetyActionPlanMarkup(buildSafetyActionPlanSection({ plan: PLAN, evidence: evidence(), network: hostile }));
    expect(html).not.toContain("<script>x</script>");
  });
});

describe("the plan stored in report metadata", () => {
  it("round-trips and keeps unrelated metadata", () => {
    const written = writeReportSafetyActionPlan({ safetyIngestSelections: [{ ingestId: INGEST_ID }] }, PLAN);
    expect(written.safetyIngestSelections).toEqual([{ ingestId: INGEST_ID }]);
    expect(written.safetyActionPlanVersion).toBe("openplan.report_safety_action_plan.v1");
    expect(readReportSafetyActionPlan(written)).toEqual(PLAN);
  });

  it("drops unknown countermeasures, bad segment ids and duplicate segments", () => {
    expect(normalizeSafetyActionPlanAttachments([
      { segmentId: "road:abc:0", segmentLabel: "A", countermeasureIds: ["lighting", "made-up"] },
      { segmentId: "road:abc:0", segmentLabel: "A again", countermeasureIds: ["walkways"] },
      { segmentId: "javascript:alert(1)", segmentLabel: "B", countermeasureIds: ["lighting"] },
      { segmentId: "grid:-12:40", segmentLabel: "C", countermeasureIds: ["made-up"] },
    ])).toEqual([{ segmentId: "road:abc:0", segmentLabel: "A", countermeasureIds: ["lighting"] }]);
  });

  it("reads no plan from metadata that has none", () => {
    expect(readReportSafetyActionPlan({})).toBeNull();
    expect(readReportSafetyActionPlan(null)).toBeNull();
    expect(readReportSafetyActionPlan({ safetyActionPlan: { attachments: [] } })).toBeNull();
  });
});
