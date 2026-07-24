/**
 * Equity-designation adapter contract.
 *
 * A "designation" is an OFFICIAL, agency-assigned disadvantaged-community
 * determination for a census tract — the federal CEJST/Justice40 list, and
 * (future) California SB 535 / CalEnviroScreen, EPA EJScreen, or a non-US
 * equivalent. It is categorically different from the ACS income+burden PROXY in
 * `src/lib/data-sources/equity.ts`: a proxy is a screening heuristic OpenPlan
 * computes anywhere ACS exists; a designation is a real determination made by an
 * authority and can only ever be looked up, never synthesized.
 *
 * This mirrors the crash-source registry (`src/lib/safety/sources/`): coverage
 * grows by registering a jurisdiction-neutral adapter, not by editing callers.
 * The federal-ness of CEJST lives in one adapter descriptor — nothing
 * place-specific reaches a core type (non-negotiable #0).
 *
 * POSTURE — the load-bearing rule:
 *
 *   A tract is `disadvantaged` or `not_disadvantaged` ONLY when a designation
 *   source actually holds a record for it. A tract with no record is
 *   `not_determined` — never silently collapsed into `not_disadvantaged`, and
 *   never inferred from the income proxy. "Absent from the source" and
 *   "present and negative" are different facts, exactly as `matchedTotal` vs
 *   `geocodedTotal` are in the crash registry.
 *
 * Failure protocol: an adapter that cannot load its data THROWS
 * (`DesignationSourceUnavailableError`). An empty lookup result means "the
 * source answered and none of these tracts are designated" — a real finding.
 * Conflating the two would let an outage read as "no disadvantaged communities
 * here", which is the same class of bug the crash module guards against.
 */

import type { StudyAreaBbox } from "@/lib/models/study-area";

/** Tri-state federal/official disadvantaged-community determination for a study area. */
export type Justice40Status = "disadvantaged" | "not_disadvantaged" | "not_determined";

/** How the determination breaks down across the study-area tracts. */
export interface Justice40Coverage {
  /** Study-area tracts screened. */
  totalTracts: number;
  /** Tracts the designation source held a record for (disadvantaged or not). */
  determinedTracts: number;
  /** Tracts with NO record in the source — a vintage gap or no source at all. */
  undeterminedTracts: number;
  /** Determined tracts the source flags as disadvantaged. */
  disadvantagedTracts: number;
}

/**
 * A real designation determination, or an honest `not_determined`. This travels
 * with the equity screening so no consumer can present the income proxy as a
 * federal Justice40 designation.
 */
export interface Justice40Determination {
  status: Justice40Status;
  /** Adapter id that answered (e.g. "cejst-national"); null when none ran. */
  source: string | null;
  /** Human label incl. version + discontinued-program caveat; null when none ran. */
  datasetLabel: string | null;
  /** Dataset version (e.g. "1.0"); null when none ran. */
  version: string | null;
  /** Tract-keying vintage (e.g. "2010"); null when none ran. */
  vintage: string | null;
  coverage: Justice40Coverage;
}

/** Result of an adapter looking up a set of tract GEOIDs. */
export interface EquityDesignationLookup {
  /**
   * geoid → isDisadvantaged, ONLY for geoids the source holds a record for.
   * A geoid absent from this map is `not_determined` (no record), NOT `false`.
   */
  byGeoid: Map<string, boolean>;
  /** How many of the requested geoids the source held a record for. */
  determinedTotal: number;
  /** Of those, how many are flagged disadvantaged. */
  disadvantagedTotal: number;
}

/** What a resolved designation source can say about a study area. */
export type EquityDesignationCoverageState =
  | "cejst_national"
  | "out_of_coverage"
  | "source_unavailable";

export interface EquityDesignationAdapter {
  /** Stable id; also the future DB CHECK domain if this source becomes persistable. */
  id: string;
  label: string;
  /** Required attribution, rendered wherever this source's determination appears. */
  attribution: string;
  license: string;
  /** Dataset version (e.g. "1.0"). */
  version: string;
  /** Tract-keying vintage (e.g. "2010"). */
  vintage: string;
  /** Human dataset label incl. the discontinued-program caveat. */
  datasetLabel: string;
  coverageState: EquityDesignationCoverageState;
  /**
   * May determinations from this source be WRITTEN to a table?
   *
   * The bundled asset is read-only by design; a DB ingest path would flip this
   * in the same migration that widens any `source_id` CHECK — the same
   * read-coverage-vs-write-coverage boundary the crash registry uses.
   */
  persistable: boolean;
  /** Coarse geographic envelope test — does this source cover the study area at all? */
  covers: (bbox: StudyAreaBbox) => boolean;
  /**
   * Look up the given tract GEOIDs. THROWS `DesignationSourceUnavailableError`
   * if the source cannot be loaded — never returns empty-as-negative.
   */
  lookup: (geoids: string[]) => Promise<EquityDesignationLookup>;
}

/** What the resolver returns when nothing covers the study area. */
export type EquityDesignationResolution =
  | { kind: "resolved"; adapter: EquityDesignationAdapter }
  | { kind: "out_of_coverage"; checked: Array<{ id: string; label: string }> };

/**
 * Thrown by an adapter when its data could not be loaded. Exists so
 * "unavailable" can never be silently summarized as "no disadvantaged tracts".
 */
export class DesignationSourceUnavailableError extends Error {
  readonly sourceId: string;

  constructor(sourceId: string, message: string) {
    super(message);
    this.name = "DesignationSourceUnavailableError";
    this.sourceId = sourceId;
  }
}

/**
 * The honest zero-value: no source ran, every tract undetermined. `screenEquity`
 * defaults to this so it can NEVER fabricate a designation from the proxy.
 */
export function notDeterminedJustice40(totalTracts: number): Justice40Determination {
  return {
    status: "not_determined",
    source: null,
    datasetLabel: null,
    version: null,
    vintage: null,
    coverage: {
      totalTracts,
      determinedTracts: 0,
      undeterminedTracts: totalTracts,
      disadvantagedTracts: 0,
    },
  };
}
