import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";

/**
 * NOTHING IS HARDCODED — applied to map framing.
 *
 * Every map surface in the app used to open on [-121.033982, 39.239137]
 * (Grass Valley, CA — the pilot town) at county-scale zoom, duplicated as a
 * literal in eight separate files with no shared source. A planner in Ohio,
 * Lagos, or Lisbon opened an empty map a thousand miles from their work and
 * had no way to change it without a code change.
 *
 * The rule these tests enforce: a map frames real geography it already has —
 * its own features, a passed-in extent, a fitBounds over its own data — and
 * falls back to the shared neutral CONTINENTAL_US_CENTER at a wide zoom. Never
 * to a town.
 */

const SRC_ROOT = path.join(process.cwd(), "src");

// Files that carried the duplicated default. Each is asserted individually so
// a failure names the surface that regressed rather than "somewhere in src".
const MAP_SURFACES = [
  "components/cartographic/cartographic-map-backdrop.tsx",
  "app/(app)/explore/_components/use-explore-map-instance.ts",
  "components/engagement/location-picker-map.tsx",
  "components/engagement/location-display-map.tsx",
  "components/engagement/participation-heatmap-map.tsx",
  "components/models/traffic-volume-map.tsx",
  "components/safety/safety-crash-map.tsx",
  "components/aerial/mission-aoi-editor.tsx",
  // Fixed earlier in the same effort; kept here so the whole set stays covered.
  "components/engagement/geometry-picker-map.tsx",
];

// The exact literals that were duplicated. Longitude and latitude are checked
// separately so a reformat (line break, array spread) cannot smuggle one back.
const HARDCODED_PLACE_LITERALS = ["-121.033982", "39.239137", "-121.0, 39.2"];

function readSource(relativePath: string): string {
  return readFileSync(path.join(SRC_ROOT, relativePath), "utf8");
}

/** Every .ts/.tsx file under src/, excluding the test suite itself. */
function walkSourceFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test") continue;
      walkSourceFiles(full, collected);
    } else if (/\.tsx?$/.test(entry.name)) {
      collected.push(full);
    }
  }
  return collected;
}

describe("map default centering", () => {
  it.each(MAP_SURFACES)("%s does not hardcode the pilot town", (relativePath) => {
    const source = readSource(relativePath);
    for (const literal of HARDCODED_PLACE_LITERALS) {
      expect(source).not.toContain(literal);
    }
  });

  it.each(MAP_SURFACES)("%s falls back to the shared neutral center", (relativePath) => {
    expect(readSource(relativePath)).toContain("CONTINENTAL_US_CENTER");
  });

  it("keeps the neutral fallback neutral", () => {
    // Geographic center of the continental US — deliberately not a town, and
    // ~2,000 km from the pilot's coordinates.
    expect(CONTINENTAL_US_CENTER).toEqual([-98.5795, 39.8283]);
    expect(Math.abs(CONTINENTAL_US_CENTER[0] - -121.033982)).toBeGreaterThan(20);
  });

  it("keeps every map surface honest, not just the ones fixed by hand", () => {
    // Repo-wide guard: a new map added next year must not reintroduce the
    // pattern. Test fixtures legitimately use pilot coordinates as sample
    // data, so src/test is excluded — this covers application source only.
    const offenders = walkSourceFiles(SRC_ROOT)
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return HARDCODED_PLACE_LITERALS.some((literal) => source.includes(literal));
      })
      .map((file) => path.relative(SRC_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
