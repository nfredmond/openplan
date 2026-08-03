import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CALIBRATED_RESIDENT_VMT_PER_CAPITA_KPI,
  VMT_DETERMINATION_ELIGIBLE_ENGINE_KEYS,
  resolveVmtDeterminationRunEligibility,
  selectCalibratedHoldoutApe,
  selectCalibratedVmtPerCapita,
} from "@/lib/planner-pack/vmt-determination-inputs";
import type { CeqaVmtKpiRowLike } from "@/lib/models/ceqa-vmt-screen";

/**
 * The screen and the save route must not be able to disagree about what may feed
 * a significance determination.
 *
 * They did. The panel offered a calibrated determination from any row named
 * `resident_vmt_per_capita_calibrated`; the route additionally required the row
 * to be run-level and positive. A geometry-scoped calibrated slice therefore put
 * a "Calibrated-input determination" on screen that the save refused with 422 —
 * an honest refusal in front of a number the product would never keep.
 *
 * The behavioural fixes live in the panel and route suites. This file pins the
 * structural property that stops the pair drifting apart again: there is ONE
 * definition, and neither side is allowed to spell its own.
 */

const REPO_SRC = path.resolve(__dirname, "..");
const PANEL = path.join(REPO_SRC, "components/ceqa/ceqa-vmt-screen-body.tsx");
const ROUTE = path.join(
  REPO_SRC,
  "app/api/models/[modelId]/runs/[modelRunId]/vmt-significance/route.ts"
);

function row(overrides: Partial<CeqaVmtKpiRowLike>): CeqaVmtKpiRowLike {
  return {
    kpi_name: CALIBRATED_RESIDENT_VMT_PER_CAPITA_KPI,
    kpi_label: null,
    value: 18,
    unit: null,
    geometry_ref: null,
    ...overrides,
  };
}

describe("the calibrated VMT has one definition, shared by the panel and the server", () => {
  it("selects a run-level positive calibrated figure", () => {
    expect(selectCalibratedVmtPerCapita([row({})])).toEqual({
      kpiName: CALIBRATED_RESIDENT_VMT_PER_CAPITA_KPI,
      vmtPerCapita: 18,
    });
  });

  it("refuses a geometry-scoped slice, which is a corridor and not the run total", () => {
    expect(selectCalibratedVmtPerCapita([row({ geometry_ref: "corridor-1" })])).toBeNull();
  });

  it("refuses a value that is zero, negative, absent, or not finite", () => {
    for (const value of [0, -4, null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(selectCalibratedVmtPerCapita([row({ value })])).toBeNull();
    }
  });

  it("refuses the uncalibrated screening KPI, which is a different number entirely", () => {
    expect(selectCalibratedVmtPerCapita([row({ kpi_name: "resident_vmt_per_capita" })])).toBeNull();
  });

  it("keeps a corridor's calibration fit from being read as the study area's", () => {
    expect(selectCalibratedHoldoutApe([row({ kpi_name: "validation_median_ape_calibrated" })])).toBe(18);
    expect(
      selectCalibratedHoldoutApe([
        row({ kpi_name: "validation_median_ape_calibrated", geometry_ref: "corridor-1" }),
      ])
    ).toBeNull();
    // Zero is a real (if improbable) calibration result, not a broken row — the
    // positivity rule that guards a VMT figure must not be copied onto an error.
    expect(selectCalibratedHoldoutApe([row({ kpi_name: "validation_median_ape_calibrated", value: 0 })])).toBe(0);
  });

  it("is the only place either side spells the calibrated KPI name", () => {
    // The ratchet. A future edit that re-inlines the lookup on one side is how
    // the two drifted the first time.
    for (const file of [PANEL, ROUTE]) {
      const source = readFileSync(file, "utf8");
      const bareOccurrences = source
        .split("\n")
        .filter((line) => line.includes(`"${CALIBRATED_RESIDENT_VMT_PER_CAPITA_KPI}"`));

      expect(bareOccurrences, `${path.basename(file)} spells the calibrated KPI name itself`).toEqual(
        []
      );
      expect(source).toContain("@/lib/planner-pack/vmt-determination-inputs");
    }
  });
});

describe("a run that cannot support a determination is refused with the reason that fits it", () => {
  it("accepts a succeeded run from an eligible engine", () => {
    expect(
      resolveVmtDeterminationRunEligibility({ status: "succeeded", engineKey: "aequilibrae" })
    ).toEqual({ ok: true });
  });

  it("says an unfinished run has not succeeded — a state that can change", () => {
    for (const status of ["failed", "running", "queued", "cancelled", null]) {
      const eligibility = resolveVmtDeterminationRunEligibility({
        status,
        engineKey: "aequilibrae",
      });
      expect(eligibility.ok).toBe(false);
      if (eligibility.ok) throw new Error("unreachable");
      expect(eligibility.kind).toBe("run_not_succeeded");
      expect(eligibility.reason).toMatch(/succeeded/i);
      // Wording is surface-neutral on purpose: the same reason renders in the
      // panel's refusal (where nothing was ever going to be saved) and in the
      // route's (where a save was just refused). It must still name the wait.
      expect(eligibility.reason).toMatch(/screen it again once it succeeds/i);
    }
  });

  it("says an ineligible engine never will be — a state that cannot", () => {
    for (const engineKey of ["sketch_abm", "ite_trip_generation", "behavioral_demand", null]) {
      const eligibility = resolveVmtDeterminationRunEligibility({ status: "succeeded", engineKey });
      expect(eligibility.ok).toBe(false);
      if (eligibility.ok) throw new Error("unreachable");
      expect(eligibility.kind).toBe("engine_not_supported");
    }
  });

  it("reports the engine, not the status, when a run fails both — waiting cannot help", () => {
    const eligibility = resolveVmtDeterminationRunEligibility({
      status: "failed",
      engineKey: "sketch_abm",
    });
    expect(eligibility.ok).toBe(false);
    if (eligibility.ok) throw new Error("unreachable");
    expect(eligibility.kind).toBe("engine_not_supported");
  });

  it("keeps the eligible set to engines whose VMT may carry a regulatory finding", () => {
    // Widening this list is a claim about what a model's VMT may be cited as, so
    // it is pinned rather than left to drift. The sketch ABM in particular is
    // recorded in this repo as running far below the CARB reference, which is
    // how a false "less than significant" gets issued.
    expect([...VMT_DETERMINATION_ELIGIBLE_ENGINE_KEYS]).toEqual(["aequilibrae"]);
  });
});
