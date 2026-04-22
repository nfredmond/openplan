import { describe, expect, it } from "vitest";

import {
  DEMO_AOI_DOWNTOWN,
  DEMO_AOI_EMPIRE_MINE,
  DEMO_AOI_SR49_ALTA_SIERRA,
} from "../../scripts/seed-nctc-demo";
import { isAoiPolygonGeoJson } from "@/lib/aerial/dji-export";

describe("NCTC demo AOI polygons", () => {
  it.each([
    ["DEMO_AOI_DOWNTOWN", DEMO_AOI_DOWNTOWN],
    ["DEMO_AOI_SR49_ALTA_SIERRA", DEMO_AOI_SR49_ALTA_SIERRA],
    ["DEMO_AOI_EMPIRE_MINE", DEMO_AOI_EMPIRE_MINE],
  ])("%s passes isAoiPolygonGeoJson", (_name, polygon) => {
    expect(isAoiPolygonGeoJson(polygon)).toBe(true);
  });

  it.each([
    ["DEMO_AOI_DOWNTOWN", DEMO_AOI_DOWNTOWN],
    ["DEMO_AOI_SR49_ALTA_SIERRA", DEMO_AOI_SR49_ALTA_SIERRA],
    ["DEMO_AOI_EMPIRE_MINE", DEMO_AOI_EMPIRE_MINE],
  ])("%s is a closed ring with at least 4 vertices", (_name, polygon) => {
    const ring = polygon.coordinates[0];
    expect(ring.length).toBeGreaterThanOrEqual(4);
    const first = ring[0];
    const last = ring[ring.length - 1];
    expect(first[0]).toBe(last[0]);
    expect(first[1]).toBe(last[1]);
  });
});
