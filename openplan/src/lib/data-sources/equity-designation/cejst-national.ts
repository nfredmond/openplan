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
// descriptor) never pays to build two 30–74k-entry Sets until a lookup runs.
let coveredSet: Set<string> | null = null;
let disadvantagedSet: Set<string> | null = null;

function ensureSets(): { covered: Set<string>; disadvantaged: Set<string> } {
  if (!coveredSet || !disadvantagedSet) {
    if (!Array.isArray(asset?.coveredGeoids) || !Array.isArray(asset?.disadvantagedGeoids)) {
      throw new DesignationSourceUnavailableError(
        CEJST_NATIONAL_SOURCE_ID,
        "bundled CEJST v1.0 communities asset is missing or malformed"
      );
    }
    coveredSet = new Set(asset.coveredGeoids);
    disadvantagedSet = new Set(asset.disadvantagedGeoids);
  }
  return { covered: coveredSet, disadvantaged: disadvantagedSet };
}

async function lookupCejst(geoids: string[]): Promise<EquityDesignationLookup> {
  const { covered, disadvantaged } = ensureSets();
  const byGeoid = new Map<string, boolean>();

  for (const raw of geoids) {
    const geoid = String(raw).trim();
    // Only tracts the snapshot actually holds are "determined". A geoid absent
    // from the covered set (e.g. a 2020-vintage tract renumbered since 2010) is
    // left out of the map entirely → the caller reports it not_determined.
    if (!covered.has(geoid)) continue;
    byGeoid.set(geoid, disadvantaged.has(geoid));
  }

  // Counts derive from the DEDUPED map, so a duplicate or whitespace-variant
  // input geoid can never push disadvantagedTotal above determinedTotal (the
  // module invariant: disadvantaged ≤ determined ≤ requested).
  let disadvantagedTotal = 0;
  for (const isDisadvantaged of byGeoid.values()) {
    if (isDisadvantaged) disadvantagedTotal += 1;
  }

  return { byGeoid, determinedTotal: byGeoid.size, disadvantagedTotal };
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
