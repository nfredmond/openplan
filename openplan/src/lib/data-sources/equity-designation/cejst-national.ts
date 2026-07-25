/**
 * CEJST v1.0 — national Justice40 disadvantaged-communities designation.
 *
 * WHY A BUNDLED SNAPSHOT. The Climate and Economic Justice Screening Tool was a
 * federal product: the White House CEQ / U.S. Digital Service published a
 * per-census-tract "Identified as disadvantaged" determination that the
 * Justice40 Initiative used to target 40% of certain federal benefits. Executive
 * Order 14008 (which established Justice40) was revoked 2025-01-20 and the CEJST
 * tool was taken offline ~2025-01-22; its official host no longer resolves. The
 * dataset itself is a U.S. Government work in the public domain (17 U.S.C. § 105;
 * the upstream repo usds/justice40-tool is CC0-1.0), so the final v1.0 list
 * (2022-11-22, 74,134 tracts, 27,248 disadvantaged) survives and is bundled here
 * as a frozen historical snapshot — the only way to give every self-serve
 * deployment a REAL determination with zero setup (non-negotiable #4).
 *
 * IMPORTANT vintage caveat, disclosed everywhere this is used: CEJST keys on
 * 2010 census tracts, while OpenPlan's ACS pull uses 2020-vintage tracts. A tract
 * that was renumbered in the 2020 redistricting has no CEJST record and is
 * reported `not_determined` — never guessed. A 2010→2020 crosswalk is a
 * documented future improvement.
 *
 * This adapter is READ-ONLY (`persistable: false`): the bundled asset is the
 * backing store, no DB write path exists yet. Coverage grows by adding sibling
 * adapters (e.g. California SB 535 / CalEnviroScreen) to the registry.
 */

import type { StudyAreaBbox } from "@/lib/models/study-area";
import cejstV1 from "./data/cejst-v1.0-communities.json";
import tractCrosswalk from "./data/tract-2020-to-2010-crosswalk.json";
import {
  DesignationSourceUnavailableError,
  type EquityDesignationAdapter,
  type EquityDesignationLookup,
} from "./types";

export const CEJST_NATIONAL_SOURCE_ID = "cejst-national";

interface CejstAsset {
  meta: {
    datasetLabel: string;
    version: string;
    tractVintage: string;
    attribution?: string;
    license: string;
    totalTracts: number;
    disadvantagedTracts: number;
    programStatus: string;
    source: string;
  };
  coveredGeoids: string[];
  disadvantagedGeoids: string[];
}

const asset = cejstV1 as unknown as CejstAsset;

interface CrosswalkAsset {
  crosswalk: Record<string, string[]>;
}

// Maps a 2020-vintage tract GEOID to the 2010-vintage GEOID(s) it overlaps.
// CEJST v1.0 keys on 2010 tracts; OpenPlan's ACS uses 2020 tracts. Without this,
// a tract renumbered in the 2020 redistricting had no CEJST record and returned
// not_determined. Only non-identity (changed) 2020 tracts appear here — an
// unchanged tract keeps its GEOID and is found by direct membership below.
const crosswalkAsset = tractCrosswalk as unknown as CrosswalkAsset;

/**
 * Coarse US envelopes — the same geography FARS uses (CONUS, Alaska incl. the
 * Aleutian antimeridian tail, Hawaii, Puerto Rico). This is only a pre-filter to
 * avoid work for clearly-non-US study areas; the authoritative coverage test is
 * per-GEOID membership in `lookup`, which reports any tract absent from the
 * snapshot as `not_determined`.
 */
const CEJST_ENVELOPES: readonly StudyAreaBbox[] = [
  { minLon: -125.0, maxLon: -66.9, minLat: 24.4, maxLat: 49.4 },
  { minLon: -172.5, maxLon: -129.9, minLat: 51.0, maxLat: 71.5 },
  { minLon: 172.0, maxLon: 180.0, minLat: 50.5, maxLat: 53.5 },
  { minLon: -160.3, maxLon: -154.7, minLat: 18.9, maxLat: 22.3 },
  { minLon: -67.4, maxLon: -65.2, minLat: 17.8, maxLat: 18.6 },
];

function overlaps(a: StudyAreaBbox, b: StudyAreaBbox): boolean {
  return a.minLon <= b.maxLon && a.maxLon >= b.minLon && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

export function coversCejstGeography(bbox: StudyAreaBbox): boolean {
  return CEJST_ENVELOPES.some((envelope) => overlaps(bbox, envelope));
}

// Lazily materialize the lookup sets so importing this module (e.g. for the
// descriptor) never pays to build the Sets/Map until a lookup runs.
let coveredSet: Set<string> | null = null;
let disadvantagedSet: Set<string> | null = null;
let crosswalkMap: Map<string, string[]> | null = null;

function ensureSets(): {
  covered: Set<string>;
  disadvantaged: Set<string>;
  crosswalk: Map<string, string[]>;
} {
  if (!coveredSet || !disadvantagedSet || !crosswalkMap) {
    if (!Array.isArray(asset?.coveredGeoids) || !Array.isArray(asset?.disadvantagedGeoids)) {
      throw new DesignationSourceUnavailableError(
        CEJST_NATIONAL_SOURCE_ID,
        "bundled CEJST v1.0 communities asset is missing or malformed"
      );
    }
    coveredSet = new Set(asset.coveredGeoids);
    disadvantagedSet = new Set(asset.disadvantagedGeoids);
    crosswalkMap = new Map(Object.entries(crosswalkAsset?.crosswalk ?? {}));
  }
  return { covered: coveredSet, disadvantaged: disadvantagedSet, crosswalk: crosswalkMap };
}

/**
 * Resolve one (2020-vintage) GEOID to a CEJST determination.
 * - A CHANGED 2020 tract (in the crosswalk) resolves through its 2010 parent(s):
 *   determined if any parent is in CEJST; disadvantaged if ANY parent is
 *   disadvantaged (the conservative, benefit-of-the-doubt rule for a tract that
 *   straddles a disadvantaged and a non-disadvantaged 2010 tract).
 * - An UNCHANGED 2020 tract keeps its GEOID and is found by direct membership.
 * - Anything else has no CEJST record → undetermined (left out of the map).
 */
function resolveGeoid(
  geoid: string,
  covered: Set<string>,
  disadvantaged: Set<string>,
  crosswalk: Map<string, string[]>
): { disadvantaged: boolean; inferred: boolean } | undefined {
  const parents = crosswalk.get(geoid);
  if (parents) {
    const matched = parents.filter((parent) => covered.has(parent));
    if (matched.length === 0) return undefined;
    // Crosswalk resolution is an inference (renumbered tract → its 2010 parent[s]).
    return { disadvantaged: matched.some((parent) => disadvantaged.has(parent)), inferred: true };
  }
  if (covered.has(geoid)) return { disadvantaged: disadvantaged.has(geoid), inferred: false };
  return undefined;
}

async function lookupCejst(geoids: string[]): Promise<EquityDesignationLookup> {
  const { covered, disadvantaged, crosswalk } = ensureSets();
  const byGeoid = new Map<string, boolean>();
  const inferredGeoids = new Set<string>();

  for (const raw of geoids) {
    const geoid = String(raw).trim();
    // A geoid with no CEJST record (directly OR via the 2020→2010 crosswalk) is
    // left out of the map entirely → the caller reports it not_determined.
    const result = resolveGeoid(geoid, covered, disadvantaged, crosswalk);
    if (result === undefined) continue;
    byGeoid.set(geoid, result.disadvantaged);
    if (result.inferred) inferredGeoids.add(geoid);
  }

  // Counts derive from the DEDUPED map, so a duplicate or whitespace-variant
  // input geoid can never push disadvantagedTotal above determinedTotal (the
  // module invariant: disadvantaged ≤ determined ≤ requested).
  let disadvantagedTotal = 0;
  for (const isDisadvantaged of byGeoid.values()) {
    if (isDisadvantaged) disadvantagedTotal += 1;
  }

  // Only count inferences for geoids that actually landed in the deduped map.
  let inferredTotal = 0;
  for (const geoid of inferredGeoids) {
    if (byGeoid.has(geoid)) inferredTotal += 1;
  }

  return { byGeoid, determinedTotal: byGeoid.size, disadvantagedTotal, inferredTotal };
}

export const cejstNationalAdapter: EquityDesignationAdapter = {
  id: CEJST_NATIONAL_SOURCE_ID,
  label: "CEJST v1.0 (Justice40) — national",
  attribution:
    "Climate and Economic Justice Screening Tool (CEJST) v1.0, White House Council on Environmental Quality / U.S. Digital Service. Public domain. Discontinued program — frozen 2022-11-22 snapshot.",
  license: asset?.meta?.license ?? "Public domain (17 U.S.C. § 105)",
  version: asset?.meta?.version ?? "1.0",
  vintage: asset?.meta?.tractVintage ?? "2010",
  datasetLabel: asset?.meta?.datasetLabel ?? "CEJST v1.0 (2022-11-22) — discontinued-program snapshot",
  coverageState: "cejst_national",
  persistable: false,
  covers: coversCejstGeography,
  lookup: lookupCejst,
};
