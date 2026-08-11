/**
 * Corridor Analysis accepts real GIS formats through the ONE shared spatial
 * import core.
 *
 * Until 2026-08-10 this card accepted only `.geojson` and parsed it with its
 * own ad-hoc reader, while the engagement module carried a full
 * GeoJSON/KML/KMZ/shapefile importer next door — the exact seam CLAUDE.md
 * warns about: a shared capability living inside one of its two callers gets
 * reimplemented wrongly by the other. Both callers now read through
 * `src/lib/geo/spatial-file-import.ts`, so a format bug can exist in exactly
 * one place. These tests hold the corridor side of that seam:
 *
 *   - every format the core reads arrives as a corridor boundary, through the
 *     same `readCorridorBoundaryFile` the component's change handler runs;
 *   - the refusals are the CORE's refusals, verbatim — the shared vocabulary,
 *     not a corridor-local rewrite that could drift;
 *   - a multi-area file becomes one combined MultiPolygon and the combination
 *     is DISCLOSED, never a silent first-feature pick (what this card used to
 *     do); shapes that cannot form a boundary are disclosed too.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CorridorUpload, readCorridorBoundaryFile } from "@/components/corridor/CorridorUpload";
import {
  PROJECTED_PRJ,
  WGS84_PRJ,
  buildProjectedShapefileZip,
  buildShp,
  buildZip,
} from "./fixtures/context-layer-uploads";

const encoder = new TextEncoder();

function geojsonBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

const SQUARE = [
  [-121.1, 39.2],
  [-121.0, 39.2],
  [-121.0, 39.3],
  [-121.1, 39.3],
  [-121.1, 39.2],
];

function polygonFeature(offsetLng: number): unknown {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [SQUARE.map(([lng, lat]) => [lng + offsetLng, lat])],
    },
  };
}

const POLYGON_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>Study area</name><Polygon>
    <outerBoundaryIs><LinearRing><coordinates>-121.1,39.2 -121.0,39.2 -121.0,39.3 -121.1,39.3 -121.1,39.2</coordinates></LinearRing></outerBoundaryIs>
  </Polygon></Placemark>
</Document></kml>`;

// ── The reader the change handler runs ───────────────────────────────────────

describe("reading a corridor boundary from each format", () => {
  it("keeps the plain single-polygon GeoJSON path working as before", async () => {
    const read = await readCorridorBoundaryFile(
      "corridor.geojson",
      geojsonBytes({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [SQUARE] } })
    );

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.geometry).toEqual({ type: "Polygon", coordinates: [SQUARE] });
    // One area, nothing skipped: the planner is owed no caveat.
    expect(read.notices).toEqual([]);
  });

  it("reads a KML polygon into a boundary", async () => {
    const read = await readCorridorBoundaryFile("corridor.kml", encoder.encode(POLYGON_KML));

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.geometry.type).toBe("Polygon");
    // The core closed the ring the file left open — or kept the closed one.
    const ring = (read.geometry as GeoJSON.Polygon).coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("reads a KMZ by inflating the archive in the browser path", async () => {
    // deflate: true is the point — this exercises the DecompressionStream
    // inflate, the one step that differs from the engagement (node) path.
    const kmz = buildZip([{ name: "doc.kml", data: encoder.encode(POLYGON_KML), deflate: true }]);
    const read = await readCorridorBoundaryFile("corridor.kmz", kmz);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.geometry.type).toBe("Polygon");
  });

  it("reads a zipped shapefile polygon into a boundary", async () => {
    const shp = buildShp([{ type: "polygon", rings: [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]] }]);
    const zip = buildZip([
      { name: "corridor.shp", data: shp, deflate: true },
      { name: "corridor.prj", data: encoder.encode(WGS84_PRJ), deflate: true },
    ]);
    const read = await readCorridorBoundaryFile("corridor.zip", zip);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.geometry.type).toBe("Polygon");
    // Shapefile winding (outer clockwise) reversed to the GeoJSON right-hand
    // rule by the shared core — the corridor gets the same geometry engagement
    // does, because it is the same code.
    expect((read.geometry as GeoJSON.Polygon).coordinates[0]).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ]);
  });

  it("refuses a projected shapefile with the core's own message, not a local rewrite", async () => {
    const read = await readCorridorBoundaryFile("corridor.zip", buildProjectedShapefileZip());

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.message).toContain("does not reproject");
    expect(read.message).toContain("WGS 84");
    // The message names the actual system, which only the shared .prj reader
    // knows how to extract.
    expect(read.message).toContain(PROJECTED_PRJ.includes("26910") ? "EPSG:26910" : "EPSG");
  });

  it("refuses an unreadable format with the shared vocabulary naming every format it does read", async () => {
    const read = await readCorridorBoundaryFile("notes.txt", encoder.encode("the corridor goes down main street"));

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.message).toContain("GeoJSON");
    expect(read.message).toContain("KML");
    expect(read.message).toContain("shapefile");
  });

  it("refuses a file with no area shapes, saying why a boundary needs an area", async () => {
    const read = await readCorridorBoundaryFile(
      "stops.geojson",
      geojsonBytes({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-121.05, 39.25] } },
          {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: [[-121.05, 39.25], [-121.06, 39.26]] },
          },
        ],
      })
    );

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.message).toContain("no area");
    expect(read.message).toContain("polygon");
  });
});

// ── The multi-feature decision, and its disclosure ───────────────────────────

describe("a file carrying more than one area", () => {
  it("combines every area into one MultiPolygon and says so", async () => {
    const read = await readCorridorBoundaryFile(
      "segments.geojson",
      geojsonBytes({
        type: "FeatureCollection",
        features: [polygonFeature(0), polygonFeature(0.5), polygonFeature(1)],
      })
    );

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // Not the first feature, and not a refusal: all three areas, as one
    // boundary. Three DISTINCT squares prove the parts were threaded through
    // rather than one of them repeated.
    expect(read.geometry.type).toBe("MultiPolygon");
    const parts = (read.geometry as GeoJSON.MultiPolygon).coordinates;
    expect(parts).toHaveLength(3);
    expect(parts[0][0][0][0]).toBe(-121.1);
    expect(parts[1][0][0][0]).toBe(-120.6);
    expect(parts[2][0][0][0]).toBe(-120.1);
    expect(read.notices.some((notice) => notice.includes("3 separate areas"))).toBe(true);
    expect(read.notices.some((notice) => notice.includes("one study boundary"))).toBe(true);
  });

  it("uses the areas and discloses the shapes that cannot form a boundary", async () => {
    const read = await readCorridorBoundaryFile(
      "mixed.geojson",
      geojsonBytes({
        type: "FeatureCollection",
        features: [
          polygonFeature(0),
          { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-121.05, 39.25] } },
          {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: [[-121.05, 39.25], [-121.06, 39.26]] },
          },
        ],
      })
    );

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.geometry.type).toBe("Polygon");
    expect(read.notices.some((notice) => notice.includes("2 shapes") && notice.includes("points or lines"))).toBe(
      true
    );
  });
});

// ── The component is wired to the reader ─────────────────────────────────────

async function uploadFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
}

describe("the upload card runs the shared reader", () => {
  it("emits the parsed boundary from a KML file and reports it loaded", async () => {
    const onUpload = vi.fn();
    const { container } = render(<CorridorUpload onUpload={onUpload} />);

    await uploadFile(container, new File([encoder.encode(POLYGON_KML) as unknown as BlobPart], "corridor.kml"));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    const geometry = onUpload.mock.calls[0][0] as GeoJSON.Geometry;
    expect(geometry.type).toBe("Polygon");
    expect(screen.getByText("Boundary loaded")).toBeInTheDocument();
    expect(screen.getByText("corridor.kml")).toBeInTheDocument();
  });

  it("shows the combination disclosure when the file carried several areas", async () => {
    const onUpload = vi.fn();
    const { container } = render(<CorridorUpload onUpload={onUpload} />);

    const bytes = geojsonBytes({
      type: "FeatureCollection",
      features: [polygonFeature(0), polygonFeature(0.5)],
    });
    await uploadFile(container, new File([bytes as unknown as BlobPart], "segments.geojson"));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect((onUpload.mock.calls[0][0] as GeoJSON.Geometry).type).toBe("MultiPolygon");
    expect(screen.getByText(/2 separate areas/)).toBeInTheDocument();
    expect(screen.getByText(/one study boundary/)).toBeInTheDocument();
  });

  it("surfaces the shared refusal copy instead of uploading", async () => {
    const onUpload = vi.fn();
    const { container } = render(<CorridorUpload onUpload={onUpload} />);

    await uploadFile(
      container,
      new File([encoder.encode("not a spatial file") as unknown as BlobPart], "notes.txt")
    );

    await waitFor(() => expect(screen.getByText(/matched none of those/)).toBeInTheDocument());
    expect(onUpload).not.toHaveBeenCalled();
  });
});
