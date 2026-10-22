import { describe, expect, it } from "vitest";

import {
  ATP_PACKET_NO_RUN_ID,
  buildAtpPacketView,
  identifySeededCatalogKey,
  isAtpApplication,
} from "@/lib/grants/atp-packet";
import { atpGrantFactBlocks, computeAtpPacket } from "@/lib/planner-pack/atp";
import { renderAtpPacketMarkdown } from "@/lib/planner-pack/render";

/**
 * Which applications get the California ATP packet, and what the packet says
 * when OpenPlan holds only part of its inputs.
 *
 * Blind category: identification reads seeded section keys only. An ATP
 * application built entirely from custom sections is not recognised, by design.
 */

const catalog = (...keys: string[]) => keys.map((section_key) => ({ section_key, source: "catalog" }));

const ATP_SECTIONS = catalog(
  "project-narrative",
  "need-and-safety",
  "disadvantaged-communities",
  "community-engagement",
  "cost-effectiveness-leverage",
  "implementation-schedule",
  "budget-narrative"
);

describe("which applications are ATP applications", () => {
  it("recognises the full ATP seed and a remnant that still has an ATP-only section", () => {
    expect(identifySeededCatalogKey(ATP_SECTIONS)).toBe("atp");
    expect(isAtpApplication(catalog("project-narrative", "disadvantaged-communities"))).toBe(true);
  });

  it("does not treat another program's seed as ATP, even one sharing ATP section keys", () => {
    // Washington's WSDOT pedestrian and bicycle program shares need-and-safety.
    const washington = catalog("project-description", "need-and-safety", "active-transportation-demand", "budget-and-cost-estimate");
    expect(identifySeededCatalogKey(washington)).toBe("wa-wsdot-ped-bike");
    expect(isAtpApplication(washington)).toBe(false);
    expect(isAtpApplication(catalog("project-overview", "safety-problem-and-impact"))).toBe(false);
  });

  it("refuses to guess from shared keys alone, custom sections, or a proposal", () => {
    // project-narrative and budget-narrative fit only ATP's template, but both
    // also appear in other templates, so they do not establish the program.
    expect(identifySeededCatalogKey(catalog("project-narrative", "budget-narrative"))).toBeNull();
    expect(identifySeededCatalogKey([{ section_key: "disadvantaged-communities", source: "custom" }])).toBeNull();
    expect(identifySeededCatalogKey(catalog("approach", "team_qualifications"))).toBeNull();
    expect(identifySeededCatalogKey([])).toBeNull();
  });
});

describe("the packet built from workspace evidence", () => {
  const project = { id: "p-main", name: "Main Street safe routes" };

  it("takes safety and equity from the run and leaves the rest not recorded", () => {
    const view = buildAtpPacketView({
      project,
      run: {
        id: "run-1",
        title: "Main Street corridor",
        created_at: "2026-09-02T17:00:00Z",
        metrics: { safetyScore: 64, equityScore: 71, overallScore: 58 },
      },
      generatedAt: "2026-10-12T00:00:00Z",
    });
    const [app] = view.packet.applications;

    expect(view.packet.run_id).toBe("run-1");
    expect(app.safety_score).toBe(64);
    expect(app.equity_score).toBe(71);
    // The corridor composite is a different formula from the ATP 30/25/25/20 total.
    expect(app.total_score).toBeNull();
    expect(app.climate_score).toBeNull();
    expect(app.feasibility_score).toBeNull();
    expect(app.sensitivity_flag).toBe("UNKNOWN");
    expect(app.equity_recorded).toBe(false);
    expect(view.packet.summary?.mean_total_score).toBeNull();
    expect(view.packet.summary?.equity_recorded_count).toBe(0);
    expect(view.scoreRun).toEqual({ id: "run-1", title: "Main Street corridor", createdAt: "2026-09-02T17:00:00Z" });
  });

  it("keeps a score the run withheld null, not the stored number", () => {
    const view = buildAtpPacketView({
      project,
      run: {
        id: "run-2",
        title: null,
        created_at: null,
        metrics: {
          safetyScore: 12,
          equityScore: 40,
          scorePresentation: {
            safety: { value: null, eligible: false },
            equity: { value: 40, eligible: true },
          },
        },
      },
    });
    expect(view.packet.applications[0].safety_score).toBeNull();
    expect(view.packet.applications[0].equity_score).toBe(40);
  });

  it("builds an all-not-recorded packet when the project has no run", () => {
    const view = buildAtpPacketView({ project, run: null });
    expect(view.packet.run_id).toBe(ATP_PACKET_NO_RUN_ID);
    expect(view.packet.applications[0].safety_score).toBeNull();
    expect(view.scoreRun).toBeNull();
  });
});

describe("ATP equity findings the lens did not record", () => {
  const rows = [
    { project_id: "p1", name: "One", total_score: "70" },
    { project_id: "p2", name: "Two", total_score: "80" },
  ];

  it("renders not recorded instead of No when no equity row exists", () => {
    const result = computeAtpPacket(rows, { runId: "r", generatedAt: "2026-10-12T00:00:00Z" });
    const markdown = renderAtpPacketMarkdown(result, { runId: "r", engineVersion: "test" });

    expect(markdown).toContain("- SB 535 DAC: Not recorded");
    expect(markdown).not.toMatch(/^- SB 535 DAC: No$/m);
    expect(markdown).toContain("- ATP DAC benefit bonus eligible: **Not recorded**");
    expect(markdown).toContain("- SB 535 DAC applications: **Not recorded**");
    expect(markdown).not.toContain("**0** (0.0%)");
    const summaryBlock = atpGrantFactBlocks(result, "packet.csv").at(-1);
    expect(summaryBlock?.claim_text).toContain("community context not recorded.");
    expect(atpGrantFactBlocks(result, "packet.csv")[0].claim_text).toContain("community context not recorded;");
  });

  it("says the counts are partial when only some projects have equity findings", () => {
    const result = computeAtpPacket(rows, {
      runId: "r",
      equityRows: [{ project_id: "p1", dac_sb535: "false", overlay_supplied: "true" }],
    });
    const markdown = renderAtpPacketMarkdown(result, { runId: "r", engineVersion: "test" });

    expect(result.summary?.equity_recorded_count).toBe(1);
    expect(markdown).toMatch(/^- SB 535 DAC: No$/m);
    expect(markdown).toContain("- SB 535 DAC: Not recorded");
    expect(markdown).toContain("Equity findings recorded for 1 of 2 applications");
    expect(atpGrantFactBlocks(result, "packet.csv").at(-1)?.claim_text).toContain(
      "(partial: 1 of 2 applications have equity findings)."
    );
  });
});
