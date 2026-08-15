/**
 * The packet's "where is this project" figure — drawn, not fetched.
 *
 * WHY A DRAWN SHAPE RATHER THAN A BASEMAP IMAGE. Three reasons, in the order
 * they bite:
 *
 * 1. OpenPlan must work with no Mapbox token. The public engagement portal
 *    already has a whole honest no-map path for exactly that deployment, and a
 *    board packet that silently drops its map on a tokenless install would be a
 *    new silent gap — one a reader cannot see, because a missing figure looks
 *    like a project with no geometry.
 * 2. A fetched image is a network call inside PDF generation. That pipeline
 *    runs headless and has already been bitten by a network wait (see the
 *    `networkidle0` removal in `pdf.ts`); a tile server having a slow morning
 *    must not be able to hang a deliverable.
 * 3. One code path cannot drift from a second one. The figure is built from the
 *    same coordinates the project record holds and nothing else.
 *
 * THE COST, AND WHY IT IS STATED OUT LOUD. This is a shape, not a map: no
 * streets, no place names, no imagery. A board member who mistook it for a
 * survey would be misled about the most consequential thing in the packet, so
 * `caveats` always carries at least one sentence saying what the drawing is,
 * and the section that renders it prints those sentences as text — never as a
 * tooltip, never as fine print the text-tier PDF drops.
 *
 * PURE — no I/O, no clock, no environment. Identical input yields an identical
 * figure, which is what lets the two PDF tiers stay in step.
 *
 * WHAT THE TEXT TIER SEES. `pdf-text.ts` discards `<svg>` outright, so the
 * built-in typesetter renders none of the drawing. Every fact the picture
 * carries — which pieces exist, what they are called, the extent in degrees,
 * the scale, the caveats — is therefore returned here as TEXT as well, so the
 * built-in tier loses the picture and not the content.
 */

import {
  bboxOfGeometry,
  DRAWN_PLACE_SOURCE,
  placeHasResolvableIdentity,
  type PlaceOfRecord,
  type PlaceOfRecordBbox,
} from "@/lib/geographies/place-of-record";

/**
 * The section key the geography figure renders under.
 *
 * It lives HERE rather than in `html.ts` or `catalog.ts` because both of those
 * need it and `html.ts` already imports `catalog.ts` — naming it in either one
 * would close a module cycle. This file imports nothing from `reports/`.
 */
export const PROJECT_GEOGRAPHY_SECTION_KEY = "project_geography";

/** The heading the section carries, in the wizard and in the packet. */
export const PROJECT_GEOGRAPHY_SECTION_TITLE = "Where this project is";

/**
 * Whether a feeding read succeeded, and if not, why it could not.
 *
 * `unreadable` is NOT `ok` with nothing in it. "This project has no corridors"
 * and "this packet could not find out whether it has corridors" are different
 * claims, and a packet that prints the first when the second is true has told a
 * board something nobody established.
 */
export type PacketGeographyReadState = "ok" | "schema_pending" | "unreadable";

export type PacketGeographyCorridor = {
  id: string;
  name: string;
  corridorType: string | null;
  geometry: unknown;
};

export type PacketGeographyMarker = {
  latitude: number;
  longitude: number;
};

export type PacketGeographyInput = {
  /** The project's area of record. Null when the project has none. */
  studyArea: PlaceOfRecord | null;
  studyAreaReadState: PacketGeographyReadState;
  corridors: PacketGeographyCorridor[];
  corridorReadState: PacketGeographyReadState;
  /** True when the corridor read hit its cap, so the drawing is not all of them. */
  corridorLimitReached: boolean;
  /** The site point on the project record (`projects.latitude/longitude`). */
  marker: PacketGeographyMarker | null;
  /** The workspace home geography's name, used only to explain a missing area. */
  workspaceFallbackLabel: string | null;
};

export type PacketGeographyShapeKind = "area" | "extent-box" | "corridor" | "marker";

/** One drawable element, already projected into the figure's own units. */
export type PacketGeographyShape = {
  kind: PacketGeographyShapeKind;
  /** SVG path data for an area/extent-box/corridor; null for a marker. */
  d: string | null;
  /** Marker centre, in figure units. Null for everything else. */
  point: { x: number; y: number } | null;
  /** The index badge drawn on a corridor, and its anchor. Null when unlabelled. */
  badge: { text: string; x: number; y: number } | null;
};

export type PacketGeographyLegendEntry = {
  kind: PacketGeographyShapeKind;
  label: string;
  detail: string;
};

export type PacketGeographyScaleBar = {
  /** Bar length in figure units. */
  lengthUnits: number;
  /** What that length means on the ground, already humanised. */
  label: string;
};

export type PacketGeographyFigure = {
  /** True when at least one coordinate was available to draw. */
  hasDrawing: boolean;
  /** Figure viewBox, in the figure's own units. Zero when nothing is drawn. */
  widthUnits: number;
  heightUnits: number;
  shapes: PacketGeographyShape[];
  legend: PacketGeographyLegendEntry[];
  /** Bottom-left scale bar, or null when no flat scale would be correct. */
  scaleBar: PacketGeographyScaleBar | null;
  /** Sentences stating what exists. Always safe to print; may be empty. */
  contents: string[];
  /** The extent in degrees, as a sentence. Null when nothing is drawn. */
  extentStatement: string | null;
  /** North-up statement, plus the scale sentence or the reason there is none. */
  orientationStatement: string | null;
  scaleStatement: string | null;
  /** What the reader must not conclude. Never empty when anything is drawn. */
  caveats: string[];
  /** Set only when there is nothing to draw: what that means and what to do. */
  emptyStatement: string | null;
  emptyNextStep: string | null;
};

/** Figure geometry, in the figure's own units (1 unit ≈ 1 CSS px at print size). */
const FIGURE_WIDTH = 720;
const FIGURE_MAX_HEIGHT = 470;
const FIGURE_MIN_HEIGHT = 190;
const FIGURE_PADDING = 22;

/**
 * How far the flat (equirectangular) scale may disagree with the ground before
 * no bar is drawn at all.
 *
 * The figure holds latitude and longitude on straight axes, with longitude
 * compressed by cos(centre latitude). That is faithful to well under a percent
 * across a city or a county and visibly wrong across a state, so the bar is
 * computed, CHECKED against the true parallel length at the extent's own
 * north and south edges, and withheld when the check fails. An incorrect scale
 * bar on a board document is worse than no scale bar, and "worse" here means a
 * reader measuring a distance off it and being wrong.
 */
const MAX_SCALE_DISTORTION = 0.02;

/** Beyond this many corridors the drawing stops numbering them. */
const MAX_BADGED_CORRIDORS = 24;

/** Vertices are rounded to this many figure units before de-duplication. */
const VERTEX_QUANTUM = 0.5;

/** Hard ceiling per ring after de-duplication, so one pathological outline cannot bloat a PDF. */
const MAX_VERTICES_PER_RING = 6000;

const DEG = Math.PI / 180;

/**
 * Length of one degree of latitude at φ, on WGS84, in metres.
 *
 * Series form rather than a flat 111,320: the flat figure is ~0.5% out at the
 * ends of its range, and this costs three cosines.
 */
function metresPerDegreeLatitude(latitudeDeg: number): number {
  const phi = latitudeDeg * DEG;
  return (
    111132.92 -
    559.82 * Math.cos(2 * phi) +
    1.175 * Math.cos(4 * phi) -
    0.0023 * Math.cos(6 * phi)
  );
}

/** Length of one degree of longitude at φ, on WGS84, in metres. */
function metresPerDegreeLongitude(latitudeDeg: number): number {
  const phi = latitudeDeg * DEG;
  return 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi);
}

type LonLat = { lon: number; lat: number };

/** Every ring/line a geometry contributes, as raw lon/lat. */
type RawShape = {
  kind: PacketGeographyShapeKind;
  /** Closed rings for an area, open lines for a corridor, one point for a marker. */
  rings: LonLat[][];
  closed: boolean;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Pull coordinate rings out of anything GeoJSON-shaped.
 *
 * Deliberately permissive about the wrapper (Feature, FeatureCollection,
 * GeometryCollection) because a hand-drawn area arrives from a draw control and
 * a resolver boundary arrives from TIGERweb, and the two have not always agreed
 * about how deep the geometry sits. Anything it cannot understand contributes
 * NOTHING rather than a guess — an unreadable shape must not become a drawn one.
 */
function collectRings(geometry: unknown, out: { rings: LonLat[][]; points: LonLat[] }): void {
  if (!geometry || typeof geometry !== "object") return;

  const node = geometry as {
    type?: unknown;
    coordinates?: unknown;
    geometry?: unknown;
    geometries?: unknown;
    features?: unknown;
  };

  if (Array.isArray(node.features)) {
    for (const feature of node.features) collectRings(feature, out);
    return;
  }
  if (Array.isArray(node.geometries)) {
    for (const child of node.geometries) collectRings(child, out);
    return;
  }
  if (node.geometry && typeof node.geometry === "object") {
    collectRings(node.geometry, out);
    return;
  }

  const type = typeof node.type === "string" ? node.type : null;
  const coordinates = node.coordinates;
  if (!type || !Array.isArray(coordinates)) return;

  const asPosition = (value: unknown): LonLat | null => {
    if (!Array.isArray(value)) return null;
    const [lon, lat] = value;
    if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lon, lat };
  };

  const asLine = (value: unknown): LonLat[] => {
    if (!Array.isArray(value)) return [];
    const line: LonLat[] = [];
    for (const position of value) {
      const point = asPosition(position);
      if (point) line.push(point);
    }
    return line;
  };

  switch (type) {
    case "Point": {
      const point = asPosition(coordinates);
      if (point) out.points.push(point);
      return;
    }
    case "MultiPoint": {
      for (const position of coordinates) {
        const point = asPosition(position);
        if (point) out.points.push(point);
      }
      return;
    }
    case "LineString": {
      const line = asLine(coordinates);
      if (line.length >= 2) out.rings.push(line);
      return;
    }
    case "MultiLineString":
    case "Polygon": {
      for (const child of coordinates) {
        const line = asLine(child);
        if (line.length >= 2) out.rings.push(line);
      }
      return;
    }
    case "MultiPolygon": {
      for (const polygon of coordinates) {
        if (!Array.isArray(polygon)) continue;
        for (const child of polygon) {
          const line = asLine(child);
          if (line.length >= 2) out.rings.push(line);
        }
      }
      return;
    }
    default:
      return;
  }
}

function corridorTypeLabel(corridorType: string | null): string {
  if (!corridorType) return "corridor";
  return corridorType.replaceAll("_", " ");
}

/** A humanised ground distance, metric first with the US customary equivalent. */
function describeGroundDistance(metres: number): string {
  const metric =
    metres >= 1000
      ? `${Number((metres / 1000).toPrecision(3))} km`
      : `${Number(metres.toPrecision(3))} m`;
  const miles = metres / 1609.344;
  const customary =
    miles >= 0.25
      ? `${Number(miles.toPrecision(2))} mi`
      : `${Number((metres * 3.280839895).toPrecision(2))} ft`;
  return `${metric} (${customary})`;
}

function formatLatitude(value: number): string {
  const hemisphere = value >= 0 ? "N" : "S";
  return `${Math.abs(value).toFixed(3)}°${hemisphere}`;
}

function formatLongitude(value: number): string {
  const hemisphere = value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(3)}°${hemisphere}`;
}

/** A "nice" round number (1, 2 or 5 × 10ⁿ) at or below `value`. */
function niceRoundDown(value: number): number {
  if (!(value > 0)) return 0;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const mantissa = value / magnitude;
  const stepped = mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1;
  return stepped * magnitude;
}

/**
 * The name to print for the study area, and whether it can be trusted as a
 * place.
 *
 * A DRAWN area gets no invented identity. `place_label` on a drawn area is
 * whatever the planner typed in a text box, so it is printed as a name the
 * planner gave the shape — never as a jurisdiction, and never alone.
 */
function describeStudyArea(place: PlaceOfRecord): {
  title: string;
  detail: string;
  caveat: string | null;
} {
  const resolvable = placeHasResolvableIdentity(place);
  const drawn = place.source === DRAWN_PLACE_SOURCE;
  const label = place.label?.trim() || null;

  if (resolvable) {
    return {
      title: label ?? "Study area",
      detail:
        "The project's area of record — a place that was searched for, so the boundary, the county filter and the jurisdiction can all be re-derived from it.",
      caveat: null,
    };
  }

  if (drawn) {
    return {
      title: label ? `${label} (drawn by hand)` : "Study area drawn by hand",
      detail:
        "A shape somebody drew on the map. It has an extent but no place identity, so nothing in this packet can say which city, county or district it falls in.",
      caveat:
        label
          ? `“${label}” is the name the drawn shape was given on the project record, not a place this packet resolved. The area was drawn by hand, so it has an extent but no place identity.`
          : "The study area was drawn by hand, so it has an extent but no place identity. Do not read a city, county or district off this drawing.",
    };
  }

  return {
    title: label ?? "Study area",
    detail:
      "An area recorded on the project without a resolved place identity, so no jurisdiction can be derived from it.",
    caveat:
      "This project's study area carries no resolved place identity, so nothing in this packet can say which jurisdiction it falls in.",
  };
}

const FIGURE_NATURE_CAVEAT =
  "This drawing is made only from the coordinates on the project record. There is no basemap behind it — no streets, no place names, no aerial imagery — and it is not a survey. Read it for the extent and for how the pieces sit relative to one another, not to locate a line on the ground.";

function readStateSentence(subject: string, state: PacketGeographyReadState): string | null {
  if (state === "ok") return null;
  if (state === "schema_pending") {
    return `${subject} could not be read at generation time because this deployment's database is missing the columns that hold it. That is not the same as there being none — the packet does not know.`;
  }
  return `${subject} could not be read at generation time. That is not the same as there being none — the packet does not know.`;
}

/**
 * Build the figure. See the module comment for why it is drawn rather than
 * fetched, and what the caller is obliged to print alongside it.
 */
export function buildPacketGeographyFigure(input: PacketGeographyInput): PacketGeographyFigure {
  const contents: string[] = [];
  const caveats: string[] = [];
  const legend: PacketGeographyLegendEntry[] = [];

  const studyAreaReadNotice = readStateSentence("This project's study area", input.studyAreaReadState);
  if (studyAreaReadNotice) caveats.push(studyAreaReadNotice);
  const corridorReadNotice = readStateSentence("This project's corridors", input.corridorReadState);
  if (corridorReadNotice) caveats.push(corridorReadNotice);

  // ---- Gather raw geometry -------------------------------------------------
  const rawShapes: RawShape[] = [];

  const place = input.studyArea;
  const placeGeometryBucket = { rings: [] as LonLat[][], points: [] as LonLat[] };
  if (place?.geometry) collectRings(place.geometry, placeGeometryBucket);

  let studyAreaDescription: ReturnType<typeof describeStudyArea> | null = null;

  if (place && (place.geometry || place.bbox)) {
    studyAreaDescription = describeStudyArea(place);

    if (placeGeometryBucket.rings.length > 0) {
      rawShapes.push({ kind: "area", rings: placeGeometryBucket.rings, closed: true });
      legend.push({
        kind: "area",
        label: studyAreaDescription.title,
        detail: studyAreaDescription.detail,
      });
      contents.push(`Study area: ${studyAreaDescription.title}.`);
    } else {
      // A recorded extent with no boundary on the record. The rectangle is
      // DRAWN DASHED and named as a box, because a solid rectangle would read
      // as a boundary the project does not have.
      const box = place.bbox ?? bboxOfGeometry(place.geometry);
      if (box) {
        rawShapes.push({ kind: "extent-box", rings: [ringFromBbox(box)], closed: true });
        legend.push({
          kind: "extent-box",
          label: `${studyAreaDescription.title} — recorded extent only`,
          detail:
            "The dashed rectangle is the extent stored on the project record. The boundary itself is not on the record, so the rectangle is a box around the area and not its shape.",
        });
        contents.push(
          `Study area: ${studyAreaDescription.title}, recorded as an extent box with no boundary shape.`
        );
        caveats.push(
          "The study area is drawn as a dashed rectangle because only its extent is on the project record. The real boundary is somewhere inside that rectangle; the rectangle is not the boundary."
        );
      }
    }

    if (studyAreaDescription.caveat) caveats.push(studyAreaDescription.caveat);
  }

  const corridorShapes: Array<{ corridor: PacketGeographyCorridor; rings: LonLat[][] }> = [];
  for (const corridor of input.corridors) {
    const bucket = { rings: [] as LonLat[][], points: [] as LonLat[] };
    collectRings(corridor.geometry, bucket);
    if (bucket.rings.length === 0) continue;
    corridorShapes.push({ corridor, rings: bucket.rings });
  }

  const undrawableCorridorCount = input.corridors.length - corridorShapes.length;
  if (undrawableCorridorCount > 0) {
    caveats.push(
      `${undrawableCorridorCount} corridor${undrawableCorridorCount === 1 ? "" : " record"} on this project holds no readable line, so ${undrawableCorridorCount === 1 ? "it is" : "they are"} not drawn.`
    );
  }
  if (input.corridorLimitReached) {
    caveats.push(
      "This project has more corridors than the packet draws. Only the first ones are shown, in the order they were added."
    );
  }

  const badgeCorridors = corridorShapes.length <= MAX_BADGED_CORRIDORS;
  corridorShapes.forEach(({ corridor, rings }, index) => {
    rawShapes.push({ kind: "corridor", rings, closed: false });
    const badge = badgeCorridors ? `${index + 1}` : null;
    legend.push({
      kind: "corridor",
      label: badge ? `${badge} — ${corridor.name}` : corridor.name,
      detail: `Corridor drawn on this project (${corridorTypeLabel(corridor.corridorType)}).`,
    });
  });
  if (corridorShapes.length > 0) {
    contents.push(
      `${corridorShapes.length} corridor${corridorShapes.length === 1 ? "" : "s"} drawn on this project.`
    );
    if (!badgeCorridors) {
      caveats.push(
        "There are too many corridors to number them on the drawing, so the legend lists them in the order they are drawn."
      );
    }
  }

  const marker = input.marker;
  const markerValid =
    marker !== null &&
    isFiniteNumber(marker.latitude) &&
    isFiniteNumber(marker.longitude) &&
    marker.latitude >= -90 &&
    marker.latitude <= 90 &&
    marker.longitude >= -180 &&
    marker.longitude <= 180;

  if (markerValid && marker) {
    rawShapes.push({
      kind: "marker",
      rings: [[{ lon: marker.longitude, lat: marker.latitude }]],
      closed: false,
    });
    legend.push({
      kind: "marker",
      label: "Project point",
      detail:
        "The single point recorded on the project — the site, the intersection, the structure. It is not the area the work covers.",
    });
    contents.push(
      `Project point at ${formatLatitude(marker.latitude)}, ${formatLongitude(marker.longitude)}.`
    );
  }

  // ---- Nothing to draw -----------------------------------------------------
  if (rawShapes.length === 0) {
    const readsFailed = input.studyAreaReadState !== "ok" || input.corridorReadState !== "ok";
    return {
      hasDrawing: false,
      widthUnits: 0,
      heightUnits: 0,
      shapes: [],
      legend: [],
      scaleBar: null,
      contents: [],
      extentStatement: null,
      orientationStatement: null,
      scaleStatement: null,
      caveats,
      emptyStatement: readsFailed
        ? "Nothing is drawn here, and the packet cannot say whether that is because this project has no geography or because the records could not be read. Treat this section as unanswered, not as empty."
        : input.workspaceFallbackLabel
          ? `This project has no study area, no corridors and no map point on its record, so there is nothing to draw. Anything that needs a place falls back to the workspace's home geography, ${input.workspaceFallbackLabel}.`
          : "This project has no study area, no corridors and no map point on its record, so there is nothing to draw. Nothing has been left out — there is nothing there yet.",
      emptyNextStep: readsFailed
        ? "Open the project record to see whether a study area is set, then generate this packet again."
        : "Set the study area on the project record so every other lane inherits it instead of asking.",
    };
  }

  // ---- Project ------------------------------------------------------------
  // Antimeridian: a shape whose longitudes span more than half the globe is
  // crossing the date line, not wrapping the planet. Shifting the western
  // values keeps it contiguous. The schema permits this ordering (see
  // `bboxCenter`), so every reader has to handle it.
  //
  // Reduced with loops rather than `Math.min(...array)`: a TIGERweb county
  // outline runs to tens of thousands of positions and a spread that wide
  // overflows the call stack.
  let rawMinLon = Infinity;
  let rawMaxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const shape of rawShapes) {
    for (const ring of shape.rings) {
      for (const point of ring) {
        if (point.lon < rawMinLon) rawMinLon = point.lon;
        if (point.lon > rawMaxLon) rawMaxLon = point.lon;
        if (point.lat < minLat) minLat = point.lat;
        if (point.lat > maxLat) maxLat = point.lat;
      }
    }
  }

  const crossesAntimeridian = rawMaxLon - rawMinLon > 180;
  const unwrapLon = (lon: number): number =>
    crossesAntimeridian && lon < 0 ? lon + 360 : lon;

  let minLon = Infinity;
  let maxLon = -Infinity;
  if (crossesAntimeridian) {
    for (const shape of rawShapes) {
      for (const ring of shape.rings) {
        for (const point of ring) {
          const lon = unwrapLon(point.lon);
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
        }
      }
    }
  } else {
    minLon = rawMinLon;
    maxLon = rawMaxLon;
  }

  const centreLat = (minLat + maxLat) / 2;

  // Longitude is compressed by cos(centre latitude) so the drawing keeps its
  // real proportions instead of stretching east-west as it moves poleward.
  // Clamped so a polar extent cannot collapse the horizontal axis to zero.
  const lonCompression = Math.max(Math.cos(centreLat * DEG), 1e-4);

  const projectX = (lon: number): number => unwrapLon(lon) * lonCompression;
  // Screen y grows downward, so latitude is negated: north is up, always.
  const projectY = (lat: number): number => -lat;

  const projMinX = projectX(minLon);
  const projMaxX = projectX(maxLon);
  const projMinY = projectY(maxLat);
  const projMaxY = projectY(minLat);

  const spanX = projMaxX - projMinX;
  const spanY = projMaxY - projMinY;

  const innerWidth = FIGURE_WIDTH - 2 * FIGURE_PADDING;
  const innerMaxHeight = FIGURE_MAX_HEIGHT - 2 * FIGURE_PADDING;

  const scaleCandidates: number[] = [];
  if (spanX > 0) scaleCandidates.push(innerWidth / spanX);
  if (spanY > 0) scaleCandidates.push(innerMaxHeight / spanY);
  // A single point (or a set of coincident points) has no extent to fit. The
  // scale is then arbitrary, so the scale bar is withheld below.
  const unitsPerDegree = scaleCandidates.length > 0 ? Math.min(...scaleCandidates) : 0;
  const hasExtent = unitsPerDegree > 0;

  const drawnWidth = hasExtent ? spanX * unitsPerDegree : 0;
  const drawnHeight = hasExtent ? spanY * unitsPerDegree : 0;
  const heightUnits = Math.max(
    FIGURE_MIN_HEIGHT,
    Math.min(FIGURE_MAX_HEIGHT, drawnHeight + 2 * FIGURE_PADDING)
  );
  const offsetX = FIGURE_PADDING + (innerWidth - drawnWidth) / 2;
  const offsetY = (heightUnits - drawnHeight) / 2;

  const toFigure = (point: LonLat): { x: number; y: number } =>
    hasExtent
      ? {
          x: offsetX + (projectX(point.lon) - projMinX) * unitsPerDegree,
          y: offsetY + (projectY(point.lat) - projMinY) * unitsPerDegree,
        }
      : { x: FIGURE_WIDTH / 2, y: heightUnits / 2 };

  const shapes: PacketGeographyShape[] = [];
  let corridorIndex = 0;

  for (const raw of rawShapes) {
    if (raw.kind === "marker") {
      const point = raw.rings[0]?.[0];
      if (!point) continue;
      shapes.push({ kind: "marker", d: null, point: toFigure(point), badge: null });
      continue;
    }

    const segments: string[] = [];
    let longest: { length: number; midpoint: { x: number; y: number } } | null = null;

    for (const ring of raw.rings) {
      const figurePoints = simplify(ring.map(toFigure));
      if (figurePoints.length < (raw.closed ? 3 : 2)) continue;
      segments.push(pathData(figurePoints, raw.closed));

      if (raw.kind === "corridor") {
        const length = polylineLength(figurePoints);
        if (!longest || length > longest.length) {
          longest = { length, midpoint: figurePoints[Math.floor(figurePoints.length / 2)] };
        }
      }
    }

    if (segments.length === 0) continue;

    let badge: PacketGeographyShape["badge"] = null;
    if (raw.kind === "corridor") {
      corridorIndex += 1;
      if (badgeCorridors && longest) {
        badge = {
          text: `${corridorIndex}`,
          x: longest.midpoint.x,
          y: longest.midpoint.y,
        };
      }
    }

    shapes.push({ kind: raw.kind, d: segments.join(" "), point: null, badge });
  }

  // ---- Scale --------------------------------------------------------------
  const metresPerLatDegree = metresPerDegreeLatitude(centreLat);
  const metresPerUnit = hasExtent ? metresPerLatDegree / unitsPerDegree : 0;

  // The horizontal axis assumes one degree of longitude is cos(centreLat)
  // degrees of latitude long. Check that assumption against the true parallel
  // length at the extent's own edges, not just at its centre — the error grows
  // away from the centre, and the centre is exactly where it is smallest.
  const impliedMetresPerLonDegree = lonCompression * metresPerLatDegree;
  const distortion = Math.max(
    ...[minLat, centreLat, maxLat].map((lat) => {
      const trueMetres = metresPerDegreeLongitude(lat);
      if (!(trueMetres > 0)) return Infinity;
      return Math.abs(impliedMetresPerLonDegree - trueMetres) / trueMetres;
    })
  );

  let scaleBar: PacketGeographyScaleBar | null = null;
  let scaleStatement: string | null = null;

  if (!hasExtent) {
    scaleStatement =
      "No scale is shown: everything on this project sits at a single point, so the drawing has no extent to measure.";
  } else if (!(distortion <= MAX_SCALE_DISTORTION)) {
    scaleStatement = `No scale bar is shown. This project's geography covers ${(maxLat - minLat).toFixed(1)}° of latitude, and across that much north–south range a single flat scale would be wrong by about ${Math.round(distortion * 100)}% somewhere on the drawing. Read the drawing for shape and relative position only.`;
  } else {
    const targetMetres = innerWidth * 0.28 * metresPerUnit;
    const barMetres = niceRoundDown(targetMetres);
    if (barMetres > 0) {
      scaleBar = {
        lengthUnits: barMetres / metresPerUnit,
        label: describeGroundDistance(barMetres),
      };
      scaleStatement = `Scale bar: ${scaleBar.label}. The drawing holds latitude and longitude on straight axes with longitude compressed for this latitude, so the scale is accurate to within ${Math.max(1, Math.round(distortion * 100))}% anywhere on this figure.`;
    } else {
      scaleStatement =
        "No scale bar is shown: the extent is too small for a round scale length to fit the drawing.";
    }
  }

  const extentStatement = hasExtent
    ? `The drawing covers ${formatLatitude(minLat)} to ${formatLatitude(maxLat)} and ${formatLongitude(normaliseLon(minLon))} to ${formatLongitude(normaliseLon(maxLon))}.`
    : `Everything drawn sits at ${formatLatitude(minLat)}, ${formatLongitude(normaliseLon(minLon))}.`;

  caveats.unshift(FIGURE_NATURE_CAVEAT);

  return {
    hasDrawing: true,
    widthUnits: FIGURE_WIDTH,
    heightUnits,
    shapes,
    legend,
    scaleBar,
    contents,
    extentStatement,
    orientationStatement:
      "North is up. The drawing is oriented north-up by construction — latitude runs up the page and longitude across it.",
    scaleStatement,
    caveats,
    emptyStatement: null,
    emptyNextStep: null,
  };
}

/** Only used for the "recorded extent, no boundary" rectangle. */
function ringFromBbox(bbox: PlaceOfRecordBbox): LonLat[] {
  return [
    { lon: bbox.minLon, lat: bbox.minLat },
    { lon: bbox.maxLon, lat: bbox.minLat },
    { lon: bbox.maxLon, lat: bbox.maxLat },
    { lon: bbox.minLon, lat: bbox.maxLat },
    { lon: bbox.minLon, lat: bbox.minLat },
  ];
}

function normaliseLon(lon: number): number {
  if (lon > 180) return lon - 360;
  if (lon < -180) return lon + 360;
  return lon;
}

/**
 * Drop vertices the printed figure cannot resolve.
 *
 * A TIGERweb county outline runs to tens of thousands of positions, and every
 * one of them would be written into the PDF as text. Rounding to half a figure
 * unit and dropping repeats is visually lossless at print size and typically
 * removes most of them. The hard ceiling below it is for a pathological outline
 * that zig-zags at every step and so survives de-duplication.
 */
function simplify(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const kept: Array<{ x: number; y: number }> = [];
  let previousX: number | null = null;
  let previousY: number | null = null;

  for (const point of points) {
    const x = Math.round(point.x / VERTEX_QUANTUM) * VERTEX_QUANTUM;
    const y = Math.round(point.y / VERTEX_QUANTUM) * VERTEX_QUANTUM;
    if (x === previousX && y === previousY) continue;
    kept.push({ x, y });
    previousX = x;
    previousY = y;
  }

  if (kept.length <= MAX_VERTICES_PER_RING) return kept;

  const stride = Math.ceil(kept.length / MAX_VERTICES_PER_RING);
  const sampled = kept.filter((_, index) => index % stride === 0);
  const last = kept[kept.length - 1];
  const tail = sampled[sampled.length - 1];
  if (!tail || tail.x !== last.x || tail.y !== last.y) sampled.push(last);
  return sampled;
}

function pathData(points: Array<{ x: number; y: number }>, closed: boolean): string {
  const round = (value: number): string => {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
  };
  const body = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)}`)
    .join(" ");
  return closed ? `${body} Z` : body;
}

function polylineLength(points: Array<{ x: number; y: number }>): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return total;
}
