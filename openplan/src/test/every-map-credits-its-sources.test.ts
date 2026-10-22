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
  constructs a Mapbox or MapLibre map and requires the credit to be on: either
  the default control left alone, or an AttributionControl added by hand.

  A constructor is `new <namespace>.Map(` under any namespace name, because the
  public engagement map builds through a `gl` parameter that is either library,
  or a `Map` imported by name from mapbox-gl or maplibre-gl. Until 2026-10-12
  only `new mapboxgl.Map(` counted, and the public map was never checked.

  Blind categories: a map built by a library other than these two, a library
  namespace reached through globalThis or window, a control added and then
  hidden by CSS, and attribution removed at runtime.
*/
const ROOT = path.join(process.cwd(), "src");
// `globalThis.Map` and its kin are the JavaScript Map collection, not a map.
const NAMESPACED_MAP_CONSTRUCTOR = /\bnew\s+(?!(?:globalThis|window|self|global)\.Map\()(?:[A-Za-z_$][\w$]*\.)+Map\(/;
const NAMED_MAP_IMPORT = /\bimport\s*\{[^}]*\bMap\b[^}]*\}\s*from\s*["'](?:mapbox-gl|maplibre-gl)["']/;
const ATTRIBUTION_ADDED = /addControl\(\s*new\s+(?:[A-Za-z_$][\w$]*\.)*AttributionControl\(/;

function constructsMap(source: string): boolean {
  return NAMESPACED_MAP_CONSTRUCTOR.test(source) || NAMED_MAP_IMPORT.test(source);
}

/** True when the source turns the default credit off and never adds one back. */
function dropsAttribution(source: string): boolean {
  return /attributionControl:\s*false/.test(source) && !ATTRIBUTION_ADDED.test(source);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const mapFiles = sourceFiles(ROOT).filter((file) => constructsMap(readFileSync(file, "utf8")));

describe("every map credits its sources", () => {
  it("finds the maps it is meant to check", () => {
    // Fifteen map files on October 12, 2026. Fewer means the pattern stopped matching.
    expect(mapFiles.length).toBeGreaterThanOrEqual(14);
    expect(mapFiles.map((file) => path.relative(ROOT, file))).toContain(
      path.join("components", "engagement", "public-map-stage.tsx")
    );
  });

  it.each(mapFiles.map((file) => [path.relative(process.cwd(), file)]))("%s keeps attribution on", (file) => {
    const source = readFileSync(file, "utf8");
    expect(dropsAttribution(source), `${file} turns attribution off and never adds it back`).toBe(false);
  });

  // Seeded controls: the namespace and library forms the guard must see, and
  // the JavaScript Map collection it must not mistake for a map.
  it("sees every map constructor form, and flags one that drops the credit", () => {
    const silentGl = "const map = new gl.Map({ container, attributionControl: false });";
    expect(constructsMap(silentGl)).toBe(true);
    expect(dropsAttribution(silentGl)).toBe(true);
    expect(dropsAttribution(`${silentGl}\nmap.addControl(new gl.AttributionControl({ compact: true }));`)).toBe(false);

    const silentLibre = "const map = new maplibregl.Map({ container, attributionControl: false });";
    expect(constructsMap(silentLibre)).toBe(true);
    expect(dropsAttribution(silentLibre)).toBe(true);

    const namedImport = 'import { Map as LibreMap } from "maplibre-gl";\nnew LibreMap({ container });';
    expect(constructsMap(namedImport)).toBe(true);

    expect(constructsMap("const byId = new Map(rows.map((row) => [row.id, row]));")).toBe(false);
    expect(constructsMap("const summary = new globalThis.Map(entries);")).toBe(false);
  });
});
