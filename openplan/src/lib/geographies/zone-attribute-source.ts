/**
 * Zone-attribute sources: where the demographic measures that a travel model's
 * zone table is built from actually come from.
 *
 * WHY THIS EXISTS
 *   The AequilibraE worker used to fetch ACS itself, reading `CENSUS_API_KEY`
 *   from the WORKER HOST. A workspace that brought its own Census key (the
 *   thing `integrations/providers.ts` advertises) therefore could not run a
 *   worker-backed model at all: the worker had no way to see that key, and its
 *   error told the reader to edit `openplan/.env.local` — a file a planner does
 *   not have and cannot reach. That is operator setup institutionalised in an
 *   error message, which this repo treats as a defect rather than a workaround.
 *
 *   The fix is to INVERT the fetch: the app already holds the workspace's key
 *   (decrypted per-request by `withWorkspaceIntegrationContext`), so the app
 *   reads the demographics and hands the worker a finished table. The worker
 *   keeps OSM and LODES, which are both keyless, and stops needing a secret of
 *   its own — which is also what makes a hosted worker pool tractable later.
 *
 * WHY THE MEASURE NAMES ARE NOT ACS VARIABLE CODES
 *   `B01003_001E` is a United States artifact. OpenPlan's current scope is the
 *   US, but the architecture may not assume it. So the wire vocabulary here is
 *   jurisdiction-neutral — `population`, `households`, and universe/count pairs
 *   for the three equity indicators — and each SOURCE maps its own tables onto
 *   that vocabulary. Adding a country means adding a descriptor + adapter to
 *   {@link ZONE_ATTRIBUTE_SOURCES} and teaching {@link resolveZoneAttributeSource}
 *   to choose between them — never editing the worker, the payload envelope, or
 *   any consumer of the measure names.
 *
 * WHAT AN ADAPTER OWES THE CALLER
 *   Either a table, or a REASON. A source that cannot answer must say why in
 *   words a planner can act on; "no rows" may never be presentable as "nothing
 *   is here". Every failure path below returns a reason string, and the run
 *   carries it through to the worker's evidence.
 */

import { censusApiKey, withCensusApiKey } from "@/lib/data-sources/census-api-key";
import { workspaceIntegrationKey } from "@/lib/integrations/context";
import { fetchJsonWithRetry } from "@/lib/data-sources/http";

/** Zone resolution a table is published at. Mirrors the worker's zone geography. */
export type ZoneAttributeLevel = "tract" | "block_group";

/**
 * The jurisdiction-neutral measure vocabulary. Universe/count pairs rather than
 * precomputed shares, so the worker keeps ONE definition of each equity share
 * (in `workers/aequilibrae_worker/equity.py`) instead of a second copy here
 * that could silently drift from it.
 *
 * `minorityCount` is deliberately the count of people OUTSIDE the local
 * reference group rather than "non-white": what counts as the reference group
 * is a jurisdictional question each adapter answers for itself.
 */
export const ZONE_ATTRIBUTE_MEASURES = [
  "population",
  "households",
  "lowIncomeUniverse",
  "lowIncomeCount",
  "minorityUniverse",
  "minorityCount",
  "zeroVehicleHouseholdUniverse",
  "zeroVehicleHouseholdCount",
] as const;

export type ZoneAttributeMeasure = (typeof ZONE_ATTRIBUTE_MEASURES)[number];

/** Measures the worker's zone builder needs to size productions/attractions. */
export const DEMOGRAPHIC_MEASURES: readonly ZoneAttributeMeasure[] = ["population", "households"];

/** Measures the worker's EJ/Title VI overlay needs. */
export const EQUITY_MEASURES: readonly ZoneAttributeMeasure[] = [
  "population",
  "lowIncomeUniverse",
  "lowIncomeCount",
  "minorityUniverse",
  "minorityCount",
  "zeroVehicleHouseholdUniverse",
  "zeroVehicleHouseholdCount",
];

/**
 * One table of measures, keyed by the geography id the worker will look up.
 * `rows` values are positional against `measures` — a columnar shape, because
 * an object-per-geography would roughly triple the payload for no gain.
 */
export type ZoneAttributeTable = {
  level: ZoneAttributeLevel;
  measures: readonly ZoneAttributeMeasure[];
  /** How each neutral measure was derived, for provenance (e.g. an ACS code). */
  measureProvenance: Record<string, string>;
  rows: Record<string, number[]>;
};

/** A table, or an honest reason there is none. Never an empty table. */
export type ZoneAttributeTableResult =
  | { status: "supplied"; table: ZoneAttributeTable }
  | { status: "unavailable"; reason: string };

export type ZoneAttributeSourceDescriptor = {
  id: string;
  label: string;
  /** Honest statement of where this source has data. Rendered, not inferred. */
  coverage: string;
  /** Data vintage actually queried (never a second literal that can drift). */
  vintage: string;
  /** Canonical retrieval URL for the vintage above — no key, no query. */
  retrievalUrl: string;
  /** Zone resolutions this source publishes. */
  supportedLevels: readonly ZoneAttributeLevel[];
};

export type ZoneAttributeSourceFetch = {
  descriptor: ZoneAttributeSourceDescriptor;
  /** Whose credential paid for the read, for provenance. */
  keyOrigin: "workspace" | "deployment_env" | "none";
  demographics: ZoneAttributeTableResult;
  equity: ZoneAttributeTableResult;
  /**
   * True when the geography index was truncated by the upstream service, so
   * the county set the tables cover may be incomplete. Recorded rather than
   * hidden: a short table is not the same claim as a complete one.
   */
  geographyIndexTruncated: boolean;
};

export type ZoneAttributeSourceAdapter = {
  descriptor: ZoneAttributeSourceDescriptor;
  /**
   * Fetch the tables covering `bbox`. Returns tables that are a SUPERSET of the
   * worker's own study-area clip: the worker still decides which geographies
   * are in the study area and looks each one up here, so extra rows are inert
   * and missing rows are what must never happen.
   */
  fetch(args: {
    bbox: ZoneAttributeBbox;
    equityLevel: ZoneAttributeLevel;
  }): Promise<ZoneAttributeSourceFetch>;
};

export type ZoneAttributeBbox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

// ─── United States: Census Bureau ACS 5-year ────────────────────────────────

/**
 * ACS 5-year vintage this adapter queries. Kept equal to the app's other ACS
 * reader (`data-sources/census.ts`) on purpose — two vintages in one study area
 * would put two different population bases behind one run.
 */
const US_ACS_YEAR = "2023";
const US_ACS_RETRIEVAL_URL = `https://api.census.gov/data/${US_ACS_YEAR}/acs/acs5`;

/**
 * TIGERweb layer 8 (2020 vintage) serves 12-digit block-group GEOIDs with
 * centroids; truncating to 11 digits gives the tract GEOID. The AequilibraE
 * worker queries this exact layer, so the geography index here and the worker's
 * own study-area clip are drawn from the same universe. `data-sources/census.ts`
 * holds its own copy of this URL for the sketch lane's corridor clip; both are
 * deliberate readers of the same layer rather than one shared mutable constant.
 */
const US_TIGER_GEOGRAPHY_LAYER =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/8/query";

/**
 * ACS variables backing each neutral measure at TRACT geography.
 *
 * `minorityCount` has no single ACS variable — it is B03002_001E minus
 * B03002_003E (total minus white-alone-not-Hispanic), the same derivation the
 * worker's equity module uses. The subtraction happens once, below.
 */
const US_TRACT_ACS_VARIABLES: Record<ZoneAttributeMeasure, string> = {
  population: "B01003_001E",
  households: "B11001_001E",
  lowIncomeUniverse: "B17001_001E",
  lowIncomeCount: "B17001_002E",
  minorityUniverse: "B03002_001E",
  minorityCount: "B03002_001E - B03002_003E",
  zeroVehicleHouseholdUniverse: "B25044_001E",
  zeroVehicleHouseholdCount: "B25044_003E + B25044_010E",
};

/**
 * Block-group variant. B17001 is NOT published at block-group geography — the
 * API answers HTTP 200 with null cells, which would silently zero the poverty
 * indicator — so the block-group-published income-to-poverty table C17002 backs
 * `lowIncome*` instead (under 0.50 plus 0.50–0.99 = below poverty, same universe
 * concept). This is the same substitution `equity.py` documents.
 */
const US_BLOCK_GROUP_ACS_VARIABLES: Record<ZoneAttributeMeasure, string> = {
  ...US_TRACT_ACS_VARIABLES,
  households: "B11001_001E",
  lowIncomeUniverse: "C17002_001E",
  lowIncomeCount: "C17002_002E + C17002_003E",
};

/** Raw ACS variables to request for one level (the union the mapping needs). */
const US_TRACT_REQUEST_VARIABLES = [
  "B01003_001E",
  "B11001_001E",
  "B17001_001E",
  "B17001_002E",
  "B03002_001E",
  "B03002_003E",
  "B25044_001E",
  "B25044_003E",
  "B25044_010E",
] as const;

const US_BLOCK_GROUP_REQUEST_VARIABLES = [
  "B01003_001E",
  "C17002_001E",
  "C17002_002E",
  "C17002_003E",
  "B03002_001E",
  "B03002_003E",
  "B25044_001E",
  "B25044_003E",
  "B25044_010E",
] as const;

export const US_CENSUS_ACS_DESCRIPTOR: ZoneAttributeSourceDescriptor = {
  id: "us_census_acs5",
  label: `American Community Survey ${US_ACS_YEAR} 5-year (US Census Bureau)`,
  // This sentence is RENDERED to a planner whose study area came back empty, so
  // it may not be more generous than the endpoint. ACS 5-year covers the 50
  // states, DC and Puerto Rico; the other US island areas (Guam, American
  // Samoa, the CNMI, the USVI) are enumerated by the Island Areas Censuses and
  // are NOT in this API. Saying "and the island areas" would tell a planner in
  // Guam they are covered while handing them nothing.
  coverage:
    "The 50 US states, the District of Columbia, and Puerto Rico. Other US island areas are not published in this API, and there is no coverage outside the United States.",
  vintage: US_ACS_YEAR,
  retrievalUrl: US_ACS_RETRIEVAL_URL,
  supportedLevels: ["tract", "block_group"],
};

const NO_KEY_REASON =
  "No US Census API key is available. A workspace owner or admin can add a free key under Settings -> Integrations (api.census.gov/data/key_signup.html); an operator can instead set CENSUS_API_KEY for the whole deployment.";

type TigerFeature = { attributes?: { GEOID?: unknown } };

type UsGeographyIndex = {
  /** state+county FIPS pairs whose geographies intersect the bbox. */
  counties: Array<{ state: string; county: string }>;
  truncated: boolean;
};

/**
 * Which counties the study-area bbox touches, derived from the SAME TIGERweb
 * layer the worker clips against, so the app cannot resolve a different county
 * set than the worker does.
 *
 * Deliberately NOT the corner-sampling geocoder lookup the sketch lane uses:
 * five sampled points miss interior counties of a large draw, and a missing
 * county here becomes zones the worker has no demographics for.
 */
async function fetchUsCountyIndexForBbox(bbox: ZoneAttributeBbox): Promise<UsGeographyIndex | null> {
  const url =
    `${US_TIGER_GEOGRAPHY_LAYER}?where=1%3D1` +
    `&geometry=${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}` +
    `&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects` +
    `&outFields=GEOID&returnGeometry=false&inSR=4326&resultRecordCount=5000&f=json`;

  const payload = await fetchJsonWithRetry<{
    features?: TigerFeature[];
    exceededTransferLimit?: boolean;
    error?: unknown;
  }>(url, undefined, {
    timeoutMs: 20000,
    retries: 1,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    cacheKey: `zone-attr-tiger:${bbox.minLon.toFixed(3)}:${bbox.minLat.toFixed(3)}:${bbox.maxLon.toFixed(3)}:${bbox.maxLat.toFixed(3)}`,
  });

  if (!payload || payload.error || !Array.isArray(payload.features)) return null;

  const seen = new Set<string>();
  const counties: Array<{ state: string; county: string }> = [];
  for (const feature of payload.features) {
    const geoid = String(feature.attributes?.GEOID ?? "");
    if (geoid.length < 5) continue;
    const key = geoid.slice(0, 5);
    if (seen.has(key)) continue;
    seen.add(key);
    counties.push({ state: geoid.slice(0, 2), county: geoid.slice(2, 5) });
  }

  return { counties, truncated: payload.exceededTransferLimit === true };
}

function acsNumber(raw: unknown): number {
  const value = Number.parseFloat(String(raw ?? ""));
  // The ACS encodes suppressed / not-applicable cells as large negative
  // sentinels (-666666666 and friends). Treating those as real counts would
  // put a negative population into a gravity model, so they clamp to zero the
  // same way `data-sources/census.ts` clamps them.
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Fetch one ACS level for one county and append its rows to `rows`.
 * Returns false when the county produced nothing, so the caller can tell
 * "some counties answered" from "none did".
 */
async function collectUsAcsCounty(args: {
  state: string;
  county: string;
  level: ZoneAttributeLevel;
  measures: readonly ZoneAttributeMeasure[];
  rows: Record<string, number[]>;
}): Promise<boolean> {
  const { state, county, level, measures, rows } = args;
  const isBlockGroup = level === "block_group";
  const requestVariables = isBlockGroup
    ? US_BLOCK_GROUP_REQUEST_VARIABLES
    : US_TRACT_REQUEST_VARIABLES;
  const forClause = isBlockGroup ? "block%20group:*" : "tract:*";
  const inClause = isBlockGroup
    ? `state:${state}%20county:${county}%20tract:*`
    : `state:${state}%20county:${county}`;

  // `withCensusApiKey` is the ONLY place that knows how to attach the key —
  // hand-rolling the parameter is what silently broke US county search, because
  // an unauthenticated Census request answers 302 -> missing_key.html rather
  // than an error. The adapter has already refused up front when no key exists,
  // so this can never quietly send a keyless request.
  const url = withCensusApiKey(
    `${US_ACS_RETRIEVAL_URL}?get=${requestVariables.join(",")}&for=${forClause}&in=${inClause}`
  );

  // The key is a query parameter, so the shared fetch helper refuses to cache
  // implicitly; an explicit cacheKey (which omits the key) opts the response
  // back into the 6-hour cache without ever writing a credential into a cache
  // key. Same posture as `data-sources/census.ts`.
  const payload = await fetchJsonWithRetry<string[][]>(url, undefined, {
    timeoutMs: 20000,
    retries: 1,
    cacheTtlMs: 6 * 60 * 60 * 1000,
    cacheKey: `zone-attr-acs:${US_ACS_YEAR}:${level}:${state}:${county}`,
  });

  if (!Array.isArray(payload) || payload.length < 2) return false;

  const header = payload[0];
  const columnOf = new Map(header.map((name, index) => [name, index]));
  const cell = (row: string[], name: string): number => {
    const index = columnOf.get(name);
    return index === undefined ? 0 : acsNumber(row[index]);
  };
  const idPart = (row: string[], name: string): string => {
    const index = columnOf.get(name);
    return index === undefined ? "" : String(row[index] ?? "");
  };

  let appended = 0;
  for (const row of payload.slice(1)) {
    const geoid = isBlockGroup
      ? idPart(row, "state") + idPart(row, "county") + idPart(row, "tract") + idPart(row, "block group")
      : idPart(row, "state") + idPart(row, "county") + idPart(row, "tract");
    if (geoid.length < 11) continue;

    const minorityUniverse = cell(row, "B03002_001E");
    const values: number[] = measures.map((measure) => {
      switch (measure) {
        case "population":
          return cell(row, "B01003_001E");
        case "households":
          return cell(row, "B11001_001E");
        case "lowIncomeUniverse":
          return isBlockGroup ? cell(row, "C17002_001E") : cell(row, "B17001_001E");
        case "lowIncomeCount":
          return isBlockGroup
            ? cell(row, "C17002_002E") + cell(row, "C17002_003E")
            : cell(row, "B17001_002E");
        case "minorityUniverse":
          return minorityUniverse;
        case "minorityCount":
          // Total minus the local reference group (white alone, not Hispanic).
          // Clamped at zero: ACS margins can make the component exceed the
          // universe, and a negative count would invert the share.
          return Math.max(0, minorityUniverse - cell(row, "B03002_003E"));
        case "zeroVehicleHouseholdUniverse":
          return cell(row, "B25044_001E");
        case "zeroVehicleHouseholdCount":
          return cell(row, "B25044_003E") + cell(row, "B25044_010E");
      }
    });

    rows[geoid] = values;
    appended += 1;
  }

  return appended > 0;
}

function usMeasureProvenance(
  measures: readonly ZoneAttributeMeasure[],
  level: ZoneAttributeLevel
): Record<string, string> {
  const table = level === "block_group" ? US_BLOCK_GROUP_ACS_VARIABLES : US_TRACT_ACS_VARIABLES;
  const out: Record<string, string> = {};
  for (const measure of measures) out[measure] = table[measure];
  return out;
}

export const usCensusZoneAttributeAdapter: ZoneAttributeSourceAdapter = {
  descriptor: US_CENSUS_ACS_DESCRIPTOR,

  async fetch({ bbox, equityLevel }) {
    // A workspace key wins over the deployment env (that is the whole point of
    // the integration wizard); `censusApiKey()` already implements that
    // precedence, and this only reports WHICH one answered.
    const apiKey = censusApiKey();
    const keyOrigin: ZoneAttributeSourceFetch["keyOrigin"] = !apiKey
      ? "none"
      : workspaceIntegrationKey("census")
        ? "workspace"
        : "deployment_env";

    const base = {
      descriptor: US_CENSUS_ACS_DESCRIPTOR,
      keyOrigin,
      geographyIndexTruncated: false,
    };

    if (!apiKey) {
      // Definitively knowable without a network call, so say the definite
      // thing rather than a vague "the source did not answer".
      return {
        ...base,
        demographics: { status: "unavailable", reason: NO_KEY_REASON },
        equity: { status: "unavailable", reason: NO_KEY_REASON },
      };
    }

    const index = await fetchUsCountyIndexForBbox(bbox);
    if (!index) {
      const reason =
        "The US Census TIGERweb geography service did not answer, so the counties covering this study area could not be resolved.";
      return {
        ...base,
        demographics: { status: "unavailable", reason },
        equity: { status: "unavailable", reason },
      };
    }
    if (index.counties.length === 0) {
      const reason = `The US Census TIGERweb geography service returned no census geographies for this study area. ${US_CENSUS_ACS_DESCRIPTOR.coverage}`;
      return {
        ...base,
        demographics: { status: "unavailable", reason },
        equity: { status: "unavailable", reason },
      };
    }

    // Demographics are always TRACT-level: the worker builds tract zones first
    // and disaggregates to block groups by keyless LODES residence share, so a
    // block-group run still needs the tract population/household marginals.
    const tractRows: Record<string, number[]> = {};
    const tractMeasures = Array.from(new Set([...DEMOGRAPHIC_MEASURES, ...EQUITY_MEASURES]));
    const tractAnswers = await Promise.all(
      index.counties.map(({ state, county }) =>
        collectUsAcsCounty({
          state,
          county,
          level: "tract",
          measures: tractMeasures,
          rows: tractRows,
        })
      )
    );
    const anyTractCounty = tractAnswers.some(Boolean);

    const tractFailureReason = `The US Census ACS ${US_ACS_YEAR} 5-year API returned no tract rows for the ${index.counties.length} county/counties covering this study area. The configured Census key may be invalid, or the service may be unavailable.`;

    const demographics: ZoneAttributeTableResult = anyTractCounty
      ? {
          status: "supplied",
          table: {
            level: "tract",
            measures: DEMOGRAPHIC_MEASURES,
            measureProvenance: usMeasureProvenance(DEMOGRAPHIC_MEASURES, "tract"),
            rows: projectRows(tractRows, tractMeasures, DEMOGRAPHIC_MEASURES),
          },
        }
      : { status: "unavailable", reason: tractFailureReason };

    let equity: ZoneAttributeTableResult;
    if (equityLevel === "tract") {
      equity = anyTractCounty
        ? {
            status: "supplied",
            table: {
              level: "tract",
              measures: EQUITY_MEASURES,
              measureProvenance: usMeasureProvenance(EQUITY_MEASURES, "tract"),
              rows: projectRows(tractRows, tractMeasures, EQUITY_MEASURES),
            },
          }
        : { status: "unavailable", reason: tractFailureReason };
    } else {
      const bgRows: Record<string, number[]> = {};
      const bgAnswers = await Promise.all(
        index.counties.map(({ state, county }) =>
          collectUsAcsCounty({
            state,
            county,
            level: "block_group",
            measures: EQUITY_MEASURES,
            rows: bgRows,
          })
        )
      );
      equity = bgAnswers.some(Boolean)
        ? {
            status: "supplied",
            table: {
              level: "block_group",
              measures: EQUITY_MEASURES,
              measureProvenance: usMeasureProvenance(EQUITY_MEASURES, "block_group"),
              rows: bgRows,
            },
          }
        : {
            status: "unavailable",
            reason: `The US Census ACS ${US_ACS_YEAR} 5-year API returned no block-group rows for this study area, so the equity overlay has no data at the run's zone geography.`,
          };
    }

    return { ...base, demographics, equity, geographyIndexTruncated: index.truncated };
  },
};

/** Re-slice a wide measure row down to the subset one table publishes. */
function projectRows(
  rows: Record<string, number[]>,
  from: readonly ZoneAttributeMeasure[],
  to: readonly ZoneAttributeMeasure[]
): Record<string, number[]> {
  const indices = to.map((measure) => from.indexOf(measure));
  const out: Record<string, number[]> = {};
  for (const [geoid, values] of Object.entries(rows)) {
    out[geoid] = indices.map((index) => (index < 0 ? 0 : (values[index] ?? 0)));
  }
  return out;
}

/**
 * The source registry. One entry today. A second country means appending an
 * adapter here — the worker, the payload envelope and the wire vocabulary all
 * stay untouched — plus a selection rule in `resolveZoneAttributeSource` below,
 * which today can only ever return the first entry.
 *
 * There is deliberately no bbox-based claim predicate: baking a coverage
 * rectangle into code is exactly the kind of hardcoded geography this product
 * forbids, and it would wrongly refuse territories the Census does publish.
 * Coverage is discovered by ASKING the source and reporting what it says — an
 * empty geography index comes back as a stated coverage limit, never as
 * "nothing found here".
 */
export const ZONE_ATTRIBUTE_SOURCES: readonly ZoneAttributeSourceAdapter[] = [
  usCensusZoneAttributeAdapter,
];

/**
 * The source a run reads from.
 *
 * HONEST LIMIT, stated rather than implied by the registry's shape: this picks
 * the FIRST entry and takes no study area, so with more than one adapter
 * registered it would silently always choose the same one. A second country is
 * therefore not yet a pure registry addition — it needs a selection rule here
 * too, and the design constraint on that rule is set above: no bbox predicate,
 * so selection must come from ASKING each source, not from a coverage rectangle
 * baked into code. Writing that rule against a single adapter would be guessing
 * at the second one's failure modes, so the seam is left visible instead.
 */
export function resolveZoneAttributeSource(): ZoneAttributeSourceAdapter {
  return ZONE_ATTRIBUTE_SOURCES[0];
}
