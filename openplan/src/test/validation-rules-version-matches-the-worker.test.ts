import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildCountyRunProvenanceDocument,
  type CountyRunProvenanceInput,
} from "@/lib/models/county-run-provenance";

/**
 * ONE RULES VERSION, TWO LANGUAGES — and it must not drift.
 *
 * The WORKER stamps every validation summary with the revision of the
 * count-comparison rules that produced it
 * (`workers/aequilibrae_worker/count_validation.py::VALIDATION_RULES_VERSION`).
 * The APP compares that stamp against its own idea of the current revision and
 * warns a planner when the figures in front of them were graded by superseded
 * rules and are therefore not comparable with a fresh run.
 *
 * Those are two hand-maintained copies of one number, in two runtimes, and the
 * failure is silent in both directions:
 *
 *   * worker bumped, app not → every run is "current", including the ones
 *     graded by the rules the bump exists to disown. The warning that makes a
 *     stale accuracy figure legible simply never appears.
 *   * app bumped, worker not → every fresh run is branded superseded, and a
 *     planner learns to ignore the one banner that matters.
 *
 * This is the defect shape that has cost this lane the most: a constant read in
 * one place and hardcoded in another. It was found by measuring, never by a
 * test, seven times in one day (`docs/modeling/MODELING_AUDIT_BRIEF_2026-08-18.md`).
 * The rules version was the eighth instance waiting to happen, so it gets a
 * mechanism rather than a note asking the next session to remember.
 *
 * WHY THIS ASSERTS BEHAVIOUR, NOT TEXT. It drives the real provenance document
 * with the worker's own version number and with the revision immediately below
 * it, rather than parsing the app's constant. A constant that still *reads*
 * right while the comparison uses something else cannot satisfy it.
 */

const WORKER_COUNT_VALIDATION = path.join(
  process.cwd(),
  "..",
  "workers",
  "aequilibrae_worker",
  "count_validation.py"
);

/**
 * The worker's current rules revision, read out of its source.
 *
 * Throws rather than returning a default when the constant cannot be found. A
 * guard whose extraction silently yields nothing passes forever while proving
 * nothing — this repository's signature vacuous-test failure — so a rename has
 * to break this test loudly instead of quietly excusing it.
 */
function workerRulesVersion(source: string): number {
  const match = source.match(/^VALIDATION_RULES_VERSION\s*=\s*(\d+)\s*$/m);
  if (!match) {
    throw new Error(
      "VALIDATION_RULES_VERSION was not found in count_validation.py. If it was renamed or " +
        "moved, update this guard — it is the only thing keeping the worker's stamp and the " +
        "app's superseded-rules warning in step."
    );
  }
  return Number(match[1]);
}

function supersededWarning(rulesVersion: number): string {
  const input: CountyRunProvenanceInput = {
    runName: "rules-version-guard",
    geographyLabel: "Example County",
    geographyId: "06001",
    stage: "runtime-complete",
    statusLabel: null,
    manifest: null,
    validationSummary: {
      screening_gate: { status_label: "bounded screening-ready" },
      stations_matched: 38,
      stations_total: 71,
      validation_rules_version: rulesVersion,
    } as unknown as CountyRunProvenanceInput["validationSummary"],
    modelingEvidence: null,
    generatedAt: "2026-08-20T10:00:00.000Z",
  };
  return buildCountyRunProvenanceDocument(input);
}

describe("the app's current rules revision is the worker's", () => {
  const source = readFileSync(WORKER_COUNT_VALIDATION, "utf8");

  it("says nothing about the revision the worker is stamping today", () => {
    expect(supersededWarning(workerRulesVersion(source))).not.toContain("superseded");
  });

  it("still warns about the revision immediately below the worker's", () => {
    const previous = workerRulesVersion(source) - 1;
    expect(previous).toBeGreaterThanOrEqual(1);
    expect(supersededWarning(previous)).toContain("superseded");
    expect(supersededWarning(previous)).toContain(`revision ${previous}`);
  });

  it("names the current revision in the warning it shows a planner", () => {
    const version = workerRulesVersion(source);
    expect(supersededWarning(version - 1)).toContain(`current is ${version}`);
  });

  it("documents every revision it disowns, so the warning can say what changed", () => {
    // A version bump with no changelog entry leaves a planner told their
    // figures are superseded and never told by what.
    const version = workerRulesVersion(source);
    for (let revision = 2; revision <= version; revision += 1) {
      expect(source).toMatch(new RegExp(`^\\s*${revision}:\\s*\\(`, "m"));
    }
  });
});
