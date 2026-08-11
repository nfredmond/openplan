/**
 * The banding profiles are pure year arithmetic, and the schema will refuse
 * what they get wrong (inclusive-range exclusion, unique labels, year order) —
 * at scaffold time, in front of a planner. These tests pin the arithmetic so
 * the refusal never gets the chance.
 */
import { describe, expect, it } from "vitest";

import {
  HORIZON_BANDING_PROFILE_KEYS,
  HORIZON_BANDING_PROFILES,
} from "@/lib/rtp/horizon-banding-profiles";

describe("horizon banding profiles", () => {
  it("pins the derived bands for a 2026–2050 horizon, per profile", () => {
    expect(HORIZON_BANDING_PROFILES.near_term_then_outyears.computeBands(2026, 2050)).toEqual([
      { label: "2026–2035", startYear: 2026, endYear: 2035 },
      { label: "2036–2050", startYear: 2036, endYear: 2050 },
    ]);

    expect(HORIZON_BANDING_PROFILES.five_year_periods.computeBands(2026, 2050)).toEqual([
      { label: "2026–2030", startYear: 2026, endYear: 2030 },
      { label: "2031–2035", startYear: 2031, endYear: 2035 },
      { label: "2036–2040", startYear: 2036, endYear: 2040 },
      { label: "2041–2045", startYear: 2041, endYear: 2045 },
      { label: "2046–2050", startYear: 2046, endYear: 2050 },
    ]);

    expect(HORIZON_BANDING_PROFILES.single_period.computeBands(2026, 2050)).toEqual([
      { label: "2026–2050", startYear: 2026, endYear: 2050 },
    ]);
  });

  it("covers a short horizon without inventing out-years", () => {
    // A 6-year horizon: the near-term band absorbs everything; no second band.
    expect(HORIZON_BANDING_PROFILES.near_term_then_outyears.computeBands(2026, 2031)).toEqual([
      { label: "2026–2031", startYear: 2026, endYear: 2031 },
    ]);
    // A horizon that does not divide by five ends with a shorter final period.
    expect(HORIZON_BANDING_PROFILES.five_year_periods.computeBands(2026, 2032)).toEqual([
      { label: "2026–2030", startYear: 2026, endYear: 2030 },
      { label: "2031–2032", startYear: 2031, endYear: 2032 },
    ]);
    // A single-year horizon is one single-year band with a single-year label.
    expect(HORIZON_BANDING_PROFILES.single_period.computeBands(2030, 2030)).toEqual([
      { label: "2030", startYear: 2030, endYear: 2030 },
    ]);
  });

  it("holds the schema's invariants across a sweep of horizons, every profile", () => {
    // The three rules the database enforces with refusals: no shared years
    // (inclusive-range exclusion), unique labels, ordered years — plus the
    // fiscal engine's: the bands cover the declared horizon with no gaps.
    for (const key of HORIZON_BANDING_PROFILE_KEYS) {
      const profile = HORIZON_BANDING_PROFILES[key];
      for (let span = 0; span <= 40; span += 1) {
        const start = 2026;
        const end = start + span;
        const bands = profile.computeBands(start, end);

        expect(bands.length, `${key} ${start}-${end}`).toBeGreaterThan(0);
        expect(bands[0].startYear, `${key} ${start}-${end} starts at horizon`).toBe(start);
        expect(bands[bands.length - 1].endYear, `${key} ${start}-${end} ends at horizon`).toBe(end);

        const labels = new Set(bands.map((band) => band.label));
        expect(labels.size, `${key} ${start}-${end} unique labels`).toBe(bands.length);

        for (let index = 0; index < bands.length; index += 1) {
          const band = bands[index];
          expect(band.endYear, `${key} ${start}-${end} band ${index} ordered`).toBeGreaterThanOrEqual(
            band.startYear
          );
          if (index > 0) {
            // Meet at year N / year N+1: no shared year, no gap.
            expect(
              band.startYear,
              `${key} ${start}-${end} band ${index} adjacency`
            ).toBe(bands[index - 1].endYear + 1);
          }
        }
      }
    }
  });

  it("emits no escalation field at all — there is nothing for a caller to forward", () => {
    // The scaffold's escalation-NULL invariant starts here: a profile band is
    // three fields, so even a route that tried to forward an escalation year
    // from the profile would find none to forward.
    const band = HORIZON_BANDING_PROFILES.single_period.computeBands(2026, 2050)[0];
    expect(Object.keys(band).sort()).toEqual(["endYear", "label", "startYear"]);
  });

  it("fails loud on an inverted horizon rather than scaffolding nothing", () => {
    expect(() => HORIZON_BANDING_PROFILES.single_period.computeBands(2050, 2026)).toThrow(
      /Invalid horizon/
    );
  });
});
