import { describe, expect, it } from "vitest";

import { readWgs84Bbox, readWgs84Viewport } from "@/lib/geo/wgs84-bounds";
import {
  parseWgs84QueryViewport,
  readCameraWgs84QueryViewport,
  readWgs84QueryViewport,
} from "@/lib/geo/wgs84-query-viewport";

describe("canonical designation query viewport", () => {
  it.each([
    { input: [-20, -10, 30, 10], expected: [-20, -10, 30, 10] },
    { input: [170, -10, -170, 10], expected: [170, -10, -170, 10] },
    { input: [-180, -90, 180, 90], expected: [-180, -90, 180, 90] },
    { input: [180, -10, -170, 10], expected: [-180, -10, -170, 10] },
    { input: [170, -10, -180, 10], expected: [170, -10, 180, 10] },
    { input: [-180, -10, -170, 10], expected: [-180, -10, -170, 10] },
    { input: [170, -10, 180, 10], expected: [170, -10, 180, 10] },
    { input: [-0, -0, 10, 20], expected: [0, 0, 10, 20] },
    { input: [-10, -20, -0, -0], expected: [-10, -20, 0, 0] },
  ])("reads canonical query $input as $expected", ({ input, expected }) => {
    expect(readWgs84QueryViewport(input)).toEqual(expected);
  });

  it.each([
    { name: "missing", input: undefined }, { name: "null", input: null },
    { name: "object", input: { west: 1, south: 2, east: 3, north: 4 } },
    { name: "short", input: [1, 2, 3] }, { name: "long", input: [1, 2, 3, 4, 5] },
    { name: "sparse", input: new Array<number>(4) }, { name: "string coordinate", input: ["1", 2, 3, 4] },
    { name: "west outside", input: [-181, -10, 0, 10] },
    { name: "east outside", input: [0, -10, 181, 10] },
    { name: "south below", input: [0, -91, 1, 10] },
    { name: "south above", input: [0, 91, 1, 92] },
    { name: "north below", input: [0, -92, 1, -91] },
    { name: "north above", input: [0, -10, 1, 91] },
    { name: "latitude reversed", input: [0, 10, 1, -10] },
    { name: "zero height", input: [0, 10, 1, 10] },
    { name: "zero width", input: [1, -10, 1, 10] },
    { name: "equivalent seam endpoints", input: [180, -10, -180, 10] },
  ])("refuses $name", ({ input }) => {
    expect(readWgs84QueryViewport(input)).toBeNull();
  });

  it("refuses every nonfinite coordinate in both numeric entry points", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const index of [0, 1, 2, 3]) {
        const coordinates = [-10, -20, 10, 20]; coordinates[index] = value;
        expect(readWgs84QueryViewport(coordinates)).toBeNull();
        expect(readCameraWgs84QueryViewport(coordinates)).toBeNull();
      }
    }
  });

  it("keeps wrapped query semantics separate from strict stored bounds", () => {
    const wrapped = [170, -10, -170, 10];
    expect(readWgs84QueryViewport(wrapped)).toEqual(wrapped);
    expect(readWgs84Bbox(wrapped)).toBeNull();
    expect(readWgs84Viewport(wrapped)).toBeNull();
  });

  it("preserves tiny canonical intervals without adding longitude offsets", () => {
    const narrow = [1e-16, -1, 2e-16, 1];
    const crossing = [179.99999999999997, -1, -179.99999999999997, 1];
    expect(readCameraWgs84QueryViewport(narrow)).toEqual(narrow);
    expect(readCameraWgs84QueryViewport(crossing)).toEqual(crossing);
  });
});

describe("camera world-copy query viewport", () => {
  it.each([
    { input: [170, -10, 190, 10], expected: [170, -10, -170, 10] },
    { input: [190, -10, 210, 10], expected: [-170, -10, -150, 10] },
    { input: [-210, -10, -190, 10], expected: [150, -10, 170, 10] },
    { input: [-190, -10, -170, 10], expected: [170, -10, -170, 10] },
    { input: [180, -10, 190, 10], expected: [-180, -10, -170, 10] },
    { input: [530, -10, 550, 10], expected: [170, -10, -170, 10] },
    { input: [170, -10, -170, 10], expected: [170, -10, -170, 10] },
    { input: [0, -12, 360, 34], expected: [-180, -12, 180, 34] },
    { input: [-540, -12, 540, 34], expected: [-180, -12, 180, 34] },
    { input: [-180, -90, 180, 90], expected: [-180, -90, 180, 90] },
    { input: [Number.MAX_SAFE_INTEGER - 1, -1, Number.MAX_SAFE_INTEGER, 1], expected: [30, -1, 31, 1] },
  ])("normalizes camera $input to $expected", ({ input, expected }) => {
    expect(readCameraWgs84QueryViewport(input)).toEqual(expected);
  });

  it.each([
    { name: "unreadable bounds", input: null },
    { name: "sparse bounds", input: new Array<number>(4) },
    { name: "reversed world-copy endpoints", input: [210, -10, 190, 10] },
    { name: "mixed reversed endpoints", input: [190, -10, -170, 10] },
    { name: "equivalent seam endpoints", input: [180, -10, -180, 10] },
    { name: "collapsed tiny width", input: [1, -10, 1, 10] },
    { name: "zero height", input: [170, 10, 190, 10] },
    { name: "bad latitude", input: [170, -91, 190, 10] },
    { name: "unsafe west", input: [-Number.MAX_SAFE_INTEGER - 1, -10, 0, 10] },
    { name: "unsafe east", input: [0, -10, Number.MAX_SAFE_INTEGER + 1, 10] },
    { name: "unsafe narrow copy", input: [Number.MAX_SAFE_INTEGER + 1, -10, Number.MAX_SAFE_INTEGER + 3, 10] },
    { name: "unsafe computed width", input: [-Number.MAX_SAFE_INTEGER, -10, Number.MAX_SAFE_INTEGER, 10] },
  ])("refuses $name without a world fallback", ({ input }) => {
    expect(readCameraWgs84QueryViewport(input)).toBeNull();
  });
});

describe("designation query string", () => {
  it.each([
    { raw: "-20,-10,30,10", expected: [-20, -10, 30, 10] },
    { raw: " 170 , -10 , -170 , 10 ", expected: [170, -10, -170, 10] },
    { raw: "-180,-90,180,90", expected: [-180, -90, 180, 90] },
    { raw: "180,-10,-170,10", expected: [-180, -10, -170, 10] },
    { raw: "170,-10,-180,10", expected: [170, -10, 180, 10] },
    { raw: "1e1,-1e1,2e1,1e1", expected: [10, -10, 20, 10] },
  ])("parses complete tokens $raw", ({ raw, expected }) => {
    expect(parseWgs84QueryViewport(raw)).toEqual(expected);
  });

  it.each([null, "", "10,,12,35", "10, ,12,35", ",0,12,35", "0,-1,12,", "1,2,3", "1,2,3,4,5",
    "10x,0,12,35", "NaN,0,12,35", "0,-Infinity,12,35", "0,0,Infinity,35", "0,0,12,1e999",
    "190,-10,210,10", "180,-10,-180,10", "0,0,0,1", "0,1,10,1"])("refuses malformed query %s", raw => {
    expect(parseWgs84QueryViewport(raw)).toBeNull();
  });
});
