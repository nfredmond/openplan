/**
 * E5c — the JOINT representativeness reading: what the ecological (E5b, ACS,
 * area-based) screen and the k-anonymized self-reported respondent demographics
 * (E5a) say when read against each other, instead of side by side and silent.
 *
 * WHY A JOINT READING AT ALL. The two screens fail in opposite directions, and
 * that is the whole value. The ecological screen can only observe TRACTS, so its
 * "residents of color are under-represented" is an inference about places
 * projected onto people — the textbook ecological fallacy. The self-reported
 * screen observes PEOPLE, but only the ones who volunteered an answer, and only
 * after k-anonymity has blurred the small cells. Read alone, each one is easy to
 * over-read. Read together, one of them can sometimes refute the other, and the
 * campaign page, reports and (eventually) grant narratives should carry that
 * refutation rather than the more alarming half.
 *
 * ─── WHY THIS DIMENSION, AND ONLY THIS ONE ────────────────────────────────────
 *
 * The two vocabularies barely touch. The ecological screen speaks ACS: residents
 * of color, residents below poverty, zero-vehicle households, transit commuters.
 * The self-reported side speaks survey: age band, primary language, housing
 * tenure, race/ethnicity. Exactly ONE pair names the same underlying population
 * on both sides — race/ethnicity ↔ the ACS "residents of color" metric — and
 * this module compares that pair and nothing else.
 *
 * The pairs deliberately NOT made, so a later reader does not "fix" the gap:
 *   • housing tenure ↔ zero-vehicle households. Both are household-level and
 *     both correlate with need, but renting and not owning a car are different
 *     facts. Aligning them would invent an equivalence, not discover one.
 *   • primary language ↔ residents of color. Language spoken at home is not
 *     race or ethnicity, and `CensusTractData` carries no language field anyway.
 *   • age band ↔ anything. There is no ACS age metric in this screen at all.
 *   • below poverty / transit commuters ↔ anything. The survey never asks about
 *     income or commute mode, and inferring either from the answers it does
 *     collect would be a fabrication.
 * Adding a genuinely new comparable dimension means adding a real ACS field to
 * `CensusTractData` AND a real survey question — not loosening a definition here.
 *
 * ─── WHY A FLOOR AND NOT A SHARE ──────────────────────────────────────────────
 *
 * The k-anon aggregate (`engagement_demographics_summary`, migration
 * 20260719000094) publishes band counts, floors every published cell at 5,
 * collapses the rest into a `suppressed` bucket — and DROPS that bucket entirely
 * when its own residual is under 5. So the published bands for a dimension do
 * not sum to the number of respondents who answered it, and that number is never
 * published. A percentage computed by dividing bands by their own sum would be
 * wrong by an unknown amount, always upward. `demographics-panel.tsx` already
 * refuses to render a race percentage for exactly this reason, and this module
 * does not quietly overrule it.
 *
 * What IS rigorous is a LOWER BOUND, built so that every source of uncertainty
 * pushes it down rather than up:
 *   • numerator = the single largest published band that unambiguously means
 *     "not White alone, non-Hispanic". Race/ethnicity is multi-select, so the
 *     number of DISTINCT respondents in the union of those bands is at least the
 *     largest one — never less.
 *   • denominator = respondents who shared ANY demographics (the `__meta__`
 *     total), which is a superset of those who answered race. A larger
 *     denominator makes the quotient smaller.
 *   • bands that cannot be mapped are simply left out of the numerator, which
 *     can only lower the bound.
 *
 * The consequence is an ASYMMETRIC test, and it must be stated rather than
 * papered over: a floor at or above the area's own share can REBUT an ecological
 * under-representation flag, because we then know the respondents themselves did
 * not fit the inference drawn from their tracts. A floor below the area's share
 * proves nothing at all — the true share could be anywhere above it. Suppression
 * destroys information in one direction, so this screen can only ever exonerate,
 * never convict.
 *
 * ─── WHY `mena` IS NOT COUNTED ────────────────────────────────────────────────
 *
 * The baseline this floor is compared against is `pctMinority`, which
 * `data-sources/census.ts` derives as (B03002_001E − B03002_003E) / B03002_001E:
 * everyone who is not White alone, not Hispanic. ACS currently codes Middle
 * Eastern / North African respondents who report White alone within B03002_003E,
 * so counting the survey's `mena` band toward "residents of color" would compare
 * two different definitions of the same words. `other` and `prefer_not_to_say`
 * are unresolvable in either direction. All three are disclosed as excluded
 * rather than silently folded in.
 */

import {
  DEMOGRAPHICS_SCREENING_CAVEAT,
  type DemographicsSummary,
  type RaceEthnicity,
  type SelfReportedDemographicsSource,
} from "@/lib/engagement/demographics";
import {
  REPRESENTATIVENESS_SCREENING_CAVEAT,
  type CampaignRepresentativeness,
  type RepresentativenessMetric,
  type RepresentativenessMetricKey,
  type StudyAreaSource,
} from "@/lib/engagement/representativeness";

export const JOINT_REPRESENTATIVENESS_CAVEAT =
  "A cross-check between two screening signals, not a representativeness finding. The area-based screen infers context from geography; the self-reported figure is a k-anonymized floor over a self-selected subset of a self-selected sample. Neither establishes that engagement was representative, and neither supports a civil-rights determination.";

/** The one ecological metric with a self-reported counterpart. */
export const JOINT_ECOLOGICAL_METRIC_KEY: RepresentativenessMetricKey = "minority";

/** The one self-reported dimension with an ecological counterpart. */
export const JOINT_SELF_REPORTED_DIMENSION = "race_ethnicity" as const;

/**
 * Self-reported categories that unambiguously fall OUTSIDE the ACS
 * "White alone, not Hispanic" universe the baseline subtracts. Only these feed
 * the floor's numerator.
 */
export const FLOOR_COUNTED_BANDS: readonly RaceEthnicity[] = ["ai_an", "asian", "black", "hispanic", "nhpi"];

/**
 * Self-reported categories deliberately left out of the numerator: `mena`
 * because ACS counts it within White alone (see the module note), `other` and
 * `prefer_not_to_say` because they resolve to neither side. `white` is the
 * complement rather than an exclusion, so it is not listed here.
 */
export const FLOOR_UNMAPPABLE_BANDS: readonly RaceEthnicity[] = ["mena", "other", "prefer_not_to_say"];

const DIMENSION_RATIONALE =
  "Race / ethnicity is the only dimension the two screens both name: the ACS metric is everyone who is not White alone, non-Hispanic, and the survey asks the respondent directly. Age, primary language and housing tenure have no ACS counterpart in this screen, and poverty, zero-vehicle and transit have no survey counterpart — so none of those are compared.";

export type JointReading =
  /** Neither screen has anything to say yet. */
  | "no_signal"
  /** The k-anon aggregate could not be READ — an absence here is a failure, not an answer. */
  | "self_reported_unreadable"
  /** Only the area-based screen is available. Says nothing about the respondents themselves. */
  | "ecological_only"
  /** Only the self-reported floor is available — no area share to compare it against. */
  | "self_reported_only"
  /** The floor clears the area's own share of residents of color. */
  | "floor_at_or_above_area"
  /** The floor is below the area's share — which, being a floor, settles nothing. */
  | "floor_below_area";

/**
 * The one-line name for each reading. Exported from the module that defines the
 * readings so the campaign panel and the report markup label a reading the same
 * way. A planner who reads "inconclusive" on screen must not find "below the
 * area share" in the packet they hand a funder — the same computation has to
 * arrive under the same name wherever it is carried.
 */
export const JOINT_READING_LABELS: Record<JointReading, string> = {
  no_signal: "No signal yet",
  self_reported_unreadable: "Self-reported side could not be read",
  ecological_only: "Area-based screening only",
  self_reported_only: "Self-reported only — no area baseline",
  floor_at_or_above_area: "Self-reported floor at or above the area share",
  floor_below_area: "Self-reported floor below the area share — inconclusive",
};

export type JointEcologicalSide = {
  status: RepresentativenessMetric["status"];
  /** Study-area population-weighted ACS share of residents of color (0–100). */
  areaBaselinePct: number | null;
  /** Respondent-tract-weighted share implied by where comments came from (0–100). */
  respondentAreaPct: number | null;
  representationRatio: number | null;
  /** Approved, geolocated comments the screen considered. */
  locatedRespondentCount: number;
  /** Of those, how many landed inside a study-area tract. */
  mappedRespondentCount: number;
  tractCount: number;
  studyAreaSource: StudyAreaSource;
  computedAt: string;
};

export type JointSelfReportedSide = {
  /**
   * LOWER BOUND (0–100) on the share of demographics-sharing respondents who
   * reported at least one category ACS counts outside White-alone-non-Hispanic.
   * Never a share — see the module note.
   */
  floorPct: number;
  /** Numerator: the largest single published counted band. */
  floorRespondentCount: number;
  /** Denominator: respondents who shared any demographics at all. */
  denominatorRespondents: number;
  /** Which band the numerator came from, for disclosure. */
  floorBandLabel: string;
  /** Every counted band actually published, largest first. */
  countedBandLabels: string[];
  /** Published bands deliberately left out of the numerator. */
  unmappableBandLabels: string[];
  /** True when race/ethnicity cells were collapsed into `suppressed`. */
  suppressionApplied: boolean;
};

export type JointRepresentativeness = {
  dimension: {
    key: "residents_of_color";
    label: string;
    ecologicalMetricKey: RepresentativenessMetricKey;
    selfReportedDimension: typeof JOINT_SELF_REPORTED_DIMENSION;
    /** Carried with the result so no downstream reader has to guess what was aligned. */
    rationale: string;
  };
  ecological: JointEcologicalSide | null;
  selfReported: JointSelfReportedSide | null;
  reading: JointReading;
  /**
   * True ONLY when the self-reported floor clears the area share AND the
   * area-based screen flagged this dimension under-represented. This is the one
   * conclusion the pair supports that neither half supports alone.
   */
  rebutsAreaFlag: boolean;
  /** Present only on `self_reported_unreadable`; the database's own message. */
  readFailureMessage: string | null;
  headline: string;
  /** What this reading cannot say. Always non-empty. */
  limits: string[];
  /**
   * Every caveat that applies to the numbers actually carried. Structurally
   * guaranteed to contain DEMOGRAPHICS_SCREENING_CAVEAT whenever `selfReported`
   * is non-null, so a k-anonymized figure cannot travel without its suppression
   * note.
   */
  caveat: string;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function ecologicalSide(cached: CampaignRepresentativeness | null): JointEcologicalSide | null {
  if (!cached) return null;
  const metric = cached.metrics.find((candidate) => candidate.key === JOINT_ECOLOGICAL_METRIC_KEY);
  if (!metric) return null;
  return {
    status: metric.status,
    areaBaselinePct: metric.baselinePct,
    respondentAreaPct: metric.respondentPct,
    representationRatio: metric.representationRatio,
    locatedRespondentCount: cached.locatedRespondentCount,
    mappedRespondentCount: cached.respondentCount,
    tractCount: cached.tractCount,
    studyAreaSource: cached.studyAreaSource,
    computedAt: cached.computedAt,
  };
}

/**
 * The conservative floor described in the module note, or null when the
 * published aggregate cannot support one.
 */
export function selfReportedFloor(summary: DemographicsSummary): JointSelfReportedSide | null {
  const denominatorRespondents = summary.respondentsWithDemographics;
  if (!(denominatorRespondents > 0)) return null;

  const bands = summary.dimensions[JOINT_SELF_REPORTED_DIMENSION];
  if (bands.length === 0) return null;

  const counted = bands
    .filter((band) => (FLOOR_COUNTED_BANDS as readonly string[]).includes(band.band))
    .filter((band) => band.count > 0)
    .sort((a, b) => b.count - a.count);
  if (counted.length === 0) return null;

  const largest = counted[0];
  // A band larger than the respondent total means the aggregate contradicts
  // itself (a dimension cannot have more answerers than respondents). Clamping
  // would publish a number derived from data we know is wrong, so refuse the
  // floor entirely and let the reading degrade to "no self-reported side".
  if (largest.count > denominatorRespondents) return null;

  return {
    floorPct: round1((largest.count / denominatorRespondents) * 100),
    floorRespondentCount: largest.count,
    denominatorRespondents,
    floorBandLabel: largest.label,
    countedBandLabels: counted.map((band) => band.label),
    unmappableBandLabels: bands
      .filter((band) => (FLOOR_UNMAPPABLE_BANDS as readonly string[]).includes(band.band))
      .map((band) => band.label),
    suppressionApplied: bands.some((band) => band.band === "suppressed"),
  };
}

function pct(value: number): string {
  return `${round1(value)}%`;
}

/**
 * Why there is no self-reported half, in words that are true of THIS campaign.
 *
 * The readings that lack a floor used to say "no respondent has shared
 * demographics" for every one of these cases at once. That sentence is FALSE the
 * moment respondents answered but their answers carry no ACS counterpart — a
 * campaign whose race cells were all suppressed, or all White, or all in the
 * categories ACS counts differently, has respondents who plainly did share, and
 * the demographics panel immediately below on the same page lists the very
 * answers the headline denies. "Nothing comparable was published" and "nobody
 * answered" are different facts about a community, and only one of them is
 * usually true.
 */
function selfReportedAbsenceClause(source: SelfReportedDemographicsSource): string {
  switch (source.state) {
    case "not_collected":
      return "This campaign is not collecting respondent demographics";
    case "not_loaded":
      return "Respondent demographics were not loaded for this view";
    case "unreadable":
      // `self_reported_unreadable` writes its own headline; this arm exists so a
      // future state cannot fall through into a sentence about respondents.
      return "Respondent demographics could not be read";
    case "loaded":
      return source.summary.hasAny || source.summary.respondentsWithDemographics > 0
        ? "Respondents did share demographics, but nothing in the published race / ethnicity categories can be compared against the ACS metric"
        : "No respondent has shared demographics for this campaign";
  }
}

function buildHeadline(input: {
  reading: JointReading;
  ecological: JointEcologicalSide | null;
  selfReported: JointSelfReportedSide | null;
  comparableBaselinePct: number | null;
  rebutsAreaFlag: boolean;
  selfReportedAbsence: string;
}): string {
  const { reading, ecological, selfReported, comparableBaselinePct, rebutsAreaFlag, selfReportedAbsence } = input;

  const floorClause = selfReported
    ? `At least ${selfReported.floorRespondentCount} of the ${selfReported.denominatorRespondents} respondent${
        selfReported.denominatorRespondents === 1 ? "" : "s"
      } who shared demographics (${pct(selfReported.floorPct)} or more) reported a race or ethnicity ACS counts as a resident of color`
    : "";

  switch (reading) {
    case "no_signal":
      return `No representativeness signal yet. The area-based screening has not been computed. ${selfReportedAbsence}. So this campaign has nothing to read either way — that is an absence of evidence, not evidence about who was reached.`;

    case "self_reported_unreadable":
      return ecological
        ? "Self-reported respondent demographics could not be read, so only the area-based screening is shown below. Treat the self-reported side as unknown, not as empty."
        : "Neither screening could be shown: self-reported respondent demographics could not be read, and no area-based screening has been computed. Nothing below is a finding about who was reached.";

    case "ecological_only":
      return `Area-based screening only. ${selfReportedAbsence}, so nothing here describes the people who actually responded — this says who the tracts around them look like, not who they are.`;

    case "self_reported_only":
      return `${floorClause}. There is no ACS baseline for this area to compare that against, so it does not establish that the campaign reached the community — only what the respondents who answered reported.`;

    case "floor_at_or_above_area": {
      const clearsArea = `${floorClause} — at or above the area's own ${pct(comparableBaselinePct ?? 0)}.`;
      if (rebutsAreaFlag) {
        return `${clearsArea} The area-based screening flagged residents of color as under-represented, but that flag is inferred from the tracts comments came from; the respondents we hold individual answers for do not fit it.`;
      }
      // "Both agree" is only true when the area-based screen actually resolved a
      // direction. With too few tracts or no mapped respondents it resolved
      // nothing, and claiming agreement would borrow confidence from a screen
      // that declined to answer.
      if (!ecological || ecological.status === "insufficient") {
        return `${clearsArea} The area-based screening could not resolve a direction for this dimension, so that comparison stands on its own.`;
      }
      return `${clearsArea} Both screenings point the same way on this one dimension.`;
    }

    case "floor_below_area":
      return `${floorClause}, below the area's ${pct(
        comparableBaselinePct ?? 0
      )}. Because suppression makes that a floor rather than a share, it cannot establish under-representation — it only fails to rule it out.`;
  }
}

function buildLimits(input: {
  ecological: JointEcologicalSide | null;
  selfReported: JointSelfReportedSide | null;
  reading: JointReading;
}): string[] {
  const { ecological, selfReported, reading } = input;
  const limits: string[] = [
    "Only race / ethnicity is compared. Age, primary language and housing tenure have no ACS counterpart in this screen, and poverty, zero-vehicle and transit have no self-reported counterpart — this reading says nothing about those.",
  ];

  if (selfReported) {
    limits.push(
      "The self-reported figure is a floor, not a share: k-anonymity suppresses cells under 5 and drops a residual under 5 entirely, so the number of respondents behind the race/ethnicity question is never published."
    );
    limits.push(
      "Race / ethnicity is multi-select, so the floor counts only the single largest qualifying category and understates any respondent who selected several."
    );
    if (selfReported.unmappableBandLabels.length > 0) {
      limits.push(
        `Not counted toward the floor: ${selfReported.unmappableBandLabels.join(
          ", "
        )}. ACS counts Middle Eastern / North African within White alone, and the remaining categories resolve to neither side.`
      );
    }
    if (selfReported.suppressionApplied) {
      limits.push(
        "Some race / ethnicity cells were collapsed into a suppressed bucket, so categories with fewer than five respondents are not visible here at all."
      );
    }
  }

  if (ecological && selfReported) {
    limits.push(
      `The two screenings describe different groups: the area-based figures cover ${ecological.mappedRespondentCount} geolocated respondent${
        ecological.mappedRespondentCount === 1 ? "" : "s"
      }, the self-reported floor covers ${selfReported.denominatorRespondents} respondent${
        selfReported.denominatorRespondents === 1 ? "" : "s"
      } who chose to answer. Neither is a sample of the other.`
    );
  }

  if (reading === "floor_below_area") {
    limits.push(
      "A floor below the area share is not a finding of under-representation. The true share could be anywhere above the floor."
    );
  }

  if (reading === "self_reported_unreadable") {
    limits.push(
      "The self-reported side is unknown here because a read failed — it must not be reported as an absence of respondent demographics."
    );
  }

  return limits;
}

/**
 * Read the two representativeness screens against each other.
 *
 * Degrades in both directions on purpose: a campaign with no self-reported
 * demographics never renders as unrepresentative, and one with no ACS baseline
 * never renders as representative. Neither side is mutated — the ecological
 * result's own `underRepresented` flags are reported unchanged, because a
 * cross-check may add context to a screening flag but may not widen or retract it.
 */
export function buildJointRepresentativeness(input: {
  ecological: CampaignRepresentativeness | null;
  selfReported: SelfReportedDemographicsSource;
}): JointRepresentativeness {
  const ecological = ecologicalSide(input.ecological);
  const selfReported =
    input.selfReported.state === "loaded" ? selfReportedFloor(input.selfReported.summary) : null;

  // A zero baseline is ambiguous — it means either "no residents of color in
  // this area" or "ACS returned nothing", and `buildRepresentativeness` already
  // refuses to divide by it. Comparing a floor against it would manufacture a
  // pass out of missing data, so it is treated as no baseline at all.
  const comparableBaselinePct =
    ecological && ecological.areaBaselinePct !== null && ecological.areaBaselinePct > 0
      ? ecological.areaBaselinePct
      : null;

  let reading: JointReading;
  if (input.selfReported.state === "unreadable") {
    reading = "self_reported_unreadable";
  } else if (selfReported && comparableBaselinePct !== null) {
    // Compare the UNROUNDED quotient, not the display value. `floorPct` is
    // rounded to a tenth for rendering, and rounding is the one source of
    // uncertainty in this module that can move the number UP — a true floor of
    // 29.96% against a 30% baseline would otherwise display as 30% and buy a
    // rebuttal it did not earn. The whole design rests on the floor only ever
    // being understated, so the decision boundary uses the raw ratio.
    const exactFloorPct = (selfReported.floorRespondentCount / selfReported.denominatorRespondents) * 100;
    reading = exactFloorPct >= comparableBaselinePct ? "floor_at_or_above_area" : "floor_below_area";
  } else if (selfReported) {
    reading = "self_reported_only";
  } else if (ecological) {
    reading = "ecological_only";
  } else {
    reading = "no_signal";
  }

  const rebutsAreaFlag = reading === "floor_at_or_above_area" && ecological?.status === "under";

  const caveats = [JOINT_REPRESENTATIVENESS_CAVEAT];
  if (ecological) caveats.push(REPRESENTATIVENESS_SCREENING_CAVEAT);
  // Unconditional whenever a k-anonymized number is carried: the suppression
  // note is part of the number, not decoration attached to it downstream.
  if (selfReported) caveats.push(DEMOGRAPHICS_SCREENING_CAVEAT);

  return {
    dimension: {
      key: "residents_of_color",
      label: "Residents of color",
      ecologicalMetricKey: JOINT_ECOLOGICAL_METRIC_KEY,
      selfReportedDimension: JOINT_SELF_REPORTED_DIMENSION,
      rationale: DIMENSION_RATIONALE,
    },
    ecological,
    selfReported,
    reading,
    rebutsAreaFlag,
    readFailureMessage:
      input.selfReported.state === "unreadable" ? input.selfReported.message : null,
    headline: buildHeadline({
      reading,
      ecological,
      selfReported,
      comparableBaselinePct,
      rebutsAreaFlag,
      selfReportedAbsence: selfReportedAbsenceClause(input.selfReported),
    }),
    limits: buildLimits({ ecological, selfReported, reading }),
    caveat: caveats.join(" "),
  };
}

/**
 * Whether this reading is worth rendering at all. `no_signal` is silence — a
 * campaign that has computed nothing and collected nothing should not carry a
 * panel saying so twice. Every other reading, including the read failure, has
 * something the planner needs to see.
 */
export function jointReadingIsPresentable(joint: JointRepresentativeness): boolean {
  return joint.reading !== "no_signal";
}
