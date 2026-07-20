import { describe, expect, it } from "vitest";

import {
  REPRESENTATIVENESS_SCREENING_CAVEAT,
  assignRespondentsToTracts,
  bboxOfPoints,
  bboxToPolygon,
  bufferBbox,
  buildRepresentativeness,
  pointInPolygon,
} from "@/lib/engagement/representativeness";
import type { CensusTractData } from "@/lib/data-sources/census";

function tract(geoid: string, overrides: Partial<CensusTractData>): CensusTractData {
  return {
    geoid,
    state: "06",
    county: "057",
    tract: geoid,
    population: 1000,
    medianIncome: 60000,
    totalCommuters: 500,
    transitCommuters: 0,
    walkCommuters: 0,
    bikeCommuters: 0,
    wfhCommuters: 0,
    zeroVehicleHouseholds: 0,
    totalHouseholds: 400,
    pctMinority: 0,
    pctBelowPoverty: 0,
    ...overrides,
  };
}

// Three equal-population tracts: A low-everything, B high, C mid.
const TRACTS: CensusTractData[] = [
  tract("A", { pctMinority: 20, pctBelowPoverty: 10, zeroVehicleHouseholds: 20, transitCommuters: 10 }),
  tract("B", { pctMinority: 60, pctBelowPoverty: 30, zeroVehicleHouseholds: 80, transitCommuters: 50 }),
  tract("C", { pctMinority: 40, pctBelowPoverty: 20, zeroVehicleHouseholds: 40, transitCommuters: 30 }),
];

describe("buildRepresentativeness", () => {
  it("flags under-representation when respondents skew to the low-minority tract", () => {
    const result = buildRepresentativeness(TRACTS, new Map([["A", 8], ["B", 1], ["C", 1]]));
    expect(result.respondentCount).toBe(10);
    expect(result.tractCount).toBe(3);

    const minority = result.metrics.find((m) => m.key === "minority")!;
    expect(minority.baselinePct).toBe(40); // (20+60+40)/3
    expect(minority.respondentPct).toBe(26); // (20*8+60+40)/10
    expect(minority.representationRatio).toBe(0.65);
    expect(minority.status).toBe("under");

    // every metric is depressed because respondents came from the low tract
    expect(result.underRepresented.sort()).toEqual(["belowPoverty", "minority", "transit", "zeroVehicle"]);
    expect(result.caveat).toBe(REPRESENTATIVENESS_SCREENING_CAVEAT);
  });

  it("reports balanced when respondents mirror the population distribution", () => {
    const result = buildRepresentativeness(TRACTS, new Map([["A", 1], ["B", 1], ["C", 1]]));
    const minority = result.metrics.find((m) => m.key === "minority")!;
    expect(minority.respondentPct).toBe(40);
    expect(minority.representationRatio).toBe(1);
    expect(minority.status).toBe("balanced");
    expect(result.underRepresented).toEqual([]);
  });

  it("flags over-representation when respondents skew to the high-need tract", () => {
    const result = buildRepresentativeness(TRACTS, new Map([["B", 8], ["A", 1], ["C", 1]]));
    const minority = result.metrics.find((m) => m.key === "minority")!;
    // respondent minority = (60*8+20+40)/10 = 54 vs baseline 40 → ratio 1.35 → over
    expect(minority.respondentPct).toBe(54);
    expect(minority.status).toBe("over");
    expect(result.underRepresented).toEqual([]);
  });

  it("marks a single-tract study area insufficient (self-comparison, never 'balanced')", () => {
    const result = buildRepresentativeness([TRACTS[0]], new Map([["A", 5]]));
    expect(result.tractCount).toBe(1);
    for (const metric of result.metrics) {
      expect(metric.status).toBe("insufficient");
    }
    expect(result.underRepresented).toEqual([]);
  });

  it("marks metrics insufficient when no respondents fall in a tract", () => {
    const result = buildRepresentativeness(TRACTS, new Map());
    expect(result.respondentCount).toBe(0);
    for (const metric of result.metrics) {
      expect(metric.respondentPct).toBeNull();
      expect(metric.representationRatio).toBeNull();
      expect(metric.status).toBe("insufficient");
      expect(metric.baselinePct).not.toBeNull(); // baseline still computed
    }
  });
});

describe("pointInPolygon", () => {
  const square = { type: "Polygon" as const, coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };

  it("detects inside vs outside a simple polygon", () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
  });

  it("excludes points inside a hole", () => {
    const withHole = {
      type: "Polygon" as const,
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
      ],
    };
    expect(pointInPolygon(1, 1, withHole)).toBe(true);
    expect(pointInPolygon(5, 5, withHole)).toBe(false); // in the hole
  });

  it("handles MultiPolygon", () => {
    const multi = {
      type: "MultiPolygon" as const,
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]],
      ],
    };
    expect(pointInPolygon(25, 25, multi)).toBe(true);
    expect(pointInPolygon(10, 10, multi)).toBe(false);
  });
});

describe("study-area helpers", () => {
  it("computes the buffered bbox polygon of respondent points", () => {
    const bbox = bboxOfPoints([
      { lng: -121.05, lat: 39.2 },
      { lng: -121.0, lat: 39.25 },
      { lng: Number.NaN, lat: 5 }, // ignored
    ]);
    expect(bbox).toEqual({ minLon: -121.05, minLat: 39.2, maxLon: -121.0, maxLat: 39.25 });

    const buffered = bufferBbox(bbox!, 0.02);
    expect(buffered.minLon).toBeCloseTo(-121.07, 8);
    expect(buffered.maxLat).toBeCloseTo(39.27, 8);

    const polygon = bboxToPolygon(buffered);
    expect(polygon.type).toBe("Polygon");
    expect(polygon.coordinates[0]).toHaveLength(5); // closed ring
    expect(polygon.coordinates[0][0]).toEqual(polygon.coordinates[0][4]);
  });

  it("returns null bbox when there are no valid points", () => {
    expect(bboxOfPoints([])).toBeNull();
    expect(bboxOfPoints([{ lng: Number.NaN, lat: Number.NaN }])).toBeNull();
  });
});

describe("assignRespondentsToTracts", () => {
  it("counts respondents per containing tract and drops those outside every tract", () => {
    const features = [
      { geoid: "A", geometry: { type: "Polygon" as const, coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } },
      { geoid: "B", geometry: { type: "Polygon" as const, coordinates: [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]] } },
      { geoid: "C", geometry: null },
    ];
    const counts = assignRespondentsToTracts(
      [
        { lng: 5, lat: 5 }, // A
        { lng: 6, lat: 6 }, // A
        { lng: 25, lat: 25 }, // B
        { lng: 100, lat: 100 }, // outside → dropped
      ],
      features
    );
    expect(counts.get("A")).toBe(2);
    expect(counts.get("B")).toBe(1);
    expect(counts.has("C")).toBe(false);
    expect([...counts.values()].reduce((s, n) => s + n, 0)).toBe(3);
  });
});
