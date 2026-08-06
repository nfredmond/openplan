import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE PYTHON WORKER SUITES ARE THE ONLY TESTS IN THIS REPOSITORY THAT NOTHING
 * ELSE RUNS, AND THE DOCUMENTED WAY TO RUN THEM COVERED 15% OF THEM.
 *
 * There is no pytest here. Each worker suite is a script executed directly, and
 * the only thing that decides whether they all get run is a shell one-liner a
 * person copies out of a document. Measured 2026-08-06, that one-liner was:
 *
 *     for f in workers/aequilibrae_worker/test_*.py; do python3 "$f" || break; done
 *
 * labelled "all of them". It ran THREE of twenty and stopped. Four suites
 * (`test_count_ingest`, `test_gateways`, `test_od_matrix`, `test_scale`) import
 * pandas/numpy, which the system interpreter does not have; the first of them in
 * alphabetical order dies with `ModuleNotFoundError`, and `|| break` halts the
 * loop there. Nothing announced it — the loop had already printed three cheerful
 * "checks passed" lines, so the run LOOKED like a pass.
 *
 * That is this repository's own signature defect wearing a shell script's
 * clothes: a gate that silently covers less than it claims and keeps answering
 * "the tests passed". It is the same shape as `test:guardrail-suite` naming a
 * deleted file (see `package-scripts-resolve.test.ts`), and the same shape as a
 * read that failed being reported as a read that found nothing.
 *
 * WHY THIS GUARD LIVES IN THE TYPESCRIPT SUITE. It is checking the PYTHON
 * lane, which is a boundary crossing that deserves a reason. `npm test` is what
 * actually runs in the gate and in CI; the Python suites run only when a person
 * decides to run them. So the only place a broken worker-test command can be
 * caught automatically is here. And the specific fix — CLAUDE.md's corrected
 * command — lives in a file that is GITIGNORED, so it reaches exactly one disk.
 * A rule that exists on one laptop is not a rule (see the `claude-md-is-
 * gitignored` lesson); this is the tracked half.
 *
 * WHAT IT CHECKS: that every worker suite can be IMPORTED by the interpreter the
 * repo says to use. It compiles and imports each module rather than running it —
 * a full run is minutes of numerical work and belongs to whoever is changing the
 * worker, while "can this file even start" is the question that was silently
 * answered "no" for a fifth of them.
 *
 * WHAT IT DOES NOT CHECK: that the suites PASS. Import success is not a green
 * suite, and this guard must never be mistaken for having run them.
 */

const REPO_ROOT = path.join(process.cwd(), "..");
const WORKER_DIR = path.join(REPO_ROOT, "workers", "aequilibrae_worker");
const VENV_PYTHON = path.join(WORKER_DIR, ".venv311", "bin", "python");

function workerSuites(): string[] {
  if (!existsSync(WORKER_DIR)) return [];
  return readdirSync(WORKER_DIR)
    .filter((name) => name.startsWith("test_") && name.endsWith(".py"))
    .sort();
}

/**
 * The venv is a local development artifact, not a committed one, so a checkout
 * that has never provisioned the worker cannot run this. Skipping is correct
 * there — failing would make a clean clone red for a reason unrelated to the
 * change under test — but the skip is NAMED, so it cannot quietly become the
 * normal state.
 */
const venvAvailable = existsSync(VENV_PYTHON);
const describeWithVenv = venvAvailable ? describe : describe.skip;

describe("the python worker suites are discoverable", () => {
  it("finds the suites that certainly exist", () => {
    const suites = workerSuites();

    // A floor, not an equality: suites get added, and this guard must not be the
    // reason someone hesitates. But if the count collapses, the detector broke.
    expect(suites.length).toBeGreaterThanOrEqual(15);
    expect(suites).toContain("test_gtfs_skim.py");
    expect(suites).toContain("test_count_validation.py");
  });

  it("keeps the pandas-dependent suites named, because they are why the interpreter matters", () => {
    // These four are the reason system `python3` is the wrong interpreter. If a
    // future change makes them stdlib-only, this list going stale is a GOOD
    // failure — it means the trap is gone and the docs can be simplified.
    const pandasSuites = ["test_count_ingest.py", "test_gateways.py", "test_od_matrix.py", "test_scale.py"];
    const suites = new Set(workerSuites());

    const missing = pandasSuites.filter((name) => !suites.has(name));
    expect(
      missing,
      "a suite named here as pandas-dependent no longer exists. Either it was renamed (update this " +
        "list) or the dependency is gone (simplify the docs — the venv may no longer be required)."
    ).toEqual([]);
  });
});

describeWithVenv("every python worker suite can start under the documented interpreter", () => {
  it("imports every suite without a missing dependency", () => {
    const failures: string[] = [];

    for (const suite of workerSuites()) {
      const moduleName = suite.replace(/\.py$/, "");
      try {
        // `import_module` rather than executing the file: importing runs the
        // module's top-level statements — its imports — which is exactly what
        // was failing, without running minutes of numerical work. The suites
        // guard their own execution behind `if __name__ == "__main__"`.
        execFileSync(VENV_PYTHON, ["-c", `import importlib; importlib.import_module("${moduleName}")`], {
          cwd: WORKER_DIR,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 120_000,
        });
      } catch (error) {
        const detail = error instanceof Error && "stderr" in error ? String(error.stderr).trim() : String(error);
        failures.push(`${suite}: ${detail.split("\n").pop() ?? detail}`);
      }
    }

    expect(
      failures,
      "These worker suites cannot even be imported by the interpreter the repo documents. Under the " +
        "old `python3 …/test_*.py` loop this failed SILENTLY: `|| break` halted after the first one, " +
        "having printed three passing suites, so the run looked like a pass while covering 15% of " +
        "the worker tests. Install the missing dependency into workers/aequilibrae_worker/.venv311, " +
        "or make the suite stdlib-only."
    ).toEqual([]);
  });

  /**
   * NON-VACUITY for the assertion above: an empty failure list is also what a
   * loop over zero suites produces, and what a broken interpreter path produces
   * if the try/catch were ever loosened.
   */
  it("proves the interpreter it used can actually fail", () => {
    expect(() =>
      execFileSync(VENV_PYTHON, ["-c", "import a_module_that_does_not_exist_anywhere"], {
        cwd: WORKER_DIR,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      })
    ).toThrow();

    // And that pandas — the specific dependency the system interpreter lacks —
    // is genuinely present in this one. If it is not, the four suites above are
    // passing for some other reason and this guard is not testing what it says.
    expect(() =>
      execFileSync(VENV_PYTHON, ["-c", "import pandas"], {
        cwd: WORKER_DIR,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      })
    ).not.toThrow();
  });
});

describe("the worker-test command in the operator docs is the one that works", () => {
  /**
   * The mechanical cross-reference half. CLAUDE.md is gitignored and cannot be
   * checked here, but the README is tracked — and if it ever grows a
   * worker-test command, that command must not be the broken one.
   */
  it("no tracked doc tells a reader to run the worker suites with system python3", () => {
    const trackedDocs = [
      path.join(REPO_ROOT, "README.md"),
      path.join(REPO_ROOT, "CONTRIBUTING.md"),
      path.join(REPO_ROOT, "openplan", "docs", "SELF_HOSTING.md"),
      path.join(REPO_ROOT, "openplan", "docs", "FIRST_DEPLOYMENT.md"),
    ].filter((file) => existsSync(file));

    // Non-vacuity: if none of these exist the assertion below is empty for the
    // wrong reason.
    expect(trackedDocs.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of trackedDocs) {
      const text = readFileSync(file, "utf8");
      // The broken shape specifically: bare `python3` invoking a worker test.
      if (/\bpython3\s+\S*workers\/aequilibrae_worker\/test_/.test(text)) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }

    expect(
      offenders,
      "A tracked document tells a reader to run the worker suites with system `python3`. Four of " +
        "them import pandas and die there, and the usual `|| break` loop then stops after three of " +
        "twenty while looking like a pass. Use workers/aequilibrae_worker/.venv311/bin/python."
    ).toEqual([]);
  });
});
