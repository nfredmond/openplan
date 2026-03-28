export const MANAGED_RUN_MODE_KEYS = [
  "deterministic_corridor_v1",
  "aequilibrae",
  "behavioral_demand",
] as const;

export type ManagedRunModeKey = (typeof MANAGED_RUN_MODE_KEYS)[number];

export type ManagedRunModeDefinition = {
  key: ManagedRunModeKey;
  label: string;
  shortLabel: string;
  launchLabel: string;
  engineLabel: string;
  summaryDetail: string;
  runtimeExpectation: string;
  caveatSummary: string;
  comparisonMessage: string;
  availability: "launchable" | "prototype";
};

export const MANAGED_RUN_MODE_DEFINITIONS: ManagedRunModeDefinition[] = [
  {
    key: "deterministic_corridor_v1",
    label: "Deterministic Corridor",
    shortLabel: "Deterministic Corridor",
    launchLabel: "Deterministic Corridor (Synchronous)",
    engineLabel: "Deterministic Corridor",
    summaryDetail: "Original synchronous corridor analysis path.",
    runtimeExpectation: "Usually returns in the current request cycle for corridor-scale queries.",
    caveatSummary: "Deterministic scorecard output, not a worker-backed network assignment or behavioral model.",
    comparisonMessage: "Comparison is based on the existing deterministic analysis scorecard and map posture.",
    availability: "launchable",
  },
  {
    key: "aequilibrae",
    label: "Fast Screening",
    shortLabel: "Fast Screening",
    launchLabel: "Fast Screening (AequilibraE worker prototype)",
    engineLabel: "Fast Screening",
    summaryDetail: "Worker-backed AequilibraE screening lane for assignment and accessibility review.",
    runtimeExpectation: "Expected runtime is on the order of minutes and completes asynchronously through the worker queue.",
    caveatSummary: "Screening-grade prototype output. Do not treat it as behavioral demand or forecast-ready calibration.",
    comparisonMessage: "Direct KPI comparison is available when both runs register comparable screening KPIs.",
    availability: "launchable",
  },
  {
    key: "behavioral_demand",
    label: "Behavioral Demand",
    shortLabel: "Behavioral Demand",
    launchLabel: "Behavioral Demand (ActivitySim prototype / preflight-backed)",
    engineLabel: "Behavioral Demand",
    summaryDetail: "Planner-facing ActivitySim-backed run class with prototype/preflight status messaging.",
    runtimeExpectation:
      "Expected runtime is materially longer than screening, often tens of minutes to hours once a full ActivitySim runtime is enabled.",
    caveatSummary:
      "Current OpenPlan posture is prototype/preflight-backed only. Do not read this as calibrated behavioral forecasting, county-transferable validation, or client-ready demand prediction.",
    comparisonMessage:
      "Comparison surfaces behavioral artifacts and KPI summaries when present. Where the prototype lane only reaches preflight or partial ingestion, comparison stays caveated instead of implying full run-to-run parity.",
    availability: "prototype",
  },
];

export function isManagedRunModeKey(value: string | null | undefined): value is ManagedRunModeKey {
  return MANAGED_RUN_MODE_KEYS.includes(value as ManagedRunModeKey);
}

export function getManagedRunModeDefinition(runModeKey: string | null | undefined): ManagedRunModeDefinition {
  return (
    MANAGED_RUN_MODE_DEFINITIONS.find((definition) => definition.key === runModeKey) ?? {
      key: "deterministic_corridor_v1",
      label: runModeKey
        ? runModeKey
            .split(/[_-]+/)
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ")
        : "Unknown mode",
      shortLabel: "Unknown mode",
      launchLabel: "Unknown mode",
      engineLabel: "Unknown mode",
      summaryDetail: "Planner-facing metadata has not been registered for this run mode yet.",
      runtimeExpectation: "Runtime expectation unavailable.",
      caveatSummary: "Interpret outputs conservatively until the run mode is documented.",
      comparisonMessage: "Comparison posture is unavailable for this run mode.",
      availability: "prototype",
    }
  );
}

export function getBehavioralDemandDefaultCaveats(): string[] {
  return [
    "Behavioral demand is currently surfaced as a prototype/preflight-backed lane.",
    "Do not present this as calibrated behavioral forecasting or client-ready demand prediction.",
    "County-specific prototype artifacts or partial ingestion outputs may exist without a full ActivitySim runtime success.",
  ];
}
