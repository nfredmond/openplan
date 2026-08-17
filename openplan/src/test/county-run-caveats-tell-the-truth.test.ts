import { describe, expect, it } from "vitest";

import { getCountyRunCaveats } from "@/lib/models/county-onramp";
import type { CountyOnrampManifest } from "@/lib/models/county-onramp";

/**
 * THE CAVEAT LIST WAS DECIDED BY THE STAGE ALONE, AND IT WENT STALE.
 *
 * `/county-runs/<id>` renders a "Caveats" card whose whole purpose is to travel
 * with any interpretation of the run. Its contents came from a fixed list per
 * stage, which was true when a county run could only do one thing. Two entries
 * became false as the modelling lane grew:
 *
 *  - "Uncalibrated" was shown on runs that HAD been fitted to published traffic
 *    counts — on the same screen as the calibration result. A planner reading
 *    the caveat card learns the opposite of what the run did.
 *  - nothing distinguished a synthetic population built from real Census survey
 *    answers from one expanded out of the trip model's own zone attributes.
 *    That distinction is the difference between two independent methods and one
 *    method run twice, and it is the entire basis of the dual-model comparison.
 *
 * A caveat that is wrong is worse than a missing one: it is read as a checked
 * fact. These tests exist so the list follows the run.
 */

function manifest(overrides: Record<string, unknown>): CountyOnrampManifest {
  return overrides as unknown as CountyOnrampManifest;
}

const CALIBRATED = manifest({
  calibration: { performed: true, holdout_station_count: 12, claim_tier: "calibrated_to_counts" },
});

const FITTED_POPULATION = manifest({
  summary: {
    activitysim_bundle: {
      population: { status: "fitted_to_published_totals", method: "acs_pums_seed_iterative_proportional_updating" },
    },
  },
});

describe("the caveats a county run carries", () => {
  it("does not call a calibrated run uncalibrated", () => {
    const caveats = getCountyRunCaveats("validated-screening", CALIBRATED);

    expect(caveats).not.toContain("Uncalibrated");
    expect(caveats.join(" ")).toContain("Calibrated to published counts");
  });

  it("says how many stations a calibrated run was graded on", () => {
    // The number is the point. "Calibrated" alone invites the reading that the
    // model was checked against everything available; it was graded on the
    // stations held BACK from the fitting, and that is the honest figure.
    const caveats = getCountyRunCaveats("validated-screening", CALIBRATED);
    expect(caveats.join(" ")).toContain("12 stations held back");
  });

  it("still says uncalibrated when no calibration was performed", () => {
    const requested = manifest({ calibration: { performed: false, reason: "no step improved the holdout" } });
    expect(getCountyRunCaveats("validated-screening", requested)).toContain("Uncalibrated");
  });

  it("says uncalibrated when the run has no calibration record at all", () => {
    // Absence is not evidence of calibration. This is the direction that must
    // never flip: claiming calibration that did not happen would overstate.
    expect(getCountyRunCaveats("validated-screening", manifest({}))).toContain("Uncalibrated");
    expect(getCountyRunCaveats("validated-screening", null)).toContain("Uncalibrated");
  });

  it("names a population built from real survey answers", () => {
    const caveats = getCountyRunCaveats("validated-screening", FITTED_POPULATION);

    expect(caveats).not.toContain("Not behavioral demand");
    expect(caveats.join(" ")).toContain("real Census survey answers");
  });

  it("does not let a real population imply the travel behaviour is modelled", () => {
    // The trap. Households fitted from local survey answers look local, and
    // lend the output an authority the behaviour underneath has not earned —
    // ActivitySim's coefficients are still estimated for other regions, and
    // in most runs it has not executed at all.
    const caveats = getCountyRunCaveats("validated-screening", FITTED_POPULATION);
    expect(caveats.join(" ")).toContain("travel behaviour still not modelled");
  });

  it("says not behavioral demand when the population is the scaffold", () => {
    const scaffolded = manifest({
      summary: { activitysim_bundle: { population: { status: "prototype_scaffold" } } },
    });
    expect(getCountyRunCaveats("validated-screening", scaffolded)).toContain("Not behavioral demand");
  });

  it("keeps the caveats that are still true whatever the run did", () => {
    for (const supplied of [null, CALIBRATED, FITTED_POPULATION]) {
      const caveats = getCountyRunCaveats("validated-screening", supplied);
      expect(caveats).toContain("Screening-grade only");
      expect(caveats).toContain("Not client-ready forecasting");
      expect(caveats).toContain("Validated slice only");
    }
  });

  it("leaves the earlier stages alone", () => {
    // Nothing has been calibrated or populated yet at these stages, so the
    // manifest cannot make their caveats more accurate.
    expect(getCountyRunCaveats("runtime-complete", CALIBRATED)).toEqual(
      getCountyRunCaveats("runtime-complete", null)
    );
    expect(getCountyRunCaveats("bootstrap-incomplete", CALIBRATED)).toEqual(
      getCountyRunCaveats("bootstrap-incomplete", null)
    );
  });
});
