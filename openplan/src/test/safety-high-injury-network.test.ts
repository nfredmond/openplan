/**
 * The high-injury network ranking: per-mile normalization, ties, the fatal-only
 * label, and the difference between an empty network and one that could not
 * be ranked.
 *
 * Lines run along the equator so a mile of road is an exact number of degrees
 * and every length below is checkable by hand. The coordinates are a test
 * device, not a place.
 *
 * Blind category: this proves the arithmetic and labels on synthetic lines. It
 * does not prove that stored road lines cover a study area, or that a crash's
 * reported coordinates sit on the road it happened on.
 */
import { describe, expect, it } from "vitest";
import {
  computeHighInjuryNetwork,
  cutLineIntoPieces,
  describeHighInjuryNetworkCoverage,
  highInjuryNetworkBasis,
  highInjuryNetworkFeatureCollection,
  highInjuryNetworkMeasureLabel,
  rankHighInjuryCandidates,
  type HighInjuryNetworkCrash,
} from "@/lib/safety/high-injury-network";
import type { SafetyRoadContextFeature } from "@/lib/safety/road-context";

const EARTH_RADIUS_METERS = 6_371_008.8;
const METERS_PER_MILE = 1609.344;
const DEGREES_PER_MILE = (METERS_PER_MILE / EARTH_RADIUS_METERS) * (180 / Math.PI);

/** A straight road along a parallel, starting at `startMile` east of 0. */
function road(id: string, name: string, latitude: number, startMile: number, miles: number): SafetyRoadContextFeature {
  return {
    id,
    name,
    geometry: {
      type: "LineString",
      coordinates: [
        [startMile * DEGREES_PER_MILE, latitude],
        [(startMile + miles) * DEGREES_PER_MILE, latitude],
      ],
    },
    sourceId: "us-census-tiger-line-cache",
    sourceLabel: "U.S. Census TIGER/Line roads",
    vintage: "2025-01-01",
  };
}

let crashSerial = 0;
/** A crash about 11 meters off a road, at a mile mark along it. */
function crashAt(latitude: number, mile: number, severity: HighInjuryNetworkCrash["severity"] = "severe_injury"): HighInjuryNetworkCrash {
  crashSerial += 1;
  return { id: `crash-${crashSerial}`, longitude: mile * DEGREES_PER_MILE, latitude: latitude + 0.0001, severity };
}

function repeat<T>(count: number, make: (index: number) => T): T[] {
  return Array.from({ length: count }, (_, index) => make(index));
}

function computed(network: ReturnType<typeof computeHighInjuryNetwork>) {
  if (network.status !== "computed") throw new Error(`expected a computed network, got ${network.reason}`);
  return network;
}

describe("cutting road lines into pieces", () => {
  it("cuts half-mile pieces and folds a short leftover into the piece before it", () => {
    const line = road("a", "A Street", 0, 0, 1.2).geometry.coordinates;
    const lengths = cutLineIntoPieces(line, 0.5 * METERS_PER_MILE).map((piece) => piece.lengthMeters / METERS_PER_MILE);
    expect(lengths).toHaveLength(2);
    expect(lengths[0]).toBeCloseTo(0.5, 6);
    expect(lengths[1]).toBeCloseTo(0.7, 6);
  });

  it("keeps a leftover of a quarter mile or more as its own piece", () => {
    const line = road("a", "A Street", 0, 0, 1.3).geometry.coordinates;
    const lengths = cutLineIntoPieces(line, 0.5 * METERS_PER_MILE).map((piece) => piece.lengthMeters / METERS_PER_MILE);
    expect(lengths.map((value) => Number(value.toFixed(6)))).toEqual([0.5, 0.5, 0.3]);
  });
});

describe("ranking by crashes per mile", () => {
  it("ranks a short piece with fewer crashes above a longer piece with more", () => {
    // Half a mile with 3 crashes is 6 per mile; 0.7 mile with 4 is about 5.7.
    // Ranking by count alone would put the 0.7-mile piece first.
    const short = road("short", "Short Avenue", 0, 0, 0.5);
    const long = road("long", "Long Boulevard", 0, 10, 0.7);
    const network = computed(computeHighInjuryNetwork({
      crashes: [
        ...repeat(3, (index) => crashAt(0, 0.1 + index * 0.1)),
        ...repeat(4, (index) => crashAt(0, 10.1 + index * 0.1)),
      ],
      crashesConsidered: 7,
      basis: "ksi",
      roads: [short, long],
      years: [2024, 2022, 2023],
    }));

    expect(network.method).toBe("road_segments");
    expect(network.segments.map((segment) => segment.label)).toEqual(["Short Avenue", "Long Boulevard"]);
    expect(network.segments[0].crashesPerMile).toBeCloseTo(6, 6);
    expect(network.segments[1].crashesPerMile).toBeCloseTo(4 / 0.7, 6);
    expect(network.segments[1].lengthMiles).toBeCloseTo(0.7, 6);
    expect(network.years).toEqual([2022, 2023, 2024]);
  });

  it("measures a stub shorter than a quarter mile as a quarter mile", () => {
    const stub = road("stub", "Stub Lane", 0, 0, 0.1);
    const network = computed(computeHighInjuryNetwork({
      crashes: [crashAt(0, 0.05)],
      crashesConsidered: 1,
      basis: "ksi",
      roads: [stub],
      years: [2024],
    }));
    expect(network.segments[0].lengthMiles).toBeCloseTo(0.1, 6);
    // One crash over 0.1 mile would read 10 per mile; the floor makes it 4.
    expect(network.segments[0].crashesPerMile).toBeCloseTo(4, 6);
  });

  it("gives tied segments the same rank and skips the next rank", () => {
    const network = computed(computeHighInjuryNetwork({
      crashes: [
        ...repeat(2, (index) => crashAt(0, 0.1 + index * 0.2)),
        ...repeat(2, (index) => crashAt(0, 10.1 + index * 0.2)),
        crashAt(0, 20.2),
      ],
      crashesConsidered: 5,
      basis: "ksi",
      roads: [
        road("b", "B Street", 0, 0, 0.5),
        road("a", "A Street", 0, 10, 0.5),
        road("c", "C Street", 0, 20, 0.5),
      ],
      years: [2024],
    }));
    expect(network.segments.map((segment) => [segment.rank, segment.tied])).toEqual([
      [1, true],
      [1, true],
      [3, false],
    ]);
  });

  it("orders tied rows by fatal crashes, then by id, without breaking the tie", () => {
    const ranked = rankHighInjuryCandidates([
      { id: "z", sortMeasure: 4, crashCount: 2, fatalCrashCount: 0 },
      { id: "y", sortMeasure: 4, crashCount: 2, fatalCrashCount: 1 },
      { id: "a", sortMeasure: 4, crashCount: 2, fatalCrashCount: 0 },
    ]);
    expect(ranked.map((row) => [row.id, row.rank])).toEqual([["y", 1], ["a", 1], ["z", 1]]);
  });

  it("gives each crash to the nearest piece only, and counts a far crash as not placed", () => {
    const network = computed(computeHighInjuryNetwork({
      crashes: [crashAt(0, 0.2), { id: "far", longitude: 0.2 * DEGREES_PER_MILE, latitude: 0.01, severity: "fatal" }],
      crashesConsidered: 2,
      basis: "ksi",
      roads: [road("a", "A Street", 0, 0, 0.5)],
      years: [2024],
    }));
    expect(network.crashesPlaced).toBe(1);
    expect(network.listedCrashes).toBe(1);
    expect(describeHighInjuryNetworkCoverage(network)).toMatch(/1 of 2 fatal or serious-injury crashes/);
    expect(describeHighInjuryNetworkCoverage(network)).toMatch(/1 are not on this list/);
  });

  it("keys a road piece by the line, not by the row that stores it", () => {
    const live = road("tiger-0-123-0", "A Street", 0, 0, 0.5);
    const cached = { ...live, id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff" };
    const fromLive = computed(computeHighInjuryNetwork({ crashes: [crashAt(0, 0.2)], crashesConsidered: 1, basis: "ksi", roads: [live], years: [] }));
    const fromCache = computed(computeHighInjuryNetwork({ crashes: [crashAt(0, 0.2)], crashesConsidered: 1, basis: "ksi", roads: [cached], years: [] }));
    expect(fromLive.segments[0].id).toBe(fromCache.segments[0].id);
    expect(fromLive.segments[0].id).toMatch(/^road:[0-9a-f]{8}:0$/);
  });

  it("counts a line stored twice once", () => {
    const line = road("one", "A Street", 0, 0, 0.5);
    const network = computed(computeHighInjuryNetwork({
      crashes: [crashAt(0, 0.2)],
      crashesConsidered: 1,
      basis: "ksi",
      roads: [line, { ...line, id: "two" }],
      years: [2024],
    }));
    expect(network.segmentsWithCrashes).toBe(1);
    expect(network.roadMilesReviewed).toBeCloseTo(0.5, 6);
  });
});

describe("what the source lets the network count", () => {
  it("reads KSI only from a source that separates serious injuries", () => {
    expect(highInjuryNetworkBasis("kabco_full")).toBe("ksi");
    expect(highInjuryNetworkBasis("fatal_only")).toBe("fatal_only");
    expect(highInjuryNetworkBasis("fatal_injury_only")).toBe("fatal_only");
    expect(highInjuryNetworkBasis("")).toBeNull();
    expect(highInjuryNetworkBasis(null)).toBeNull();
  });

  it("labels a fatal-only network at the figure and never as KSI", () => {
    const label = highInjuryNetworkMeasureLabel("fatal_only", "road_segments");
    expect(label).toBe("Fatal crashes per mile (fatal crashes only)");
    expect(label).not.toMatch(/serious|ksi/i);
    expect(highInjuryNetworkMeasureLabel("ksi", "road_segments")).toBe("Fatal and serious-injury crashes per mile");
  });

  it("ignores serious-injury rows and reports no serious-injury figure on a fatal-only network", () => {
    const network = computed(computeHighInjuryNetwork({
      crashes: [crashAt(0, 0.1, "fatal"), crashAt(0, 0.2, "severe_injury"), crashAt(0, 0.3, "fatal")],
      crashesConsidered: 2,
      basis: "fatal_only",
      roads: [road("a", "A Street", 0, 0, 0.5)],
      years: [2023],
    }));
    expect(network.segments[0].crashCount).toBe(2);
    expect(network.segments[0].fatalCrashCount).toBe(2);
    expect(network.segments[0].seriousInjuryCrashCount).toBeNull();
    expect(describeHighInjuryNetworkCoverage(network)).toMatch(/fatal crashes/);
    expect(describeHighInjuryNetworkCoverage(network)).not.toMatch(/serious/);
  });
});

describe("empty, unavailable and zero stay different", () => {
  it("returns a computed, empty network when no severe crash exists, and says it is not a safety finding", () => {
    const network = computed(computeHighInjuryNetwork({
      crashes: [],
      crashesConsidered: 0,
      basis: "ksi",
      roads: [road("a", "A Street", 0, 0, 0.5)],
      years: [2024],
    }));
    expect(network.segments).toEqual([]);
    expect(network.crashesConsidered).toBe(0);
    expect(describeHighInjuryNetworkCoverage(network)).toMatch(/not a finding that the roads are safe/);
  });

  it("refuses to rank when the road read failed, rather than switching method", () => {
    const network = computeHighInjuryNetwork({
      crashes: [crashAt(0, 0.2)],
      crashesConsidered: 1,
      basis: "ksi",
      roads: null,
      years: [2024],
    });
    expect(network).toEqual({ status: "unavailable", reason: "road_read_failed", basis: "ksi" });
    expect(highInjuryNetworkFeatureCollection(network).features).toEqual([]);
  });

  it("uses half-mile grid squares, with no per-mile figure, when no road lines are stored", () => {
    const network = computed(computeHighInjuryNetwork({
      crashes: [crashAt(0, 0.1), crashAt(0, 0.12), crashAt(0, 3)],
      crashesConsidered: 3,
      basis: "ksi",
      roads: [],
      years: [2024],
    }));
    expect(network.method).toBe("grid_cells");
    expect(network.roadMilesReviewed).toBeNull();
    expect(network.segments[0].crashCount).toBe(2);
    expect(network.segments[0].crashesPerMile).toBeNull();
    expect(network.segments[0].lengthMiles).toBeNull();
    expect(network.segments[0].label).toMatch(/^Half-mile square at /);
    expect(highInjuryNetworkMeasureLabel("ksi", network.method)).toMatch(/per half-mile square/);
  });

  it("draws only the listed segments on the map", () => {
    const network = computed(computeHighInjuryNetwork({
      crashes: [crashAt(0, 0.2)],
      crashesConsidered: 1,
      basis: "ksi",
      roads: [road("a", "A Street", 0, 0, 0.5), road("b", "B Street", 0.05, 0, 0.5)],
      years: [2024],
    }));
    const layer = highInjuryNetworkFeatureCollection(network);
    expect(layer.features).toHaveLength(1);
    expect(layer.features[0].properties).toMatchObject({ rank: 1, label: "A Street", crashCount: 1 });
    expect(layer.features[0].geometry.type).toBe("LineString");
  });
});
