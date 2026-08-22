#!/usr/bin/env node
/**
 * RUN THE VITEST SUITE IN A RANDOMISED ORDER, AND SAY WHICH ORDER.
 *
 * Vitest reuses a worker process across test files, so anything a file leaks —
 * a stubbed global, a stubbed env var, accumulated calls on a shared mock, a
 * queued `mockResolvedValueOnce` the code under test never consumed — is
 * inherited by whatever file the scheduler runs next. `vitest run` always walks
 * files in the same order, so a suite can be permanently green while being
 * order-dependent, and the defect only surfaces when someone adds, renames, or
 * deletes an unrelated test file.
 *
 * `vitest.config.ts` closes the two mechanical halves of that (`unstubEnvs`,
 * `unstubGlobals`, `clearMocks`). The half no config can close is a test that
 * genuinely depends on another test having run. Only varying the order finds
 * those, and eight of them were found that way between 2026-08-21 and
 * 2026-08-22 — six with six distinct root causes.
 *
 * The seed is printed before the run and again on failure, because a random
 * order nobody can reproduce is a rumour, not a bug report. Pass a seed to
 * replay one:
 *
 *     node scripts/ops/test-shuffled.mjs 1234
 *
 * Deliberately NOT part of `qa:gate`: it doubles the gate's test time and its
 * failures are order-dependent by construction, which is the wrong shape for
 * the check people run before every commit. It is its own CI job instead.
 */

import { spawnSync } from "node:child_process";

const seed = process.argv[2] ?? String(Date.now() % 1_000_000);

if (!/^\d+$/.test(seed)) {
  console.error(`Seed must be a non-negative integer; got ${JSON.stringify(seed)}`);
  process.exit(2);
}

console.log(`\nRunning the suite in shuffled order with seed ${seed}.`);
console.log(`Replay this exact order with: node scripts/ops/test-shuffled.mjs ${seed}\n`);

const result = spawnSync(
  "npx",
  ["vitest", "run", "--sequence.shuffle", `--sequence.seed=${seed}`, "--reporter=dot"],
  { stdio: "inherit", shell: process.platform === "win32" }
);

if (result.status !== 0) {
  console.error(
    `\nThe suite failed in shuffled order with seed ${seed}.\n` +
      `This is an order-dependence defect, not a flake: replay it with\n` +
      `    node scripts/ops/test-shuffled.mjs ${seed}\n` +
      `and bisect by skipping tests in the failing file until it passes.\n`
  );
}

process.exit(result.status ?? 1);
