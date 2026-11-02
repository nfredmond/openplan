/**
 * Crash-source registry + resolver (Wave 8.1, extended in 8.2).
 *
 * Adapters are ordered strongest-coverage-first. `resolveCrashSource` returns
 * the first adapter that serves the study area's STATE, or an explicit
 * `out_of_coverage` result naming everything it checked. When the state is
 * not known, only a national adapter may answer (see
 * `crashSourcesForStudyArea`).
 *
 * There is deliberately no fallback tier and no estimator anywhere in the
 * platform: since Wave 8.2 the Explore corridor scorecard reads its crash data
 * from this registry too (`src/lib/data-sources/crashes.ts`), so a place either
 * has an observed crash source or is told plainly that it does not.
 *
 * TWO KINDS OF COVERAGE. Reading is cheaper than writing: `safety_crashes`
 * pins `source_id` to a closed CHECK domain, so persisted coverage advances by
 * migration while read coverage advances by registering an adapter. The
 * `persistable` flag is that boundary, and `resolveCrashSource` defaults to the
 * conservative side so an ingest can never resolve a source the database would
 * reject. Sources not yet admitted remain available through the generic live
 * read lane without being misrepresented as stored acquisitions.
 */

import { ccrsAdapter } from "./ccrs";
import { farsAdapter } from "./fars";
import type { CrashSourceAdapter, CrashSourceResolution, CrashSourceUse } from "./types";
import type { StudyAreaBbox } from "@/lib/models/study-area";

/**
 * Registered observed-crash adapters, in resolution order.
 *
 * Order is "richest severity coverage first": CCRS separates fatal from injury
 * (and, after the KSI join, serious injury) where it applies; FARS is the
 * fatal-only national backstop. Adding coverage should mean adding an entry
 * here, not editing callers — the same shape the WA/CO/OR traffic-count
 * adapters use.
 */
export const CRASH_SOURCE_ADAPTERS: readonly CrashSourceAdapter[] = [ccrsAdapter, farsAdapter];

/**
 * The only source ids permitted to reach `safety_crashes`.
 *
 * Derived from `persistable` so the list cannot drift from the adapters, and
 * kept as a plain exported constant so the migration's CHECK constraint and the
 * honesty test can both assert against one value. Widening it requires a
 * migration that widens the CHECK in the same change.
 */
export const OBSERVED_CRASH_SOURCE_IDS: readonly string[] = CRASH_SOURCE_ADAPTERS.filter(
  (adapter) => adapter.persistable
).map((adapter) => adapter.id);

/**
 * The state FIPS codes a study area lies in, as its place identity establishes
 * them. `null` (or absent) means the identity does not say: a drawn area, a
 * metro area that can cross a state line, or no place picked at all.
 */
export type CrashStudyAreaStates = readonly string[] | null;

/** What the resolver is told about a study area. */
export type CrashStudyArea = {
  bbox: StudyAreaBbox;
  stateFips?: CrashStudyAreaStates;
};

const STATE_FIPS_PATTERN = /^\d{2}$/;

/** Dedupe and validate. Anything malformed makes the whole answer unknown. */
function normalizeStudyAreaStates(states: CrashStudyAreaStates | undefined): string[] | null {
  if (!states || states.length === 0) return null;
  const unique = Array.from(new Set(states.map((code) => code.trim())));
  return unique.every((code) => STATE_FIPS_PATTERN.test(code)) ? unique : null;
}

/**
 * Every adapter that may answer for a study area, richest first.
 *
 * KNOWN STATES decide it, not the bbox. An adapter qualifies only when it
 * declares every one of the study area's states in `servesStateFips`. A
 * California county gets CCRS and then FARS; a county in Nevada gets FARS alone,
 * however much of the California rectangle its bbox overlaps. A study area
 * that spans states gets only a source that reads all of them, which today is
 * the fatal-only national file, and the result says fatal-only.
 *
 * UNKNOWN STATES never select a state-limited source. A state source chosen
 * from a rectangle is a guess about the state, and a wrong guess is stored as
 * "0 crashes". Only a national adapter whose envelope overlaps the bbox may
 * answer, and its label and severity completeness travel with the result.
 */
export function crashSourcesForStudyArea(
  area: CrashStudyArea,
  use: CrashSourceUse = "ingest"
): { candidates: CrashSourceAdapter[]; checked: CrashSourceAdapter[] } {
  const pool =
    use === "ingest" ? CRASH_SOURCE_ADAPTERS.filter((adapter) => adapter.persistable) : [...CRASH_SOURCE_ADAPTERS];
  const states = normalizeStudyAreaStates(area.stateFips);

  const candidates = states
    ? pool.filter((adapter) => states.every((state) => adapter.servesStateFips.includes(state)))
    : pool.filter((adapter) => adapter.coversStateFips === undefined && adapter.covers(area.bbox));

  return { candidates, checked: pool };
}

/** The one source an acquisition reads from, or the sources it checked. */
export function resolveCrashSource(
  area: CrashStudyArea,
  use: CrashSourceUse = "ingest"
): CrashSourceResolution {
  const { candidates, checked } = crashSourcesForStudyArea(area, use);
  if (candidates.length > 0) return { kind: "resolved", adapter: candidates[0] };
  return {
    kind: "out_of_coverage",
    checked: checked.map((adapter) => ({ id: adapter.id, label: adapter.label })),
  };
}

export function getCrashSourceById(id: string): CrashSourceAdapter | null {
  return CRASH_SOURCE_ADAPTERS.find((adapter) => adapter.id === id) ?? null;
}

/**
 * Multi-source resolution for the corridor scorecard, which has a bbox and no
 * place identity.
 *
 * Picking a SINGLE adapter by envelope is a hazard: CCRS's coverage envelope is
 * the coarse California rectangle,
 * so a study area in western Nevada or Arizona that merely overlaps that box
 * resolves to CCRS, which then returns zero California crashes and reads as a
 * safe corridor while the FARS national backstop — which HAS those states'
 * fatal crashes — is never consulted.
 *
 * This returns every covering adapter, richest-coverage-first: a `primary` and
 * an ordered list of `backstops`. The caller fetches all of them and keeps
 * backstop records only OUTSIDE the primary's state jurisdiction, so a
 * border-straddling or out-of-state study area gets real fatal coverage without
 * double-counting the crashes the primary already reports.
 */
export type MultiCrashSourceResolution =
  | { kind: "resolved"; primary: CrashSourceAdapter; backstops: CrashSourceAdapter[] }
  | { kind: "out_of_coverage"; checked: Array<{ id: string; label: string }> };

export function resolveCrashSources(
  bbox: StudyAreaBbox,
  use: CrashSourceUse = "read_only"
): MultiCrashSourceResolution {
  const candidates =
    use === "ingest" ? CRASH_SOURCE_ADAPTERS.filter((adapter) => adapter.persistable) : CRASH_SOURCE_ADAPTERS;

  const covering = candidates.filter((adapter) => adapter.covers(bbox));

  if (covering.length === 0) {
    return {
      kind: "out_of_coverage",
      checked: candidates.map((adapter) => ({ id: adapter.id, label: adapter.label })),
    };
  }

  return { kind: "resolved", primary: covering[0], backstops: covering.slice(1) };
}
