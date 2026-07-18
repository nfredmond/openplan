import { describe, expect, it } from "vitest";
import {
  deriveCeqaVmtScreeningInputs,
  type CeqaVmtKpiRowLike,
} from "@/lib/models/ceqa-vmt-screen";

function kpi(
  kpi_name: string,
  value: number | null,
  extra: Partial<CeqaVmtKpiRowLike> = {}
): CeqaVmtKpiRowLike {
  return { kpi_name, value, kpi_label: null, unit: null, geometry_ref: null, ...extra };
}

describe("deriveCeqaVmtScreeningInputs — resident VMT preference", () => {
  it("prefers resident_vmt_per_capita over network vmt_per_capita on the same run", () => {
    // AequilibraE lane now emits both; §15064.3 wants the resident figure.
    const kpis = [
      kpi("daily_vmt", 260000),
      kpi("vmt_per_capita", 194.2), // network (through-traffic) figure
      kpi("resident_vmt_per_capita", 25.7), // resident figure
      kpi("population_total", 102000),
    ];
    const result = deriveCeqaVmtScreeningInputs(kpis);
    expect(result.status).toBe("per-capita");
    if (result.status === "per-capita") {
      expect(result.vmtKpiName).toBe("resident_vmt_per_capita");
      expect(result.vmtPerCapita).toBe(25.7);
    }
  });

  it("is order-independent (resident wins even when listed after network)", () => {
    const a = deriveCeqaVmtScreeningInputs([
      kpi("resident_vmt_per_capita", 25.7),
      kpi("vmt_per_capita", 194.2),
    ]);
    const b = deriveCeqaVmtScreeningInputs([
      kpi("vmt_per_capita", 194.2),
      kpi("resident_vmt_per_capita", 25.7),
    ]);
    expect(a).toEqual(b);
    expect(a.status === "per-capita" && a.vmtKpiName).toBe("resident_vmt_per_capita");
  });

  it("uses resident_vmt + population when no per-capita resident KPI is present", () => {
    const result = deriveCeqaVmtScreeningInputs([
      kpi("daily_vmt", 260000),
      kpi("resident_vmt", 2633000),
      kpi("population_total", 102000),
    ]);
    expect(result.status).toBe("total-with-population");
    if (result.status === "total-with-population") {
      expect(result.vmtKpiName).toBe("resident_vmt");
      expect(result.dailyVmt).toBe(2633000);
      expect(result.population).toBe(102000);
    }
  });

  it("falls back to network vmt_per_capita for legacy runs with no resident KPI", () => {
    const result = deriveCeqaVmtScreeningInputs([
      kpi("daily_vmt", 85884.8),
      kpi("vmt_per_capita", 0.84),
      kpi("population_total", 102000),
    ]);
    expect(result.status).toBe("per-capita");
    if (result.status === "per-capita") {
      expect(result.vmtKpiName).toBe("vmt_per_capita");
      expect(result.vmtPerCapita).toBe(0.84);
    }
  });

  it("ignores geometry-scoped resident VMT slices (not run-level)", () => {
    const result = deriveCeqaVmtScreeningInputs([
      kpi("resident_vmt_per_capita", 12.3, { geometry_ref: "corridor-1" }),
      kpi("vmt_per_capita", 30.0),
    ]);
    expect(result.status).toBe("per-capita");
    if (result.status === "per-capita") {
      expect(result.vmtKpiName).toBe("vmt_per_capita");
    }
  });
});
