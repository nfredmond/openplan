import { describe, expect, it } from "vitest";
import {
  DEFAULT_TURN_ALLOWANCE_SECONDS,
  generateSurveyGrid,
  type SurveyGridInput,
  type SurveyGridRefusal,
  type SurveyGridResult,
  type SurveyGridSuccess,
} from "@/lib/aerial/survey-grid";

/**
 * Survey grid geometry — the mutation-audit-shaped code: mechanical math
 * nobody sounds worried about. The anchor test is a fully HAND-DERIVED
 * fixture asserted to exact numbers, because band assertions ("more than 0
 * lines") are the known-hollow pattern.
 *
 * HAND DERIVATION (done on paper, independently of the implementation):
 *
 *   Camera: 12 × 9 mm sensor, 4000 × 3000 px, 10 mm focal length.
 *   Target GSD 3 cm/px.
 *     altitude   = 3 × 10 × 4000 / (12 × 100)        = 100 m
 *     footprintW = 3 × 4000 / 100                    = 120 m (across-track)
 *     footprintH = 3 × 3000 / 100                    =  90 m (along-track)
 *   Overlaps 75% front / 65% side:
 *     lineSpacing  = 120 × (1 − 0.65)                =  42 m
 *     photoSpacing =  90 × (1 − 0.75)                = 22.5 m
 *   AOI: 400 m (E–W) × 300 m (N–S) rectangle, boundary margin 20 m:
 *     flyable along-track  = 400 − 2×20              = 360 m
 *     flyable across-track = 300 − 2×20              = 260 m
 *     lines run E–W (long axis), compass 90°
 *     lineCount  = ceil(260 / 42) + 1 = 7 + 1        =   8
 *     even placement spacing = 260 / 7               ≈ 37.142857 m
 *     photos per line = ceil(360 / 22.5) + 1 = 16+1  =  17  (spacing exactly 22.5)
 *     photoCount = 8 × 17                            = 136
 *     distance = 8 × 360 + 7 × (260/7) = 2880 + 260  = 3140 m
 *   Speed 8 m/s, 10 s per turn (7 turns):
 *     duration = 3140/8 + 70 = 392.5 + 70            = 462.5 s
 *   Battery: 20 usable min (1200 s) → 1 leg; 3 min (180 s) → ceil(2.57) = 3 legs.
 *   Coverage area = 400 × 300                        = 120,000 m²
 */

const LAT0 = 45;
const LON0 = 10;
const M_PER_DEG_LAT = 111_132;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

/** lon/lat for a point at meter offsets (x east, y north) from the fixture origin. */
function pt(xM: number, yM: number): [number, number] {
  return [LON0 + xM / M_PER_DEG_LON, LAT0 + yM / M_PER_DEG_LAT];
}

/** Axis-aligned rectangle ring centered on the fixture origin. */
function rectRing(widthM: number, heightM: number): [number, number][] {
  const hw = widthM / 2;
  const hh = heightM / 2;
  return [pt(-hw, -hh), pt(hw, -hh), pt(hw, hh), pt(-hw, hh)];
}

/** Equirectangular distance in meters between two fixture lon/lat points. */
function metersBetween(a: [number, number], b: [number, number]): number {
  const dx = (b[0] - a[0]) * M_PER_DEG_LON;
  const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

const CAMERA = {
  sensorWidthMm: 12,
  sensorHeightMm: 9,
  imageWidthPx: 4000,
  imageHeightPx: 3000,
  focalLengthMm: 10,
};

function baseInput(overrides: Partial<SurveyGridInput> = {}): SurveyGridInput {
  return {
    aoiRing: rectRing(400, 300),
    camera: { ...CAMERA },
    targetGsdCm: 3,
    frontOverlapPct: 75,
    sideOverlapPct: 65,
    speedMps: 8,
    boundaryMarginM: 20,
    flightMinutesPerBattery: 20,
    turnAllowanceSeconds: 10,
    ...overrides,
  };
}

function plan(result: SurveyGridResult): SurveyGridSuccess {
  if (!result.ok) {
    throw new Error(`expected a plan, got refusal ${result.reason}: ${result.message}`);
  }
  return result;
}

function refusal(result: SurveyGridResult): SurveyGridRefusal {
  if (result.ok) throw new Error("expected a refusal, got a plan");
  return result;
}

describe("generateSurveyGrid — hand-derived fixture", () => {
  const grid = plan(generateSurveyGrid(baseInput()));

  it("derives altitude and footprints from the GSD target (exact numbers)", () => {
    expect(grid.altitudeM).toBeCloseTo(100, 6);
    expect(grid.gsdCm).toBeCloseTo(3, 6);
    expect(grid.footprintWidthM).toBeCloseTo(120, 6);
    expect(grid.footprintHeightM).toBeCloseTo(90, 6);
    expect(grid.lineSpacingM).toBeCloseTo(42, 6);
    expect(grid.photoSpacingM).toBeCloseTo(22.5, 6);
  });

  it("derives GSD from altitude when altitude is given instead", () => {
    const fromAltitude = plan(
      generateSurveyGrid(baseInput({ targetGsdCm: undefined, altitudeM: 100 }))
    );
    expect(fromAltitude.gsdCm).toBeCloseTo(3, 6);
    const lower = plan(generateSurveyGrid(baseInput({ targetGsdCm: undefined, altitudeM: 50 })));
    expect(lower.gsdCm).toBeCloseTo(1.5, 6);
  });

  it("lays out exactly 8 E–W lines with 17 photos each (136 total)", () => {
    expect(grid.lineCount).toBe(8);
    expect(grid.photoCount).toBe(136);
    expect(grid.flightAxisDeg).toBeCloseTo(90, 3);
    for (const line of grid.lines) {
      expect(line.photoPoints).toHaveLength(17);
      expect(line.lengthM).toBeCloseTo(360, 1);
      // E–W lines: latitude constant along the line.
      expect(Math.abs(line.start[1] - line.end[1]) * M_PER_DEG_LAT).toBeLessThan(0.1);
    }
  });

  it("places lines evenly at 260/7 m and photos at exactly 22.5 m (measured from output geometry)", () => {
    expect(grid.actualLineSpacingM).toBeCloseTo(260 / 7, 4);
    const measuredLineGap =
      Math.abs(grid.lines[1].start[1] - grid.lines[0].start[1]) * M_PER_DEG_LAT;
    expect(measuredLineGap).toBeCloseTo(260 / 7, 2);
    const photos = grid.lines[0].photoPoints;
    for (let i = 0; i + 1 < photos.length; i++) {
      expect(metersBetween(photos[i], photos[i + 1])).toBeCloseTo(22.5, 2);
    }
  });

  it("estimates distance, duration, and battery legs to the hand-derived numbers", () => {
    expect(grid.totalFlightDistanceM).toBeCloseTo(3140, 1);
    expect(grid.estimatedDurationSeconds).toBeCloseTo(462.5, 1);
    expect(grid.estimatedBatteryLegs).toBe(1);
    expect(grid.coverageAreaM2).toBeCloseTo(120_000, 0);

    const smallBattery = plan(generateSurveyGrid(baseInput({ flightMinutesPerBattery: 3 })));
    expect(smallBattery.estimatedBatteryLegs).toBe(3); // ceil(462.5 / 180)
  });

  it("orders lines as a serpentine: consecutive lines reversed, turns at the near end", () => {
    expect(grid.lines[0].headingDeg).toBeCloseTo(90, 1);
    for (let i = 0; i + 1 < grid.lines.length; i++) {
      const here = grid.lines[i];
      const next = grid.lines[i + 1];
      // Consecutive headings differ by 180° (mapped into [−180, 180)).
      const mappedDiff = ((next.headingDeg - here.headingDeg + 540) % 360) - 180;
      expect(Math.abs(mappedDiff)).toBeGreaterThan(179.5);
      // The next line starts at the SAME end the previous line finished on.
      expect(metersBetween(here.end, next.start)).toBeLessThan(grid.lineSpacingM + 1);
      // Photo points follow the flight direction.
      expect(metersBetween(here.start, here.photoPoints[0])).toBeLessThan(0.1);
      expect(
        metersBetween(here.end, here.photoPoints[here.photoPoints.length - 1])
      ).toBeLessThan(0.1);
    }
  });

  it("discloses its assumptions in planner language", () => {
    expect(grid.assumptions.some((a) => /altitude/i.test(a) && /derived/i.test(a))).toBe(true);
    expect(grid.assumptions.some((a) => /10 s per turn/.test(a))).toBe(true);
    expect(grid.assumptions.some((a) => /20 usable flight minutes/.test(a))).toBe(true);
    expect(grid.assumptions.some((a) => /regulatory ceiling/i.test(a))).toBe(true);
    // The projection error bound must reach the planner, not live only in the
    // module header: local flat-map frame, error under ~0.1% of mission extent.
    expect(grid.assumptions.some((a) => /flat-map frame/i.test(a) && /0\.1%/.test(a))).toBe(true);
  });
});

describe("generateSurveyGrid — margin shrink", () => {
  it("trims each line and insets the line band by the margin", () => {
    const withMargin = plan(generateSurveyGrid(baseInput({ boundaryMarginM: 20 })));
    const noMargin = plan(generateSurveyGrid(baseInput({ boundaryMarginM: 0 })));

    expect(withMargin.lines[0].lengthM).toBeCloseTo(360, 1);
    expect(noMargin.lines[0].lengthM).toBeCloseTo(400, 1);
    // ceil(300/42)+1 = 9 lines with no margin vs 8 with the 20 m margin.
    expect(noMargin.lineCount).toBe(9);
    expect(withMargin.lineCount).toBe(8);

    // First line sits 20 m inside the southern edge (v = −130 vs −150).
    const withMarginLat = LAT0 - 130 / M_PER_DEG_LAT;
    const noMarginLat = LAT0 - 150 / M_PER_DEG_LAT;
    expect(Math.abs(withMargin.lines[0].start[1] - withMarginLat) * M_PER_DEG_LAT).toBeLessThan(0.1);
    expect(Math.abs(noMargin.lines[0].start[1] - noMarginLat) * M_PER_DEG_LAT).toBeLessThan(0.1);
  });
});

describe("generateSurveyGrid — orientation rule", () => {
  it("flies the long axis: a north-south rectangle gets north-south lines", () => {
    const tall = plan(generateSurveyGrid(baseInput({ aoiRing: rectRing(300, 400) })));
    expect(tall.flightAxisDeg).toBeCloseTo(0, 3);
    expect(tall.lineCount).toBe(8); // same math as the anchor fixture, rotated 90°
    for (const line of tall.lines) {
      // N–S lines: longitude constant along the line.
      expect(Math.abs(line.start[0] - line.end[0]) * M_PER_DEG_LON).toBeLessThan(0.1);
      expect([0, 180]).toContainEqual(Math.round(line.headingDeg) % 360);
    }
  });
});

describe("generateSurveyGrid — overlap and camera bindings actually bind", () => {
  it("side overlap drives line count (65% → 8 lines, 30% → 5 lines)", () => {
    const sparse = plan(generateSurveyGrid(baseInput({ sideOverlapPct: 30 })));
    // spacing = 120 × 0.70 = 84; ceil(260/84) + 1 = 4 + 1 = 5
    expect(sparse.lineSpacingM).toBeCloseTo(84, 6);
    expect(sparse.lineCount).toBe(5);
  });

  it("front overlap drives photo count (75% → 17/line, 50% → 9/line)", () => {
    const sparse = plan(generateSurveyGrid(baseInput({ frontOverlapPct: 50 })));
    // spacing = 90 × 0.50 = 45; ceil(360/45) + 1 = 8 + 1 = 9
    expect(sparse.photoSpacingM).toBeCloseTo(45, 6);
    expect(sparse.lines[0].photoPoints).toHaveLength(9);
    expect(sparse.photoCount).toBe(8 * 9);
  });

  it("the camera's pixel count drives the derived altitude", () => {
    const wide = plan(
      generateSurveyGrid(baseInput({ camera: { ...CAMERA, imageWidthPx: 8000 } }))
    );
    // altitude = 3 × 10 × 8000 / (12 × 100) = 200 m
    expect(wide.altitudeM).toBeCloseTo(200, 6);
    expect(wide.footprintWidthM).toBeCloseTo(240, 6);
    // 12mm/8000px vs 9mm/3000px pixel pitch mismatch is disclosed.
    expect(wide.assumptions.some((a) => /non-square pixels/i.test(a))).toBe(true);
  });

  it("speed and the turn allowance drive duration (both varied)", () => {
    const noTurnBudget = plan(generateSurveyGrid(baseInput({ turnAllowanceSeconds: 0 })));
    expect(noTurnBudget.estimatedDurationSeconds).toBeCloseTo(392.5, 1);
    const slow = plan(generateSurveyGrid(baseInput({ speedMps: 4 })));
    expect(slow.estimatedDurationSeconds).toBeCloseTo(3140 / 4 + 70, 1);
    // The default allowance is a stated, exported value — not zero, not hidden.
    expect(DEFAULT_TURN_ALLOWANCE_SECONDS).toBeGreaterThan(0);
    const defaulted = plan(generateSurveyGrid(baseInput({ turnAllowanceSeconds: undefined })));
    expect(defaulted.estimatedDurationSeconds).toBeCloseTo(
      392.5 + 7 * DEFAULT_TURN_ALLOWANCE_SECONDS,
      1
    );
  });
});

describe("generateSurveyGrid — corridor mode", () => {
  const corridorInput = baseInput({
    aoiRing: undefined,
    boundaryMarginM: 0,
    corridor: { centerline: [pt(-250, 0), pt(250, 0)], widthM: 60 },
  });
  const corridor = plan(generateSurveyGrid(corridorInput));

  it("buffers the centerline and flies along it (hand-derived: 3 lines × 560 m)", () => {
    // Half-width 30 m with square caps extends the 500 m line to 560 m;
    // width 60 → ceil(60/42) + 1 = 3 lines, evenly 30 m apart.
    expect(corridor.flightAxisDeg).toBeCloseTo(90, 3);
    expect(corridor.lineCount).toBe(3);
    expect(corridor.coverageAreaM2).toBeCloseTo(560 * 60, 0);
    for (const line of corridor.lines) {
      expect(line.lengthM).toBeCloseTo(560, 1);
      // Along the E–W centerline: latitude constant on each line…
      expect(Math.abs(line.start[1] - line.end[1]) * M_PER_DEG_LAT).toBeLessThan(0.1);
      // …and every line inside the 60 m corridor.
      expect(Math.abs(line.start[1] - LAT0) * M_PER_DEG_LAT).toBeLessThanOrEqual(30.5);
      // photos: ceil(560/22.5) + 1 = 26
      expect(line.photoPoints).toHaveLength(26);
    }
  });

  it("refuses a corridor with no width or no usable centerline", () => {
    expect(
      refusal(
        generateSurveyGrid({
          ...corridorInput,
          corridor: { centerline: [pt(-250, 0), pt(250, 0)], widthM: 0 },
        })
      ).reason
    ).toBe("invalid_corridor");
    expect(
      refusal(
        generateSurveyGrid({
          ...corridorInput,
          corridor: { centerline: [pt(0, 0), pt(0, 0)], widthM: 60 },
        })
      ).reason
    ).toBe("invalid_corridor");
  });
});

describe("generateSurveyGrid — cross grid", () => {
  it("adds a perpendicular pass set with its own hand-derived counts", () => {
    const crossed = plan(generateSurveyGrid(baseInput({ crossGrid: true })));
    // Primary 8 lines (as derived) + cross ceil(360/42)+1 = 10 lines of 260 m
    // with ceil(260/22.5)+1 = 13 photos each.
    expect(crossed.lineCount).toBe(18);
    expect(crossed.photoCount).toBe(136 + 10 * 13);
    const primary = crossed.lines.filter((line) => line.grid === "primary");
    const cross = crossed.lines.filter((line) => line.grid === "cross");
    expect(primary).toHaveLength(8);
    expect(cross).toHaveLength(10);
    for (const line of cross) {
      expect(Math.abs(line.start[0] - line.end[0]) * M_PER_DEG_LON).toBeLessThan(0.1);
      expect(line.lengthM).toBeCloseTo(260, 1);
    }
  });
});

describe("generateSurveyGrid — honest refusals, never an empty grid", () => {
  it("refuses an AOI smaller than one photo footprint, naming the footprint", () => {
    const tiny = refusal(generateSurveyGrid(baseInput({ aoiRing: rectRing(50, 50), boundaryMarginM: 0 })));
    expect(tiny.reason).toBe("aoi_smaller_than_one_footprint");
    expect(tiny.message).toMatch(/footprint/i);
    expect(tiny.message.length).toBeGreaterThan(20);
  });

  it("refuses a margin that consumes the area", () => {
    const eaten = refusal(generateSurveyGrid(baseInput({ boundaryMarginM: 200 })));
    expect(eaten.reason).toBe("margin_consumes_aoi");
  });

  it("refuses ambiguous or missing GSD/altitude", () => {
    expect(refusal(generateSurveyGrid(baseInput({ altitudeM: 100 }))).reason).toBe(
      "invalid_gsd_altitude"
    );
    expect(
      refusal(generateSurveyGrid(baseInput({ targetGsdCm: undefined }))).reason
    ).toBe("invalid_gsd_altitude");
    expect(refusal(generateSurveyGrid(baseInput({ targetGsdCm: -1 }))).reason).toBe(
      "invalid_gsd_altitude"
    );
  });

  it("refuses out-of-range overlaps, speed, margin, battery, and turn allowance", () => {
    expect(refusal(generateSurveyGrid(baseInput({ frontOverlapPct: 100 }))).reason).toBe("invalid_overlap");
    expect(refusal(generateSurveyGrid(baseInput({ sideOverlapPct: -5 }))).reason).toBe("invalid_overlap");
    expect(refusal(generateSurveyGrid(baseInput({ speedMps: 0 }))).reason).toBe("invalid_speed");
    expect(refusal(generateSurveyGrid(baseInput({ boundaryMarginM: -1 }))).reason).toBe("invalid_margin");
    expect(refusal(generateSurveyGrid(baseInput({ flightMinutesPerBattery: 0 }))).reason).toBe("invalid_battery");
    expect(refusal(generateSurveyGrid(baseInput({ turnAllowanceSeconds: -1 }))).reason).toBe("invalid_turn_allowance");
  });

  it("refuses a broken camera and a degenerate ring", () => {
    expect(
      refusal(generateSurveyGrid(baseInput({ camera: { ...CAMERA, focalLengthMm: 0 } }))).reason
    ).toBe("invalid_camera");
    expect(
      refusal(generateSurveyGrid(baseInput({ aoiRing: [pt(0, 0), pt(100, 0)] }))).reason
    ).toBe("invalid_aoi");
    expect(
      refusal(generateSurveyGrid(baseInput({ aoiRing: [pt(0, 0), pt(100, 0), pt(200, 0)] }))).reason
    ).toBe("invalid_aoi");
  });

  it("refuses when both an AOI and a corridor are supplied", () => {
    expect(
      refusal(
        generateSurveyGrid(
          baseInput({ corridor: { centerline: [pt(-250, 0), pt(250, 0)], widthM: 60 } })
        )
      ).reason
    ).toBe("ambiguous_area");
  });

  it("every refusal carries a planner-voice message; every plan has lines", () => {
    const refusals = [
      generateSurveyGrid(baseInput({ aoiRing: rectRing(50, 50), boundaryMarginM: 0 })),
      generateSurveyGrid(baseInput({ boundaryMarginM: 200 })),
      generateSurveyGrid(baseInput({ speedMps: 0 })),
    ];
    for (const result of refusals) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message.trim().length).toBeGreaterThan(0);
    }
    const good = generateSurveyGrid(baseInput());
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.lines.length).toBeGreaterThan(0);
  });
});
