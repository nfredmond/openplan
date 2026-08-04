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
 * CCRS geocodes roughly 78% of records statewide. A map is therefore always a
 * subset of what was reported, and saying so is not optional.
 */
export const SAFETY_GEOCODING_CAVEAT =
  "Only crashes with usable coordinates can be mapped. Reported crashes that the source agency did not geolocate are counted in the totals but do not appear on the map.";

/**
 * CCRS `Crashes_*` cannot separate suspected-serious-injury (KABCO A) from
 * other injuries. Until the ExtentOfInjuryCode join lands, nothing in this
 * module may present a KSI ("killed or seriously injured") figure.
 */
export const SAFETY_SEVERITY_COMPLETENESS_CAVEAT =
  "This source distinguishes fatal, injury, and property-damage-only crashes but does not separate suspected serious injuries, so a killed-or-seriously-injured (KSI) total cannot be derived from it.";

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
