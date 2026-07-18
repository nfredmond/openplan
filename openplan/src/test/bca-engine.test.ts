import { describe, expect, it } from "vitest";

import {
  computeBenefitCostAnalysis,
  computeDiscountedPaybackYears,
  computeIrrPct,
  computeNpvFromCashFlows,
  presentValue,
  runBcaSensitivity,
} from "@/lib/bca/engine";
import {
  BCA_ENGINE_VERSION,
  BCA_PARAMETER_SOURCE_NOTES,
  DEFAULT_ANALYSIS_HORIZON_YEARS,
  DEFAULT_BCA_PARAMETERS,
  DEFAULT_CO2_DISCOUNT_RATE_PCT,
  DEFAULT_DISCOUNT_RATE_PCT,
  LEGACY_DISCOUNT_RATE_PCT,
} from "@/lib/bca/parameters";
import { InsufficientDataError, type BcaAnalysisInputs, type BcaYearValue } from "@/lib/bca/types";

// Clean re-implementation informed by DOT-Dashboard's
// src/lib/benefit-cost-service.ts (reference only — NOT a line-port; no
// byte-parity claim). Harvest bugs deliberately fixed and regression-tested
// below:
//   - fake sensitivity: performSensitivityAnalysis never recomputed, so every
//     parameter reported identical impact -> runBcaSensitivity recomputes;
//   - IRR/payback declared on the result type but never computed (TODO at
//     harvest line 1083) -> both computed here;
//   - sparse-year IRR: gap years left undefined holes -> NaN -> always null;
//     computeIrrPct zero-fills the year range;
//   - payback returned null for immediately-profitable projects (previousNet
//     started at 0) and used UNDISCOUNTED flows -> discounted, 0 on immediate;
//   - Monte Carlo triangular read `param.most` while the type declared `mode`
//     (covered in bca-monte-carlo.test.ts), and used unseeded Math.random;
//   - calculateBCR returned 0 when costs === 0 -> null here;
//   - calculateBenefitCostAnalysis mutated its input -> pure engine, frozen
//     inputs pass untouched.

const GENERATED_AT = "2026-07-17T00:00:00Z";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe("presentValue / computeNpvFromCashFlows", () => {
  it("discounts a single value", () => {
    // 110 / 1.1^1 = 100; zero rate is the identity; 121 / 1.1^2 = 100.
    expect(presentValue(110, 10, 1)).toBeCloseTo(100, 10);
    expect(presentValue(100, 0, 5)).toBe(100);
    expect(presentValue(121, 10, 2)).toBeCloseTo(100, 10);
  });

  it("sums discounted flows relative to the base year", () => {
    const flows = [
      { year: 2026, value: -1000 },
      { year: 2027, value: 500 },
      { year: 2028, value: 500 },
      { year: 2029, value: 500 },
    ];
    // At 0%: -1000 + 500*3 = 500 (flow at base year is undiscounted).
    expect(computeNpvFromCashFlows(flows, 0, 2026)).toBeCloseTo(500, 10);
    // At 10%: -1000 + 500/1.1 + 500/1.21 + 500/1.331
    //       = -1000 + 454.545454... + 413.223140... + 375.657400...
    //       = 243.425995...
    expect(computeNpvFromCashFlows(flows, 10, 2026)).toBeCloseTo(
      -1000 + 500 / 1.1 + 500 / 1.21 + 500 / 1.331,
      8
    );
  });
});

describe("computeBenefitCostAnalysis — NPV and BCR goldens", () => {
  it("matches the flat-benefit NPV golden (spec contract)", () => {
    // Single benefit of 100,000/yr for 3 years at 10% from base year 2026.
    // End-of-year convention: PV = 100000/1.1 + 100000/1.21 + 100000/1.331
    //   = 90909.0909... + 82644.6280... + 75131.4800... = 248685.1990...
    const result = computeBenefitCostAnalysis(
      {
        baseYear: 2026,
        analysisHorizonYears: 3,
        discountRatePct: 10,
        benefits: [{ kind: "other", label: "Flat benefit", annualValue: 100_000 }],
        costs: [],
      },
      undefined,
      { generatedAt: GENERATED_AT }
    );

    const expectedPv = 100_000 / 1.1 + 100_000 / 1.21 + 100_000 / 1.331;
    expect(result.presentValueBenefits).toBeCloseTo(expectedPv, 6);
    expect(result.netPresentValue).toBeCloseTo(expectedPv, 6);
    expect(result.presentValueCosts).toBe(0);

    // Dense net cash flow: one entry per horizon year, years baseYear+1..+H.
    expect(result.annualNetCashFlow).toHaveLength(3);
    expect(result.annualNetCashFlow.map((entry) => entry.year)).toEqual([2027, 2028, 2029]);
    expect(result.annualNetCashFlow.every((entry) => entry.value === 100_000)).toBe(true);

    // Convention self-consistency: discounting the dense net stream with the
    // generic NPV primitive reproduces the engine's netPresentValue.
    expect(
      computeNpvFromCashFlows(
        result.annualNetCashFlow.map(({ year, value }) => ({ year, value })),
        10,
        2026
      )
    ).toBeCloseTo(result.netPresentValue, 8);
  });

  it("returns null BCR when PV costs are zero (regression: harvest returned 0)", () => {
    const zeroCost = computeBenefitCostAnalysis(
      {
        baseYear: 2026,
        analysisHorizonYears: 2,
        discountRatePct: 10,
        benefits: [{ kind: "other", label: "B", annualValue: 1000 }],
        costs: [{ kind: "capital", totalAmount: 0 }],
      },
      undefined,
      { generatedAt: GENERATED_AT }
    );
    expect(zeroCost.benefitCostRatio).toBeNull();
    expect(zeroCost.benefitCostRatio).not.toBe(0);
  });

  it("matches the BCR golden with year-0 capital plus a flat benefit", () => {
    // Capital 1,000,000 at offset 0 (first analysis year), benefit 300,000/yr
    // over a 5-year horizon at 10%:
    //   PV benefits = 300000 * (1/1.1 + 1/1.1^2 + 1/1.1^3 + 1/1.1^4 + 1/1.1^5)
    //               = 300000 * 3.7907867694... = 1,137,236.03...
    //   PV costs    = 1000000 / 1.1 = 909,090.909...
    //   BCR         = 1,137,236.03 / 909,090.91 = 1.25095963...
    //   NPV         = 228,145.12...
    const result = computeBenefitCostAnalysis(
      {
        baseYear: 2026,
        analysisHorizonYears: 5,
        discountRatePct: 10,
        benefits: [{ kind: "other", label: "Benefit", annualValue: 300_000 }],
        costs: [{ kind: "capital", totalAmount: 1_000_000 }],
      },
      undefined,
      { generatedAt: GENERATED_AT }
    );

    const pvBenefits =
      300_000 / 1.1 + 300_000 / 1.1 ** 2 + 300_000 / 1.1 ** 3 + 300_000 / 1.1 ** 4 + 300_000 / 1.1 ** 5;
    const pvCosts = 1_000_000 / 1.1;
    expect(result.presentValueBenefits).toBeCloseTo(pvBenefits, 6);
    expect(result.presentValueCosts).toBeCloseTo(pvCosts, 6);
    expect(result.benefitCostRatio).toBeCloseTo(pvBenefits / pvCosts, 8);
    expect(result.netPresentValue).toBeCloseTo(pvBenefits - pvCosts, 6);
  });

  it("computes IRR and discounted payback on the BCR-golden fixture", () => {
    const result = computeBenefitCostAnalysis(
      {
        baseYear: 2026,
        analysisHorizonYears: 5,
        discountRatePct: 10,
        benefits: [{ kind: "other", label: "Benefit", annualValue: 300_000 }],
        costs: [{ kind: "capital", totalAmount: 1_000_000 }],
      },
      undefined,
      { generatedAt: GENERATED_AT }
    );

    // Undiscounted net flows: (-700000, 300000, 300000, 300000, 300000).
    // IRR solves 700000 = 300000 * a4(r)  =>  a4(r) = 7/3 = 2.333333...;
    // a4(25.68%) = 2.33331 => r ~= 25.679% (hand-iterated).
    expect(result.internalRateOfReturnPct).not.toBeNull();
    expect(result.internalRateOfReturnPct as number).toBeCloseTo(25.68, 2);
    // Verify by recomputation: NPV of the undiscounted stream at the returned
    // rate must be ~0.
    const residual = computeNpvFromCashFlows(
      result.annualNetCashFlow.map(({ year, value }) => ({ year, value })),
      result.internalRateOfReturnPct as number,
      2027
    );
    expect(Math.abs(residual)).toBeLessThan(1e-3);

    // Discounted payback. Discounted net flows (end-of-year: the k-th
    // analysis year's flow lands at t = k):
    //   t1: (300000-1000000)/1.1   = -636363.6364
    //   t2: 300000/1.1^2           =  247933.8843  (cum -388429.7521)
    //   t3: 300000/1.1^3           =  225394.4403  (cum -163035.3118)
    //   t4: 300000/1.1^4           =  204904.0434  (cum  +41868.7316) <- crossing
    // Crossing during the 4th year:
    // payback = 3 + 163035.3118 / 204904.0434 = 3.795664...
    const net1 = (300_000 - 1_000_000) / 1.1;
    const net2 = 300_000 / 1.1 ** 2;
    const net3 = 300_000 / 1.1 ** 3;
    const net4 = 300_000 / 1.1 ** 4;
    const cumulative3 = net1 + net2 + net3; // still negative
    const expectedPayback = 3 + (0 - cumulative3) / net4;
    expect(result.paybackYearsDiscounted).toBeCloseTo(expectedPayback, 6);
  });
});

describe("computeBenefitCostAnalysis — category math goldens", () => {
  it("monetizes travel time hours by class with compound growth", () => {
    // Base annual = 1000*18.80 + 100*32.60 + 10*38.50
    //             = 18800 + 3260 + 385 = 22445.
    // 2% growth: year values 22445, 22893.90, 23351.778 (undiscounted total
    // 68690.678); PV at 10% = 22445/1.1 + 22893.9/1.21 + 23351.778/1.331.
    const result = computeBenefitCostAnalysis(
      {
        baseYear: 2026,
        analysisHorizonYears: 3,
        discountRatePct: 10,
        benefits: [
          {
            kind: "travelTime",
            annualHoursSaved: { commuter: 1000, commercial: 100, freight: 10 },
            annualGrowthRatePct: 2,
          },
        ],
        costs: [],
      },
      undefined,
      { generatedAt: GENERATED_AT }
    );

    const item = result.benefitItems[0];
    expect(item.kind).toBe("travelTime");
    expect(item.annualValues[0].value).toBeCloseTo(22_445, 8);
    expect(item.annualValues[1].value).toBeCloseTo(22_445 * 1.02, 8);
    expect(item.annualValues[2].value).toBeCloseTo(22_445 * 1.02 ** 2, 8);
    expect(item.undiscountedTotal).toBeCloseTo(22_445 + 22_445 * 1.02 + 22_445 * 1.02 ** 2, 6);
    expect(item.presentValue).toBeCloseTo(
      22_445 / 1.1 + (22_445 * 1.02) / 1.1 ** 2 + (22_445 * 1.02 ** 2) / 1.1 ** 3,
      6
    );
  });

  it("monetizes crash counts by severity", () => {
    // Annual = 0.01*13,200,000 + 2*210,000 + 30*4,600
    //        = 132,000 + 420,000 + 138,000 = 690,000 (flat).
    // PV over 2 years at 10% = 690000/1.1 + 690000/1.21.
    const result = computeBenefitCostAnalysis(
      {
        baseYear: 2026,
        analysisHorizonYears: 2,
        discountRatePct: 10,
        benefits: [
          {
            kind: "safety",
            annualCrashesAvoided: { fatal: 0.01, injury: 2, propertyDamageOnly: 30 },
          },
        ],
        costs: [],
      },
      undefined,
      { generatedAt: GENERATED_AT }
    );

    const item = result.benefitItems[0];
    expect(item.annualValues[0].value).toBeCloseTo(690_000, 6);
    expect(item.presentValue).toBeCloseTo(690_000 / 1.1 + 690_000 / 1.1 ** 2, 6);
  });

  it("discounts the emissions stream at the CO2 rate while other streams use the standard rate", () => {
    // Emissions: 100 t/yr * $51 = 5100/yr, discounted at the DEFAULT 3% CO2
    // rate (the rate the IWG-interim $51 SC-CO2 was derived at):
    // PV = 5100/1.03 + 5100/1.03^2 = 4951.4563 + 4807.2392 = 9758.6955.
    // The "other" stream (same 5100/yr magnitude) discounts at 3.1%:
    // PV = 5100/1.031 + 5100/1.031^2 = 4946.6537 + 4797.9183 = 9744.5720.
    const result = computeBenefitCostAnalysis(
      {
        baseYear: 2026,
        analysisHorizonYears: 2,
        discountRatePct: 3.1,
        benefits: [
          { kind: "emissions", annualMetricTonsCo2eReduced: 100 },
          { kind: "other", label: "Comparison stream", annualValue: 5_100 },
        ],
        costs: [],
      },
      undefined,
      { generatedAt: GENERATED_AT }
    );

    expect(result.co2DiscountRatePct).toBe(DEFAULT_CO2_DISCOUNT_RATE_PCT);
    const emissions = result.benefitItems[0];
    const other = result.benefitItems[1];
    expect(emissions.presentValue).toBeCloseTo(5_100 / 1.03 + 5_100 / 1.03 ** 2, 6);
    expect(other.presentValue).toBeCloseTo(5_100 / 1.031 + 5_100 / 1.031 ** 2, 6);
    // Same undiscounted stream, different rates -> different PVs. 3% vs 3.1%
    // over two years is a 9758.6955 - 9744.5720 = 14.1235 gap.
    expect(emissions.undiscountedTotal).toBeCloseTo(other.undiscountedTotal, 8);
    expect(Math.abs(emissions.presentValue - other.presentValue)).toBeGreaterThan(10);
  });

  it("monetizes vehicle-operating VMT at $/mile", () => {
    // 100,000 VMT * $0.43/mi = 43,000/yr; PV over 1 year at 10% = 43000/1.1.
    const result = computeBenefitCostAnalysis(
      {
        baseYear: 2026,
        analysisHorizonYears: 1,
        discountRatePct: 10,
        benefits: [{ kind: "vehicleOperating", annualVmtReduced: 100_000 }],
        costs: [],
      },
      undefined,
      { generatedAt: GENERATED_AT }
    );
    expect(result.benefitItems[0].presentValue).toBeCloseTo((100_000 * 0.43) / 1.1, 6);
  });

  it("derives emissions tons from VMT when tons are absent", () => {
    // tons = 1,000,000 VMT * 0.78 lbs/mi / 2204.62262 lbs/t = 353.80205 t;
    // annual value = 353.80205 * $51 = 18,043.90; CO2 rate 0 => PV = value.
    const result = computeBenefitCostAnalysis(
      {
        baseYear: 2026,
        analysisHorizonYears: 1,
        discountRatePct: 10,
        co2DiscountRatePct: 0,
        benefits: [{ kind: "emissions", annualVmtReduced: 1_000_000 }],
        costs: [],
      },
      undefined,
      { generatedAt: GENERATED_AT }
    );
    expect(result.benefitItems[0].presentValue).toBeCloseTo(
      ((1_000_000 * 0.78) / 2204.62262) * 51,
      8
    );
  });

  it("prefers measured tons over VMT when both are given", () => {
    // tons=100 wins over the VMT-derived 353.8 t: annual = 100 * 51 = 5100.
    const result = computeBenefitCostAnalysis(
      {
        baseYear: 2026,
        analysisHorizonYears: 1,
        discountRatePct: 10,
        co2DiscountRatePct: 0,
        benefits: [
          { kind: "emissions", annualMetricTonsCo2eReduced: 100, annualVmtReduced: 1_000_000 },
        ],
        costs: [],
      },
      undefined,
      { generatedAt: GENERATED_AT }
    );
    expect(result.benefitItems[0].presentValue).toBeCloseTo(100 * 51, 8);
  });
});

describe("computeBenefitCostAnalysis — cost streams", () => {
  it("spreads capital evenly and clips slices past the horizon", () => {
    // 900,000 over 3 years (300,000/yr) starting at offset 1 with a 3-year
    // horizon: offsets 1 and 2 land in-horizon, the offset-3 slice is
    // clipped. Undiscounted total = 600,000 (not 900,000).
    // PV at 10% = 300000/1.1^2 + 300000/1.1^3 = 247933.88 + 225394.44.
    const result = computeBenefitCostAnalysis(
      {
        baseYear: 2026,
        analysisHorizonYears: 3,
        discountRatePct: 10,
        benefits: [],
        costs: [{ kind: "capital", totalAmount: 900_000, spreadYears: 3, startYearOffset: 1 }],
      },
      undefined,
      { generatedAt: GENERATED_AT }
    );

    const item = result.costItems[0];
    expect(item.annualValues.map((entry) => entry.value)).toEqual([0, 300_000, 300_000]);
    expect(item.undiscountedTotal).toBe(600_000);
    expect(item.presentValue).toBeCloseTo(300_000 / 1.1 ** 2 + 300_000 / 1.1 ** 3, 6);
  });

  it("compounds O&M escalation from the first active year", () => {
    // 10,000/yr at 5% escalation over 3 years: 10000, 10500, 11025.
    // PV at 10% = 10000/1.1 + 10500/1.1^2 + 11025/1.1^3.
    const result = computeBenefitCostAnalysis(
      {
        baseYear: 2026,
        analysisHorizonYears: 3,
        discountRatePct: 10,
        benefits: [],
        costs: [{ kind: "operationsMaintenance", annualAmount: 10_000, escalationRatePct: 5 }],
      },
      undefined,
      { generatedAt: GENERATED_AT }
    );

    const item = result.costItems[0];
    expect(item.annualValues[0].value).toBeCloseTo(10_000, 8);
    expect(item.annualValues[1].value).toBeCloseTo(10_000 * 1.05, 8);
    expect(item.annualValues[2].value).toBeCloseTo(10_000 * 1.05 ** 2, 8);
    expect(item.presentValue).toBeCloseTo(
      10_000 / 1.1 + (10_000 * 1.05) / 1.1 ** 2 + (10_000 * 1.05 ** 2) / 1.1 ** 3,
      6
    );
  });

  it("honors an O&M startYearOffset with escalation from its own start", () => {
    // Offset 1, 10% escalation: values [0, 1000, 1100] — the first active
    // year is unescalated regardless of where it starts.
    const result = computeBenefitCostAnalysis(
      {
        baseYear: 2026,
        analysisHorizonYears: 3,
        discountRatePct: 0,
        benefits: [],
        costs: [
          {
            kind: "other",
            label: "Program staffing",
            annualAmount: 1_000,
            escalationRatePct: 10,
            startYearOffset: 1,
          },
        ],
      },
      undefined,
      { generatedAt: GENERATED_AT }
    );

    const item = result.costItems[0];
    expect(item.annualValues[0].value).toBe(0);
    expect(item.annualValues[1].value).toBeCloseTo(1_000, 8);
    expect(item.annualValues[2].value).toBeCloseTo(1_100, 8);
  });
});

describe("growth/escalation rate bounds", () => {
  it("rejects growth rates below -100% (sign-flipping stream) with a plain Error", () => {
    expect(() =>
      computeBenefitCostAnalysis(
        {
          baseYear: 2026,
          analysisHorizonYears: 3,
          discountRatePct: 0,
          benefits: [{ kind: "other", label: "B", annualValue: 1_000, annualGrowthRatePct: -110 }],
          costs: [],
        },
        undefined,
        { generatedAt: GENERATED_AT }
      )
    ).toThrow(/growth\/escalation rate must be >= -100/);
    expect(() =>
      computeBenefitCostAnalysis(
        {
          baseYear: 2026,
          analysisHorizonYears: 3,
          discountRatePct: 0,
          benefits: [],
          costs: [
            {
              kind: "operationsMaintenance",
              annualAmount: 1_000,
              escalationRatePct: -110,
            },
          ],
        },
        undefined,
        { generatedAt: GENERATED_AT }
      )
    ).toThrow(/growth\/escalation rate must be >= -100/);
  });

  it("accepts exactly -100%: the stream is [A, 0, 0]", () => {
    const result = computeBenefitCostAnalysis(
      {
        baseYear: 2026,
        analysisHorizonYears: 3,
        discountRatePct: 0,
        benefits: [{ kind: "other", label: "B", annualValue: 1_000, annualGrowthRatePct: -100 }],
        costs: [],
      },
      undefined,
      { generatedAt: GENERATED_AT }
    );
    expect(result.benefitItems[0].annualValues.map((entry) => entry.value)).toEqual([1_000, 0, 0]);
  });
});

describe("computeIrrPct", () => {
  it("solves the classic textbook case (-1000, +500 x3) ~ 23.375%", () => {
    // -1000 + 500/(1+r) + 500/(1+r)^2 + 500/(1+r)^3 = 0 => r ~= 0.233753
    // (hand-check at 23.375%: 405.268 + 328.485 + 266.251 = 1000.004 ~ 1000).
    const irr = computeIrrPct([
      { year: 2026, value: -1000 },
      { year: 2027, value: 500 },
      { year: 2028, value: 500 },
      { year: 2029, value: 500 },
    ]);
    expect(irr).not.toBeNull();
    expect(irr as number).toBeCloseTo(23.375, 2);
    // Verify by recomputation.
    const rate = (irr as number) / 100;
    const residual = -1000 + 500 / (1 + rate) + 500 / (1 + rate) ** 2 + 500 / (1 + rate) ** 3;
    expect(Math.abs(residual)).toBeLessThan(1e-4);
  });

  it("returns a finite IRR for gap years (regression: harvest NaN'd on sparse years)", () => {
    // Flows only in 2026 and 2029: -1000, +1500 three years later.
    // (1+r)^3 = 1.5 => r = cbrt(1.5) - 1 = 14.4714...%.
    const irr = computeIrrPct([
      { year: 2026, value: -1000 },
      { year: 2029, value: 1500 },
    ]);
    expect(irr).not.toBeNull();
    expect(irr as number).toBeCloseTo((Math.cbrt(1.5) - 1) * 100, 6);
  });

  it("returns null when flows are not mixed-sign", () => {
    expect(
      computeIrrPct([
        { year: 2026, value: 100 },
        { year: 2027, value: 100 },
      ])
    ).toBeNull();
    expect(
      computeIrrPct([
        { year: 2026, value: -100 },
        { year: 2027, value: -100 },
      ])
    ).toBeNull();
    expect(computeIrrPct([])).toBeNull();
  });

  it("falls back to bisection when Newton's derivative vanishes at the start", () => {
    // Constructed so dNPV/dr = 0 at the 10% Newton starting point:
    // flows (-1000, 2479.3389, 0, -1000) give
    //   dNPV(0.1) = -2479.3389/1.21 + 3000/1.4641 ~ -3.35e-5,
    // so the first Newton step jumps ~1.7e7 and never converges. The flows
    // still change sign twice, with real IRRs near -23.66% and +129.4%;
    // the fixed left-to-right bisection grid brackets the lower root.
    const irr = computeIrrPct([
      { year: 2026, value: -1000 },
      { year: 2027, value: 2479.3389 },
      { year: 2029, value: -1000 },
    ]);
    expect(irr).not.toBeNull();
    expect(Number.isFinite(irr as number)).toBe(true);
    expect(irr as number).toBeCloseTo(-23.66, 1);
    // Verify by recomputation at the returned rate.
    const rate = (irr as number) / 100;
    const residual = -1000 + 2479.3389 / (1 + rate) - 1000 / (1 + rate) ** 3;
    expect(Math.abs(residual)).toBeLessThan(1e-3);
  });
});

describe("computeDiscountedPaybackYears", () => {
  const yearValue = (year: number, pv: number): BcaYearValue => ({
    year,
    value: pv,
    presentValue: pv,
  });

  it("returns 0 for an immediately-positive project (regression: harvest returned null)", () => {
    expect(
      computeDiscountedPaybackYears([yearValue(2027, 450), yearValue(2028, 400)])
    ).toBe(0);
  });

  it("interpolates within the crossing year", () => {
    // Cumulative discounted: -1000, -600, -200, +200; crossing during the
    // 4th year (index 3): payback = 3 + 200/400 = 3.5 years.
    expect(
      computeDiscountedPaybackYears([
        yearValue(2027, -1000),
        yearValue(2028, 400),
        yearValue(2029, 400),
        yearValue(2030, 400),
      ])
    ).toBeCloseTo(3.5, 10);
  });

  it("returns null when the cumulative never recovers within the horizon", () => {
    expect(
      computeDiscountedPaybackYears([
        yearValue(2027, -1000),
        yearValue(2028, 100),
        yearValue(2029, 100),
      ])
    ).toBeNull();
    expect(computeDiscountedPaybackYears([])).toBeNull();
  });
});

describe("computeBenefitCostAnalysis — validation and error tiers", () => {
  const validBenefit = { kind: "other", label: "B", annualValue: 1000 } as const;

  it("throws InsufficientDataError when benefits AND costs are both empty", () => {
    expect(() =>
      computeBenefitCostAnalysis({
        baseYear: 2026,
        analysisHorizonYears: 10,
        discountRatePct: 3.1,
        benefits: [],
        costs: [],
      })
    ).toThrow(InsufficientDataError);
  });

  it("throws a plain Error (not InsufficientDataError) on horizon 0", () => {
    let thrown: unknown;
    try {
      computeBenefitCostAnalysis({
        baseYear: 2026,
        analysisHorizonYears: 0,
        discountRatePct: 3.1,
        benefits: [validBenefit],
        costs: [],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(InsufficientDataError);
    expect(String(thrown)).toMatch(/analysisHorizonYears/);
  });

  it("throws a plain Error on a negative discount rate", () => {
    expect(() =>
      computeBenefitCostAnalysis({
        baseYear: 2026,
        analysisHorizonYears: 10,
        discountRatePct: -1,
        benefits: [validBenefit],
        costs: [],
      })
    ).toThrow(/discountRatePct must be >= 0/);
    expect(() =>
      computeBenefitCostAnalysis({
        baseYear: 2026,
        analysisHorizonYears: 10,
        discountRatePct: 3.1,
        co2DiscountRatePct: -2,
        benefits: [validBenefit],
        costs: [],
      })
    ).toThrow(/co2DiscountRatePct must be >= 0/);
  });

  it("throws InsufficientDataError for an emissions benefit with neither tons nor VMT", () => {
    expect(() =>
      computeBenefitCostAnalysis({
        baseYear: 2026,
        analysisHorizonYears: 10,
        discountRatePct: 3.1,
        benefits: [{ kind: "emissions" }],
        costs: [],
      })
    ).toThrow(InsufficientDataError);
  });

  it("never mutates deep-frozen inputs (regression: harvest mutated in place)", () => {
    const inputs: BcaAnalysisInputs = deepFreeze({
      baseYear: 2026,
      analysisHorizonYears: 5,
      discountRatePct: 10,
      benefits: [
        { kind: "travelTime", annualHoursSaved: { commuter: 1000 }, annualGrowthRatePct: 1 },
        { kind: "safety", annualCrashesAvoided: { injury: 2 } },
      ],
      costs: [{ kind: "capital", totalAmount: 500_000, spreadYears: 2 }],
    });
    const parameters = deepFreeze({ valueOfTimeCommuterPerHour: 20 });

    // Strict-mode writes to frozen objects throw TypeError, so success here
    // proves purity.
    const result = computeBenefitCostAnalysis(inputs, parameters, { generatedAt: GENERATED_AT });
    expect(result.netPresentValue).toBeTypeOf("number");
    const sensitivity = runBcaSensitivity(
      inputs,
      parameters,
      [{ key: "valueOfTimeCommuterPerHour" }],
      { generatedAt: GENERATED_AT }
    );
    expect(sensitivity.entries).toHaveLength(1);
  });

  it("honors the generatedAt override deterministically", () => {
    const inputs: BcaAnalysisInputs = {
      baseYear: 2026,
      analysisHorizonYears: 3,
      discountRatePct: 10,
      benefits: [validBenefit],
      costs: [{ kind: "capital", totalAmount: 2_000 }],
    };
    const first = computeBenefitCostAnalysis(inputs, undefined, { generatedAt: GENERATED_AT });
    const second = computeBenefitCostAnalysis(inputs, undefined, { generatedAt: GENERATED_AT });
    expect(first.generatedAt).toBe(GENERATED_AT);
    expect(first).toEqual(second);
  });
});

describe("runBcaSensitivity", () => {
  it("really recomputes: different targets produce different swings (regression vs fake harvest version)", () => {
    // Asymmetric fixture: travel time is one of two benefit streams, so a
    // +/-20% VOT change moves only that stream, while a +/-20% discount-rate
    // change moves every stream and the capital cost. The harvest version
    // scaled the base BCR by the same factors for every parameter, so all
    // targets reported identical impact.
    const inputs: BcaAnalysisInputs = {
      baseYear: 2026,
      analysisHorizonYears: 10,
      discountRatePct: 10,
      benefits: [
        { kind: "travelTime", annualHoursSaved: { commuter: 10_000 } },
        { kind: "other", label: "Reliability", annualValue: 100_000 },
      ],
      costs: [{ kind: "capital", totalAmount: 1_500_000 }],
    };
    const result = runBcaSensitivity(
      inputs,
      undefined,
      [{ key: "discountRatePct" }, { key: "valueOfTimeCommuterPerHour" }],
      { generatedAt: GENERATED_AT }
    );

    const votEntry = result.entries.find((entry) => entry.key === "valueOfTimeCommuterPerHour");
    const rateEntry = result.entries.find((entry) => entry.key === "discountRatePct");
    expect(votEntry).toBeDefined();
    expect(rateEntry).toBeDefined();

    // VOT swing = 0.4 * PV(travel time) = 0.4 * 10000*18.8 * annuity(10%, 10y).
    const annuity10 = Array.from({ length: 10 }, (_, k) => 1 / 1.1 ** (k + 1)).reduce(
      (sum, value) => sum + value,
      0
    );
    const pvTravelTime = 10_000 * 18.8 * annuity10; // ~= 188000 * 6.144567 = 1,155,178.6
    expect(votEntry!.npvSwing).toBeCloseTo(0.4 * pvTravelTime, 4);

    // A higher discount rate lowers NPV, so the rate swing is negative and
    // must differ from the VOT swing.
    expect(rateEntry!.npvSwing).toBeLessThan(0);
    expect(Math.abs(votEntry!.npvSwing - rateEntry!.npvSwing)).toBeGreaterThan(1);

    // Sorted by |npvSwing| descending; base point shared and real.
    expect(Math.abs(result.entries[0].npvSwing)).toBeGreaterThanOrEqual(
      Math.abs(result.entries[1].npvSwing)
    );
    const base = computeBenefitCostAnalysis(inputs, undefined, { generatedAt: GENERATED_AT });
    expect(votEntry!.base.npv).toBeCloseTo(base.netPresentValue, 8);
    expect(votEntry!.base.bcr).toBeCloseTo(base.benefitCostRatio as number, 8);
  });

  it("applies custom low/high factors", () => {
    const inputs: BcaAnalysisInputs = {
      baseYear: 2026,
      analysisHorizonYears: 5,
      discountRatePct: 10,
      benefits: [{ kind: "vehicleOperating", annualVmtReduced: 1_000_000 }],
      costs: [{ kind: "capital", totalAmount: 1_000_000 }],
    };
    const result = runBcaSensitivity(
      inputs,
      undefined,
      [{ key: "vehicleOperatingCostPerMile", lowFactor: 0.5, highFactor: 1.5 }],
      { generatedAt: GENERATED_AT }
    );
    const entry = result.entries[0];
    // Benefits are linear in the parameter: swing = (1.5 - 0.5) * PV benefits.
    const base = computeBenefitCostAnalysis(inputs, undefined, { generatedAt: GENERATED_AT });
    expect(entry.npvSwing).toBeCloseTo(base.presentValueBenefits, 4);
    expect(entry.low.npv).toBeLessThan(entry.high.npv);
  });
});

describe("parameter constants", () => {
  it("pins the documented screening defaults", () => {
    expect(DEFAULT_BCA_PARAMETERS).toEqual({
      valueOfTimeCommuterPerHour: 18.8,
      valueOfTimeCommercialPerHour: 32.6,
      valueOfTimeFreightPerHour: 38.5,
      crashCostFatal: 13_200_000,
      crashCostInjury: 210_000,
      crashCostPropertyDamageOnly: 4_600,
      co2CostPerMetricTon: 51,
      vehicleOperatingCostPerMile: 0.43,
      co2eLbsPerVehicleMile: 0.78,
    });
    expect(DEFAULT_DISCOUNT_RATE_PCT).toBe(3.1);
    expect(LEGACY_DISCOUNT_RATE_PCT).toBe(7);
    expect(DEFAULT_CO2_DISCOUNT_RATE_PCT).toBe(3);
    expect(DEFAULT_ANALYSIS_HORIZON_YEARS).toBe(20);
    expect(BCA_ENGINE_VERSION).toBe("openplan-bca-ts");
    // One source note per parameter, no orphans.
    expect(Object.keys(BCA_PARAMETER_SOURCE_NOTES).sort()).toEqual(
      Object.keys(DEFAULT_BCA_PARAMETERS).sort()
    );
  });
});
