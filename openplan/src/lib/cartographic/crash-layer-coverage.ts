/**
 * What the shared map's crash layer must say about itself.
 *
 * WHICH CRASH PIPELINE THIS LAYER READS, AND WHY. There are three crash lanes
 * in the platform and they answer different questions:
 *
 *   1. `safety_crashes` — collisions a workspace has deliberately ACQUIRED for a
 *      study area, with an `safety_crash_ingests` row recording what the source
 *      reported vs. what it could geolocate. Persisted, workspace-scoped,
 *      restricted by CHECK to persistable adapters (today: CCRS).
 *   2. `fetchCrashesForBbox` (`src/lib/data-sources/crashes.ts`) — a LIVE
 *      multi-source read for one bounding box at one moment, used by the Explore
 *      corridor scorecard and the crash points it paints. Never persisted, and
 *      allowed to use read-only adapters (FARS) the database will not store.
 *   3. The old `fars-estimate` fabricator, deleted in Wave 8.2.
 *
 * The shared cartographic layer reads (1). Three reasons, in order of weight:
 *
 *   * THE BACKDROP HAS NO STUDY AREA TO ASK ABOUT. Every `/api/map-features/*`
 *     route is a parameterless, workspace-scoped fetch fired on `(app)`
 *     navigation. A live read needs a bbox; the only bbox available would be
 *     whatever the camera happens to show, so the answer would change on every
 *     pan. "How many crashes are in this corridor?" would then have a different
 *     answer depending on how the map was framed, which is precisely the
 *     disagreement a shared layer exists to remove.
 *   * IT IS THE WORKSPACE'S OWN RECORD. Every other layer on this backdrop draws
 *     the workspace's work — its projects, corridors, RTP cycle, engagement,
 *     aerial missions. Acquired crashes are that; live source output is not.
 *     Agreement with the Safety module is then structural: same table, same
 *     workspace scope, so the two surfaces cannot report different totals.
 *   * COST. A live read pages a public agency API. Explore does it once per
 *     analysis run on purpose; doing it on every navigation is a different
 *     thing entirely.
 *
 * The layer therefore CANNOT agree numerically with Explore, and pretending
 * otherwise would be the dishonesty. Explore asks "what does the source say
 * about this box right now"; this layer answers "what has this workspace
 * acquired". The notes below say which question is being answered, so a planner
 * comparing the two surfaces is told why they differ instead of discovering it.
 *
 * COVERAGE IS NOT NATIONAL AND MUST NOT LOOK NATIONAL. The crash registry is
 * state-scoped for anything storable: an Ohio workspace has no acquirable crash
 * source at all. An empty crash layer there must read as "no source covers you",
 * never as "no crashes here" — which is the same defect class the Safety
 * module's `COVERAGE_STATE_COPY` was written for, and why this module reuses
 * those sentences rather than inventing parallel ones.
 *
 * TWO DIFFERENT AREAS ARE IN PLAY, AND CONFLATING THEM PUT A SENTENCE ON SCREEN
 * THAT THE DOTS REFUTED. The layer draws every crash the WORKSPACE has acquired.
 * An acquisition takes a caller-supplied bounding box and an optional project
 * (`safety_crash_ingests.min_lon…max_lat`); nothing derives it from, or clips it
 * to, the workspace's home geography. So the drawn set routinely covers ground
 * the stated area does not — and the stated area routinely covers ground no
 * acquisition ever asked about.
 *
 * An earlier version emitted the home-geography scope note unconditionally, and
 * two reachable states came out false:
 *
 *   * home geography UNSET (it is optional, and unset is the common case) with
 *     crashes acquired — the panel said an empty layer was not a finding and to
 *     go set an area, while crashes were visibly drawn;
 *   * home geography set NARROWER than an acquisition — the note described a
 *     scope the dots contradicted.
 *
 * So the notes below lead with WHAT WAS ACTUALLY ACQUIRED whenever the record
 * holds anything, and every coverage statement is scoped to the remainder — the
 * ground no acquisition requested. A coverage claim the map itself refutes is
 * worse than none, because it teaches a planner to distrust the disclosures that
 * are correct.
 *
 * PURE — no I/O, no clock. Facts in, sentences out.
 */

import { COVERAGE_STATE_COPY } from "@/lib/safety/client-types";
import {
  SAFETY_GEOCODING_CAVEAT,
  SAFETY_SEVERITY_COMPLETENESS_CAVEAT,
} from "@/lib/safety/caveats";

/**
 * Whether a storable crash source covers the area this workspace says it works in.
 *
 * Deliberately asked of the workspace's HOME GEOGRAPHY rather than of the drawn
 * crashes: the question "could you ever get crash data here?" has an answer even
 * when nothing has been acquired yet, and that answer is the one that stops an
 * empty layer reading as a finding.
 *
 * It is therefore a statement about the workspace's STATED AREA and about
 * nothing else — in particular it says nothing about the crashes on screen,
 * which were acquired for whatever boxes their acquisitions asked for. Copy that
 * reads this state must scope itself to the ground no acquisition covered.
 */
export type CrashLayerScopeState =
  /** Authenticated, but no workspace membership resolved. */
  | "no_workspace"
  /** The workspace states no home geography, so coverage cannot be determined. */
  | "coverage_unknown"
  /** An extent is stated and no storable adapter covers it. */
  | "out_of_coverage"
  /** At least one storable adapter covers the stated extent. */
  | "covered";

/**
 * What the workspace's acquisition history establishes.
 *
 * Derived from `safety_crash_ingests`, which is the acquisition unit — the crash
 * rows themselves cannot distinguish "never asked" from "asked and got nothing",
 * and those are opposite findings.
 */
export type CrashAcquisitionState =
  /** No acquisition has ever been run for this workspace. */
  | "none"
  /** Acquisitions exist, and every one of them reported no covering source. */
  | "out_of_coverage"
  /** Acquisitions exist, none succeeded, and at least one failed to reach its source. */
  | "unavailable"
  /** An acquisition is queued or running; nothing has landed in the record yet. */
  | "in_flight"
  /** At least one acquisition completed and stored what it found. */
  | "acquired";

/**
 * A longitude/latitude box, in the shape both owners already store it.
 *
 * Declared structurally rather than imported from `workspaces/home-geography`
 * so this module keeps knowing nothing about workspaces — a `HomeGeographyBbox`
 * and an acquisition's recorded extent both satisfy it, which is the point.
 */
export type LonLatBox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

/**
 * How the areas the completed acquisitions actually requested sit relative to
 * the workspace's stated area.
 *
 * Every count is bounded by what the caller could READ, not by what exists —
 * the acquisition history is fetched under a cap. That is why the counts are
 * only ever used as ratios against `areaCount` in the copy below, and never as
 * a total presented as the workspace's whole acquisition history.
 */
export type AcquiredAreaScope = {
  /** Completed acquisitions whose requested extent the caller could read. */
  areaCount: number;
  /**
   * Of those, how many requested ground reaching outside the stated area.
   * Zero when no home geography is stated: the comparison is then unmade rather
   * than false, and `scopeState: "coverage_unknown"` is the fact that says so.
   */
  outsideHomeCount: number;
  /** Of those, how many recorded an extent that could not be compared at all. */
  uncomparableCount: number;
};

/** Nothing read, nothing compared — the honest zero for a caller with no rows. */
export const NO_ACQUIRED_AREAS: AcquiredAreaScope = {
  areaCount: 0,
  outsideHomeCount: 0,
  uncomparableCount: 0,
};

export type CrashLayerCoverageInput = {
  scopeState: CrashLayerScopeState;
  /** The workspace's stated place name, when it has one. */
  scopeLabel: string | null;
  /** Labels of the sources checked for coverage — named so the gap is auditable. */
  checkedSourceLabels: readonly string[];
  acquisitionState: CrashAcquisitionState;
  /** Where the completed acquisitions actually looked. */
  acquiredAreas: AcquiredAreaScope;
  /** True when a completed acquisition reported more crashes than it could map. */
  anyUngeocoded: boolean;
  /** True when a contributing source cannot separate suspected serious injuries. */
  anySeverityIncomplete: boolean;
  /** Crash points this response actually carries. */
  returnedCount: number;
  /** Crash rows matching the workspace scope in the database. */
  matchedCount: number;
  /** Rows fetched but not drawable (unusable coordinates). */
  droppedCount: number;
  limit: number;
};

/** The label, or a neutral stand-in — never empty quotes. */
function placeName(scopeLabel: string | null): string {
  return scopeLabel && scopeLabel.trim().length > 0 ? scopeLabel.trim() : "this workspace's stated area";
}

function sourceList(labels: readonly string[]): string {
  const cleaned = labels.map((label) => label.trim()).filter((label) => label.length > 0);
  if (cleaned.length === 0) return "the registered crash sources";
  if (cleaned.length === 1) return cleaned[0];
  return `${cleaned.slice(0, -1).join(", ")} and ${cleaned[cleaned.length - 1]}`;
}

/**
 * Where a planner actually gets crash data. Named concretely, because a remedy
 * pointing at a page that does not exist is worse than no remedy at all.
 */
const ACQUISITION_REMEDY = "Run a crash acquisition from the Safety workbench to load them.";

/**
 * The subject of the two containment sentences.
 *
 * Always a ratio of the acquisitions the caller could READ — never a bare
 * total. The acquisition history is fetched under a cap, so a total would be a
 * floor dressed as a count, and "on record here" is the phrase that keeps the
 * claim to what this response actually saw.
 */
function acquisitionSubject(count: number, areaCount: number): string {
  if (areaCount === 1) return "the completed acquisition on record here";
  return (
    `${count.toLocaleString()} of the ${areaCount.toLocaleString()} completed acquisitions on record here`
  );
}

/**
 * The sentences a viewer must see for the crash layer.
 *
 * Ordered list rather than one string: a layer can simultaneously be out of
 * coverage, truncated, and carrying undrawable rows, and appending one sentence
 * to another lets the later ones hide behind the first.
 */
export function describeCrashLayerCoverage(input: CrashLayerCoverageInput): string[] {
  const notes: string[] = [];

  if (input.scopeState === "no_workspace") {
    notes.push(
      "Crashes are not shown: no workspace is active, so there is no acquired crash record to draw."
    );
    return notes;
  }

  // WHAT THE LAYER ACTUALLY DREW LEADS, whenever the record holds anything.
  // Every sentence after this one is about ground the acquisitions did not ask
  // about, and a planner who reads them without this one first will read a
  // statement about the stated area as a statement about the dots.
  //
  // No total number of acquisition areas is quoted here on purpose: the
  // acquisition history is read under a cap, so any total would be a floor
  // presented as a count. The counts below appear only as ratios of what was
  // read, which is a claim the caller can actually support.
  const recordHoldsCrashes = input.matchedCount > 0;
  if (recordHoldsCrashes) {
    notes.push(
      `Crashes: this layer draws only what this workspace has acquired — ${input.matchedCount.toLocaleString()} ` +
        `stored ${input.matchedCount === 1 ? "collision" : "collisions"}, covering the areas and years its ` +
        `completed acquisitions asked for. Ground no acquisition asked about is blank because nothing was ` +
        `requested there, not because no crashes occurred there.`
    );
  }

  // Then the coverage of the REMAINDER. Both branches change wording once
  // crashes are on screen, because the unconditional versions contradicted them:
  // one told a planner an empty layer was not a finding while dots were drawn,
  // the other described a scope the dots reached outside of.
  if (input.scopeState === "out_of_coverage") {
    const checked =
      `no crash source that OpenPlan can store covers ${placeName(input.scopeLabel)} — ` +
      `${sourceList(input.checkedSourceLabels)} ${input.checkedSourceLabels.length === 1 ? "was" : "were"} ` +
      `checked`;
    notes.push(
      recordHoldsCrashes
        ? // The shared `COVERAGE_STATE_COPY` sentence is NOT reused here: it ends
          // "so no crashes could be retrieved", which is a plain contradiction of
          // the dots on screen. Only its load-bearing half survives, rewritten to
          // point at the stated area rather than at the layer.
          `Crashes: ${checked}, so nothing further can be acquired for the stated area. That gap is a ` +
          `limit of the sources, not evidence that no crashes occurred there.`
        : `Crashes: ${checked}. ${COVERAGE_STATE_COPY.out_of_coverage}`
    );
  } else if (input.scopeState === "coverage_unknown") {
    notes.push(
      recordHoldsCrashes
        ? "Crashes: this workspace has not stated a home geography, so OpenPlan cannot check whether a crash " +
            "source covers anywhere beyond what its acquisitions already requested. Set the area in the " +
            "Workspace geography panel on the dashboard to have coverage checked."
        : "Crashes: this workspace has not stated a home geography, so OpenPlan cannot say whether a crash " +
            "source covers your area. An empty crash layer here is not a finding that no crashes occurred. " +
            "Set the area in the Workspace geography panel on the dashboard."
    );
  }

  // Where the acquisitions went relative to the stated area. Only sayable when
  // a stated area exists to compare against, which is exactly when
  // `outsideHomeCount` can be non-zero.
  const areas = input.acquiredAreas;
  if (areas.outsideHomeCount > 0) {
    notes.push(
      `Crashes: ${acquisitionSubject(areas.outsideHomeCount, areas.areaCount)} asked for an area reaching ` +
        `outside ${placeName(input.scopeLabel)}, so what is drawn is not bounded by the workspace's stated area.`
    );
  }

  // A recorded extent that cannot be compared is reported as uncompared rather
  // than assumed either way — guessing "inside" hides a real overreach, and
  // guessing "outside" invents one.
  if (areas.uncomparableCount > 0) {
    const count = areas.uncomparableCount;
    notes.push(
      `Crashes: ${acquisitionSubject(count, areas.areaCount)} recorded an unusable area, so whether ` +
        `${count === 1 ? "it falls" : "they fall"} inside ${placeName(input.scopeLabel)} is unknown.`
    );
  }

  // What the acquisition history establishes, which is a different question
  // from whether a source exists.
  //
  // Two of these states are SUPPRESSED once the scope note has already reported
  // a coverage gap. "None acquired" would carry a remedy — run an acquisition —
  // that cannot succeed where no storable source exists, and an instruction the
  // product knows will fail is worse than no instruction; "acquisitions found no
  // coverage" would simply repeat the sentence directly above it.
  const scopeAlreadyExplainsEmptiness = input.scopeState === "out_of_coverage";

  if (input.acquisitionState === "none") {
    if (scopeAlreadyExplainsEmptiness) return notes;
    notes.push(
      `Crashes: this layer draws collisions this workspace has acquired into its own record, and none ` +
        `have been acquired yet. That is not a finding that no crashes occurred here. ${ACQUISITION_REMEDY}`
    );
  } else if (input.acquisitionState === "out_of_coverage") {
    if (scopeAlreadyExplainsEmptiness) return notes;
    notes.push(`Crashes: ${COVERAGE_STATE_COPY.out_of_coverage}`);
  } else if (input.acquisitionState === "unavailable") {
    notes.push(`Crashes: ${COVERAGE_STATE_COPY.source_unavailable}`);
  } else if (input.acquisitionState === "in_flight") {
    notes.push(
      "Crashes: a crash acquisition is still running, so nothing has been stored for it yet. What is " +
        "drawn is whatever earlier acquisitions left, not the result of the one in progress."
    );
  } else if (input.matchedCount === 0) {
    // Acquired, covered, and still empty — the one case where zero IS a finding
    // about the acquired years, and the only one allowed to say so.
    notes.push(
      "Crashes: a crash acquisition completed for this workspace and stored no mappable collisions. " +
        "That covers only the years and area the acquisition requested, not all time."
    );
  }

  if (input.returnedCount + input.droppedCount < input.matchedCount) {
    notes.push(
      `Crashes: showing ${input.returnedCount.toLocaleString()} of ${input.matchedCount.toLocaleString()} ` +
        `acquired collisions — the ${input.limit.toLocaleString()} most recent by collision date, not the ` +
        `ones nearest you. The rest are not drawn, which is not a finding that they do not exist. The ` +
        `Safety workbench queries the full record.`
    );
  }

  if (input.droppedCount > 0) {
    const count = input.droppedCount;
    // Both drop reasons are named because the route has two of them — an
    // unusable coordinate pair, and a severity outside the KABCO vocabulary the
    // legend can key. Naming only the coordinates would state a reason that is
    // wrong for the severity case, and a refusal that misidentifies its own
    // cause is the defect this module exists to prevent, not a rounding of it.
    notes.push(
      `Crashes: ${count.toLocaleString()} acquired ${count === 1 ? "collision" : "collisions"} could not be ` +
        `drawn because the stored coordinates or severity value were unusable, so ` +
        `${count === 1 ? "it is" : "they are"} missing from the map rather than absent from the record.`
    );
  }

  if (input.anyUngeocoded) {
    notes.push(`Crashes: ${SAFETY_GEOCODING_CAVEAT}`);
  }

  // Only worth saying when something is actually drawn — otherwise it explains
  // the colours of an empty layer.
  if (input.anySeverityIncomplete && input.returnedCount > 0) {
    notes.push(`Crashes: ${SAFETY_SEVERITY_COMPLETENESS_CAVEAT}`);
  }

  return notes;
}

/**
 * Fold acquisition rows into the single state the copy branches on.
 *
 * `storedCrashCount` is the tiebreaker, and it is what keeps a BOUNDED read of
 * the acquisition history from lying. Crash rows exist only because some
 * acquisition stored them, so a non-zero count proves a completed acquisition
 * even when the row that did it fell outside the rows read here. Without it, a
 * workspace whose successful acquisition had scrolled off the end of the read
 * would be told its source was unreachable while its crashes were on screen.
 *
 * Precedence is by strength of evidence: stored rows, then a completed
 * acquisition, then a failure (the most actionable non-success), then a stated
 * coverage gap, then work still in flight.
 */
export function summarizeCrashAcquisitions(
  rows: ReadonlyArray<{ status: string; coverageState: string }>,
  options: { storedCrashCount: number }
): CrashAcquisitionState {
  if (options.storedCrashCount > 0) return "acquired";
  if (rows.length === 0) return "none";

  if (rows.some((row) => row.status === "ready")) return "acquired";

  if (rows.some((row) => row.status === "failed" || row.coverageState === "source_unavailable")) {
    return "unavailable";
  }

  if (rows.some((row) => row.status === "no_coverage" || row.coverageState === "out_of_coverage")) {
    return "out_of_coverage";
  }

  // Everything left is queued or running. Reporting "none" would tell a planner
  // to start an acquisition they have already started; reporting "acquired"
  // would credit the record with rows that have not landed.
  return "in_flight";
}

/**
 * A box in "west edge + eastward width" form, or `null` when it is unusable.
 *
 * `null` is a real answer, not a parse failure to swallow: an extent that
 * cannot be read cannot be compared, and the copy above says so rather than
 * guessing a side.
 *
 * A box whose `minLon` exceeds its `maxLon` CROSSES THE ANTIMERIDIAN and is
 * well-formed — Fiji, Chukotka and the western Aleutians all produce one, which
 * is why neither the migration nor `homeGeographyBbox` constrains longitude
 * ordering. Latitude has no such wrap, so an inverted one is corrupt.
 */
function eastwardSpan(
  box: LonLatBox | null | undefined
): { west: number; width: number; minLat: number; maxLat: number } | null {
  if (!box) return null;
  const { minLon, minLat, maxLon, maxLat } = box;
  if (![minLon, minLat, maxLon, maxLat].every((value) => typeof value === "number" && Number.isFinite(value))) {
    return null;
  }
  if (minLat > maxLat || minLat < -90 || maxLat > 90) return null;
  const raw = maxLon - minLon;
  const width = raw >= 0 ? raw : raw + 360;
  if (width > 360) return null;
  return { west: minLon, width, minLat, maxLat };
}

/**
 * Floating-point slack. Both boxes come from the same class of source (a
 * TIGERweb boundary, a picker-derived study area), and a stated area that
 * equals the acquisition's to the last representable bit must not be reported
 * as overreaching it by 1e-15 degrees — roughly a nanometre.
 */
const CONTAINMENT_EPSILON = 1e-9;

/**
 * Whether `inner` lies wholly within `outer`, or `null` when either is unusable.
 *
 * Longitude is compared as an offset around the globe rather than as a raw
 * numeric range, so an antimeridian-crossing box on either side compares
 * correctly instead of reading as a 350-degree span.
 */
export function boxLiesWithin(inner: LonLatBox | null, outer: LonLatBox | null): boolean | null {
  const a = eastwardSpan(inner);
  const b = eastwardSpan(outer);
  if (!a || !b) return null;

  const offsetEast = (((a.west - b.west) % 360) + 360) % 360;
  const lonWithin = offsetEast + a.width <= b.width + CONTAINMENT_EPSILON;
  const latWithin =
    a.minLat >= b.minLat - CONTAINMENT_EPSILON && a.maxLat <= b.maxLat + CONTAINMENT_EPSILON;

  return lonWithin && latWithin;
}

/**
 * Fold the extents of the COMPLETED acquisitions into the scope facts the copy
 * needs.
 *
 * Only completed acquisitions belong here. A queued or failed run requested an
 * area but contributed no dot, so counting it would attribute the drawn set to
 * ground nothing was ever stored for.
 *
 * `homeBbox` is `null` for a workspace that has stated no geography. Nothing is
 * then counted as outside or unusable, because the comparison was never made —
 * reporting "0 outside" as though it had been is the same class of false
 * confidence this module exists to remove, which is why the copy branches on
 * `scopeState` before it reads these counts.
 */
export function summarizeAcquiredAreas(
  extents: ReadonlyArray<LonLatBox | null>,
  homeBbox: LonLatBox | null
): AcquiredAreaScope {
  const areaCount = extents.length;
  if (!homeBbox || areaCount === 0) {
    return { areaCount, outsideHomeCount: 0, uncomparableCount: 0 };
  }

  let outsideHomeCount = 0;
  let uncomparableCount = 0;
  for (const extent of extents) {
    const within = boxLiesWithin(extent, homeBbox);
    if (within === null) uncomparableCount += 1;
    else if (!within) outsideHomeCount += 1;
  }

  return { areaCount, outsideHomeCount, uncomparableCount };
}
