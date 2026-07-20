import { describe, expect, it } from "vitest";

import { deriveEmissionsScreen, formatMetricTons } from "@/lib/models/emissions-screen";

describe("deriveEmissionsScreen", () => {
  it("reads CO2e KPIs and the rate/year from breakdown_json", () => {
    const screen = deriveEmissionsScreen([
      { kpi_name: "daily_vmt", value: 1_000_000, unit: "vehicle-miles/day" },
      {
        kpi_name: "co2e_metric_tons_year",
        value: 153_349.9,
        unit: "metric tons CO2e/year",
        breakdown_json: { co2e_g_per_mile: 355, analysis_year: 2025, provenance: "screening…" },
      },
      { kpi_name: "co2e_kg_per_capita_day", value: 4.12, unit: "kg CO2e/person/day" },
    ]);
    expect(screen).not.toBeNull();
    expect(screen?.co2eMetricTonsYear).toBe(153_349.9);
    expect(screen?.co2eKgPerCapitaDay).toBe(4.12);
    expect(screen?.co2eGramsPerMile).toBe(355);
    expect(screen?.analysisYear).toBe(2025);
    expect(screen?.provenance).toBe("screening…");
  });

  it("returns null when no emissions KPI is present", () => {
    expect(deriveEmissionsScreen([{ kpi_name: "daily_vmt", value: 100 }])).toBeNull();
  });

  it("formats metric tons with a unit and thousands separators", () => {
    expect(formatMetricTons(153_349.9)).toBe("153,350 MT CO₂e/yr");
    expect(formatMetricTons(null)).toBe("—");
  });
});
