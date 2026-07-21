import { describe, expect, it } from "vitest";

import {
  buildIteTripGenerationKpiRows,
  computeTripGeneration,
  ITE_TRIP_GEN_KPI_NAMES,
  ITE_TRIP_GEN_SCREENING_CAVEAT,
  type TripGenProgramInput,
} from "@/lib/models/ite-trip-generation";
import {
  CEQA_DAILY_VMT_KPI_NAMES,
  CEQA_POPULATION_KPI_NAMES,
  CEQA_RESIDENT_DAILY_VMT_KPI_NAMES,
  CEQA_RESIDENT_VMT_PER_CAPITA_KPI_NAMES,
  CEQA_VMT_PER_CAPITA_KPI_NAMES,
} from "@/lib/models/ceqa-vmt-screen";

describe("computeTripGeneration — math", () => {
  it("computes daily/peak/VMT with the fixed gross→internal-capture→pass-by order", () => {
    const program: TripGenProgramInput = {
      avgTripLengthMiles: 7.5,
      comparisonBasis: "no_build_zero",
      lineItems: [
        { rateKey: "single_family_detached", quantity: 100 }, // 10/DU
        { rateKey: "retail_neighborhood", quantity: 50, internalCaptureShare: 0.1, passByShare: 0.3 }, // 120/ksf
      ],
    };
    const result = computeTripGeneration(program);

    const [homes, retail] = result.lineItems;
    // 100 × 10 = 1000 gross, no reduction → 1000 net
    expect(homes.netDailyTrips).toBe(1000);
    expect(homes.amPeakTrips).toBe(80); // 1000 × 0.08
    expect(homes.amInboundTrips).toBe(16); // 80 × 0.2
    expect(homes.amOutboundTrips).toBe(64);
    expect(homes.pmPeakTrips).toBe(100); // 1000 × 0.10
    expect(homes.pmInboundTrips).toBe(70); // 100 × 0.7
    expect(homes.dailyVmt).toBe(7500); // 1000 × 7.5

    // 50 × 120 = 6000 gross → ×0.9 (internal) ×0.7 (pass-by) = 3780 net
    expect(retail.grossDailyTrips).toBe(6000);
    expect(retail.netDailyTrips).toBe(3780);
    expect(retail.dailyVmt).toBe(28350); // 3780 × 7.5

    expect(result.totals.netDailyTrips).toBe(4780);
    expect(result.totals.amPeakTrips).toBe(231.2); // 80 + 151.2
    expect(result.totals.pmPeakTrips).toBe(515.8); // 100 + 415.8
    expect(result.totals.dailyVmt).toBe(35850);
    expect(result.caveat).toBe(ITE_TRIP_GEN_SCREENING_CAVEAT);
  });

  it("accepts an explicit custom rate (not just table keys)", () => {
    const result = computeTripGeneration({
      avgTripLengthMiles: 5,
      comparisonBasis: "existing_use_net_new",
      lineItems: [
        {
          rate: { key: "custom", landUse: "Custom use", unitBasis: "ksf", dailyTripsPerUnit: 4, amPeakShareOfDaily: 0.1, amInboundShare: 0.5, pmPeakShareOfDaily: 0.1, pmInboundShare: 0.5 },
          quantity: 25,
        },
      ],
    });
    expect(result.lineItems[0].netDailyTrips).toBe(100); // 4 × 25
    expect(result.totals.dailyVmt).toBe(500); // 100 × 5
  });

  it("returns an all-zero result for an empty (no-build) program without throwing", () => {
    const result = computeTripGeneration({ avgTripLengthMiles: 7.5, comparisonBasis: "no_build_zero", lineItems: [] });
    expect(result.totals).toEqual({ netDailyTrips: 0, amPeakTrips: 0, pmPeakTrips: 0, dailyVmt: 0 });
  });

  it("is deterministic — identical input yields byte-identical output", () => {
    const program: TripGenProgramInput = {
      avgTripLengthMiles: 6.2,
      comparisonBasis: "no_build_zero",
      lineItems: [{ rateKey: "office_government", quantity: 80 }, { rateKey: "warehousing", quantity: 200 }],
    };
    expect(JSON.stringify(computeTripGeneration(program))).toBe(JSON.stringify(computeTripGeneration(program)));
  });
});

describe("computeTripGeneration — validation (throws, never silently estimates)", () => {
  const base = { avgTripLengthMiles: 7.5, comparisonBasis: "no_build_zero" as const };

  it("throws on a negative quantity", () => {
    expect(() => computeTripGeneration({ ...base, lineItems: [{ rateKey: "single_family_detached", quantity: -1 }] })).toThrow();
  });
  it("throws on a non-positive average trip length", () => {
    expect(() => computeTripGeneration({ avgTripLengthMiles: 0, comparisonBasis: "no_build_zero", lineItems: [] })).toThrow();
  });
  it("throws on an out-of-range reduction share", () => {
    expect(() => computeTripGeneration({ ...base, lineItems: [{ rateKey: "supermarket", quantity: 10, passByShare: 1.5 }] })).toThrow();
  });
  it("throws on an unknown rate key", () => {
    expect(() => computeTripGeneration({ ...base, lineItems: [{ rateKey: "not_a_real_use", quantity: 10 }] })).toThrow();
  });

  it("throws on a custom rate with a negative daily rate (custom rates are validated too)", () => {
    const badRate = { key: "x", landUse: "Bad", unitBasis: "ksf" as const, dailyTripsPerUnit: -10, amPeakShareOfDaily: 0.1, amInboundShare: 0.5, pmPeakShareOfDaily: 0.1, pmInboundShare: 0.5 };
    expect(() => computeTripGeneration({ ...base, lineItems: [{ rate: badRate, quantity: 10 }] })).toThrow();
  });

  it("throws on a custom rate with an out-of-range share", () => {
    const badRate = { key: "x", landUse: "Bad", unitBasis: "ksf" as const, dailyTripsPerUnit: 10, amPeakShareOfDaily: 5, amInboundShare: 0.5, pmPeakShareOfDaily: 0.1, pmInboundShare: 0.5 };
    expect(() => computeTripGeneration({ ...base, lineItems: [{ rate: badRate, quantity: 10 }] })).toThrow();
  });
});

describe("buildIteTripGenerationKpiRows", () => {
  const RUN_ID = "99999999-9999-4999-8999-999999999999";

  it("maps totals onto the five namespaced KPI rows with provenance + caveat", () => {
    const result = computeTripGeneration({
      lineItems: [{ rateKey: "single_family_detached", quantity: 100 }],
      avgTripLengthMiles: 5,
      comparisonBasis: "no_build_zero",
    });
    const rows = buildIteTripGenerationKpiRows(RUN_ID, result);

    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((row) => row.kpi_name))).toEqual(new Set(ITE_TRIP_GEN_KPI_NAMES));
    for (const row of rows) {
      expect(row.run_id).toBe(RUN_ID);
      expect(row.kpi_category).toBe("ite_trip_generation");
      expect(String(row.breakdown_json.provenance)).toContain("average-rate method");
      expect(row.breakdown_json.caveat).toBe(ITE_TRIP_GEN_SCREENING_CAVEAT);
    }

    expect(rows.find((row) => row.kpi_name === "project_daily_trip_ends")?.value).toBe(1000);
    expect(rows.find((row) => row.kpi_name === "project_daily_vmt_screen")?.value).toBe(5000);
    expect(rows.find((row) => row.kpi_name === "project_program_units")?.value).toBe(100);
    // The worksheet UI reads the line-item table off the headline row.
    const headline = rows.find((row) => row.kpi_name === "project_daily_trip_ends");
    expect(Array.isArray(headline?.breakdown_json.lineItems)).toBe(true);
  });
});

describe("claim-boundary firewall — trip-gen KPI names never collide with CEQA", () => {
  it("keeps ITE_TRIP_GEN_KPI_NAMES disjoint from every CEQA KPI-name set", () => {
    const ceqaNames = new Set<string>([
      ...CEQA_RESIDENT_VMT_PER_CAPITA_KPI_NAMES,
      ...CEQA_RESIDENT_DAILY_VMT_KPI_NAMES,
      ...CEQA_VMT_PER_CAPITA_KPI_NAMES,
      ...CEQA_DAILY_VMT_KPI_NAMES,
      ...CEQA_POPULATION_KPI_NAMES,
    ]);
    const collisions = [...ITE_TRIP_GEN_KPI_NAMES].filter((name) => ceqaNames.has(name));
    expect(collisions).toEqual([]); // a rate-based screen can never feed the CEQA §15064.3 determination
  });
});
