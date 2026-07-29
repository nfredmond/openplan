/**
 * A place of record, with no owner's prefix on it.
 *
 * A workspace states where the agency works (`home_geography_*`, 20260723000005)
 * and a project states the area it studies (`place_*`, 20260728000009). Those are
 * the same SHAPE — which resolver produced it, what that resolver calls the kind,
 * the id in its namespace, a label, ISO jurisdiction codes, a bbox, a boundary —
 * differing only in column prefix and in what they mean.
 *
 * Everything downstream cares about the shape and not the owner: a study-area
 * prefill, a county filter, a map frame. So both narrow into this before any of
 * that logic sees them, and the prefill/precedence code is written once rather
 * than once per owner.
 *
 * This module deliberately holds no reference to `workspaces` or `projects`.
 * It sits below both so neither has to import the other, and so a third owner
 * (an RTP cycle, a plan) can adopt it without rearranging anything.
 */

export type PlaceOfRecordBbox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

export type PlaceOfRecord = {
  /** Resolver that produced this area — 'tigerweb', or 'drawn' for a hand-drawn boundary. */
  source: string | null;
  /** The resolver's own kind vocabulary. Opaque to core code. */
  kind: string | null;
  /** Id within that resolver's namespace. Always null for a drawn area. */
  ref: string | null;
  label: string | null;
  countryCode: string | null;
  subdivisionCode: string | null;
  bbox: PlaceOfRecordBbox | null;
  /** The boundary itself. Only this makes an area inheritable — a bbox cannot seed a run. */
  geometry: unknown;
};

/** Source value for an area a planner drew rather than searched for. */
export const DRAWN_PLACE_SOURCE = "drawn";

export const EMPTY_PLACE_OF_RECORD: PlaceOfRecord = {
  source: null,
  kind: null,
  ref: null,
  label: null,
  countryCode: null,
  subdivisionCode: null,
  bbox: null,
  geometry: null,
};

/**
 * A drawn area has a shape but no identity.
 *
 * Modules that need a jurisdiction — county onboarding, stage-gate templates,
 * grant program eligibility — must branch on this rather than assume the shape
 * can be resolved to a place. Guessing which county contains a drawn polygon is
 * exactly the plausible-looking wrong answer this codebase refuses.
 */
/**
 * The same place with its boundary dropped.
 *
 * A TIGERweb county boundary can be megabytes, and a place of record crosses the
 * server/client boundary whenever a control needs to reason about WHICH county
 * this is. Naming the omission makes it deliberate, rather than a spread someone
 * later "completes".
 */
export function placeIdentityOnly(place: PlaceOfRecord): PlaceOfRecord {
  return { ...place, geometry: null };
}

export function placeHasResolvableIdentity(place: PlaceOfRecord | null | undefined): boolean {
  if (!place?.source) return false;
  if (place.source === DRAWN_PLACE_SOURCE) return false;
  return Boolean(place.ref);
}

/** Whether this place can seed a study area at all — i.e. it carries a boundary. */
export function placeCanSeedStudyArea(place: PlaceOfRecord | null | undefined): boolean {
  return Boolean(place?.geometry);
}

function visitCoordinates(coordinates: unknown, visit: (lon: number, lat: number) => void): void {
  if (!Array.isArray(coordinates)) return;
  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    visit(coordinates[0], coordinates[1]);
    return;
  }
  for (const child of coordinates) visitCoordinates(child, visit);
}

/**
 * Bounding box of a GeoJSON geometry, or null when it carries no coordinates.
 *
 * Used for a DRAWN area, where no resolver supplied an extent. A searched place
 * always carries the resolver's own bbox and must keep it — recomputing from the
 * polygon would silently disagree with the source of record.
 */
export function bboxOfGeometry(geometry: unknown): PlaceOfRecordBbox | null {
  const shape = geometry as { coordinates?: unknown } | null;
  if (!shape || typeof shape !== "object") return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  visitCoordinates(shape.coordinates, (lon, lat) => {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  });

  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Centre of a bbox, wrapping correctly across the antimeridian.
 *
 * A bbox whose min_lon exceeds its max_lon spans the date line (Fiji, Chukotka,
 * parts of the Aleutians); averaging those two numbers puts the centre on the
 * opposite side of the planet. The schema deliberately permits that ordering, so
 * every reader has to handle it.
 */
export function bboxCenter(bbox: PlaceOfRecordBbox): { lat: number; lng: number } {
  const lat = (bbox.minLat + bbox.maxLat) / 2;

  if (bbox.minLon <= bbox.maxLon) {
    return { lat, lng: (bbox.minLon + bbox.maxLon) / 2 };
  }

  const span = 360 - bbox.minLon + bbox.maxLon;
  const lng = bbox.minLon + span / 2;
  return { lat, lng: lng > 180 ? lng - 360 : lng };
}
