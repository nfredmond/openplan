import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpressionSpecification } from "mapbox-gl";

const fetchJson = vi.hoisted(() => vi.fn());
vi.mock("@/lib/data-sources/http", () => ({ fetchJsonWithRetry: fetchJson }));
import { fetchAcsForCounties } from "@/lib/data-sources/census";
import { fetchTractOverlayFeatures } from "@/lib/data-sources/census-geometry";
import { buildThematicOverlayPaintExpression, NO_DATA_FILL_COLOR } from "@/app/(app)/explore/_components/_helpers";
import { buildTractMetricPaintExpression } from "@/app/(app)/explore/_components/explore-tract-layer-state";

const { expression, latest } = createRequire(import.meta.url)("mapbox-gl/dist/style-spec/index.cjs") as typeof import("mapbox-gl/dist/style-spec");
const bbox = { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 };
const geography = { state: "99", county: "999", tract: "000100" }; // Synthetic adapter identifiers.
const counts: Record<string, string> = {
  B01003_001E: "100", B19013_001E: "0", B03002_001E: "100", B03002_003E: "100",
  B17001_001E: "100", B17001_002E: "0", B25044_001E: "100", B25044_003E: "0", B25044_010E: "0",
  B08301_001E: "100", B08301_010E: "0",
};
function paint(spec: ExpressionSpecification, properties: Record<string, unknown>): unknown {
  const compiled = expression.createExpression(spec, latest.paint_fill["fill-color"]);
  if (compiled.result !== "success") throw new Error(JSON.stringify(compiled.value));
  return compiled.value.evaluate({ zoom: 0 }, { type: "Polygon", properties });
}
const noData = () => paint(["literal", NO_DATA_FILL_COLOR], {});
async function readOverlay(overrides: Record<string, string | undefined> = {}) {
  const record = { ...counts, ...geography, ...overrides };
  const fields = Object.entries(record).filter(([, value]) => value !== undefined);
  fetchJson.mockResolvedValueOnce([fields.map(([key]) => key), fields.map(([, value]) => value)]);
  const [tract] = await fetchAcsForCounties([geography]);
  fetchJson.mockResolvedValueOnce({ features: [{
    type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    properties: { GEOID: tract.geoid },
  }] });
  const [feature] = await fetchTractOverlayFeatures(bbox, [tract]);
  return { tract, properties: feature.properties! };
}
beforeEach(() => fetchJson.mockReset());

describe("ACS source availability survives into map paint", () => {
  it("retains measured zero for every numeric overlay and distinguishes zero income from missing income", async () => {
    const { properties } = await readOverlay();
    for (const key of ["pctMinority", "pctBelowPoverty", "zeroVehiclePct", "transitCommutePct", "medianIncome"]) {
      expect(properties[key], key).toBe(0);
      expect(paint(buildThematicOverlayPaintExpression(key), properties), key).not.toEqual(noData());
    }
    for (const metric of ["minority", "poverty", "income"] as const) expect(paint(buildTractMetricPaintExpression(metric), properties)).not.toEqual(noData());
    const missing = await readOverlay({ B19013_001E: "-666666666" });
    expect(missing.properties.medianIncome).toBeNull();
    expect(paint(buildThematicOverlayPaintExpression("medianIncome"), missing.properties)).toEqual(noData());
    expect(paint(buildTractMetricPaintExpression("income"), missing.properties)).toEqual(noData());
  });

  it.each([
    ["pctMinority", "B03002_003E", "B03002_001E"],
    ["pctBelowPoverty", "B17001_002E", "B17001_001E"],
    ["zeroVehiclePct", "B25044_003E", "B25044_001E"],
    ["zeroVehiclePct", "B25044_010E", "B25044_001E"],
    ["transitCommutePct", "B08301_010E", "B08301_001E"],
  ])("withholds %s when %s or %s is unavailable", async (metric, numerator, denominator) => {
    for (const column of [numerator, denominator]) {
      for (const value of ["-666666666", "", undefined]) {
        const { properties } = await readOverlay({ [column]: value });
        expect(properties[metric], `${metric}/${column}/${value}`).toBeNull();
        expect(paint(buildThematicOverlayPaintExpression(metric), properties)).toEqual(noData());
      }
    }
    const zeroUniverse = await readOverlay({ [denominator]: "0" });
    expect(zeroUniverse.properties[metric]).toBeNull();
    expect(paint(buildThematicOverlayPaintExpression(metric), zeroUniverse.properties)).toEqual(noData());
  });

  it("withholds only the unavailable field and keeps legacy raw-count interfaces", async () => {
    const { tract, properties } = await readOverlay({ B17001_002E: "-666666666" });
    expect(tract.popBelowPoverty).toBe(0);
    expect(tract.pctBelowPoverty).toBe(0);
    expect(properties.pctBelowPoverty).toBeNull();
    expect(properties.pctMinority).toBe(0);
    expect(properties.zeroVehiclePct).toBe(0);
    expect(properties.transitCommutePct).toBe(0);
    const { overlayAvailability: _availability, ...legacy } = tract;
    fetchJson.mockResolvedValueOnce({ features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { GEOID: tract.geoid } }] });
    const [feature] = await fetchTractOverlayFeatures(bbox, [legacy]);
    expect(feature.properties?.pctBelowPoverty).toBe(0);
  });
});
