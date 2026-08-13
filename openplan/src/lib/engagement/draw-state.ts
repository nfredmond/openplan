/**
 * THE RESIDENT'S SKETCH, AS PURE STATE — shared by every map that lets a member
 * of the public draw a point, a line, or an area.
 *
 * WHY IT IS ITS OWN MODULE. These four functions used to live privately inside
 * `geometry-picker-map.tsx`. There are now two maps that let a resident draw:
 * that picker (still mounted by the survey's `map_point` question and by the
 * about-page submission form) and `public-map-stage.tsx`, the full-screen
 * participant map. A shared capability that lives inside one of its two callers
 * gets reimplemented — slightly differently — by the other, and the difference
 * here would be silent: a vertex cap enforced on one map and not the other, or
 * a polygon closed with a duplicated first coordinate on one and not the other,
 * produce geometry the submit route accepts and the operator console draws
 * wrongly.
 *
 * Everything here is PURE. No map instance, no React, no DOM — which is what
 * lets the same rules be unit-tested without a live Mapbox canvas, and what
 * lets the keyboard path and the pointer path share one implementation instead
 * of agreeing by inspection.
 *
 * Caption text deliberately does NOT live here. Each map words its own status
 * line: the picker's is English prose written for a form field, and the
 * participant map's comes out of the portal message catalog in the resident's
 * language. The GEOMETRY rules are the thing that must not differ; the wording
 * is allowed to.
 */

import { ENGAGEMENT_GEOMETRY_MAX_VERTICES, type EngagementGeometry } from "./geometry";

export type EngagementDrawMode = "point" | "line" | "area";

export type DrawState = {
  mode: EngagementDrawMode;
  vertices: [number, number][];
  areaClosed: boolean;
};

export const EMPTY_DRAW_STATE: DrawState = { mode: "point", vertices: [], areaClosed: false };

/**
 * The geometry a draw state currently amounts to, or null when it is not yet a
 * shape. A polygon repeats its first coordinate to close the ring, which is what
 * GeoJSON requires and what `readStoredEngagementGeometry` expects back.
 */
export function deriveGeometry(state: DrawState): EngagementGeometry | null {
  if (state.mode === "point") {
    return state.vertices.length === 1 ? { type: "Point", coordinates: state.vertices[0] } : null;
  }

  if (state.mode === "line") {
    return state.vertices.length >= 2 ? { type: "LineString", coordinates: [...state.vertices] } : null;
  }

  if (state.areaClosed && state.vertices.length >= 3) {
    return { type: "Polygon", coordinates: [[...state.vertices, state.vertices[0]]] };
  }

  return null;
}

/**
 * Append a vertex, honoring point-mode replace semantics, the closed-area lock,
 * and the vertex cap. `outcome` is what drives the screen-reader announcement,
 * so a refused vertex is distinguishable from an accepted one without the caller
 * comparing states.
 */
export function appendVertex(
  state: DrawState,
  coord: [number, number]
): { next: DrawState; outcome: "placed" | "added" | "closed-locked" | "limit" } {
  if (state.mode === "point") {
    return { next: { ...state, vertices: [coord], areaClosed: false }, outcome: "placed" };
  }
  if (state.mode === "area" && state.areaClosed) {
    return { next: state, outcome: "closed-locked" };
  }
  if (state.vertices.length >= ENGAGEMENT_GEOMETRY_MAX_VERTICES) {
    return { next: state, outcome: "limit" };
  }
  return { next: { ...state, vertices: [...state.vertices, coord] }, outcome: "added" };
}

/** What the map paints while the resident is still drawing. */
export function buildPreviewFeatureCollection(state: DrawState): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = state.vertices.map((position, index) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: position },
    properties: { index },
  }));

  if (state.mode === "area" && state.areaClosed && state.vertices.length >= 3) {
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...state.vertices, state.vertices[0]]] },
      properties: {},
    });
  } else if (state.vertices.length >= 2 && state.mode !== "point") {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: state.vertices },
      properties: {},
    });
  }

  return { type: "FeatureCollection", features };
}

/** Round to the precision the submit route stores, in one place. */
export function drawCoordinate(lng: number, lat: number): [number, number] {
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}
