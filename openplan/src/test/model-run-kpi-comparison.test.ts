import { describe, expect, it } from "vitest";
import {
  buildModelRunKpiComparisonSummary,
  formatModelRunKpiDelta,
  formatModelRunKpiPercentDelta,
  formatModelRunKpiValue,
  normalizeModelRunKpiComparisonItems,
} from "@/lib/models/kpi-comparison";

describe("model run KPI comparison helpers", () => {
  it("normalizes KPI comparison rows and preserves geometry refs", () => {
    const items = normalizeModelRunKpiComparisonItems([
      {
        kpi_category: "assignment",
        kpi_name: "corridor_vmt",
        kpi_label: "Corridor VMT",
        value: 1200,
        baseline_value: 1000,
        absolute_delta: 200,
        percent_delta: 20,
        unit: "miles",
        geometry_ref: "corridor-1",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "corridor_vmt::corridor-1",
      category: "assignment",
      label: "Corridor VMT",
      changed: true,
      geometryRef: "corridor-1",
    });
  });

  it("builds summary counts, highlights, and category groupings", () => {
    const summary = buildModelRunKpiComparisonSummary([
      {
        kpi_category: "assignment",
        kpi_name: "avg_travel_time",
        kpi_label: "Avg Travel Time",
        value: 18,
        baseline_value: 15,
        absolute_delta: 3,
        percent_delta: 20,
        unit: "min",
      },
      {
        kpi_category: "assignment",
        kpi_name: "corridor_vmt",
        kpi_label: "Corridor VMT",
        value: 5000,
        baseline_value: 5000,
        absolute_delta: 0,
        percent_delta: 0,
        unit: "miles",
      },
      {
        kpi_category: "accessibility",
        kpi_name: "jobs_access_30",
        kpi_label: "Jobs within 30 min",
        value: 24000,
        baseline_value: 20000,
        absolute_delta: 4000,
        percent_delta: 20,
        unit: "jobs",
      },
      {
        kpi_category: "safety",
        kpi_name: "fatal_crashes",
        kpi_label: "Fatal crashes",
        value: 4,
        baseline_value: null,
        absolute_delta: null,
        percent_delta: null,
        unit: "count",
      },
    ]);

    expect(summary.totalCount).toBe(4);
    expect(summary.comparableCount).toBe(3);
    expect(summary.changedCount).toBe(2);
    expect(summary.flatCount).toBe(1);
    expect(summary.missingBaselineCount).toBe(1);
    expect(summary.highlights).toHaveLength(2);
    expect(summary.largestChange?.label).toBe("Jobs within 30 min");
    expect(summary.categories.find((category) => category.category === "accessibility")).toMatchObject({
      changedCount: 1,
    });
    expect(summary.categories.find((category) => category.category === "assignment")).toMatchObject({
      comparableCount: 2,
      changedCount: 1,
    });
  });

  it("formats KPI values and deltas for display", () => {
    expect(formatModelRunKpiValue(1234.56, "jobs")).toBe("1,235 jobs");
    expect(formatModelRunKpiValue(12.345, "min")).toBe("12.35 min");
    expect(formatModelRunKpiDelta(-2.5, "min")).toBe("-2.5 min");
    expect(formatModelRunKpiPercentDelta(7.25)).toBe("+7.25%");
    expect(formatModelRunKpiValue(null)).toBe("N/A");
    expect(formatModelRunKpiDelta(null)).toBe("N/A");
    expect(formatModelRunKpiPercentDelta(null)).toBeNull();
  });
});
