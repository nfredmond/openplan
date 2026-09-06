/**
 * Claim boundaries for the Safety module (Wave 8.1).
 *
 * Two variants per concept, following the BCA precedent in
 * `src/lib/bca/parameters.ts:85-99`: a fuller caveat for UI surfaces, and a
 * SINGLE-SENTENCE `*_NARRATIVE_CAVEAT` for AI-drafted prose. The one-sentence
 * rule is load-bearing — a multi-sentence caveat reproduced by a model leaves
 * its trailing sentences uncited and trips the per-sentence grounding validator.
 */

/**
 * Crash records are observed facts, not model output — but "observed" is not
 * the same as "complete", which is what this caveat exists to say.
 */
export const SAFETY_CRASH_DATA_CAVEAT =
  "Crash records are reported collisions retrieved from the source agency, not modeled estimates. Coverage, geocoding completeness, and severity detail vary by source and year — review the coverage summary before relying on any count.";

export const SAFETY_CRASH_DATA_NARRATIVE_CAVEAT =
  "Crash counts reflect reported collisions retrieved from the source agency and may be incomplete for the period shown.";

/**
 * A map is always a subset of what was reported, and saying so is not optional.
 *
 * NO PERCENTAGE APPEARS IN THIS SENTENCE, deliberately. The geocoded share is
 * wildly local: probed 2026-08-11, one state's 2025 file geolocated 77.7% of
 * records statewide and 99.6% in one rural county of it. A constant quoting the
 * statewide figure would describe almost no actual extract correctly, in either
 * direction. Every acquisition already stores its own reported and geocoded
 * counts, so the number a planner sees is computed from THEIR extract — see
 * `describeGeocodingShortfall`.
 */
export const SAFETY_GEOCODING_CAVEAT =
  "Only crashes with usable coordinates can be mapped. Reported crashes that the source agency did not geolocate are counted in the totals but do not appear on the map.";

/**
 * The geocoded share of ONE extract, in a sentence, or null when there is
 * nothing to disclose.
 *
 * Returns null rather than a cheerful "100% mapped" when nothing was dropped:
 * a disclosure that fires on every acquisition trains a reader to skip it, and
 * the fact worth interrupting for is the shortfall.
 *
 * `null` is also the answer when the counts are unusable — a percentage computed
 * from an unreadable denominator is an invented figure, and this module's whole
 * posture is that a number that could not be read is not a number.
 */
export function describeGeocodingShortfall(
  reportedCount: number,
  geocodedCount: number
): string | null {
  if (!Number.isFinite(reportedCount) || !Number.isFinite(geocodedCount)) return null;
  if (reportedCount <= 0 || geocodedCount < 0 || geocodedCount > reportedCount) return null;
  const missing = reportedCount - geocodedCount;
  if (missing <= 0) return null;
  const share = Math.round((geocodedCount / reportedCount) * 1000) / 10;
  return (
    `${missing.toLocaleString()} of the ${reportedCount.toLocaleString()} reported crashes in this ` +
    `retrieval carry no coordinates from the source agency (${share}% were mapped). ` +
    SAFETY_GEOCODING_CAVEAT
  );
}

/**
 * Collisions the source reported while supplying no casualty count at all.
 *
 * The band exists because a missing count used to parse to zero, and zero killed
 * plus zero injured is the definition of property-damage-only — so these were
 * stored, painted and counted as crashes where nobody was hurt. Measured against
 * one state's live 2025 file on 2026-08-11: 4.7% statewide, 9.5% in one rural
 * county. The number has to be visible wherever severity counts are, or the
 * bands quietly fail to add up to the total and a reader fills the gap in with
 * "property damage".
 */
export const SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT =
  "Some reported collisions carry no casualty count from the source agency, so they cannot be placed in a severity band. They are counted in the total and in no severity band — their absence from the fatal, serious, injury and property-damage figures is missing information, not a mild outcome.";

export const SAFETY_UNCLASSIFIED_SEVERITY_NARRATIVE_CAVEAT =
  "Collisions for which the source agency reported no casualty count are counted in the total but placed in no severity band.";

/**
 * Property-damage-only collisions, and why they are off by default.
 *
 * A planner's reason, not a technical one: PDO reporting thresholds vary by
 * agency, by dollar limit, by whether a unit was dispatched, and they drift over
 * time — so PDO counts are not comparable across jurisdictions or years, and a
 * grant reviewer will discount a headline "crashes" number built on them. They
 * are still worth having: PDO is the only stratum dense enough to see a pattern
 * at one intersection over five years, and the benefit-cost screen monetizes a
 * property-damage dimension. So they are included, retrievable, filterable —
 * and off until asked for, with this sentence attached.
 */
export const SAFETY_PDO_COMPARABILITY_CAVEAT =
  "Property-damage-only collisions are reported inconsistently between agencies and over time, so counts including them are not comparable across places or years. They are excluded from these figures until you switch them on.";

/**
 * Use when separately counted serious-injury coverage is absent or unknown.
 * Do not infer which other severity bands the source covers from this gap.
 */
export const SAFETY_SEVERITY_COMPLETENESS_CAVEAT =
  "The recorded source coverage does not establish separately counted suspected serious injuries, so a fatal-or-serious-injury crash count cannot be derived from it.";

/**
 * A fatality census records nothing else. Where the covering source is one
 * (FARS is, nationally), the absence of injury crashes is a property of the
 * source and must never read as a property of the road.
 */
export const SAFETY_FATAL_ONLY_CAVEAT =
  "This source is a fatality census: it records only crashes in which someone was killed. Injury and property-damage collisions are absent from it, so their absence here is not a finding that none occurred.";

/**
 * A live read is not an acquisition, and saying so is not optional.
 *
 * `safety_crashes.source_id` is a closed CHECK domain, so a covering source
 * outside it can be READ but not stored. The crashes are real; what a planner
 * must not assume is that they are now part of the workspace's record, attached
 * to a project, or still here tomorrow.
 */
export const SAFETY_LIVE_READ_CAVEAT =
  "These crashes were read directly from the source agency just now and were not saved into this workspace, so they cannot be attached to a project and will be gone when you leave this page. Retrieve again to bring them back.";

/**
 * The module is a screening aid. It does not produce an adopted plan, and it is
 * not a substitute for an engineering study.
 */
export const SAFETY_SCREENING_CAVEAT =
  "Screening-level safety analysis for internal prioritization and grant-readiness review. It is not an adopted safety plan, a certified analysis, or a substitute for an engineering study.";

export const SAFETY_SCREENING_NARRATIVE_CAVEAT =
  "This is a screening-level safety analysis for grant-readiness review, not an adopted or certified safety plan.";

export const SAFETY_METHOD_CITATION =
  "California Highway Patrol, California Crash Reporting System (CCRS), data.ca.gov (public domain).";

/**
 * Why a selection that is not a whole county counts only the mapped crashes.
 *
 * ═══ WHAT THIS REPLACED, AND WHY IT WAS A REAL DEFECT ═══
 *
 * The sidebar said, to every workspace in the product regardless of where it
 * was:
 *
 *   "Pick a California county to also include reported crashes the source
 *    agency never geolocated."
 *
 * A planner in Columbus, Ohio was instructed to pick a California county. That
 * is a hardcoded jurisdiction in UI copy and it breaks the first product
 * non-negotiable in the way that matters most — not by limiting what OpenPlan
 * can do, but by asserting to a reader that they are somewhere they are not.
 *
 * The CAPABILITY behind it genuinely is source-bound: only a source that
 * publishes a county identifier can return the crashes it never geolocated,
 * because an ungeocoded crash has no coordinates and can never satisfy a
 * bounding-box predicate. The repo's rule for that case is settled — a
 * geographic limit is disclosed, never silently applied, and never stated as
 * though it were universal.
 *
 * ═══ THE MISTAKE THE FIRST DRAFT OF THIS FUNCTION MADE ═══
 *
 * It swapped the hardcoded jurisdiction for a hardcoded CAPABILITY: it named
 * whichever source had answered and told the planner that source "can include
 * those crashes ... for a study area that is one whole county it publishes".
 * `safety-map-first-shell.test.tsx` rendered it against a FARS retrieval and
 * the sentence came out asserting a county-filter capability FARS does not
 * have. Replacing a false statement about WHERE the planner is with a false
 * statement about what the SOURCE can do is not an improvement — it is the same
 * defect wearing the other hat, and it would have shipped if the existing
 * caveat suite had not rendered this branch.
 *
 * So the sentence now asserts only two things, both of which are true wherever
 * it renders: these counts cover the mapped area, and OpenPlan needs a source
 * that publishes a county identifier before it can do better. It promises no
 * particular source anything, and it names no jurisdiction at any point — the
 * source's own label supplies whatever geography belongs in the sentence, and
 * that label comes from the adapter descriptor.
 *
 * `sourceLabel` is null before any source has answered, in which case the
 * crashes are attributed to "the source agency" rather than to a name that
 * would have to be invented.
 */
export function describeUngeocodedCountyOption(sourceLabel: string | null): string {
  const reporter = sourceLabel ?? "the source agency";
  return (
    `Counts for this selection come from the mapped area only, so crashes ${reporter} reported but ` +
    "never geolocated are not among them. OpenPlan can add those unmapped crashes back only where " +
    "the covering source publishes a county identifier it can filter on, and this selection is not " +
    "one of those."
  );
}
