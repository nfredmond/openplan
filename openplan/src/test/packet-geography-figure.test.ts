/**
 * The packet geography figure: what it draws, what it refuses to draw, and
 * whether the scale bar is TRUE.
 *
 * The scale assertions here do not reuse the module's own arithmetic. They
 * measure the drawn shape out of the emitted SVG path data, convert with an
 * independent haversine, and compare that against the bar's printed label. A
 * test that recomputed the scale the same way the code does would agree with a
 * wrong answer, and an incorrect scale bar on a board document is the one
 * defect in this figure a reader cannot catch.
 */

import { describe, expect, it } from "vitest";

import {
  DRAWN_PLACE_SOURCE,
  type PlaceOfRecord,
} from "@/lib/geographies/place-of-record";
import {
  buildPacketGeographyFigure,
  type PacketGeographyInput,
} from "@/lib/reports/geography-figure";

const EARTH_RADIUS_M = 6371008.8;

/** Great-circle distance, deliberately unrelated to the module's own series. */
function haversineMetres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Ground metres a printed bar label claims, e.g. "2 km (1.2 mi)" -> 2000. */
function metresFromLabel(label: string): number {
  const match = /^([\d.]+)\s(km|m)\b/.exec(label);
  if (!match) throw new Error(`Unparseable scale label: ${label}`);
  const value = Number.parseFloat(match[1]);
  return match[2] === "km" ? value * 1000 : value;
}

function pathExtent(d: string): { minX: number; maxX: number; minY: number; maxY: number } {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g) ?? [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    xs.push(Number.parseFloat(numbers[index]));
    ys.push(Number.parseFloat(numbers[index + 1]));
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function drawnPlace(coordinates: number[][], label: string | null = null): PlaceOfRecord {
  const lons = coordinates.map((position) => position[0]);
  const lats = coordinates.map((position) => position[1]);
  return {
    source: DRAWN_PLACE_SOURCE,
    kind: null,
    ref: null,
    label,
    countryCode: null,
    subdivisionCode: null,
    bbox: {
      minLon: Math.min(...lons),
      minLat: Math.min(...lats),
      maxLon: Math.max(...lons),
      maxLat: Math.max(...lats),
    },
    geometry: { type: "Polygon", coordinates: [coordinates] },
  };
}

function resolvedPlace(coordinates: number[][], label: string): PlaceOfRecord {
  return {
    ...drawnPlace(coordinates, label),
    source: "tigerweb",
    kind: "county",
    ref: "06057",
    countryCode: "US",
    subdivisionCode: "CA",
  };
}

function input(overrides: Partial<PacketGeographyInput> = {}): PacketGeographyInput {
  return {
    studyArea: null,
    studyAreaReadState: "ok",
    corridors: [],
    corridorReadState: "ok",
    corridorLimitReached: false,
    marker: null,
    workspaceFallbackLabel: null,
    ...overrides,
  };
}

/** A rectangle around central Grass Valley — the shape the live check used. */
const GRASS_VALLEY_RING = [
  [-121.085, 39.195],
  [-121.025, 39.195],
  [-121.025, 39.245],
  [-121.085, 39.245],
  [-121.085, 39.195],
];

describe("packet geography figure — the scale bar is true", () => {
  it("labels a bar whose length matches the ground distance measured off the drawing", () => {
    const figure = buildPacketGeographyFigure(
      input({ studyArea: drawnPlace(GRASS_VALLEY_RING, "Central Grass Valley") })
    );

    expect(figure.hasDrawing).toBe(true);
    expect(figure.scaleBar).not.toBeNull();

    const area = figure.shapes.find((shape) => shape.kind === "area");
    expect(area?.d).toBeTruthy();
    const extent = pathExtent(area!.d!);

    // North-south: the rectangle's own height in figure units is a known ground
    // distance, so the bar's units convert straight to metres.
    const verticalUnits = extent.maxY - extent.minY;
    const verticalGroundMetres = haversineMetres(
      { lat: 39.195, lon: -121.055 },
      { lat: 39.245, lon: -121.055 }
    );
    const barMetresNorthSouth =
      (figure.scaleBar!.lengthUnits / verticalUnits) * verticalGroundMetres;

    // East-west: the same bar, measured against the rectangle's width.
    const horizontalUnits = extent.maxX - extent.minX;
    const horizontalGroundMetres = haversineMetres(
      { lat: 39.22, lon: -121.085 },
      { lat: 39.22, lon: -121.025 }
    );
    const barMetresEastWest =
      (figure.scaleBar!.lengthUnits / horizontalUnits) * horizontalGroundMetres;

    const claimed = metresFromLabel(figure.scaleBar!.label);
    expect(claimed).toBeGreaterThan(0);
    expect(Math.abs(barMetresNorthSouth - claimed) / claimed).toBeLessThan(0.01);
    expect(Math.abs(barMetresEastWest - claimed) / claimed).toBeLessThan(0.01);
  });

  it("keeps the drawing's proportions honest against real ground distances", () => {
    const figure = buildPacketGeographyFigure(
      input({ studyArea: drawnPlace(GRASS_VALLEY_RING) })
    );
    const area = figure.shapes.find((shape) => shape.kind === "area");
    const extent = pathExtent(area!.d!);

    const drawnRatio = (extent.maxX - extent.minX) / (extent.maxY - extent.minY);
    const groundRatio =
      haversineMetres({ lat: 39.22, lon: -121.085 }, { lat: 39.22, lon: -121.025 }) /
      haversineMetres({ lat: 39.195, lon: -121.055 }, { lat: 39.245, lon: -121.055 });

    expect(Math.abs(drawnRatio - groundRatio) / groundRatio).toBeLessThan(0.02);
  });

  it("withholds the bar entirely when a flat scale would be wrong, and says why", () => {
    // California end to end: 9.5 degrees of latitude. A single flat scale is
    // several percent out at the ends, so no bar may be printed.
    const figure = buildPacketGeographyFigure(
      input({
        studyArea: drawnPlace([
          [-124.4, 32.5],
          [-114.1, 32.5],
          [-114.1, 42.0],
          [-124.4, 42.0],
          [-124.4, 32.5],
        ]),
      })
    );

    expect(figure.hasDrawing).toBe(true);
    expect(figure.scaleBar).toBeNull();
    expect(figure.scaleStatement).toMatch(/No scale bar is shown/);
    expect(figure.scaleStatement).toMatch(/wrong by about/);
  });

  it("shows no scale for a project whose only geography is one point", () => {
    const figure = buildPacketGeographyFigure(
      input({ marker: { latitude: 39.2191, longitude: -121.0611 } })
    );

    expect(figure.hasDrawing).toBe(true);
    expect(figure.scaleBar).toBeNull();
    expect(figure.scaleStatement).toMatch(/single point/);
  });
});

describe("packet geography figure — orientation", () => {
  it("puts north at the top: a more northerly point gets a smaller y", () => {
    const figure = buildPacketGeographyFigure(
      input({
        studyArea: drawnPlace(GRASS_VALLEY_RING),
        corridors: [
          {
            id: "c1",
            name: "North-south spine",
            corridorType: "arterial",
            // First position is the SOUTHERN end.
            geometry: {
              type: "LineString",
              coordinates: [
                [-121.055, 39.2],
                [-121.055, 39.24],
              ],
            },
          },
        ],
      })
    );

    const corridor = figure.shapes.find((shape) => shape.kind === "corridor");
    const numbers = (corridor!.d!.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number.parseFloat);
    const southY = numbers[1];
    const northY = numbers[3];
    expect(northY).toBeLessThan(southY);
    expect(figure.orientationStatement).toMatch(/North is up/);
  });
});

describe("packet geography figure — it draws only what the project has", () => {
  it("draws the study area, every corridor and the marker when all three exist", () => {
    const figure = buildPacketGeographyFigure(
      input({
        studyArea: drawnPlace(GRASS_VALLEY_RING, "Central Grass Valley"),
        corridors: [
          {
            id: "c1",
            name: "SR-49",
            corridorType: "highway",
            geometry: {
              type: "LineString",
              coordinates: [
                [-121.04, 39.2],
                [-121.04, 39.24],
              ],
            },
          },
          {
            id: "c2",
            name: "Empire Street",
            corridorType: "arterial",
            geometry: {
              type: "LineString",
              coordinates: [
                [-121.08, 39.218],
                [-121.03, 39.212],
              ],
            },
          },
        ],
        marker: { latitude: 39.2191, longitude: -121.0611 },
      })
    );

    expect(figure.shapes.filter((shape) => shape.kind === "area")).toHaveLength(1);
    expect(figure.shapes.filter((shape) => shape.kind === "corridor")).toHaveLength(2);
    expect(figure.shapes.filter((shape) => shape.kind === "marker")).toHaveLength(1);
    expect(figure.legend.map((entry) => entry.label)).toEqual([
      "Central Grass Valley (drawn by hand)",
      "1 — SR-49",
      "2 — Empire Street",
      "Project point",
    ]);
  });

  it("draws nothing it does not have", () => {
    const figure = buildPacketGeographyFigure(
      input({ studyArea: drawnPlace(GRASS_VALLEY_RING) })
    );

    expect(figure.shapes.filter((shape) => shape.kind === "corridor")).toHaveLength(0);
    expect(figure.shapes.filter((shape) => shape.kind === "marker")).toHaveLength(0);
    expect(figure.legend.some((entry) => entry.kind === "marker")).toBe(false);
  });

  it("says so plainly when there is nothing at all, instead of printing an empty box", () => {
    const figure = buildPacketGeographyFigure(input());

    expect(figure.hasDrawing).toBe(false);
    expect(figure.shapes).toHaveLength(0);
    expect(figure.emptyStatement).toMatch(/no study area, no corridors and no map point/);
    expect(figure.emptyNextStep).toMatch(/Set the study area on the project record/);
  });

  it("names the workspace fallback when the project itself has no area", () => {
    const figure = buildPacketGeographyFigure(
      input({ workspaceFallbackLabel: "Nevada County" })
    );

    expect(figure.emptyStatement).toContain("Nevada County");
  });

  it("skips a corridor row whose geometry is unreadable, and discloses the skip", () => {
    const figure = buildPacketGeographyFigure(
      input({
        studyArea: drawnPlace(GRASS_VALLEY_RING),
        corridors: [
          { id: "c1", name: "Broken line", corridorType: "arterial", geometry: { type: "Blob" } },
        ],
      })
    );

    expect(figure.shapes.filter((shape) => shape.kind === "corridor")).toHaveLength(0);
    expect(figure.caveats.join(" ")).toMatch(/holds no readable line/);
  });
});

describe("packet geography figure — a failed read is not an empty one", () => {
  it("says the study area could not be read rather than that there is none", () => {
    const figure = buildPacketGeographyFigure(
      input({ studyArea: null, studyAreaReadState: "unreadable" })
    );

    expect(figure.caveats.join(" ")).toMatch(/could not be read at generation time/);
    expect(figure.caveats.join(" ")).toMatch(/not the same as there being none/);
    expect(figure.emptyStatement).toMatch(/cannot say whether/);
    expect(figure.emptyStatement).not.toMatch(/there is nothing there yet/);
  });

  it("names a pending migration as the reason when that is the reason", () => {
    const figure = buildPacketGeographyFigure(
      input({ corridorReadState: "schema_pending" })
    );

    expect(figure.caveats.join(" ")).toMatch(/missing the columns that hold it/);
  });
});

describe("packet geography figure — the caveat travels with the drawing", () => {
  it("always leads with what the drawing is, before anything else", () => {
    const figure = buildPacketGeographyFigure(
      input({ studyArea: drawnPlace(GRASS_VALLEY_RING) })
    );

    expect(figure.caveats[0]).toMatch(/no basemap behind it/);
    expect(figure.caveats[0]).toMatch(/not a survey/);
  });

  it("refuses to let a hand-drawn area imply a jurisdiction", () => {
    const figure = buildPacketGeographyFigure(
      input({ studyArea: drawnPlace(GRASS_VALLEY_RING, "Central Grass Valley") })
    );

    expect(figure.caveats.join(" ")).toMatch(/drawn by hand, so it has an extent but no place identity/);
    expect(figure.caveats.join(" ")).toMatch(
      /is the name the drawn shape was given on the project record, not a place this packet resolved/
    );
  });

  it("does not attach the no-identity caveat to a place that actually resolves", () => {
    const figure = buildPacketGeographyFigure(
      input({ studyArea: resolvedPlace(GRASS_VALLEY_RING, "Nevada County") })
    );

    expect(figure.caveats.join(" ")).not.toMatch(/no place identity/);
    expect(figure.legend[0].label).toBe("Nevada County");
    expect(figure.legend[0].detail).toMatch(/area of record/);
  });

  it("draws a bbox-only area as a dashed box and refuses to call it a boundary", () => {
    const figure = buildPacketGeographyFigure(
      input({
        studyArea: {
          source: "tigerweb",
          kind: "county",
          ref: "06057",
          label: "Nevada County",
          countryCode: "US",
          subdivisionCode: "CA",
          bbox: { minLon: -121.28, minLat: 39.0, maxLon: -120.0, maxLat: 39.53 },
          geometry: null,
        },
      })
    );

    expect(figure.shapes.filter((shape) => shape.kind === "extent-box")).toHaveLength(1);
    expect(figure.shapes.some((shape) => shape.kind === "area")).toBe(false);
    expect(figure.caveats.join(" ")).toMatch(/the rectangle is not the boundary/);
  });
});

describe("packet geography figure — coordinate edge cases", () => {
  it("keeps a shape crossing the date line contiguous instead of spanning the globe", () => {
    const figure = buildPacketGeographyFigure(
      input({
        studyArea: drawnPlace([
          [179.6, -16.9],
          [-179.7, -16.9],
          [-179.7, -16.5],
          [179.6, -16.5],
          [179.6, -16.9],
        ]),
      })
    );

    const area = figure.shapes.find((shape) => shape.kind === "area");
    const extent = pathExtent(area!.d!);
    // 0.7 degrees of longitude against 0.4 of latitude: a shape that wrapped the
    // wrong way would be hundreds of times wider than it is tall.
    const ratio = (extent.maxX - extent.minX) / (extent.maxY - extent.minY);
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(3);
  });

  it("thins a dense outline instead of writing every position into the PDF", () => {
    const dense: number[][] = [];
    for (let index = 0; index <= 40000; index += 1) {
      const t = index / 40000;
      dense.push([-121.085 + 0.06 * t, 39.195 + 0.05 * Math.sin(t * Math.PI)]);
    }
    dense.push([-121.085, 39.195]);

    const figure = buildPacketGeographyFigure(input({ studyArea: drawnPlace(dense) }));
    const area = figure.shapes.find((shape) => shape.kind === "area");
    const vertexCount = (area!.d!.match(/[ML]/g) ?? []).length;

    expect(vertexCount).toBeGreaterThan(50);
    expect(vertexCount).toBeLessThan(6100);
  });

  it("ignores a marker outside the globe rather than drawing it somewhere wrong", () => {
    const figure = buildPacketGeographyFigure(
      input({
        studyArea: drawnPlace(GRASS_VALLEY_RING),
        marker: { latitude: 999, longitude: -121.06 },
      })
    );

    expect(figure.shapes.some((shape) => shape.kind === "marker")).toBe(false);
  });
});
