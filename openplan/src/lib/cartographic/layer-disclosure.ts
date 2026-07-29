/**
 * What a map layer must say about its own completeness.
 *
 * Every `/api/map-features/*` route caps its result set. The cap was silent:
 * six routes carried an identical `TODO(pagination)` comment and a bare
 * `.limit(500)`, so a workspace with 600 projects saw 500 dots and no
 * indication that 100 were missing. A map that quietly omits a third of the
 * record is the same defect class as a data source that quietly returns
 * nothing — the viewer's honest conclusion ("this is everything") is wrong, and
 * nothing on screen contradicts it.
 *
 * Field names deliberately mirror `SafetyCrashQueryResponse`
 * (`src/lib/safety/client-types.ts`), which already got this right, so the two
 * read as one vocabulary rather than two conventions.
 *
 * PURE — no I/O, no clock.
 */

/** How many features one `/api/map-features/*` response will carry. */
export const MAP_FEATURE_LAYER_LIMIT = 500;

/**
 * The same cap, lowered by an order of magnitude for boundary polygons.
 *
 * A project's stored area is a TIGERweb boundary, and a county one runs to tens
 * or hundreds of kilobytes even at the resolver's four-decimal precision — two
 * to three orders of magnitude heavier per feature than a point or a corridor
 * line. Five hundred of them is a payload no navigation should pull. The number
 * is derived from the shared cap rather than invented so the relationship stays
 * legible: areas are roughly ten times the weight, so ten times fewer are drawn,
 * and the truncation is disclosed by the same contract as every other layer.
 */
export const PROJECT_AREA_LAYER_LIMIT = MAP_FEATURE_LAYER_LIMIT / 10;

export type MapLayerKey =
  | "projects"
  | "projectAreas"
  | "rtp"
  | "corridors"
  | "engagement"
  | "aerial"
  | "equity"
  | "crashes";

/** The counts that keep a map layer honest. */
export type MapLayerDisclosure = {
  /** Features this response actually carries — what the map draws. */
  returnedCount: number;
  /** Rows matching this layer's scope in the database. */
  matchedCount: number;
  /** Rows fetched but not drawable (unusable geometry/coordinates). */
  droppedCount: number;
  /** True when the map is a subset of what matched. */
  truncated: boolean;
  limit: number;
};

/**
 * A GeoJSON FeatureCollection carrying its own disclosure.
 *
 * Intersected rather than wrapped, so `map.addSource({ data })` still takes the
 * payload directly — GeoJSON foreign members are legal and Mapbox ignores them.
 */
export type MapLayerFeatureCollection<F> = {
  type: "FeatureCollection";
  features: F[];
} & MapLayerDisclosure;

export function buildMapLayerDisclosure(input: {
  returnedCount: number;
  droppedCount: number;
  /** PostgREST's exact count, or null when it was not requested/available. */
  matchedCount: number | null | undefined;
  limit?: number;
}): MapLayerDisclosure {
  const limit = input.limit ?? MAP_FEATURE_LAYER_LIMIT;
  const fetched = input.returnedCount + input.droppedCount;
  const matchedCount =
    typeof input.matchedCount === "number" && Number.isFinite(input.matchedCount)
      ? input.matchedCount
      : fetched;

  return {
    returnedCount: input.returnedCount,
    matchedCount,
    droppedCount: input.droppedCount,
    truncated: fetched < matchedCount,
    limit,
  };
}

const LAYER_NOUNS: Record<MapLayerKey, { singular: string; plural: string }> = {
  projects: { singular: "project", plural: "projects" },
  projectAreas: { singular: "project area", plural: "project areas" },
  rtp: { singular: "RTP cycle", plural: "RTP cycles" },
  corridors: { singular: "study corridor", plural: "study corridors" },
  engagement: { singular: "engagement pin", plural: "engagement pins" },
  aerial: { singular: "aerial mission", plural: "aerial missions" },
  equity: { singular: "census tract", plural: "census tracts" },
  // Present so a FAILED crash fetch has a sentence. Everything the crash layer
  // says when it succeeds comes from `describeCrashLayerCoverage`, which knows
  // about source coverage and acquisition history — facts this generic
  // vocabulary cannot express, and without which an empty layer reads as
  // "no crashes here".
  crashes: { singular: "crash", plural: "crashes" },
};

/**
 * The sentences a viewer needs for one layer.
 *
 * Returns a list rather than a string: a layer can be BOTH truncated and
 * carrying undrawable rows, and appending the second to the first would let a
 * non-truncated layer hide its drops entirely.
 */
export function describeMapLayerCoverage(
  key: MapLayerKey,
  disclosure: MapLayerDisclosure
): string[] {
  const notes: string[] = [];
  const noun = LAYER_NOUNS[key];

  if (disclosure.truncated) {
    notes.push(
      `${noun.plural[0].toUpperCase()}${noun.plural.slice(1)}: showing ` +
        `${disclosure.returnedCount.toLocaleString()} of ${disclosure.matchedCount.toLocaleString()} — ` +
        `the map draws at most ${disclosure.limit.toLocaleString()}. The rest are not drawn, which is not ` +
        `a finding that they do not exist.`
    );
  }

  if (disclosure.droppedCount > 0) {
    const count = disclosure.droppedCount;
    notes.push(
      `${noun.plural[0].toUpperCase()}${noun.plural.slice(1)}: ${count.toLocaleString()} ` +
        `${count === 1 ? noun.singular : noun.plural} could not be drawn because the stored location was ` +
        `unusable, so ${count === 1 ? "it is" : "they are"} missing from the map rather than absent from ` +
        `the record.`
    );
  }

  return notes;
}

/** A layer whose fetch failed outright — distinct from one that came back empty. */
export function describeMapLayerFailure(key: MapLayerKey): string {
  const noun = LAYER_NOUNS[key];
  return (
    `${noun.plural[0].toUpperCase()}${noun.plural.slice(1)}: this layer could not be loaded, so nothing ` +
    `is drawn for it. That is not a finding that there are none here.`
  );
}
