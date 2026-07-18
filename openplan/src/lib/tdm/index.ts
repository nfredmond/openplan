// Public surface of the TDM library: strategy catalog + combination/GHG math.
// See catalog.ts and engine.ts headers for provenance and the harvest
// defects deliberately fixed.

export {
  TDM_STRATEGY_CATALOG,
  getTdmStrategy,
  type TdmStrategy,
  type TdmStrategyCategory,
} from "./catalog";

export {
  DEFAULT_CO2E_LBS_PER_VEHICLE_MILE,
  LBS_PER_METRIC_TON,
  TDM_COMBINED_REVIEW_THRESHOLD_PCT,
  TDM_SCREENING_CAVEAT,
  applyTdmToAnnualVmt,
  combineTdmStrategies,
  estimateGhgFromVmtReduction,
  summarizeTdmCombination,
  type TdmCombinationResult,
  type TdmCombinedStrategy,
  type TdmGhgEstimate,
  type TdmSelection,
} from "./engine";
