import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { bandIntrazonalShare } from "@/lib/models/zone-resolution";

/**
 * ONE THRESHOLD, TWO LANGUAGES — and it must not drift.
 *
 * "How much of a run's travel never reaches a link" decides two different
 * things in two different runtimes:
 *
 *   * the APP (`src/lib/models/zone-resolution.ts`) owns the bands and every
 *     planner-facing sentence, and decides what the run's zone panel says;
 *   * the WORKER (`workers/aequilibrae_worker/count_validation.py`) decides
 *     whether a link-level count comparison may award a screening gate — which
 *     `write_model_run_modeling_evidence` converts into the `screening_grade`
 *     CLAIM TIER.
 *
 * If those two disagree, a run tells a planner "link comparison cannot settle
 * this" on one panel while a screening claim, awarded by that very comparison,
 * sits on another. That contradiction is not hypothetical: it is exactly the
 * state the product was in before the worker learned to consult the zone
 * system, and a silent threshold drift would restore it.
 *
 * Python deliberately holds ONE number rather than a copy of the band table.
 * Duplicating four bands of prose across a language boundary is four things
 * that can drift; duplicating a single boundary is one, and this test is the
 * guard on it.
 *
 * WHY THIS ASSERTS BEHAVIOUR, NOT TEXT. It probes `bandIntrazonalShare` either
 * side of the Python constant rather than parsing the TS band table, so it
 * cannot be satisfied by a band table that still *reads* right while returning
 * something else.
 */

const WORKER_COUNT_VALIDATION = path.join(
  process.cwd(),
  "..",
  "workers",
  "aequilibrae_worker",
  "count_validation.py"
);

function readWorkerSource(): string {
  return readFileSync(WORKER_COUNT_VALIDATION, "utf8");
}

/**
 * The worker's threshold, read out of its source.
 *
 * Throws rather than returning a default when the constant cannot be found. A
 * guard whose extraction silently yields nothing passes forever while proving
 * nothing — this repository's signature vacuous-test failure — so a rename has
 * to break this test loudly instead of quietly excusing it.
 */
function workerThresholdPct(source: string): number {
  const match = source.match(/^LINK_VALIDATION_MAX_INTRAZONAL_SHARE_PCT\s*=\s*([0-9.]+)\s*$/m);
  if (!match) {
    throw new Error(
      "LINK_VALIDATION_MAX_INTRAZONAL_SHARE_PCT was not found in count_validation.py. " +
        "If it was renamed or moved, update this guard — do not delete it: it is the only " +
        "thing keeping the worker's gate and the app's zone panel telling one story."
    );
  }
  return Number.parseFloat(match[1]);
}

describe("the link-validation threshold is the same number in both runtimes", () => {
  it("finds the worker's threshold in its source", () => {
    const threshold = workerThresholdPct(readWorkerSource());
    expect(Number.isFinite(threshold)).toBe(true);
    // A share is a percentage. A constant outside 0-100 would mean the units
    // drifted (the worker measures this as a FRACTION everywhere else, and the
    // one conversion happens at the single call site in main.py).
    expect(threshold).toBeGreaterThan(0);
    expect(threshold).toBeLessThanOrEqual(100);
  });

  it("agrees with the app's bands at the boundary, in both directions", () => {
    const threshold = workerThresholdPct(readWorkerSource());

    // AT the worker's threshold the app must still consider link comparison
    // meaningful — otherwise the worker awards gates the app calls unsettleable.
    expect(bandIntrazonalShare(threshold, 40).supportsLinkLevelValidation).toBe(true);

    // JUST PAST it the app must not — otherwise the app promises a meaningful
    // comparison the worker has already refused to draw a claim from.
    expect(bandIntrazonalShare(threshold + 0.1, 40).supportsLinkLevelValidation).toBe(false);
  });

  it("holds at the measured precedent that motivated the whole diagnostic", () => {
    // 26 zones, 36% intrazonal — OpenPlan's own county validation, where
    // link-level AADT comparison failed and the demand was not the reason.
    const threshold = workerThresholdPct(readWorkerSource());
    expect(36).toBeGreaterThan(threshold);
    expect(bandIntrazonalShare(36, 26).supportsLinkLevelValidation).toBe(false);
  });

  it("keeps the worker's qualification wired into the function that builds a gate", () => {
    // The qualification is applied inside `validate_against_counts` rather than
    // left to each caller, because a step a caller can forget is a step that
    // will be forgotten — and the failure mode is a screening claim nobody
    // meant to award. If this moves back out to the call sites, this guard
    // fails and whoever moved it has to argue for it.
    const source = readWorkerSource();
    const validateBody = source.slice(source.indexOf("def validate_against_counts("));
    expect(validateBody).toContain("qualify_gate_for_zone_resolution(summary");
  });
});
