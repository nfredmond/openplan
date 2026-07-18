/**
 * OpenPlan benefit-cost screening — monetization parameters and constants.
 *
 * Values are screening defaults in the spirit of the USDOT Benefit-Cost
 * Analysis Guidance for Discretionary Grant Programs. They exist so a
 * planner can get an order-of-magnitude screen without a spreadsheet; every
 * value must be confirmed against the current guidance before appearing in
 * a grant application (see `BCA_SCREENING_CAVEAT`).
 */

export interface BcaMonetizationParameters {
  /** $/person-hour, personal/commute travel (2023 USD). */
  valueOfTimeCommuterPerHour: number;
  /** $/vehicle-hour, commercial vehicle operation (2023 USD). */
  valueOfTimeCommercialPerHour: number;
  /** $/vehicle-hour, freight/truck (2023 USD). */
  valueOfTimeFreightPerHour: number;
  /**
   * $ per fatal crash avoided. Screening default equals one value of a
   * statistical life; an average fatal crash exceeds one fatality plus
   * co-occurring injuries, so this understates a guidance-consistent
   * per-crash value.
   */
  crashCostFatal: number;
  /** $ per non-fatal injury crash avoided. */
  crashCostInjury: number;
  /** $ per property-damage-only crash avoided. */
  crashCostPropertyDamageOnly: number;
  /** $ per metric ton of CO2e reduced. */
  co2CostPerMetricTon: number;
  /** $ per vehicle-mile of variable operating cost avoided. */
  vehicleOperatingCostPerMile: number;
  /** Pounds of CO2e emitted per light-duty vehicle-mile (for VMT-derived tons). */
  co2eLbsPerVehicleMile: number;
}

export const DEFAULT_BCA_PARAMETERS: BcaMonetizationParameters = {
  valueOfTimeCommuterPerHour: 18.8,
  valueOfTimeCommercialPerHour: 32.6,
  valueOfTimeFreightPerHour: 38.5,
  crashCostFatal: 13_200_000,
  crashCostInjury: 210_000,
  crashCostPropertyDamageOnly: 4_600,
  co2CostPerMetricTon: 51,
  vehicleOperatingCostPerMile: 0.43,
  co2eLbsPerVehicleMile: 0.78,
};

export const BCA_PARAMETER_SOURCE_NOTES: Record<keyof BcaMonetizationParameters, string> = {
  valueOfTimeCommuterPerHour:
    "Screening default for personal/commute value of travel time ($/person-hour, 2023 dollars); confirm against the current USDOT Benefit-Cost Analysis Guidance before use in an application.",
  valueOfTimeCommercialPerHour:
    "Screening default for commercial-vehicle value of travel time ($/vehicle-hour, 2023 dollars); confirm against the current USDOT Benefit-Cost Analysis Guidance before use in an application.",
  valueOfTimeFreightPerHour:
    "Screening default for freight/truck value of travel time ($/vehicle-hour, 2023 dollars); confirm against the current USDOT Benefit-Cost Analysis Guidance before use in an application.",
  crashCostFatal:
    "Screening default for a fatal crash avoided, set to one value of a statistical life ($13.2M, 2022 dollars, 2024 USDOT Benefit-Cost Analysis Guidance). The guidance monetizes casualties per person by KABCO severity, and an average fatal crash exceeds one fatality plus co-occurring injuries, so this understates a guidance-consistent per-crash value; confirm against the current USDOT Benefit-Cost Analysis Guidance before use in an application.",
  crashCostInjury:
    "Screening default for an average non-fatal injury crash; confirm against the injury-severity (KABCO) values in the current USDOT Benefit-Cost Analysis Guidance before use in an application.",
  crashCostPropertyDamageOnly:
    "Screening default for a property-damage-only crash; confirm against the current USDOT Benefit-Cost Analysis Guidance before use in an application.",
  co2CostPerMetricTon:
    "Interagency Working Group interim social cost of CO2 at a 3 percent discount rate (2020-era dollars). Held flat across the analysis horizon although the SCC schedule rises by emission year, which understates later-year carbon benefits; confirm against the current USDOT Benefit-Cost Analysis Guidance carbon values before use in an application.",
  vehicleOperatingCostPerMile:
    "Screening default for light-duty variable vehicle operating cost per mile; confirm against the current USDOT Benefit-Cost Analysis Guidance before use in an application.",
  co2eLbsPerVehicleMile:
    "Light-duty fleet-average CO2e per vehicle-mile screening default; a region- and year-specific EMFAC (or MOVES) factor should supersede it.",
};

/** OMB Circular A-94 (2023 revision) real rate adopted by USDOT BCA guidance. */
export const DEFAULT_DISCOUNT_RATE_PCT = 3.1;

/** Pre-2023 A-94 rate, kept for sensitivity comparisons. */
export const LEGACY_DISCOUNT_RATE_PCT = 7;

/**
 * CO2e streams discount at the rate their SC-CO2 value was derived at
 * (3 percent for the IWG-interim $51 default; 2 percent belongs with
 * EPA 2023 SC-GHG values per newer USDOT guidance).
 */
export const DEFAULT_CO2_DISCOUNT_RATE_PCT = 3;

export const DEFAULT_ANALYSIS_HORIZON_YEARS = 20;

export const BCA_SCREENING_CAVEAT =
  "Screening-level benefit-cost estimate for internal prioritization and grant-readiness review — not a benefit-cost analysis of record. Confirm monetization values against the current USDOT Benefit-Cost Analysis Guidance before including results in an application.";

export const BCA_METHOD_CITATION =
  "USDOT Benefit-Cost Analysis Guidance for Discretionary Grant Programs; OMB Circular A-94 (2023 revision).";

export const BCA_ENGINE_VERSION = "openplan-bca-ts";
