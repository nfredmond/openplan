import { describe, expect, it } from "vitest";

import { runABM, DEFAULT_ABM_SEED } from "@/lib/models/sketch-abm/abm-runner";
import { buildSketchAbmInputs } from "@/lib/models/sketch-abm/sketch-abm-inputs";
import { createSeededRandom } from "@/lib/models/sketch-abm/rng";
import type { ABMInputs } from "@/lib/models/sketch-abm/types";

/** Build a small but non-degenerate ABM input via the real builder (produces
 * skims etc.), so the reproducibility assertions run real trips through. */
function buildInputs(): ABMInputs {
  const censusTracts = [
    { geoid: "06057000100", population: 4000, totalHouseholds: 1600, lon: -121.05, lat: 39.23, areaSqKm: 6 },
    { geoid: "06057000200", population: 3000, totalHouseholds: 1200, lon: -121.02, lat: 39.26, areaSqKm: 5 },
    { geoid: "06057000300", population: 2500, totalHouseholds: 1000, lon: -121.08, lat: 39.21, areaSqKm: 7 },
  ];
  const { inputs } = buildSketchAbmInputs({ censusTracts, lodesJobs: { totalJobs: 3500 }, seed: 42 });
  return inputs;
}

describe("sketch ABM reproducibility", () => {
  it("produces identical output for the same seed (same inputs)", async () => {
    const inputs = buildInputs();
    const a = await runABM(inputs, { seed: 12345 });
    const b = await runABM(inputs, { seed: 12345 });
    expect(a.seed).toBe(12345);
    expect(a.trips.length).toBeGreaterThan(0); // non-degenerate
    expect(a.summary).toEqual(b.summary);
    expect(JSON.stringify(a.trips)).toBe(JSON.stringify(b.trips));
  });

  it("diverges for a different seed (the RNG actually drives the run)", async () => {
    const inputs = buildInputs();
    const a = await runABM(inputs, { seed: 1 });
    const b = await runABM(inputs, { seed: 999999 });
    const differs =
      a.summary.total_trips !== b.summary.total_trips ||
      a.summary.total_tours !== b.summary.total_tours ||
      JSON.stringify(a.trips) !== JSON.stringify(b.trips);
    expect(differs).toBe(true);
  });

  it("restores the real Math.random after a seeded run", async () => {
    const before = Math.random;
    await runABM(buildInputs(), { seed: DEFAULT_ABM_SEED });
    expect(Math.random).toBe(before);
  });

  it("createSeededRandom reproduces its sequence for a given seed", () => {
    const first = createSeededRandom(20260718);
    const second = createSeededRandom(20260718);
    const a0 = first();
    const a1 = first();
    expect(a0).toBeGreaterThanOrEqual(0);
    expect(a0).toBeLessThan(1);
    expect(a0).not.toBe(a1);
    expect(second()).toBe(a0);
    expect(second()).toBe(a1);
  });
});
