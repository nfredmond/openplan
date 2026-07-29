/**
 * The severity palette the shared crash layer paints with, and the legend keys it by.
 *
 * WHY IT IS A MODULE AND NOT TWO LITERALS. The colours have to be identical in
 * the Mapbox `match` expression (the backdrop) and in the legend swatches (a
 * separate component). Two hand-copied palettes drift, and a legend that
 * disagrees with the map about which colour means "fatal" is worse than no
 * legend at all.
 *
 * CONVERGENCE NOTE — `src/components/safety/safety-crash-map.tsx` holds a
 * palette of its own, written before this module existed. It is deliberately NOT
 * edited here (that map belongs to the Safety module and is out of this change's
 * blast radius). The two agree on all four real buckets but NOT on the fallback,
 * so folding that map onto this constant would be a small behaviour change
 * rather than a pure refactor: its `match` expression has no explicit `"pdo"`
 * case, so `#64748b` is its DEFAULT — property-damage-only and every
 * unrecognised severity paint the same slate. Here `pdo` is mapped explicitly
 * and an unknown severity gets its own colour, for the reason argued below.
 * Converging on this module's treatment is the follow-up that makes "the same
 * crash reads the same colour wherever it appears" true by construction rather
 * than by inspection.
 *
 * THE FOUR BUCKETS ARE THE VOCABULARY, NOT A CAPABILITY CLAIM. `severe_injury`
 * is KABCO "A", which the only currently persistable source (CCRS) cannot
 * separate — see `CrashSeverityCompleteness` in `src/lib/safety/sources/types.ts`.
 * Listing it here says what the colour would mean if a source could express it;
 * the layer's coverage notes say whether the acquired sources actually can.
 * Dropping the bucket instead would leave a future kabco_full source painting
 * dots with no legend entry.
 *
 * PURE — no I/O, no Mapbox import.
 */

import type { CrashSeverity } from "@/lib/safety/sources/types";

/**
 * Severity order for the legend ramp: most severe first, so the ramp reads
 * top-down the way a planner reads a KSI table.
 */
export const CRASH_SEVERITY_LEGEND_ORDER: readonly CrashSeverity[] = [
  "fatal",
  "severe_injury",
  "injury",
  "pdo",
];

export const CRASH_SEVERITY_COLOR: Record<CrashSeverity, string> = {
  fatal: "#ef4444",
  severe_injury: "#fb923c",
  injury: "#facc15",
  pdo: "#64748b",
};

/**
 * Colour for a severity value that is not one of the four buckets.
 *
 * Reachable only if a row is written outside the `safety_crashes` severity
 * CHECK, which cannot happen today — but a paint expression needs a fallback,
 * and a fallback that reuses one of the real colours would render an unknown
 * severity as a confident one.
 */
export const CRASH_SEVERITY_UNKNOWN_COLOR = "#94a3b8";

/** Short legend labels. Fuller ones live in `SEVERITY_LABELS` (safety client-types). */
export const CRASH_SEVERITY_LEGEND_LABEL: Record<CrashSeverity, string> = {
  fatal: "Fatal",
  severe_injury: "Serious",
  injury: "Injury",
  pdo: "PDO",
};
