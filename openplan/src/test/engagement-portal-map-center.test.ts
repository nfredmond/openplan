import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { derivePortalMapCenter } from "@/components/engagement/public-engagement-portal";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";

/**
 * The public engagement portal is the resident-facing, embeddable surface — an
 * agency puts it on their own website. It previously fell through to a shared
 * map default of [-121.033982, 39.239137], so residents in Columbus or Austin
 * opened their agency's public-input map on rural California.
 */
describe("public engagement portal map centering", () => {
  it("centers on the campaign's own approved submissions", () => {
    const view = derivePortalMapCenter([
      { latitude: 39.96, longitude: -83.0 }, // Columbus, OH
      { latitude: 40.0, longitude: -82.9 },
    ]);
    expect(view).not.toBeNull();
    expect(view!.center[0]).toBeCloseTo(-82.95, 2);
    expect(view!.center[1]).toBeCloseTo(39.98, 2);
  });

  it("returns null for a brand-new campaign so the map opens neutrally", () => {
    // A campaign with no pins yet must not inherit anyone else's town.
    expect(derivePortalMapCenter([])).toBeNull();
    expect(derivePortalMapCenter([{ latitude: null, longitude: null }])).toBeNull();
  });

  it("ignores unusable coordinates rather than centering on NaN", () => {
    const view = derivePortalMapCenter([
      { latitude: Number.NaN, longitude: -83.0 },
      { latitude: 30.27, longitude: -97.74 }, // Austin, TX
    ]);
    expect(view!.center).toEqual([-97.74, 30.27]);
  });

  it("scales zoom to the spread of input, from citywide to a single intersection", () => {
    const wide = derivePortalMapCenter([
      { latitude: 33.0, longitude: -118.0 },
      { latitude: 38.0, longitude: -122.0 },
    ]);
    const tight = derivePortalMapCenter([
      { latitude: 39.2391, longitude: -121.034 },
      { latitude: 39.2395, longitude: -121.0335 },
    ]);
    expect(wide!.zoom).toBeLessThan(tight!.zoom);
  });

  it("no longer hardcodes a place as the shared map default", () => {
    // Regression guard on the source itself: the default must be the neutral
    // continental view, not a town.
    const source = readFileSync(
      path.join(process.cwd(), "src/components/engagement/geometry-picker-map.tsx"),
      "utf8"
    );
    expect(source).toContain("initialCenter = CONTINENTAL_US_CENTER");
    expect(source).not.toContain("-121.033982");
    expect(CONTINENTAL_US_CENTER).toEqual([-98.5795, 39.8283]);
  });
});
