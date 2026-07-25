/**
 * Equity-designation registry + resolver.
 *
 * Adapters are ordered richest-coverage-first. `resolveEquityDesignation` returns
 * the first adapter that covers the study area, or an explicit `out_of_coverage`
 * result naming everything it checked — the same shape as the crash registry.
 *
 * `resolveJustice40ForTracts` is the one function callers use: give it a study
 * area and its tract GEOIDs and it returns a `Justice40Determination` that is
 * either a real designation or an honest `not_determined`. It NEVER synthesizes
 * a designation from the ACS income proxy — that separation is the whole point.
 *
 * Adding coverage (e.g. a California SB 535 / CalEnviroScreen adapter, richer
 * than the national CEJST layer inside CA) means appending a descriptor here,
 * not editing `screenEquity` or any consumer (non-negotiable #0).
 */

import type { StudyAreaBbox } from "@/lib/models/study-area";
import { cejstNationalAdapter } from "./cejst-national";
import {
  DesignationSourceUnavailableError,
  notDeterminedJustice40,
  type EquityDesignationAdapter,
  type EquityDesignationResolution,
  type Justice40Determination,
} from "./types";

/**
 * Registered designation adapters, richest-coverage-first. A CA-specific adapter
 * (SB 535 / CalEnviroScreen) would sit BEFORE the national CEJST layer so a
 * California study area resolves to the stronger state designation.
 */
export const EQUITY_DESIGNATION_ADAPTERS: readonly EquityDesignationAdapter[] = [cejstNationalAdapter];

/**
 * The only source ids permitted to reach a designation table, derived from
 * `persistable` so the list cannot drift from the adapters. Empty today (the
 * bundled CEJST asset is read-only); widening it requires a migration that
 * widens any `source_id` CHECK in the same change.
 */
export const DESIGNATION_SOURCE_IDS: readonly string[] = EQUITY_DESIGNATION_ADAPTERS.filter(
  (adapter) => adapter.persistable
).map((adapter) => adapter.id);

export function resolveEquityDesignation(
  bbox: StudyAreaBbox,
  extraAdapters: readonly EquityDesignationAdapter[] = []
): EquityDesignationResolution {
  // Extra (e.g. DB-backed, richer/regional) adapters are checked FIRST so an
  // ingested California SB 535 / CalEnviroScreen source outranks the national
  // CEJST layer inside CA. Static registry adapters follow.
  const adapters = [...extraAdapters, ...EQUITY_DESIGNATION_ADAPTERS];
  for (const adapter of adapters) {
    if (adapter.covers(bbox)) {
      return { kind: "resolved", adapter };
    }
  }
  return {
    kind: "out_of_coverage",
    checked: adapters.map((adapter) => ({ id: adapter.id, label: adapter.label })),
  };
}

export function getEquityDesignationById(id: string): EquityDesignationAdapter | null {
  return EQUITY_DESIGNATION_ADAPTERS.find((adapter) => adapter.id === id) ?? null;
}

/**
 * Resolve the federal/official Justice40 determination for a study area's tracts.
 *
 * Returns `not_determined` (with `source: null`) when nothing covers the area or
 * the source is unavailable, and a real determination otherwise. When a source
 * covered the area but held a record for none of the tracts (e.g. every
 * 2020-vintage tract is absent from CEJST's 2010 keying), the status is
 * `not_determined` but the source IS named so disclosure can explain the vintage
 * gap rather than reading as a blank.
 */
export async function resolveJustice40ForTracts(
  bbox: StudyAreaBbox,
  geoids: string[],
  extraAdapters: readonly EquityDesignationAdapter[] = []
): Promise<Justice40Determination> {
  const totalTracts = geoids.length;
  const resolution = resolveEquityDesignation(bbox, extraAdapters);

  if (resolution.kind === "out_of_coverage") {
    return notDeterminedJustice40(totalTracts);
  }

  const adapter = resolution.adapter;
  let lookup;
  try {
    lookup = await adapter.lookup(geoids);
  } catch (error) {
    // Unavailable must never read as "no disadvantaged tracts". Fall to an
    // honest not_determined — and say the cause was an unreachable source, NOT
    // that no source covered the area (which would be a false explanation).
    if (error instanceof DesignationSourceUnavailableError) {
      return notDeterminedJustice40(totalTracts, "source_unavailable");
    }
    throw error;
  }

  const determinedTracts = lookup.determinedTotal;
  const disadvantagedTracts = lookup.disadvantagedTotal;
  const status: Justice40Determination["status"] =
    determinedTracts === 0
      ? "not_determined"
      : disadvantagedTracts > 0
        ? "disadvantaged"
        : "not_disadvantaged";

  return {
    status,
    source: adapter.id,
    datasetLabel: adapter.datasetLabel,
    version: adapter.version,
    vintage: adapter.vintage,
    // A covered source that matched nothing → the vintage-gap cause; a real
    // determination has no not_determined cause.
    notDeterminedCause: status === "not_determined" ? "no_matching_record" : null,
    coverage: {
      totalTracts,
      determinedTracts,
      undeterminedTracts: totalTracts - determinedTracts,
      disadvantagedTracts,
      crosswalkInferredTracts: lookup.inferredTotal ?? 0,
    },
  };
}
