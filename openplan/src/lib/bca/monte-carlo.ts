/**
 * OpenPlan benefit-cost screening — seeded Monte Carlo uncertainty runs.
 *
 * Clean re-implementation informed by DOT-Dashboard's
 * `runMonteCarloSimulation`. Deliberately fixed harvest bugs: unseeded
 * `Math.random` (nondeterministic), the triangular sampler reading
 * `param.most` while the type declared `mode` (silent NaN draws),
 * population standard deviation, floor-indexed percentiles, dot-path string
 * targets, and a per-iteration JSON deep-clone of the whole analysis.
 *
 * Deterministic given a seed: `mulberry32` is the only randomness source,
 * and draws are consumed in `config.draws` order each iteration (normal
 * consumes two draws, triangular and uniform one each).
 */

import { computeBenefitCostAnalysis } from "./engine";
import { DEFAULT_BCA_PARAMETERS, type BcaMonetizationParameters } from "./parameters";
import type { BcaAnalysisInputs, BcaBenefitInput, BcaCostInput } from "./types";

/** Standard mulberry32 PRNG: 32-bit state, returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BcaDistributionSpec =
  | { distribution: "normal"; mean: number; standardDeviation: number }
  | { distribution: "triangular"; min: number; mode: number; max: number }
  | { distribution: "uniform"; min: number; max: number };

export type BcaMonteCarloTarget =
  | { target: "parameter"; key: keyof BcaMonetizationParameters; spec: BcaDistributionSpec }
  | { target: "discountRatePct"; spec: BcaDistributionSpec }
  | {
      /** Multiplies every annual value of the line item at `index`. */
      target: "benefitScale" | "costScale";
      index: number;
      spec: BcaDistributionSpec;
    };

export type BcaMonteCarloConfig = {
  seed: number;
  /** Default 1000. */
  iterations?: number;
  draws: BcaMonteCarloTarget[];
};

export type BcaMetricPercentiles = {
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
};

export type BcaMetricSummary = {
  mean: number;
  median: number;
  /** Sample standard deviation (n - 1 denominator). */
  standardDeviation: number;
  percentiles: BcaMetricPercentiles;
};

export type BcaMonteCarloResult = {
  iterations: number;
  seed: number;
  npv: BcaMetricSummary;
  /** null when every iteration had a null BCR (zero PV costs). */
  bcr: BcaMetricSummary | null;
  /** Iterations excluded from the BCR stats because PV costs were zero. */
  bcrNullCount: number;
  /** Share of ALL iterations with BCR >= 1 (null-BCR iterations count as not >= 1). */
  probabilityBcrAtLeastOne: number;
  /** Share of ALL iterations with NPV > 0. */
  probabilityNpvPositive: number;
};

function sampleDistribution(spec: BcaDistributionSpec, rng: () => number): number {
  switch (spec.distribution) {
    case "normal": {
      if (!(spec.standardDeviation >= 0)) {
        throw new Error(`normal standardDeviation must be >= 0, got ${spec.standardDeviation}`);
      }
      // Box-Muller with two draws; u1 = 1 - rng() lands in (0, 1] so the
      // log is always finite (rng() itself can return exactly 0).
      const u1 = 1 - rng();
      const u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return spec.mean + z * spec.standardDeviation;
    }
    case "triangular": {
      const { min, mode, max } = spec;
      if (!(min <= mode && mode <= max)) {
        throw new Error(`triangular requires min <= mode <= max, got ${min}/${mode}/${max}`);
      }
      const draw = rng();
      if (max === min) {
        return min;
      }
      const cut = (mode - min) / (max - min);
      return draw < cut
        ? min + Math.sqrt(draw * (max - min) * (mode - min))
        : max - Math.sqrt((1 - draw) * (max - min) * (max - mode));
    }
    case "uniform": {
      if (spec.max < spec.min) {
        throw new Error(`uniform requires min <= max, got ${spec.min}/${spec.max}`);
      }
      return spec.min + rng() * (spec.max - spec.min);
    }
  }
}

/**
 * Scale a benefit input so every annual value of its stream is multiplied
 * by `factor`. All benefit streams are linear in their magnitude fields
 * (hours, crash counts, tons/VMT, annual value), so scaling the inputs is
 * exactly equivalent to scaling the computed stream — no deep clone of
 * results needed.
 */
function scaleBenefitInput(input: BcaBenefitInput, factor: number): BcaBenefitInput {
  switch (input.kind) {
    case "travelTime": {
      const hours = input.annualHoursSaved;
      return {
        ...input,
        annualHoursSaved: {
          commuter: hours.commuter === undefined ? undefined : hours.commuter * factor,
          commercial: hours.commercial === undefined ? undefined : hours.commercial * factor,
          freight: hours.freight === undefined ? undefined : hours.freight * factor,
        },
      };
    }
    case "safety": {
      const crashes = input.annualCrashesAvoided;
      return {
        ...input,
        annualCrashesAvoided: {
          fatal: crashes.fatal === undefined ? undefined : crashes.fatal * factor,
          injury: crashes.injury === undefined ? undefined : crashes.injury * factor,
          propertyDamageOnly:
            crashes.propertyDamageOnly === undefined
              ? undefined
              : crashes.propertyDamageOnly * factor,
        },
      };
    }
    case "emissions":
      return {
        ...input,
        annualMetricTonsCo2eReduced:
          input.annualMetricTonsCo2eReduced === undefined
            ? undefined
            : input.annualMetricTonsCo2eReduced * factor,
        annualVmtReduced:
          input.annualVmtReduced === undefined ? undefined : input.annualVmtReduced * factor,
      };
    case "vehicleOperating":
      return { ...input, annualVmtReduced: input.annualVmtReduced * factor };
    case "other":
      return { ...input, annualValue: input.annualValue * factor };
  }
}

/** Cost streams are linear in totalAmount/annualAmount; same argument as above. */
function scaleCostInput(input: BcaCostInput, factor: number): BcaCostInput {
  if (input.kind === "capital") {
    return { ...input, totalAmount: input.totalAmount * factor };
  }
  return { ...input, annualAmount: input.annualAmount * factor };
}

/** Percentile via linear interpolation between order statistics (sorted ascending). */
function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 1) {
    return sorted[0];
  }
  const rank = ((sorted.length - 1) * p) / 100;
  const lowIndex = Math.floor(rank);
  const highIndex = Math.min(lowIndex + 1, sorted.length - 1);
  const fraction = rank - lowIndex;
  return sorted[lowIndex] + fraction * (sorted[highIndex] - sorted[lowIndex]);
}

function summarizeMetric(values: number[]): BcaMetricSummary {
  const sorted = [...values].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const standardDeviation =
    sorted.length > 1
      ? Math.sqrt(
          sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sorted.length - 1)
        )
      : 0;
  return {
    mean,
    median: percentileOf(sorted, 50),
    standardDeviation,
    percentiles: {
      p5: percentileOf(sorted, 5),
      p10: percentileOf(sorted, 10),
      p25: percentileOf(sorted, 25),
      p50: percentileOf(sorted, 50),
      p75: percentileOf(sorted, 75),
      p90: percentileOf(sorted, 90),
      p95: percentileOf(sorted, 95),
    },
  };
}

export function runBcaMonteCarlo(
  inputs: BcaAnalysisInputs,
  parameters: Partial<BcaMonetizationParameters> | undefined,
  config: BcaMonteCarloConfig,
  options?: { generatedAt?: string }
): BcaMonteCarloResult {
  const iterations = config.iterations ?? 1000;
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error(`iterations must be an integer >= 1, got ${iterations}`);
  }
  if (!Number.isFinite(config.seed)) {
    throw new Error(`seed must be a finite number, got ${config.seed}`);
  }
  for (const draw of config.draws) {
    if (draw.target === "benefitScale" && (draw.index < 0 || draw.index >= inputs.benefits.length)) {
      throw new Error(`benefitScale index ${draw.index} out of range for ${inputs.benefits.length} benefits`);
    }
    if (draw.target === "costScale" && (draw.index < 0 || draw.index >= inputs.costs.length)) {
      throw new Error(`costScale index ${draw.index} out of range for ${inputs.costs.length} costs`);
    }
  }

  const rng = mulberry32(config.seed);
  const baseParameters: BcaMonetizationParameters = { ...DEFAULT_BCA_PARAMETERS, ...parameters };
  const generatedAt = options?.generatedAt;

  const npvValues: number[] = [];
  const bcrValues: number[] = [];
  let bcrNullCount = 0;
  let bcrAtLeastOneCount = 0;
  let npvPositiveCount = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let iterationParameters = baseParameters;
    let discountRatePct = inputs.discountRatePct;
    let benefits = inputs.benefits;
    let costs = inputs.costs;

    for (const draw of config.draws) {
      const value = sampleDistribution(draw.spec, rng);
      if (draw.target === "parameter") {
        iterationParameters = { ...iterationParameters, [draw.key]: value };
      } else if (draw.target === "discountRatePct") {
        // A normal draw can dip below zero, which the engine rejects as a
        // config error; clamp so one tail draw cannot abort the whole run.
        discountRatePct = Math.max(value, 0);
      } else if (draw.target === "benefitScale") {
        benefits = benefits.map((benefit, index) =>
          index === draw.index ? scaleBenefitInput(benefit, value) : benefit
        );
      } else {
        costs = costs.map((cost, index) =>
          index === draw.index ? scaleCostInput(cost, value) : cost
        );
      }
    }

    const result = computeBenefitCostAnalysis(
      { ...inputs, discountRatePct, benefits, costs },
      iterationParameters,
      generatedAt === undefined ? undefined : { generatedAt }
    );
    npvValues.push(result.netPresentValue);
    if (result.netPresentValue > 0) {
      npvPositiveCount += 1;
    }
    if (result.benefitCostRatio === null) {
      bcrNullCount += 1;
    } else {
      bcrValues.push(result.benefitCostRatio);
      if (result.benefitCostRatio >= 1) {
        bcrAtLeastOneCount += 1;
      }
    }
  }

  return {
    iterations,
    seed: config.seed,
    npv: summarizeMetric(npvValues),
    bcr: bcrValues.length > 0 ? summarizeMetric(bcrValues) : null,
    bcrNullCount,
    probabilityBcrAtLeastOne: bcrAtLeastOneCount / iterations,
    probabilityNpvPositive: npvPositiveCount / iterations,
  };
}
