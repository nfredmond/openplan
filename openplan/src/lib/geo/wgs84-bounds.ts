/**
 * "Is this rectangle a place on Earth?" — asked once, in one file.
 *
 * ═══ WHY THIS IS NOT INLINE AT EACH CALL SITE ═══
 *
 * A `[west, south, east, north]` tuple arrives at OpenPlan from three different
 * directions — a query string a browser built, a jsonb column an ingest wrote,
 * a viewport a map reported — and every one of them can hand over a rectangle
 * that is not a rectangle: `NaN` from a truncated parse, a latitude of 4 500
 * 000 from coordinates that were never reprojected out of survey feet, or an
 * east that is west of its west because the four numbers were assembled in the
 * wrong order.
 *
 * Each of those has exactly one correct response, and it is the same one: say
 * no. A camera that flies somewhere wrong and a query window that selects the
 * wrong hemisphere are the same defect wearing different clothes, and neither
 * announces itself — a map showing the wrong place looks precisely like a map
 * showing the right one.
 *
 * So the range rules live here rather than being retyped at each caller, for
 * the reason any shared capability is extracted: the second copy is the one
 * that gets a `>=` where the first had a `>`, and nothing downstream can tell.
 *
 * PURE — no I/O, no environment access, safe in the browser.
 */

/** WGS 84 degrees, in the order every OpenPlan surface writes them. */
export type Wgs84Bbox = [west: number, south: number, east: number, north: number];

function readFourFiniteNumbers(value: unknown): Wgs84Bbox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map((entry) => (typeof entry === "number" ? entry : Number.NaN));
  if (!numbers.every((entry) => Number.isFinite(entry))) return null;
  return [numbers[0], numbers[1], numbers[2], numbers[3]];
}

/**
 * A rectangle on Earth, or null.
 *
 * DEGENERATE IS ALLOWED HERE, and that is the whole difference between this and
 * `readWgs84Viewport` below. A layer holding one point has an extent whose west
 * equals its east; that is a real, correctly recorded extent, and refusing it
 * would make the commonest single-feature upload the one case with no camera.
 * A viewport of zero area, by contrast, selects nothing and can only be a bug.
 *
 * Every one of the four numbers is range-checked in its own right rather than
 * inferring the other two from the ordering rule, so this stays correct if a
 * caller ever needs the ordering relaxed.
 */
export function readWgs84Bbox(value: unknown): Wgs84Bbox | null {
  const bbox = readFourFiniteNumbers(value);
  if (!bbox) return null;
  const [west, south, east, north] = bbox;
  if (west < -180 || west > 180 || east < -180 || east > 180) return null;
  if (south < -90 || south > 90 || north < -90 || north > 90) return null;
  // An antimeridian-crossing extent is stored west > east elsewhere in the
  // product (see `area-of-use.ts`, which wraps rather than inverting). Nothing
  // that consumes THIS helper can express a wrapped rectangle — a camera needs
  // two corners and a query window needs a range — so a west east of its east
  // is refused rather than silently read as a rectangle round the back of the
  // world. When a Pacific-crossing layer needs framing, it needs a wrap-aware
  // caller, not a looser check here.
  if (west > east || south > north) return null;
  return bbox;
}

/**
 * A rectangle that also encloses some area — a window to select or draw inside.
 *
 * Built on the same range rules as `readWgs84Bbox` so a caller cannot end up
 * with a stricter parse in one place and a looser one in the other.
 */
export function readWgs84Viewport(value: unknown): Wgs84Bbox | null {
  const bbox = readWgs84Bbox(value);
  if (!bbox) return null;
  const [west, south, east, north] = bbox;
  if (west === east || south === north) return null;
  return bbox;
}

/** True when the extent is a single position rather than an area. */
export function isDegenerateBbox(bbox: Wgs84Bbox): boolean {
  return bbox[0] === bbox[2] && bbox[1] === bbox[3];
}
