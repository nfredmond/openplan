/**
 * Study-area probes DERIVED FROM THE REAL CRASH REGISTRY.
 *
 * WHY NOT A HARDCODED BBOX. A reachability test whose fixture is a rectangle
 * somebody typed proves the assertion, not the feature: the repo has already
 * shipped an action whose offer condition no board could satisfy, with a green
 * reachability test, because the fixture described a state the product cannot
 * produce. So these probes are SEARCHED for using the adapters' own `covers()`
 * predicates. If the registry changes shape — an adapter is unregistered, a
 * coverage envelope shrinks, a source becomes persistable — the probe either
 * moves with it or comes back null and the calling test fails loudly instead of
 * quietly asserting nothing.
 *
 * It also keeps the tests jurisdiction-neutral. Nothing here names a country, a
 * state or a coordinate: the grid is the whole planet and the registry decides
 * which cells mean what.
 */

import {
  CRASH_SOURCE_ADAPTERS,
  type MultiCrashSourceResolution,
} from "@/lib/safety/sources/registry";
import type { CrashSourceAdapter } from "@/lib/safety/sources/types";
import type { StudyAreaBbox } from "@/lib/models/study-area";

/** Degrees per probe cell. Small enough to land inside real envelopes. */
const GRID_STEP = 2;

/** Every cell of a coarse global grid, west-to-east then south-to-north. */
export function globalProbeGrid(step: number = GRID_STEP): StudyAreaBbox[] {
  const cells: StudyAreaBbox[] = [];
  for (let lat = -84; lat < 84; lat += step) {
    for (let lon = -180; lon < 180; lon += step) {
      cells.push({ minLon: lon, minLat: lat, maxLon: lon + step, maxLat: lat + step });
    }
  }
  return cells;
}

function coveringAdapters(bbox: StudyAreaBbox): CrashSourceAdapter[] {
  return CRASH_SOURCE_ADAPTERS.filter((adapter) => adapter.covers(bbox));
}

/**
 * A study area that a REGISTERED adapter covers but that NO storable adapter
 * covers — the exact state in which the ingest lane used to answer
 * "no registered crash source covers this study area".
 *
 * Returns null when the registry holds no such place, which is a real and
 * reportable finding rather than a reason to skip: it would mean the read-only
 * lane is unreachable by construction.
 */
export function findReadOnlyOnlyStudyArea(): { bbox: StudyAreaBbox; adapter: CrashSourceAdapter } | null {
  for (const bbox of globalProbeGrid()) {
    const covering = coveringAdapters(bbox);
    if (covering.length === 0) continue;
    if (covering.some((adapter) => adapter.persistable)) continue;
    return { bbox, adapter: covering[0] };
  }
  return null;
}

/** A study area a STORABLE adapter covers, so the ingest path is exercised. */
export function findStorableStudyArea(): { bbox: StudyAreaBbox; adapter: CrashSourceAdapter } | null {
  for (const bbox of globalProbeGrid()) {
    const covering = coveringAdapters(bbox).filter((adapter) => adapter.persistable);
    if (covering.length > 0) return { bbox, adapter: covering[0] };
  }
  return null;
}

/** A study area no registered adapter covers at all — the true coverage gap. */
export function findUncoveredStudyArea(): StudyAreaBbox | null {
  for (const bbox of globalProbeGrid()) {
    if (coveringAdapters(bbox).length === 0) return bbox;
  }
  return null;
}

/** Narrow a multi-source resolution in a test without repeating the guard. */
export function resolvedPrimary(resolution: MultiCrashSourceResolution): CrashSourceAdapter {
  if (resolution.kind !== "resolved") {
    throw new Error("expected the registry to resolve a covering crash source");
  }
  return resolution.primary;
}
