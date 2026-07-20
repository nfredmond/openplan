/**
 * M6 — default trip-generation rate table for the sketch trip-generation engine.
 *
 * SOURCE (deliberately NOT the paid, copyrighted ITE Trip Generation Manual):
 * these driveway rates are transcribed from the City of San Diego *Trip
 * Generation Manual* (San Diego Municipal Code, Land Development Code), Revised
 * May 2003, Table 1 — whose rates are in turn based on SANDAG "Traffic
 * Generators" (San Diego Association of Governments, Dec. 1996 / Jul. 1998). That
 * document is published free to the public by a public agency, which is why it —
 * not the licensed ITE manual — backs OpenPlan's shipped defaults.
 *
 * These are SCREENING reference rates for a California context. They are fully
 * OVERRIDABLE per program: an operator with a locally-adopted or licensed rate
 * manual should replace them. Peak-hour figures are expressed as the published
 * "% of daily" volume with an inbound share derived from the published IN:OUT
 * ratio (e.g. AM "8% (2:8)" → amPeakShareOfDaily 0.08, amInboundShare 0.2).
 */

export const ITE_RATE_SOURCE =
  "City of San Diego, Trip Generation Manual (Municipal Code, Land Development Code), Rev. May 2003, Table 1 — driveway rates based on SANDAG \"Traffic Generators\" (1996/1998). Public-agency reference; screening use only — verify against the locally adopted or current licensed rate manual before any regulatory, funding, or design use.";

/** How a land use's quantity is measured. `ksf` = per 1,000 sq ft gross floor area. */
export const TRIP_GEN_UNIT_BASES = ["dwelling_unit", "ksf", "room"] as const;
export type TripGenUnitBasis = (typeof TRIP_GEN_UNIT_BASES)[number];

export const TRIP_GEN_UNIT_LABELS: Record<TripGenUnitBasis, string> = {
  dwelling_unit: "dwelling units",
  ksf: "1,000 sq ft (gross)",
  room: "rooms",
};

export type TripGenRate = {
  /** Stable key an operator/program references. */
  key: string;
  landUse: string;
  unitBasis: TripGenUnitBasis;
  /** Daily driveway vehicle trip-ends per unit. */
  dailyTripsPerUnit: number;
  /** AM peak-hour trips as a share (0–1) of the daily total. */
  amPeakShareOfDaily: number;
  /** Inbound share (0–1) of the AM peak-hour trips (outbound = 1 − this). */
  amInboundShare: number;
  pmPeakShareOfDaily: number;
  pmInboundShare: number;
};

/**
 * A compact, representative default set spanning the common project types
 * (residential, office, retail, industrial, lodging). Every value is transcribed
 * from the cited May-2003 table; see ITE_RATE_SOURCE.
 */
export const DEFAULT_TRIP_GEN_RATES: readonly TripGenRate[] = [
  // ── Residential (per dwelling unit) ──
  { key: "single_family_detached", landUse: "Single-family detached home", unitBasis: "dwelling_unit", dailyTripsPerUnit: 10, amPeakShareOfDaily: 0.08, amInboundShare: 0.2, pmPeakShareOfDaily: 0.1, pmInboundShare: 0.7 },
  { key: "multifamily_low_density", landUse: "Multi-family (under 20 du/acre)", unitBasis: "dwelling_unit", dailyTripsPerUnit: 8, amPeakShareOfDaily: 0.08, amInboundShare: 0.2, pmPeakShareOfDaily: 0.1, pmInboundShare: 0.7 },
  { key: "multifamily_high_density", landUse: "Multi-family (over 20 du/acre)", unitBasis: "dwelling_unit", dailyTripsPerUnit: 6, amPeakShareOfDaily: 0.08, amInboundShare: 0.2, pmPeakShareOfDaily: 0.09, pmInboundShare: 0.7 },
  // ── Office (per 1,000 sq ft) ──
  { key: "office_single_tenant", landUse: "Office (single-tenant / corporate HQ)", unitBasis: "ksf", dailyTripsPerUnit: 10, amPeakShareOfDaily: 0.15, amInboundShare: 0.9, pmPeakShareOfDaily: 0.15, pmInboundShare: 0.1 },
  { key: "office_government", landUse: "Government / civic office (<100k sq ft)", unitBasis: "ksf", dailyTripsPerUnit: 20, amPeakShareOfDaily: 0.09, amInboundShare: 0.9, pmPeakShareOfDaily: 0.12, pmInboundShare: 0.3 },
  { key: "medical_office", landUse: "Medical / dental office", unitBasis: "ksf", dailyTripsPerUnit: 50, amPeakShareOfDaily: 0.06, amInboundShare: 0.8, pmPeakShareOfDaily: 0.1, pmInboundShare: 0.3 },
  // ── Retail / commercial (per 1,000 sq ft GLA) ──
  { key: "retail_neighborhood", landUse: "Neighborhood shopping center", unitBasis: "ksf", dailyTripsPerUnit: 120, amPeakShareOfDaily: 0.04, amInboundShare: 0.6, pmPeakShareOfDaily: 0.11, pmInboundShare: 0.5 },
  { key: "retail_community", landUse: "Community shopping center", unitBasis: "ksf", dailyTripsPerUnit: 70, amPeakShareOfDaily: 0.03, amInboundShare: 0.6, pmPeakShareOfDaily: 0.1, pmInboundShare: 0.5 },
  { key: "supermarket", landUse: "Supermarket", unitBasis: "ksf", dailyTripsPerUnit: 150, amPeakShareOfDaily: 0.04, amInboundShare: 0.7, pmPeakShareOfDaily: 0.1, pmInboundShare: 0.5 },
  // ── Industrial (per 1,000 sq ft) ──
  { key: "industrial_business_park", landUse: "Industrial / business park", unitBasis: "ksf", dailyTripsPerUnit: 16, amPeakShareOfDaily: 0.12, amInboundShare: 0.8, pmPeakShareOfDaily: 0.12, pmInboundShare: 0.2 },
  { key: "manufacturing", landUse: "Manufacturing / assembly", unitBasis: "ksf", dailyTripsPerUnit: 4, amPeakShareOfDaily: 0.2, amInboundShare: 0.9, pmPeakShareOfDaily: 0.2, pmInboundShare: 0.2 },
  { key: "warehousing", landUse: "Warehousing", unitBasis: "ksf", dailyTripsPerUnit: 5, amPeakShareOfDaily: 0.15, amInboundShare: 0.7, pmPeakShareOfDaily: 0.16, pmInboundShare: 0.4 },
  // ── Lodging (per room) ──
  { key: "hotel", landUse: "Hotel", unitBasis: "room", dailyTripsPerUnit: 10, amPeakShareOfDaily: 0.06, amInboundShare: 0.6, pmPeakShareOfDaily: 0.08, pmInboundShare: 0.6 },
] as const;

export const DEFAULT_TRIP_GEN_RATE_BY_KEY: ReadonlyMap<string, TripGenRate> = new Map(
  DEFAULT_TRIP_GEN_RATES.map((rate) => [rate.key, rate])
);
