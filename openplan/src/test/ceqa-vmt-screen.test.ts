import { describe, expect, it } from "vitest";
import {
  CEQA_POPULATION_KPI_NAMES,
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

  it("reports missing-population — not no-vmt-kpi — when a total VMT KPI has no population beside it", () => {
    // The two refusal states carry different remediation instructions on
    // screen: "missing-population" tells the planner which VMT KPI exists and
    // that a population KPI would complete it; "no-vmt-kpi" says there is no
    // VMT figure at all. Collapsing the first into the second passed every
    // CEQA test in the tree on 2026-08-04 (mutation audit), which meant a run
    // carrying resident_vmt could be described as having no VMT KPI — a false
    // statement about its own inputs, with the wrong fix instruction attached.
    const residentOnly = deriveCeqaVmtScreeningInputs([kpi("resident_vmt", 2633000)]);
    expect(residentOnly).toEqual({ status: "missing-population", vmtKpiName: "resident_vmt" });

    const genericOnly = deriveCeqaVmtScreeningInputs([kpi("daily_vmt", 260000)]);
    expect(genericOnly).toEqual({ status: "missing-population", vmtKpiName: "daily_vmt" });
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

/**
 * WHAT THE 2026-08-07 CEQA AUDIT FOUND, after the obvious mutations all died.
 *
 * 42 mutations across `planner-pack/ceqa.ts`, `models/ceqa-vmt-screen.ts` and
 * `models/caveat-gate.ts`. The first 26 — inverted determinations, a flipped
 * threshold, a skipped population check, an emptied statutory citation — were
 * killed 26 for 26, which is the strongest result any pass in this repository
 * has produced and the reason a second, subtler batch was run rather than
 * declaring the area solid. That batch found three.
 */
describe("the denominator of a CEQA per-capita figure is PEOPLE", () => {
  it("accepts no KPI name that is not a count of residents", () => {
    // MUTATION E4 SURVIVED: adding `jobs_total` to CEQA_POPULATION_KPI_NAMES
    // changed no test. The behavioral-onramp KPI set persists `population_total`
    // AND `jobs_total` side by side (see behavioral-onramp-kpis.ts), so the two
    // sit one line apart in the same payload — and dividing VMT by jobs produces
    // a per-capita figure for a population that does not exist, which then gets
    // compared to a residential threshold and printed under a §15064.3 heading.
    //
    // Pinned as an exact set: a ceiling on the COUNT would be cleared by
    // swapping one name for another.
    expect([...CEQA_POPULATION_KPI_NAMES].sort()).toEqual([
      "population",
      "population_total",
      "total_population",
    ]);
  });

  it("does not divide by a jobs count when no population KPI is present", () => {
    const result = deriveCeqaVmtScreeningInputs([
      kpi("resident_vmt", 2_400_000),
      kpi("jobs_total", 48_000),
    ]);

    // Missing, not substituted. `missing-population` is what stops the screen
    // and says why; a jobs denominator would have produced a confident 50.0.
    expect(result.status).toBe("missing-population");
  });
});

describe("a KPI value that is not a finite number is not a measurement", () => {
  it("refuses a value the database hands back as a string", () => {
    // MEASURED, not assumed: `model_run_kpis.value` is `double precision`, which
    // CAN store Infinity and NaN, and PostgREST serialises both as JSON STRINGS
    // — `{"value":"Infinity"}` — because JSON has no such numbers. Verified
    // against the local stack on 2026-08-07.
    //
    // So on the database path the guard that matters is the `typeof ===
    // "number"` check: a worker that divided by zero writes Infinity, and it
    // arrives here as text. `Number.isFinite` contributes nothing THERE — which
    // is why the test below exercises the in-process path instead, where it is
    // the only thing standing between a non-finite value and a determination.
    const asDatabaseReturnsIt = {
      kpi_name: "resident_vmt_per_capita",
      value: "Infinity" as unknown as number,
      geometry_ref: null,
    };

    expect(deriveCeqaVmtScreeningInputs([asDatabaseReturnsIt]).status).toBe("no-vmt-kpi");
    expect(
      deriveCeqaVmtScreeningInputs([{ ...asDatabaseReturnsIt, value: "NaN" as unknown as number }])
        .status
    ).toBe("no-vmt-kpi");
  });

  it("refuses a non-finite number if one ever reaches it in-process", () => {
    // The belt that has no database path today. It costs nothing and the
    // function is exported, so a future caller computing a value rather than
    // reading one cannot slip Infinity into a determination.
    for (const value of [Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(
        deriveCeqaVmtScreeningInputs([kpi("resident_vmt_per_capita", value)]).status,
        String(value)
      ).toBe("no-vmt-kpi");
    }
  });
});
