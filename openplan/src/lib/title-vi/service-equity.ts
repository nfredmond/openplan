/**
 * Title VI service equity — does transit service differ between an agency's
 * minority / low-income tracts and the rest of its service area?
 *
 * PURE. Facts in, comparison and copy out. No I/O, no clock, no database.
 *
 * ====================================================== WHAT IT WILL NOT DO
 *
 * It does not decide that a disparity IS a disparate impact. That
 * determination belongs to a governing body, on a record that includes public
 * participation and a least-discriminatory-alternative analysis. This module
 * measures a difference and says whether it exceeds the threshold the agency
 * itself adopted. The phrase "disparate impact" appears only as the name of
 * that adopted threshold, never as a conclusion OpenPlan reached.
 *
 * It also refuses rather than estimating. Every input that is missing produces
 * a named refusal with the step that would fix it — because "no data" and "no
 * service" are the two answers a civil-rights finding must never confuse, and
 * an empty result rendered as a finding would read as total service absence in
 * a place that may be well served.
 */

import type { TitleViPolicy } from "./policy";

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One census tract's demographics joined to its service on ONE service day.
 *
 * Counts, never percentages. A share can only be aggregated across tracts as a
 * sum of numerators over a sum of denominators, and every population-weighted
 * figure below depends on holding the raw counts — the same reason
 * `CensusTractData` carries `povertyUniverse` and `raceUniverse`.
 */
export interface TractServiceRow {
  geoid: string;
  /**
   * ACS B01003_001E — everybody who lives here. This is the WEIGHT, and only
   * the weight: how many people a tract's service figure speaks for. It is not
   * a denominator for any share below, because each share's numerator comes
   * from its own ACS table with its own universe.
   */
  populationTotal: number | null;
  /** ACS B03002_003E — white non-Hispanic. Minority = raceUniverse - this. */
  populationWhiteNonHispanic: number | null;
  /**
   * ACS B03002_001E — the universe of the Hispanic-origin-by-race table, and the
   * only denominator for a minority share built from the count above.
   */
  raceUniverse: number | null;
  /** ACS B17001_002E — people below poverty. */
  populationBelowPoverty: number | null;
  /**
   * ACS B17001_001E — the population FOR WHOM POVERTY STATUS IS DETERMINED, and
   * the only denominator for the count above.
   *
   * IT IS NOT `populationTotal`, and the difference decides findings. ACS leaves
   * people in institutionalised group quarters, military barracks and college
   * dormitories out of this universe and counts them in B01003. Dividing by the
   * larger number understates poverty everywhere and understates it enormously
   * in a tract holding a prison, a university or a barracks — moving that tract
   * out of the low-income group, which is the direction that makes a disparity
   * disappear. Null means the tract was loaded before OpenPlan recorded the
   * universe: it is dropped from the low-income comparison and counted, never
   * divided by something else.
   */
  povertyUniverse: number | null;

  /** 0 is a MEASUREMENT of no service; the row's absence upstream is not. */
  stopsInTract: number;
  stopEventsPerDay: number;
  /** null when the tract has no stops at all — never read as a headway of 0. */
  bestPeakHeadwaySeconds: number | null;
  bestSpanSeconds: number | null;
  routesServing: number;
}

export interface ServiceEquityInput {
  serviceDay: string;
  tracts: TractServiceRow[];
  policy: TitleViPolicy;
  /**
   * Whether the tract-service join ever ran for this feed version. False means
   * REFUSE: an empty tract set is otherwise indistinguishable from a finding
   * that nothing is served.
   */
  tractServiceComputed: boolean;
}

/* -------------------------------------------------------------------------- */
/* Measures — and the direction each one improves in                           */
/* -------------------------------------------------------------------------- */

/**
 * THE DIRECTION IS DECLARED, NOT ASSUMED, and this is the sharpest edge in the
 * module. Three of these improve as the number RISES and one improves as it
 * FALLS: a 15-minute headway is better service than a 60-minute one. A
 * comparison that treated "minority tracts have a higher value" as uniformly
 * favourable would report the single worst finding an agency can have — minority
 * areas waiting four times as long — as an advantage.
 */
export type MeasureDirection = "higher_is_better" | "lower_is_better";

export type ServiceMeasureKey =
  | "populationWithAnyService"
  | "stopEventsPerDay"
  | "bestPeakHeadwaySeconds"
  | "bestSpanSeconds"
  | "routesServing";

export interface ServiceMeasureDescriptor {
  key: ServiceMeasureKey;
  label: string;
  unit: string;
  direction: MeasureDirection;
  /**
   * Whether tracts with NO service take part. `populationWithAnyService` is the
   * measure that exists to carry them; a headway comparison cannot include a
   * tract that has no headway, and saying so is why this flag is explicit
   * rather than a filter buried in the reducer.
   */
  includesUnservedTracts: boolean;
}

export const SERVICE_MEASURES: readonly ServiceMeasureDescriptor[] = [
  {
    key: "populationWithAnyService",
    label: "Residents in a tract with any transit stop",
    unit: "% of group",
    direction: "higher_is_better",
    includesUnservedTracts: true,
  },
  {
    key: "stopEventsPerDay",
    label: "Daily stop events available",
    unit: "stop events per day",
    direction: "higher_is_better",
    includesUnservedTracts: true,
  },
  {
    key: "bestPeakHeadwaySeconds",
    label: "Best peak headway in the tract",
    unit: "minutes",
    direction: "lower_is_better",
    includesUnservedTracts: false,
  },
  {
    key: "bestSpanSeconds",
    label: "Longest service span in the tract",
    unit: "hours",
    direction: "higher_is_better",
    includesUnservedTracts: false,
  },
  {
    key: "routesServing",
    label: "Distinct routes serving the tract",
    unit: "routes",
    direction: "higher_is_better",
    includesUnservedTracts: true,
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Output                                                                      */
/* -------------------------------------------------------------------------- */

export type ServiceEquityRefusalCode =
  | "no_adopted_policy"
  | "tract_service_not_computed"
  | "no_tract_coverage"
  | "no_population_measured"
  | "no_comparison_group";

export interface ServiceEquityRefusal {
  code: ServiceEquityRefusalCode;
  /** What was not done, what it does NOT establish, and the next step. */
  message: string;
}

export interface MeasureComparison {
  measure: ServiceMeasureDescriptor;
  /** Population-weighted value for the protected group. Null when unmeasurable. */
  focusValue: number | null;
  /** Population-weighted value for the comparison group. */
  comparisonValue: number | null;
  /**
   * Percentage difference of focus relative to comparison, SIGNED so that a
   * NEGATIVE number always means the focus group is worse off — regardless of
   * which direction the underlying measure improves in.
   */
  relativeDifferencePct: number | null;
  /** Tracts that could not take part, and why, per group. */
  focusTractsCompared: number;
  comparisonTractsCompared: number;
  /**
   * True only when a threshold was adopted AND the focus group is worse off by
   * more than it. Null when no threshold is adopted — a measured difference
   * with nothing to compare it to is reported as a number and named nothing.
   */
  exceedsAdoptedThreshold: boolean | null;
}

export interface GroupProfile {
  /** Tracts classified into this group. */
  tracts: number;
  /** People in them, on the universe the classification used. */
  population: number;
  /** Tracts with no transit stop at all. A measurement, and often the finding. */
  tractsWithNoService: number;
  populationWithNoService: number;
}

export interface ServiceEquityComparison {
  serviceDay: string;
  /** How the classification was made, in the agency's own adopted terms. */
  classificationBasis: string;
  /** The service-area-wide share the classification compared against, when it did. */
  serviceAreaMinoritySharePct: number | null;
  serviceAreaLowIncomeSharePct: number | null;

  minorityFocus: GroupProfile;
  minorityComparison: GroupProfile;
  lowIncomeFocus: GroupProfile;
  lowIncomeComparison: GroupProfile;

  minorityMeasures: MeasureComparison[];
  lowIncomeMeasures: MeasureComparison[];

  /** Tracts excluded from every weighted figure, and why. Counted, never hidden. */
  tractsWithNoPopulationUniverse: number;
  /**
   * Classified tracts absent from the LOW-INCOME comparison only, because they
   * carry no poverty universe. Separate from the count above: those tracts are
   * in every minority figure, and folding the two together would overstate what
   * the low-income half of this comparison covers.
   */
  tractsWithNoPovertyUniverse: number;
  /** Sentences a planner must see alongside any figure above. */
  disclosures: string[];
}

export type ServiceEquityResult =
  | { ok: true; comparison: ServiceEquityComparison }
  | { ok: false; refusal: ServiceEquityRefusal };

/* -------------------------------------------------------------------------- */
/* The computation                                                             */
/* -------------------------------------------------------------------------- */

function minorityPopulation(tract: TractServiceRow): number | null {
  const universe = tract.raceUniverse;
  const white = tract.populationWhiteNonHispanic;
  if (universe === null || white === null || universe <= 0) return null;
  // A race universe smaller than its own white non-Hispanic count is not a reading.
  if (white > universe) return null;
  return universe - white;
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Population-weighted mean of a per-tract value. Null when nothing qualified. */
function weightedMean(
  rows: Array<{ value: number | null; weight: number }>
): { value: number | null; tracts: number } {
  let numerator = 0;
  let denominator = 0;
  let tracts = 0;
  for (const row of rows) {
    if (row.value === null || row.weight <= 0) continue;
    numerator += row.value * row.weight;
    denominator += row.weight;
    tracts += 1;
  }
  if (denominator <= 0) return { value: null, tracts: 0 };
  return { value: numerator / denominator, tracts };
}

function measureValue(
  tract: TractServiceRow,
  key: ServiceMeasureKey
): number | null {
  switch (key) {
    case "populationWithAnyService":
      return tract.stopsInTract > 0 ? 100 : 0;
    case "stopEventsPerDay":
      return tract.stopEventsPerDay;
    case "bestPeakHeadwaySeconds":
      return tract.bestPeakHeadwaySeconds === null
        ? null
        : tract.bestPeakHeadwaySeconds / 60;
    case "bestSpanSeconds":
      return tract.bestSpanSeconds === null ? null : tract.bestSpanSeconds / 3600;
    case "routesServing":
      return tract.routesServing;
  }
}

/**
 * Signed so that NEGATIVE always means the focus group is worse off.
 *
 * For a `higher_is_better` measure that is the ordinary relative difference.
 * For `lower_is_better` the sign is flipped, so a focus group waiting LONGER
 * (a larger headway) reports as a negative — worse — rather than as a gain.
 */
function relativeDifference(
  focus: number | null,
  comparison: number | null,
  direction: MeasureDirection
): number | null {
  if (focus === null || comparison === null) return null;
  if (comparison === 0) {
    // No denominator to be relative to. Reporting Infinity, or 0, would both be
    // claims; absence is the truth and the raw values are still shown.
    return focus === 0 ? 0 : null;
  }
  const raw = ((focus - comparison) / comparison) * 100;
  return round(direction === "lower_is_better" ? -raw : raw);
}

function compareMeasure(
  measure: ServiceMeasureDescriptor,
  focusTracts: Array<{ tract: TractServiceRow; weight: number }>,
  comparisonTracts: Array<{ tract: TractServiceRow; weight: number }>,
  thresholdPct: number | null
): MeasureComparison {
  const eligible = (entries: Array<{ tract: TractServiceRow; weight: number }>) =>
    entries
      .filter((entry) => measure.includesUnservedTracts || entry.tract.stopsInTract > 0)
      .map((entry) => ({ value: measureValue(entry.tract, measure.key), weight: entry.weight }));

  const focus = weightedMean(eligible(focusTracts));
  const comparison = weightedMean(eligible(comparisonTracts));
  const difference = relativeDifference(focus.value, comparison.value, measure.direction);

  return {
    measure,
    focusValue: focus.value === null ? null : round(focus.value),
    comparisonValue: comparison.value === null ? null : round(comparison.value),
    relativeDifferencePct: difference,
    focusTractsCompared: focus.tracts,
    comparisonTractsCompared: comparison.tracts,
    // Only a difference AGAINST the focus group can exceed an equity threshold.
    // A minority group receiving MORE service is not a Title VI finding, and
    // reporting it as one would be the same error as an unsigned comparison.
    exceedsAdoptedThreshold:
      thresholdPct === null || difference === null ? null : difference < 0 && Math.abs(difference) > thresholdPct,
  };
}

function profile(entries: Array<{ tract: TractServiceRow; weight: number }>): GroupProfile {
  let population = 0;
  let tractsWithNoService = 0;
  let populationWithNoService = 0;
  for (const entry of entries) {
    population += entry.weight;
    if (entry.tract.stopsInTract === 0) {
      tractsWithNoService += 1;
      populationWithNoService += entry.weight;
    }
  }
  return {
    tracts: entries.length,
    population,
    tractsWithNoService,
    populationWithNoService,
  };
}

export function compareServiceEquity(input: ServiceEquityInput): ServiceEquityResult {
  const { policy, tracts, serviceDay } = input;

  if (!policy) {
    return {
      ok: false,
      refusal: {
        code: "no_adopted_policy",
        message:
          "No adopted Title VI policy is recorded for this workspace, so there is no threshold to " +
          "measure service against. OpenPlan will not supply one: the minority and low-income " +
          "definitions and the disparate-impact threshold are policy your agency adopts and " +
          "publishes. Record your adopted program to run this analysis.",
      },
    };
  }

  if (!input.tractServiceComputed) {
    return {
      ok: false,
      refusal: {
        code: "tract_service_not_computed",
        message:
          "The tract-level service join has not been run for this feed version, so nothing is known " +
          "about service by tract. This is NOT a finding that tracts have no service. Re-ingest or " +
          "refresh the feed to compute it.",
      },
    };
  }

  if (tracts.length === 0) {
    return {
      ok: false,
      refusal: {
        code: "no_tract_coverage",
        message:
          "No census tracts are loaded for the area this feed covers, so service cannot be compared " +
          "between tracts. This is not a finding that the area has no census tracts — none have been " +
          "fetched. Load tract coverage for the county from the Workspace geography panel on the " +
          "dashboard, then run this again.",
      },
    };
  }

  // A tract needs a race universe to be classified and a head-count to be
  // weighted. Without both it is dropped from every figure and COUNTED, so the
  // analysis can say how much of the service area it could not speak for.
  const usable = tracts.filter(
    (tract) => minorityPopulation(tract) !== null && (tract.populationTotal ?? 0) > 0
  );
  const withNoPopulation = tracts.length - usable.length;

  if (usable.length === 0) {
    return {
      ok: false,
      refusal: {
        code: "no_population_measured",
        message:
          "The census tracts loaded for this area reported no population universe to classify them " +
          "by, so no group could be compared. This is a gap in the demographic data, not a finding " +
          "about service. Tracts loaded before OpenPlan began recording the ACS universes report " +
          "nothing here until the county is loaded again from the Workspace geography panel.",
      },
    };
  }

  // EVERY SHARE IS A SUM OF NUMERATORS OVER A SUM OF ITS OWN UNIVERSE — never
  // over the head-count, and never a mean of per-tract percentages. The two
  // universes are different populations and are summed over different tract
  // sets, because a tract can carry one and not the other.
  const totalMinority = usable.reduce((sum, tract) => sum + (minorityPopulation(tract) ?? 0), 0);
  const totalRaceUniverse = usable.reduce((sum, tract) => sum + (tract.raceUniverse ?? 0), 0);

  const withPovertyUniverse = usable.filter((tract) => (tract.povertyUniverse ?? 0) > 0);
  const withNoPovertyUniverse = usable.length - withPovertyUniverse.length;
  const totalBelowPoverty = withPovertyUniverse.reduce(
    (sum, tract) => sum + (tract.populationBelowPoverty ?? 0),
    0
  );
  const totalPovertyUniverse = withPovertyUniverse.reduce(
    (sum, tract) => sum + (tract.povertyUniverse ?? 0),
    0
  );

  const serviceAreaMinoritySharePct =
    totalRaceUniverse > 0 ? round((totalMinority / totalRaceUniverse) * 100) : null;
  const serviceAreaLowIncomeSharePct =
    totalPovertyUniverse > 0 ? round((totalBelowPoverty / totalPovertyUniverse) * 100) : null;

  const minorityCut =
    policy.minorityDefinitionMethod === "fixed_threshold"
      ? policy.minorityThresholdPct
      : serviceAreaMinoritySharePct;
  const lowIncomeCut =
    policy.lowIncomeDefinitionMethod === "fixed_threshold"
      ? policy.lowIncomeThresholdPct
      : serviceAreaLowIncomeSharePct;

  if (minorityCut === null) {
    return {
      ok: false,
      refusal: {
        code: "no_population_measured",
        message:
          "The loaded tracts reported no race and ethnicity universe to compute a service-area " +
          "average from, so the adopted 'above the service-area average' definition has no value to " +
          "compare tracts to.",
      },
    };
  }

  // A MISSING LOW-INCOME CUT NO LONGER STOPS THE WHOLE ANALYSIS. The two
  // definitions rest on different ACS universes now, so one can be unavailable
  // while the other is fine — and refusing the minority comparison because the
  // poverty universe is missing would withhold a finding that is fully
  // measurable. The low-income half reports as unmeasured and says why.
  const lowIncomeMeasurable = lowIncomeCut !== null;

  const shareOf = (numerator: number | null, universe: number | null): number | null => {
    if (numerator === null || universe === null || universe <= 0) return null;
    return (numerator / universe) * 100;
  };

  const minorityFocusEntries: Array<{ tract: TractServiceRow; weight: number }> = [];
  const minorityComparisonEntries: Array<{ tract: TractServiceRow; weight: number }> = [];
  const lowIncomeFocusEntries: Array<{ tract: TractServiceRow; weight: number }> = [];
  const lowIncomeComparisonEntries: Array<{ tract: TractServiceRow; weight: number }> = [];

  for (const tract of usable) {
    // The weight is people, not a statistical universe: a service figure speaks
    // for everyone who lives in the tract, including the residents of a dormitory
    // or a barracks that the poverty universe leaves out.
    const population = tract.populationTotal ?? 0;

    const share = shareOf(minorityPopulation(tract), tract.raceUniverse);
    if (share !== null && share >= minorityCut) {
      minorityFocusEntries.push({ tract, weight: population });
    } else if (share !== null) {
      minorityComparisonEntries.push({ tract, weight: population });
    }

    // A tract with no poverty universe joins NEITHER low-income group. Treating
    // its missing rate as 0% would file it as comparison — a made-up affluent
    // tract, on the side of the comparison that dilutes a disparity.
    const povertyShare = shareOf(tract.populationBelowPoverty, tract.povertyUniverse);
    if (lowIncomeMeasurable && povertyShare !== null && povertyShare >= (lowIncomeCut as number)) {
      lowIncomeFocusEntries.push({ tract, weight: population });
    } else if (lowIncomeMeasurable && povertyShare !== null) {
      lowIncomeComparisonEntries.push({ tract, weight: population });
    }
  }

  if (
    minorityFocusEntries.length === 0 ||
    minorityComparisonEntries.length === 0
  ) {
    return {
      ok: false,
      refusal: {
        code: "no_comparison_group",
        message:
          "Every loaded tract fell on the same side of the adopted minority definition, so there are " +
          "no two groups to compare. That is a fact about this service area and the adopted " +
          "threshold together, not a finding that service is equitable.",
      },
    };
  }

  const disclosures = [
    "Tracts are matched to the feed's stops by the bounding envelope of every stop in it, which is " +
      "not the agency's adopted service-area boundary and includes area the agency may not serve.",
    "Service figures are population-weighted across tracts and cover the " +
      `${serviceDay} service day only. Service days are never added together — a system with no ` +
      "weekend service is a common finding that a weekly total would erase.",
    "A stop event is one scheduled departure at one stop. A single vehicle passing several stops in " +
      "a tract contributes one event at each, so this measures service intensity at a place rather " +
      "than a count of vehicles.",
  ];

  if (withNoPopulation > 0) {
    disclosures.push(
      `${withNoPopulation} tract${withNoPopulation === 1 ? "" : "s"} in this area reported no ` +
        "population universe and could not be classified or weighted, so no figure here speaks for " +
        "them. Tracts loaded before OpenPlan began recording the ACS universes are counted here " +
        "until the county is loaded again from the Workspace geography panel."
    );
  }

  // THE POVERTY UNIVERSE IS DISCLOSED SEPARATELY FROM THE RACE UNIVERSE, because
  // a tract can carry one and not the other, and a reader who is told only the
  // combined figure would take the low-income comparison to cover ground it does
  // not.
  if (withNoPovertyUniverse > 0) {
    disclosures.push(
      `${withNoPovertyUniverse} of the classified tract${withNoPovertyUniverse === 1 ? "" : "s"} ` +
        "reported no poverty universe — the population ACS determined poverty status for — so " +
        "they are absent from the low-income comparison only. They are NOT counted as being above " +
        "or below the low-income threshold, because a rate divided by the wrong population is not a " +
        "smaller error than no rate at all."
    );
  }

  if (!lowIncomeMeasurable) {
    disclosures.push(
      "No low-income comparison could be made: no loaded tract reported the poverty universe the " +
        "adopted definition needs. The minority comparison above is unaffected."
    );
  }

  const headwayMeasure = SERVICE_MEASURES.find((m) => m.key === "bestPeakHeadwaySeconds");
  if (headwayMeasure) {
    disclosures.push(
      "Headway and span compare only tracts that HAVE service, because a tract with no stops has " +
        "no headway to measure. Tracts with no service are carried by the share-with-any-service " +
        "measure instead, where they are the finding."
    );
  }

  const classificationBasis =
    policy.minorityDefinitionMethod === "fixed_threshold"
      ? `Tracts at or above ${minorityCut}% minority population, the fixed threshold adopted on ${policy.adoptedOn} by ${policy.adoptedBy}.`
      : `Tracts at or above the service-area minority share of ${minorityCut}%, the "above the service-area average" definition adopted on ${policy.adoptedOn} by ${policy.adoptedBy}.`;

  return {
    ok: true,
    comparison: {
      serviceDay,
      classificationBasis,
      serviceAreaMinoritySharePct,
      serviceAreaLowIncomeSharePct,
      minorityFocus: profile(minorityFocusEntries),
      minorityComparison: profile(minorityComparisonEntries),
      lowIncomeFocus: profile(lowIncomeFocusEntries),
      lowIncomeComparison: profile(lowIncomeComparisonEntries),
      minorityMeasures: SERVICE_MEASURES.map((measure) =>
        compareMeasure(
          measure,
          minorityFocusEntries,
          minorityComparisonEntries,
          policy.disparateImpactThresholdPct
        )
      ),
      lowIncomeMeasures: SERVICE_MEASURES.map((measure) =>
        compareMeasure(
          measure,
          lowIncomeFocusEntries,
          lowIncomeComparisonEntries,
          policy.disproportionateBurdenThresholdPct
        )
      ),
      tractsWithNoPopulationUniverse: withNoPopulation,
      tractsWithNoPovertyUniverse: withNoPovertyUniverse,
      disclosures,
    },
  };
}
