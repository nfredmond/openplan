import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A package.json script that names a deleted file breaks silently, because the
 * only thing that runs it is a person typing it. `test:guardrail-suite` named
 * `src/test/workspace-provision-route.test.ts` from the moment commit 094fd40b
 * deleted that file along with the founder-era admin console.
 *
 * The failure was quieter than "the suite stopped running", and worse for it:
 * vitest ignores a filter that matches nothing as long as another filter
 * matches. So the script ran SEVEN of the eight guards it names, printed
 * `Test Files 7 passed (7)`, exited 0, and never named the file that was
 * missing. A gate that silently covers less than it claims keeps answering
 * "the guardrails held" — which is this repo's own defect class, a read that
 * failed reported as a read that found nothing wrong.
 *
 * Measured 2026-08-04 on vitest 4.1.10, the version this repo pins:
 * `vitest run <existing> <missing>` exits 0 and runs the existing file alone,
 * with no mention of the other; only a run where NO filter matches exits 1,
 * with "No test files found, exiting with code 1". Re-measure before trusting
 * this paragraph across a vitest major — the guard below does not depend on it.
 *
 * This is the mechanical cross-reference class (see
 * `docs-mechanical-cross-references.test.ts`): the script IS the artifact, and
 * there is no live surface to check instead.
 *
 * WHAT IT CHECKS. Every token in every script of both npm projects that looks
 * like a file the script READS resolves on disk.
 *
 * WHAT IT DOES NOT CHECK. That the script does the right thing, that a test it
 * names still asserts what its name claims, or that the file is reachable. A
 * substituted path can resolve and still cover nothing.
 *
 * WHEN IT FAILS, the script is almost certainly pointing at something that was
 * renamed or deleted — fix the script. The one legitimate failure is a script
 * that reads a build artifact not in the tree; that needs an exemption written
 * here with the name of whatever produces the file, not a loosened extractor.
 */

const APP_ROOT = process.cwd();
const REPO_ROOT = path.join(APP_ROOT, "..");

const PACKAGES = [
  { name: "openplan/package.json", dir: APP_ROOT },
  { name: "qa-harness/package.json", dir: path.join(REPO_ROOT, "qa-harness") },
];

/** Extensions a script READS. Output extensions (`.log`) are deliberately absent. */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sh", ".py", ".sql", ".json"];

/**
 * Commands whose next non-flag argument is a path the script WRITES. A path
 * that does not exist yet is the point of `mkdir -p` and `tee`, not a defect.
 */
const WRITES_ITS_NEXT_ARGUMENT = new Set(["mkdir", "tee", ">", ">>", "-o", "--out", "--output"]);

/** File paths a script reads, in the order they appear. */
function scriptFilePaths(command: string): string[] {
  const found: string[] = [];
  let writesNext = false;

  for (const raw of command.split(/\s+/)) {
    const token = raw.replace(/^[('"`]+/, "").replace(/[)'"`;,]+$/, "");
    if (!token) continue;

    if (WRITES_ITS_NEXT_ARGUMENT.has(token)) {
      writesNext = true;
      continue;
    }

    const carriesValue = token.includes("=");
    if (token.startsWith("-") && !carriesValue) continue;

    if (writesNext) {
      writesNext = false;
      continue;
    }

    const value = carriesValue ? token.slice(token.lastIndexOf("=") + 1) : token;
    if (value.includes("://")) continue;
    if (!SOURCE_EXTENSIONS.some((extension) => value.endsWith(extension))) continue;

    found.push(value);
  }

  return found;
}

/** A glob is checked down to its static parent directory — no further. */
function resolvesOnDisk(baseDir: string, candidate: string): boolean {
  const globIndex = candidate.search(/[*?[]/);
  if (globIndex === -1) return existsSync(path.resolve(baseDir, candidate));

  const staticPrefix = candidate.slice(0, globIndex);
  const parent = staticPrefix.slice(0, staticPrefix.lastIndexOf("/") + 1);
  return existsSync(path.resolve(baseDir, parent));
}

function scriptsOf(dir: string): Record<string, string> {
  return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).scripts ?? {};
}

describe("package.json scripts: every path they name resolves", () => {
  it("names no file that is missing from disk", () => {
    const missing: string[] = [];

    for (const { name, dir } of PACKAGES) {
      for (const [script, command] of Object.entries(scriptsOf(dir))) {
        for (const candidate of scriptFilePaths(command)) {
          if (!resolvesOnDisk(dir, candidate)) missing.push(`${name} → ${script}: ${candidate}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  /**
   * An extractor that quietly matches nothing turns this file into a green test
   * that proves nothing, which is worse than no test at all. These anchors fail
   * if the extraction stops working, independently of whether the paths exist.
   */
  it("actually extracts the paths the scripts name", () => {
    const appScripts = scriptsOf(APP_ROOT);

    expect(scriptFilePaths(appScripts["worker:aequilibrae"])).toEqual([
      "../workers/aequilibrae_worker/run.sh",
    ]);
    expect(scriptFilePaths(appScripts["doctor"])).toEqual(["scripts/doctor.mjs"]);
    expect(scriptFilePaths(appScripts["test:guardrail-suite"]).length).toBeGreaterThan(5);

    const total = PACKAGES.flatMap(({ dir }) =>
      Object.values(scriptsOf(dir)).flatMap(scriptFilePaths)
    );
    expect(total.length).toBeGreaterThan(40);
  });

  /**
   * The INVERSE cross-reference, and the one that fails silently in the more
   * dangerous direction.
   *
   * The check above proves a script names nothing missing. This proves nothing
   * missing is unnamed. A test whose live half is gated on `LIVE_RLS` runs in
   * exactly one place — `npm run test:rls-live`, which CI also invokes — and that
   * script names its files by hand. Write a new live test, forget the script, and
   * the file passes `npm test` by SKIPPING its only real assertions, reports
   * green, and is never executed by anything. It is a guard that exists and
   * guards nothing: the shipped-invisible class, wearing a test's clothes.
   *
   * That is not hypothetical. `gtfs-feed-status-mirrors-its-current-version.test.ts`
   * arrived in this state on 2026-08-05 and was caught only because its author
   * went looking; nothing in the build would have said a word.
   */
  it("runs every live-gated test somewhere", () => {
    const testDir = path.join(REPO_ROOT, "openplan", "src", "test");
    const liveGated = readdirSync(testDir)
      .filter((name) => name.endsWith(".test.ts") || name.endsWith(".test.tsx"))
      .filter((name) => /LIVE_RLS\s*\?\s*describe\s*:\s*describe\.skip/.test(readFileSync(path.join(testDir, name), "utf8")))
      .map((name) => `src/test/${name}`)
      .sort();

    // Non-vacuity: if the detector stops finding the live tests that certainly
    // exist, it would pass by finding nothing — the failure mode this whole file
    // is about.
    expect(liveGated.length).toBeGreaterThanOrEqual(4);
    expect(liveGated).toContain("src/test/rls-isolation.test.ts");

    const script = scriptsOf(path.join(REPO_ROOT, "openplan"))["test:rls-live"] ?? "";
    expect(script).not.toBe("");

    const unrun = liveGated.filter((file) => !script.includes(file));
    expect(
      unrun,
      "live-gated test files that `npm run test:rls-live` does not name — they skip under `npm test` " +
        "and run nowhere else, so their assertions have never executed. Add them to the script."
    ).toEqual([]);
  });

  it("reads paths but not the ones a script writes", () => {
    expect(scriptFilePaths("vitest run src/test/a.test.ts src/test/b.test.tsx")).toEqual([
      "src/test/a.test.ts",
      "src/test/b.test.tsx",
    ]);
    expect(scriptFilePaths("node scripts/ops/x.mjs --config=config/y.json")).toEqual([
      "scripts/ops/x.mjs",
      "config/y.json",
    ]);
    expect(scriptFilePaths("mkdir -p ../out && (npm run qa:gate) | tee ../out/gate.log")).toEqual([]);
    expect(scriptFilePaths("next build --webpack")).toEqual([]);
    expect(scriptFilePaths("curl https://example.test/thing.json")).toEqual([]);
  });
});
