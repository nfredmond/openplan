/**
 * High-injury network: which stretches of road carry the most severe crashes
 * per mile in the selected years.
 *
 * METHOD, stated once so the screen, the packet and the tests share it:
 *
 *   - Road lines come from the road context this project already stores
 *     (cached TIGER/Line or OpenStreetMap lines, plus model network corridors).
 *     No new road source is fetched here.
 *   - Each road line is cut into pieces of about half a mile. A leftover piece
 *     shorter than a quarter mile joins the piece before it.
 *   - Each crash goes to the nearest piece within 50 meters. A crash farther
 *     than that from any stored line is counted as not placed, never dropped.
 *   - Crashes per mile divide by the piece length, with a quarter-mile floor so
 *     one crash on a short stub cannot top the list.
 *   - With no stored road lines at all, crashes are grouped into half-mile grid
 *     squares instead, ranked by crash count, and no per-mile figure is given.
 *
 * WHAT COUNTS. A source that separates serious injuries gives a KSI network
 * (fatal plus serious-injury crashes). A source that does not gives a network
 * of fatal crashes only, and every label says so at the figure. A source whose
 * severity coverage is not recorded gives no network at all.
 *
 * Pure: no database, no network. The loader and routes decide what to pass.
 */

import type { CrashSeverity } from "./sources/types";
import type { SafetyRoadContextFeature } from "./road-context";

export type HighInjuryNetworkBasis = "ksi" | "fatal_only";
export type HighInjuryNetworkMethod = "road_segments" | "grid_cells";

export type HighInjuryNetworkCrash = {
  id: string;
  longitude: number;
  latitude: number;
  severity: CrashSeverity;
};

type LineGeometry = { type: "LineString"; coordinates: [number, number][] };
type PolygonGeometry = { type: "Polygon"; coordinates: [number, number][][] };

export type HighInjuryNetworkSegment = {
  /** Stable for the same road line or grid square: `road:<line key>:<piece>` or `grid:<col>:<row>`. */
  id: string;
  rank: number;
  /** True when another listed segment shares this rank. */
  tied: boolean;
  label: string;
  geometry: LineGeometry | PolygonGeometry;
  /** Measured piece length. Null for a grid square, which has no road length. */
  lengthMiles: number | null;
  crashCount: number;
  fatalCrashCount: number;
  /** Null when the source does not separate serious injuries. Never 0 for unknown. */
  seriousInjuryCrashCount: number | null;
  /** Null for a grid square. */
  crashesPerMile: number | null;
  /** Road source and vintage, or null for a grid square. */
  roadSource: string | null;
};

export type HighInjuryNetworkUnavailableReason =
  | "severity_coverage_unknown"
  | "crash_read_failed"
  | "too_many_crashes"
  | "road_read_failed"
  | "year_scope_unavailable"
  | "custody_unavailable";

export type HighInjuryNetwork =
  | {
      status: "unavailable";
      reason: HighInjuryNetworkUnavailableReason;
      basis: HighInjuryNetworkBasis | null;
    }
  | {
      status: "computed";
      basis: HighInjuryNetworkBasis;
      method: HighInjuryNetworkMethod;
      /** Exact requested-year selection, not evidence of complete observation. */
      years: number[];
      /** Ranked, at most `listLimit` long. */
      segments: HighInjuryNetworkSegment[];
      /** Crashes in scope for the years shown, counted in the database. */
      crashesConsidered: number;
      /** Of those, how many landed on a road piece or grid square. */
      crashesPlaced: number;
      /** Pieces or squares holding at least one crash, before the list limit. */
      segmentsWithCrashes: number;
      /** Total stored road length reviewed. Null for the grid method. */
      roadMilesReviewed: number | null;
      /** Length of the listed pieces. Null for the grid method. */
      listedMiles: number | null;
      /** Crashes on the listed segments. */
      listedCrashes: number;
      roadSources: string[];
      parameters: HighInjuryNetworkParameters;
    };

export type HighInjuryNetworkParameters = {
  segmentLengthMiles: number;
  minimumRateLengthMiles: number;
  snapMeters: number;
  gridSizeMiles: number;
  listLimit: number;
};

export const HIGH_INJURY_NETWORK_PARAMETERS: HighInjuryNetworkParameters = {
  segmentLengthMiles: 0.5,
  minimumRateLengthMiles: 0.25,
  snapMeters: 50,
  gridSizeMiles: 0.5,
  listLimit: 20,
};

const METERS_PER_MILE = 1609.344;
const EARTH_RADIUS_METERS = 6_371_008.8;
const METERS_PER_DEGREE_LATITUDE = (EARTH_RADIUS_METERS * Math.PI) / 180;
const TIE_TOLERANCE = 1e-9;

/**
 * What the source lets this network count, from the acquisition's recorded
 * severity coverage. Null means coverage is not recorded, so nothing is ranked.
 */
export function highInjuryNetworkBasis(severityCompleteness: string | null | undefined): HighInjuryNetworkBasis | null {
  if (severityCompleteness === "kabco_full") return "ksi";
  if (severityCompleteness === "fatal_only" || severityCompleteness === "fatal_injury_only") return "fatal_only";
  return null;
}

/** The severities the loader should read for a basis. */
export function highInjuryNetworkSeverities(basis: HighInjuryNetworkBasis): readonly CrashSeverity[] {
  return basis === "ksi" ? ["fatal", "severe_injury"] : ["fatal"];
}

/** The measure's name, as printed beside the figure. */
export function highInjuryNetworkMeasureLabel(basis: HighInjuryNetworkBasis, method: HighInjuryNetworkMethod): string {
  const crashes = basis === "ksi" ? "Fatal and serious-injury crashes" : "Fatal crashes";
  const scope = method === "road_segments" ? "per mile" : "per half-mile square";
  return basis === "ksi" ? `${crashes} ${scope}` : `${crashes} ${scope} (fatal crashes only)`;
}

/** List sparse selections without implying that the intervening years were selected. */
export function describeHighInjuryNetworkYears(years: readonly number[]): string {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  if (sorted.length === 0) return "Requested crash years not recorded";
  const contiguous = sorted.every((year, index) => index === 0 || year === sorted[index - 1] + 1);
  const label = sorted.length > 1 && contiguous ? `${sorted[0]}–${sorted[sorted.length - 1]}` : sorted.join(", ");
  return `Requested crash years: ${label}`;
}

/** One sentence on how the ranking was built. */
export function describeHighInjuryNetworkMethod(
  method: HighInjuryNetworkMethod,
  parameters: HighInjuryNetworkParameters = HIGH_INJURY_NETWORK_PARAMETERS,
): string {
  if (method === "grid_cells") {
    return `No road lines are stored for this project, so crashes are grouped into ${parameters.gridSizeMiles}-mile grid squares and ranked by count. This is a grid, not a road network, and gives no per-mile figure.`;
  }
  return `Stored road lines are cut into pieces of about ${parameters.segmentLengthMiles} mile. Each crash goes to the nearest piece within ${parameters.snapMeters} meters. Pieces shorter than ${parameters.minimumRateLengthMiles} mile are measured as ${parameters.minimumRateLengthMiles} mile.`;
}

/** Why no network was ranked, in plain words. */
export function describeHighInjuryNetworkUnavailable(reason: HighInjuryNetworkUnavailableReason): string {
  switch (reason) {
    case "severity_coverage_unknown":
      return "This acquisition does not record which severities its source separates, so no high-injury network is ranked. That is missing coverage, not a finding.";
    case "crash_read_failed":
      return "OpenPlan could not read the severe crashes for this ranking. That is a failed read, not a finding that no road stands out.";
    case "too_many_crashes":
      return "This area holds more severe crashes than OpenPlan ranks in one pass. Pick a smaller study area. No ranking is shown rather than a partial one.";
    case "road_read_failed":
      return "Stored road lines could not be read, so no high-injury network is ranked. That is a failed read, not an absence of roads.";
    case "year_scope_unavailable":
      return "Requested crash years are missing, invalid, or outside the selected range, so no high-injury network is ranked. This does not establish zero crashes or complete observation coverage.";
    case "custody_unavailable":
      return "This acquisition's stored records do not reconcile with its recorded total, so no high-injury network is ranked.";
  }
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance, used for road lengths. */
export function haversineMeters(a: [number, number], b: [number, number]): number {
  const dLat = toRadians(b[1] - a[1]);
  const dLon = toRadians(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a[1])) * Math.cos(toRadians(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function interpolate(a: [number, number], b: [number, number], ratio: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
}

/** FNV-1a, 32-bit, as 8 hex characters. Enough to tell road lines apart in one project. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * A road line's key from what it IS, not from the row that stores it. The same
 * line read live from the source and read back from the project cache carries
 * different row ids; this key is the same for both, so a countermeasure saved
 * against a segment still finds it in the report.
 */
export function roadLineKey(road: Pick<SafetyRoadContextFeature, "sourceId" | "vintage" | "name" | "geometry">): string {
  const coordinates = road.geometry.coordinates;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  const point = (position: [number, number] | undefined) =>
    position ? `${position[0].toFixed(6)},${position[1].toFixed(6)}` : "none";
  return shortHash(
    [road.sourceId, road.vintage, road.name, point(first), point(last), coordinates.length].join("|"),
  );
}

type RoadPiece = {
  id: string;
  roadName: string;
  roadSource: string;
  coordinates: [number, number][];
  lengthMeters: number;
};

/**
 * Cut one line into pieces of `pieceMeters`. The final leftover joins the piece
 * before it when it is shorter than half a piece.
 */
export function cutLineIntoPieces(
  coordinates: readonly [number, number][],
  pieceMeters: number,
): Array<{ coordinates: [number, number][]; lengthMeters: number }> {
  const pieces: Array<{ coordinates: [number, number][]; lengthMeters: number }> = [];
  if (coordinates.length < 2 || !(pieceMeters > 0)) return pieces;

  let current: [number, number][] = [coordinates[0]];
  let currentLength = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    let start = coordinates[index - 1];
    const end = coordinates[index];
    let remaining = haversineMeters(start, end);
    while (currentLength + remaining >= pieceMeters && remaining > 0) {
      const needed = pieceMeters - currentLength;
      const cut = interpolate(start, end, needed / remaining);
      current.push(cut);
      pieces.push({ coordinates: current, lengthMeters: pieceMeters });
      current = [cut];
      currentLength = 0;
      remaining -= needed;
      start = cut;
    }
    if (remaining > 0) {
      current.push(end);
      currentLength += remaining;
    }
  }

  if (current.length >= 2 && currentLength > 0) {
    const previous = pieces.at(-1);
    if (previous && currentLength < pieceMeters / 2) {
      previous.coordinates.push(...current.slice(1));
      previous.lengthMeters += currentLength;
    } else {
      pieces.push({ coordinates: current, lengthMeters: currentLength });
    }
  }
  return pieces;
}

function pointToSegmentMeters(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): number {
  const referenceLatitude = toRadians(point[1]);
  const project = ([lon, lat]: [number, number]) => ({
    x: toRadians(lon) * EARTH_RADIUS_METERS * Math.cos(referenceLatitude),
    y: toRadians(lat) * EARTH_RADIUS_METERS,
  });
  const p = project(point);
  const a = project(start);
  const b = project(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const ratio = denominator === 0
    ? 0
    : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / denominator));
  return Math.hypot(p.x - (a.x + ratio * dx), p.y - (a.y + ratio * dy));
}

const INDEX_CELL_DEGREES = 0.01;

type IndexedSegment = { pieceIndex: number; start: [number, number]; end: [number, number] };

function bucketKey(column: number, row: number): string {
  return `${column}:${row}`;
}

/** A coarse bucket index so each crash checks only nearby road pieces. */
function buildSegmentIndex(pieces: readonly RoadPiece[], snapMeters: number): Map<string, IndexedSegment[]> {
  const index = new Map<string, IndexedSegment[]>();
  pieces.forEach((piece, pieceIndex) => {
    for (let vertex = 1; vertex < piece.coordinates.length; vertex += 1) {
      const start = piece.coordinates[vertex - 1];
      const end = piece.coordinates[vertex];
      const maxAbsLatitude = Math.min(89, Math.max(Math.abs(start[1]), Math.abs(end[1])));
      const latMargin = snapMeters / METERS_PER_DEGREE_LATITUDE;
      const lonMargin = latMargin / Math.max(0.01, Math.cos(toRadians(maxAbsLatitude)));
      const minColumn = Math.floor((Math.min(start[0], end[0]) - lonMargin) / INDEX_CELL_DEGREES);
      const maxColumn = Math.floor((Math.max(start[0], end[0]) + lonMargin) / INDEX_CELL_DEGREES);
      const minRow = Math.floor((Math.min(start[1], end[1]) - latMargin) / INDEX_CELL_DEGREES);
      const maxRow = Math.floor((Math.max(start[1], end[1]) + latMargin) / INDEX_CELL_DEGREES);
      for (let column = minColumn; column <= maxColumn; column += 1) {
        for (let row = minRow; row <= maxRow; row += 1) {
          const key = bucketKey(column, row);
          const bucket = index.get(key);
          const entry = { pieceIndex, start, end };
          if (bucket) bucket.push(entry);
          else index.set(key, [entry]);
        }
      }
    }
  });
  return index;
}

type Tally = { crashCount: number; fatalCrashCount: number; seriousInjuryCrashCount: number };

function emptyTally(): Tally {
  return { crashCount: 0, fatalCrashCount: 0, seriousInjuryCrashCount: 0 };
}

function addToTally(tally: Tally, severity: CrashSeverity) {
  tally.crashCount += 1;
  if (severity === "fatal") tally.fatalCrashCount += 1;
  if (severity === "severe_injury") tally.seriousInjuryCrashCount += 1;
}

function usableCrash(crash: HighInjuryNetworkCrash, severities: readonly CrashSeverity[]): boolean {
  return (
    Number.isFinite(crash.longitude) &&
    Number.isFinite(crash.latitude) &&
    Math.abs(crash.longitude) <= 180 &&
    Math.abs(crash.latitude) <= 90 &&
    severities.includes(crash.severity)
  );
}

type Candidate = Omit<HighInjuryNetworkSegment, "rank" | "tied"> & { sortMeasure: number };

/** Rates are compared at 0.01 per mile, finer than the 0.1 a planner sees. */
function rankingMeasure(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Rank candidates: higher measure first, then more crashes, then more fatal
 * crashes, then id for a stable order. Rows tie (share a rank) when measure
 * (to 0.01) and crash count are both equal.
 */
export function rankHighInjuryCandidates<T extends { id: string; sortMeasure: number; crashCount: number; fatalCrashCount: number }>(
  candidates: readonly T[],
): Array<T & { rank: number; tied: boolean }> {
  const sorted = [...candidates].sort((a, b) =>
    rankingMeasure(b.sortMeasure) !== rankingMeasure(a.sortMeasure)
      ? rankingMeasure(b.sortMeasure) - rankingMeasure(a.sortMeasure)
      : b.crashCount !== a.crashCount
        ? b.crashCount - a.crashCount
        : b.fatalCrashCount !== a.fatalCrashCount
          ? b.fatalCrashCount - a.fatalCrashCount
          : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const sameRank = (a: T, b: T) =>
    rankingMeasure(a.sortMeasure) === rankingMeasure(b.sortMeasure) && a.crashCount === b.crashCount;
  const ranked = sorted.map((candidate, index) => ({ ...candidate, rank: index + 1, tied: false }));
  for (let index = 1; index < ranked.length; index += 1) {
    if (sameRank(ranked[index - 1], ranked[index])) {
      ranked[index].rank = ranked[index - 1].rank;
      ranked[index].tied = true;
      ranked[index - 1].tied = true;
    }
  }
  return ranked;
}

function roadCandidates(
  crashes: readonly HighInjuryNetworkCrash[],
  roads: readonly SafetyRoadContextFeature[],
  basis: HighInjuryNetworkBasis,
  parameters: HighInjuryNetworkParameters,
) {
  const pieces: RoadPiece[] = [];
  const keyed = new Map<string, SafetyRoadContextFeature>();
  for (const road of roads) {
    // The same line stored twice (two cache rows, or cache plus live) counts once.
    const key = roadLineKey(road);
    if (!keyed.has(key)) keyed.set(key, road);
  }
  for (const [key, road] of [...keyed.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const roadSource = `${road.sourceLabel} ${road.vintage}`;
    cutLineIntoPieces(road.geometry.coordinates, parameters.segmentLengthMiles * METERS_PER_MILE).forEach(
      (piece, pieceNumber) => {
        pieces.push({
          id: `road:${key}:${pieceNumber}`,
          roadName: road.name,
          roadSource,
          coordinates: piece.coordinates,
          lengthMeters: piece.lengthMeters,
        });
      },
    );
  }

  const index = buildSegmentIndex(pieces, parameters.snapMeters);
  const tallies = new Map<number, Tally>();
  let placed = 0;
  for (const crash of crashes) {
    const point: [number, number] = [crash.longitude, crash.latitude];
    const bucket = index.get(
      bucketKey(Math.floor(crash.longitude / INDEX_CELL_DEGREES), Math.floor(crash.latitude / INDEX_CELL_DEGREES)),
    ) ?? [];
    let best: { pieceIndex: number; distance: number } | null = null;
    for (const segment of bucket) {
      const distance = pointToSegmentMeters(point, segment.start, segment.end);
      if (distance > parameters.snapMeters) continue;
      if (
        !best ||
        distance < best.distance - TIE_TOLERANCE ||
        (Math.abs(distance - best.distance) <= TIE_TOLERANCE && pieces[segment.pieceIndex].id < pieces[best.pieceIndex].id)
      ) {
        best = { pieceIndex: segment.pieceIndex, distance };
      }
    }
    if (!best) continue;
    placed += 1;
    const tally = tallies.get(best.pieceIndex) ?? emptyTally();
    addToTally(tally, crash.severity);
    tallies.set(best.pieceIndex, tally);
  }

  const candidates: Candidate[] = [...tallies.entries()].map(([pieceIndex, tally]) => {
    const piece = pieces[pieceIndex];
    const lengthMiles = piece.lengthMeters / METERS_PER_MILE;
    const rateMiles = Math.max(lengthMiles, parameters.minimumRateLengthMiles);
    const crashesPerMile = tally.crashCount / rateMiles;
    return {
      id: piece.id,
      label: piece.roadName,
      geometry: { type: "LineString", coordinates: piece.coordinates },
      lengthMiles,
      crashCount: tally.crashCount,
      fatalCrashCount: tally.fatalCrashCount,
      seriousInjuryCrashCount: basis === "ksi" ? tally.seriousInjuryCrashCount : null,
      crashesPerMile,
      roadSource: piece.roadSource,
      sortMeasure: crashesPerMile,
    };
  });

  return {
    candidates,
    placed,
    roadMilesReviewed: pieces.reduce((sum, piece) => sum + piece.lengthMeters, 0) / METERS_PER_MILE,
    roadSources: Array.from(new Set(pieces.map((piece) => piece.roadSource))).sort(),
  };
}

function gridCandidates(
  crashes: readonly HighInjuryNetworkCrash[],
  basis: HighInjuryNetworkBasis,
  parameters: HighInjuryNetworkParameters,
) {
  const latStep = (parameters.gridSizeMiles * METERS_PER_MILE) / METERS_PER_DEGREE_LATITUDE;
  const cells = new Map<string, { column: number; row: number; lonStep: number; tally: Tally }>();
  for (const crash of crashes) {
    const row = Math.floor(crash.latitude / latStep);
    const rowCenter = (row + 0.5) * latStep;
    const lonStep = latStep / Math.max(0.01, Math.cos(toRadians(rowCenter)));
    const column = Math.floor(crash.longitude / lonStep);
    const key = `grid:${column}:${row}`;
    const cell = cells.get(key) ?? { column, row, lonStep, tally: emptyTally() };
    addToTally(cell.tally, crash.severity);
    cells.set(key, cell);
  }

  const candidates: Candidate[] = [...cells.entries()].map(([id, cell]) => {
    const west = cell.column * cell.lonStep;
    const east = west + cell.lonStep;
    const south = cell.row * latStep;
    const north = south + latStep;
    const centerLat = (south + north) / 2;
    const centerLon = (west + east) / 2;
    return {
      id,
      label: `Half-mile square at ${centerLat.toFixed(5)}, ${centerLon.toFixed(5)}`,
      geometry: {
        type: "Polygon",
        coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
      },
      lengthMiles: null,
      crashCount: cell.tally.crashCount,
      fatalCrashCount: cell.tally.fatalCrashCount,
      seriousInjuryCrashCount: basis === "ksi" ? cell.tally.seriousInjuryCrashCount : null,
      crashesPerMile: null,
      roadSource: null,
      sortMeasure: cell.tally.crashCount,
    };
  });

  return { candidates, placed: crashes.length };
}

/**
 * Rank the high-injury network.
 *
 * `crashesConsidered` is the database's exact count for the scope. Crashes the
 * caller could not pass (bad coordinates) still count as considered and not
 * placed, so the gap stays visible.
 *
 * `roads` null means the road read failed: no ranking, never a silent switch
 * to the grid. An empty array means no road lines are stored: grid method.
 */
export function computeHighInjuryNetwork(input: {
  crashes: readonly HighInjuryNetworkCrash[];
  crashesConsidered: number;
  basis: HighInjuryNetworkBasis;
  roads: readonly SafetyRoadContextFeature[] | null;
  years: readonly number[];
  parameters?: HighInjuryNetworkParameters;
}): HighInjuryNetwork {
  const parameters = input.parameters ?? HIGH_INJURY_NETWORK_PARAMETERS;
  if (input.roads === null) {
    return { status: "unavailable", reason: "road_read_failed", basis: input.basis };
  }
  const severities = highInjuryNetworkSeverities(input.basis);
  const crashes = input.crashes.filter((crash) => usableCrash(crash, severities));
  const method: HighInjuryNetworkMethod = input.roads.length > 0 ? "road_segments" : "grid_cells";

  const built = method === "road_segments"
    ? roadCandidates(crashes, input.roads, input.basis, parameters)
    : { ...gridCandidates(crashes, input.basis, parameters), roadMilesReviewed: null, roadSources: [] as string[] };

  const ranked = rankHighInjuryCandidates(built.candidates);
  const listed = ranked.slice(0, parameters.listLimit);
  const segments: HighInjuryNetworkSegment[] = listed.map((candidate) => ({
    id: candidate.id,
    rank: candidate.rank,
    tied: candidate.tied,
    label: candidate.label,
    geometry: candidate.geometry,
    lengthMiles: candidate.lengthMiles,
    crashCount: candidate.crashCount,
    fatalCrashCount: candidate.fatalCrashCount,
    seriousInjuryCrashCount: candidate.seriousInjuryCrashCount,
    crashesPerMile: candidate.crashesPerMile,
    roadSource: candidate.roadSource,
  }));

  return {
    status: "computed",
    basis: input.basis,
    method,
    years: [...input.years].sort((a, b) => a - b),
    segments,
    crashesConsidered: Math.max(input.crashesConsidered, input.crashes.length),
    crashesPlaced: built.placed,
    segmentsWithCrashes: ranked.length,
    roadMilesReviewed: built.roadMilesReviewed,
    listedMiles: method === "road_segments"
      ? segments.reduce((sum, segment) => sum + (segment.lengthMiles ?? 0), 0)
      : null,
    listedCrashes: segments.reduce((sum, segment) => sum + segment.crashCount, 0),
    roadSources: built.roadSources,
    parameters,
  };
}

/** Plain coverage sentence: what was placed, what was listed, what was left out. */
export function describeHighInjuryNetworkCoverage(network: Extract<HighInjuryNetwork, { status: "computed" }>): string {
  const crashWord = network.basis === "ksi" ? "fatal or serious-injury crashes" : "fatal crashes";
  const periodCaveat = " Requested years filter stored crashes; they do not establish complete observation coverage or an annual denominator. Unavailable years are not zero-crash observations.";
  if (network.crashesConsidered === 0) {
    return `No ${crashWord} are recorded here for these years. That is not a finding that the roads are safe.${periodCaveat}`;
  }
  const notPlaced = network.crashesConsidered - network.crashesPlaced;
  const placedSentence = network.method === "road_segments"
    ? `${network.crashesPlaced.toLocaleString("en-US")} of ${network.crashesConsidered.toLocaleString("en-US")} ${crashWord} are within ${network.parameters.snapMeters} m of a stored road line (${(network.roadMilesReviewed ?? 0).toFixed(1)} road miles stored).`
    : `${network.crashesPlaced.toLocaleString("en-US")} of ${network.crashesConsidered.toLocaleString("en-US")} ${crashWord} are placed in a grid square.`;
  const notPlacedSentence = notPlaced <= 0
    ? ""
    : network.method === "road_segments"
      ? ` ${notPlaced.toLocaleString("en-US")} are not on this list because no stored road line is near them.`
      : ` ${notPlaced.toLocaleString("en-US")} are not on this list because their coordinates could not be used.`;
  const listedSentence = network.segments.length > 0
    ? ` The ${network.segments.length} listed ${network.method === "road_segments" ? "pieces" : "squares"} hold ${network.listedCrashes.toLocaleString("en-US")} of them${network.listedMiles === null ? "" : ` on ${network.listedMiles.toFixed(1)} miles`}.`
    : "";
  return placedSentence + notPlacedSentence + listedSentence + periodCaveat;
}

export type HighInjuryNetworkFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: number;
    geometry: LineGeometry | PolygonGeometry;
    properties: { segmentId: string; rank: number; label: string; crashCount: number };
  }>;
};

/** The map layer's data: the listed segments only, or nothing. */
export function highInjuryNetworkFeatureCollection(
  network: HighInjuryNetwork | null | undefined,
): HighInjuryNetworkFeatureCollection {
  if (!network || network.status !== "computed") return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: network.segments.map((segment, index) => ({
      type: "Feature",
      id: index + 1,
      geometry: segment.geometry,
      properties: {
        segmentId: segment.id,
        rank: segment.rank,
        label: segment.label,
        crashCount: segment.crashCount,
      },
    })),
  };
}
