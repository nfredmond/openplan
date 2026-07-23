/**
 * Crash-source registry + resolver (Wave 8.1).
 *
 * Adapters are ordered strongest-coverage-first. `resolveCrashSource` returns
 * the first adapter that covers the study area, or an explicit
 * `out_of_coverage` result naming everything it checked.
 *
 * There is deliberately no fallback tier. If nothing covers the area, the caller
 * shows "no crash source covers this study area" — it does not synthesize a
 * figure. `src/lib/data-sources/crashes.ts` keeps its disclosed `fars-estimate`
 * tier for the Explore scorecard; that tier is not reachable from here, and the
 * `safety_crashes` CHECK constraint refuses any source id not registered below.
 */

import { ccrsAdapter, CCRS_SOURCE_ID } from "./ccrs";
import type { CrashSourceAdapter, CrashSourceResolution } from "./types";
import type { StudyAreaBbox } from "@/lib/models/study-area";

/**
 * Registered observed-crash adapters, in resolution order.
 *
 * Adding coverage should mean adding an entry here (and to
 * OBSERVED_CRASH_SOURCE_IDS below plus the migration's CHECK), not editing
 * callers — the same shape the WA/CO/OR traffic-count adapters use.
 */
export const CRASH_SOURCE_ADAPTERS: readonly CrashSourceAdapter[] = [ccrsAdapter];

/**
 * The only source ids permitted to reach `safety_crashes`. Kept as a plain
 * exported constant so the migration's CHECK constraint and the honesty test can
 * both assert against one list.
 */
export const OBSERVED_CRASH_SOURCE_IDS: readonly string[] = [CCRS_SOURCE_ID];

export function resolveCrashSource(bbox: StudyAreaBbox): CrashSourceResolution {
  for (const adapter of CRASH_SOURCE_ADAPTERS) {
    if (adapter.covers(bbox)) {
      return { kind: "resolved", adapter };
    }
  }

  return {
    kind: "out_of_coverage",
    checked: CRASH_SOURCE_ADAPTERS.map((adapter) => ({ id: adapter.id, label: adapter.label })),
  };
}

export function getCrashSourceById(id: string): CrashSourceAdapter | null {
  return CRASH_SOURCE_ADAPTERS.find((adapter) => adapter.id === id) ?? null;
}
