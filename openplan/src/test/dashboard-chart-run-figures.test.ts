import { describe, expect, it } from "vitest";

import { RUN_READ_CAP } from "@/lib/dashboard/chart-reads";
import type { ChartReadOutcome, DashboardRunRow } from "@/lib/dashboard/insights";
import {
  runInsightTiles,
  runKpiCards,
  runsAreKnownEmpty,
  runsReadNotice,
} from "@/lib/dashboard/run-figures";
import { buildWorkspaceKpis } from "@/lib/metrics/workspace-kpis";

/**
 * THE EIGHT DASHBOARD TILES THAT USED TO RENDER A FAILED READ AS ZERO.
 *
 * Four sit in the overview header (total runs, completion rate, report
 * generation rate, time to first result) and four above the Insights figures.
 * Every one of them was built inline from `runsResult.data ?? []`, over a read
 * whose error the page never looked at. A workspace whose runs query FAILED
 * therefore rendered "0 · N/A · N/A · Not available" — indistinguishable from a
 * workspace that had genuinely never run anything, and sitting directly above
 * two charts drawn flat at the baseline.
 *
 * WHAT THIS FILE CANNOT PROVE. These are pure functions returning strings. No
 * jsdom, no browser: nothing here establishes that the sentences are legible,
 * that they fit in a tile, or that the warning tone is visibly different — jsdom
 * has no box model and no stylesheet, so no unit test in this repo can. Those
 * were measured in a real browser. What is proven here is WHICH words a tile
 * carries for each state of the read.
 */

const KPIS = buildWorkspaceKpis({
  workspaceCreatedAt: "2026-01-01T00:00:00Z",
  runs: [
    {
      created_at: "2026-01-02T00:00:00Z",
      metrics: { overallScore: 61 },
      summary_text: "done",
      report_generated_count: 2,
    },
    {
      created_at: "2026-01-03T00:00:00Z",
      metrics: { overallScore: 41 },
      summary_text: "done",
      report_generated_count: 0,
    },
  ],
});

const ROWS: DashboardRunRow[] = [
  {
    created_at: "2026-01-02T00:00:00Z",
    metrics: { overallScore: 61 },
    summary_text: "done",
    report_generated_count: 2,
  },
  {
    created_at: "2026-01-03T00:00:00Z",
    metrics: { overallScore: 41 },
    summary_text: "done",
    report_generated_count: 0,
  },
];

const READ = (
  overrides: Partial<ChartReadOutcome<DashboardRunRow>> = {}
): ChartReadOutcome<DashboardRunRow> => ({
  rows: ROWS,
  failed: false,
  pending: false,
  truncated: false,
  ...overrides,
});

const EMPTY_KPIS = buildWorkspaceKpis({ workspaceCreatedAt: "2026-01-01T00:00:00Z", runs: [] });

describe("a runs read that answered", () => {
  it("states the numbers", () => {
    const cards = runKpiCards(READ(), KPIS);
    expect(cards.map((card) => card.label)).toEqual([
      "Total runs",
      "Run completion rate",
      "Report generation rate",
      "Time to first result",
    ]);
    expect(cards[0].value).toBe("2");
    expect(cards[1].value).toBe("100%");
    expect(cards[2].value).toBe("50%");
  });

  it("keeps the median and the report count on the Insights tiles", () => {
    const tiles = runInsightTiles(READ(), KPIS, 4);
    expect(tiles.map((tile) => tile.value)).toEqual(["2", "2", "51", "4"]);
    expect(tiles[3].label).toBe("Waiting on you");
  });

  it("says a workspace with no runs is empty, because it knows that", () => {
    expect(runsAreKnownEmpty(READ({ rows: [] }))).toBe(true);
    expect(runKpiCards(READ({ rows: [] }), EMPTY_KPIS)[0].value).toBe("0");
  });
});

describe("a runs read that failed", () => {
  const failed = READ({ rows: [], failed: true });

  it("refuses to state a single one of the four header numbers", () => {
    const cards = runKpiCards(failed, EMPTY_KPIS);
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.value).toBe("Could not load");
      expect(card.value).not.toBe("0");
      expect(card.detail).toMatch(/do not read it as zero/i);
    }
  });

  it("refuses the three runs-derived Insights tiles and keeps the one that still works", () => {
    const tiles = runInsightTiles(failed, EMPTY_KPIS, 4);

    for (const tile of tiles.slice(0, 3)) {
      expect(tile.value).toBe("Could not load");
      expect(tile.tone).toBe("attention");
    }
    // "Waiting on you" comes from the operations summary, not from this read.
    // Hiding it behind an unrelated failure would lose a working number.
    expect(tiles[3]).toMatchObject({ label: "Waiting on you", value: "4" });
  });

  it("is never described as an empty workspace", () => {
    expect(runsAreKnownEmpty(failed)).toBe(false);
  });

  it("does not word a failure the way it words an absence", () => {
    const failedDetail = runKpiCards(failed, EMPTY_KPIS)[0].detail;
    const emptyDetail = runKpiCards(READ({ rows: [] }), EMPTY_KPIS)[0].detail;
    expect(failedDetail).not.toBe(emptyDetail);
  });
});

describe("the other two ways a runs read fails to answer", () => {
  it("names a pending migration as an operator move, not as a fault", () => {
    const notice = runsReadNotice(READ({ rows: [], pending: true }));
    expect(notice?.value).toBe("Not switched on");
    expect(notice?.detail).toMatch(/migration/i);
    expect(notice?.tone).toBe("neutral");
    expect(runsAreKnownEmpty(READ({ rows: [], pending: true }))).toBe(false);
  });

  it("refuses a total drawn from a read that hit its cap, and says what the cap is", () => {
    const notice = runsReadNotice(READ({ truncated: true }));
    expect(notice?.value).toBe("Too many to count");
    expect(notice?.detail).toContain(String(RUN_READ_CAP));
    expect(runsAreKnownEmpty(READ({ truncated: true }))).toBe(false);
  });

  it("answers null for a read that did answer, so the numbers are stated", () => {
    expect(runsReadNotice(READ())).toBeNull();
  });
});
