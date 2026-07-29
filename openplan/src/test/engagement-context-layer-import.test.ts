import { describe, expect, it } from "vitest";

import { importContextLayer, readPrj } from "@/lib/engagement/context-layer-import";
import {
  contextLayerDisclosure,
  describeContextLayerCoverage,
  describeContextLayerSrs,
  resolveContextLayerByteCap,
  resolveContextLayerFeatureCap,
} from "@/lib/engagement/context-layers";
import {
  PROJECTED_PRJ,
  WGS84_PRJ,
  buildShp,
  buildShpPolygonWithHole,
  buildZip,
} from "./fixtures/context-layer-uploads";

/**
 * An operator's GIS file becomes a layer a resident can trust, or it is refused
 * with the reason.
 *
 * The assertions worth reading twice are the REFUSALS. A layer that quietly
 * arrives in the wrong place is the failure mode that matters here: it looks
 * right, it gets believed, and the comments collected against it are about the
 * wrong street. So a projected shapefile, a shapefile with no .prj, and a
 * GeoJSON declaring a projected CRS all have to stop — and the message has to
 * tell the planner what to do, because "unsupported" alone leaves them stuck.
 */

const encoder = new TextEncoder();

function geojsonBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function featureCollection(count: number): unknown {
  return {
    type: "FeatureCollection",
    features: Array.from({ length: count }, (_, index) => ({
      type: "Feature",
      properties: { label: `f${index}` },
      geometry: { type: "Point", coordinates: [-100 + index * 0.01, 40] },
    })),
  };
}

// ── GeoJSON ──────────────────────────────────────────────────────────────────

describe("reading a GeoJSON layer", () => {
  it("reads it as WGS84 on the strength of the specification, and says so", () => {
    const result = importContextLayer({
      filename: "alignment.geojson",
      bytes: geojsonBytes({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "Main Street segment" },
            geometry: { type: "LineString", coordinates: [[-120.1, 39.2], [-120.2, 39.25]] },
          },
        ],
      }),
      featureCap: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.srs.basis).toBe("geojson_rfc7946_default");
    expect(result.geometryKinds).toEqual(["LineString"]);
    expect(result.featureCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.featureCollection.features[0].properties).toEqual({ name: "Main Street segment" });

    // The distinction that keeps "we read the specification" from being read as
    // "we checked your file".
    expect(describeContextLayerSrs(result.srs)).toContain("named no coordinate system");
    expect(describeContextLayerSrs(result.srs)).toContain("not guessed");
  });

  it("honours a legacy crs member that names WGS84", () => {
    const result = importContextLayer({
      filename: "parcels.json",
      bytes: geojsonBytes({
        type: "FeatureCollection",
        crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
        features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-97.5, 35.5] } }],
      }),
      featureCap: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.srs.basis).toBe("geojson_crs_member");
  });

  it("refuses a GeoJSON that declares a coordinate system it cannot reproject", () => {
    const result = importContextLayer({
      filename: "parcels.geojson",
      bytes: geojsonBytes({
        type: "FeatureCollection",
        crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::26910" } },
        features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [500000, 4000000] } }],
      }),
      featureCap: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("srs_unsupported");
    expect(result.message).toContain("urn:ogc:def:crs:EPSG::26910");
    expect(result.message).toContain("does not reproject");
  });

  it("refuses a file whose coordinates are plainly not longitude and latitude", () => {
    // No crs member at all — the only evidence that this is projected is the
    // magnitude of the numbers, and drawing them would put the layer in the
    // Atlantic rather than nowhere.
    const result = importContextLayer({
      filename: "stateplane.geojson",
      bytes: geojsonBytes({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [6_500_000, 2_100_000] } }],
      }),
      featureCap: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_drawable_features");
    expect(result.message).toContain("projected coordinate system");
  });

  it("expands a GeometryCollection rather than dropping it", () => {
    const result = importContextLayer({
      filename: "mixed.geojson",
      bytes: geojsonBytes({
        type: "Feature",
        properties: { name: "study limits" },
        geometry: {
          type: "GeometryCollection",
          geometries: [
            { type: "Point", coordinates: [-80, 25] },
            { type: "LineString", coordinates: [[-80, 25], [-80.1, 25.1]] },
          ],
        },
      }),
      featureCap: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.featureCount).toBe(2);
    expect(result.geometryKinds.sort()).toEqual(["LineString", "Point"]);
  });
});

// ── Bounds, caps, and the disclosure they owe ────────────────────────────────

describe("what a bounded layer has to admit", () => {
  it("stores the cap, counts the whole file, and says which is which", () => {
    const result = importContextLayer({
      filename: "parcels.geojson",
      bytes: geojsonBytes(featureCollection(5)),
      featureCap: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.featureCount).toBe(2);
    expect(result.sourceFeatureCount).toBe(5);
    expect(result.truncated).toBe(true);

    const notes = describeContextLayerCoverage(
      "Parcels",
      contextLayerDisclosure({
        feature_count: result.featureCount,
        source_feature_count: result.sourceFeatureCount,
        dropped_feature_count: result.droppedFeatureCount,
        truncated: result.truncated,
      })
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("showing 2 of 5");
    expect(notes[0]).toContain("not a finding");
  });

  it("counts an undrawable feature as dropped, not as truncation", () => {
    const result = importContextLayer({
      filename: "mixed.geojson",
      bytes: geojsonBytes({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-100, 40] } },
          { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-100, 999] } },
        ],
      }),
      featureCap: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.featureCount).toBe(1);
    expect(result.droppedFeatureCount).toBe(1);
    expect(result.truncated).toBe(false);

    // The two disclosures are separate sentences on purpose: a layer that is
    // whole but carrying drops must not be able to hide them behind the absence
    // of a truncation note.
    const notes = describeContextLayerCoverage("Bus stops", {
      returnedCount: 1,
      matchedCount: 2,
      droppedCount: 1,
      truncated: false,
      limit: 1,
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("could not be drawn");
  });

  it("draws its bounding box around what it kept, not around what it threw away", () => {
    // A dropped feature's coordinates used to widen the extent on the way past,
    // because the walk grew the shared bounds before it knew whether the whole
    // geometry would survive. The layer then framed the display map on ground it
    // had drawn nothing on — a silent claim about where the project reaches.
    const result = importContextLayer({
      filename: "corridor.geojson",
      bytes: geojsonBytes({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-100, 40] } },
          {
            type: "Feature",
            properties: {},
            // Two good positions and one impossible latitude. The whole
            // geometry is refused, so none of its three positions may reach the
            // bbox — including the two that were perfectly valid.
            geometry: { type: "LineString", coordinates: [[-130, 45], [-131, 46], [-132, 999]] },
          },
          { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-99, 41] } },
        ],
      }),
      featureCap: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.featureCount).toBe(2);
    expect(result.droppedFeatureCount).toBe(1);
    expect(result.bbox).toEqual([-100, 40, -99, 41]);
  });

  it("keeps the stored bounding box wide enough for the coordinates it stored", () => {
    // Bounds are grown from the ROUNDED positions, so the box provably contains
    // the geometry the map will draw rather than the pre-rounding original.
    const result = importContextLayer({
      filename: "precise.geojson",
      bytes: geojsonBytes({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-121.00000049, 39.99999951] } },
        ],
      }),
      featureCap: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [lng, lat] = (result.featureCollection.features[0].geometry as GeoJSON.Point).coordinates;
    const [west, south, east, north] = result.bbox as [number, number, number, number];
    expect(lng).toBeGreaterThanOrEqual(west);
    expect(lng).toBeLessThanOrEqual(east);
    expect(lat).toBeGreaterThanOrEqual(south);
    expect(lat).toBeLessThanOrEqual(north);
  });

  it("counts the shapes it drew against the shapes the file yielded, in one unit", () => {
    // A GeometryCollection becomes one drawn shape per member, so the counts
    // cannot be counts of source Features and stay coherent: `showing 2 of 3`
    // here is true of shapes and false of features, which is exactly why the
    // sentence rendered from these numbers says "shapes".
    const result = importContextLayer({
      filename: "mixed.geojson",
      bytes: geojsonBytes({
        type: "Feature",
        properties: {},
        geometry: {
          type: "GeometryCollection",
          geometries: [
            { type: "Point", coordinates: [-80, 25] },
            { type: "Point", coordinates: [-80.1, 25.1] },
            { type: "Point", coordinates: [-80.2, 25.2] },
          ],
        },
      }),
      featureCap: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.featureCount).toBe(2);
    expect(result.sourceFeatureCount).toBe(3);

    const notes = describeContextLayerCoverage(
      "Study limits",
      contextLayerDisclosure({
        feature_count: result.featureCount,
        source_feature_count: result.sourceFeatureCount,
        dropped_feature_count: result.droppedFeatureCount,
        truncated: result.truncated,
      })
    );
    expect(notes[0]).toContain("showing 2 of 3 shapes");
    expect(notes[0]).not.toContain("features");
  });

  it("treats a missing or malformed cap as unlimited, never as zero", () => {
    // The run-cap rule, restated: a typo in an operator env var must not lock
    // every planner in the deployment out of uploading anything.
    const env = (values: Record<string, string>) => values as NodeJS.ProcessEnv;

    expect(resolveContextLayerFeatureCap(env({}))).toBeNull();
    expect(resolveContextLayerFeatureCap(env({ OPENPLAN_ENGAGEMENT_LAYER_FEATURE_CAP: "0" }))).toBeNull();
    expect(resolveContextLayerFeatureCap(env({ OPENPLAN_ENGAGEMENT_LAYER_FEATURE_CAP: "lots" }))).toBeNull();
    expect(resolveContextLayerFeatureCap(env({ OPENPLAN_ENGAGEMENT_LAYER_FEATURE_CAP: "-5" }))).toBeNull();
    expect(resolveContextLayerFeatureCap(env({ OPENPLAN_ENGAGEMENT_LAYER_FEATURE_CAP: "2500" }))).toBe(2500);
    expect(resolveContextLayerByteCap(env({ OPENPLAN_ENGAGEMENT_LAYER_MAX_BYTES: "4194304" }))).toBe(4_194_304);
    expect(resolveContextLayerByteCap(env({}))).toBeNull();
  });
});

// ── KML / KMZ ────────────────────────────────────────────────────────────────

const SAMPLE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>Trailhead &amp; kiosk</name><Point><coordinates>-121.05,39.22,0</coordinates></Point></Placemark>
  <Placemark><name>Proposed path</name><LineString><coordinates>
    -121.05,39.22,0 -121.06,39.23,0 -121.07,39.24,0
  </coordinates></LineString></Placemark>
  <Placemark><name>Study area</name><Polygon>
    <outerBoundaryIs><LinearRing><coordinates>-121.1,39.2 -121.0,39.2 -121.0,39.3 -121.1,39.3</coordinates></LinearRing></outerBoundaryIs>
  </Polygon></Placemark>
</Document></kml>`;

describe("reading a KML layer", () => {
  it("reads points, lines, areas and their names", () => {
    const result = importContextLayer({
      filename: "outreach.kml",
      bytes: encoder.encode(SAMPLE_KML),
      featureCap: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.srs.basis).toBe("kml_specification");
    expect(result.featureCount).toBe(3);
    expect(result.geometryKinds.sort()).toEqual(["LineString", "Point", "Polygon"]);
    // The entity is decoded, not passed through as markup.
    expect(result.featureCollection.features[0].properties?.name).toBe("Trailhead & kiosk");
    // The ring the file left open is closed, as GeoJSON requires.
    const polygon = result.featureCollection.features[2].geometry as GeoJSON.Polygon;
    expect(polygon.coordinates[0]).toHaveLength(5);
    expect(polygon.coordinates[0][0]).toEqual(polygon.coordinates[0][4]);
  });

  it("refuses KML carrying a document type or entity declaration", () => {
    const hostile = `<!DOCTYPE kml [<!ENTITY x "boom">]>\n${SAMPLE_KML}`;
    const result = importContextLayer({
      filename: "hostile.kml",
      bytes: encoder.encode(hostile),
      featureCap: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unreadable");
    expect(result.message).toContain("entity");
  });

  it("reads a KMZ by finding the .kml inside it", () => {
    const kmz = buildZip([{ name: "doc.kml", data: encoder.encode(SAMPLE_KML), deflate: true }]);
    const result = importContextLayer({ filename: "outreach.kmz", bytes: kmz, featureCap: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe("kmz");
    expect(result.featureCount).toBe(3);
  });
});

// ── Shapefile ────────────────────────────────────────────────────────────────

describe("reading a zipped shapefile", () => {
  it("reads the coordinate system from the .prj and the geometry from the .shp", () => {
    const shp = buildShp([{ type: "polyline", parts: [[[-121.0, 39.0], [-121.1, 39.1]]] }]);
    const zip = buildZip([
      { name: "corridor.shp", data: shp, deflate: true },
      { name: "corridor.prj", data: encoder.encode(WGS84_PRJ) },
      { name: "corridor.dbf", data: new Uint8Array(8) },
    ]);

    const result = importContextLayer({ filename: "corridor.zip", bytes: zip, featureCap: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe("shapefile_zip");
    expect(result.srs.basis).toBe("prj_file");
    expect(result.srs.name).toBe("GCS_WGS_1984");
    expect(result.geometryKinds).toEqual(["LineString"]);
    expect(result.featureCollection.features[0].geometry).toEqual({
      type: "LineString",
      coordinates: [[-121, 39], [-121.1, 39.1]],
    });
    expect(describeContextLayerSrs(result.srs)).toContain(".prj");
  });

  it("turns shapefile ring winding into the right-hand rule, holes and all", () => {
    // A shapefile polygon record is a flat list of rings with no nesting; which
    // one is a hole is knowable ONLY from its orientation. Getting this wrong
    // fills in the courtyard.
    const outerClockwise = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
    const innerCounterClockwise = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]];
    const combined = buildShpPolygonWithHole(outerClockwise, innerCounterClockwise);

    const zip = buildZip([
      { name: "blocks.shp", data: combined },
      { name: "blocks.prj", data: encoder.encode(WGS84_PRJ) },
    ]);
    const result = importContextLayer({ filename: "blocks.zip", bytes: zip, featureCap: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const polygon = result.featureCollection.features[0].geometry as GeoJSON.Polygon;
    expect(polygon.type).toBe("Polygon");
    expect(polygon.coordinates).toHaveLength(2);
    // Exterior reversed to counter-clockwise, per RFC 7946.
    expect(polygon.coordinates[0]).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
    expect(polygon.coordinates[1][0]).toEqual([0.2, 0.2]);
  });

  it("refuses a projected shapefile by name instead of placing it wrongly", () => {
    const zip = buildZip([
      { name: "corridor.shp", data: buildShp([{ type: "point", position: [500000, 4000000] }]) },
      { name: "corridor.prj", data: encoder.encode(PROJECTED_PRJ) },
    ]);

    const result = importContextLayer({ filename: "corridor.zip", bytes: zip, featureCap: null });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("srs_unsupported");
    expect(result.message).toContain("NAD83 / UTM zone 10N");
    expect(result.message).toContain("EPSG:26910");
    // The refusal has to be actionable, or the planner is simply stuck.
    expect(result.message).toContain("WGS 84");
  });

  it("refuses a shapefile with no .prj rather than assuming one", () => {
    const zip = buildZip([
      { name: "corridor.shp", data: buildShp([{ type: "point", position: [-121, 39] }]) },
      { name: "corridor.dbf", data: new Uint8Array(8) },
    ]);

    const result = importContextLayer({ filename: "corridor.zip", bytes: zip, featureCap: null });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("srs_undetermined");
    expect(result.message).toContain("will not guess");
  });

  it("refuses to read a MultiPatch as a point at the corner of its own bounding box", () => {
    // THE DEFECT THIS PINS. Shape type 31 is MultiPatch, and 31 % 10 is 1, so a
    // reader that derives the base type by modulo calls it a Point and reads the
    // first eight bytes after the type — which for a MultiPatch are the bounding
    // box's Xmin/Ymin — as a coordinate. The output is not a missing feature but
    // a WRONG one: a building surface collapsed to a plausible-looking dot, on a
    // map a resident is asked to comment on. A stated omission is the only
    // honest answer available here.
    const bbox: [number, number, number, number] = [-118.5, 34.0, -118.4, 34.1];
    const zip = buildZip([
      {
        name: "buildings.shp",
        data: buildShp([
          { type: "point", position: [-118.45, 34.05] },
          { type: "multipatch", bbox },
        ]),
      },
      { name: "buildings.prj", data: encoder.encode(WGS84_PRJ) },
    ]);

    const result = importContextLayer({ filename: "buildings.zip", bytes: zip, featureCap: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.featureCount).toBe(1);
    // The corner of the box is exactly what the broken reading produced.
    for (const feature of result.featureCollection.features) {
      expect(feature.geometry).not.toEqual({ type: "Point", coordinates: [bbox[0], bbox[1]] });
    }

    // Skipped is not enough on its own — it has to be SAID, or the layer ends
    // where the MultiPatch records began and nothing on screen contradicts that.
    expect(result.sourceFeatureCount).toBe(2);
    expect(result.droppedFeatureCount).toBe(1);
    const notes = describeContextLayerCoverage(
      "Buildings",
      contextLayerDisclosure({
        feature_count: result.featureCount,
        source_feature_count: result.sourceFeatureCount,
        dropped_feature_count: result.droppedFeatureCount,
        truncated: result.truncated,
      })
    );
    expect(notes.some((note) => /1 shape in the uploaded file could not be drawn/.test(note))).toBe(true);
  });

  it("names MultiPatch when that is the whole file, rather than calling it empty", () => {
    const zip = buildZip([
      {
        name: "buildings.shp",
        data: buildShp([{ type: "multipatch", bbox: [-118.5, 34.0, -118.4, 34.1] }]),
      },
      { name: "buildings.prj", data: encoder.encode(WGS84_PRJ) },
    ]);

    const result = importContextLayer({ filename: "buildings.zip", bytes: zip, featureCap: null });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_drawable_features");
    // An operator whose entire export is 3D surfaces has to learn WHICH thing
    // OpenPlan will not draw; "nothing readable here" leaves them to conclude
    // their file is broken.
    expect(result.message).toContain("MultiPatch");
    expect(result.message).toContain("Re-export");
  });

  it("ignores the shadow files macOS puts in a zip", () => {
    const zip = buildZip([
      { name: "__MACOSX/._corridor.shp", data: encoder.encode("not a shapefile") },
      { name: "corridor.shp", data: buildShp([{ type: "point", position: [-121, 39] }]) },
      { name: "corridor.prj", data: encoder.encode(WGS84_PRJ) },
    ]);

    const result = importContextLayer({ filename: "corridor.zip", bytes: zip, featureCap: null });
    expect(result.ok).toBe(true);
  });
});

describe("reading a .prj", () => {
  it("accepts a geographic system and records what it actually said", () => {
    const nad83 =
      'GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101]],' +
      'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4269"]]';
    const result = readPrj(nad83);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Recorded, not silently relabelled as WGS 84: the datum is a fact about
    // the file, and rewriting it would make the row say something the .prj did
    // not.
    expect(result.srs).toEqual({ authority: "EPSG", code: "4269", name: "NAD83", basis: "prj_file" });

    // And the operator is told the coordinates were used as they came. A
    // survey-grade reader must not be able to infer a datum transformation that
    // did not happen; a portal-map reader loses nothing by being told.
    expect(describeContextLayerSrs(result.srs)).toContain("no datum transformation");
  });

  it("says nothing about datums when the file already is WGS 84", () => {
    const result = readPrj(WGS84_PRJ);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // ESRI writes no AUTHORITY at all here, so the name is the only evidence —
    // and a needless caveat on every ordinary shapefile would train operators
    // to skip the sentence that matters.
    expect(result.srs.authority).toBeNull();
    expect(describeContextLayerSrs(result.srs)).not.toContain("no datum transformation");
  });

  it("refuses an empty .prj and a .prj it cannot classify", () => {
    expect(readPrj("   ").ok).toBe(false);
    expect(readPrj("this is not WKT").ok).toBe(false);
  });
});

// ── Container and format refusals ────────────────────────────────────────────

describe("refusing what it cannot read", () => {
  it("names the formats it does read", () => {
    const result = importContextLayer({
      filename: "notes.txt",
      bytes: encoder.encode("the alignment goes down main street"),
      featureCap: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unsupported_format");
    expect(result.message).toContain("GeoJSON");
    expect(result.message).toContain("shapefile");
  });

  it("refuses an empty upload", () => {
    const result = importContextLayer({ filename: "empty.geojson", bytes: new Uint8Array(0), featureCap: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("empty");
  });

  it("does not trust the extension over the bytes", () => {
    // A zip renamed .geojson must not reach JSON.parse; it is classified by what
    // is inside it, which here is a shapefile.
    const zip = buildZip([
      { name: "corridor.shp", data: buildShp([{ type: "point", position: [-121, 39] }]) },
      { name: "corridor.prj", data: encoder.encode(WGS84_PRJ) },
    ]);
    const result = importContextLayer({ filename: "corridor.geojson", bytes: zip, featureCap: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe("shapefile_zip");
  });
});
