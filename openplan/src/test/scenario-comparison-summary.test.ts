import { describe, expect, it, vi } from "vitest";

import {
  groupScenarioComparisonSummaryByIndicator,
  loadScenarioComparisonSummary,
  loadScenarioComparisonSummaryForProjects,
  totalReadySnapshotCount,
  type ScenarioComparisonSummaryRow,
} from "@/lib/scenarios/comparison-summary";

function makeRow(overrides: Partial<ScenarioComparisonSummaryRow> = {}): ScenarioComparisonSummaryRow {
  return {
    scenario_set_id: "set-1",
    indicator_key: "vmt_per_capita",
    indicator_label: "VMT per capita",
    unit_label: "mi/person/day",
    latest_delta_json: { delta: -0.4 },
    latest_summary_text: "VMT drops with new BRT",
    latest_ready_updated_at: "2026-04-16T12:00:00Z",
    ready_snapshot_count: 2,
    total_snapshot_count: 3,
    ...overrides,
  };
}

describe("loadScenarioComparisonSummary", () => {
  it("returns summary rows scoped to the provided scenario_set_ids", async () => {
    const inMock = vi.fn(async () => ({
      data: [makeRow(), makeRow({ indicator_key: "mode_share_transit" })],
      error: null,
    }));
    const selectMock = vi.fn(() => ({ in: inMock }));
    const from = vi.fn((table: string) => {
      if (table !== "scenario_comparison_summary") throw new Error(`Unexpected: ${table}`);
      return { select: selectMock };
    });

    const result = await loadScenarioComparisonSummary({
      supabase: { from } as unknown as Parameters<typeof loadScenarioComparisonSummary>[0]["supabase"],
      scenarioSetIds: ["set-1", "set-1", "set-2"],
    });

    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(2);
    expect(inMock).toHaveBeenCalledWith("scenario_set_id", ["set-1", "set-2"]);
  });

  it("chains an indicator_key filter when provided", async () => {
    const chainedIn = vi.fn(async () => ({ data: [makeRow()], error: null }));
    const firstIn = vi.fn(() => ({ in: chainedIn }));
    const selectMock = vi.fn(() => ({ in: firstIn }));
    const from = vi.fn(() => ({ select: selectMock }));

    const result = await loadScenarioComparisonSummary({
      supabase: { from } as unknown as Parameters<typeof loadScenarioComparisonSummary>[0]["supabase"],
      scenarioSetIds: ["set-1"],
      indicatorKeys: ["vmt_per_capita", "vmt_per_capita", "mode_share_transit"],
    });

    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(firstIn).toHaveBeenCalledWith("scenario_set_id", ["set-1"]);
    expect(chainedIn).toHaveBeenCalledWith("indicator_key", ["vmt_per_capita", "mode_share_transit"]);
  });

  it("short-circuits when no scenario ids are provided", async () => {
    const from = vi.fn();
    const result = await loadScenarioComparisonSummary({
      supabase: { from } as unknown as Parameters<typeof loadScenarioComparisonSummary>[0]["supabase"],
      scenarioSetIds: [],
    });

    expect(result.error).toBeNull();
    expect(result.rows).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces supabase errors without throwing", async () => {
    const inMock = vi.fn(async () => ({ data: null, error: { message: "rls denied", code: "42501" } }));
    const from = vi.fn(() => ({ select: () => ({ in: inMock }) }));

    const result = await loadScenarioComparisonSummary({
      supabase: { from } as unknown as Parameters<typeof loadScenarioComparisonSummary>[0]["supabase"],
      scenarioSetIds: ["set-1"],
    });

    expect(result.rows).toEqual([]);
    expect(result.error).toEqual({ message: "rls denied", code: "42501" });
  });
});

describe("groupScenarioComparisonSummaryByIndicator", () => {
  it("groups rows by indicator_key", () => {
    const rows = [
      makeRow({ indicator_key: "vmt_per_capita", scenario_set_id: "set-a" }),
      makeRow({ indicator_key: "vmt_per_capita", scenario_set_id: "set-b" }),
      makeRow({ indicator_key: "mode_share_transit", scenario_set_id: "set-a" }),
    ];

    const grouped = groupScenarioComparisonSummaryByIndicator(rows);

    expect(grouped.get("vmt_per_capita")).toHaveLength(2);
    expect(grouped.get("mode_share_transit")).toHaveLength(1);
  });
});

describe("totalReadySnapshotCount", () => {
  it("sums ready_snapshot_count across rows", () => {
    const total = totalReadySnapshotCount([
      makeRow({ ready_snapshot_count: 2 }),
      makeRow({ ready_snapshot_count: 1 }),
      makeRow({ ready_snapshot_count: 4 }),
    ]);
    expect(total).toBe(7);
  });
});

describe("loadScenarioComparisonSummaryForProjects", () => {
  it("resolves scenario sets for the given projects then loads the summary view", async () => {
    const scenarioSetsIn = vi.fn(async () => ({
      data: [
        { id: "set-a", project_id: "proj-1" },
        { id: "set-b", project_id: "proj-2" },
      ],
      error: null,
    }));
    const summaryIn = vi.fn(async () => ({
      data: [
        makeRow({ scenario_set_id: "set-a" }),
        makeRow({ scenario_set_id: "set-b", indicator_key: "mode_share_transit" }),
      ],
      error: null,
    }));
    const from = vi.fn((table: string) => {
      if (table === "scenario_sets") {
        return { select: vi.fn(() => ({ in: scenarioSetsIn })) };
      }
      if (table === "scenario_comparison_summary") {
        return { select: vi.fn(() => ({ in: summaryIn })) };
      }
      throw new Error(`Unexpected: ${table}`);
    });

    const result = await loadScenarioComparisonSummaryForProjects({
      supabase: { from } as unknown as Parameters<typeof loadScenarioComparisonSummaryForProjects>[0]["supabase"],
      projectIds: ["proj-1", "proj-2"],
    });

    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(2);
    expect(result.scenarioSetProjectMap.get("set-a")).toBe("proj-1");
    expect(result.scenarioSetProjectMap.get("set-b")).toBe("proj-2");
  });

  it("short-circuits when no scenario sets exist for the given projects", async () => {
    const scenarioSetsIn = vi.fn(async () => ({ data: [], error: null }));
    const kpiSummarySelect = vi.fn();
    const from = vi.fn((table: string) => {
      if (table === "scenario_sets") {
        return { select: vi.fn(() => ({ in: scenarioSetsIn })) };
      }
      if (table === "scenario_comparison_summary") {
        return { select: kpiSummarySelect };
      }
      throw new Error(`Unexpected: ${table}`);
    });

    const result = await loadScenarioComparisonSummaryForProjects({
      supabase: { from } as unknown as Parameters<typeof loadScenarioComparisonSummaryForProjects>[0]["supabase"],
      projectIds: ["proj-1"],
    });

    expect(result.error).toBeNull();
    expect(result.rows).toEqual([]);
    expect(result.scenarioSetProjectMap.size).toBe(0);
    expect(kpiSummarySelect).not.toHaveBeenCalled();
  });
});
