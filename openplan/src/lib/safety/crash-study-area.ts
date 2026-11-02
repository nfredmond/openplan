/**
 * Which crashes belong to a study area: inside its boundary, or only inside the
 * rectangle around it.
 *
 * Every crash source is queried with a bounding rectangle, because that is what
 * their APIs accept. A rectangle is the study area only when the area is a
 * rectangle. Around Alturas, California, 9 of the 11 CCRS crashes in the city's
 * rectangle (2022 to 2025, including the only injury crash) lie outside the city
 * limits; the Navajo Nation rectangle takes in Flagstaff, Gallup and Farmington.
 * So when a boundary polygon is known, crashes are kept only when their point
 * lies inside it (on the line counts as inside), and the number left out is
 * recorded beside the counts.
 *
 * When only a rectangle is known the crashes are kept as they are, and the
 * acquisition says so. Acquisitions stored before this check existed carry no
 * study-area entry and were all counted by rectangle, so an absent entry reads
 * as the rectangle.
 *
 * The geometry test is the engagement geofence's (`src/lib/engagement/geofence.ts`):
 * holes, multipolygons, points on the boundary and the antimeridian are handled
 * there once. No new dependency.
 */

import { createGeofenceTester } from "@/lib/engagement/geofence";
import type { StudyAreaBbox } from "@/lib/models/study-area";

/** What the crash counts are bounded by. */
type CrashAreaBasis = "place_boundary" | "bounding_rectangle";

/** Where the boundary came from, when one was applied. */
type CrashBoundarySource = "project_place" | "picked_place" | "drawn_area";

/**
 * The study-area entry recorded on an acquisition.
 *
 * Stored under `CRASH_STUDY_AREA_COVERAGE_KEY` in `safety_crash_ingests.dimension_coverage`,
 * the acquisition's coverage metadata. It is not a crash dimension: no facet,
 * column or filter is named `study_area`, and `facetAvailability` reads only the
 * keys it declares. It lives there because every acquisition projection already
 * selects that column, including the frozen Safety plan snapshot, so the basis
 * travels into reports and SS4A packets without changing any retained bytes.
 */
export type CrashStudyAreaCoverage = {
  basis: CrashAreaBasis;
  /** Null when no boundary was applied. */
  boundarySource: CrashBoundarySource | null;
  /**
   * Crashes inside the query rectangle but outside the boundary, left out of
   * every count. Null when no boundary was applied: nothing was tested, which
   * is not the same as nothing falling outside.
   */
  outsideBoundaryCount: number | null;
  /** A boundary was supplied but could not be read, so the rectangle was used. */
  boundaryUnreadable: boolean;
};

const CRASH_STUDY_AREA_COVERAGE_KEY = "study_area";

/** A boundary polygon for the study area, with where it came from. */
export type CrashStudyBoundary = {
  geometry: unknown;
  source: CrashBoundarySource;
};

const RECTANGLE_ONLY: CrashStudyAreaCoverage = {
  basis: "bounding_rectangle",
  boundarySource: null,
  outsideBoundaryCount: null,
  boundaryUnreadable: false,
};

/**
 * Keep the records whose point lies inside the boundary.
 *
 * With no boundary, every record is kept and the basis is the rectangle. A
 * boundary the geofence cannot read, in whole or for any record, keeps every
 * record and records the rectangle with `boundaryUnreadable`: a partly applied
 * boundary would be a count on neither basis.
 */
export function clipCrashRecordsToBoundary<T extends { latitude: number; longitude: number }>(
  records: readonly T[],
  bbox: StudyAreaBbox,
  boundary: CrashStudyBoundary | null | undefined
): { records: T[]; studyArea: CrashStudyAreaCoverage } {
  if (!boundary || boundary.geometry === null || boundary.geometry === undefined) {
    return { records: [...records], studyArea: RECTANGLE_ONLY };
  }

  const test = createGeofenceTester({ bbox, geometry: boundary.geometry });
  const unreadable: CrashStudyAreaCoverage = { ...RECTANGLE_ONLY, boundaryUnreadable: true };
  const inside: T[] = [];
  let outside = 0;

  for (const record of records) {
    const verdict = test({ latitude: record.latitude, longitude: record.longitude });
    if (verdict.state === "not_checked") {
      return { records: [...records], studyArea: unreadable };
    }
    if (verdict.boundaryUnreadable) {
      return { records: [...records], studyArea: unreadable };
    }
    if (verdict.state === "inside") {
      // Inside the rectangle but answered from the rectangle alone means the
      // shape was never walked for this point.
      if (verdict.basis !== "boundary") return { records: [...records], studyArea: unreadable };
      inside.push(record);
    } else {
      outside += 1;
    }
  }

  // An empty acquisition still has to prove the boundary is readable.
  if (records.length === 0) {
    const probe = test({ latitude: bbox.minLat, longitude: bbox.minLon });
    if (probe.state === "not_checked" || probe.boundaryUnreadable) {
      return { records: [], studyArea: unreadable };
    }
  }

  return {
    records: inside,
    studyArea: {
      basis: "place_boundary",
      boundarySource: boundary.source,
      outsideBoundaryCount: outside,
      boundaryUnreadable: false,
    },
  };
}

const BOUNDARY_SOURCES: readonly CrashBoundarySource[] = ["project_place", "picked_place", "drawn_area"];

/**
 * Read the study-area entry from an acquisition's `dimension_coverage`.
 *
 * Absent or unreadable means the rectangle, because every acquisition stored
 * before this entry existed was counted by rectangle. Never the boundary on a
 * guess.
 */
export function readCrashStudyAreaCoverage(dimensionCoverage: unknown): CrashStudyAreaCoverage {
  if (!dimensionCoverage || typeof dimensionCoverage !== "object") return RECTANGLE_ONLY;
  const entry = (dimensionCoverage as Record<string, unknown>)[CRASH_STUDY_AREA_COVERAGE_KEY];
  if (!entry || typeof entry !== "object") return RECTANGLE_ONLY;
  const raw = entry as Record<string, unknown>;
  const unreadable = raw.boundaryUnreadable === true;
  if (raw.basis !== "place_boundary") return { ...RECTANGLE_ONLY, boundaryUnreadable: unreadable };
  const outside = raw.outsideBoundaryCount;
  if (typeof outside !== "number" || !Number.isSafeInteger(outside) || outside < 0) return RECTANGLE_ONLY;
  const source = BOUNDARY_SOURCES.find((candidate) => candidate === raw.boundarySource) ?? null;
  if (!source) return RECTANGLE_ONLY;
  return { basis: "place_boundary", boundarySource: source, outsideBoundaryCount: outside, boundaryUnreadable: false };
}

/** The acquisition coverage with the study-area entry added. */
export function withCrashStudyAreaCoverage<T extends Record<string, unknown>>(
  dimensionCoverage: T,
  studyArea: CrashStudyAreaCoverage
): T & { [CRASH_STUDY_AREA_COVERAGE_KEY]: CrashStudyAreaCoverage } {
  return { ...dimensionCoverage, [CRASH_STUDY_AREA_COVERAGE_KEY]: studyArea };
}

/** Short label for a fact table. */
export function crashAreaBasisLabel(studyArea: CrashStudyAreaCoverage): string {
  if (studyArea.basis === "bounding_rectangle") return "Bounding rectangle, not the place boundary";
  return studyArea.boundarySource === "drawn_area" ? "Drawn study area boundary" : "Place boundary";
}

function crashes(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "crash" : "crashes"}`;
}

/**
 * The sentence shown wherever the counts are shown.
 *
 * `truncated` matters only for a boundary: records past the retrieval cap were
 * never fetched, so they were never tested against it.
 */
export function describeCrashStudyArea(studyArea: CrashStudyAreaCoverage, truncated = false): string {
  if (studyArea.basis === "place_boundary") {
    const outside = studyArea.outsideBoundaryCount ?? 0;
    const counted = studyArea.boundarySource === "drawn_area"
      ? "Crashes are counted inside the drawn study area boundary."
      : "Crashes are counted inside the place boundary.";
    const leftOut = outside > 0
      ? ` ${crashes(outside)} inside its bounding rectangle but outside the boundary ${outside === 1 ? "is" : "are"} left out.`
      : "";
    const cap = truncated
      ? " Records past the retrieval cap were not retrieved, so they were not checked against the boundary."
      : "";
    return `${counted}${leftOut}${cap}`;
  }
  const lead = studyArea.boundaryUnreadable
    ? "The place boundary could not be read, so crashes are counted inside its bounding rectangle"
    : "Crashes are counted inside the study area's bounding rectangle, not the place boundary";
  return `${lead}, so these counts can include crashes outside the place.`;
}

/**
 * Approximate ground area of a polygon or multipolygon, in square miles.
 *
 * Each ring is projected at its own mean latitude (equirectangular), holes
 * subtract, and the result is good to a few percent for a city, county or
 * reservation. That is the precision a crashes-per-square-mile screen needs and
 * the precision the bounding-rectangle area it replaces never had. Null for a
 * shape that is not a polygon.
 */
export function boundaryAreaSquareMiles(geometry: unknown): number | null {
  const shape = geometry as { type?: unknown; coordinates?: unknown } | null;
  if (!shape || typeof shape !== "object") return null;
  const polygons = shape.type === "Polygon"
    ? [shape.coordinates]
    : shape.type === "MultiPolygon" && Array.isArray(shape.coordinates)
      ? shape.coordinates
      : null;
  if (!polygons) return null;

  const MILES_PER_DEGREE = 69.0;
  let total = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon)) return null;
    polygon.forEach((ring: unknown, index: number) => {
      if (!Array.isArray(ring) || ring.length < 3) return;
      const points = ring.filter(
        (vertex): vertex is [number, number] =>
          Array.isArray(vertex) && Number.isFinite(vertex[0]) && Number.isFinite(vertex[1])
      );
      const meanLat = points.reduce((sum, [, lat]) => sum + lat, 0) / Math.max(1, points.length);
      const lonScale = MILES_PER_DEGREE * Math.cos((meanLat * Math.PI) / 180);
      let twice = 0;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        twice += points[j][0] * lonScale * points[i][1] * MILES_PER_DEGREE
          - points[i][0] * lonScale * points[j][1] * MILES_PER_DEGREE;
      }
      const ringArea = Math.abs(twice) / 2;
      total += index === 0 ? ringArea : -ringArea;
    });
  }
  return total > 0 ? total : null;
}
