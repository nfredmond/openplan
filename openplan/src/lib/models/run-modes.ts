export const MANAGED_RUN_MODE_KEYS = [
  "deterministic_corridor_v1",
  "aequilibrae",
  "behavioral_demand",
  "sketch_abm",
  "ite_trip_generation",
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
  // "launchable" = a full run. "preflight" — shown to planners as a "readiness
  // check" — is launchable, but produces an honest input-validation / model-prep
  // check, never a forecast (the UI badges it distinctly). "prototype" = shown
  // but launch disabled. These token values are API strings; do not rename them.
  availability: "launchable" | "prototype" | "preflight";
};

export const MANAGED_RUN_MODE_DEFINITIONS: ManagedRunModeDefinition[] = [
  {
    key: "deterministic_corridor_v1",
    label: "Deterministic Corridor",
    shortLabel: "Deterministic Corridor",
    launchLabel: "Deterministic Corridor (returns right away)",
    engineLabel: "Deterministic Corridor",
    summaryDetail: "The original corridor scorecard. Runs inside OpenPlan and returns right away.",
    runtimeExpectation: "Results usually appear in seconds for a corridor-scale study area.",
    caveatSummary: "A rules-based scorecard — not a network assignment and not a travel-behavior model.",
    comparisonMessage: "Comparison uses the deterministic scorecard and its map results.",
    availability: "launchable",
  },
  {
    key: "aequilibrae",
    label: "Fast Screening",
    shortLabel: "Fast Screening",
    launchLabel: "Fast Screening (prototype)",
    engineLabel: "Fast Screening",
    summaryDetail: "Screening-grade traffic assignment and accessibility review, run by AequilibraE outside this app.",
    runtimeExpectation: "Keeps working after you leave the page — expect results in a few minutes.",
    caveatSummary: "Screening-grade prototype output. Do not treat it as behavioral demand or forecast-ready calibration.",
    comparisonMessage: "Direct KPI comparison is available when both runs report comparable screening KPIs.",
    availability: "launchable",
  },
  {
    key: "behavioral_demand",
    label: "Behavioral Demand",
    shortLabel: "Behavioral Demand",
    launchLabel: "Behavioral Demand (readiness check — not a forecast)",
    engineLabel: "Behavioral Demand",
    summaryDetail: "Backed by ActivitySim. Launching checks your inputs and prepares the model — it does not produce a behavioral forecast.",
    runtimeExpectation:
      "The readiness check finishes in a few minutes and keeps working after you leave the page. A calibrated behavioral run takes materially longer (tens of minutes to hours) and needs a dedicated modeling computer.",
    caveatSummary:
      "Launching this checks inputs and prepares the ActivitySim model — it is NOT a behavioral forecast. Do not read readiness-check or uncalibrated output as calibrated behavioral forecasting, county-transferable validation, or client-ready demand prediction.",
    comparisonMessage:
      "Comparison shows behavioral outputs and KPI summaries when a run produced them. A run that only reached the readiness check or partial data ingestion is labeled that way — never shown as if it were a complete run.",
    availability: "preflight",
  },
  {
    key: "sketch_abm",
    label: "Sketch Activity Model",
    shortLabel: "Sketch Activity Model",
    launchLabel: "Sketch Activity Model (runs in this app)",
    engineLabel: "Sketch Activity Model",
    summaryDetail:
      "Runs inside this app: a sketch activity-based model over a synthetic population and distance-based screening skims.",
    runtimeExpectation:
      "Runs inside this app and usually finishes in seconds for corridor-scale study areas.",
    // The ~56% figure lives HERE, in the engine's own caveat, rather than in any
    // one surface that happens to cite this engine. It is a fact about the
    // engine, so it must travel with the engine everywhere the caveat renders —
    // reports, comparison boards, the runs API, and RTP citations alike. It was
    // previously hardcoded inside the RTP citation warning, which meant the one
    // concrete, decision-relevant number about this model reached exactly one
    // page.
    caveatSummary:
      "Screening-grade sketch output over a synthetic population and distance-based skims. In validation its VMT ran roughly 56% below the CARB reference. Do not treat it as a validated travel model, calibrated behavioral demand, or forecast-ready prediction.",
    comparisonMessage:
      "Comparison is limited to screening-grade sketch KPIs. Treat cross-run deltas as exploratory scenario contrasts, not calibrated run-to-run parity.",
    availability: "launchable",
  },
  {
    key: "ite_trip_generation",
    label: "Trip Generation (ITE-style)",
    shortLabel: "Trip Generation",
    launchLabel: "Trip Generation (screening worksheet — runs in this app)",
    engineLabel: "Trip Generation",
    summaryDetail:
      "Runs inside this app: average-rate trip generation over a scenario entry's land-use program, with a rate-based VMT screen.",
    runtimeExpectation: "Runs inside this app and finishes in under a second.",
    caveatSummary:
      "Screening-level trip-generation worksheet using published public-agency reference rates. NOT a traffic impact study and NOT a CEQA §15064.3 VMT determination; its rate-based VMT never feeds the CEQA screen. Verify rates against the locally adopted or licensed manual before regulatory, funding, or design use.",
    comparisonMessage:
      "Comparison is limited to screening-grade trip-generation KPIs saved as scenario comparison snapshots. Treat deltas as exploratory program contrasts, not modeled forecasts.",
    availability: "launchable",
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
      summaryDetail: "OpenPlan does not have a description for this run mode yet.",
      runtimeExpectation: "How long it takes is not known.",
      caveatSummary: "Interpret outputs conservatively until the run mode is documented.",
      comparisonMessage: "No comparison guidance is available for this run mode.",
      availability: "prototype",
    }
  );
}

export function getBehavioralDemandDefaultCaveats(): string[] {
  return [
    "Behavioral demand is a prototype: launching it runs a readiness check, not a forecast.",
    "Do not present this as calibrated behavioral forecasting or client-ready demand prediction.",
    "Partial county outputs may exist even where no full ActivitySim run ever succeeded.",
  ];
}
