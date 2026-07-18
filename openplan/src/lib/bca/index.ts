/**
 * OpenPlan benefit-cost screening — public surface.
 */

export {
  InsufficientDataError,
  type BcaAnalysisInputs,
  type BcaBenefitInput,
  type BcaBenefitKind,
  type BcaCapitalCostInput,
  type BcaCostInput,
  type BcaCostKind,
  type BcaEmissionsBenefitInput,
  type BcaLineItemResult,
  type BcaOperationsMaintenanceCostInput,
  type BcaOtherBenefitInput,
  type BcaOtherCostInput,
  type BcaResult,
  type BcaSafetyBenefitInput,
  type BcaTravelTimeBenefitInput,
  type BcaVehicleOperatingBenefitInput,
  type BcaYearValue,
} from "./types";

export {
  BCA_ENGINE_VERSION,
  BCA_METHOD_CITATION,
  BCA_PARAMETER_SOURCE_NOTES,
  BCA_SCREENING_CAVEAT,
  DEFAULT_ANALYSIS_HORIZON_YEARS,
  DEFAULT_BCA_PARAMETERS,
  DEFAULT_CO2_DISCOUNT_RATE_PCT,
  DEFAULT_DISCOUNT_RATE_PCT,
  LEGACY_DISCOUNT_RATE_PCT,
  type BcaMonetizationParameters,
} from "./parameters";

export {
  computeBenefitCostAnalysis,
  computeDiscountedPaybackYears,
  computeIrrPct,
  computeNpvFromCashFlows,
  presentValue,
  runBcaSensitivity,
  type BcaSensitivityEntry,
  type BcaSensitivityPoint,
  type BcaSensitivityResult,
  type BcaSensitivityTarget,
} from "./engine";

export {
  mulberry32,
  runBcaMonteCarlo,
  type BcaDistributionSpec,
  type BcaMetricPercentiles,
  type BcaMetricSummary,
  type BcaMonteCarloConfig,
  type BcaMonteCarloResult,
  type BcaMonteCarloTarget,
} from "./monte-carlo";

export {
  bcaFactBlocks,
  formatUsd,
  renderBcaMemoMarkdown,
  type RenderBcaMemoOptions,
} from "./render";
