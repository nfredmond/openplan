/**
 * Turning a file's own coordinates into longitude and latitude.
 *
 * ═══ TAKES AN ENTRY, NEVER A CODE ═══
 *
 * This module runs in the BROWSER — a county parcels shapefile is fifty to two
 * hundred megabytes and never fits in a request body, so it is read and
 * transformed where it already is. The registry, on the other hand, is well
 * over a megabyte and belongs on the server, which is also the only place
 * allowed to DECIDE what a file's coordinate system is.
 *
 * Those two facts are why the signature here is what it is. The server resolves
 * the system and sends back one entry; this reprojects with it. Accepting a
 * code instead would drag the whole registry into a client bundle AND would let
 * a tab decide its own coordinate system, which is a claim rather than a
 * computation.
 *
 * ═══ WHAT IT DOES NOT DO ═══
 *
 * It does not change datum. The output is longitude and latitude on the entry's
 * OWN datum, which OpenPlan then draws as though it were WGS 84 — an assumption
 * that is worth a metre or two on NAD83 and well over a hundred metres on
 * NAD27. That is a real error and it is never hidden: `entry.datumShiftMetres`
 * carries its measured size and `entry.datumShiftNote` the sentence a planner
 * reads. Applying a datum shift properly needs NADCON or NTv2 grids, which are
 * tens of megabytes per region and a deliberate future decision — not something
 * to approximate here, because a wrong shift is worse than a disclosed one.
 */

import { inverseProject } from "./projections";
import type { CrsRegistryEntry } from "./types";

/**
 * One position, in the file's own units, to longitude/latitude in degrees.
 *
 * `unitToMetres` is applied HERE and not folded into the projection parameters,
 * because it describes the FILE's coordinates rather than the projection: the
 * same California zone 3 exists in metres and in US survey feet with identical
 * projection parameters, and it is the file that differs.
 */
export function reprojectPosition(
  entry: CrsRegistryEntry,
  x: number,
  y: number
): [number, number] {
  // A geographic system's coordinates are already degrees, so `unitToMetres`
  // must not touch them — but they are degrees measured from that system's own
  // PRIME MERIDIAN, which for eighteen entries here is not Greenwich. That
  // offset lives in `params.lon0` and `inverseProject` applies it.
  if (entry.method === "geographic") return inverseProject(entry.method, x, y, entry.params);
  return inverseProject(entry.method, x * entry.unitToMetres, y * entry.unitToMetres, entry.params);
}

/**
 * A whole GeoJSON geometry, in place-independent form.
 *
 * Returns null when any position fails to reproject — half a reprojected parcel
 * boundary is a WRONG parcel boundary rather than an incomplete one, and the
 * importer's own rule is the same. A non-finite result means the arithmetic
 * left the domain of the projection, which happens with coordinates that are
 * not in the system they were declared to be in.
 */
export function reprojectGeometry(
  entry: CrsRegistryEntry,
  geometry: GeoJSON.Geometry
): GeoJSON.Geometry | null {
  // Returned untouched only when the coordinates are ALREADY Greenwich
  // longitude/latitude. A geographic system on the Rome or Ferro meridian still
  // has to be shifted, so it takes the walking path like any other.
  if (entry.method === "geographic" && !entry.params.lon0) return geometry;

  const depthByType: Record<string, number> = {
    Point: 0,
    MultiPoint: 1,
    LineString: 1,
    MultiLineString: 2,
    Polygon: 2,
    MultiPolygon: 3,
  };
  const depth = depthByType[geometry.type];
  if (depth === undefined) return null;

  const walk = (value: unknown, remaining: number): unknown => {
    if (remaining === 0) {
      if (!Array.isArray(value) || value.length < 2) return null;
      const [x, y] = value as number[];
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      const [longitude, latitude] = reprojectPosition(entry, x, y);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
      return [longitude, latitude];
    }
    if (!Array.isArray(value) || value.length === 0) return null;
    const mapped: unknown[] = [];
    for (const item of value) {
      const next = walk(item, remaining - 1);
      if (next === null) return null;
      mapped.push(next);
    }
    return mapped;
  };

  const coordinates = walk((geometry as { coordinates: unknown }).coordinates, depth);
  if (coordinates === null) return null;
  return { type: geometry.type, coordinates } as GeoJSON.Geometry;
}

/**
 * The longitude/latitude box a projected extent occupies.
 *
 * Samples the EDGES rather than only the four corners. A projected rectangle is
 * not a rectangle in longitude and latitude — under a conic projection its top
 * and bottom edges bow — so a box built from the corners alone is smaller than
 * the data and would report a layer as fitting inside an area of use it
 * overhangs. Eight points per edge is far more than enough for the curvature of
 * any of these projections over a single zone.
 */
export function reprojectBbox(
  entry: CrsRegistryEntry,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): { west: number; south: number; east: number; north: number } | null {
  const steps = 8;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (let index = 0; index <= steps; index += 1) {
    const fraction = index / steps;
    const x = minX + (maxX - minX) * fraction;
    const y = minY + (maxY - minY) * fraction;
    for (const [px, py] of [
      [x, minY],
      [x, maxY],
      [minX, y],
      [maxX, y],
    ]) {
      const [longitude, latitude] = reprojectPosition(entry, px, py);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
      west = Math.min(west, longitude);
      east = Math.max(east, longitude);
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
    }
  }

  return { west, south, east, north };
}
