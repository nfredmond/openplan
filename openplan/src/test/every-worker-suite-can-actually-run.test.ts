import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "./helpers/source-text";

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
 *
 * ══════════════════════════════════════ IT USED TO CHECK ONE WORKER OF FIVE
 *
 * Written for `aequilibrae_worker`, whose directory it named as a constant. The
 * repository has five workers, and the other four — activitysim, county_onramp,
 * ocr, odm — were outside it entirely. Measured 2026-08-21:
 * `activitysim_worker/test_screening_handoff.py` could not start AT ALL (that
 * worker had no virtualenv, and `supabase_poll` imports `requests` and
 * `python-dotenv`, neither of which the system interpreter has), and nothing
 * reported it.
 *
 * That is the guard's own defect one level up — a check that silently covers
 * less than it claims — which is the exact shape it was written to prevent. The
 * worker list is therefore DERIVED FROM THE FILESYSTEM now, and a new worker is
 * inside this guard the moment its first `test_*.py` lands.
 */

const REPO_ROOT = path.join(process.cwd(), "..");
const WORKERS_DIR = path.join(REPO_ROOT, "workers");

/** The venv layouts the workers use, in the order a runner should prefer them. */
const VENV_CANDIDATES = [
  path.join(".venv311", "bin", "python"),
  path.join(".venv", "bin", "python"),
];

type WorkerLane = {
  name: string;
  dir: string;
  suites: string[];
  /** The worker's own interpreter, or null when this checkout has not provisioned one. */
  interpreter: string | null;
};

/**
 * Every worker that has suites, discovered rather than listed.
 *
 * A hardcoded list is what let four workers sit outside this guard; naming them
 * again — even correctly, today — would rebuild the same hole for whichever
 * worker is added next.
 */
function workerLanes(): WorkerLane[] {
  if (!existsSync(WORKERS_DIR)) return [];
  return readdirSync(WORKERS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(WORKERS_DIR, entry.name);
      const suites = readdirSync(dir)
        .filter((name) => name.startsWith("test_") && name.endsWith(".py"))
        .sort();
      const interpreter =
        VENV_CANDIDATES.map((candidate) => path.join(dir, candidate)).find((candidate) =>
          existsSync(candidate)
        ) ?? null;
      return { name: entry.name, dir, suites, interpreter };
    })
    .filter((lane) => lane.suites.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name));
}

const AEQUILIBRAE = "aequilibrae_worker";

function laneNamed(name: string): WorkerLane | undefined {
  return workerLanes().find((lane) => lane.name === name);
}

function workerSuites(): string[] {
  return laneNamed(AEQUILIBRAE)?.suites ?? [];
}

/**
 * The venv is a local development artifact, not a committed one, so a checkout
 * that has never provisioned the worker cannot run this. Skipping is correct
 * there — failing would make a clean clone red for a reason unrelated to the
 * change under test — but the skip is NAMED, so it cannot quietly become the
 * normal state.
 */
const AEQUILIBRAE_INTERPRETER = laneNamed(AEQUILIBRAE)?.interpreter ?? null;
const describeWithVenv = AEQUILIBRAE_INTERPRETER ? describe : describe.skip;

/**
 * Ask ONE interpreter whether every suite in its worker can be imported.
 *
 * Returns "suite.py: ErrorName: detail" for each that cannot, so the answer is
 * every broken suite rather than the first — this defect arrived as four at
 * once, and a guard that stops at the first makes fixing a batch an N-round-trip
 * exercise.
 */
function importFailuresFor(lane: WorkerLane & { interpreter: string }): string[] {
  const program = [
    "import importlib, json, sys",
    `names = ${JSON.stringify(lane.suites.map((suite) => suite.replace(/\.py$/, "")))}`,
    "sys.path.insert(0, '.')",
    "out = {}",
    "for name in names:",
    "    try:",
    "        importlib.import_module(name)",
    "    except BaseException as exc:",
    "        out[name] = f'{type(exc).__name__}: {exc}'",
    "print(json.dumps(out))",
  ].join("\n");

  let reported: Record<string, string>;
  try {
    const stdout = execFileSync(lane.interpreter, ["-c", program], {
      cwd: lane.dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    reported = JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as Record<string, string>;
  } catch (error) {
    // The interpreter itself could not run the probe — a different failure from
    // a suite that cannot import, and it must not be reported as one.
    const detail =
      error instanceof Error && "stderr" in error ? String(error.stderr).trim() : String(error);
    throw new Error(
      `${lane.name}: the worker interpreter could not run the import probe: ${
        detail.split("\n").pop() ?? detail
      }`
    );
  }

  return Object.entries(reported)
    .map(([name, detail]) => `${name}.py: ${detail}`)
    .sort();
}

/**
 * EVERY worker, not just the one this guard was born for.
 *
 * A worker whose venv this checkout has not provisioned is skipped BY NAME
 * rather than failed: a clean clone has provisioned none of them, and making a
 * fresh checkout red for that would teach people to ignore this file. The
 * inventory test above runs regardless, so a worker cannot fall outside the
 * guard entirely — only outside the part that needs an interpreter.
 */
describe("every worker's suites can start under that worker's own interpreter", () => {
  const lanes = workerLanes();

  for (const lane of lanes) {
    const runOrSkip = lane.interpreter ? it : it.skip;
    runOrSkip(`${lane.name}: every suite imports`, () => {
      const failures = importFailuresFor(lane as WorkerLane & { interpreter: string });
      expect(
        failures,
        `These ${lane.name} suites cannot be imported by that worker's interpreter, so nothing ` +
          `runs them and no failure is reported anywhere. Install the missing dependency into ` +
          `workers/${lane.name}/.venv311 (its requirements.txt lists them), or make the suite ` +
          `stdlib-only.`
      ).toEqual([]);
    });
  }
});

describe("the python worker suites are discoverable", () => {
  it("finds the suites that certainly exist", () => {
    const suites = workerSuites();

    // A floor, not an equality: suites get added, and this guard must not be the
    // reason someone hesitates. But if the count collapses, the detector broke.
    expect(suites.length).toBeGreaterThanOrEqual(15);
    expect(suites).toContain("test_gtfs_skim.py");
    expect(suites).toContain("test_count_validation.py");
  });

  /**
   * THE RATCHET AGAINST THE DEFECT THIS GUARD ACTUALLY HAD.
   *
   * Deriving the lanes fixes nothing on its own — a later edit that names one
   * directory again would restore the exact hole, and every OTHER assertion
   * here would still pass, because the worker it names is the healthy one. So
   * the coverage is asserted directly: more than one worker, and specifically
   * the one that was outside the guard while its only suite could not start.
   */
  it("covers every worker that has suites, not the one it was written for", () => {
    const lanes = workerLanes().map((lane) => lane.name);

    expect(lanes).toContain(AEQUILIBRAE);
    expect(
      lanes,
      "activitysim_worker sat outside this guard until 2026-08-21, and its only suite could not " +
        "start at all — no virtualenv, and supabase_poll imports requests and python-dotenv. If " +
        "this fails, the lane discovery has been narrowed back to a hardcoded directory."
    ).toContain("activitysim_worker");
    expect(
      lanes.length,
      "this repository has more than one worker with tests; a guard covering one of them is the " +
        "defect it was written to prevent, wearing its own clothes."
    ).toBeGreaterThanOrEqual(4);
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

describeWithVenv("the import probe can actually fail", () => {
  /**
   * NON-VACUITY for the per-worker assertions above: an empty failure list is
   * also what a loop over zero suites produces, and what a broken interpreter
   * path produces if the try/catch were ever loosened.
   */
  it("proves the interpreter it used can actually fail", () => {
    const interpreter = AEQUILIBRAE_INTERPRETER as string;
    const dir = laneNamed(AEQUILIBRAE)?.dir as string;

    expect(() =>
      execFileSync(interpreter, ["-c", "import a_module_that_does_not_exist_anywhere"], {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      })
    ).toThrow();

    // And that pandas — the specific dependency the system interpreter lacks —
    // is genuinely present in this one. If it is not, the four suites named
    // above are passing for some other reason and this guard is not testing
    // what it says.
    expect(() =>
      execFileSync(interpreter, ["-c", "import pandas"], {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      })
    ).not.toThrow();
  });

  /**
   * THE PROBE MUST SEE A BREAK IN ANY WORKER, NOT ONLY THE ONE IT WAS BORN FOR.
   *
   * The defect this guard had was structural: it named a directory, so four
   * workers were outside it. Discovering the lanes fixes that only if the
   * discovery genuinely reaches them, so this asserts against a suite that does
   * NOT exist in a lane that is not aequilibrae.
   */
  it("reports a broken import in a worker other than the one it was written for", () => {
    const other = workerLanes().find(
      (lane) => lane.name !== AEQUILIBRAE && lane.interpreter !== null
    );
    if (!other) return; // No second provisioned worker on this checkout.

    const failures = importFailuresFor({
      ...other,
      suites: ["test_a_suite_that_does_not_exist.py"],
    } as WorkerLane & { interpreter: string });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("test_a_suite_that_does_not_exist.py");
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
        "twenty while looking like a pass. Run `npm run test:workers` instead."
    ).toEqual([]);
  });

  /**
   * THE TRACKED REPLACEMENT FOR THE ONE-LINER.
   *
   * The corrected command lived only in CLAUDE.md, which is gitignored and
   * therefore reaches exactly one disk — the `claude-md-is-gitignored` lesson.
   * A script in package.json is the half that survives a clone, and these
   * assertions are the half that survives someone editing it.
   */
  it("ships one command that runs every worker suite, and it cannot stop at the first failure", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8")
    ) as { scripts?: Record<string, string> };

    const command = manifest.scripts?.["test:workers"];
    expect(command, "package.json has no `test:workers` script").toBeTruthy();

    const scriptPath = path.join(process.cwd(), "scripts", "ops", "test-workers.mjs");
    expect(
      existsSync(scriptPath),
      "`test:workers` names a file that does not exist — the exact shape of the " +
        "`test:guardrail-suite` defect, where a script pointed at a deleted file."
    ).toBe(true);

    // COMMENTS STRIPPED FIRST. The script's own header explains the `|| break`
    // defect by name, and matching that sentence would fail the guard for
    // documenting the very thing it prevents. Five guards in this repository
    // have already been broken by prose reaching the matcher; the shared
    // stripper is the tested answer.
    const source = stripSourceComments(readFileSync(scriptPath, "utf8"));
    // The specific bug: `|| break` halts after the first failure having printed
    // the passes, so the run looks green while covering a fraction.
    expect(source.includes("|| break")).toBe(false);
    // `|| break` is a SHELL shape, so on a JS runner that assertion only catches
    // a rewrite back into a one-liner. The behaviour it stands for needs its own
    // check: the catch block must record the failure and carry on, never leave
    // the loop. Measured — a mutation that only commented the words out passed
    // the string check, which is how this gap was found.
    const catchBlock = source.slice(source.indexOf("} catch (error) {"));
    const catchBody = catchBlock.slice(0, catchBlock.indexOf("\n    }"));
    expect(
      /\b(break|return|process\.exit)\b/.test(catchBody),
      "the per-suite catch leaves the loop, so one failing suite hides every suite after it — the " +
        "`|| break` defect in a different language."
    ).toBe(false);
    expect(catchBody).toContain("failures.push");

    // And it must walk the workers rather than naming one.
    expect(source).toContain("readdirSync(WORKERS_DIR");
    expect(source).not.toMatch(/const\s+\w*WORKER_DIR\w*\s*=\s*path\.join\([^)]*"aequilibrae_worker"/);
  });

  /**
   * NON-VACUITY: the assertions above pass just as happily against a script
   * that runs nothing. This one proves the runner actually reaches every
   * worker the guard knows about.
   */
  it("the runner covers the same workers this guard does", () => {
    const source = stripSourceComments(
      readFileSync(path.join(process.cwd(), "scripts", "ops", "test-workers.mjs"), "utf8")
    );
    const laneNames = workerLanes().map((lane) => lane.name);

    // Both derive from the same directory rather than from a list, so the
    // check is that the runner reads THAT directory and filters on suites the
    // same way — not that it repeats the names.
    expect(source).toContain('path.resolve(HERE, "..", "..", "..", "workers")');
    expect(source).toContain('name.startsWith("test_")');
    expect(laneNames.length).toBeGreaterThanOrEqual(4);
  });
});
