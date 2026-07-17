import { describe, expect, it } from "vitest";

import {
  ATP_DAC_SCORING_CATEGORIES,
  DEFAULT_ATP_AGENCY,
  DEFAULT_ATP_CYCLE,
  atpGrantFactBlocks,
  computeAtpPacket,
} from "@/lib/planner-pack/atp";
import { renderAtpPacketMarkdown } from "@/lib/planner-pack/render";
import { InsufficientDataError, type AtpScoreRow } from "@/lib/planner-pack/types";

// Ported from clawmodeler tests/test_atp_packet.py (ComputeAtpPacketTest +
// AtpFactBlocksTest). The filesystem-oriented WriteAtpPacketTest cases have
// no equivalent here (OpenPlan does not port the workspace/run directory
// layer); their report-content assertions are covered by the renderer tests
// below.

const SCORE_ROWS: AtpScoreRow[] = [
  {
    project_id: "p1",
    name: "Downtown complete streets",
    safety_score: "80",
    equity_score: "90",
    climate_score: "70",
    feasibility_score: "60",
    total_score: "78",
    sensitivity_flag: "LOW",
  },
  {
    project_id: "p2",
    name: "Safe Routes to School",
    safety_score: "70",
    equity_score: "80",
    climate_score: "60",
    feasibility_score: "75",
    total_score: "72",
    sensitivity_flag: "MEDIUM",
  },
];

describe("computeAtpPacket", () => {
  it("falls back to honest defaults without Planner Pack inputs", () => {
    const result = computeAtpPacket(SCORE_ROWS, { runId: "r1" });

    expect(result.agency).toBe(DEFAULT_ATP_AGENCY);
    expect(result.cycle).toBe(DEFAULT_ATP_CYCLE);
    expect(result.applications).toHaveLength(2);
    for (const app of result.applications) {
      expect(app.benefit_category).toBe("Unknown");
      expect(app.estimated_cost_usd).toBeNull();
      expect(app.atp_dac_benefit_eligible).toBe(false);
      expect(app.location_note).toContain("to be provided by lead agency");
      expect(app.ceqa_determination).toContain("not been run");
    }
  });

  it("populates programming fields from LAPM enrichment", () => {
    const lapmRows = [
      {
        project_id: "p1",
        location_note: "38.001, -121.002",
        description: "Add buffered bike lanes on Main Street.",
        project_type: "Active Transportation",
        estimated_cost_usd: "2500000",
        schedule_note: "PA&ED FY26; CON FY28.",
      },
    ];
    const result = computeAtpPacket(SCORE_ROWS, { runId: "r1", lapmRows });
    const app = result.applications.find((candidate) => candidate.project_id === "p1");

    expect(app?.location_note).toBe("38.001, -121.002");
    expect(app?.project_type).toBe("Active Transportation");
    expect(app?.estimated_cost_usd).toBe(2500000.0);
  });

  it("drives DAC bonus eligibility from the equity lens", () => {
    const equityRows = [
      {
        project_id: "p1",
        dac_sb535: "true",
        low_income_ab1550: "true",
        tribal_area: "false",
        benefit_category: "DAC",
        overlay_supplied: "true",
      },
      {
        project_id: "p2",
        dac_sb535: "false",
        low_income_ab1550: "false",
        tribal_area: "false",
        benefit_category: "Other",
        overlay_supplied: "true",
      },
    ];
    const result = computeAtpPacket(SCORE_ROWS, { runId: "r1", equityRows });
    const byId = new Map(result.applications.map((app) => [app.project_id, app]));

    expect(byId.get("p1")?.dac_sb535).toBe(true);
    expect(byId.get("p1")?.atp_dac_benefit_eligible).toBe(true);
    expect(byId.get("p1")?.benefit_category).toBe("DAC");
    expect(ATP_DAC_SCORING_CATEGORIES.has("DAC")).toBe(true);
    expect(byId.get("p2")?.atp_dac_benefit_eligible).toBe(false);
    expect(byId.get("p2")?.benefit_category).toBe("Other");
  });

  it("summarizes the CEQA significance mix across scenarios", () => {
    const ceqaRows = [
      { scenario_id: "baseline", determination: "less than significant" },
      { scenario_id: "infill-growth", determination: "potentially significant" },
    ];
    const result = computeAtpPacket(SCORE_ROWS, { runId: "r1", ceqaRows });
    for (const app of result.applications) {
      expect(app.ceqa_determination).toContain("1 potentially significant");
      expect(app.ceqa_determination).toContain("1 less-than-significant");
    }
  });

  it("populates the RTP consistency note from the cycle label", () => {
    const result = computeAtpPacket(SCORE_ROWS, { runId: "r1", rtpCycleLabel: "2026 RTP" });
    for (const app of result.applications) {
      expect(app.rtp_consistency_note).toContain("2026 RTP");
    }
  });

  it("varies the readiness note with the sensitivity flag", () => {
    const rows = [
      { ...SCORE_ROWS[0], sensitivity_flag: "LOW" },
      { ...SCORE_ROWS[0], project_id: "p3", sensitivity_flag: "HIGH" },
    ];
    const result = computeAtpPacket(rows, { runId: "r1" });
    const byId = new Map(result.applications.map((app) => [app.project_id, app]));

    expect(byId.get("p1")?.readiness_note).toContain("ready for PA&ED");
    expect(byId.get("p3")?.readiness_note).toContain("Two or more");
  });

  it("aggregates the portfolio summary", () => {
    const equityRows = [
      {
        project_id: "p1",
        dac_sb535: "true",
        low_income_ab1550: "true",
        tribal_area: "false",
        benefit_category: "DAC",
        overlay_supplied: "true",
      },
      {
        project_id: "p2",
        dac_sb535: "false",
        low_income_ab1550: "true",
        tribal_area: "true",
        benefit_category: "Low-income",
        overlay_supplied: "true",
      },
    ];
    const result = computeAtpPacket(SCORE_ROWS, { runId: "r1", equityRows });
    const summary = result.summary;

    expect(summary).not.toBeNull();
    expect(summary?.application_count).toBe(2);
    expect(summary?.dac_application_count).toBe(1);
    expect(summary?.low_income_application_count).toBe(1);
    expect(summary?.tribal_application_count).toBe(1);
    expect(summary?.dac_share).toBe(0.5);
    expect(summary?.mean_total_score).toBeCloseTo(75.0);
  });

  it("raises InsufficientDataError on empty rows", () => {
    expect(() => computeAtpPacket([], { runId: "r1" })).toThrow(InsufficientDataError);
    expect(() => computeAtpPacket([], { runId: "r1" })).toThrow(
      "project_scores rows are empty; run a workflow before generating an ATP packet."
    );
  });

  it("raises InsufficientDataError when no row has a usable project_id", () => {
    expect(() => computeAtpPacket([{ project_id: "", name: "x" }], { runId: "r1" })).toThrow(
      InsufficientDataError
    );
    expect(() => computeAtpPacket([{ project_id: "", name: "x" }], { runId: "r1" })).toThrow(
      "project_scores rows had no usable project_id values."
    );
  });

  // JS-specific: benefit_category default depends on whether the overlay was supplied.
  it("labels benefit category Unknown without an overlay and Other with one", () => {
    const withOverlay = computeAtpPacket(SCORE_ROWS, {
      runId: "r1",
      equityRows: [{ project_id: "p1", overlay_supplied: "true" }],
    });
    const byId = new Map(withOverlay.applications.map((app) => [app.project_id, app]));
    expect(byId.get("p1")?.benefit_category).toBe("Other");
    expect(byId.get("p2")?.benefit_category).toBe("Unknown");
  });

  // JS-specific: CSV boolean token coercion must match the Python truthy set.
  it("coerces CSV boolean tokens like the Python _coerce_bool", () => {
    for (const token of ["true", "T", "1", "yes", "Y"]) {
      const result = computeAtpPacket([SCORE_ROWS[0]], {
        runId: "r1",
        equityRows: [{ project_id: "p1", dac_sb535: token, overlay_supplied: "true" }],
      });
      expect(result.applications[0].dac_sb535).toBe(true);
    }
    for (const token of ["false", "0", "no", "", "maybe"]) {
      const result = computeAtpPacket([SCORE_ROWS[0]], {
        runId: "r1",
        equityRows: [{ project_id: "p1", dac_sb535: token, overlay_supplied: "true" }],
      });
      expect(result.applications[0].dac_sb535).toBe(false);
    }
  });
});

describe("atpGrantFactBlocks", () => {
  it("produces a per-application block and a portfolio summary block", () => {
    const result = computeAtpPacket([SCORE_ROWS[0]], {
      runId: "r1",
      agency: "City of Grass Valley",
      cycle: "ATP Cycle 7",
    });
    const blocks = atpGrantFactBlocks(result, "/tmp/atp_packet.csv");

    expect(blocks).toHaveLength(2);
    const [projectBlock, summaryBlock] = blocks;
    expect(projectBlock.fact_type).toBe("atp_application_project");
    expect(projectBlock.fact_id).toBe("atp-application-p1");
    expect(projectBlock.claim_text).toContain("total screening score");
    expect(summaryBlock.fact_type).toBe("atp_application_summary");
    expect(summaryBlock.fact_id).toBe("atp-application-summary");
    expect(summaryBlock.claim_text).toContain("ATP Cycle 7");
  });

  it("matches the Python claim strings byte-for-byte", () => {
    // Exact strings verified against atp_grant_fact_blocks for these inputs.
    const equityRows = [
      {
        project_id: "p1",
        dac_sb535: "true",
        low_income_ab1550: "true",
        tribal_area: "false",
        benefit_category: "DAC",
        overlay_supplied: "true",
      },
      {
        project_id: "p2",
        dac_sb535: "false",
        low_income_ab1550: "false",
        tribal_area: "true",
        benefit_category: "Other",
        overlay_supplied: "true",
      },
    ];
    const result = computeAtpPacket(SCORE_ROWS, {
      runId: "run-1",
      agency: "City of Grass Valley",
      cycle: "ATP Cycle 7",
      equityRows,
    });
    const blocks = atpGrantFactBlocks(result, "/tmp/atp_packet.csv");

    expect(blocks[0].claim_text).toBe(
      "ATP application draft for project `p1` (Downtown complete streets): total screening score 78.0/100 (safety 80.0, equity 90.0, climate 70.0, feasibility 60.0); community context SB 535 DAC; sensitivity flag LOW."
    );
    expect(blocks[1].claim_text).toBe(
      "ATP application draft for project `p2` (Safe Routes to School): total screening score 72.0/100 (safety 70.0, equity 80.0, climate 60.0, feasibility 75.0); community context non-DAC / non-AB-1550; sensitivity flag MEDIUM."
    );
    expect(blocks[2].claim_text).toBe(
      "ATP portfolio for City of Grass Valley (ATP Cycle 7): 2 application draft(s), mean total score 75.0/100; 1 SB 535 DAC (50.0%), 0 AB 1550 low-income (not DAC), 1 in a tribal area."
    );
  });
});

describe("renderAtpPacketMarkdown", () => {
  const options = { runId: "run-1", engineVersion: "1.0.0" };

  it("renders the packet with rubric table, DAC section, and statutory citations", () => {
    const result = computeAtpPacket(SCORE_ROWS, {
      runId: "run-1",
      agency: "City of Grass Valley",
      cycle: "ATP Cycle 7",
      lapmRows: [
        {
          project_id: "p1",
          location_note: "38.001, -121.002",
          description: "Add buffered bike lanes on Main Street.",
          project_type: "Active Transportation",
          estimated_cost_usd: "2500000",
          schedule_note: "PA&ED FY26; CON FY28.",
        },
      ],
      equityRows: [
        {
          project_id: "p1",
          dac_sb535: "true",
          low_income_ab1550: "true",
          tribal_area: "false",
          benefit_category: "DAC",
          overlay_supplied: "true",
        },
      ],
      rtpCycleLabel: "2026 RTP",
      generatedAt: "2026-07-17T00:00:00Z",
    });
    const markdown = renderAtpPacketMarkdown(result, options);

    expect(markdown).toContain("# California ATP Application Packet — run `run-1`");
    expect(markdown).toContain("- Lead agency: **City of Grass Valley**");
    expect(markdown).toContain("- ATP cycle: **ATP Cycle 7**");
    expect(markdown).toContain("- Application drafts in this packet: **2**");
    expect(markdown).toContain("### `p1` — Downtown complete streets");
    expect(markdown).toContain("| Safety | 80.0 |");
    expect(markdown).toContain("| **Total (weighted 30/25/25/20)** | **78.0** |");
    expect(markdown).toContain("- SB 535 DAC: Yes");
    expect(markdown).toContain("- ATP DAC benefit bonus eligible: **Yes**");
    expect(markdown).toContain(
      "- Estimated programmed cost: **$2500000** (lead agency estimate; allocate across PA&ED / PS&E / R/W / CON per LAPM Chapter 3)."
    );
    expect(markdown).toContain("2026 RTP");
    expect(markdown).toContain(
      "- California Streets & Highways Code §§ 2380–2383 — Active Transportation Program."
    );
    expect(markdown).toContain("- California Government Code §39711 — SB 535 (De León, 2012).");
    expect(markdown).toContain(
      "- California Health & Safety Code §39713 — AB 1550 (Gomez, 2016)."
    );
  });

  it("keeps lead-agency placeholders when no enrichment exists", () => {
    const result = computeAtpPacket(SCORE_ROWS, { runId: "run-2" });
    const markdown = renderAtpPacketMarkdown(result, options);

    expect(markdown).toContain("- Lead agency: **Lead agency to be provided**");
    expect(markdown).toContain("to be provided by lead agency");
    expect(markdown).toContain(
      "- Estimated programmed cost: _to be provided by lead agency (PA&ED, PS&E, R/W, CON)._"
    );
    expect(markdown).toContain("RTP consistency to be documented by lead agency.");
    expect(markdown).toContain(
      "CEQA §15064.3 VMT screening has not been run for this workspace."
    );
  });

  it("preserves the screening-level draft caveat verbatim", () => {
    const result = computeAtpPacket(SCORE_ROWS, { runId: "run-2" });
    const markdown = renderAtpPacketMarkdown(result, options);

    expect(markdown).toContain(
      "- This packet is a **screening-level draft**. It does not substitute for\n  the lead agency's submitted ATP application, CTC scoring, CEQA\n  determination, or AB 52 tribal consultation."
    );
    expect(markdown).toContain(
      "- _Lead agency to supply._ OpenPlan does not synthesize prior-project"
    );
  });

  it("renders the portfolio-summary fallback when summary is null", () => {
    const result = {
      ...computeAtpPacket(SCORE_ROWS, { runId: "run-3" }),
      summary: null,
    };
    const markdown = renderAtpPacketMarkdown(result, options);
    expect(markdown).toContain("_Portfolio summary unavailable._");
  });

  it("renders portfolio summary shares with one decimal", () => {
    const result = computeAtpPacket(SCORE_ROWS, {
      runId: "run-4",
      equityRows: [
        {
          project_id: "p1",
          dac_sb535: "true",
          overlay_supplied: "true",
          benefit_category: "DAC",
        },
      ],
    });
    const markdown = renderAtpPacketMarkdown(result, options);
    expect(markdown).toContain("- SB 535 DAC applications: **1** (50.0%)");
    expect(markdown).toContain("- Mean screening total score: **75.0**");
  });
});
