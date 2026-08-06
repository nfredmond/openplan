/**
 * The rectangle arithmetic the transit registry needs, in one place.
 *
 * `bboxAreaSquareMiles` is the same degrees-to-miles approximation
 * `crashes.ts` uses, kept identical on purpose: stop density and crash density
 * appear side by side on the same scorecard, and two different approximations of
 * the same rectangle would make the two densities describe two different areas.
 */

import type { StudyAreaBbox } from "@/lib/models/study-area";

/** Statute miles per degree of latitude. The same constant `crashes.ts` uses. */
const MILES_PER_DEGREE = 69.0;

export function bboxAreaSquareMiles(bbox: StudyAreaBbox): number {
  const latMid = (bbox.minLat + bbox.maxLat) / 2;
  const latDist = Math.abs(bbox.maxLat - bbox.minLat) * MILES_PER_DEGREE;
  const lonDist =
    Math.abs(bbox.maxLon - bbox.minLon) * MILES_PER_DEGREE * Math.cos((latMid * Math.PI) / 180);
  // Floored so a degenerate rectangle cannot divide a density by zero. A study
  // area this small is smaller than a single city block.
  return Math.max(0.01, latDist * lonDist);
}

/** True when the two rectangles share any area at all (edges touching counts). */
export function bboxesIntersect(a: StudyAreaBbox, b: StudyAreaBbox): boolean {
  return a.minLon <= b.maxLon && a.maxLon >= b.minLon && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

/** True when `outer` fully contains `inner`. */
export function bboxContains(outer: StudyAreaBbox, inner: StudyAreaBbox): boolean {
  return (
    outer.minLon <= inner.minLon &&
    outer.maxLon >= inner.maxLon &&
    outer.minLat <= inner.minLat &&
    outer.maxLat >= inner.maxLat
  );
}
