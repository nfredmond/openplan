import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import {
  NO_DATA_FILL_COLOR,
  TRACT_MEASURE_CLASSES,
  tractMeasureLegend,
  tractMeasurePaint,
  type TractMeasureKey,
} from "@/lib/cartographic/tract-measure-classes";

const { expression: styleExpression } = createRequire(import.meta.url)(
  "mapbox-gl/dist/style-spec/index.cjs",
) as typeof import("mapbox-gl/dist/style-spec");

/**
 * A census tract's colour on the map is exactly a colour in its legend.
 *
 * Evaluated with Mapbox's own style-expression engine. The ramps used to blend
 * between stops while the legend listed classes, so a tract matched a legend
 * swatch only at the exact break values; poverty also ran green to red.
 *
 * Blind category: no rendering, so contrast against the basemap at the layer's
 * fill opacity is not measured here.
 */
function paintFor(key: TractMeasureKey, value: number | null) {
  const compiled = styleExpression.createExpression(tractMeasurePaint(key) as never);
  if (compiled.result !== "success") throw new Error(JSON.stringify(compiled.value));
  return compiled.value.evaluate({ zoom: 10 }, { properties: { [key]: value } } as never);
}

const KEYS = Object.keys(TRACT_MEASURE_CLASSES) as TractMeasureKey[];

describe("tract measure classes", () => {
  it.each(KEYS)("%s paints each legend class at both edges of the class", (key) => {
    const classes = TRACT_MEASURE_CLASSES[key];
    for (const [index, entry] of classes.entries()) {
      const next = classes[index + 1];
      const top = next ? next.from - (next.from - entry.from) / 100 : entry.from * 2 + 1;
      expect(paintFor(key, entry.from), `${key} at ${entry.from}`).toBe(entry.color);
      expect(paintFor(key, top), `${key} at ${top}`).toBe(entry.color);
    }
  });

  it.each(KEYS)("%s draws missing as grey and a measured zero in the lowest class", (key) => {
    expect(paintFor(key, null)).toBe(NO_DATA_FILL_COLOR);
    expect(paintFor(key, 0)).toBe(TRACT_MEASURE_CLASSES[key][0].color);
    expect(TRACT_MEASURE_CLASSES[key][0].color).not.toBe(NO_DATA_FILL_COLOR);
  });

  it("lists exactly the painted classes in the legend, then No data", () => {
    for (const key of KEYS) {
      const legend = tractMeasureLegend(key);
      expect(legend.slice(0, -1)).toEqual(TRACT_MEASURE_CLASSES[key].map(({ label, color }) => ({ label, color })));
      expect(legend.at(-1)).toEqual({ label: "No data", color: NO_DATA_FILL_COLOR });
    }
  });

  it("is one hue, getting brighter, with no red or green", () => {
    const hsl = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return { h: (h * 60 + 360) % 360, l: (max + min) / 2 };
    };
    for (const key of KEYS) {
      const colours = TRACT_MEASURE_CLASSES[key].map((entry) => hsl(entry.color));
      for (const { h } of colours) {
        expect(h).toBeGreaterThan(250);
        expect(h).toBeLessThan(290);
      }
      for (let index = 1; index < colours.length; index += 1) {
        expect(colours[index].l).toBeGreaterThan(colours[index - 1].l);
      }
    }
  });
});
