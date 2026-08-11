import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { generateSurveyGrid } from "@/lib/aerial/survey-grid";
import {
  buildDjiWpmlKmz,
  buildFlightPlanSnapshot,
  buildGenericKml,
  buildLitchiCsv,
  buildWpmlTemplate,
  buildWpmlWaylines,
  FLIGHT_SNAPSHOT_SCHEMA_VERSION,
  flightExportContentType,
  flightExportFilename,
  parseFlightPlanSnapshot,
  type ParsedFlightSnapshot,
} from "@/lib/aerial/flight-exports";

/**
 * Golden-fixture tests for the three flight exports, against a HAND-BUILT
 * snapshot small enough to count by eye: 2 flight lines, 3 + 2 = 5 photo
 * trigger points, altitude 100 m, speed 8 m/s, gimbal −90°.
 *
 * The landmarks asserted are the structural ones a consuming app depends on:
 * WPML has one Placemark and one takePhoto action PER photo point; Litchi has
 * one CSV row per photo point under the documented header; KML has one
 * placemark per line plus one per photo point. Counts are equalities, never
 * floors.
 */

const LINE0_PHOTOS: [number, number][] = [
  [10.0, 45.0],
  [10.0005, 45.0],
  [10.001, 45.0],
];
const LINE1_PHOTOS: [number, number][] = [
  [10.001, 45.0005],
  [10.0, 45.0005],
];

function rawSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: FLIGHT_SNAPSHOT_SCHEMA_VERSION,
    altitudeM: 100,
    gsdCm: 2.74,
    footprintWidthM: 149.9,
    footprintHeightM: 99.9,
    lineSpacingM: 52.5,
    actualLineSpacingM: 52.5,
    photoSpacingM: 25,
    lines: [
      {
        index: 0,
        grid: "primary",
        start: [10.0, 45.0],
        end: [10.001, 45.0],
        headingDeg: 90,
        lengthM: 78.6,
        photoPoints: LINE0_PHOTOS,
      },
      {
        index: 1,
        grid: "primary",
        start: [10.001, 45.0005],
        end: [10.0, 45.0005],
        headingDeg: 270,
        lengthM: 78.6,
        photoPoints: LINE1_PHOTOS,
      },
    ],
    lineCount: 2,
    photoCount: 5,
    totalFlightDistanceM: 212.8,
    estimatedDurationSeconds: 34.6,
    estimatedBatteryLegs: 1,
    coverageAreaM2: 4368,
    flightAxisDeg: 90,
    assumptions: ["assumption one", "assumption two"],
    input: { speedMps: 8, flightMinutesPerBattery: 20, turnAllowanceSeconds: 8 },
    ...overrides,
  };
}

function snapshot(): ParsedFlightSnapshot {
  const parsed = parseFlightPlanSnapshot(rawSnapshot());
  if (!parsed.ok) throw new Error(`fixture must parse: ${parsed.message}`);
  return parsed.snapshot;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("parseFlightPlanSnapshot", () => {
  it("accepts the fixture and echoes its figures", () => {
    const parsed = parseFlightPlanSnapshot(rawSnapshot());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.photoCount).toBe(5);
    expect(parsed.snapshot.lineCount).toBe(2);
    expect(parsed.snapshot.altitudeM).toBe(100);
    expect(parsed.snapshot.input.speedMps).toBe(8);
  });

  it("refuses an unknown schema version by name instead of guessing", () => {
    const parsed = parseFlightPlanSnapshot(rawSnapshot({ schemaVersion: "somebody-elses-2" }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("somebody-elses-2");
  });

  it("refuses a snapshot whose photoCount disagrees with its own lines", () => {
    const parsed = parseFlightPlanSnapshot(rawSnapshot({ photoCount: 7 }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("disagrees");
  });

  it("refuses a snapshot missing the speed/battery input echo", () => {
    const parsed = parseFlightPlanSnapshot(rawSnapshot({ input: undefined }));
    expect(parsed.ok).toBe(false);
  });

  it("refuses a snapshot with no lines at all", () => {
    const parsed = parseFlightPlanSnapshot(rawSnapshot({ lines: [], lineCount: 0, photoCount: 0 }));
    expect(parsed.ok).toBe(false);
  });

  it("round-trips what buildFlightPlanSnapshot writes for a REAL generated grid", () => {
    // Integration with the actual generator: whatever the editor stores must
    // come back out parseable, or exports die on real data while the fixture
    // tests stay green.
    const grid = generateSurveyGrid({
      aoiRing: [
        [10.0, 45.0],
        [10.005, 45.0],
        [10.005, 45.003],
        [10.0, 45.003],
      ],
      camera: {
        sensorWidthMm: 13.2,
        sensorHeightMm: 8.8,
        imageWidthPx: 5472,
        imageHeightPx: 3648,
        focalLengthMm: 8.8,
      },
      targetGsdCm: 3,
      frontOverlapPct: 75,
      sideOverlapPct: 65,
      speedMps: 8,
      boundaryMarginM: 10,
      flightMinutesPerBattery: 20,
    });
    if (!grid.ok) throw new Error(`generator refused the fixture: ${grid.message}`);
    const stored = buildFlightPlanSnapshot(grid, {
      speedMps: 8,
      flightMinutesPerBattery: 20,
      turnAllowanceSeconds: 8,
    });
    // Through JSON, as JSONB storage would deliver it.
    const parsed = parseFlightPlanSnapshot(JSON.parse(JSON.stringify(stored)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.photoCount).toBe(grid.photoCount);
    expect(parsed.snapshot.lineCount).toBe(grid.lineCount);
  });
});

describe("DJI WPML export", () => {
  it("writes one Placemark and one takePhoto trigger action per photo point — exact counts", () => {
    const waylines = buildWpmlWaylines({
      missionTitle: "Riverfront survey",
      snapshot: snapshot(),
      gimbalPitchDeg: -90,
    });
    expect(count(waylines, "<Placemark>")).toBe(5);
    expect(count(waylines, "<wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>")).toBe(5);
    expect(count(waylines, "<wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>")).toBe(5);
    // Height and speed on every waypoint.
    expect(count(waylines, "<wpml:executeHeight>100</wpml:executeHeight>")).toBe(5);
    expect(count(waylines, "<wpml:waypointSpeed>8</wpml:waypointSpeed>")).toBe(5);
    expect(waylines).toContain("<wpml:autoFlightSpeed>8</wpml:autoFlightSpeed>");
    // The cited schema version.
    expect(waylines).toContain('xmlns:wpml="http://www.dji.com/wpmz/1.0.2"');
    // First waypoint is the first photo point of line 0, in lon,lat order.
    expect(waylines).toContain("<coordinates>10,45</coordinates>");
  });

  it("sets the gimbal pitch once, at the first waypoint, when the plan states one", () => {
    const waylines = buildWpmlWaylines({
      missionTitle: "t",
      snapshot: snapshot(),
      gimbalPitchDeg: -90,
    });
    expect(count(waylines, "<wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>")).toBe(1);
    expect(waylines).toContain("<wpml:gimbalPitchRotateAngle>-90</wpml:gimbalPitchRotateAngle>");
  });

  it("writes NO gimbal action when the plan states no pitch — silence, not a default", () => {
    const waylines = buildWpmlWaylines({
      missionTitle: "t",
      snapshot: snapshot(),
      gimbalPitchDeg: null,
    });
    expect(waylines).not.toContain("gimbalRotate");
  });

  it("packages template.kml and waylines.wpml under wpmz/ in the kmz", async () => {
    const now = new Date("2026-08-11T12:00:00Z");
    const bytes = await buildDjiWpmlKmz({
      missionTitle: "Riverfront survey",
      snapshot: snapshot(),
      gimbalPitchDeg: -90,
      now,
    });
    expect(bytes.byteLength).toBeGreaterThan(0);
    const zip = await JSZip.loadAsync(bytes);
    const template = zip.file("wpmz/template.kml");
    const waylines = zip.file("wpmz/waylines.wpml");
    expect(template).not.toBeNull();
    expect(waylines).not.toBeNull();
    const waylinesText = await waylines!.async("string");
    expect(waylinesText).toBe(
      buildWpmlWaylines({ missionTitle: "Riverfront survey", snapshot: snapshot(), gimbalPitchDeg: -90 })
    );
    const templateText = await template!.async("string");
    expect(templateText).toContain(`<wpml:createTime>${now.getTime()}</wpml:createTime>`);
    expect(templateText).toContain("Riverfront survey");
  });

  it("escapes the mission title in template.kml", () => {
    const template = buildWpmlTemplate({
      missionTitle: 'Bridge & "west" <approach>',
      snapshot: snapshot(),
      gimbalPitchDeg: null,
      now: new Date(0),
    });
    expect(template).toContain("Bridge &amp; &quot;west&quot; &lt;approach&gt;");
    expect(template).not.toContain("<approach>");
  });
});

describe("Litchi CSV export", () => {
  // The Litchi Mission Hub column set, written out independently here so a
  // drift in the builder's header is a failure, not a shared constant.
  const EXPECTED_HEADER =
    "latitude,longitude,altitude(m),heading(deg),curvesize(m),rotationdir,gimbalmode,gimbalpitchangle," +
    "actiontype1,actionparam1,actiontype2,actionparam2,actiontype3,actionparam3,actiontype4,actionparam4," +
    "actiontype5,actionparam5,actiontype6,actionparam6,actiontype7,actionparam7,actiontype8,actionparam8," +
    "actiontype9,actionparam9,actiontype10,actionparam10,actiontype11,actionparam11,actiontype12,actionparam12," +
    "actiontype13,actionparam13,actiontype14,actionparam14,actiontype15,actionparam15," +
    "altitudemode,speed(m/s),poi_latitude,poi_longitude,poi_altitude(m),poi_altitudemode,photo_timeinterval,photo_distinterval";

  it("emits exactly one row per photo point under the documented header", () => {
    const csv = buildLitchiCsv({ snapshot: snapshot(), gimbalPitchDeg: -90 });
    const rows = csv.trim().split("\n");
    expect(rows).toHaveLength(1 + 5);
    expect(rows[0]).toBe(EXPECTED_HEADER);
  });

  it("hand-derived first row: lat, lon, altitude, heading, gimbal, TAKE_PHOTO action, speed", () => {
    const csv = buildLitchiCsv({ snapshot: snapshot(), gimbalPitchDeg: -90 });
    const first = csv.trim().split("\n")[1].split(",");
    expect(first[0]).toBe("45"); // latitude of line 0, photo 0
    expect(first[1]).toBe("10"); // longitude
    expect(first[2]).toBe("100"); // altitude(m)
    expect(first[3]).toBe("90"); // heading(deg) = line 0's heading
    expect(first[4]).toBe("0"); // curvesize
    expect(first[6]).toBe("2"); // gimbalmode: interpolate
    expect(first[7]).toBe("-90"); // gimbalpitchangle
    expect(first[8]).toBe("1"); // actiontype1 = TAKE_PHOTO
    expect(first[9]).toBe("0"); // actionparam1
    expect(first[10]).toBe("-1"); // actiontype2 unused
    expect(first[38]).toBe("0"); // altitudemode: relative to takeoff
    expect(first[39]).toBe("8"); // speed(m/s)
    expect(first[44]).toBe("-1"); // photo_timeinterval disabled
    expect(first[45]).toBe("-1"); // photo_distinterval disabled
    expect(first).toHaveLength(46);
  });

  it("fourth row belongs to line 1: heading flips to 270 — the binding, not a constant", () => {
    const csv = buildLitchiCsv({ snapshot: snapshot(), gimbalPitchDeg: -90 });
    const fourth = csv.trim().split("\n")[4].split(",");
    expect(fourth[0]).toBe("45.0005");
    expect(fourth[1]).toBe("10.001");
    expect(fourth[3]).toBe("270");
  });

  it("disables the gimbal columns when the plan states no pitch", () => {
    const csv = buildLitchiCsv({ snapshot: snapshot(), gimbalPitchDeg: null });
    const first = csv.trim().split("\n")[1].split(",");
    expect(first[6]).toBe("0");
    expect(first[7]).toBe("0");
  });
});

describe("generic KML export", () => {
  it("one placemark per flight line plus one per photo point — exact count", () => {
    const kml = buildGenericKml({ missionTitle: "Riverfront survey", snapshot: snapshot() });
    expect(count(kml, "<Placemark>")).toBe(2 + 5);
    expect(count(kml, "<LineString>")).toBe(2);
    expect(count(kml, "<Point>")).toBe(5);
    expect(kml).toContain("<coordinates>10,45 10.001,45</coordinates>");
  });

  it("states the planned height in prose instead of encoding an ambiguous KML altitude", () => {
    const kml = buildGenericKml({ missionTitle: "t", snapshot: snapshot() });
    expect(kml).toContain("100 m above the takeoff/ground plane");
    // No altitude values inside the geometry.
    expect(kml).not.toContain("altitudeMode");
  });

  it("escapes the mission title", () => {
    const kml = buildGenericKml({ missionTitle: "Cliff & Cove", snapshot: snapshot() });
    expect(kml).toContain("Cliff &amp; Cove — flight plan");
  });
});

describe("out-of-index-order stored lines", () => {
  // JSONB gives back whatever order the snapshot was stored in, and nothing
  // upstream promises index order. Mutation M9 of the 2026-08-11 review found
  // no test fed out-of-order lines, so flattenWaypoints' index sort survived
  // deletion. This is that test: the shuffled snapshot must export BYTE-EQUAL
  // to the in-order one, in all three formats — a crew must fly the serpentine
  // the planner reviewed, not the storage order.
  function shuffledSnapshot(): ParsedFlightSnapshot {
    const raw = rawSnapshot();
    raw.lines = [...(raw.lines as unknown[])].reverse(); // line 1 stored before line 0
    const parsed = parseFlightPlanSnapshot(raw);
    if (!parsed.ok) throw new Error(`shuffled fixture must parse: ${parsed.message}`);
    // The premise, proven: the parser preserves storage order rather than
    // sorting — otherwise this whole describe would be testing nothing.
    expect(parsed.snapshot.lines[0].index).toBe(1);
    return parsed.snapshot;
  }

  it("WPML waylines are identical to the in-order export", () => {
    const build = (snap: ParsedFlightSnapshot) =>
      buildWpmlWaylines({ missionTitle: "t", snapshot: snap, gimbalPitchDeg: -90 });
    expect(build(shuffledSnapshot())).toBe(build(snapshot()));
  });

  it("Litchi CSV is identical to the in-order export", () => {
    const build = (snap: ParsedFlightSnapshot) =>
      buildLitchiCsv({ snapshot: snap, gimbalPitchDeg: -90 });
    expect(build(shuffledSnapshot())).toBe(build(snapshot()));
  });

  it("generic KML is identical to the in-order export", () => {
    const build = (snap: ParsedFlightSnapshot) =>
      buildGenericKml({ missionTitle: "t", snapshot: snap });
    expect(build(shuffledSnapshot())).toBe(build(snapshot()));
  });
});

describe("filenames and content types", () => {
  it("names each format's file from the mission title", () => {
    expect(flightExportFilename("Riverfront Survey 2026!", "m-1", "wpml")).toBe(
      "flight-plan-riverfront-survey-2026.kmz"
    );
    expect(flightExportFilename("Riverfront Survey 2026!", "m-1", "litchi")).toBe(
      "flight-plan-riverfront-survey-2026-litchi.csv"
    );
    expect(flightExportFilename("Riverfront Survey 2026!", "m-1", "kml")).toBe(
      "flight-plan-riverfront-survey-2026.kml"
    );
    // A title that slugs to nothing falls back to the mission id.
    expect(flightExportFilename("???", "m-1", "kml")).toBe("flight-plan-m-1.kml");
  });

  it("serves each format under its own content type", () => {
    expect(flightExportContentType("wpml")).toBe("application/vnd.google-earth.kmz");
    expect(flightExportContentType("litchi")).toContain("text/csv");
    expect(flightExportContentType("kml")).toContain("kml+xml");
  });
});
