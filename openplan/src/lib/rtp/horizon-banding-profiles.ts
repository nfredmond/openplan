/**
 * Horizon banding profiles — how a plan's declared horizon splits into
 * escalation periods when the agency asks for a scaffold.
 *
 * WHY A REGISTRY AND NOT A FORM. This module exists for exactly one write
 * path: `POST /api/rtp-cycles/[id]/horizon-bands/from-cycle-horizon`, the one
 * band-creation shape the 2026-08-05 analysis permitted an agent to propose.
 * That shape is safe only because NOTHING in its payload is authored — the
 * years come from the cycle's own declared horizon, the labels from those
 * years, and the profile is a KEY into this closed registry. A profile is
 * therefore a pure function from a horizon to periods, with no field for
 * anyone — planner or agent — to slip a year into.
 *
 * WHY EVERY PROFILE IS JURISDICTION-NEUTRAL. Nathaniel's recorded domain
 * decision (2026-08-05) is that horizon bands are AGENCY-DEFINED — he
 * rejected a fixed two-band scheme — so a profile only scaffolds rows the
 * agency then edits, renames, or deletes in the band editor; it never locks a
 * shape in. The ten-year split in `near_term_then_outyears` has a US federal
 * anchor (23 CFR 450.324(f)(11)(v) — noted on the table's own migration
 * comment), but the profile is named for what it DOES, not for the statute,
 * because the statute is an anchor and not a universal (non-negotiable #0:
 * the architecture must not assume the United States).
 *
 * INVARIANTS EVERY PROFILE MUST HOLD, because the schema enforces them with
 * refusals (migrations 20260805000003/000004):
 *   - bands may not share a year (inclusive-range EXCLUSION constraint), so
 *     consecutive bands meet at year N / year N+1;
 *   - labels are unique per cycle, which derived year-range labels satisfy
 *     because the ranges are disjoint;
 *   - together the bands cover the whole declared horizon with no gaps, so
 *     the fiscal engine's `horizon_not_covered` blocker clears.
 * `horizon-banding-profiles.test.ts` asserts all three across a sweep of
 * horizons rather than trusting each implementation.
 */

export type HorizonBandScaffold = {
  /** Derived from the years, e.g. "2026–2035" — never authored. */
  label: string;
  startYear: number;
  endYear: number;
};

export type HorizonBandingProfile = {
  key: HorizonBandingProfileKey;
  /** Shown in the approval sheet and the scaffold offer. */
  label: string;
  description: string;
  computeBands(horizonStartYear: number, horizonEndYear: number): HorizonBandScaffold[];
};

export const HORIZON_BANDING_PROFILE_KEYS = [
  "near_term_then_outyears",
  "five_year_periods",
  "single_period",
] as const;

export type HorizonBandingProfileKey = (typeof HORIZON_BANDING_PROFILE_KEYS)[number];

/** "2026–2035", or "2026" for a single-year band — en dash, no spaces. */
function bandLabel(startYear: number, endYear: number): string {
  return startYear === endYear ? `${startYear}` : `${startYear}–${endYear}`;
}

function scaffold(startYear: number, endYear: number): HorizonBandScaffold {
  return { label: bandLabel(startYear, endYear), startYear, endYear };
}

function assertValidHorizon(startYear: number, endYear: number): void {
  // The rtp_cycles CHECK constraints guarantee both-or-neither and
  // end >= start, so a violation here is a programming error, not user input.
  // Failing loud beats returning [] — an empty scaffold reported as success
  // would read as "profile applied" while writing nothing.
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || endYear < startYear) {
    throw new Error(`Invalid horizon for banding: ${startYear}–${endYear}`);
  }
}

const NEAR_TERM_YEARS = 10;

export const HORIZON_BANDING_PROFILES: Record<HorizonBandingProfileKey, HorizonBandingProfile> = {
  near_term_then_outyears: {
    key: "near_term_then_outyears",
    label: "Near term, then out-years",
    description:
      "A first period covering the first ten years of the horizon (or the whole horizon when it is shorter), then one period for the remaining out-years.",
    computeBands(horizonStartYear, horizonEndYear) {
      assertValidHorizon(horizonStartYear, horizonEndYear);
      const nearTermEnd = Math.min(horizonStartYear + NEAR_TERM_YEARS - 1, horizonEndYear);
      const bands = [scaffold(horizonStartYear, nearTermEnd)];
      if (nearTermEnd < horizonEndYear) {
        bands.push(scaffold(nearTermEnd + 1, horizonEndYear));
      }
      return bands;
    },
  },
  five_year_periods: {
    key: "five_year_periods",
    label: "Five-year periods",
    description:
      "Consecutive five-year periods across the horizon; the final period is shorter when the horizon does not divide evenly.",
    computeBands(horizonStartYear, horizonEndYear) {
      assertValidHorizon(horizonStartYear, horizonEndYear);
      const bands: HorizonBandScaffold[] = [];
      for (let start = horizonStartYear; start <= horizonEndYear; start += 5) {
        bands.push(scaffold(start, Math.min(start + 4, horizonEndYear)));
      }
      return bands;
    },
  },
  single_period: {
    key: "single_period",
    label: "Single period",
    description:
      "One period covering the whole horizon — the smallest honest starting point for a plan that will refine its periods later.",
    computeBands(horizonStartYear, horizonEndYear) {
      assertValidHorizon(horizonStartYear, horizonEndYear);
      return [scaffold(horizonStartYear, horizonEndYear)];
    },
  },
};

export function getHorizonBandingProfile(key: HorizonBandingProfileKey): HorizonBandingProfile {
  return HORIZON_BANDING_PROFILES[key];
}
