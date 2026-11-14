/**
 * Crash evidence → BCA screening suggestion (pure).
 *
 * A PROJECTION, NOT A SECOND SOURCE OF TRUTH. This file used to hold its own
 * ingest type, its own severity-count type, its own citation sentence and its
 * own caveat list — a second, parallel copy of what `crash-evidence.ts` now
 * declares once for each surface citing observed collision records. It has been
 * reduced to what is genuinely BCA-specific: folding the neutral severity bands
 * onto the three dimensions `src/lib/bca/parameters.ts` monetizes, dividing by
 * the year span, and saying the two things a benefit-cost reader in particular
 * must be told.
 *
 * WHAT REMAINS BCA-SPECIFIC, and why each is a refusal rather than a feature:
 *
 *   1. OBSERVED IS NOT AVOIDED. The screening input is the annual crashes a
 *      countermeasure is expected to AVOID. This offers the observed annual
 *      frequency as the ceiling for that judgement and says so every time.
 *      Nothing here estimates an avoided count; that is the analyst's call and a
 *      plausible machine-authored figure would be indistinguishable from a
 *      correct one on a screening sheet.
 *   2. NOTHING IS OFFERED WHEN THERE IS NOTHING HONEST TO OFFER. A non-ready
 *      acquisition, a zero-crash acquisition, an acquisition whose counts could
 *      not be read, and an acquisition whose stored collisions are ALL
 *      unclassified each return null. Null means "offer nothing"; it never means
 *      "suggest zeros". Zeros in a benefit-cost screen are not a neutral
 *      default — they are the claim that the road is safe.
 *
 * The severe-injury band folds into the single non-fatal `injury` dimension
 * because that is the dimension the monetization defaults carry. The `unknown`
 * band folds into NOTHING: a collision the source gave no casualty count for
 * cannot be assigned a monetized outcome, and it is disclosed instead.
 */

import {
  safetyEvidenceSeriousInjury,
  totalCountedCrashes,
  type SafetyCrashEvidence,
} from "./crash-evidence";
import { countermeasureListStatus, getSafetyCountermeasure } from "./countermeasures";
import type { CrashSeverity } from "./sources/types";

export type BcaCrashInputSuggestion = {
  /**
   * Observed ANNUAL AVERAGE crash frequencies by BCA dimension, over the
   * acquisition's distinct requested years. Severe-injury rows fold into
   * `injury` because the screen (like the monetization defaults) carries a
   * single non-fatal injury dimension.
   */
  suggestedInputs: {
    fatal: number;
    injury: number;
    propertyDamageOnly: number;
  };
  /** Names the source, the reported-vs-geocoded counts, the years, and the ingest id. */
  citationText: string;
  caveats: string[];
};

/** The sentence that must appear on every suggestion. Exported so a test can pin its presence, not its prose. */
export const BCA_OBSERVED_IS_NOT_AVOIDED_CAVEAT =
  "These are observed annual crash frequencies from the linked acquisition, not crashes avoided. The screening input is the annual crashes a countermeasure is expected to avoid, which the operator must judge (the observed figures are a ceiling, not that estimate).";

function roundAnnual(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Project one acquisition's evidence onto the BCA's crash dimensions, or return
 * null when there is nothing honest to suggest.
 *
 * Takes the shared `SafetyCrashEvidence` rather than an ingest row plus counts:
 * the citation and the coverage caveats then travel with the numbers by
 * construction, and there is no arrangement of arguments that produces a figure
 * without its provenance.
 */
export function buildBcaCrashInputSuggestion(
  evidence: SafetyCrashEvidence
): BcaCrashInputSuggestion | null {
  if (evidence.status !== "ready") return null;
  if (evidence.reportedTotal <= 0) return null;

  const counts = evidence.severityCounts;
  // A failed count read is not "no crashes". Rendering zeros here would put a
  // lookup failure into a benefit-cost screening as an observed safety record.
  if (!counts) return null;

  // The three monetized dimensions. `unknown` is deliberately excluded: it is
  // the band for a collision the source supplied no casualty count for, and
  // assigning it an outcome is inventing one. An acquisition whose stored
  // collisions are ALL unknown therefore falls out here with null rather than
  // with three zeros.
  const monetizableTotal = counts.fatal + counts.severe_injury + counts.injury + counts.pdo;
  if (monetizableTotal <= 0) return null;

  const yearSpan = Math.max(1, evidence.years.length);

  const suggestedInputs = {
    fatal: roundAnnual(counts.fatal / yearSpan),
    injury: roundAnnual((counts.severe_injury + counts.injury) / yearSpan),
    propertyDamageOnly: roundAnnual(counts.pdo / yearSpan),
  };

  // The BCA-specific sentence first, then every disclosure the acquisition
  // already carries. One caveat vocabulary for the whole module — a second
  // wording of "some of these were not geocoded" is how two screens end up
  // quoting different shortfalls for the same retrieval.
  const caveats: string[] = [BCA_OBSERVED_IS_NOT_AVOIDED_CAVEAT];

  if (evidence.mappedTotal < evidence.reportedTotal) {
    caveats.push(
      `Severity is only known for the ${evidence.mappedTotal.toLocaleString("en-US")} of ${evidence.reportedTotal.toLocaleString("en-US")} reported crashes that carry coordinates, so these frequencies understate the reported burden.`
    );
  }

  if (evidence.unclassifiedCount !== null && evidence.unclassifiedCount > 0) {
    const total = totalCountedCrashes(counts) ?? 0;
    caveats.push(
      `${evidence.unclassifiedCount.toLocaleString("en-US")} of the ${total.toLocaleString("en-US")} stored collisions carry no casualty count from the source, so they appear in none of the three frequencies above. Those three do not add up to the acquisition's total, and the missing rows are unknown outcomes rather than property damage.`
    );
  }

  const seriousInjury = safetyEvidenceSeriousInjury(evidence);
  if (!seriousInjury.separable) {
    caveats.push(`${seriousInjury.statement} OpenPlan could not separate them, so serious injuries are folded into the injury dimension.`);
  }

  if (evidence.truncated) {
    caveats.push(
      "Retrieval stopped at the record cap, so the underlying extract is a partial slice of the study area."
    );
  }

  return { suggestedInputs, citationText: evidence.citationText, caveats };
}

// ─── Treated segments of a saved safety plan ────────────────────────────────
//
// The benefit-cost workbench offers the crashes recorded on the segments a
// planner treated in a saved safety plan. Recorded counts only: the crash
// modification factor, the persons basis and the dollar values stay the
// planner's inputs, and nothing enters an analysis until the planner adds it.

/** One stored crash as the treated-segment read selects it. */
export type BcaSegmentCrash = {
  id: string;
  longitude: number;
  latitude: number;
  severity: CrashSeverity;
  collisionYear: number | null;
  /** People killed, or null when the source supplied no count. */
  killedCount: number | null;
};

type BcaTreatedSegmentYear = {
  year: number;
  fatalCrashes: number;
  /** Null when the source does not record serious injuries. Never 0 for unknown. */
  seriousInjuryCrashes: number | null;
};

type BcaTreatedSegmentBase = {
  segmentId: string;
  segmentLabel: string;
  /** `listStatus` is null for an item on FHWA's list. */
  countermeasures: Array<{ id: string; name: string; cmfNote: string; listStatus: string | null }>;
};

/** A treated segment whose crashes were placed and counted. */
export type BcaCountedSegment = BcaTreatedSegmentBase & {
  status: "counted";
  years: BcaTreatedSegmentYear[];
  fatalCrashes: number;
  seriousInjuryCrashes: number | null;
  /** People killed in the fatal crashes, or null when any fatal crash has no count. */
  fatalities: number | null;
  /** Fatal crashes whose source gave no count of people killed. */
  fatalCrashesWithoutPersonCount: number;
};

/**
 * A treated segment that no stored crash lands on under the current road lines.
 * A segment enters a plan from the ranking, so it held at least one counted
 * crash when it was saved. None now means the segments were cut differently
 * (grid squares before road lines were stored, or road lines stored again),
 * not that the road had no crashes. No count is offered.
 */
export type BcaUnresolvedSegment = BcaTreatedSegmentBase & { status: "unresolved"; reason: string };

export type BcaTreatedSegment = BcaCountedSegment | BcaUnresolvedSegment;

export const BCA_UNRESOLVED_SEGMENT_REASON =
  "This segment no longer matches the road lines stored for the project, so its crashes cannot be counted here. That is not zero crashes. Open Safety and save the countermeasures again.";

/**
 * What the source says about serious injuries. `not_in_source`: it records
 * fatal crashes only. `not_separated`: it records injury crashes but does not
 * separate the serious ones. Neither is zero.
 */
export type BcaSeriousInjuryCoverage = "counted" | "not_in_source" | "not_separated";

export type BcaSafetyPlanOffer =
  | {
      status: "ready";
      reportId: string;
      reportTitle: string;
      ingestId: string;
      sourceId: string | null;
      sourceLabel: string;
      /** The acquisition's severity coverage sentence. */
      coverage: string;
      /** Requested years the counts cover, ascending. */
      years: number[];
      seriousInjury: BcaSeriousInjuryCoverage;
      caveats: string[];
      segments: BcaTreatedSegment[];
    }
  | { status: "unavailable"; reportId: string; reportTitle: string; ingestId: string; reason: string };

export type BcaSafetyEvidenceRead =
  /** `plansNotShown`: saved plans beyond the newest ones listed. */
  | { status: "read"; plans: BcaSafetyPlanOffer[]; plansNotShown: number }
  | { status: "failed" };

/**
 * Count the crashes placed on each treated segment by severity and year.
 * `placements` maps crash id to segment id, from `placeHighInjuryNetworkCrashes`.
 * Only the treated segments are counted; crashes on other segments and crashes
 * outside the requested years are left out. A treated segment that no crash is
 * placed on is returned unresolved, never as zero.
 */
export function summarizeBcaTreatedSegments(input: {
  attachments: ReadonlyArray<{ segmentId: string; segmentLabel: string; countermeasureIds: readonly string[] }>;
  crashes: readonly BcaSegmentCrash[];
  placements: ReadonlyMap<string, string>;
  seriousInjuryCounted: boolean;
  years: readonly number[];
}): BcaTreatedSegment[] {
  const years = Array.from(new Set(input.years)).sort((a, b) => a - b);
  const requested = new Set(years);
  const segmentsWithCrashes = new Set(input.placements.values());
  return input.attachments.map((attachment): BcaTreatedSegment => {
    const base = {
      segmentId: attachment.segmentId,
      segmentLabel: attachment.segmentLabel,
      countermeasures: attachment.countermeasureIds.flatMap((id) => {
        const entry = getSafetyCountermeasure(id);
        if (!entry) return [];
        return [{
          id,
          name: entry.name,
          cmfNote: entry.cmf
            ? `Catalog CMF ${entry.cmf.value} for ${entry.cmf.appliesTo}, CMF Clearinghouse ID ${entry.cmf.cmfId}.`
            : entry.cmfNote ?? "[VERIFY] No crash modification factor cited.",
          listStatus: countermeasureListStatus(entry),
        }];
      }),
    };
    if (!segmentsWithCrashes.has(attachment.segmentId)) {
      return { ...base, status: "unresolved", reason: BCA_UNRESOLVED_SEGMENT_REASON };
    }
    const byYear = new Map(years.map((year) => [year, { fatal: 0, serious: 0 }]));
    let fatalities = 0;
    let withoutCount = 0;
    for (const crash of input.crashes) {
      if (input.placements.get(crash.id) !== attachment.segmentId) continue;
      if (crash.collisionYear === null || !requested.has(crash.collisionYear)) continue;
      const tally = byYear.get(crash.collisionYear)!;
      if (crash.severity === "fatal") {
        tally.fatal += 1;
        if (crash.killedCount === null) withoutCount += 1;
        else fatalities += crash.killedCount;
      } else if (crash.severity === "severe_injury" && input.seriousInjuryCounted) {
        tally.serious += 1;
      }
    }
    const rows = years.map((year) => ({
      year,
      fatalCrashes: byYear.get(year)!.fatal,
      seriousInjuryCrashes: input.seriousInjuryCounted ? byYear.get(year)!.serious : null,
    }));
    return {
      ...base,
      status: "counted",
      years: rows,
      fatalCrashes: rows.reduce((sum, row) => sum + row.fatalCrashes, 0),
      seriousInjuryCrashes: input.seriousInjuryCounted
        ? rows.reduce((sum, row) => sum + (row.seriousInjuryCrashes ?? 0), 0)
        : null,
      fatalities: withoutCount > 0 ? null : fatalities,
      fatalCrashesWithoutPersonCount: withoutCount,
    };
  });
}
