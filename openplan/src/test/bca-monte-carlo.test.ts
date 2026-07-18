import { describe, expect, it } from "vitest";

import { computeBenefitCostAnalysis } from "@/lib/bca/engine";
import { mulberry32, runBcaMonteCarlo, type BcaMonteCarloConfig } from "@/lib/bca/monte-carlo";
import type { BcaAnalysisInputs } from "@/lib/bca/types";

// Clean re-implementation informed by DOT-Dashboard's
// runMonteCarloSimulation (benefit-cost-service.ts; reference only — NOT a
// line-port). Harvest bugs deliberately fixed and regression-tested below:
//   - unseeded Math.random -> mulberry32(seed), deterministic given a seed;
//   - triangular sampler read `param.most` while the type declared `mode`,
//     silently producing NaN draws for type-conformant specs -> the spec
//     field here is `mode` and it is actually consumed;
//   - population standard deviation (/n) -> sample sd (/(n-1));
//   - floor-indexed percentiles -> linear interpolation between order stats;
//   - per-iteration JSON deep-clone of the whole analysis -> cheap scaled
//     copies of the specific parameter/input being drawn;
//   - dot-path string targets rooted inconsistently -> a typed target union.

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

const travelTimeFixture: BcaAnalysisInputs = {
  baseYear: 2026,
  analysisHorizonYears: 5,
  discountRatePct: 10,
  benefits: [
    { kind: "travelTime", annualHoursSaved: { commuter: 1000 } },
    { kind: "other", label: "Reliability", annualValue: 20_000 },
  ],
  costs: [{ kind: "capital", totalAmount: 100_000 }],
};

const mixedDrawConfig: BcaMonteCarloConfig = {
  seed: 7,
  iterations: 60,
  draws: [
    {
      target: "parameter",
      key: "valueOfTimeCommuterPerHour",
      spec: { distribution: "normal", mean: 18.8, standardDeviation: 3 },
    },
    { target: "discountRatePct", spec: { distribution: "uniform", min: 8, max: 12 } },
    {
      target: "benefitScale",
      index: 1,
      spec: { distribution: "triangular", min: 0.8, mode: 1, max: 1.3 },
    },
    { target: "costScale", index: 0, spec: { distribution: "uniform", min: 0.9, max: 1.2 } },
  ],
};

describe("mulberry32", () => {
  it("is deterministic per seed and emits floats in [0, 1)", () => {
    const first = mulberry32(42);
    const second = mulberry32(42);
    const sequenceA = Array.from({ length: 8 }, () => first());
    const sequenceB = Array.from({ length: 8 }, () => second());
    expect(sequenceA).toEqual(sequenceB);
    for (const value of sequenceA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    const other = mulberry32(43);
    expect(Array.from({ length: 8 }, () => other())).not.toEqual(sequenceA);
  });
});

describe("runBcaMonteCarlo", () => {
  it("returns identical results for the same seed (regression: harvest was unseeded)", () => {
    const first = runBcaMonteCarlo(travelTimeFixture, undefined, mixedDrawConfig, {
      generatedAt: GENERATED_AT,
    });
    const second = runBcaMonteCarlo(travelTimeFixture, undefined, mixedDrawConfig, {
      generatedAt: GENERATED_AT,
    });
    expect(first).toEqual(second);
  });

  it("returns different means for different seeds", () => {
    const first = runBcaMonteCarlo(travelTimeFixture, undefined, { ...mixedDrawConfig, seed: 1 });
    const second = runBcaMonteCarlo(travelTimeFixture, undefined, { ...mixedDrawConfig, seed: 2 });
    expect(first.npv.mean).not.toBe(second.npv.mean);
  });

  it("consumes the triangular `mode` field (regression: harvest read `param.most` -> NaN)", () => {
    // VOT ~ triangular(10, 18.8, 30); npv = 1000*VOT*a5 - 100000/1.1 with
    // a5 = 3.7907867694 (annuity, 10%, 5y), so every draw must land in
    //   [10*1000*a5 - 90909.09, 30*1000*a5 - 90909.09]
    //   = [-53001.22, +22814.51].
    // A `most`-style bug makes every draw NaN, which would blow all of this.
    const result = runBcaMonteCarlo(
      {
        baseYear: 2026,
        analysisHorizonYears: 5,
        discountRatePct: 10,
        benefits: [{ kind: "travelTime", annualHoursSaved: { commuter: 1000 } }],
        costs: [{ kind: "capital", totalAmount: 100_000 }],
      },
      undefined,
      {
        seed: 11,
        iterations: 100,
        draws: [
          {
            target: "parameter",
            key: "valueOfTimeCommuterPerHour",
            spec: { distribution: "triangular", min: 10, mode: 18.8, max: 30 },
          },
        ],
      }
    );

    const annuity5 = Array.from({ length: 5 }, (_, k) => 1 / 1.1 ** (k + 1)).reduce(
      (sum, value) => sum + value,
      0
    );
    const lowerBound = 10 * 1000 * annuity5 - 100_000 / 1.1;
    const upperBound = 30 * 1000 * annuity5 - 100_000 / 1.1;
    expect(Number.isFinite(result.npv.mean)).toBe(true);
    expect(result.npv.standardDeviation).toBeGreaterThan(0);
    for (const value of Object.values(result.npv.percentiles)) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(result.npv.percentiles.p5).toBeGreaterThanOrEqual(lowerBound - 1e-6);
    expect(result.npv.percentiles.p95).toBeLessThanOrEqual(upperBound + 1e-6);
  });

  it("collapses to the deterministic value for a degenerate uniform (min = max)", () => {
    const inputs: BcaAnalysisInputs = {
      baseYear: 2026,
      analysisHorizonYears: 2,
      discountRatePct: 10,
      benefits: [{ kind: "vehicleOperating", annualVmtReduced: 100_000 }],
      costs: [{ kind: "capital", totalAmount: 20_000 }],
    };
    const result = runBcaMonteCarlo(inputs, undefined, {
      seed: 5,
      iterations: 5,
      draws: [
        {
          target: "parameter",
          key: "vehicleOperatingCostPerMile",
          spec: { distribution: "uniform", min: 0.86, max: 0.86 },
        },
      ],
    });

    // Every draw is exactly 0.86, so every iteration equals the plain
    // compute at that parameter value.
    const deterministic = computeBenefitCostAnalysis(
      inputs,
      { vehicleOperatingCostPerMile: 0.86 },
      { generatedAt: GENERATED_AT }
    );
    expect(result.npv.mean).toBeCloseTo(deterministic.netPresentValue, 6);
    expect(result.npv.standardDeviation).toBeCloseTo(0, 6);
    expect(result.npv.percentiles.p5).toBe(result.npv.percentiles.p95);
  });

  it("keeps percentiles ordered and probabilities in [0, 1]", () => {
    const result = runBcaMonteCarlo(
      {
        baseYear: 2026,
        analysisHorizonYears: 10,
        discountRatePct: 3.1,
        benefits: [{ kind: "emissions", annualMetricTonsCo2eReduced: 1000 }],
        costs: [{ kind: "capital", totalAmount: 400_000 }],
      },
      undefined,
      {
        seed: 99,
        iterations: 200,
        draws: [
          {
            target: "parameter",
            key: "co2CostPerMetricTon",
            spec: { distribution: "normal", mean: 51, standardDeviation: 15 },
          },
        ],
      }
    );

    const { p5, p10, p25, p50, p75, p90, p95 } = result.npv.percentiles;
    expect(p5).toBeLessThanOrEqual(p10);
    expect(p10).toBeLessThanOrEqual(p25);
    expect(p25).toBeLessThanOrEqual(p50);
    expect(p50).toBeLessThanOrEqual(p75);
    expect(p75).toBeLessThanOrEqual(p90);
    expect(p90).toBeLessThanOrEqual(p95);
    expect(result.probabilityBcrAtLeastOne).toBeGreaterThanOrEqual(0);
    expect(result.probabilityBcrAtLeastOne).toBeLessThanOrEqual(1);
    expect(result.probabilityNpvPositive).toBeGreaterThanOrEqual(0);
    expect(result.probabilityNpvPositive).toBeLessThanOrEqual(1);
    expect(result.bcr).not.toBeNull();
    expect(result.bcrNullCount).toBe(0);
  });

  it("matches a hand-computed sample standard deviation on a 2-iteration run", () => {
    const inputs: BcaAnalysisInputs = {
      baseYear: 2026,
      analysisHorizonYears: 3,
      discountRatePct: 10,
      benefits: [{ kind: "other", label: "B", annualValue: 100_000 }],
      costs: [{ kind: "capital", totalAmount: 150_000 }],
    };
    const config: BcaMonteCarloConfig = {
      seed: 123,
      iterations: 2,
      draws: [
        {
          target: "benefitScale",
          index: 0,
          spec: { distribution: "uniform", min: 0.5, max: 1.5 },
        },
      ],
    };
    const result = runBcaMonteCarlo(inputs, undefined, config);

    // Replicate the two draws with the same PRNG (uniform consumes one draw
    // per iteration): s_i = 0.5 + r_i * (1.5 - 0.5). Benefit scaling is
    // linear, so npv_i = s_i * pvBenefits - pvCosts.
    const rng = mulberry32(123);
    const s1 = 0.5 + rng() * (1.5 - 0.5);
    const s2 = 0.5 + rng() * (1.5 - 0.5);
    const base = computeBenefitCostAnalysis(inputs, undefined, { generatedAt: GENERATED_AT });
    const npv1 = s1 * base.presentValueBenefits - base.presentValueCosts;
    const npv2 = s2 * base.presentValueBenefits - base.presentValueCosts;
    const mean = (npv1 + npv2) / 2;
    // Sample sd with the n-1 denominator (n = 2):
    //   sd = sqrt(((npv1-mean)^2 + (npv2-mean)^2) / (2 - 1)) = |npv1-npv2|/sqrt(2).
    const sd = Math.sqrt((npv1 - mean) ** 2 + (npv2 - mean) ** 2);
    expect(result.npv.mean).toBeCloseTo(mean, 5);
    expect(result.npv.standardDeviation).toBeCloseTo(sd, 5);
    expect(result.npv.standardDeviation).toBeCloseTo(Math.abs(npv1 - npv2) / Math.SQRT2, 5);
    // Median of two points interpolates to the midpoint = mean; p50 is the
    // same order statistic.
    expect(result.npv.median).toBeCloseTo(mean, 5);
    expect(result.npv.median).toBe(result.npv.percentiles.p50);
  });

  it("excludes null-BCR iterations from BCR stats but counts them", () => {
    const result = runBcaMonteCarlo(
      {
        baseYear: 2026,
        analysisHorizonYears: 3,
        discountRatePct: 10,
        benefits: [{ kind: "other", label: "B", annualValue: 10_000 }],
        costs: [], // zero PV costs every iteration -> BCR always null
      },
      undefined,
      {
        seed: 3,
        iterations: 8,
        draws: [
          { target: "benefitScale", index: 0, spec: { distribution: "uniform", min: 0.9, max: 1.1 } },
        ],
      }
    );
    expect(result.bcr).toBeNull();
    expect(result.bcrNullCount).toBe(8);
    expect(result.probabilityBcrAtLeastOne).toBe(0);
    expect(result.probabilityNpvPositive).toBe(1);
  });

  it("defaults to 1000 iterations and records the seed", () => {
    const result = runBcaMonteCarlo(
      {
        baseYear: 2026,
        analysisHorizonYears: 1,
        discountRatePct: 10,
        benefits: [{ kind: "other", label: "B", annualValue: 100 }],
        costs: [{ kind: "capital", totalAmount: 50 }],
      },
      undefined,
      {
        seed: 21,
        draws: [
          { target: "costScale", index: 0, spec: { distribution: "uniform", min: 0.5, max: 1.5 } },
        ],
      }
    );
    expect(result.iterations).toBe(1000);
    expect(result.seed).toBe(21);
  });

  it("rejects out-of-range scale indexes with a plain Error", () => {
    expect(() =>
      runBcaMonteCarlo(travelTimeFixture, undefined, {
        seed: 1,
        iterations: 2,
        draws: [
          { target: "benefitScale", index: 5, spec: { distribution: "uniform", min: 1, max: 1 } },
        ],
      })
    ).toThrow(/benefitScale index 5 out of range/);
  });

  it("never mutates deep-frozen inputs", () => {
    const inputs = deepFreeze<BcaAnalysisInputs>({
      baseYear: 2026,
      analysisHorizonYears: 4,
      discountRatePct: 10,
      benefits: [
        { kind: "safety", annualCrashesAvoided: { fatal: 0.02, injury: 1 } },
        { kind: "emissions", annualVmtReduced: 500_000 },
      ],
      costs: [{ kind: "operationsMaintenance", annualAmount: 5_000, escalationRatePct: 3 }],
    });
    const result = runBcaMonteCarlo(inputs, deepFreeze({ co2CostPerMetricTon: 60 }), {
      seed: 17,
      iterations: 10,
      draws: [
        { target: "benefitScale", index: 1, spec: { distribution: "uniform", min: 0.8, max: 1.2 } },
        { target: "costScale", index: 0, spec: { distribution: "uniform", min: 0.8, max: 1.2 } },
        { target: "discountRatePct", spec: { distribution: "triangular", min: 7, mode: 10, max: 12 } },
      ],
    });
    expect(Number.isFinite(result.npv.mean)).toBe(true);
  });
});
