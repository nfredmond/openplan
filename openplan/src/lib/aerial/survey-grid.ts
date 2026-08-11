/**
 * Aerial survey grid generator — pure lawnmower / corridor mission geometry.
 *
 * Given an area of interest, a camera, and the planner's overlap and speed
 * choices, this module lays out an ordered serpentine of flight lines with
 * photo trigger points, and estimates the mission's cost in distance, time,
 * and battery legs. It is deliberately pure: no IO, no React, no Supabase —
 * routes and UI compose it.
 *
 * Every quantity that varies between aircraft, cameras, or missions is an
 * INPUT. The only numeric constants in this file are physical/geodetic
 * (meters per degree of latitude) or numerical-safety epsilons. There is no
 * default camera, no default altitude, no regulatory ceiling baked in — the
 * assumptions list on the result discloses what was derived and reminds the
 * planner to check local altitude rules, because those rules vary by
 * jurisdiction and hardcoding one would be wrong everywhere else.
 *
 * Photogrammetry relations used (the standard ones; square pixels assumed —
 * a mismatch between the sensor's horizontal and vertical pixel pitch above
 * 2% is disclosed in `assumptions`):
 *
 *   gsdCm        = sensorWidthMm * altitudeM * 100 / (focalLengthMm * imageWidthPx)
 *   footprintW_m = gsdCm * imageWidthPx  / 100   (across-track)
 *   footprintH_m = gsdCm * imageHeightPx / 100   (along-track)
 *   lineSpacing  = footprintW * (1 - sideOverlapPct  / 100)
 *   photoSpacing = footprintH * (1 - frontOverlapPct / 100)
 *
 * ORIENTATION RULE: flight lines run along the polygon's longest axis,
 * defined as the LONGER side of the minimum-area bounding rectangle of the
 * AOI's convex hull (rotating calipers). Flying the long axis minimizes the
 * number of turns, which dominate battery cost. Ties (e.g. a square) resolve
 * deterministically to the smallest axis angle in [0°, 180°). In corridor
 * mode the rule is replaced by the centerline's own axial mean bearing
 * (segment-length-weighted, computed on doubled angles so a switchback leg
 * reinforces rather than cancels its opposite) — the mission flies ALONG the
 * corridor.
 *
 * PROJECTION AND ERROR BOUND: all geometry runs in a local equirectangular
 * meter frame centred on the AOI centroid (x = Δlon·111132·cos(lat₀),
 * y = Δlat·111132). The dominant error is the change of longitude scale
 * across the AOI's north–south span, ≈ tan(latitude) · northSouthExtent /
 * earthRadius relative — under 0.1% of the mission extent at mid-latitudes
 * for AOIs up to ~10 km (a few meters at 10 km, centimeters at 1 km). That
 * is far inside the safety margin the overlap percentages already provide,
 * so it is acceptable at mission scale. Frames within ~0.5° of the poles are
 * refused rather than silently distorted.
 *
 * BOUNDARY MARGIN: the stay-inside margin is applied in the flight frame —
 * the band of line positions is inset by the margin across-track, and each
 * pass is trimmed by the margin along-track. For a convex AOI this equals a
 * true inward offset at line resolution; for a concave AOI it is applied per
 * pass segment, which keeps every waypoint at least the margin from the
 * boundary in both flight axes.
 *
 * SEAM NOTES:
 * - `SurveyCameraDescriptor` duplicates the minimal camera shape this module
 *   needs. If/when an aerial camera registry
 *   (src/lib/aerial/camera-registry.ts) lands, import its descriptor type
 *   here instead of maintaining this copy.
 * - `bufferPolylineXY` repeats the ribbon construction of aoi-seed's
 *   `bufferCorridorLineToRing` (extended square caps, miter joins) but at
 *   FULL precision in the already-projected meter frame. The aoi-seed
 *   version serves the AOI editor and rounds its ring to editor precision
 *   (~0.1 m), which would jitter the corridor's edges enough to destabilize
 *   scanline pairing at the boundary. If the two ever need to converge,
 *   extract the unrounded core into a shared helper and round at the editor
 *   seam only.
 */

// ---------------------------------------------------------------------------
// constants — geodetic / numerical only, never mission parameters
// ---------------------------------------------------------------------------

/** Meters per degree of latitude (WGS84 mean). Same constant as aoi-seed. */
const METERS_PER_DEGREE_LAT = 111_132;

/**
 * Per-turn time allowance (seconds) used when estimating mission duration. A
 * typical small multirotor loses roughly this long decelerating, turning, and
 * re-accelerating between passes at survey speeds. The generator accepts an
 * override (`turnAllowanceSeconds`), but today's flight-plan editor exposes NO
 * field for it — this is a disclosed, non-editable default, not a
 * planner-edited one: the value actually used is always named in the result's
 * `assumptions` and echoed into the saved snapshot. An editor field is
 * DEFERRED, deliberately (2026-08-11) — do not describe this as
 * planner-editable until one exists.
 */
export const DEFAULT_TURN_ALLOWANCE_SECONDS = 8;

/**
 * Absolute slack subtracted before a ceil() that turns a length ratio into a
 * count, so floating-point residue (≈1e-10 relative from the degree↔meter
 * round trip) cannot add a phantom extra line or photo when a dimension is an
 * exact multiple of a spacing. 1e-6 of a spacing is physically nothing.
 */
const COUNT_EPSILON = 1e-6;

/** Scanlines exactly on the AOI's bounding edge are nudged inward by this. */
const SCANLINE_EPSILON_M = 1e-6;

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

/**
 * Minimal camera description the grid math needs. See the SEAM NOTE above —
 * this shape is meant to be superseded by the camera registry's type.
 */
export interface SurveyCameraDescriptor {
  /** Registry key / display label, carried through when present. */
  key?: string;
  label?: string;
  sensorWidthMm: number;
  sensorHeightMm: number;
  imageWidthPx: number;
  imageHeightPx: number;
  focalLengthMm: number;
}

export interface SurveyCorridorInput {
  /** Corridor centerline, lon/lat WGS84. */
  centerline: [number, number][];
  /** TOTAL corridor width in meters (half to each side of the centerline). */
  widthM: number;
}

export interface SurveyGridInput {
  /**
   * AOI outer ring, lon/lat WGS84, open or closed. Provide EITHER this or
   * `corridor`, never both.
   */
  aoiRing?: [number, number][];
  camera: SurveyCameraDescriptor;
  /** Target ground sample distance, cm/px. Provide EITHER this or altitudeM. */
  targetGsdCm?: number;
  /** Flight altitude above ground, meters. Provide EITHER this or targetGsdCm. */
  altitudeM?: number;
  /** Forward (along-track) overlap between consecutive photos, percent [0,100). */
  frontOverlapPct: number;
  /** Side (across-track) overlap between adjacent lines, percent [0,100). */
  sideOverlapPct: number;
  /** Ground speed on the lines, m/s. */
  speedMps: number;
  /** Fly a second, perpendicular set of lines (for facades / 3D texture). */
  crossGrid?: boolean;
  /** Stay-inside margin from the AOI boundary, meters (≥ 0). */
  boundaryMarginM: number;
  /** Usable flight minutes per battery — the planner's number for THEIR aircraft. */
  flightMinutesPerBattery: number;
  /** Seconds budgeted per turn between passes. Default: DEFAULT_TURN_ALLOWANCE_SECONDS. */
  turnAllowanceSeconds?: number;
  /** Corridor mode: buffer the centerline and fly along it. */
  corridor?: SurveyCorridorInput;
}

export interface SurveyFlightLine {
  /** 0-based flight order. */
  index: number;
  /** Which grid the line belongs to (cross-grid missions carry both). */
  grid: "primary" | "cross";
  /** Line start, lon/lat, in flight direction. */
  start: [number, number];
  /** Line end, lon/lat, in flight direction. */
  end: [number, number];
  /** Compass bearing of travel, degrees [0, 360). */
  headingDeg: number;
  lengthM: number;
  /** Photo trigger points in flight order, lon/lat. */
  photoPoints: [number, number][];
}

export type SurveyGridRefusalReason =
  | "invalid_camera"
  | "invalid_overlap"
  | "invalid_speed"
  | "invalid_margin"
  | "invalid_battery"
  | "invalid_turn_allowance"
  | "invalid_gsd_altitude"
  | "invalid_aoi"
  | "invalid_corridor"
  | "ambiguous_area"
  | "margin_consumes_aoi"
  | "aoi_smaller_than_one_footprint"
  | "empty_grid";

/**
 * An honest refusal: the generator explains why no grid was produced instead
 * of returning an empty plan that looks like a mission.
 */
export interface SurveyGridRefusal {
  ok: false;
  reason: SurveyGridRefusalReason;
  /** Planner-voice explanation of what to change. */
  message: string;
}

export interface SurveyGridSuccess {
  ok: true;
  /** Flight altitude above ground, meters (derived when targetGsdCm was given). */
  altitudeM: number;
  /** Ground sample distance, cm/px (derived when altitudeM was given). */
  gsdCm: number;
  /** Single-photo ground footprint, meters (width across-track, height along-track). */
  footprintWidthM: number;
  footprintHeightM: number;
  /** Maximum line spacing that still meets the side overlap, meters. */
  lineSpacingM: number;
  /**
   * Spacing actually used on the primary grid: lines are placed EVENLY across
   * the margin-inset extent, so this is ≤ lineSpacingM (overlap never drops
   * below the requested percentage).
   */
  actualLineSpacingM: number;
  /** Maximum photo spacing that still meets the front overlap, meters. */
  photoSpacingM: number;
  /** Flight lines in the order flown (serpentine: consecutive lines reversed). */
  lines: SurveyFlightLine[];
  lineCount: number;
  photoCount: number;
  /** Line lengths plus the turns between consecutive lines, meters. */
  totalFlightDistanceM: number;
  /** distance / speed + turnAllowance per turn, seconds. */
  estimatedDurationSeconds: number;
  /** ceil(duration / usable battery time) — a planning estimate, not a guarantee. */
  estimatedBatteryLegs: number;
  /** Area of the coverage polygon (the AOI, or the buffered corridor), m². */
  coverageAreaM2: number;
  /** Compass bearing of the primary flight axis, degrees [0, 180). */
  flightAxisDeg: number;
  /** Every assumption the numbers rest on, in planner language. Show these. */
  assumptions: string[];
}

export type SurveyGridResult = SurveyGridSuccess | SurveyGridRefusal;

// ---------------------------------------------------------------------------
// the generator
// ---------------------------------------------------------------------------

export function generateSurveyGrid(input: SurveyGridInput): SurveyGridResult {
  // ---- camera ------------------------------------------------------------
  const camera = input.camera;
  if (
    !camera ||
    ![
      camera.sensorWidthMm,
      camera.sensorHeightMm,
      camera.imageWidthPx,
      camera.imageHeightPx,
      camera.focalLengthMm,
    ].every((value) => Number.isFinite(value) && value > 0)
  ) {
    return refuse(
      "invalid_camera",
      "The camera description is incomplete. Sensor size, image size, and focal length must all be positive numbers."
    );
  }

  // ---- scalar inputs -----------------------------------------------------
  const { frontOverlapPct, sideOverlapPct } = input;
  for (const [label, pct] of [
    ["front", frontOverlapPct],
    ["side", sideOverlapPct],
  ] as const) {
    if (!Number.isFinite(pct) || pct < 0 || pct >= 100) {
      return refuse(
        "invalid_overlap",
        `The ${label} overlap must be between 0% and 99% — at 100% the aircraft would never move between photos.`
      );
    }
  }
  if (!Number.isFinite(input.speedMps) || input.speedMps <= 0) {
    return refuse("invalid_speed", "Flight speed must be a positive number of meters per second.");
  }
  if (!Number.isFinite(input.boundaryMarginM) || input.boundaryMarginM < 0) {
    return refuse("invalid_margin", "The boundary margin must be zero or a positive number of meters.");
  }
  if (!Number.isFinite(input.flightMinutesPerBattery) || input.flightMinutesPerBattery <= 0) {
    return refuse(
      "invalid_battery",
      "Usable flight minutes per battery must be a positive number — enter the realistic figure for your aircraft, not the brochure maximum."
    );
  }
  const turnAllowanceSeconds = input.turnAllowanceSeconds ?? DEFAULT_TURN_ALLOWANCE_SECONDS;
  if (!Number.isFinite(turnAllowanceSeconds) || turnAllowanceSeconds < 0) {
    return refuse("invalid_turn_allowance", "The per-turn time allowance must be zero or more seconds.");
  }

  // ---- GSD ↔ altitude ----------------------------------------------------
  const hasGsd = input.targetGsdCm !== undefined;
  const hasAltitude = input.altitudeM !== undefined;
  if (hasGsd === hasAltitude) {
    return refuse(
      "invalid_gsd_altitude",
      "Provide exactly one of target ground resolution (cm/px) or flight altitude (m); the other is derived from the camera."
    );
  }
  let gsdCm: number;
  let altitudeM: number;
  if (hasGsd) {
    gsdCm = input.targetGsdCm!;
    if (!Number.isFinite(gsdCm) || gsdCm <= 0) {
      return refuse("invalid_gsd_altitude", "The target ground resolution must be a positive number of cm per pixel.");
    }
    altitudeM = (gsdCm * camera.focalLengthMm * camera.imageWidthPx) / (camera.sensorWidthMm * 100);
  } else {
    altitudeM = input.altitudeM!;
    if (!Number.isFinite(altitudeM) || altitudeM <= 0) {
      return refuse("invalid_gsd_altitude", "The flight altitude must be a positive number of meters.");
    }
    gsdCm = (camera.sensorWidthMm * altitudeM * 100) / (camera.focalLengthMm * camera.imageWidthPx);
  }

  const footprintWidthM = (gsdCm * camera.imageWidthPx) / 100;
  const footprintHeightM = (gsdCm * camera.imageHeightPx) / 100;
  const lineSpacingM = footprintWidthM * (1 - sideOverlapPct / 100);
  const photoSpacingM = footprintHeightM * (1 - frontOverlapPct / 100);

  // ---- coverage polygon (AOI ring XOR buffered corridor) -----------------
  if (input.aoiRing && input.corridor) {
    return refuse(
      "ambiguous_area",
      "Both an area boundary and a corridor were provided. Choose one: a corridor mission buffers its centerline into its own coverage area."
    );
  }
  const corridorMode = input.corridor !== undefined;

  // The frame anchor is the geometry the planner actually supplied: the AOI
  // ring, or the corridor centerline (the buffered ribbon is derived from it
  // inside the frame, at full precision).
  let anchor: [number, number][];
  if (corridorMode) {
    const corridor = input.corridor!;
    if (!Number.isFinite(corridor.widthM) || corridor.widthM <= 0) {
      return refuse("invalid_corridor", "The corridor width must be a positive number of meters (total width, split across the centerline).");
    }
    const line = cleanLine(corridor.centerline);
    if (!line) {
      return refuse("invalid_corridor", "The corridor centerline needs at least two distinct points with valid coordinates.");
    }
    anchor = line;
  } else {
    const ring = cleanRing(input.aoiRing);
    if (!ring) {
      return refuse("invalid_aoi", "The area boundary needs at least three distinct vertices with valid coordinates.");
    }
    anchor = ring;
  }

  // ---- local meter frame -------------------------------------------------
  const lat0 = anchor.reduce((sum, [, lat]) => sum + lat, 0) / anchor.length;
  const lon0 = anchor.reduce((sum, [lon]) => sum + lon, 0) / anchor.length;
  const metersPerDegLon = METERS_PER_DEGREE_LAT * Math.cos((lat0 * Math.PI) / 180);
  if (metersPerDegLon < METERS_PER_DEGREE_LAT * 0.01) {
    return refuse("invalid_aoi", "This area sits essentially at a pole, where the flat-earth planning frame breaks down. Plan it in a polar-capable tool.");
  }
  const toXY = ([lon, lat]: [number, number]): { x: number; y: number } => ({
    x: (lon - lon0) * metersPerDegLon,
    y: (lat - lat0) * METERS_PER_DEGREE_LAT,
  });
  const toLonLat = (x: number, y: number): [number, number] => [
    lon0 + x / metersPerDegLon,
    lat0 + y / METERS_PER_DEGREE_LAT,
  ];

  // ---- flight direction + coverage polygon -------------------------------
  let primaryAngle: number; // radians, [0, π), math convention (0 = east)
  let polygon: { x: number; y: number }[];
  if (corridorMode) {
    const centerXY = anchor.map(toXY);
    const buffered = bufferPolylineXY(centerXY, input.corridor!.widthM / 2);
    const axial = axialMeanAngle(centerXY);
    if (!buffered || axial === null) {
      return refuse("invalid_corridor", "The corridor centerline needs at least two distinct points with valid coordinates.");
    }
    polygon = buffered;
    primaryAngle = axial;
  } else {
    polygon = anchor.map(toXY);
    const longAxis = minAreaRectLongAxis(convexHull(polygon));
    if (longAxis === null) {
      return refuse("invalid_aoi", "The coverage boundary encloses no area.");
    }
    primaryAngle = longAxis;
  }

  const coverageAreaM2 = shoelaceArea(polygon);
  if (coverageAreaM2 <= 0) {
    return refuse(corridorMode ? "invalid_corridor" : "invalid_aoi", "The coverage boundary encloses no area.");
  }

  // ---- generate passes (primary grid, plus cross grid if asked) ----------
  const margin = input.boundaryMarginM;
  const grids: { name: "primary" | "cross"; angle: number }[] = [{ name: "primary", angle: primaryAngle }];
  if (input.crossGrid) {
    grids.push({ name: "cross", angle: normalizeAxis(primaryAngle + Math.PI / 2) });
  }

  type Pass = { grid: "primary" | "cross"; angle: number; v: number; u0: number; u1: number };
  const passes: Pass[] = [];
  let primaryActualSpacing = 0;

  for (const grid of grids) {
    const cos = Math.cos(grid.angle);
    const sin = Math.sin(grid.angle);
    const rotated = polygon.map(({ x, y }) => ({ u: x * cos + y * sin, v: -x * sin + y * cos }));
    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const { u, v } of rotated) {
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    const insetU = uMax - uMin - 2 * margin;
    const insetV = vMax - vMin - 2 * margin;
    if (insetU < 0 || insetV < 0) {
      return refuse(
        "margin_consumes_aoi",
        `The ${formatMeters(margin)} m boundary margin leaves no flyable area inside this ${formatMeters(uMax - uMin)} × ${formatMeters(vMax - vMin)} m boundary. Reduce the margin or enlarge the area.`
      );
    }
    if (grid.name === "primary" && insetU < footprintHeightM && insetV < footprintWidthM) {
      return refuse(
        "aoi_smaller_than_one_footprint",
        `After the ${formatMeters(margin)} m margin, this area (${formatMeters(insetU)} × ${formatMeters(insetV)} m) fits inside a single photo footprint (${formatMeters(footprintHeightM)} × ${formatMeters(footprintWidthM)} m at ${formatCm(gsdCm)} cm/px). A grid would add nothing — capture it as individual photos, or plan a finer ground resolution.`
      );
    }

    const vLow = vMin + margin;
    const vHigh = vMax - margin;
    const vExtent = vHigh - vLow;
    const lineCount = vExtent <= 0 ? 1 : Math.ceil(vExtent / lineSpacingM - COUNT_EPSILON) + 1;
    const actualSpacing = lineCount > 1 ? vExtent / (lineCount - 1) : 0;
    if (grid.name === "primary") primaryActualSpacing = actualSpacing;

    for (let i = 0; i < lineCount; i++) {
      const v = lineCount > 1 ? vLow + i * actualSpacing : (vLow + vHigh) / 2;
      // A scanline exactly on the boundary's edge finds no crossings under the
      // half-open rule; nudge it just inside.
      const scanV = Math.min(Math.max(v, vMin + SCANLINE_EPSILON_M), vMax - SCANLINE_EPSILON_M);
      const crossings = scanlineCrossings(rotated, scanV);
      for (let c = 0; c + 1 < crossings.length; c += 2) {
        const u0 = crossings[c] + margin;
        const u1 = crossings[c + 1] - margin;
        if (u1 - u0 <= 0) continue;
        passes.push({ grid: grid.name, angle: grid.angle, v, u0, u1 });
      }
    }
  }

  if (passes.length === 0) {
    return refuse(
      "empty_grid",
      "No flight line fits inside this boundary with the current margin and spacing. Reduce the margin, widen the area, or lower the side overlap."
    );
  }

  // ---- serpentine ordering + photo points --------------------------------
  // Passes are flown in geometric order (by grid, then across-track, then
  // along-track); direction alternates with the global flown index, so every
  // consecutive pair of lines is reversed — including across the junction
  // into the cross grid.
  passes.sort((a, b) =>
    a.grid === b.grid ? (a.v === b.v ? a.u0 - b.u0 : a.v - b.v) : a.grid === "primary" ? -1 : 1
  );

  const lines: SurveyFlightLine[] = [];
  let photoCount = 0;
  let flightDistance = 0;
  let previousEnd: { x: number; y: number } | null = null;

  passes.forEach((pass, index) => {
    const forward = index % 2 === 0;
    const cos = Math.cos(pass.angle);
    const sin = Math.sin(pass.angle);
    const place = (u: number): { x: number; y: number } => ({
      x: u * cos - pass.v * sin,
      y: u * sin + pass.v * cos,
    });
    const length = pass.u1 - pass.u0;
    const startU = forward ? pass.u0 : pass.u1;
    const endU = forward ? pass.u1 : pass.u0;
    const startXY = place(startU);
    const endXY = place(endU);

    const photosOnPass = Math.max(2, Math.ceil(length / photoSpacingM - COUNT_EPSILON) + 1);
    const step = (endU - startU) / (photosOnPass - 1);
    const photoPoints: [number, number][] = [];
    for (let j = 0; j < photosOnPass; j++) {
      const { x, y } = place(startU + j * step);
      photoPoints.push(toLonLat(x, y));
    }
    photoCount += photosOnPass;

    if (previousEnd) flightDistance += Math.hypot(startXY.x - previousEnd.x, startXY.y - previousEnd.y);
    flightDistance += length;
    previousEnd = endXY;

    const headingDeg =
      ((Math.atan2(endXY.x - startXY.x, endXY.y - startXY.y) * 180) / Math.PI + 360) % 360;

    lines.push({
      index,
      grid: pass.grid,
      start: toLonLat(startXY.x, startXY.y),
      end: toLonLat(endXY.x, endXY.y),
      headingDeg,
      lengthM: length,
      photoPoints,
    });
  });

  // ---- mission stats -----------------------------------------------------
  const turns = passes.length - 1;
  const estimatedDurationSeconds = flightDistance / input.speedMps + turns * turnAllowanceSeconds;
  const batterySeconds = input.flightMinutesPerBattery * 60;
  const estimatedBatteryLegs = Math.max(1, Math.ceil(estimatedDurationSeconds / batterySeconds - COUNT_EPSILON));

  const flightAxisDeg = ((90 - (primaryAngle * 180) / Math.PI) % 180 + 180) % 180;

  const assumptions: string[] = [];
  if (hasGsd) {
    assumptions.push(
      `Altitude ${formatMeters(altitudeM)} m was derived from the ${formatCm(gsdCm)} cm/px target using the camera's ${camera.sensorWidthMm} mm sensor width, ${camera.focalLengthMm} mm focal length, and ${camera.imageWidthPx} px image width.`
    );
  } else {
    assumptions.push(
      `Ground resolution ${formatCm(gsdCm)} cm/px was derived from the ${formatMeters(altitudeM)} m altitude using the camera's ${camera.sensorWidthMm} mm sensor width, ${camera.focalLengthMm} mm focal length, and ${camera.imageWidthPx} px image width.`
    );
  }
  assumptions.push(
    "Check the derived altitude against the altitude rules that apply where you fly — this planner applies no regulatory ceiling."
  );
  assumptions.push(
    `Line spacing ${formatMeters(lineSpacingM)} m meets the ${sideOverlapPct}% side overlap; lines are placed evenly, so actual spacing (${formatMeters(primaryActualSpacing)} m) never exceeds it. Photo spacing ${formatMeters(photoSpacingM)} m meets the ${frontOverlapPct}% front overlap the same way.`
  );
  assumptions.push(
    `Duration assumes a constant ${input.speedMps} m/s ground speed with no wind, plus ${turnAllowanceSeconds} s per turn (${turns} turns).`
  );
  assumptions.push(
    `Battery legs assume ${input.flightMinutesPerBattery} usable flight minutes per battery, as entered — transit to and from the survey area is not included.`
  );
  assumptions.push(
    "Elevation is treated as flat: altitude is above the takeoff/ground plane, and ground resolution will vary over terrain relief."
  );
  assumptions.push(
    "Line and photo positions are computed on a local flat-map frame centred on the survey area; the positional error from that flattening stays under about 0.1% of the mission extent at these scales — well inside the margin the overlaps already provide."
  );
  if (corridorMode) {
    assumptions.push(
      "Corridor lines follow the centerline's overall bearing; a sharply curved corridor gets straight passes across its buffered outline, not passes that bend with it."
    );
  }
  const pitchAcross = camera.sensorWidthMm / camera.imageWidthPx;
  const pitchAlong = camera.sensorHeightMm / camera.imageHeightPx;
  if (Math.abs(pitchAcross - pitchAlong) > 0.02 * pitchAcross) {
    assumptions.push(
      "This camera's sensor and image dimensions imply non-square pixels; footprints assume square pixels, so along-track figures are approximate."
    );
  }

  return {
    ok: true,
    altitudeM,
    gsdCm,
    footprintWidthM,
    footprintHeightM,
    lineSpacingM,
    actualLineSpacingM: primaryActualSpacing,
    photoSpacingM,
    lines,
    lineCount: lines.length,
    photoCount,
    totalFlightDistanceM: flightDistance,
    estimatedDurationSeconds,
    estimatedBatteryLegs,
    coverageAreaM2,
    flightAxisDeg,
    assumptions,
  };
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function refuse(reason: SurveyGridRefusalReason, message: string): SurveyGridRefusal {
  return { ok: false, reason, message };
}

function formatMeters(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function formatCm(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Validate, drop the closing duplicate, dedupe consecutive repeats. */
function cleanRing(value: unknown): [number, number][] | null {
  if (!Array.isArray(value)) return null;
  const ring: [number, number][] = [];
  for (const position of value) {
    if (
      !Array.isArray(position) ||
      typeof position[0] !== "number" ||
      typeof position[1] !== "number" ||
      !Number.isFinite(position[0]) ||
      !Number.isFinite(position[1])
    ) {
      return null;
    }
    const previous = ring[ring.length - 1];
    if (previous && previous[0] === position[0] && previous[1] === position[1]) continue;
    ring.push([position[0], position[1]]);
  }
  if (ring.length >= 2) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) ring.pop();
  }
  return ring.length >= 3 ? ring : null;
}

/** Validate a polyline: ≥ 2 distinct vertices, all coordinates finite. */
function cleanLine(value: unknown): [number, number][] | null {
  if (!Array.isArray(value)) return null;
  const line: [number, number][] = [];
  for (const position of value) {
    if (
      !Array.isArray(position) ||
      typeof position[0] !== "number" ||
      typeof position[1] !== "number" ||
      !Number.isFinite(position[0]) ||
      !Number.isFinite(position[1])
    ) {
      return null;
    }
    const previous = line[line.length - 1];
    if (previous && previous[0] === position[0] && previous[1] === position[1]) continue;
    line.push([position[0], position[1]]);
  }
  return line.length >= 2 ? line : null;
}

/**
 * Widen a polyline (already in the local meter frame) into a ribbon polygon
 * `halfWidth` to each side, with square end caps and miter joins clamped at
 * sharp angles. Same construction as aoi-seed's `bufferCorridorLineToRing`,
 * at full precision — see the SEAM NOTES in the module header.
 */
function bufferPolylineXY(
  points: { x: number; y: number }[],
  halfWidth: number
): { x: number; y: number }[] | null {
  if (points.length < 2 || !(halfWidth > 0)) return null;

  const startDir = unitVec(points[1].x - points[0].x, points[1].y - points[0].y);
  const endDir = unitVec(
    points[points.length - 1].x - points[points.length - 2].x,
    points[points.length - 1].y - points[points.length - 2].y
  );
  if (!startDir || !endDir) return null;
  const extended = [
    { x: points[0].x - startDir.x * halfWidth, y: points[0].y - startDir.y * halfWidth },
    ...points,
    {
      x: points[points.length - 1].x + endDir.x * halfWidth,
      y: points[points.length - 1].y + endDir.y * halfWidth,
    },
  ];

  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  const MITER_LIMIT = 3;

  for (let i = 0; i < extended.length; i++) {
    const prev = extended[i - 1];
    const current = extended[i];
    const next = extended[i + 1];
    const inDir = prev ? unitVec(current.x - prev.x, current.y - prev.y) : null;
    const outDir = next ? unitVec(next.x - current.x, next.y - current.y) : null;
    const dir = inDir && outDir ? (unitVec(inDir.x + outDir.x, inDir.y + outDir.y) ?? inDir) : (inDir ?? outDir);
    if (!dir) continue;
    const normal = { x: -dir.y, y: dir.x };
    const reference = inDir ?? outDir;
    const cosHalf = reference
      ? Math.max(normal.x * -reference.y + normal.y * reference.x, 1 / MITER_LIMIT)
      : 1;
    const offset = halfWidth / cosHalf;
    left.push({ x: current.x + normal.x * offset, y: current.y + normal.y * offset });
    right.push({ x: current.x - normal.x * offset, y: current.y - normal.y * offset });
  }

  if (left.length < 2 || right.length < 2) return null;
  const ring = [...left, ...right.reverse()];
  return ring.length >= 3 ? ring : null;
}

function unitVec(x: number, y: number): { x: number; y: number } | null {
  const length = Math.hypot(x, y);
  if (length === 0) return null;
  return { x: x / length, y: y / length };
}

function shoelaceArea(points: { x: number; y: number }[]): number {
  let doubled = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    doubled += a.x * b.y - b.x * a.y;
  }
  return Math.abs(doubled / 2);
}

/** Andrew monotone chain; returns the hull counter-clockwise. */
function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (sorted.length < 3) return sorted;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** Normalize an axis angle (direction without orientation) into [0, π). */
function normalizeAxis(angle: number): number {
  let a = angle % Math.PI;
  if (a < 0) a += Math.PI;
  return a;
}

/**
 * Long-axis angle of the minimum-area bounding rectangle (rotating calipers
 * over the hull's edge orientations). Ties resolve to the smallest axis angle.
 * Returns null for a degenerate hull.
 */
function minAreaRectLongAxis(hull: { x: number; y: number }[]): number | null {
  if (hull.length < 3) return null;
  let bestArea = Infinity;
  let bestAxis: number | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const edge = Math.atan2(b.y - a.y, b.x - a.x);
    const cos = Math.cos(edge);
    const sin = Math.sin(edge);
    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const p of hull) {
      const u = p.x * cos + p.y * sin;
      const v = -p.x * sin + p.y * cos;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    const du = uMax - uMin;
    const dv = vMax - vMin;
    const area = du * dv;
    const axis = normalizeAxis(du >= dv ? edge : edge + Math.PI / 2);
    if (bestAxis === null) {
      bestArea = area;
      bestAxis = axis;
    } else {
      const tolerance = 1e-9 * Math.max(1, bestArea);
      if (area < bestArea - tolerance || (Math.abs(area - bestArea) <= tolerance && axis < bestAxis)) {
        bestArea = area;
        bestAxis = axis;
      }
    }
  }
  if (bestAxis === null || bestArea <= 0) return null;
  return bestAxis;
}

/**
 * Segment-length-weighted axial mean bearing of a polyline, computed on
 * doubled angles so opposite directions reinforce instead of cancelling.
 * Returns null when the line has no length.
 */
function axialMeanAngle(points: { x: number; y: number }[]): number | null {
  let sumCos = 0;
  let sumSin = 0;
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const doubledAngle = 2 * Math.atan2(dy, dx);
    sumCos += length * Math.cos(doubledAngle);
    sumSin += length * Math.sin(doubledAngle);
    total += length;
  }
  if (total === 0 || Math.hypot(sumCos, sumSin) < 1e-9 * total) return null;
  return normalizeAxis(Math.atan2(sumSin, sumCos) / 2);
}

/**
 * Sorted u-coordinates where the horizontal scanline v = scanV crosses the
 * polygon's edges, using the half-open rule (v₁ ≤ v < v₂ or v₂ ≤ v < v₁) so
 * a vertex touch counts exactly once and horizontal edges contribute nothing.
 * Consecutive pairs bound the polygon's interior on that scanline.
 */
function scanlineCrossings(rotated: { u: number; v: number }[], scanV: number): number[] {
  const crossings: number[] = [];
  for (let i = 0; i < rotated.length; i++) {
    const a = rotated[i];
    const b = rotated[(i + 1) % rotated.length];
    if (a.v === b.v) continue;
    const crosses = (a.v <= scanV && scanV < b.v) || (b.v <= scanV && scanV < a.v);
    if (!crosses) continue;
    crossings.push(a.u + ((scanV - a.v) * (b.u - a.u)) / (b.v - a.v));
  }
  return crossings.sort((x, y) => x - y);
}
