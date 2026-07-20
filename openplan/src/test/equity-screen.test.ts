import { describe, expect, it } from "vitest";

import { deriveEquityScreen, formatShare } from "@/lib/models/equity-screen";

describe("deriveEquityScreen", () => {
  it("reads equity KPIs + groups from breakdown_json", () => {
    const screen = deriveEquityScreen([
      { kpi_name: "daily_vmt", value: 1_000_000 },
      {
        kpi_name: "equity_focus_zone_count",
        value: 4,
        breakdown_json: {
          geography: "tract",
          provenance: "screening…",
          equity_focus: { population: 13838, resident_vmt_per_capita: 1.14, avg_low_income_share: 0.157, avg_minority_share: 0.168, avg_zero_vehicle_share: 0.141 },
          rest_of_area: { population: 24643, resident_vmt_per_capita: 0.66, avg_low_income_share: 0.108, avg_minority_share: 0.177, avg_zero_vehicle_share: 0.011 },
        },
      },
      { kpi_name: "equity_focus_population_share", value: 36 },
      { kpi_name: "equity_focus_vmt_per_capita", value: 1.1433 },
      { kpi_name: "equity_rest_vmt_per_capita", value: 0.6613 },
      { kpi_name: "equity_vmt_disparity_ratio", value: 1.729 },
    ]);
    expect(screen).not.toBeNull();
    expect(screen?.geography).toBe("tract");
    expect(screen?.focusZoneCount).toBe(4);
    expect(screen?.disparityRatio).toBe(1.729);
    expect(screen?.focus?.avg_zero_vehicle_share).toBe(0.141);
    expect(screen?.rest?.resident_vmt_per_capita).toBe(0.66);
  });

  it("returns null when no equity KPI is present", () => {
    expect(deriveEquityScreen([{ kpi_name: "daily_vmt", value: 1 }])).toBeNull();
  });

  it("formats shares as rounded percents", () => {
    expect(formatShare(0.157)).toBe("16%");
    expect(formatShare(null)).toBe("—");
  });
});
