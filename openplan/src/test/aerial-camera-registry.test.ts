import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMERA_KEY,
  altitudeAglForGsdCmPerPx,
  getCamera,
  gsdCmPerPxAtAltitude,
  hashFlightPlanParams,
  isKnownCameraKey,
  listCameras,
  resolveVerticalProfile,
  type FlightPlanHashInput,
} from "@/lib/aerial/camera-registry";

/**
 * The GSD numbers below are HAND-DERIVED, independently of the code under
 * test, and asserted as exact values — a band assertion ("somewhere between 2
 * and 4 cm") would pass a formula missing its x100 rescale or using the wrong
 * sensor axis, which is precisely the class of error that survives review.
 *
 * Fixture 1 — 1-inch / 20 MP class (13.2 mm sensor width, 5472 px, 8.8 mm
 * lens) at 100 m AGL:
 *     gsd = (13.2 * 100 * 100) / (8.8 * 5472)
 *         = 132,000 / 48,153.6
 *         = 6875 / 2508          (exact fraction, long-divided by hand)
 *         = 2.7412280701754…  cm/px
 * Cross-check: the field rule for this sensor class is "GSD ≈ H / 36.5 cm",
 * i.e. 100 / 36.5 = 2.7397 — the exact divisor is 8.8 * 5472 / 1320 = 36.48.
 *
 * Fixture 2 — full-frame 42 MP / 35 mm (35.9 mm width, 7952 px) at 120 m AGL:
 *     gsd = (35.9 * 120 * 100) / (35 * 7952)
 *         = 430,800 / 278,320
 *         = 5385 / 3479          (exact fraction)
 *         = 1.54785858…  cm/px
 *
 * Inverse fixture — 1-inch class at exactly 2 cm/px:
 *     altitude = (2 * 8.8 * 5472) / (13.2 * 100) = 96,307.2 / 1,320 = 72.96 m
 */
describe("GSD <-> altitude math", () => {
  const oneInch = getCamera("dji-phantom-4-pro")!;
  const fullFrame = getCamera("sony-rx1r-ii-full-frame")!;

  it("computes the hand-derived GSD for the 1-inch class at 100 m", () => {
    expect(gsdCmPerPxAtAltitude(oneInch, 100)).toBeCloseTo(2.7412280701754, 10);
    // And the exact fraction, so the assertion is not a reimplementation:
    expect(gsdCmPerPxAtAltitude(oneInch, 100)).toBeCloseTo(6875 / 2508, 12);
  });

  it("computes the hand-derived GSD for the full-frame 35 mm at 120 m", () => {
    expect(gsdCmPerPxAtAltitude(fullFrame, 120)).toBeCloseTo(1.54785858, 8);
    expect(gsdCmPerPxAtAltitude(fullFrame, 120)).toBeCloseTo(5385 / 3479, 12);
  });

  it("computes the hand-derived altitude for a 2 cm/px target on the 1-inch class", () => {
    expect(altitudeAglForGsdCmPerPx(oneInch, 2)).toBeCloseTo(72.96, 10);
  });

  it("inverts exactly: altitude -> gsd -> altitude round-trips on both cameras", () => {
    for (const camera of [oneInch, fullFrame]) {
      const gsd = gsdCmPerPxAtAltitude(camera, 87.5);
      expect(altitudeAglForGsdCmPerPx(camera, gsd)).toBeCloseTo(87.5, 9);
    }
  });

  it("scales linearly with altitude — double the height, double the GSD", () => {
    expect(gsdCmPerPxAtAltitude(oneInch, 200)).toBeCloseTo(2 * gsdCmPerPxAtAltitude(oneInch, 100), 12);
  });

  it("refuses nonsense inputs rather than returning a plausible number", () => {
    expect(() => gsdCmPerPxAtAltitude(oneInch, 0)).toThrow();
    expect(() => gsdCmPerPxAtAltitude(oneInch, -50)).toThrow();
    expect(() => altitudeAglForGsdCmPerPx(oneInch, 0)).toThrow();
  });
});

describe("resolveVerticalProfile", () => {
  const oneInch = getCamera(DEFAULT_CAMERA_KEY)!;

  it("derives altitude from an authored GSD", () => {
    const profile = resolveVerticalProfile(oneInch, { targetGsdCmPerPx: 2, altitudeAglM: null });
    expect(profile?.basis).toBe("authored_gsd");
    expect(profile?.altitudeAglM).toBeCloseTo(72.96, 10);
    expect(profile?.gsdCmPerPx).toBe(2);
  });

  it("derives GSD from an authored altitude", () => {
    const profile = resolveVerticalProfile(oneInch, { targetGsdCmPerPx: null, altitudeAglM: 100 });
    expect(profile?.basis).toBe("authored_altitude");
    expect(profile?.gsdCmPerPx).toBeCloseTo(6875 / 2508, 12);
  });

  it("keeps the authored altitude and recomputes GSD when both are authored, so a disagreement is visible", () => {
    const profile = resolveVerticalProfile(oneInch, { targetGsdCmPerPx: 5, altitudeAglM: 100 });
    expect(profile?.basis).toBe("authored_both");
    // NOT 5: the recomputed value is what 100 m actually delivers.
    expect(profile?.gsdCmPerPx).toBeCloseTo(6875 / 2508, 12);
  });

  it("answers null when neither is authored — no invented default", () => {
    expect(resolveVerticalProfile(oneInch, { targetGsdCmPerPx: null, altitudeAglM: null })).toBeNull();
  });
});

describe("camera registry", () => {
  it("has a clearly-labelled generic default and no duplicate keys", () => {
    const cameras = listCameras();
    expect(isKnownCameraKey(DEFAULT_CAMERA_KEY)).toBe(true);
    expect(getCamera(DEFAULT_CAMERA_KEY)?.label).toMatch(/generic/i);
    expect(new Set(cameras.map((camera) => camera.key)).size).toBe(cameras.length);
  });

  it("keeps every descriptor physically coherent and sourced", () => {
    for (const camera of listCameras()) {
      expect(camera.sensorWidthMm).toBeGreaterThan(0);
      expect(camera.sensorHeightMm).toBeGreaterThan(0);
      expect(camera.sensorWidthMm).toBeGreaterThan(camera.sensorHeightMm);
      expect(camera.imageWidthPx).toBeGreaterThan(camera.imageHeightPx);
      expect(camera.focalLengthMm).toBeGreaterThan(0);
      expect(camera.specSource.length).toBeGreaterThan(10);
    }
  });

  it("answers null for an unknown key rather than a fallback camera", () => {
    expect(getCamera("no-such-camera")).toBeNull();
    expect(isKnownCameraKey("no-such-camera")).toBe(false);
  });
});

describe("hashFlightPlanParams", () => {
  const base: FlightPlanHashInput = {
    aoiGeojson: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
    cameraKey: DEFAULT_CAMERA_KEY,
    targetGsdCmPerPx: 2,
    altitudeAglM: null,
    frontOverlapPct: 80,
    sideOverlapPct: 70,
    speedMS: 5,
    gimbalPitchDeg: -90,
    crossGrid: false,
    boundaryMarginM: 10,
    corridorWidthM: null,
  };

  it("is deterministic and prefixed with its algorithm", () => {
    const first = hashFlightPlanParams(base);
    expect(first).toBe(hashFlightPlanParams({ ...base }));
    expect(first).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
  });

  it("ignores object key order — the same AOI serialised differently fingerprints identically", () => {
    const reordered = {
      ...base,
      aoiGeojson: { coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]], type: "Polygon" },
    };
    expect(hashFlightPlanParams(reordered)).toBe(hashFlightPlanParams(base));
  });

  it("changes when any geometry-bearing parameter changes", () => {
    const original = hashFlightPlanParams(base);
    expect(hashFlightPlanParams({ ...base, frontOverlapPct: 75 })).not.toBe(original);
    expect(hashFlightPlanParams({ ...base, crossGrid: true })).not.toBe(original);
    expect(hashFlightPlanParams({ ...base, cameraKey: "dji-mavic-3-enterprise-wide" })).not.toBe(original);
  });

  it("changes when the mission AOI changes — redrawing the boundary stales the snapshot", () => {
    const moved = {
      ...base,
      aoiGeojson: { type: "Polygon", coordinates: [[[0, 0], [0, 2], [2, 2], [0, 0]]] },
    };
    expect(hashFlightPlanParams(moved)).not.toBe(hashFlightPlanParams(base));
  });

  it("treats a null AOI as a real, hashable state (a mission with no boundary yet)", () => {
    const noAoi = { ...base, aoiGeojson: null };
    expect(hashFlightPlanParams(noAoi)).toBe(hashFlightPlanParams({ ...noAoi }));
    expect(hashFlightPlanParams(noAoi)).not.toBe(hashFlightPlanParams(base));
  });
});
