/**
 * OpenPlan benefit-cost screening — input and result types.
 *
 * Clean re-implementation (not a line-port) of the salvageable math in
 * DOT-Dashboard's `benefit-cost-service.ts`. This is a native OpenPlan
 * library, so fields are camelCase (no Python/CSV wire-shape parity claim,
 * unlike `src/lib/planner-pack/*`).
 *
 * Error contract mirrors planner-pack's two tiers: configuration problems
 * throw plain `Error`; structurally-valid-but-missing data throws
 * `InsufficientDataError` ("run the upstream step / fill the input first",
 * not a bug).
 */

export { InsufficientDataError } from "@/lib/planner-pack/types";

export type BcaBenefitKind =
  | "travelTime"
  | "safety"
  | "emissions"
  | "vehicleOperating"
  | "other";

export type BcaCostKind = "capital" | "operationsMaintenance" | "other";

export type BcaTravelTimeBenefitInput = {
  kind: "travelTime";
  label?: string;
  /** Annual person/vehicle hours saved in the first analysis year. */
  annualHoursSaved: { commuter?: number; commercial?: number; freight?: number };
  annualGrowthRatePct?: number;
};

export type BcaSafetyBenefitInput = {
  kind: "safety";
  label?: string;
  /** Annual crashes avoided, held flat over the horizon. */
  annualCrashesAvoided: { fatal?: number; injury?: number; propertyDamageOnly?: number };
};

/**
 * Emissions benefit. If only `annualVmtReduced` is given, CO2e tons are
 * derived via the `co2eLbsPerVehicleMile` parameter; if both are given,
 * `annualMetricTonsCo2eReduced` wins (a directly-measured tonnage always
 * supersedes a VMT-derived estimate). If neither is given the input is
 * missing data and compute throws `InsufficientDataError`.
 */
export type BcaEmissionsBenefitInput = {
  kind: "emissions";
  label?: string;
  annualMetricTonsCo2eReduced?: number;
  annualVmtReduced?: number;
};

export type BcaVehicleOperatingBenefitInput = {
  kind: "vehicleOperating";
  label?: string;
  annualVmtReduced: number;
};

export type BcaOtherBenefitInput = {
  kind: "other";
  label: string;
  annualValue: number;
  annualGrowthRatePct?: number;
};

export type BcaBenefitInput =
  | BcaTravelTimeBenefitInput
  | BcaSafetyBenefitInput
  | BcaEmissionsBenefitInput
  | BcaVehicleOperatingBenefitInput
  | BcaOtherBenefitInput;

export type BcaCapitalCostInput = {
  kind: "capital";
  label?: string;
  totalAmount: number;
  /** Spread the total evenly over this many years. Default 1. */
  spreadYears?: number;
  /** Program-year offset (0 = first analysis year) where spending starts. Default 0. */
  startYearOffset?: number;
};

export type BcaOperationsMaintenanceCostInput = {
  kind: "operationsMaintenance";
  label?: string;
  annualAmount: number;
  escalationRatePct?: number;
  /** Default 0, i.e. alongside/after year-0 capital. */
  startYearOffset?: number;
};

export type BcaOtherCostInput = {
  kind: "other";
  label: string;
  annualAmount: number;
  escalationRatePct?: number;
  startYearOffset?: number;
};

export type BcaCostInput =
  | BcaCapitalCostInput
  | BcaOperationsMaintenanceCostInput
  | BcaOtherCostInput;

export interface BcaAnalysisInputs {
  /**
   * Discounting epoch (year of decision/award). Analysis years run
   * `baseYear + 1` through `baseYear + analysisHorizonYears`; every flow is
   * an end-of-year amount discounted by `(1 + rate)^(year - baseYear)`.
   */
  baseYear: number;
  analysisHorizonYears: number;
  discountRatePct: number;
  /**
   * Discount rate for the emissions (CO2e) benefit stream only. Defaults to
   * `DEFAULT_CO2_DISCOUNT_RATE_PCT`. CO2e streams discount at the rate their
   * SC-CO2 value was derived at (3% for the IWG-interim $51 default; 2%
   * belongs with EPA 2023 SC-GHG values per newer USDOT guidance), so the
   * emissions stream is discounted separately from everything else.
   */
  co2DiscountRatePct?: number;
  benefits: BcaBenefitInput[];
  costs: BcaCostInput[];
}

export interface BcaYearValue {
  year: number;
  value: number;
  presentValue: number;
}

export interface BcaLineItemResult {
  kind: string;
  label: string;
  /** Dense: one entry per horizon year (zero-valued outside the item's active window). */
  annualValues: BcaYearValue[];
  undiscountedTotal: number;
  presentValue: number;
}

export interface BcaResult {
  baseYear: number;
  analysisHorizonYears: number;
  discountRatePct: number;
  co2DiscountRatePct: number;
  presentValueBenefits: number;
  presentValueCosts: number;
  netPresentValue: number;
  /** null when PV costs are zero — a ratio with a zero denominator is not 0. */
  benefitCostRatio: number | null;
  internalRateOfReturnPct: number | null;
  /** Years from the start of the first analysis year; null if never recovered in-horizon. */
  paybackYearsDiscounted: number | null;
  benefitItems: BcaLineItemResult[];
  costItems: BcaLineItemResult[];
  /** Dense, one entry per horizon year (benefits minus costs). */
  annualNetCashFlow: BcaYearValue[];
  generatedAt: string;
}
