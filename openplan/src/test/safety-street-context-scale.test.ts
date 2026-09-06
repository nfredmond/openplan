import { describe, expect, it } from "vitest";
import { renderSafetyStreetContextSvg } from "@/lib/safety/street-context-svg";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SafetyPrintableStreetContext } from "@/components/safety/safety-printable-street-context";

function circles(svg: string) {
  return [...svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)"/g)]
    .map((match) => [Number(match[1]), Number(match[2])]);
}

describe("Safety vector drawings retain geographic proportions", () => {
  it("prints the local-projection limitation outside the screen SVG", () => {
    const html = renderToStaticMarkup(createElement(SafetyPrintableStreetContext, {
      projectName: "Synthetic map fixture", place: null, crashes: [], coverageLimit: "Fixture only",
      roads: [{id: "road", name: "Synthetic road", sourceId: "us-census-tiger-line-cache",
        sourceLabel: "Fixture", vintage: "2025",
        geometry: {type: "LineString", coordinates: [[0, 0], [0.01, 0.01]]}}],
    }));
    expect(html).toContain("<p>Local latitude-adjusted drawing; distances are approximate, not survey-grade.");
  });
  // Synthetic local east/north distances at different latitudes and page shapes.
  it.each([
    [0, 900, 300], [39, 900, 300], [45, 300, 900], [70, 760, 430], [-35, 760, 430],
  ])("uses one ground scale at latitude %s in a %s by %s frame", (latitude, width, height) => {
    const east = 0.01 / Math.cos(latitude * Math.PI / 180);
    const svg = renderSafetyStreetContextSvg({
      roads: [], projectGeometry: null, width, height,
      crashLocations: [[0, latitude], [east, latitude], [0, latitude + 0.01]],
    })!;
    const [origin, eastPoint, northPoint] = circles(svg);
    const eastPixels = eastPoint[0] - origin[0];
    const northPixels = origin[1] - northPoint[1];
    expect(eastPixels / northPixels).toBeCloseTo(1, 2);
    expect(eastPixels).toBeGreaterThan(0);
    expect(northPixels).toBeGreaterThan(0);
    const bar = svg.match(/<line x1="0" y1="0" x2="([\d.]+)"/)!;
    const label = svg.match(/font-size="11">([\d,.]+) (m|km)<\/text>/)!;
    expect(bar).not.toBeNull();
    expect(label).not.toBeNull();
    const meters = Number(label[1].replace(/,/g, "")) * (label[2] === "km" ? 1000 : 1);
    expect(Number(bar[1]) / meters).toBeCloseTo(northPixels / 1113.2, 3);
  });

  it("unwraps a local antimeridian crossing instead of drawing almost the whole world", () => {
    const svg = renderSafetyStreetContextSvg({
      roads: [], projectGeometry: null,
      crashLocations: [[179.99, 0], [-179.99, 0], [179.99, 0.02]],
    })!;
    const [origin, east, north] = circles(svg);
    expect(east[0]).toBeGreaterThan(origin[0]);
    expect((east[0] - origin[0]) / (origin[1] - north[1])).toBeCloseTo(1, 2);
    expect(svg).toContain("500 m</text>");
  });

  it("withholds a single local scale for a broad latitude range", () => {
    const svg = renderSafetyStreetContextSvg({
      roads: [], projectGeometry: null, crashLocations: [[-125, 25], [-65, 50]],
    })!;
    expect(svg).toContain("Scale omitted");
    expect(svg).not.toContain('<line x1="0" y1="0"');
    expect(circles(svg)).toHaveLength(2);
  });

  it("centers a point-only extent without inventing a scale", () => {
    const svg = renderSafetyStreetContextSvg({
      roads: [], projectGeometry: null, crashLocations: [[12, 48]],
    })!;
    expect(circles(svg)).toEqual([[380, 215]]);
    expect(svg).toContain("Scale omitted");
    expect(svg).not.toMatch(/NaN|Infinity|<line x1="0" y1="0"/);
  });

  it.each([[0.000001, "0.02 m"], [0.000000001, "0.00002 m"]] as const)("keeps the scale within the frame at %s degrees and labels %s", (span, label) => {
    const svg = renderSafetyStreetContextSvg({
      roads: [], projectGeometry: null, crashLocations: [[0, 0], [span, span]],
    })!;
    const bar = Number(svg.match(/<line x1="0" y1="0" x2="([\d.]+)"/)![1]);
    expect(bar).toBeGreaterThan(0);
    expect(bar).toBeLessThan(176);
    expect(svg).toContain(`${label}</text>`);
  });

  it.each([[NaN, 0], [0, Infinity], [0, 91], [181, 0]])("does not draw invalid coordinates %s %s", (lon, lat) => {
    expect(renderSafetyStreetContextSvg({roads: [], projectGeometry: null, crashLocations: [[lon, lat]]})).toBeNull();
  });

  it.each([[NaN, 430], [760, Infinity], [50, 430], [760, 50]])("does not draw into an invalid frame %s %s", (width, height) => {
    expect(renderSafetyStreetContextSvg({roads: [], projectGeometry: null, crashLocations: [[0, 0]], width, height})).toBeNull();
  });
});
