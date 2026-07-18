// TDM (transportation demand management) strategy catalog.
//
// Clean re-implementation of the 14-strategy catalog in transitscore-3d's
// `lib/tdmCalculations.ts` (TDM_PROGRAMS). Deliberate departures from the
// harvest:
//   - No `enabled` field — that was UI state baked into catalog data. UI
//     selection state belongs to the caller (see `TdmSelection` in engine.ts).
//   - Per-strategy `sourceNote` replaces the harvest's uncited "CARB
//     guidelines" claim. The percentages are screening defaults informed by
//     general TDM literature; they have NOT been verified against CAPCOA's
//     Handbook for Analyzing GHG Mitigation Measures (2021) — no measure IDs
//     or page numbers are cited because none were verified. Confirm
//     measure-specific values before CEQA or grant use.
//
// This is static reference data, not project-specific effectiveness. The
// combination math lives in `engine.ts`.

export type TdmStrategyCategory = "infrastructure" | "pricing" | "programs" | "policy";

export interface TdmStrategy {
  /** Stable unique key for the catalog entry. */
  key: string;
  /** Strategy name as an operator would track it. */
  name: string;
  /** Short description of what the measure entails. */
  description: string;
  category: TdmStrategyCategory;
  /**
   * Screening-level default VMT reduction, in percentage points of the
   * project's baseline VMT. Callers may override per selection.
   */
  defaultVmtReductionPct: number;
  /**
   * Whether the strategy is a genuine VMT-reduction measure. False for
   * emissions-side measures (e.g. ev-charging) whose effect on VMT is
   * negligible — the engine stays permissive and will still combine them,
   * but consumers offering VMT-reduction pickers should filter on this flag.
   */
  countsTowardVmt: boolean;
  /** Honest provenance note — where the default comes from and how to verify it. */
  sourceNote: string;
}

const CAPCOA_SCREENING_SOURCE_NOTE =
  "Screening default informed by general TDM literature; not verified against CAPCOA's Handbook for Analyzing GHG Mitigation Measures (2021) — confirm the measure-specific value before CEQA or grant use.";

export const TDM_STRATEGY_CATALOG: readonly TdmStrategy[] = [
  // -- infrastructure -------------------------------------------------------
  {
    key: "bike-parking",
    name: "Secure Bike Parking & Lockers",
    description: "Covered, secure bike parking with showers/lockers",
    category: "infrastructure",
    defaultVmtReductionPct: 3.5,
    countsTowardVmt: true,
    sourceNote: CAPCOA_SCREENING_SOURCE_NOTE,
  },
  {
    key: "bike-share",
    name: "On-Site Bike Share Station",
    description: "Subsidized bike share membership for residents",
    category: "infrastructure",
    defaultVmtReductionPct: 2.5,
    countsTowardVmt: true,
    sourceNote: CAPCOA_SCREENING_SOURCE_NOTE,
  },
  {
    key: "ev-charging",
    name: "EV Charging Stations",
    description: "Level 2 EV charging for 20% of parking spaces",
    category: "infrastructure",
    defaultVmtReductionPct: 1.0,
    countsTowardVmt: false,
    sourceNote:
      "Emissions-side measure, not a VMT measure: EV charging lowers CO2e per mile driven, and its effect on VMT is negligible. The 1.0% default is inherited from the harvest catalog for parity only — do not count it as a VMT reduction in CEQA or grant analysis.",
  },
  {
    key: "car-share",
    name: "Car Share Program",
    description: "On-site car share spaces (Zipcar, Gig, etc.)",
    category: "infrastructure",
    defaultVmtReductionPct: 4.0,
    countsTowardVmt: true,
    sourceNote: CAPCOA_SCREENING_SOURCE_NOTE,
  },
  // -- pricing --------------------------------------------------------------
  {
    key: "unbundled-parking",
    name: "Unbundled Parking",
    description: "Parking sold/rented separately from units",
    category: "pricing",
    defaultVmtReductionPct: 5.0,
    countsTowardVmt: true,
    sourceNote: CAPCOA_SCREENING_SOURCE_NOTE,
  },
  {
    key: "transit-subsidy",
    name: "Transit Pass Subsidy",
    description: "Free or subsidized transit passes for residents",
    category: "pricing",
    defaultVmtReductionPct: 6.5,
    countsTowardVmt: true,
    sourceNote: CAPCOA_SCREENING_SOURCE_NOTE,
  },
  {
    key: "parking-cashout",
    name: "Parking Cash-Out",
    description: "Cash payment option instead of parking space",
    category: "pricing",
    defaultVmtReductionPct: 4.5,
    countsTowardVmt: true,
    sourceNote: CAPCOA_SCREENING_SOURCE_NOTE,
  },
  // -- programs -------------------------------------------------------------
  {
    key: "carpool-program",
    name: "Carpool/Vanpool Program",
    description: "Ridematching and preferential parking",
    category: "programs",
    defaultVmtReductionPct: 3.0,
    countsTowardVmt: true,
    sourceNote: CAPCOA_SCREENING_SOURCE_NOTE,
  },
  {
    key: "telecommute",
    name: "Telecommute Support",
    description: "Encourage 1-2 days/week remote work",
    category: "programs",
    defaultVmtReductionPct: 4.0,
    countsTowardVmt: true,
    sourceNote: CAPCOA_SCREENING_SOURCE_NOTE,
  },
  {
    key: "guaranteed-ride",
    name: "Guaranteed Ride Home",
    description: "Emergency rides for transit/bike commuters",
    category: "programs",
    defaultVmtReductionPct: 2.0,
    countsTowardVmt: true,
    sourceNote: CAPCOA_SCREENING_SOURCE_NOTE,
  },
  {
    key: "flexible-hours",
    name: "Flexible Work Hours",
    description: "Staggered schedules to avoid peak traffic",
    category: "programs",
    defaultVmtReductionPct: 2.5,
    countsTowardVmt: true,
    sourceNote: CAPCOA_SCREENING_SOURCE_NOTE,
  },
  // -- policy ---------------------------------------------------------------
  {
    key: "reduced-parking",
    name: "Reduced Parking Ratio",
    description: "0.5-0.75 spaces per unit (below code minimum)",
    category: "policy",
    defaultVmtReductionPct: 7.0,
    countsTowardVmt: true,
    sourceNote: CAPCOA_SCREENING_SOURCE_NOTE,
  },
  {
    key: "transit-oriented",
    name: "Transit-Oriented Design",
    description: "Ground-floor retail, pedestrian-friendly design",
    category: "policy",
    defaultVmtReductionPct: 5.5,
    countsTowardVmt: true,
    sourceNote: CAPCOA_SCREENING_SOURCE_NOTE,
  },
  {
    key: "complete-streets",
    name: "Complete Streets Features",
    description: "Sidewalks, crosswalks, bike lanes in development",
    category: "policy",
    defaultVmtReductionPct: 3.5,
    countsTowardVmt: true,
    sourceNote: CAPCOA_SCREENING_SOURCE_NOTE,
  },
];

export function getTdmStrategy(key: string): TdmStrategy | null {
  return TDM_STRATEGY_CATALOG.find((strategy) => strategy.key === key) ?? null;
}
