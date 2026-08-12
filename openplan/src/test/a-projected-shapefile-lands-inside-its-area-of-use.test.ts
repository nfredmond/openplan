/**
 * A projected shapefile is placed, and then CHECKED — end to end.
 *
 * ═══ WHAT MAKES THIS DIFFERENT FROM A PROJECTION TEST ═══
 *
 * `every-crs-entry-has-an-implemented-method` proves the arithmetic agrees with
 * PROJ. That is necessary and it is not sufficient, because the arithmetic is
 * never wrong in the way that hurts a planner. What hurts a planner is correct
 * arithmetic applied to the wrong coordinate system: California zone 2 will
 * happily convert Ohio's numbers into a longitude and a latitude, and the
 * result is a bike network drawn in Nevada that looks exactly like a bike
 * network drawn in Sacramento.
 *
 * So this exercises the whole path a real upload takes — zip, .prj, resolver,
 * reprojection, range check, placement check — and then asserts that a layer
 * landing somewhere its coordinate system does not cover is REFUSED rather than
 * drawn.
 */

import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { buildShp, buildZip } from "./fixtures/context-layer-uploads";
import { checkCrsPlacement } from "@/lib/geo/crs/area-of-use";
import { forwardProject } from "@/lib/geo/crs/projections";
import { crsSiblings, findCrsByCode, identifyCrsFromPrj } from "@/lib/geo/crs/registry";
import { readWktCrs } from "@/lib/geo/crs/wkt";
import { reprojectBbox } from "@/lib/geo/crs/reproject";
import { spatialFileCrsFor } from "@/lib/geo/crs";
import {
  importSpatialFile,
  type InflateRawSync,
  type SpatialFileCrsResolver,
} from "@/lib/geo/spatial-file-import";

const encoder = new TextEncoder();
const nodeInflate: InflateRawSync = (compressed, declared) =>
  new Uint8Array(inflateRawSync(compressed, { maxOutputLength: Math.max(declared, 1) }));

/**
 * The resolver a real caller supplies: the registry, and nothing else.
 *
 * Deliberately the production wiring rather than a stub. A stub here would let
 * this suite pass while the registry could not identify a single real .prj,
 * which is the failure mode most worth catching.
 */
const registryResolver: SpatialFileCrsResolver = ({ prjText }) => {
  if (!prjText) {
    return { ok: false, reason: "srs_undetermined", message: "no .prj" };
  }
  const identified = identifyCrsFromPrj(prjText);
  if (!identified.ok) {
    return {
      ok: false,
      reason: "srs_unsupported",
      message: `OpenPlan does not carry ${identified.declaredCode ?? identified.declaredName}.`,
    };
  }
  return { ok: true, crs: spatialFileCrsFor(identified.entry), basis: "prj_file" };
};

/** A shapefile zip whose points are the given lon/lat, expressed in `code`. */
function shapefileIn(code: string, positions: [number, number][], prj: string): Uint8Array {
  const entry = findCrsByCode(code);
  if (!entry) throw new Error(`${code} is not in the registry`);
  const shapes = positions.map(([longitude, latitude]) => {
    const [x, y] = forwardProject(entry.method, longitude, latitude, entry.params);
    return { type: "point" as const, position: [x / entry.unitToMetres, y / entry.unitToMetres] as [number, number] };
  });
  return buildZip([
    { name: "network.shp", data: buildShp(shapes) },
    { name: "network.prj", data: encoder.encode(prj) },
  ]);
}

/** A .prj naming an EPSG code the way a GIS actually writes one. */
function prjFor(code: string): string {
  const entry = findCrsByCode(code);
  if (!entry) throw new Error(`${code} is not in the registry`);
  return (
    `PROJCS["${entry.name}",GEOGCS["${entry.datum}",DATUM["D",SPHEROID["S",6378137,298.257222101]],` +
    `PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4269"]],` +
    `PROJECTION["Lambert_Conformal_Conic_2SP"],UNIT["${entry.unit}",${entry.unitToMetres}],` +
    `AUTHORITY["${entry.authority}","${entry.code}"]]`
  );
}

const SACRAMENTO: [number, number] = [-121.4944, 38.5816];
const SAN_FRANCISCO: [number, number] = [-122.4194, 37.7749];

describe("a projected shapefile is reprojected and then placed", () => {
  it("reads a State Plane shapefile in survey feet and lands it where it belongs", () => {
    const zip = shapefileIn("EPSG:2226", [SACRAMENTO, SAN_FRANCISCO], prjFor("EPSG:2226"));
    const result = importSpatialFile({ filename: "network.zip", bytes: zip, featureCap: null }, nodeInflate, registryResolver);

    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    if (!result.ok) return;

    // Within a metre of where they started — the coordinates are rounded to six
    // decimal places on the way out, which is about 0.1 m.
    const [first, second] = result.featureCollection.features.map(
      (feature) => (feature.geometry as GeoJSON.Point).coordinates
    );
    expect(first[0]).toBeCloseTo(SACRAMENTO[0], 5);
    expect(first[1]).toBeCloseTo(SACRAMENTO[1], 5);
    expect(second[0]).toBeCloseTo(SAN_FRANCISCO[0], 5);
    expect(second[1]).toBeCloseTo(SAN_FRANCISCO[1], 5);
  });

  it("records what it converted FROM, so the layer can be re-checked later", () => {
    const zip = shapefileIn("EPSG:2226", [SACRAMENTO], prjFor("EPSG:2226"));
    const result = importSpatialFile({ filename: "network.zip", bytes: zip, featureCap: null }, nodeInflate, registryResolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The stored SRS is WGS 84 because that is what the geometry now IS; the
    // provenance is separate and must survive, because "this came out of
    // California zone 2 survey feet" is the first thing to check when a layer
    // turns out to be in the wrong place.
    expect(result.srs.code).toBe("4326");
    expect(result.srs.basis).toBe("prj_file");
    expect(result.srs.reprojectedFrom?.code).toBe("2226");
    expect(result.srs.reprojectedFrom?.unit).toBe("US survey foot");
  });

  it("refuses a projected shapefile when no resolver is available, rather than dropping every feature", () => {
    // The engagement lane's behaviour, unchanged: with no registry wired in, a
    // projected file is refused BY NAME. Silently normalizing it to nothing —
    // which is what the WGS84 range check alone would do — would tell the
    // planner their file was empty.
    const zip = shapefileIn("EPSG:2226", [SACRAMENTO], prjFor("EPSG:2226"));
    const result = importSpatialFile({ filename: "network.zip", bytes: zip, featureCap: null }, nodeInflate);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("srs_unsupported");
    expect(result.message).toContain("projected coordinate system");
  });

  it("refuses a layer that lands outside the area its coordinate system covers", () => {
    // Ohio's numbers, read as California zone 2. Every step succeeds: the zip
    // parses, the projection converts, the result is a valid longitude and
    // latitude. Only the area of use can tell that it is wrong.
    const california = findCrsByCode("EPSG:2226")!;
    const ohio = findCrsByCode("EPSG:3734")!;
    const [x, y] = forwardProject(ohio.method, -82.99, 39.96, ohio.params);
    const landed = reprojectBbox(california, x / california.unitToMetres, y / california.unitToMetres, x / california.unitToMetres, y / california.unitToMetres)!;

    const check = checkCrsPlacement({ entry: california, bbox: landed });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toBe("crs_outside_area_of_use");
    expect(check.message).toContain("NAD83 / California zone 2 (ftUS)");
    // The message states the position it computed, so a planner can check the
    // claim rather than take OpenPlan's word for it.
    expect(check.message).toMatch(/\d+\.\d+°[NS] \d+\.\d+°[EW]/);
  });

  it("accepts a layer that lands inside its area of use", () => {
    const california = findCrsByCode("EPSG:2226")!;
    const [x, y] = forwardProject(california.method, ...SACRAMENTO, california.params);
    const landed = reprojectBbox(california, x / california.unitToMetres, y / california.unitToMetres, x / california.unitToMetres, y / california.unitToMetres)!;
    const check = checkCrsPlacement({ entry: california, bbox: landed });
    expect(check.ok).toBe(true);
  });

  it("refuses a layer that lands at null island", () => {
    // Where coordinates go when a false easting was never applied. Checked
    // separately from the area of use because a few registry entries really do
    // cover that water, and for those the area test would pass it.
    const california = findCrsByCode("EPSG:2226")!;
    const check = checkCrsPlacement({
      entry: california,
      bbox: { west: -0.2, south: -0.2, east: 0.2, north: 0.2 },
    });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toBe("crs_null_island");
    expect(check.message).toContain("0°N 0°E");
  });

  it("warns rather than refuses when a layer is far from the workspace's own geography", () => {
    // A statewide dataset, a neighbouring county, or a regional agency's file
    // are all legitimate. Refusing here would block real work to catch a
    // mistake the planner is better placed to judge.
    const newYork = findCrsByCode("EPSG:2260")!;
    const check = checkCrsPlacement({
      entry: newYork,
      bbox: { west: -74.1, south: 40.9, east: -74.0, north: 41.0 },
      homeGeography: { west: -121.6, south: 38.5, east: -121.4, north: 38.7 },
    });
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.warnings.map((warning) => warning.code)).toContain("far_from_home_geography");
    expect(check.warnings.find((warning) => warning.code === "far_from_home_geography")?.message).toMatch(/km from your workspace/);
  });

  it("carries the measured datum caveat through as a warning, for NAD27", () => {
    // The "super old shapefiles" case. OpenPlan ships no datum-shift grids, so
    // a NAD27 layer really is over a hundred metres out, and the number in the
    // warning is measured against PROJ rather than remembered.
    const alaska = findCrsByCode("EPSG:26731")!;
    expect(alaska.requiresDatumAcknowledgement).toBe(true);
    const check = checkCrsPlacement({
      entry: alaska,
      bbox: { west: -134.5, south: 58.2, east: -134.3, north: 58.4 },
    });
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    const datum = check.warnings.find((warning) => warning.code === "datum_shift");
    expect(datum).toBeDefined();
    expect(datum?.message).toMatch(/North American Datum 1927/);
    expect(datum?.message).toMatch(/\d+ m/);
  });

  it("converts absurd coordinates without complaint — which is why the placement check is not optional", () => {
    // THE POINT OF THIS TEST IS THAT THE IMPORTER PASSES. Eastings of nine
    // billion survey feet are not a plausible California zone 2 coordinate by
    // any measure, and a conic projection converts them into a perfectly
    // well-formed longitude and latitude anyway, because that is what conic
    // projections do — they wrap. Nothing in the parsing, the projection, or
    // the WGS 84 range check can notice.
    //
    // So the honest refusal cannot live in the importer, and a caller that
    // reprojects without then calling `checkCrsPlacement` will draw this. The
    // second half of this test is the half that catches it.
    const zip = buildZip([
      { name: "network.shp", data: buildShp([{ type: "point", position: [9e9, 9e9] }]) },
      { name: "network.prj", data: encoder.encode(prjFor("EPSG:2226")) },
    ]);
    const result = importSpatialFile({ filename: "network.zip", bytes: zip, featureCap: null }, nodeInflate, registryResolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bbox).not.toBeNull();

    const [west, south, east, north] = result.bbox!;
    const check = checkCrsPlacement({ entry: findCrsByCode("EPSG:2226")!, bbox: { west, south, east, north } });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toBe("crs_outside_area_of_use");
  });

  it("does not read a PROJCS as the geographic system nested inside it", () => {
    // THE ESRI SHAPE, AND THE WORST FAILURE IN THIS LANE. ArcGIS writes a .prj
    // whose PROJCS carries no AUTHORITY at all while the GEOGCS inside it
    // carries EPSG:4269. A reader that searches the text for an EPSG code finds
    // 4269 — NAD83 GEOGRAPHIC — concludes the file is in degrees, applies no
    // projection, and then discards every feature for having a longitude of
    // 6.4 million. The planner sees an empty map and no reason.
    //
    // Written as a literal string rather than through the helper above,
    // because the helper puts an AUTHORITY on the PROJCS and so cannot express
    // this case at all — which is exactly how it went untested until a
    // mutation showed the check was doing nothing.
    const esriPrj =
      'PROJCS["NAD_1983_StatePlane_California_II_FIPS_0402_Feet",' +
      'GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",' +
      'SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],' +
      'UNIT["Degree",0.0174532925199433],AUTHORITY["EPSG","4269"]],' +
      'PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",6561666.666666666],' +
      'UNIT["Foot_US",0.3048006096012192]]';

    const identified = identifyCrsFromPrj(esriPrj);
    expect(identified.ok).toBe(true);
    if (!identified.ok) return;
    expect(identified.entry.kind).toBe("projected");
    expect(identified.entry.unit).toBe("US survey foot");
    expect(identified.entry.code).not.toBe("4269");

    // And end to end: the layer lands in California rather than being emptied.
    const zip = shapefileIn("EPSG:2226", [SACRAMENTO], esriPrj);
    const result = importSpatialFile({ filename: "network.zip", bytes: zip, featureCap: null }, nodeInflate, registryResolver);
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    if (!result.ok) return;
    const coordinates = (result.featureCollection.features[0].geometry as GeoJSON.Point).coordinates;
    expect(coordinates[0]).toBeCloseTo(SACRAMENTO[0], 5);
    expect(coordinates[1]).toBeCloseTo(SACRAMENTO[1], 5);
  });

  it("reads an authority off the CRS element itself and never off a child", () => {
    // ASSERTED ON THE PARSER DIRECTLY, and that is the point. The end-to-end
    // test above survives a parser that scoops up the nested EPSG:4269, because
    // the kind check downstream catches it and falls back to the name — so the
    // two defences hide each other, and a mutation of either alone leaves every
    // other assertion green. This one can only pass if the scoping is right.
    const esriPrj =
      'PROJCS["NAD_1983_StatePlane_California_II_FIPS_0402_Feet",' +
      'GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",' +
      'SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],' +
      'UNIT["Degree",0.0174532925199433],AUTHORITY["EPSG","4269"]],' +
      'PROJECTION["Lambert_Conformal_Conic"],UNIT["Foot_US",0.3048006096012192]]';

    const parsed = readWktCrs(esriPrj);
    expect(parsed?.kind).toBe("projected");
    expect(parsed?.name).toBe("NAD_1983_StatePlane_California_II_FIPS_0402_Feet");
    expect(parsed?.authority).toBeNull();
    // The declared linear unit is read too — it is what breaks the tie between
    // the metre and survey-foot forms of a zone identified only by name.
    expect(parsed?.unitToMetres).toBeCloseTo(0.3048006096, 9);
  });

  it("reads a BOUNDCRS as the system the file is in, not the hub it is tied to", () => {
    // GDAL writes this shape when a layer carries a datum transformation. The
    // CRS the coordinates are actually in is the SOURCECRS; the TARGETCRS is
    // WGS 84 and is where they could be taken. A reader that takes the first
    // child identifies every such file as WGS 84 and applies no projection.
    const boundPrj =
      'BOUNDCRS[SOURCECRS[PROJCRS["NAD83 / California zone 2 (ftUS)",' +
      'BASEGEOGCRS["NAD83",DATUM["North American Datum 1983",' +
      'ELLIPSOID["GRS 1980",6378137,298.257222101]]],' +
      'CONVERSION["unnamed"],CS[Cartesian,2],LENGTHUNIT["US survey foot",0.304800609601219],' +
      'ID["EPSG",2226]]],' +
      'TARGETCRS[GEOGCRS["WGS 84",DATUM["World Geodetic System 1984",' +
      'ELLIPSOID["WGS 84",6378137,298.257223563]],ID["EPSG",4326]]],' +
      'ABRIDGEDTRANSFORMATION["NAD83 to WGS 84 (1)"]]';

    const parsed = readWktCrs(boundPrj);
    expect(parsed?.kind).toBe("projected");
    expect(parsed?.authority).toEqual({ authority: "EPSG", code: "2226" });

    const identified = identifyCrsFromPrj(boundPrj);
    expect(identified.ok).toBe(true);
    if (!identified.ok) return;
    expect(identified.entry.code).toBe("2226");
    expect(identified.entry.unit).toBe("US survey foot");
  });

  it("refuses to trust an authority code that contradicts the file's own structure", () => {
    // The second net behind the parser. A .prj whose PROJCS carries a
    // GEOGRAPHIC code directly is malformed, and OpenPlan must not act on the
    // code — it falls back to the name, which here is unknown, so it refuses
    // by name rather than reading survey feet as degrees.
    const contradictory =
      'PROJCS["Somewhere Municipal Grid",GEOGCS["GCS_North_American_1983",' +
      'DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],' +
      'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],' +
      'PROJECTION["Lambert_Conformal_Conic"],UNIT["Foot_US",0.3048006096012192],' +
      'AUTHORITY["EPSG","4269"]]';

    const identified = identifyCrsFromPrj(contradictory);
    expect(identified.ok).toBe(false);
    if (identified.ok) return;
    expect(identified.reason).toBe("not_in_registry");
    // The refusal names what the file said, so a planner can look it up.
    expect(identified.declaredName).toBe("Somewhere Municipal Grid");
    expect(identified.declaredCode).toBe("EPSG:4269");
  });

  it("knows which other units the same zone exists in, from the data rather than the name", () => {
    // The fact the feet-for-metres message is built on. Asserted here because a
    // silent regression in sibling matching would turn that message into the
    // generic one without any test of the message itself noticing.
    const feet = findCrsByCode("EPSG:2226")!;
    const siblings = crsSiblings(feet);
    expect(siblings.map((entry) => `${entry.authority}:${entry.code}`)).toContain("EPSG:26942");
    expect(siblings.every((entry) => entry.unitToMetres !== feet.unitToMetres)).toBe(true);
  });
});
