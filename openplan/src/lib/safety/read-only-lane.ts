/**
 * The READ-ONLY crash lane — how the Safety module reaches a source it may not
 * store.
 *
 * THE DEFECT THIS CLOSES. `safety_crashes.source_id` is a closed CHECK domain
 * so the registry marks adapters not yet admitted there `persistable: false`
 * and `resolveCrashSource(bbox, "ingest")` filters them out. That is correct —
 * an ingest must never resolve a source the database would reject mid-write.
 * But the Safety module once reported the FILTERED
 * result as `out_of_coverage`, whose copy told the planner that *no registered
 * crash source covers this study area*. For every US state except California
 * that sentence was false: `farsAdapter` is registered, it covers the whole
 * source's reporting geography, while the Explore corridor scorecard had been
 * reading it (`fetchCrashesForBbox`, `use: "read_only"`). The
 * capability was complete, registered, tested — and no planner opening
 * `/safety` could reach it.
 *
 * WHAT THIS LANE DOES. Resolve the covering adapters for the READ path, fetch
 * from the first one that answers, and hand the records back. Nothing is
 * written. That is not a limitation being worked around, it is the honest
 * shape: a source the `safety_crashes` CHECK does not admit has not been
 * acquired into the workspace, and recording an acquisition row for it would
 * put counts in the coverage banner that no crash row backs — the banner and
 * the map would then disagree on every subsequent page load, which is the exact
 * defect class this module's disclosure copy exists to prevent.
 *
 * WHAT IT IS NOT. It is not a second crash implementation. Every fetch goes
 * through the same `CrashSourceAdapter` contract and the same registry that the
 * ingest lane and the corridor scorecard use, so adding a country or a state
 * DOT file still means registering an adapter, never editing a call site. When
 * a migration widens the `source_id` CHECK, the adapter flips to
 * `persistable: true` and stops arriving here at all — no code in this file
 * names an adapter, an id, a state or a country.
 *
 * FAILURE PROTOCOL, unchanged from the adapter contract: a source that cannot
 * be reached THROWS, and an unreachable source is reported as unreachable. An
 * empty result means the source answered and had nothing — a real finding. The
 * two must never collapse into each other, because "0 fatalities" reads as a
 * safe corridor.
 */

import type { StudyAreaBbox } from "@/lib/models/study-area";
import { resolveCrashSources } from "./sources/registry";
import type { CrashFetchResult, CrashSourceAdapter } from "./sources/types";

/**
 * Cap on records a single live read returns.
 *
 * A live read travels back in the HTTP response rather than into a table, so
 * the cap is about the wire, not about the database. Hitting it sets
 * `truncated`, which the caller discloses.
 */
export const READ_ONLY_MAX_RECORDS = 5_000;

/** A source identity as it is reported to the caller. */
export type CrashSourceIdentity = { id: string; label: string };

export type ReadOnlyCrashLaneResult =
  | {
      kind: "read_only";
      adapter: CrashSourceAdapter;
      fetched: CrashFetchResult;
      /** Years actually requested of the adapter, after clamping. */
      yearsRequested: number[];
      /** Every adapter consulted, in resolution order. */
      checked: CrashSourceIdentity[];
    }
  | {
      kind: "source_unavailable";
      /** The adapter whose failure is being reported (the first that covered). */
      adapter: CrashSourceAdapter;
      message: string;
      checked: CrashSourceIdentity[];
    }
  | {
      kind: "out_of_coverage";
      /** Every adapter consulted. Named so the caller can say what it checked. */
      checked: CrashSourceIdentity[];
    };

export type ReadOnlyCrashLaneParams = {
  bbox: StudyAreaBbox;
  years: number[];
  maxRecords?: number;
  signal?: AbortSignal;
};

function identify(adapter: CrashSourceAdapter): CrashSourceIdentity {
  return { id: adapter.id, label: adapter.label };
}

/**
 * Read observed crashes for a study area without storing anything.
 *
 * Covering adapters are tried in registry order (richest severity coverage
 * first). A covering adapter that THROWS does not end the lane — the next
 * covering adapter is tried, because one source being down is not a statement
 * about the others. Only when every covering adapter fails is the result
 * `source_unavailable`, and it names the first failure rather than inventing a
 * summary of several.
 */
export async function readCrashesForStudyArea(
  params: ReadOnlyCrashLaneParams
): Promise<ReadOnlyCrashLaneResult> {
  const resolution = resolveCrashSources(params.bbox, "read_only");

  if (resolution.kind === "out_of_coverage") {
    return { kind: "out_of_coverage", checked: resolution.checked };
  }

  const covering = [resolution.primary, ...resolution.backstops];
  const checked = covering.map(identify);

  let firstFailure: { adapter: CrashSourceAdapter; message: string } | null = null;

  for (const adapter of covering) {
    // Clamp to what the adapter actually holds, so `yearsRequested` reports the
    // years that were really asked for rather than the years the caller hoped
    // for. The adapter clamps again internally — this is about telling the
    // truth in the result, not about protecting the adapter.
    //
    // An EMPTY clamped list is still sent. A covering source that holds none of
    // the requested years answers "nothing for those years", which is a
    // different and narrower fact than "no source covers this area"; silently
    // promoting the first into the second is exactly the kind of false coverage
    // claim this lane was written to remove.
    const years = params.years.filter((year) => year >= adapter.earliestYear);

    try {
      const fetched = await adapter.fetch({
        bbox: params.bbox,
        years,
        maxRecords: params.maxRecords ?? READ_ONLY_MAX_RECORDS,
        signal: params.signal,
      });
      return { kind: "read_only", adapter, fetched, yearsRequested: years, checked };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown crash source failure";
      firstFailure ??= { adapter, message };
    }
  }

  if (firstFailure) {
    return {
      kind: "source_unavailable",
      adapter: firstFailure.adapter,
      message: firstFailure.message,
      checked,
    };
  }

  // Defensive only. `resolveCrashSources` returned `resolved`, so `covering` is
  // non-empty and the loop above either returned or recorded a failure. Kept as
  // a total function rather than a throw, because the caller's job at this point
  // is to render a state, not to handle an exception.
  return { kind: "out_of_coverage", checked };
}
