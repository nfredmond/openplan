/**
 * OpenPlan benefit-cost screening engine.
 *
 * Clean re-implementation informed by DOT-Dashboard's
 * `benefit-cost-service.ts`. Deliberately fixed harvest bugs: sensitivity
 * that never recomputed anything, IRR declared but never computed, IRR NaN
 * on sparse (gap) years, payback returning null for immediately-profitable
 * projects, BCR = 0 when costs are zero, and in-place mutation of inputs.
 *
 * Discounting convention: the base year is the discounting epoch; analysis
 * years run `baseYear + 1` .. `baseYear + horizon` and every flow is an
 * end-of-year amount discounted by `(1 + rate)^(year - baseYear)`. A flat
 * benefit A over 3 years at 10% therefore has PV = A/1.1 + A/1.21 + A/1.331
 * (ordinary-annuity convention), and `computeNpvFromCashFlows` over
 * `annualNetCashFlow` reproduces `netPresentValue` when a single rate
 * applies. Only the emissions stream discounts at `co2DiscountRatePct`.
 *
 * All functions are pure: inputs are never mutated, results keep full float
 * precision (formatting belongs to render/UI), and the only clock access is
 * the `utcNow()` default behind the `generatedAt` override.
 */

import { utcNow } from "@/lib/planner-pack/utilities";

import {
  DEFAULT_BCA_PARAMETERS,
  DEFAULT_CO2_DISCOUNT_RATE_PCT,
  type BcaMonetizationParameters,
} from "./parameters";
import {
  InsufficientDataError,
  type BcaAnalysisInputs,
  type BcaBenefitInput,
  type BcaCostInput,
  type BcaLineItemResult,
  type BcaResult,
  type BcaYearValue,
} from "./types";

/** Pounds per metric ton, for VMT-derived CO2e tonnage (matches src/lib/tdm). */
const LBS_PER_METRIC_TON = 2204.62262;

const IRR_MAX_ITERATIONS = 100;
const IRR_PRECISION = 1e-6;
const IRR_BISECTION_LOW = -0.99;
const IRR_BISECTION_HIGH = 10;
/** Fixed scan grid so bisection bracketing is deterministic. */
const IRR_BISECTION_SCAN_STEPS = 400;

export function presentValue(value: number, ratePct: number, yearsFromBase: number): number {
  return value / (1 + ratePct / 100) ** yearsFromBase;
}

export function computeNpvFromCashFlows(
  cashFlows: Array<{ year: number; value: number }>,
  ratePct: number,
  baseYear: number
): number {
  return cashFlows.reduce(
    (sum, flow) => sum + presentValue(flow.value, ratePct, flow.year - baseYear),
    0
  );
}

/**
 * Internal rate of return over annual net cash flows, as a percentage
 * (7.2, not 0.072). Years with no entry are zero-filled (the harvest left
 * sparse holes that went NaN in the Newton loop). Newton from 10% with a
 * grid-scanned bisection fallback over [-0.99, 10] when Newton fails to
 * converge or the derivative vanishes. Returns null when the flows are not
 * mixed-sign or no root exists in the fallback interval.
 */
export function computeIrrPct(cashFlows: Array<{ year: number; value: number }>): number | null {
  if (cashFlows.length === 0) {
    return null;
  }
  for (const flow of cashFlows) {
    if (!Number.isInteger(flow.year)) {
      throw new Error(`Cash-flow year must be an integer, got ${flow.year}`);
    }
    if (!Number.isFinite(flow.value)) {
      throw new Error(`Cash-flow value must be finite, got ${flow.value}`);
    }
  }

  const years = cashFlows.map((flow) => flow.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const flows = new Array<number>(maxYear - minYear + 1).fill(0);
  for (const flow of cashFlows) {
    flows[flow.year - minYear] += flow.value;
  }

  const hasPositive = flows.some((value) => value > 0);
  const hasNegative = flows.some((value) => value < 0);
  if (!hasPositive || !hasNegative) {
    return null;
  }

  const npvAt = (rate: number): number =>
    flows.reduce((sum, value, index) => sum + value / (1 + rate) ** index, 0);
  const derivativeAt = (rate: number): number =>
    flows.reduce((sum, value, index) => sum - (index * value) / (1 + rate) ** (index + 1), 0);

  // Newton's method from 10%.
  let rate = 0.1;
  for (let iteration = 0; iteration < IRR_MAX_ITERATIONS; iteration += 1) {
    if (!(rate > -1) || !Number.isFinite(rate)) {
      break; // left the domain; fall through to bisection
    }
    const npv = npvAt(rate);
    if (Math.abs(npv) < IRR_PRECISION) {
      return rate * 100;
    }
    const derivative = derivativeAt(rate);
    if (derivative === 0 || !Number.isFinite(derivative)) {
      break;
    }
    rate -= npv / derivative;
  }
  if (rate > -1 && Number.isFinite(rate) && Math.abs(npvAt(rate)) < IRR_PRECISION) {
    return rate * 100;
  }

  // Bisection fallback: scan a fixed grid for a sign change, then bisect.
  const span = IRR_BISECTION_HIGH - IRR_BISECTION_LOW;
  let previousRate = IRR_BISECTION_LOW;
  let previousNpv = npvAt(previousRate);
  if (previousNpv === 0) {
    return previousRate * 100;
  }
  let low = Number.NaN;
  let high = Number.NaN;
  let lowNpv = 0;
  for (let step = 1; step <= IRR_BISECTION_SCAN_STEPS; step += 1) {
    const candidate = IRR_BISECTION_LOW + (span * step) / IRR_BISECTION_SCAN_STEPS;
    const candidateNpv = npvAt(candidate);
    if (candidateNpv === 0) {
      return candidate * 100;
    }
    if ((previousNpv < 0 && candidateNpv > 0) || (previousNpv > 0 && candidateNpv < 0)) {
      low = previousRate;
      high = candidate;
      lowNpv = previousNpv;
      break;
    }
    previousRate = candidate;
    previousNpv = candidateNpv;
  }
  if (!Number.isFinite(low)) {
    return null;
  }
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const mid = (low + high) / 2;
    const midNpv = npvAt(mid);
    if (Math.abs(midNpv) < IRR_PRECISION || (high - low) / 2 < 1e-12) {
      return mid * 100;
    }
    if ((midNpv < 0) === (lowNpv < 0)) {
      low = mid;
      lowNpv = midNpv;
    } else {
      high = mid;
    }
  }
  return ((low + high) / 2) * 100;
}

/**
 * Discounted payback in years from the start of the first analysis year,
 * over the cumulative *discounted* net flow. Flows follow the engine's
 * end-of-year convention: the k-th analysis year's flow lands at t = k, so
 * a cumulative that first reaches 0 with year k's flow pays back during
 * year k and linear interpolation yields a value in (k - 1, k]. Returns 0
 * when the cumulative is already >= 0 after the first year's flow (the
 * harvest returned null for immediately-profitable projects); null if the
 * cumulative never reaches 0 within the horizon.
 */
export function computeDiscountedPaybackYears(annualNet: BcaYearValue[]): number | null {
  if (annualNet.length === 0) {
    return null;
  }
  const ordered = [...annualNet].sort((left, right) => left.year - right.year);
  let cumulative = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const previous = cumulative;
    cumulative += ordered[index].presentValue;
    if (cumulative >= 0) {
      if (index === 0) {
        return 0;
      }
      // previous < 0 here, so the crossing happens within year `index + 1`
      // (whose end-of-year flow sits at t = index + 1).
      return index + (0 - previous) / (cumulative - previous);
    }
  }
  return null;
}

function requireFinite(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number, got ${value}`);
  }
  return value;
}

function growthFactor(ratePct: number | undefined, yearsFromStart: number): number {
  const rate = ratePct ?? 0;
  requireFinite(rate, "growth/escalation rate");
  // Below -100%/yr the base (1 + rate/100) goes negative and the stream
  // flips sign every year, which is never a meaningful growth model.
  // Exactly -100 is allowed: the stream is [A, 0, 0, ...].
  if (rate < -100) {
    throw new Error(`growth/escalation rate must be >= -100 percent, got ${rate}`);
  }
  return (1 + rate / 100) ** yearsFromStart;
}

type Stream = { kind: string; label: string; values: number[] };

function buildBenefitStream(
  input: BcaBenefitInput,
  parameters: BcaMonetizationParameters,
  horizon: number
): Stream {
  const values = new Array<number>(horizon).fill(0);
  switch (input.kind) {
    case "travelTime": {
      const hours = input.annualHoursSaved;
      const baseAnnual =
        requireFinite(hours.commuter ?? 0, "annualHoursSaved.commuter") *
          parameters.valueOfTimeCommuterPerHour +
        requireFinite(hours.commercial ?? 0, "annualHoursSaved.commercial") *
          parameters.valueOfTimeCommercialPerHour +
        requireFinite(hours.freight ?? 0, "annualHoursSaved.freight") *
          parameters.valueOfTimeFreightPerHour;
      for (let t = 0; t < horizon; t += 1) {
        values[t] = baseAnnual * growthFactor(input.annualGrowthRatePct, t);
      }
      return { kind: input.kind, label: input.label ?? "Travel time savings", values };
    }
    case "safety": {
      const crashes = input.annualCrashesAvoided;
      const annual =
        requireFinite(crashes.fatal ?? 0, "annualCrashesAvoided.fatal") *
          parameters.crashCostFatal +
        requireFinite(crashes.injury ?? 0, "annualCrashesAvoided.injury") *
          parameters.crashCostInjury +
        requireFinite(crashes.propertyDamageOnly ?? 0, "annualCrashesAvoided.propertyDamageOnly") *
          parameters.crashCostPropertyDamageOnly;
      values.fill(annual);
      return { kind: input.kind, label: input.label ?? "Safety (crash reduction)", values };
    }
    case "emissions": {
      // Measured tonnage wins over a VMT-derived estimate when both exist.
      let tons: number;
      if (typeof input.annualMetricTonsCo2eReduced === "number") {
        tons = requireFinite(input.annualMetricTonsCo2eReduced, "annualMetricTonsCo2eReduced");
      } else if (typeof input.annualVmtReduced === "number") {
        tons =
          (requireFinite(input.annualVmtReduced, "annualVmtReduced") *
            parameters.co2eLbsPerVehicleMile) /
          LBS_PER_METRIC_TON;
      } else {
        throw new InsufficientDataError(
          "Emissions benefit needs annualMetricTonsCo2eReduced or annualVmtReduced; supply one before computing."
        );
      }
      values.fill(tons * parameters.co2CostPerMetricTon);
      return { kind: input.kind, label: input.label ?? "CO2e emissions reduction", values };
    }
    case "vehicleOperating": {
      const annual =
        requireFinite(input.annualVmtReduced, "annualVmtReduced") *
        parameters.vehicleOperatingCostPerMile;
      values.fill(annual);
      return { kind: input.kind, label: input.label ?? "Vehicle operating cost savings", values };
    }
    case "other": {
      const annual = requireFinite(input.annualValue, "annualValue");
      for (let t = 0; t < horizon; t += 1) {
        values[t] = annual * growthFactor(input.annualGrowthRatePct, t);
      }
      return { kind: input.kind, label: input.label, values };
    }
  }
}

function buildCostStream(input: BcaCostInput, horizon: number): Stream {
  const values = new Array<number>(horizon).fill(0);
  if (input.kind === "capital") {
    const spreadYears = input.spreadYears ?? 1;
    const startYearOffset = input.startYearOffset ?? 0;
    if (!Number.isInteger(spreadYears) || spreadYears < 1) {
      throw new Error(`capital spreadYears must be an integer >= 1, got ${spreadYears}`);
    }
    if (!Number.isInteger(startYearOffset) || startYearOffset < 0) {
      throw new Error(`capital startYearOffset must be an integer >= 0, got ${startYearOffset}`);
    }
    const annual = requireFinite(input.totalAmount, "capital totalAmount") / spreadYears;
    // Clip to the horizon: slices past the last analysis year are dropped.
    for (let t = startYearOffset; t < startYearOffset + spreadYears && t < horizon; t += 1) {
      values[t] = annual;
    }
    return { kind: input.kind, label: input.label ?? "Capital cost", values };
  }
  const startYearOffset = input.startYearOffset ?? 0;
  if (!Number.isInteger(startYearOffset) || startYearOffset < 0) {
    throw new Error(`cost startYearOffset must be an integer >= 0, got ${startYearOffset}`);
  }
  const annual = requireFinite(input.annualAmount, "cost annualAmount");
  for (let t = startYearOffset; t < horizon; t += 1) {
    // First active year is unescalated; escalation compounds from there.
    values[t] = annual * growthFactor(input.escalationRatePct, t - startYearOffset);
  }
  const label =
    input.kind === "operationsMaintenance"
      ? (input.label ?? "Operations & maintenance")
      : input.label;
  return { kind: input.kind, label, values };
}

function toLineItem(stream: Stream, ratePct: number, baseYear: number): BcaLineItemResult {
  const annualValues: BcaYearValue[] = stream.values.map((value, t) => ({
    year: baseYear + 1 + t,
    value,
    presentValue: presentValue(value, ratePct, t + 1),
  }));
  return {
    kind: stream.kind,
    label: stream.label,
    annualValues,
    undiscountedTotal: stream.values.reduce((sum, value) => sum + value, 0),
    presentValue: annualValues.reduce((sum, entry) => sum + entry.presentValue, 0),
  };
}

export function computeBenefitCostAnalysis(
  inputs: BcaAnalysisInputs,
  parameters?: Partial<BcaMonetizationParameters>,
  options?: { generatedAt?: string }
): BcaResult {
  const { baseYear, analysisHorizonYears, discountRatePct } = inputs;
  const co2DiscountRatePct = inputs.co2DiscountRatePct ?? DEFAULT_CO2_DISCOUNT_RATE_PCT;

  if (!Number.isInteger(analysisHorizonYears) || analysisHorizonYears < 1 || analysisHorizonYears > 100) {
    throw new Error(
      `analysisHorizonYears must be an integer between 1 and 100, got ${analysisHorizonYears}`
    );
  }
  if (!Number.isInteger(baseYear) || baseYear < 1900 || baseYear > 2200) {
    throw new Error(`baseYear must be an integer between 1900 and 2200, got ${baseYear}`);
  }
  if (!Number.isFinite(discountRatePct) || discountRatePct < 0) {
    throw new Error(`discountRatePct must be >= 0, got ${discountRatePct}`);
  }
  if (!Number.isFinite(co2DiscountRatePct) || co2DiscountRatePct < 0) {
    throw new Error(`co2DiscountRatePct must be >= 0, got ${co2DiscountRatePct}`);
  }
  if (inputs.benefits.length === 0 && inputs.costs.length === 0) {
    throw new InsufficientDataError(
      "No benefit or cost inputs; add at least one line item before computing a benefit-cost screen."
    );
  }

  const merged: BcaMonetizationParameters = { ...DEFAULT_BCA_PARAMETERS, ...parameters };

  const benefitItems = inputs.benefits.map((input) => {
    const stream = buildBenefitStream(input, merged, analysisHorizonYears);
    // Only the CO2e stream discounts at the (lower) carbon rate.
    const ratePct = input.kind === "emissions" ? co2DiscountRatePct : discountRatePct;
    return toLineItem(stream, ratePct, baseYear);
  });
  const costItems = inputs.costs.map((input) =>
    toLineItem(buildCostStream(input, analysisHorizonYears), discountRatePct, baseYear)
  );

  const presentValueBenefits = benefitItems.reduce((sum, item) => sum + item.presentValue, 0);
  const presentValueCosts = costItems.reduce((sum, item) => sum + item.presentValue, 0);
  const netPresentValue = presentValueBenefits - presentValueCosts;
  const benefitCostRatio = presentValueCosts > 0 ? presentValueBenefits / presentValueCosts : null;

  const annualNetCashFlow: BcaYearValue[] = [];
  for (let t = 0; t < analysisHorizonYears; t += 1) {
    let value = 0;
    let pv = 0;
    for (const item of benefitItems) {
      value += item.annualValues[t].value;
      pv += item.annualValues[t].presentValue;
    }
    for (const item of costItems) {
      value -= item.annualValues[t].value;
      pv -= item.annualValues[t].presentValue;
    }
    annualNetCashFlow.push({ year: baseYear + 1 + t, value, presentValue: pv });
  }

  return {
    baseYear,
    analysisHorizonYears,
    discountRatePct,
    co2DiscountRatePct,
    presentValueBenefits,
    presentValueCosts,
    netPresentValue,
    benefitCostRatio,
    internalRateOfReturnPct: computeIrrPct(
      annualNetCashFlow.map(({ year, value }) => ({ year, value }))
    ),
    paybackYearsDiscounted: computeDiscountedPaybackYears(annualNetCashFlow),
    benefitItems,
    costItems,
    annualNetCashFlow,
    generatedAt: options?.generatedAt ?? utcNow(),
  };
}

export type BcaSensitivityTarget = {
  key: keyof BcaMonetizationParameters | "discountRatePct";
  /** Multiplier for the low case. Default 0.8. */
  lowFactor?: number;
  /** Multiplier for the high case. Default 1.2. */
  highFactor?: number;
};

export type BcaSensitivityPoint = { npv: number; bcr: number | null };

export type BcaSensitivityEntry = {
  key: BcaSensitivityTarget["key"];
  low: BcaSensitivityPoint;
  base: BcaSensitivityPoint;
  high: BcaSensitivityPoint;
  /** high.npv - low.npv (signed; sorted by absolute value). */
  npvSwing: number;
};

export type BcaSensitivityResult = {
  entries: BcaSensitivityEntry[];
  generatedAt: string;
};

/**
 * One-at-a-time sensitivity with a REAL recompute at each low/high value
 * (the harvest's version just scaled the base BCR by the adjustment
 * factors, so every parameter reported identical impact).
 */
export function runBcaSensitivity(
  inputs: BcaAnalysisInputs,
  parameters: Partial<BcaMonetizationParameters> | undefined,
  targets: BcaSensitivityTarget[],
  options?: { generatedAt?: string }
): BcaSensitivityResult {
  const generatedAt = options?.generatedAt ?? utcNow();
  const base = computeBenefitCostAnalysis(inputs, parameters, { generatedAt });
  const basePoint: BcaSensitivityPoint = {
    npv: base.netPresentValue,
    bcr: base.benefitCostRatio,
  };
  const merged: BcaMonetizationParameters = { ...DEFAULT_BCA_PARAMETERS, ...parameters };

  const entries = targets.map((target) => {
    const lowFactor = target.lowFactor ?? 0.8;
    const highFactor = target.highFactor ?? 1.2;
    const evaluate = (factor: number): BcaSensitivityPoint => {
      const result =
        target.key === "discountRatePct"
          ? computeBenefitCostAnalysis(
              { ...inputs, discountRatePct: inputs.discountRatePct * factor },
              parameters,
              { generatedAt }
            )
          : computeBenefitCostAnalysis(
              inputs,
              { ...merged, [target.key]: merged[target.key] * factor },
              { generatedAt }
            );
      return { npv: result.netPresentValue, bcr: result.benefitCostRatio };
    };
    const low = evaluate(lowFactor);
    const high = evaluate(highFactor);
    return { key: target.key, low, base: basePoint, high, npvSwing: high.npv - low.npv };
  });

  entries.sort((left, right) => Math.abs(right.npvSwing) - Math.abs(left.npvSwing));
  return { entries, generatedAt };
}
