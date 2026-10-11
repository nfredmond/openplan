import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
  EVERY MAP CREDITS ITS SOURCES.

  Mapbox's terms and the OpenStreetMap licence both require attribution on
  the map. Every OpenPlan map that turns the default control off
  (`attributionControl: false`) does so to add a compact one in a corner it
  chooses, and the October 1, 2026 review found seven that turned it off and
  added nothing (finding M2). This walks the source for every file that
  constructs a Mapbox map and requires the credit to be on: either the default
  control left alone, or an AttributionControl added by hand.

  Blind categories: a map built by a library other than mapbox-gl, a control
  added and then hidden by CSS, and attribution removed at runtime.
*/
const ROOT = path.join(process.cwd(), "src");
const MAP_CONSTRUCTOR = /new\s+mapboxgl\.Map\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const mapFiles = sourceFiles(ROOT).filter((file) => MAP_CONSTRUCTOR.test(readFileSync(file, "utf8")));

describe("every map credits its sources", () => {
  it("finds the maps it is meant to check", () => {
    // Fourteen maps on October 10, 2026. Fewer means the pattern stopped matching.
    expect(mapFiles.length).toBeGreaterThanOrEqual(12);
  });

  it.each(mapFiles.map((file) => [path.relative(process.cwd(), file)]))("%s keeps attribution on", (file) => {
    const source = readFileSync(file, "utf8");
    const turnedOff = /attributionControl:\s*false/.test(source);
    const addedBack = /addControl\(\s*new\s+mapboxgl\.AttributionControl\(/.test(source);
    expect(turnedOff && !addedBack, `${file} turns attribution off and never adds it back`).toBe(false);
  });
});
