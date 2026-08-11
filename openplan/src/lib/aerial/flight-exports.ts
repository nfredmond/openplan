/**
 * Flight-plan exports — pure builders from a SAVED survey-grid snapshot to the
 * three file formats field crews actually load:
 *
 *   (a) DJI WPML `.kmz` — the wpmz package DJI Pilot 2 / DJI cloud tooling
 *       imports: a zip holding `wpmz/template.kml` and `wpmz/waylines.wpml`.
 *       Schema: DJI WPML (WPMZ) **1.0.2**, per DJI's published "DJI WPML"
 *       reference in the Cloud API documentation (developer.dji.com — Cloud
 *       API ▸ API reference ▸ DJI WPML). Waypoints carry execute height,
 *       speed, heading mode, and a camera-trigger (`takePhoto`) action per
 *       photo point; gimbal pitch, when the plan states one, is set by a
 *       `gimbalRotate` action at the first waypoint.
 *       DELIBERATELY OMITTED: `wpml:droneInfo` / `wpml:payloadInfo` (aircraft
 *       and payload enum values). Those enums name specific DJI models, and
 *       nothing in OpenPlan may hardcode a vendor's product matrix — DJI
 *       Pilot 2 binds the mission to the connected aircraft on import and
 *       will prompt if it needs to.
 *
 *   (b) Litchi CSV — the Litchi Mission Hub CSV column set (flylitchi.com
 *       help ▸ "CSV structure"): one row per waypoint with per-waypoint photo
 *       actions (`actiontype1 = 1`, TAKE_PHOTO). `altitudemode 0` = altitude
 *       relative to the takeoff point, matching the generator's own stated
 *       assumption. NOTE Litchi caps a mission at 99 waypoints; the caller is
 *       expected to surface `photoCount` against that limit rather than this
 *       module silently truncating (it never truncates).
 *
 *   (c) Generic KML — plain OGC KML 2.2 lines + points for any GIS viewer.
 *       Not flyable; it exists so the plan can be reviewed next to other
 *       layers in whatever tool an agency already has.
 *
 * All builders are PURE: bytes/strings out, no IO, no Supabase, no React. The
 * only inputs are the parsed snapshot (below) and the plan row's own fields.
 * jszip is imported lazily inside the one builder that zips, so client code
 * importing this module for the snapshot helpers does not bundle it.
 *
 * THE SNAPSHOT IS THE CONTRACT. Exports are built from what a planner
 * GENERATED, REVIEWED and SAVED — never regenerated server-side at download
 * time, which could silently disagree with what was reviewed. The export
 * route refuses when there is no saved snapshot or when the snapshot's
 * parameter fingerprint no longer matches the saved parameters (stale).
 */

import type { SurveyGridSuccess } from "@/lib/aerial/survey-grid";

/**
 * Version tag written into aerial_flight_plans.generated_plan by the editor
 * and required back by the parser. Bump ONLY with a migration story for old
 * snapshots — an unknown version is refused honestly, not guessed at.
 */
export const FLIGHT_SNAPSHOT_SCHEMA_VERSION = "openplan-survey-grid-1";

/** The generator inputs that are not columns on aerial_flight_plans but are
 *  needed to re-read the snapshot honestly (battery legs, duration basis). */
export type FlightSnapshotInputEcho = {
  speedMps: number;
  flightMinutesPerBattery: number;
  turnAllowanceSeconds: number;
};

export type FlightSnapshotLine = {
  index: number;
  grid: "primary" | "cross";
  start: [number, number];
  end: [number, number];
  headingDeg: number;
  lengthM: number;
  photoPoints: [number, number][];
};

export type ParsedFlightSnapshot = {
  schemaVersion: string;
  altitudeM: number;
  gsdCm: number;
  lines: FlightSnapshotLine[];
  lineCount: number;
  photoCount: number;
  totalFlightDistanceM: number;
  estimatedDurationSeconds: number;
  estimatedBatteryLegs: number;
  assumptions: string[];
  input: FlightSnapshotInputEcho;
};

/** What the editor stores in generated_plan: the grid result plus the echo of
 *  the generator inputs that have no column of their own. */
export function buildFlightPlanSnapshot(
  grid: SurveyGridSuccess,
  input: FlightSnapshotInputEcho
): Record<string, unknown> {
  return {
    schemaVersion: FLIGHT_SNAPSHOT_SCHEMA_VERSION,
    altitudeM: grid.altitudeM,
    gsdCm: grid.gsdCm,
    footprintWidthM: grid.footprintWidthM,
    footprintHeightM: grid.footprintHeightM,
    lineSpacingM: grid.lineSpacingM,
    actualLineSpacingM: grid.actualLineSpacingM,
    photoSpacingM: grid.photoSpacingM,
    lines: grid.lines,
    lineCount: grid.lineCount,
    photoCount: grid.photoCount,
    totalFlightDistanceM: grid.totalFlightDistanceM,
    estimatedDurationSeconds: grid.estimatedDurationSeconds,
    estimatedBatteryLegs: grid.estimatedBatteryLegs,
    coverageAreaM2: grid.coverageAreaM2,
    flightAxisDeg: grid.flightAxisDeg,
    assumptions: grid.assumptions,
    input,
  };
}

export type SnapshotParseResult =
  | { ok: true; snapshot: ParsedFlightSnapshot }
  | { ok: false; message: string };

function isLonLat(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Validate a stored generated_plan into the shape the exports need. Refusals
 * name what is wrong: a snapshot written by unknown code, or one whose
 * internal counts disagree, must never silently become a flight file.
 */
export function parseFlightPlanSnapshot(value: unknown): SnapshotParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "The saved snapshot is not an object." };
  }
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== FLIGHT_SNAPSHOT_SCHEMA_VERSION) {
    return {
      ok: false,
      message: `The saved snapshot's schema ("${String(raw.schemaVersion)}") is not the one this OpenPlan writes (${FLIGHT_SNAPSHOT_SCHEMA_VERSION}). Regenerate and save the flight plan.`,
    };
  }
  if (!positiveNumber(raw.altitudeM) || !positiveNumber(raw.gsdCm)) {
    return { ok: false, message: "The saved snapshot has no usable altitude or ground resolution." };
  }
  const inputEcho = raw.input as Record<string, unknown> | undefined;
  if (
    !inputEcho ||
    !positiveNumber(inputEcho.speedMps) ||
    !positiveNumber(inputEcho.flightMinutesPerBattery) ||
    typeof inputEcho.turnAllowanceSeconds !== "number"
  ) {
    return { ok: false, message: "The saved snapshot does not echo the speed and battery inputs it was generated with." };
  }
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) {
    return { ok: false, message: "The saved snapshot contains no flight lines." };
  }
  const lines: FlightSnapshotLine[] = [];
  let photoSum = 0;
  for (const candidate of raw.lines) {
    const line = candidate as Record<string, unknown>;
    if (
      typeof line.index !== "number" ||
      (line.grid !== "primary" && line.grid !== "cross") ||
      !isLonLat(line.start) ||
      !isLonLat(line.end) ||
      typeof line.headingDeg !== "number" ||
      typeof line.lengthM !== "number" ||
      !Array.isArray(line.photoPoints) ||
      !line.photoPoints.every(isLonLat)
    ) {
      return { ok: false, message: "A flight line in the saved snapshot is malformed." };
    }
    photoSum += line.photoPoints.length;
    lines.push({
      index: line.index,
      grid: line.grid,
      start: line.start as [number, number],
      end: line.end as [number, number],
      headingDeg: line.headingDeg,
      lengthM: line.lengthM,
      photoPoints: line.photoPoints as [number, number][],
    });
  }
  if (raw.photoCount !== photoSum) {
    return {
      ok: false,
      message: `The saved snapshot's photo count (${String(raw.photoCount)}) disagrees with its own lines (${photoSum} trigger points).`,
    };
  }
  if (
    typeof raw.lineCount !== "number" ||
    raw.lineCount !== lines.length ||
    typeof raw.totalFlightDistanceM !== "number" ||
    typeof raw.estimatedDurationSeconds !== "number" ||
    typeof raw.estimatedBatteryLegs !== "number" ||
    !Array.isArray(raw.assumptions) ||
    !raw.assumptions.every((entry) => typeof entry === "string")
  ) {
    return { ok: false, message: "The saved snapshot's summary figures are incomplete." };
  }
  return {
    ok: true,
    snapshot: {
      schemaVersion: FLIGHT_SNAPSHOT_SCHEMA_VERSION,
      altitudeM: raw.altitudeM,
      gsdCm: raw.gsdCm,
      lines,
      lineCount: raw.lineCount,
      photoCount: photoSum,
      totalFlightDistanceM: raw.totalFlightDistanceM,
      estimatedDurationSeconds: raw.estimatedDurationSeconds,
      estimatedBatteryLegs: raw.estimatedBatteryLegs,
      assumptions: raw.assumptions as string[],
      input: {
        speedMps: inputEcho.speedMps as number,
        flightMinutesPerBattery: inputEcho.flightMinutesPerBattery as number,
        turnAllowanceSeconds: inputEcho.turnAllowanceSeconds as number,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// shared waypoint flattening
// ---------------------------------------------------------------------------

type Waypoint = {
  lon: number;
  lat: number;
  headingDeg: number;
};

/** Photo trigger points in flight order, each carrying its line's heading. */
function flattenWaypoints(snapshot: ParsedFlightSnapshot): Waypoint[] {
  const ordered = [...snapshot.lines].sort((a, b) => a.index - b.index);
  const waypoints: Waypoint[] = [];
  for (const line of ordered) {
    for (const [lon, lat] of line.photoPoints) {
      waypoints.push({ lon, lat, headingDeg: line.headingDeg });
    }
  }
  return waypoints;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// (a) DJI WPML .kmz
// ---------------------------------------------------------------------------

export type WpmlBuildInput = {
  missionTitle: string;
  snapshot: ParsedFlightSnapshot;
  /** From the plan row; null = the plan states no gimbal pitch, so no
   *  gimbalRotate action is written and the aircraft's current setting rules. */
  gimbalPitchDeg: number | null;
  /** Timestamp for wpml:createTime/updateTime; injectable for deterministic tests. */
  now?: Date;
};

const WPML_NAMESPACE = "http://www.dji.com/wpmz/1.0.2";

function wpmlMissionConfig(speedMps: number): string {
  // Conservative, vendor-neutral safety enums: return home when done, keep
  // executing the configured loss action on RC loss, go back on loss.
  return [
    "  <wpml:missionConfig>",
    "    <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>",
    "    <wpml:finishAction>goHome</wpml:finishAction>",
    "    <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>",
    "    <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>",
    `    <wpml:globalTransitionalSpeed>${speedMps}</wpml:globalTransitionalSpeed>`,
    "  </wpml:missionConfig>",
  ].join("\n");
}

function wpmlGimbalAction(actionId: number, gimbalPitchDeg: number): string {
  return [
    "        <wpml:action>",
    `          <wpml:actionId>${actionId}</wpml:actionId>`,
    "          <wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>",
    "          <wpml:actionActuatorFuncParam>",
    "            <wpml:gimbalRotateMode>absoluteAngle</wpml:gimbalRotateMode>",
    "            <wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>",
    `            <wpml:gimbalPitchRotateAngle>${gimbalPitchDeg}</wpml:gimbalPitchRotateAngle>`,
    "            <wpml:gimbalRollRotateEnable>0</wpml:gimbalRollRotateEnable>",
    "            <wpml:gimbalRollRotateAngle>0</wpml:gimbalRollRotateAngle>",
    "            <wpml:gimbalYawRotateEnable>0</wpml:gimbalYawRotateEnable>",
    "            <wpml:gimbalYawRotateAngle>0</wpml:gimbalYawRotateAngle>",
    "            <wpml:gimbalRotateTimeEnable>0</wpml:gimbalRotateTimeEnable>",
    "            <wpml:gimbalRotateTime>0</wpml:gimbalRotateTime>",
    "            <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>",
    "          </wpml:actionActuatorFuncParam>",
    "        </wpml:action>",
  ].join("\n");
}

function wpmlTakePhotoAction(actionId: number): string {
  return [
    "        <wpml:action>",
    `          <wpml:actionId>${actionId}</wpml:actionId>`,
    "          <wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>",
    "          <wpml:actionActuatorFuncParam>",
    "            <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>",
    "          </wpml:actionActuatorFuncParam>",
    "        </wpml:action>",
  ].join("\n");
}

function wpmlPlacemark(
  waypoint: Waypoint,
  index: number,
  altitudeM: number,
  speedMps: number,
  gimbalPitchDeg: number | null
): string {
  const actions: string[] = [];
  let actionId = 0;
  // Gimbal pitch is set once, at the first waypoint, then holds for the
  // mission; writing it at every point would fight any manual correction.
  if (index === 0 && gimbalPitchDeg !== null) {
    actions.push(wpmlGimbalAction(actionId, gimbalPitchDeg));
    actionId += 1;
  }
  actions.push(wpmlTakePhotoAction(actionId));

  return [
    "    <Placemark>",
    "      <Point>",
    `        <coordinates>${waypoint.lon},${waypoint.lat}</coordinates>`,
    "      </Point>",
    `      <wpml:index>${index}</wpml:index>`,
    `      <wpml:executeHeight>${altitudeM}</wpml:executeHeight>`,
    `      <wpml:waypointSpeed>${speedMps}</wpml:waypointSpeed>`,
    "      <wpml:waypointHeadingParam>",
    "        <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>",
    "      </wpml:waypointHeadingParam>",
    "      <wpml:waypointTurnParam>",
    "        <wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>",
    "        <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>",
    "      </wpml:waypointTurnParam>",
    `      <wpml:actionGroup>`,
    `        <wpml:actionGroupId>${index}</wpml:actionGroupId>`,
    `        <wpml:actionGroupStartIndex>${index}</wpml:actionGroupStartIndex>`,
    `        <wpml:actionGroupEndIndex>${index}</wpml:actionGroupEndIndex>`,
    "        <wpml:actionGroupMode>sequence</wpml:actionGroupMode>",
    "        <wpml:actionTrigger>",
    "          <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>",
    "        </wpml:actionTrigger>",
    actions.join("\n"),
    "      </wpml:actionGroup>",
    "    </Placemark>",
  ].join("\n");
}

/** waylines.wpml — the executable route DJI Pilot 2 flies. Exported for tests. */
export function buildWpmlWaylines(input: WpmlBuildInput): string {
  const { snapshot, gimbalPitchDeg } = input;
  const speed = snapshot.input.speedMps;
  const waypoints = flattenWaypoints(snapshot);
  const placemarks = waypoints.map((waypoint, index) =>
    wpmlPlacemark(waypoint, index, snapshot.altitudeM, speed, gimbalPitchDeg)
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="${WPML_NAMESPACE}">`,
    "<Document>",
    wpmlMissionConfig(speed),
    "  <Folder>",
    "    <wpml:templateId>0</wpml:templateId>",
    "    <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>",
    "    <wpml:waylineId>0</wpml:waylineId>",
    `    <wpml:autoFlightSpeed>${speed}</wpml:autoFlightSpeed>`,
    placemarks.join("\n"),
    "  </Folder>",
    "</Document>",
    "</kml>",
    "",
  ].join("\n");
}

/** template.kml — the package's editable template header. Exported for tests. */
export function buildWpmlTemplate(input: WpmlBuildInput): string {
  const created = (input.now ?? new Date()).getTime();
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="${WPML_NAMESPACE}">`,
    "<Document>",
    `  <wpml:author>OpenPlan flight plan — ${escapeXml(input.missionTitle)}</wpml:author>`,
    `  <wpml:createTime>${created}</wpml:createTime>`,
    `  <wpml:updateTime>${created}</wpml:updateTime>`,
    wpmlMissionConfig(input.snapshot.input.speedMps),
    "</Document>",
    "</kml>",
    "",
  ].join("\n");
}

/**
 * The .kmz package: `wpmz/template.kml` + `wpmz/waylines.wpml`, zipped.
 * jszip is loaded lazily so client code importing this module for the
 * snapshot helpers does not carry it.
 */
export async function buildDjiWpmlKmz(input: WpmlBuildInput): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const folder = zip.folder("wpmz");
  if (!folder) throw new Error("Could not create the wpmz folder in the archive");
  folder.file("template.kml", buildWpmlTemplate(input));
  folder.file("waylines.wpml", buildWpmlWaylines(input));
  return zip.generateAsync({ type: "uint8array" });
}

// ---------------------------------------------------------------------------
// (b) Litchi CSV
// ---------------------------------------------------------------------------

/** Litchi caps a waypoint mission at this many waypoints; surfaced by the UI. */
export const LITCHI_WAYPOINT_LIMIT = 99;

const LITCHI_ACTION_SLOTS = 15;

/** The Litchi Mission Hub CSV header, verbatim. Exported for tests. */
export const LITCHI_CSV_HEADER = [
  "latitude",
  "longitude",
  "altitude(m)",
  "heading(deg)",
  "curvesize(m)",
  "rotationdir",
  "gimbalmode",
  "gimbalpitchangle",
  ...Array.from({ length: LITCHI_ACTION_SLOTS }, (_, i) => [`actiontype${i + 1}`, `actionparam${i + 1}`]).flat(),
  "altitudemode",
  "speed(m/s)",
  "poi_latitude",
  "poi_longitude",
  "poi_altitude(m)",
  "poi_altitudemode",
  "photo_timeinterval",
  "photo_distinterval",
].join(",");

export type LitchiBuildInput = {
  snapshot: ParsedFlightSnapshot;
  gimbalPitchDeg: number | null;
};

export function buildLitchiCsv(input: LitchiBuildInput): string {
  const { snapshot, gimbalPitchDeg } = input;
  const speed = snapshot.input.speedMps;
  const rows = flattenWaypoints(snapshot).map((waypoint) => {
    const actions: (number | string)[] = [];
    // Slot 1: TAKE_PHOTO (Litchi action type 1). Remaining slots empty (-1).
    actions.push(1, 0);
    for (let slot = 1; slot < LITCHI_ACTION_SLOTS; slot++) actions.push(-1, 0);
    return [
      waypoint.lat,
      waypoint.lon,
      snapshot.altitudeM,
      waypoint.headingDeg,
      0, // curvesize: stop-and-turn at each waypoint, matching the grid's serpentine
      0, // rotationdir
      gimbalPitchDeg !== null ? 2 : 0, // gimbalmode: 2 = interpolate to the stated pitch, 0 = disabled
      gimbalPitchDeg !== null ? gimbalPitchDeg : 0,
      ...actions,
      0, // altitudemode: 0 = relative to the takeoff point (the generator's stated assumption)
      speed,
      0, // poi_latitude
      0, // poi_longitude
      0, // poi_altitude(m)
      0, // poi_altitudemode
      -1, // photo_timeinterval: disabled — photos are per-waypoint actions
      -1, // photo_distinterval: disabled for the same reason
    ].join(",");
  });
  return [LITCHI_CSV_HEADER, ...rows].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// (c) generic KML
// ---------------------------------------------------------------------------

export type KmlBuildInput = {
  missionTitle: string;
  snapshot: ParsedFlightSnapshot;
};

/** Plain KML 2.2: one LineString placemark per flight line, one Point per
 *  photo trigger. 2-D on purpose — KML altitude semantics (absolute vs
 *  relative) vary by viewer, and a wrong vertical datum shown confidently is
 *  worse than none; the description states the planned AGL height instead. */
export function buildGenericKml(input: KmlBuildInput): string {
  const { missionTitle, snapshot } = input;
  const description =
    `Survey flight plan: ${snapshot.lineCount} lines, ${snapshot.photoCount} photo trigger points. ` +
    `Planned height ${snapshot.altitudeM} m above the takeoff/ground plane (not encoded in the geometry — see the flight plan for vertical assumptions).`;
  const lines = [...snapshot.lines]
    .sort((a, b) => a.index - b.index)
    .map((line) =>
      [
        "    <Placemark>",
        `      <name>Line ${line.index + 1} (${line.grid})</name>`,
        "      <LineString>",
        `        <coordinates>${line.start[0]},${line.start[1]} ${line.end[0]},${line.end[1]}</coordinates>`,
        "      </LineString>",
        "    </Placemark>",
      ].join("\n")
    );
  const points = flattenWaypoints(snapshot).map((waypoint, index) =>
    [
      "    <Placemark>",
      `      <name>Photo ${index + 1}</name>`,
      "      <Point>",
      `        <coordinates>${waypoint.lon},${waypoint.lat}</coordinates>`,
      "      </Point>",
      "    </Placemark>",
    ].join("\n")
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<kml xmlns="http://www.opengis.net/kml/2.2">`,
    "  <Document>",
    `    <name>${escapeXml(missionTitle)} — flight plan</name>`,
    `    <description>${escapeXml(description)}</description>`,
    lines.join("\n"),
    points.join("\n"),
    "  </Document>",
    "</kml>",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// filenames + content types (shared by the route and any future caller)
// ---------------------------------------------------------------------------

export type FlightExportFormat = "wpml" | "litchi" | "kml";

export const FLIGHT_EXPORT_FORMATS: readonly FlightExportFormat[] = ["wpml", "litchi", "kml"];

export function isFlightExportFormat(value: string): value is FlightExportFormat {
  return (FLIGHT_EXPORT_FORMATS as readonly string[]).includes(value);
}

export function flightExportContentType(format: FlightExportFormat): string {
  switch (format) {
    case "wpml":
      return "application/vnd.google-earth.kmz";
    case "litchi":
      return "text/csv; charset=utf-8";
    case "kml":
      return "application/vnd.google-earth.kml+xml; charset=utf-8";
  }
}

export function flightExportFilename(
  missionTitle: string,
  missionId: string,
  format: FlightExportFormat
): string {
  const safeTitle = missionTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const base = `flight-plan-${safeTitle || missionId}`;
  switch (format) {
    case "wpml":
      return `${base}.kmz`;
    case "litchi":
      return `${base}-litchi.csv`;
    case "kml":
      return `${base}.kml`;
  }
}
