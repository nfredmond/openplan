import { describe, expect, it } from "vitest";

import {
  placeSafetyMapMarks,
  renderSafetyStreetContextSvg,
  type SafetyStreetContextHighlight,
} from "@/lib/safety/street-context-svg";

/**
 * KI-2026-11-14-304, verification 48: on a county map several ranked pieces
 * sit closer together than one mark is wide. The marks were drawn on top of
 * each other, so a reader counted 17 numbers for 20 rows (Sierra County: 9
 * under 3 and 5, 17 and 18 under 1). A covered mark now moves aside and a thin
 * line joins it to a dot at its segment.
 *
 * Not covered here: the printed PDF (the journey and the look check read it),
 * and whether a moved mark is easy to follow on a crowded map.
 */

const WIDTH = 760;
const HEIGHT = 430;
const RADIUS = 9;

type Mark = { number: number; x: number; y: number; anchor: [number, number] | null };

function drawnMarks(svg: string): Mark[] {
  return [...svg.matchAll(/<g transform="translate\((-?[\d.]+) (-?[\d.]+)\)"(?: data-anchor="(-?[\d.]+) (-?[\d.]+)")?><circle r="9"[^>]*\/><text [^>]*>(\d+)<\/text><\/g>/g)]
    .map((match) => ({
      number: Number(match[5]),
      x: Number(match[1]),
      y: Number(match[2]),
      anchor: match[3] === undefined ? null : [Number(match[3]), Number(match[4])] as [number, number],
    }))
    .sort((a, b) => a.number - b.number);
}

function leaders(svg: string): Array<{ anchorX: number; anchorY: number; dx: number; dy: number }> {
  return [...svg.matchAll(/<g transform="translate\((-?[\d.]+) (-?[\d.]+)\)"><line x1="0" y1="0" x2="(-?[\d.]+)" y2="(-?[\d.]+)"[^>]*\/><circle r="2.5"[^>]*\/><\/g>/g)]
    .map((match) => ({ anchorX: Number(match[1]), anchorY: Number(match[2]), dx: Number(match[3]), dy: Number(match[4]) }));
}

/** A short piece of road, about 40 m long, starting at the given point. */
function piece(number: number, lon: number, lat: number): SafetyStreetContextHighlight {
  return { number, geometry: { type: "LineString", coordinates: [[lon, lat], [lon + 0.0004, lat + 0.0002]] } };
}

/**
 * Six rows across about 25 km: rows 1, 2 and 4 within 60 m of each other, rows
 * 3 and 6 together at the east edge, row 5 alone to the north.
 */
function countyHighlights(): SafetyStreetContextHighlight[] {
  return [
    piece(1, -120.5, 39.5),
    piece(2, -120.5003, 39.5002),
    piece(3, -120.2, 39.5),
    piece(4, -120.4998, 39.4999),
    piece(5, -120.35, 39.62),
    piece(6, -120.2002, 39.5001),
  ];
}

function countyMap(): string {
  const svg = renderSafetyStreetContextSvg({ roads: [], crashLocations: [], projectGeometry: null, highlights: countyHighlights() });
  if (!svg) throw new Error("the map was not drawn");
  return svg;
}

describe("the fixture is the defect's shape", () => {
  it("puts three anchors, and another two, closer together than one mark is wide", () => {
    const marks = drawnMarks(countyMap());
    const place = (mark: Mark) => mark.anchor ?? [mark.x, mark.y];
    const apart = (a: number, b: number) => {
      const [ax, ay] = place(marks[a - 1]);
      const [bx, by] = place(marks[b - 1]);
      return Math.hypot(ax - bx, ay - by);
    };
    expect(apart(1, 2)).toBeLessThan(RADIUS * 2);
    expect(apart(1, 4)).toBeLessThan(RADIUS * 2);
    expect(apart(3, 6)).toBeLessThan(RADIUS * 2);
    expect(apart(1, 5)).toBeGreaterThan(100);
  });
});

describe("a numbered map with marks that would cover each other", () => {
  it("draws one mark for every row", () => {
    expect(drawnMarks(countyMap()).map((mark) => mark.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("leaves no mark touching another, so every number can be read", () => {
    const marks = drawnMarks(countyMap());
    for (const a of marks) {
      for (const b of marks) {
        if (a.number >= b.number) continue;
        expect(Math.hypot(a.x - b.x, a.y - b.y), `marks ${a.number} and ${b.number} overlap`).toBeGreaterThanOrEqual(RADIUS * 2);
      }
    }
  });

  it("keeps the best-ranked row of each stack, and a row with room, on its own segment", () => {
    const marks = drawnMarks(countyMap());
    expect(marks.filter((mark) => mark.anchor === null).map((mark) => mark.number)).toEqual([1, 3, 5]);
  });

  it("joins every moved mark to a dot at its segment", () => {
    const svg = countyMap();
    const moved = drawnMarks(svg).filter((mark) => mark.anchor !== null);
    const lines = leaders(svg);
    expect(moved.map((mark) => mark.number)).toEqual([2, 4, 6]);
    expect(lines).toHaveLength(moved.length);
    for (const mark of moved) {
      const [anchorX, anchorY] = mark.anchor!;
      const line = lines.find((entry) => entry.anchorX === anchorX && entry.anchorY === anchorY);
      expect(line, `no line starts at mark ${mark.number}'s segment`).toBeDefined();
      expect(anchorX + line!.dx).toBeCloseTo(mark.x, 1);
      expect(anchorY + line!.dy).toBeCloseTo(mark.y, 1);
    }
  });

  it("moves a mark no farther than it must", () => {
    for (const mark of drawnMarks(countyMap()).filter((entry) => entry.anchor !== null)) {
      expect(Math.hypot(mark.x - mark.anchor![0], mark.y - mark.anchor![1]), `mark ${mark.number}`).toBeLessThanOrEqual(RADIUS * 5);
    }
  });

  it("keeps every mark whole inside the frame", () => {
    for (const mark of drawnMarks(countyMap())) {
      expect(mark.x, `mark ${mark.number}`).toBeGreaterThanOrEqual(RADIUS);
      expect(mark.x, `mark ${mark.number}`).toBeLessThanOrEqual(WIDTH - RADIUS);
      expect(mark.y, `mark ${mark.number}`).toBeGreaterThanOrEqual(RADIUS);
      expect(mark.y, `mark ${mark.number}`).toBeLessThanOrEqual(HEIGHT - RADIUS);
    }
  });

  it("draws the same records the same way every time, in any input order", () => {
    const again = renderSafetyStreetContextSvg({ roads: [], crashLocations: [], projectGeometry: null, highlights: [...countyHighlights()].reverse() });
    expect(drawnMarks(again!)).toEqual(drawnMarks(countyMap()));
  });
});

describe("a numbered map whose marks have room", () => {
  it("moves nothing and draws no line", () => {
    const svg = renderSafetyStreetContextSvg({
      roads: [], crashLocations: [], projectGeometry: null,
      highlights: [piece(1, -120.5, 39.5), piece(2, -120.35, 39.62), piece(3, -120.2, 39.5)],
    })!;
    expect(svg).not.toContain("data-anchor");
    expect(leaders(svg)).toEqual([]);
    expect(drawnMarks(svg).map((mark) => mark.number)).toEqual([1, 2, 3]);
  });
});

describe("placing marks", () => {
  it("moves the later of two marks at one place straight up, clear of the first", () => {
    const [first, second] = placeSafetyMapMarks([{ number: 2, x: 300, y: 200 }, { number: 1, x: 300, y: 200 }], { width: WIDTH, height: HEIGHT });
    expect(first).toMatchObject({ number: 1, x: 300, y: 200, moved: false });
    expect(second.number).toBe(2);
    expect(second.moved).toBe(true);
    expect(second.x).toBeCloseTo(300, 6);
    expect(second.y).toBeLessThan(200 - RADIUS * 2);
  });

  it("does not move a mark out of the frame from a corner", () => {
    const placed = placeSafetyMapMarks(
      [1, 2, 3, 4, 5].map((number) => ({ number, x: 12, y: 12 })),
      { width: WIDTH, height: HEIGHT },
    );
    for (const mark of placed) {
      expect(mark.x, `mark ${mark.number}`).toBeGreaterThanOrEqual(RADIUS);
      expect(mark.y, `mark ${mark.number}`).toBeGreaterThanOrEqual(RADIUS);
    }
    for (const a of placed) for (const b of placed) {
      if (a.number < b.number) expect(Math.hypot(a.x - b.x, a.y - b.y), `marks ${a.number} and ${b.number}`).toBeGreaterThanOrEqual(RADIUS * 2);
    }
  });
});
