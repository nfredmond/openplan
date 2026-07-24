/**
 * Crash-source registry + resolver (Wave 8.1, extended in 8.2).
 *
 * Adapters are ordered strongest-coverage-first. `resolveCrashSource` returns
 * the first adapter that covers the study area, or an explicit
 * `out_of_coverage` result naming everything it checked.
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
 * reject.
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

export function resolveCrashSource(
  bbox: StudyAreaBbox,
  use: CrashSourceUse = "ingest"
): CrashSourceResolution {
  const candidates =
    use === "ingest" ? CRASH_SOURCE_ADAPTERS.filter((adapter) => adapter.persistable) : CRASH_SOURCE_ADAPTERS;

  for (const adapter of candidates) {
    if (adapter.covers(bbox)) {
      return { kind: "resolved", adapter };
    }
  }

  return {
    kind: "out_of_coverage",
    checked: candidates.map((adapter) => ({ id: adapter.id, label: adapter.label })),
  };
}

export function getCrashSourceById(id: string): CrashSourceAdapter | null {
  return CRASH_SOURCE_ADAPTERS.find((adapter) => adapter.id === id) ?? null;
}
