import { describe, expect, it } from "vitest";

import {
  DEMO_CORRIDOR_SR49,
  DEMO_CORRIDOR_EMPIRE_ST,
} from "../../scripts/seed-nctc-demo";
import { isCorridorLineGeoJson } from "@/lib/cartographic/corridor-line-geojson";

describe("NCTC demo corridors", () => {
  it("SR-49 LineString passes the application-layer geometry guard", () => {
    expect(isCorridorLineGeoJson(DEMO_CORRIDOR_SR49)).toBe(true);
    expect(DEMO_CORRIDOR_SR49.coordinates.length).toBeGreaterThanOrEqual(2);
  });

  it("Empire St LineString passes the application-layer geometry guard", () => {
    expect(isCorridorLineGeoJson(DEMO_CORRIDOR_EMPIRE_ST)).toBe(true);
    expect(DEMO_CORRIDOR_EMPIRE_ST.coordinates.length).toBeGreaterThanOrEqual(2);
  });

  it("both corridors stay inside the WGS84 range and anchor near Grass Valley", () => {
    for (const corridor of [DEMO_CORRIDOR_SR49, DEMO_CORRIDOR_EMPIRE_ST]) {
      for (const [lng, lat] of corridor.coordinates) {
        expect(lng).toBeGreaterThan(-122);
        expect(lng).toBeLessThan(-120);
        expect(lat).toBeGreaterThan(38);
        expect(lat).toBeLessThan(40);
      }
    }
  });
});
