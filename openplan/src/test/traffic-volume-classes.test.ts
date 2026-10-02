import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import {
  TRAFFIC_VOLUME_CLASSES,
  trafficVolumeClass,
  trafficVolumeColor,
  trafficVolumeWidth,
} from "@/lib/cartographic/traffic-volume-classes";

const { expression: styleExpression } = createRequire(import.meta.url)(
  "mapbox-gl/dist/style-spec/index.cjs",
) as typeof import("mapbox-gl/dist/style-spec");

/**
 * The traffic volume legend states numbers, so the map must draw exactly those
 * classes. Evaluated with Mapbox's own style-expression engine, not by reading
 * the array, so a malformed `step` fails here rather than on screen.
 *
 * Blind category: no rendering. Line visibility against the basemap is a
 * browser question.
 */
function evaluate(expression: unknown, pce: number | null) {
  const compiled = styleExpression.createExpression(expression as never);
  if (compiled.result !== "success") throw new Error(JSON.stringify(compiled.value));
  return compiled.value.evaluate({ zoom: 10 }, { properties: { pce_tot: pce } } as never);
}

describe("traffic volume classes", () => {
  it("draw each legend class in its own colour and width, at both edges of the class", () => {
    for (const [index, entry] of TRAFFIC_VOLUME_CLASSES.entries()) {
      const next = TRAFFIC_VOLUME_CLASSES[index + 1];
      for (const volume of [entry.from, next ? next.from - 1 : entry.from * 3]) {
        expect(evaluate(trafficVolumeColor(), volume)).toBe(entry.color);
        expect(evaluate(trafficVolumeWidth(), volume)).toBe(entry.width);
        expect(trafficVolumeClass(volume)).toBe(entry);
      }
    }
  });

  it("is fixed: the same volume is the same colour whatever the run's busiest link", () => {
    // There is no input for the run's maximum. A 12,000 PCE road is always class 3.
    expect(trafficVolumeClass(12000).label).toBe("10,000 to 20,000");
  });

  it("ascends, with one colour per class and no red-green pair", () => {
    const froms = TRAFFIC_VOLUME_CLASSES.map((entry) => entry.from);
    expect([...froms].sort((a, b) => a - b)).toEqual(froms);
    expect(new Set(TRAFFIC_VOLUME_CLASSES.map((entry) => entry.color)).size).toBe(TRAFFIC_VOLUME_CLASSES.length);
    for (const entry of TRAFFIC_VOLUME_CLASSES) expect(entry.color).not.toMatch(/#22c55e|#2dd4bf/i);
  });

  it("treats a missing volume as the lowest class rather than failing to draw", () => {
    expect(evaluate(trafficVolumeWidth(), null)).toBe(TRAFFIC_VOLUME_CLASSES[0].width);
  });
});
