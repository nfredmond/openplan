/**
 * Is this dropped pin inside the area the consultation is about?
 *
 * WHAT WAS WRONG. `/api/engage/[shareToken]/submit` validated a participant's
 * coordinate against the whole planet — latitude −90..90, longitude −180..180 —
 * and nothing else. A comment about a corridor study could be pinned in another
 * hemisphere, by a mis-tap or by someone with a point to make, and it entered the
 * record as ordinary participation: counted in the participation dashboard,
 * clustered by the hotspot screen, and eligible to be quoted in a report the
 * agency signs. A campaign has had an area of record since 20260729000003
 * (`place_*` on `engagement_campaigns`) and no submission was ever checked
 * against it.
 *
 * ═══ WHAT THIS MODULE IS, AND IS NOT ═══
 *
 * It is a pure geometric predicate. No Supabase client, no request, no policy.
 * It answers one question about one coordinate and one area, and it answers
 * "I did not check" as a first-class outcome rather than guessing. The decision
 * about what to DO with the answer — refuse, accept, disclose — belongs to the
 * route, because that is a decision about people and not about geometry.
 *
 * It is NOT a security control. A geofence protects the RECORD from locations
 * that are not about this consultation; it does not protect the consultation
 * from anyone. A determined participant can send a comment with no pin at all,
 * and should be able to: see NO COORDINATE below.
 *
 * ═══ ZERO NEW DEPENDENCIES, DELIBERATELY ═══
 *
 * `@turf/boolean-point-in-polygon` would do this in one line. It is not in this
 * project's package.json, and `context-layer-import.ts` states the posture this
 * module follows: a dependency has a supply-chain tail that outlives the feature
 * it was added for. Ray casting over a closed ring is fifty lines of arithmetic
 * that has not changed since 1962, so it is written here, narrowly, refusing
 * anything it cannot prove it understands.
 *
 * ═══ THE RULES, AND WHY EACH ONE IS THE WAY IT IS ═══
 *
 * ON THE BOUNDARY IS INSIDE. A resident standing at the edge of the study area
 * is in the study area. Ray casting alone answers on-edge points arbitrarily —
 * it depends which side of a vertex the ray happens to graze — so every segment
 * is tested for the point lying ON it BEFORE any crossing is counted, and a hit
 * returns inside. The same rule applies to the edge of a hole: the ring is the
 * boundary, and a boundary belongs to the thing it bounds.
 *
 * NO COORDINATE IS NOT OUTSIDE. A text comment with no pin has no location, and
 * a thing with no location cannot be outside an area. Refusing those would
 * silence every participant who did not use the map — a screen-reader user, a
 * phone that declined location, anyone writing about the plan as a whole rather
 * than a place in it — which is a far larger harm than the one being prevented.
 * `no_coordinate` is therefore its own verdict and never `outside`.
 *
 * BBOX FIRST, BOUNDARY SECOND. The bounding box is four comparisons and rejects
 * a pin in another hemisphere without touching the polygon. It is also SOUND as
 * a rejection on its own: the bbox contains the boundary, so outside-the-bbox
 * implies outside-the-boundary. It is NOT sound as an acceptance — a bbox around
 * a corridor is not that corridor — which is why an inside-the-bbox verdict
 * carries `basis: "bbox"` so the caller can decide whether to refine it.
 *
 * A BOUNDARY THAT CANNOT BE READ IS SAID, NOT ASSUMED. If the recorded geometry
 * is a shape this module does not understand, the verdict falls back to the bbox
 * and sets `boundaryUnreadable`. It never silently becomes a polygon answer
 * nobody computed. A caller that refuses on a bbox-only verdict is refusing on a
 * coarser test than the operator asked for, and it has to know that.
 *
 * ═══ THE WORLD IS ROUND, AND THIS CODE MUST NOT ASSUME OTHERWISE ═══
 *
 * 20260729000003 deliberately permits `place_min_lon > place_max_lon`, because a
 * bbox spanning the antimeridian legitimately has one — Fiji, Chukotka, the
 * western Aleutians — and forbidding it would bake a hemisphere into the schema
 * of a product meant to reach worldwide. So both tests here handle the wrap:
 *
 *   - the bbox test treats min > max as "wraps past ±180" and accepts either
 *     side, rather than producing an empty interval;
 *   - the ray cast runs in an UNWRAPPED longitude frame when a ring needs one, so
 *     a boundary running 179° → −179° is a two-degree shape and not a 358-degree
 *     one inside out.
 *
 * The unwrapping has a stated limit: a ring whose longitudes still span more than
 * 180° after unwrapping is ambiguous — the same vertex list describes two
 * complementary regions and nothing in the coordinates says which — so it is
 * reported as unreadable rather than answered. A consultation area that large is
 * not a study area, and a wrong answer here would refuse residents by the
 * thousand.
 */

import type { PlaceOfRecord, PlaceOfRecordBbox } from "@/lib/geographies/place-of-record";

/**
 * How far off a segment a point may be and still count as ON it.
 *
 * 1e-9 degrees is about a tenth of a millimetre at the equator — far below any
 * coordinate a participant or a boundary file can meaningfully carry, and large
 * enough that a point transcribed exactly onto an edge is not excluded by binary
 * floating point. It exists so "on the boundary is inside" is a rule and not a
 * coin toss.
 */
const ON_EDGE_EPSILON_DEGREES = 1e-9;

/** A ring spanning more than this cannot be disambiguated. See the header. */
const MAX_UNAMBIGUOUS_RING_SPAN_DEGREES = 180;

/** Which test produced the verdict. `bbox` is coarser than the operator asked for. */
export type GeofenceBasis = "bbox" | "boundary";

/** Why no check was run. Never a synonym for "outside". */
export type GeofenceUncheckedReason =
  /** The submission carried no coordinate. It has no location to be outside of. */
  | "no_coordinate"
  /** The campaign has no area on record, so there is nothing to test against. */
  | "no_area";

export type GeofenceVerdict =
  | {
      state: "inside" | "outside";
      basis: GeofenceBasis;
      /**
       * True when a boundary WAS recorded and could not be used, so this verdict
       * rests on the bbox alone. Carried rather than swallowed: a caller
       * refusing a participant deserves to know the test was the coarse one.
       */
      boundaryUnreadable: boolean;
    }
  | { state: "not_checked"; reason: GeofenceUncheckedReason };

export type GeofenceCoordinate = { latitude: number | null; longitude: number | null };

// ── Longitude arithmetic ─────────────────────────────────────────────────────

/**
 * `longitude` shifted by whole turns so it lands within 180° of `reference`.
 *
 * This is what makes a comparison across the antimeridian mean anything: −179.5
 * and 179.5 are one degree apart on the globe and 359 apart in the numbers.
 */
function alignLongitude(longitude: number, reference: number): number {
  return longitude - 360 * Math.round((longitude - reference) / 360);
}

/**
 * Does this bbox contain the point, inclusive of its edges?
 *
 * Longitude ordering is NOT assumed: `minLon > maxLon` means the box wraps past
 * ±180, and the interval is then the union of the two sides rather than empty.
 */
export function bboxContainsPoint(
  bbox: PlaceOfRecordBbox,
  longitude: number,
  latitude: number
): boolean {
  if (latitude < bbox.minLat || latitude > bbox.maxLat) return false;

  // Normalise the point into the same turn as the box's west edge, so a pin at
  // −179 is compared against a box running 178 → −178 as 181, not as −179.
  const lon = alignLongitude(longitude, bbox.minLon);

  if (bbox.minLon <= bbox.maxLon) {
    return lon >= bbox.minLon && lon <= bbox.maxLon;
  }

  // Wrapping box: [minLon, 180] ∪ [−180, maxLon], expressed continuously.
  return lon >= bbox.minLon && lon <= bbox.maxLon + 360;
}

// ── Boundary parsing ─────────────────────────────────────────────────────────

/** One vertex, as [longitude, latitude]. */
type Vertex = readonly [number, number];
/** A closed ring: outer ring first, holes after, exactly as GeoJSON orders them. */
type Ring = Vertex[];
/** A polygon's rings. */
type PolygonRings = Ring[];

function isVertex(value: unknown): value is Vertex {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function parseRing(value: unknown): Ring | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const ring: Vertex[] = [];
  for (const vertex of value) {
    if (!isVertex(vertex)) return null;
    ring.push([vertex[0], vertex[1]] as const);
  }
  return ring;
}

function parsePolygon(value: unknown): PolygonRings | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rings: Ring[] = [];
  for (const candidate of value) {
    const ring = parseRing(candidate);
    // A malformed hole is not a hole to skip — it is a shape nobody understands,
    // and dropping it would silently enlarge the area residents are tested
    // against. Refuse the whole polygon and let the caller disclose it.
    if (!ring) return null;
    rings.push(ring);
  }
  return rings;
}

/**
 * Normalise a recorded boundary into a list of polygons.
 *
 * Accepts what `place_geometry_geojson` actually holds — a bare `Polygon` or
 * `MultiPolygon`, which is all `resolvePlaceBoundary` and `projectPlaceFromDrawnArea`
 * ever write (both go through `corridorGeojsonSchema`) — plus a `Feature`
 * wrapping one, because a boundary that arrived from an import rather than the
 * picker is a shape a future owner of these columns may well store.
 *
 * Everything else returns null: a LineString has no interior, a
 * GeometryCollection has no single answer, and guessing at either would put a
 * fabricated area between a resident and their comment.
 */
export function parseGeofenceBoundary(geometry: unknown): PolygonRings[] | null {
  if (!geometry || typeof geometry !== "object") return null;

  const shape = geometry as { type?: unknown; coordinates?: unknown; geometry?: unknown };

  if (shape.type === "Feature") return parseGeofenceBoundary(shape.geometry);

  if (shape.type === "Polygon") {
    const polygon = parsePolygon(shape.coordinates);
    return polygon ? [polygon] : null;
  }

  if (shape.type === "MultiPolygon") {
    if (!Array.isArray(shape.coordinates) || shape.coordinates.length === 0) return null;
    const polygons: PolygonRings[] = [];
    for (const candidate of shape.coordinates) {
      const polygon = parsePolygon(candidate);
      if (!polygon) return null;
      polygons.push(polygon);
    }
    return polygons;
  }

  return null;
}

// ── Point in ring ────────────────────────────────────────────────────────────

/**
 * Re-express a ring in a continuous longitude frame, or refuse it.
 *
 * A ring that never crosses ±180 is returned untouched — the overwhelming
 * majority, and the arithmetic is then exact. A ring that does cross is rebuilt
 * relative to its own first vertex so 179 → −179 becomes 179 → 181 and the
 * segments stay short. A ring that is still wider than half the planet after
 * that is ambiguous and returns null; see the header for why that is refused
 * rather than answered.
 */
function continuousRing(ring: Ring): Ring | null {
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lon] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  if (maxLon - minLon <= MAX_UNAMBIGUOUS_RING_SPAN_DEGREES) return ring;

  const origin = ring[0][0];
  const unwrapped: Vertex[] = ring.map(([lon, lat]) => [alignLongitude(lon, origin), lat] as const);

  let unwrappedMin = Infinity;
  let unwrappedMax = -Infinity;
  for (const [lon] of unwrapped) {
    if (lon < unwrappedMin) unwrappedMin = lon;
    if (lon > unwrappedMax) unwrappedMax = lon;
  }

  if (unwrappedMax - unwrappedMin > MAX_UNAMBIGUOUS_RING_SPAN_DEGREES) return null;
  return unwrapped;
}

/** Is the point on the segment a→b, within the on-edge tolerance? */
function pointOnSegment(
  lon: number,
  lat: number,
  [ax, ay]: Vertex,
  [bx, by]: Vertex
): boolean {
  const cross = (bx - ax) * (lat - ay) - (by - ay) * (lon - ax);
  // Scale the collinearity tolerance by the segment's own size: a long edge
  // carries more absolute error in the cross product than a short one, and a
  // fixed threshold would be strict on one and loose on the other.
  const scale = Math.max(1, Math.abs(bx - ax) + Math.abs(by - ay));
  if (Math.abs(cross) > ON_EDGE_EPSILON_DEGREES * scale) return false;

  return (
    lon >= Math.min(ax, bx) - ON_EDGE_EPSILON_DEGREES &&
    lon <= Math.max(ax, bx) + ON_EDGE_EPSILON_DEGREES &&
    lat >= Math.min(ay, by) - ON_EDGE_EPSILON_DEGREES &&
    lat <= Math.max(ay, by) + ON_EDGE_EPSILON_DEGREES
  );
}

type RingResult = "inside" | "outside" | "on_edge" | "unreadable";

/**
 * Ray casting, with the on-edge case settled before any crossing is counted.
 *
 * The ray runs east from the point; each edge that straddles the point's
 * latitude and crosses to its east flips the parity. The half-open latitude test
 * (`>` on one end, `<=` on the other) is what stops a vertex exactly at the
 * point's latitude being counted twice.
 */
function pointInRing(ring: Ring, longitude: number, latitude: number): RingResult {
  const frame = continuousRing(ring);
  if (!frame) return "unreadable";

  const lon = alignLongitude(longitude, frame[0][0]);
  let inside = false;

  for (let i = 0, j = frame.length - 1; i < frame.length; j = i++) {
    const a = frame[i];
    const b = frame[j];

    if (pointOnSegment(lon, latitude, a, b)) return "on_edge";

    const straddles = a[1] > latitude !== b[1] > latitude;
    if (!straddles) continue;

    const crossingLon = a[0] + ((latitude - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
    if (lon < crossingLon) inside = !inside;
  }

  return inside ? "inside" : "outside";
}

/**
 * Inside a polygon means: inside its outer ring, and not strictly inside any of
 * its holes. On the edge of ANY ring — outer or hole — is inside, because the
 * ring is the boundary and a boundary belongs to what it bounds.
 */
function pointInPolygon(rings: PolygonRings, longitude: number, latitude: number): RingResult {
  const outer = pointInRing(rings[0], longitude, latitude);
  if (outer === "unreadable" || outer === "outside" || outer === "on_edge") return outer;

  for (let i = 1; i < rings.length; i += 1) {
    const hole = pointInRing(rings[i], longitude, latitude);
    if (hole === "unreadable") return "unreadable";
    if (hole === "on_edge") return "on_edge";
    if (hole === "inside") return "outside";
  }

  return "inside";
}

// ── The verdict ──────────────────────────────────────────────────────────────

/**
 * Is this coordinate inside this place of record?
 *
 * Takes a `PlaceOfRecord` rather than a campaign row on purpose: the shape is
 * owner-agnostic (src/lib/geographies/place-of-record.ts), so the same check
 * applies unchanged to a project's study area or a workspace's home geography
 * the day one of those wants it. Nothing here knows what a campaign is.
 *
 * `place.geometry` may legitimately be absent — the caller may have read the
 * scope columns only, because a boundary can be megabytes — in which case the
 * answer is the bbox answer, labelled as such.
 */
export function evaluateGeofence(
  place: Pick<PlaceOfRecord, "bbox" | "geometry">,
  coordinate: GeofenceCoordinate
): GeofenceVerdict {
  const area = readArea(place);
  return verdictFor(area, coordinate);
}

/**
 * The place, read ONCE.
 *
 * Split out because `evaluateGeofenceForAll` asks the same question of up to 200
 * vertices, and `parseGeofenceBoundary` walks and re-allocates every ring of the
 * recorded boundary — which for a county is tens of thousands of vertices. Doing
 * that per vertex would turn one submission into millions of throwaway arrays on
 * a route a member of the public is waiting on. It is read once and the parsed
 * result is reused; the arithmetic below allocates nothing.
 */
type ReadArea = {
  bbox: PlaceOfRecordBbox | null;
  boundary: PolygonRings[] | null;
  boundaryUnreadable: boolean;
};

function readArea(place: Pick<PlaceOfRecord, "bbox" | "geometry">): ReadArea {
  const boundary = place.geometry ? parseGeofenceBoundary(place.geometry) : null;
  return {
    bbox: place.bbox ?? null,
    boundary,
    boundaryUnreadable: Boolean(place.geometry) && boundary === null,
  };
}

function verdictFor(area: ReadArea, coordinate: GeofenceCoordinate): GeofenceVerdict {
  const { latitude, longitude } = coordinate;

  if (
    latitude === null ||
    longitude === null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return { state: "not_checked", reason: "no_coordinate" };
  }

  const { bbox, boundary, boundaryUnreadable } = area;

  if (!bbox && !boundary) return { state: "not_checked", reason: "no_area" };

  // Cheap, sound rejection first: the bbox contains the boundary, so a point
  // outside the box is outside the shape, and the polygon never has to be walked.
  if (bbox && !bboxContainsPoint(bbox, longitude, latitude)) {
    return { state: "outside", basis: "bbox", boundaryUnreadable };
  }

  if (!boundary) {
    return { state: "inside", basis: "bbox", boundaryUnreadable };
  }

  let anyUnreadable = false;
  for (const polygon of boundary) {
    const result = pointInPolygon(polygon, longitude, latitude);
    if (result === "inside" || result === "on_edge") {
      return { state: "inside", basis: "boundary", boundaryUnreadable: false };
    }
    if (result === "unreadable") anyUnreadable = true;
  }

  if (anyUnreadable) {
    // Some part of the shape could not be walked, so "outside every polygon" is
    // not established. Fall back to what IS established — the bbox said inside —
    // and mark the verdict as resting on the coarser test.
    return bbox
      ? { state: "inside", basis: "bbox", boundaryUnreadable: true }
      : { state: "not_checked", reason: "no_area" };
  }

  return { state: "outside", basis: "boundary", boundaryUnreadable: false };
}

/**
 * The same question about a SHAPE rather than a point: is every part of it
 * inside?
 *
 * WHY THIS IS NOT OPTIONAL. A participant does not only drop a pin. The portal's
 * map is a `GeometryPickerMap` and a comment may carry a Point, a LineString or
 * a Polygon, of which `engagement_items.latitude/longitude` keeps only the
 * VERTEX CENTROID (see `computeEngagementGeometryRepresentativePoint`). Checking
 * the centroid alone is not a weaker check, it is a bypassable one: a square
 * drawn around the study area has its centroid dead in the middle of it, so the
 * whole planet passes a test the operator was told means "only inside this
 * area", and the shape that gets stored — and drawn on the operator's map, and
 * clustered by the hotspot screen — is the one nobody checked.
 *
 * ALL, NOT ANY. Every vertex must be inside. That is what the operator control
 * says in words ("only accept comments pinned inside <area>"), and the opposite
 * rule — any vertex inside is enough — would accept a line with one end in the
 * corridor and the other in another hemisphere.
 *
 * The verdict returned for an outside shape is the verdict of the FIRST vertex
 * that failed, so its `basis` still says which test settled it. An empty list is
 * `no_coordinate`, for the same reason a missing pin is: nothing was submitted
 * that has a location.
 */
export function evaluateGeofenceForAll(
  place: Pick<PlaceOfRecord, "bbox" | "geometry">,
  coordinates: readonly GeofenceCoordinate[]
): GeofenceVerdict {
  if (coordinates.length === 0) return { state: "not_checked", reason: "no_coordinate" };

  // Read once, then asked up to 200 times. See `readArea`.
  const area = readArea(place);
  let settled: GeofenceVerdict | null = null;

  for (const coordinate of coordinates) {
    const verdict = verdictFor(area, coordinate);
    if (verdict.state === "outside") return verdict;

    if (!settled) {
      settled = verdict;
      continue;
    }

    // Keep the WEAKER of the answers seen so far, so a shape is never reported
    // on a firmer basis than its least-certain vertex: one vertex answered from
    // the bbox alone makes the whole shape a bbox answer, and one vertex whose
    // boundary could not be read makes the whole shape's boundary unread.
    if (verdict.state === "not_checked") {
      settled = verdict;
    } else if (settled.state !== "not_checked") {
      settled = {
        state: "inside",
        basis: settled.basis === "boundary" && verdict.basis === "boundary" ? "boundary" : "bbox",
        boundaryUnreadable: settled.boundaryUnreadable || verdict.boundaryUnreadable,
      };
    }
  }

  return settled ?? { state: "not_checked", reason: "no_coordinate" };
}

/**
 * Can this place be geofenced against at all?
 *
 * A bbox is the minimum: without one there is nothing to compare a coordinate
 * to, and an operator must never be offered a check that cannot run. Used by the
 * operator console to disable the control and say why, and by the update route
 * to refuse the flag outright — the same rule in both places, stated once.
 */
export function placeCanGeofence(place: Pick<PlaceOfRecord, "bbox"> | null | undefined): boolean {
  return Boolean(place?.bbox);
}

// ── The sentences ────────────────────────────────────────────────────────────

/**
 * What a participant is told when their pin falls outside.
 *
 * Three things it must do, and one it must not:
 *
 *   - name the real reason. "Invalid coordinates" is false — the coordinate is
 *     perfectly valid, it is somewhere else — and a bare 400 tells a member of
 *     the public that they broke something;
 *   - say what to do instead, including the route that always works: a comment
 *     with no pin is not outside anything and is still received;
 *   - name the area when the agency named it, so the participant can tell
 *     whether they mis-tapped or are genuinely out of scope.
 *
 * What it must NOT do is describe the boundary. No bbox, no coordinates, no
 * "your pin was 12 km east" — that is the agency's geometry, and a refusal is
 * not an oracle for probing it.
 */
export function geofenceRefusalMessage(areaLabel: string | null): string {
  const area = areaLabel?.trim()
    ? `outside ${areaLabel.trim()}, the area this consultation covers`
    : "outside the area this consultation covers";

  return `The location you marked is ${area}. Move it inside the area shown on the map, or remove it and send your comment without a location — comments with no location are still received.`;
}

/**
 * What a participant is told BEFORE they place a pin.
 *
 * Rendered with the map framing sentence, above the map itself, because a portal
 * that invites a pin it is going to refuse has wasted somebody's afternoon. It
 * deliberately says the no-pin route works, for the same reason the refusal
 * does: the check is about the record, not about who may speak.
 */
export function geofenceInviteSentence(areaLabel: string | null): string {
  const area = areaLabel?.trim() ? areaLabel.trim() : "the area this campaign covers";
  // "Anything you mark", not "a pin": the portal's map draws lines and areas as
  // well as points, and every part of what is drawn has to be inside. Promising
  // only that a PIN must be inside would be a smaller rule than the one enforced.
  return `Anything you mark on this map has to be inside ${area}; a comment sent without a location is accepted from anywhere.`;
}

/**
 * Why an operator cannot turn the check on, or cannot clear the area under it.
 *
 * Both are the same fact — a check with nothing to test against — and both are
 * enforced in the database by the `engagement_campaigns_geofence_needs_area`
 * CHECK (20260730000002). This function is what turns that constraint into a
 * sentence before it becomes a 500, and it lives here rather than in the route
 * so the console and the API refuse for the same stated reason.
 */
export function geofenceUpdateRefusal(next: {
  /** Whether the check would be ON after this update. */
  enabled: boolean;
  /** Whether an area with a usable extent would be on record after this update. */
  hasArea: boolean;
  /** Whether this update is what removes the area. */
  areaCleared: boolean;
}): string | null {
  if (!next.enabled || next.hasArea) return null;

  return next.areaCleared
    ? "This campaign only accepts pins inside its area, so clearing the area would leave that check with nothing to test. Turn the location check off first, or set a different area."
    : "This campaign has no area on record, so there is nothing to check a dropped pin against. Set the campaign area first, then turn the location check on.";
}

/** The column carrying the opt-in. Named once so no select string can misspell it. */
export const SUBMISSION_GEOFENCE_COLUMN = "submission_geofence_enabled";

/** What the submit route answers with, so the refusal is machine-readable too. */
export const OUTSIDE_CAMPAIGN_AREA_REASON = "outside_campaign_area";
