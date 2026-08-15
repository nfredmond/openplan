/**
 * The geography figure as it reaches a reader: in the generated packet HTML, in
 * the text-only PDF tier, and in the wording the project page already uses.
 *
 * Three things are guarded here that a figure-level test cannot see:
 *
 * 1. The packet renders the figure EXACTLY ONCE — as a section when the report
 *    carries one, and from the always-on band when it does not. Reports created
 *    before the section existed keep their old `report_sections` rows forever,
 *    so the band is the only thing that reaches them; without the dedupe a new
 *    packet would print the drawing twice.
 * 2. The built-in PDF typesetter DISCARDS `<svg>` (see `pdf-text.ts`). A packet
 *    on a deployment with no browser engine therefore loses the picture, and
 *    must not lose the content with it.
 * 3. The packet's caveat about a hand-drawn area says the same thing the
 *    project page's study-area lane says. Both are live surfaces, and the test
 *    drives both rather than reading either file's text.
 */

import { describe, expect, it } from "vitest";

import { buildProjectSpineCrosslinkSummary } from "@/lib/projects/project-spine-crosslinks";
import {
  buildProjectStageGateSnapshot,
  buildProjectStageGateSummary,
} from "@/lib/stage-gates/summary";
import { DRAWN_PLACE_SOURCE } from "@/lib/geographies/place-of-record";
import {
  PROJECT_GEOGRAPHY_SECTION_KEY,
  PROJECT_GEOGRAPHY_SECTION_TITLE,
  type PacketGeographyInput,
} from "@/lib/reports/geography-figure";
import { buildReportHtml, type ReportGenerationData } from "@/lib/reports/html";
import { createDefaultReportSections, REPORT_TYPE_OPTIONS } from "@/lib/reports/catalog";
import { htmlToPdfBlocks } from "@/lib/reports/pdf-text";

const RING = [
  [-121.085, 39.195],
  [-121.025, 39.195],
  [-121.025, 39.245],
  [-121.085, 39.245],
  [-121.085, 39.195],
];

function geography(overrides: Partial<PacketGeographyInput> = {}): PacketGeographyInput {
  return {
    studyArea: {
      source: DRAWN_PLACE_SOURCE,
      kind: null,
      ref: null,
      label: "Central Grass Valley study area",
      countryCode: null,
      subdivisionCode: null,
      bbox: { minLon: -121.085, minLat: 39.195, maxLon: -121.025, maxLat: 39.245 },
      geometry: { type: "Polygon", coordinates: [RING] },
    },
    studyAreaReadState: "ok",
    corridors: [
      {
        id: "corridor-1",
        name: "SR-49 through Grass Valley",
        corridorType: "highway",
        geometry: {
          type: "LineString",
          coordinates: [
            [-121.039, 39.244],
            [-121.04, 39.22],
            [-121.0345, 39.197],
          ],
        },
      },
    ],
    corridorReadState: "ok",
    corridorLimitReached: false,
    marker: { latitude: 39.2191, longitude: -121.0611 },
    workspaceFallbackLabel: null,
    ...overrides,
  };
}

function packetData(overrides?: Partial<ReportGenerationData>): ReportGenerationData {
  return {
    report: {
      id: "report-1",
      title: "SR-49 Corridor Safety Study Board Packet",
      summary: null,
      report_type: "board_packet",
      created_at: "2026-08-01T00:00:00.000Z",
    },
    workspace: { id: "ws-1", name: "Test Workspace" },
    project: {
      id: "project-1",
      name: "SR-49 Corridor Safety Study",
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
        id: "section-1",
        section_key: "executive_summary",
        title: "Executive summary",
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
    geography: geography(),
    ...overrides,
  };
}

const geographySection = {
  id: "section-geo",
  section_key: PROJECT_GEOGRAPHY_SECTION_KEY,
  title: PROJECT_GEOGRAPHY_SECTION_TITLE,
  enabled: true,
  sort_order: 1,
  config_json: {},
};

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("the packet draws the project's geography", () => {
  it("renders an inline SVG with the area, the corridor and the marker, and fetches nothing", () => {
    const html = buildReportHtml(packetData());

    expect(html).toContain("<svg");
    expect(html).toContain('class="geo-area"');
    expect(html).toContain('class="geo-corridor"');
    expect(html).toContain('class="geo-marker"');
    // Nothing may reach the network from inside a packet: no image element, no
    // stylesheet link, no absolute asset host.
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it("draws nothing it does not have", () => {
    const html = buildReportHtml(
      packetData({ geography: geography({ corridors: [], marker: null }) })
    );

    expect(html).toContain('class="geo-area"');
    expect(html).not.toContain('class="geo-corridor"');
    expect(html).not.toContain('class="geo-marker"');
  });

  it("says a project with no geography has none, rather than printing an empty box", () => {
    const html = buildReportHtml(
      packetData({
        geography: geography({ studyArea: null, corridors: [], marker: null }),
      })
    );

    expect(html).not.toContain("<svg");
    expect(html).toContain("Nothing to draw");
    expect(html).toContain("no study area, no corridors and no map point");
  });

  it("states nothing at all when the packet builder never read the geometry", () => {
    // No section: the band renders nothing rather than a claim. Silence is the
    // only honest output when nobody asked the question.
    const bandOnly = buildReportHtml(packetData({ geography: undefined }));
    expect(bandOnly).not.toContain("<svg");
    expect(bandOnly).not.toContain(PROJECT_GEOGRAPHY_SECTION_TITLE);
    expect(bandOnly).not.toContain("no study area, no corridors and no map point");

    // With a section, the packet must say why the section is empty — and must
    // not say the project has no geography.
    const withSection = buildReportHtml(
      packetData({ geography: undefined, sections: [...packetData().sections, geographySection] })
    );
    expect(withSection).not.toContain("<svg");
    expect(withSection).toContain("assembled without reading the project's geometry");
    expect(withSection).not.toContain("no study area, no corridors and no map point");
  });
});

describe("the figure appears exactly once", () => {
  it("renders from the always-on band for a report created before the section existed", () => {
    const html = buildReportHtml(packetData());

    expect(countOccurrences(html, PROJECT_GEOGRAPHY_SECTION_TITLE)).toBe(1);
    expect(countOccurrences(html, '<svg')).toBe(1);
  });

  it("renders under the report's own section when the report carries one, and not twice", () => {
    const html = buildReportHtml(
      packetData({
        sections: [...packetData().sections, geographySection],
      })
    );

    expect(countOccurrences(html, PROJECT_GEOGRAPHY_SECTION_TITLE)).toBe(1);
    expect(countOccurrences(html, '<svg')).toBe(1);
  });

  it("stays out when the operator switched the section off", () => {
    const html = buildReportHtml(
      packetData({
        sections: [...packetData().sections, { ...geographySection, enabled: false }],
      })
    );

    // Disabled means the operator chose to leave it out. The always-on band
    // exists for reports that never heard of the section, not to reinstate one
    // somebody deliberately switched off.
    expect(countOccurrences(html, "<svg")).toBe(0);
    expect(html).not.toContain(PROJECT_GEOGRAPHY_SECTION_TITLE);
  });
});

describe("every project report type offers a geography section", () => {
  it("puts one in each of the three project packet templates", () => {
    for (const option of REPORT_TYPE_OPTIONS) {
      const keys = createDefaultReportSections(option.value).map((section) => section.sectionKey);
      expect(keys, option.value).toContain(PROJECT_GEOGRAPHY_SECTION_KEY);
    }
  });

  it("keeps every template's sort order a gapless sequence", () => {
    for (const option of REPORT_TYPE_OPTIONS) {
      const orders = createDefaultReportSections(option.value)
        .map((section) => section.sortOrder)
        .sort((left, right) => left - right);
      expect(orders, option.value).toEqual(orders.map((_, index) => index));
    }
  });
});

describe("the text-only PDF tier keeps the content when it loses the picture", () => {
  it("carries the caveat, the orientation, the scale and the extent as text", () => {
    const html = buildReportHtml(packetData());
    const text = htmlToPdfBlocks(html)
      .map((block) => ("text" in block ? block.text : ""))
      .join("\n");

    expect(text).toContain(PROJECT_GEOGRAPHY_SECTION_TITLE);
    expect(text).toMatch(/no basemap behind it/);
    expect(text).toMatch(/not a survey/);
    expect(text).toMatch(/North is up/);
    expect(text).toMatch(/Scale bar: /);
    expect(text).toMatch(/The drawing covers 39\.195°N to 39\.245°N/);
    expect(text).toContain("SR-49 through Grass Valley");
    // The drawing itself is dropped by the tier, and no markup may leak with it.
    expect(text).not.toContain("<svg");
    expect(text).not.toContain("geo-area");
  });
});

describe("the packet's study-area wording agrees with the project page's", () => {
  it("says the same thing about a hand-drawn area as the study-area lane does", () => {
    const laneSummary = buildProjectSpineCrosslinkSummary({
      projectId: "project-1",
      geography: {
        label: "Central Grass Valley study area",
        isDrawn: true,
        hasResolvableIdentity: false,
        workspaceFallbackLabel: null,
      },
      linkedRtpCycleCount: 0,
      reportRecordCount: 0,
      reportAttentionCount: 0,
      evidenceBackedReportCount: 0,
      comparisonBackedReportCount: 0,
      rtpLinks: { constrainedCount: 0, illustrativeCount: 0, candidateCount: 0 },
      scenarios: {
        scenarioSetCount: 0,
        activeScenarioSetCount: 0,
        baselineCount: 0,
        readyAlternativeCount: 0,
        attachedRunCount: 0,
      },
      funding: {
        hasTargetNeed: false,
        label: "Not recorded",
        reason: "No funding need is recorded.",
        awardCount: 0,
        opportunityCount: 0,
        reimbursementPacketCount: 0,
        unfundedAfterLikelyAmount: 0,
        awardRiskCount: 0,
      },
      engagement: { label: "Not linked", itemCount: 0, handoffReadyCount: 0 },
      analysis: { recentRunCount: 0, comparisonBackedReportCount: 0 },
      safety: {
        ingestCount: 0,
        crashCount: 0,
        geocodedCount: 0,
        coverageLabel: null,
        sourceLabel: null,
      },
      aerial: {
        missionCount: 0,
        activeMissionCount: 0,
        readyPackageCount: 0,
        verificationReadiness: "none",
      },
    });

    const laneRow = laneSummary.rows.find((row) => row.id === "geography");
    expect(laneRow).toBeDefined();
    expect(laneRow!.readiness).toBe("attention");

    // The phrase the on-screen lane uses for a drawn area, taken from the lane's
    // OWN output rather than from its source file.
    const sharedClaim = "has an extent but no place identity";
    expect(laneRow!.headline).toContain(sharedClaim);

    const html = buildReportHtml(packetData());
    expect(html).toContain(sharedClaim);
  });

  it("does not carry that caveat when the project's place actually resolves", () => {
    const html = buildReportHtml(
      packetData({
        geography: geography({
          studyArea: {
            source: "tigerweb",
            kind: "county",
            ref: "06057",
            label: "Nevada County",
            countryCode: "US",
            subdivisionCode: "CA",
            bbox: { minLon: -121.085, minLat: 39.195, maxLon: -121.025, maxLat: 39.245 },
            geometry: { type: "Polygon", coordinates: [RING] },
          },
        }),
      })
    );

    expect(html).not.toContain("has an extent but no place identity");
    expect(html).toContain("Nevada County");
  });
});
