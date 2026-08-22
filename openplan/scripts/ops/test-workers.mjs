#!/usr/bin/env node
/**
 * RUN EVERY PYTHON WORKER SUITE, UNDER EACH WORKER'S OWN INTERPRETER.
 *
 * There is no pytest in this repository: each worker suite is a script executed
 * directly. The documented way to run them was a shell one-liner naming ONE
 * worker and ending in `|| break` — which stops at the first failure, after
 * printing the suites that passed, so a broken run looks like a pass. That
 * exact shape covered three of twenty suites for months (see
 * `src/test/every-worker-suite-can-actually-run.test.ts`).
 *
 * This script is the tracked replacement. It:
 *
 *   - discovers workers from the filesystem, so a new one is included the
 *     moment its first `test_*.py` lands;
 *   - uses each worker's OWN virtualenv, never system python — four aequilibrae
 *     suites import pandas and die under the system interpreter;
 *   - runs every suite even after one fails, because a failure that hides the
 *     next failure turns fixing a batch into N round trips;
 *   - reports a worker with no virtualenv as SKIPPED BY NAME and exits non-zero
 *     for it, because "nothing ran" must never read like "everything passed".
 *
 * Deliberately NOT part of `qa:gate`: the aequilibrae suites are minutes of
 * numerical work, and a gate people stop running is worse than one that covers
 * less. The gate's share of this is the import probe in the guard above, which
 * asks the cheap half of the question — can these files even start.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKERS_DIR = path.resolve(HERE, "..", "..", "..", "workers");
const VENV_CANDIDATES = [
  path.join(".venv311", "bin", "python"),
  path.join(".venv", "bin", "python"),
];

function lanes() {
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

const found = lanes();
if (found.length === 0) {
  console.error("No worker suites found under workers/ — that is itself the finding.");
  process.exit(1);
}

let passed = 0;
const failures = [];
const unprovisioned = [];

for (const lane of found) {
  if (!lane.interpreter) {
    unprovisioned.push(lane);
    console.log(
      `\n${lane.name}: SKIPPED — no virtualenv. ${lane.suites.length} suite(s) did not run.\n` +
        `  Provision it:  cd workers/${lane.name} && uv venv --python 3.11 .venv311 && ` +
        `uv pip install --python .venv311/bin/python -r requirements.txt`
    );
    continue;
  }

  console.log(`\n${lane.name}  (${lane.suites.length} suites, ${path.relative(WORKERS_DIR, lane.interpreter)})`);
  for (const suite of lane.suites) {
    try {
      // `-B` keeps Python from writing bytecode: it caches on size and
      // mtime-in-SECONDS, which has already reported a false pass in this repo
      // when a file changed twice within one second.
      execFileSync(lane.interpreter, ["-B", suite], {
        cwd: lane.dir,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 600_000,
      });
      passed += 1;
      console.log(`  ok    ${suite}`);
    } catch (error) {
      const detail = error?.stderr ? String(error.stderr).trim() : String(error);
      failures.push({ lane: lane.name, suite, detail: detail.split("\n").slice(-3).join("\n") });
      console.log(`  FAIL  ${suite}`);
    }
  }
}

console.log(
  `\n${passed} suite(s) passed, ${failures.length} failed, ` +
    `${unprovisioned.reduce((total, lane) => total + lane.suites.length, 0)} not run.`
);

for (const failure of failures) {
  console.log(`\n--- ${failure.lane}/${failure.suite}\n${failure.detail}`);
}

// A worker nobody could run is not a pass. Exiting 0 here is the whole defect
// this script exists to end.
process.exit(failures.length > 0 || unprovisioned.length > 0 ? 1 : 0);
