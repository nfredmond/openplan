/**
 * WHAT A ZONE SYSTEM CAN AND CANNOT SUPPORT — the diagnostic that explains a
 * failed validation instead of leaving a planner to conclude the model is wrong.
 *
 * ====================================================== WHY THIS EXISTS
 *
 * A trip whose origin and destination fall in the SAME zone never touches the
 * network. The model has no idea which streets it used, because at this
 * resolution there are no streets inside a zone — there is one centroid and a
 * connector. So an intrazonal trip contributes to VMT and to mode share, and
 * contributes NOTHING to any link.
 *
 * That is not a defect. It is what zones are. It becomes a problem only when
 * somebody compares modelled link volumes to traffic counts and reads the gap as
 * "the model is wrong about demand".
 *
 * MEASURED IN OPENPLAN'S OWN VALIDATION WORK, and this is the evidence the
 * thresholds below rest on: a county run with a 26-tract zone system produced
 * **36% intrazonal trips**, and link-level AADT comparison failed. The demand
 * was not the problem and neither were the gateways — better than a third of all
 * travel was invisible to the network by construction. Nothing in the product
 * said so, so the only available conclusion was that the model had failed.
 *
 * ============================================ WHOSE JUDGEMENT THE BANDS ARE
 *
 * THEY ARE OPENPLAN'S OWN SCREENING HEURISTIC. They are not a professional
 * standard, not a published threshold, and not something an agency adopted —
 * the same posture the Title VI proxy thresholds take, and for the same reason:
 * a number OpenPlan chose is indistinguishable, on a page a planner shows a
 * board, from one a standards body published. Every verdict below says which it
 * is, and none of them says a model is wrong.
 *
 * What they DO say is what a comparison can establish. That is a claim about
 * method, which is a claim OpenPlan is entitled to make.
 */

/** How much of a run's travel never reaches the network. */
export type ZoneResolutionBand = "fine" | "workable" | "coarse" | "very_coarse";

export type ZoneResolutionDiagnostic = {
  /** Zones the study area was divided into. */
  zoneCount: number;
  /** Trips counted. */
  tripCount: number;
  /** Trips whose origin and destination zone are the same. */
  intrazonalTripCount: number;
  /** Those as a percentage, rounded to one decimal. Null when no trips ran. */
  intrazonalSharePct: number | null;
  band: ZoneResolutionBand | null;
  /**
   * Whether comparing modelled link volumes to observed counts can establish
   * anything about this model. False does NOT mean the model is wrong — it
   * means that particular test cannot answer the question.
   */
  supportsLinkLevelValidation: boolean;
  /** What a planner should be told, in their own terms. */
  summary: string;
};

/**
 * The bands, and what each one licenses.
 *
 * The boundaries are round numbers on purpose: a diagnostic whose thresholds
 * look precise invites being read as calibrated, and these are judgement.
 */
const BANDS: ReadonlyArray<{
  band: ZoneResolutionBand;
  /** Applies when the intrazonal share is at or below this. */
  maxSharePct: number;
  supportsLinkLevelValidation: boolean;
  describe: (sharePct: string, zoneCount: number) => string;
}> = [
  {
    band: "fine",
    maxSharePct: 10,
    supportsLinkLevelValidation: true,
    describe: (share, zones) =>
      `${share}% of trips begin and end in the same zone across ${zones} zones, so almost all travel ` +
      `reaches the network. Comparing modelled link volumes to traffic counts is a meaningful test of ` +
      `this run.`,
  },
  {
    band: "workable",
    maxSharePct: 20,
    supportsLinkLevelValidation: true,
    describe: (share, zones) =>
      `${share}% of trips begin and end in the same zone across ${zones} zones and never touch the ` +
      `network. Link-level comparison to counts is still informative, but expect modelled volumes to ` +
      `sit below observed counts by roughly that share before any other explanation is needed.`,
  },
  {
    band: "coarse",
    maxSharePct: 30,
    supportsLinkLevelValidation: false,
    describe: (share, zones) =>
      `${share}% of trips begin and end in the same zone across ${zones} zones, so that share of all ` +
      `travel is invisible to every link by construction. Comparing modelled link volumes to traffic ` +
      `counts cannot establish whether this model is right — the gap it would show is mostly the zone ` +
      `system, not the demand. Use trip totals, mode share and VMT, which do count intrazonal travel, ` +
      `or split the zone system finer and run again.`,
  },
  {
    band: "very_coarse",
    maxSharePct: Number.POSITIVE_INFINITY,
    supportsLinkLevelValidation: false,
    describe: (share, zones) =>
      `${share}% of trips begin and end in the same zone across ${zones} zones. More than a third of ` +
      `all travel never reaches a link, which is the situation OpenPlan's own county validation hit ` +
      `at 26 zones and 36% — link-level comparison to counts failed there for this reason and not ` +
      `because of the demand. Treat link volumes as unvalidatable at this resolution. Trip totals, ` +
      `mode share and VMT remain usable; a finer zone system is what would make link comparison mean ` +
      `something.`,
  },
];

/** One decimal, as a string, so 36 reads as "36.0" beside "36.4". */
function formatShare(sharePct: number): string {
  return sharePct.toFixed(1);
}

/**
 * Measure how much of a run's travel never reaches the network.
 *
 * PURE. Trips in, diagnostic out — no database, no clock. `zoneCount` is passed
 * rather than derived from the trips, because a zone with no trips in it is
 * still a zone and still coarsens nothing; deriving it from the trip table
 * would silently report a smaller, flattering system.
 */
export function diagnoseZoneResolution(
  trips: ReadonlyArray<{ origin_taz: string; dest_taz: string }>,
  zoneCount: number
): ZoneResolutionDiagnostic {
  const tripCount = trips.length;
  const intrazonalTripCount = trips.filter((trip) => trip.origin_taz === trip.dest_taz).length;

  if (tripCount === 0) {
    return {
      zoneCount,
      tripCount: 0,
      intrazonalTripCount: 0,
      intrazonalSharePct: null,
      band: null,
      supportsLinkLevelValidation: false,
      // No trips is not a fine-grained zone system; it is nothing to measure.
      // Reporting `fine` here would be the most flattering possible answer to a
      // run that produced no travel at all.
      summary:
        "This run produced no trips, so nothing can be said about how much travel reaches the " +
        "network or about what a link-level comparison would establish.",
    };
  }

  const rawSharePct = (intrazonalTripCount / tripCount) * 100;
  const intrazonalSharePct = Math.round(rawSharePct * 10) / 10;
  const matched = BANDS.find((entry) => intrazonalSharePct <= entry.maxSharePct) ?? BANDS[BANDS.length - 1];

  return {
    zoneCount,
    tripCount,
    intrazonalTripCount,
    intrazonalSharePct,
    band: matched.band,
    supportsLinkLevelValidation: matched.supportsLinkLevelValidation,
    summary: matched.describe(formatShare(intrazonalSharePct), zoneCount),
  };
}

/**
 * The sentence that must travel with any link-level count comparison made
 * against a run this diagnostic says cannot support one.
 *
 * Separate from `summary` because it is addressed to a different moment: the
 * summary explains a zone system, this explains a comparison somebody is
 * looking at right now.
 */
export const LINK_VALIDATION_NOT_SUPPORTED_CAVEAT =
  "At this zone resolution a large share of trips never reaches a link, so a gap between modelled " +
  "volumes and observed counts is expected and is not evidence about the model's demand. This " +
  "banding is OpenPlan's own screening heuristic, not an adopted standard.";
