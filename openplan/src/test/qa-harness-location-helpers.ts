import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Locating the QA harness from a test in `openplan/`.
 *
 * The harness is a SIBLING package of `openplan/`, not a child of it, so it sits
 * outside the reach of anything rooted at `process.cwd()/src`. That is exactly
 * why guards kept missing it: `no-paid-tier-guard` scanned only `src`, so live
 * Stripe code sat in `qa-harness/` for months while the root README asserted the
 * codebase had no Stripe integration.
 *
 * Extracted from `qa-harness-route-contract-guard.test.ts`, which established
 * the walk-up approach, so both guards agree on where the harness is and neither
 * hardcodes a relative depth.
 */

/**
 * Walk up from the working directory until a directory named `qa-harness` with
 * a `package.json` appears.
 *
 * Not finding it is a HARD FAILURE, never an empty result. A guard that quietly
 * scans nothing reports success forever and is worse than no guard at all.
 */
export function locateHarnessDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, "qa-harness");
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate the qa-harness package by walking up from ${process.cwd()}. ` +
      "This guard exists to keep the harness in step with the product; it must not pass by finding nothing."
  );
}

/**
 * Directories that are not harness source and would swamp any scan.
 *
 * `first-week-runs` is EVIDENCE, not source: page snapshots, screenshots and
 * agent reports captured from a live local workspace by
 * `qa-harness/first-week-discovery.js`. It is gitignored, it can hold thousands
 * of files, and — the reason this entry exists rather than being a tidiness
 * preference — the text in it is whatever the product happened to render. A
 * page that ever says `api.stripe.com` lands verbatim in a snapshot, and the
 * paid-tier guard then fails the whole gate over a screenshot. Verified by
 * probe on 2026-08-14: one line in a discarded run directory turned
 * `no-paid-tier-guard` red.
 */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "playwright-report",
  "test-results",
  "first-week-runs",
]);

/** Binary-ish artifacts a text scan cannot meaningfully read. */
const SKIPPED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".ico", ".webp"]);

/**
 * Every readable text file in the harness, recursively.
 *
 * Deliberately NOT filtered to `.js`. The harness is CommonJS, so an
 * extension filter written for a TypeScript codebase excludes all of it — one of
 * the three independent reasons the paid-tier guard missed live Stripe code.
 * `package.json` and `README.md` are in scope too: a retired script's npm entry
 * point and a stale claim in the docs are both things worth failing on.
 */
export function harnessTextFiles(dir: string = locateHarnessDir()): string[] {
  const files: string[] = [];

  const walk = (current: string) => {
    for (const entry of readdirSync(current).sort()) {
      if (SKIPPED_DIRECTORIES.has(entry)) continue;
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (SKIPPED_EXTENSIONS.has(path.extname(entry).toLowerCase())) continue;
      if (entry === "package-lock.json") continue;
      files.push(full);
    }
  };

  walk(dir);
  return files;
}
