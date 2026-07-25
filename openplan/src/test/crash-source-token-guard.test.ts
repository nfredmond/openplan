import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No UI may branch on a specific crash-adapter id.
 *
 * Crash coverage advances by REGISTERING an adapter
 * (`src/lib/safety/sources/registry.ts`), never by editing call sites. Explore
 * broke that rule three times over: `explore-page-state.ts`,
 * `explore-results-board.tsx` and `explore-geospatial-briefing.tsx` each
 * compared `sourceSnapshots.crashes.source` against `"switrs-local"`.
 *
 * SWITRS was retired on 2025-01-08 and the crash lane moved to the registry, so
 * nothing has emitted that token since. The consequences were invisible because
 * every branch simply took its `else`:
 *   - the crash point layer could never become available, so live CCRS crashes
 *     that had been fetched, geocoded and returned in the run's own GeoJSON
 *     were never rendered on Explore;
 *   - real observed crash data was rendered with a "warning" tone;
 *   - the briefing told every planner that "SWITRS remains the preferred
 *     California-grade upgrade path", recommending a dead system.
 *
 * The honest signals are on the snapshot itself: `source` is present only when
 * something answered, `label` names it, and `state` carries the identifier.
 */

const SRC = path.join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

/** Product source only — tests may name a token to prove it is gone. */
function productFiles(): string[] {
  return walk(SRC).filter((file) => !file.startsWith(path.join(SRC, "test")));
}

/**
 * Scan CODE, not prose.
 *
 * A guard that forbade naming the retired token in a comment would push the
 * next maintainer to delete the explanation of why the branch was removed —
 * which is the most useful thing at those call sites. Block comments (including
 * JSX `{/* … *\/}`) and whole-line `//` comments are dropped; nothing that
 * strips a trailing `//` is used, because that could swallow real code after a
 * URL and turn a false positive into a false negative.
 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
    .join("\n");
}

/**
 * PRESENTATION code — pages and components.
 *
 * `src/lib` is deliberately out of scope: the crash lane owns its own state
 * vocabulary (`crashes.ts` branches on `"out-of-coverage"`, the registry and its
 * adapters name their ids), and forbidding that would be forbidding the design.
 * The rule being enforced is narrower and is where all three defects lived: a
 * SCREEN must not decide what to show based on which adapter answered.
 */
function presentationFiles(): string[] {
  return productFiles().filter(
    (file) => file.startsWith(path.join(SRC, "app")) || file.startsWith(path.join(SRC, "components"))
  );
}

/**
 * Comparing a crash source snapshot against a string literal.
 *
 * The typeof-result literals are excluded, because
 * `typeof x.crashes?.source === "string"` asks whether a source exists at all —
 * the honest question — rather than which adapter it was. Excluding by the
 * compared VALUE rather than by a lookbehind is what makes that correct: the
 * `typeof` keyword sits before the object, not before the property.
 */
const CRASH_SOURCE_LITERAL_COMPARISON =
  /crashes\s*(?:\?\.|\.)\s*source\s*(?:===|!==|==|!=)\s*(["'`])(?!(?:string|number|undefined|object|boolean)\1)/;

/** The retired token itself, in any position. */
const RETIRED_SWITRS_TOKEN = /["'`]switrs-local["'`]/;

describe("crash source token guard", () => {
  it("never lets a screen branch on which crash adapter answered", () => {
    const offenders = presentationFiles()
      .filter((file) => CRASH_SOURCE_LITERAL_COMPARISON.test(codeOf(file)))
      .map((file) => path.relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });

  it("carries no reference to the retired SWITRS token", () => {
    const offenders = productFiles()
      .filter((file) => RETIRED_SWITRS_TOKEN.test(codeOf(file)))
      .map((file) => path.relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });

  it("guards the guard — the patterns catch the shapes that actually shipped", () => {
    // Verbatim from the three files this replaced.
    expect(
      CRASH_SOURCE_LITERAL_COMPARISON.test(
        'analysisResult?.metrics.sourceSnapshots?.crashes?.source === "switrs-local"'
      )
    ).toBe(true);
    expect(
      CRASH_SOURCE_LITERAL_COMPARISON.test('sourceSnapshots?.crashes?.source !== "switrs-local"')
    ).toBe(true);
    expect(
      CRASH_SOURCE_LITERAL_COMPARISON.test('sourceSnapshots?.crashes?.source === "fars-api"')
    ).toBe(true);
    expect(RETIRED_SWITRS_TOKEN.test('crashes: { source: "switrs-local" }')).toBe(true);

    // And do not fire on the honest forms that replaced them.
    expect(CRASH_SOURCE_LITERAL_COMPARISON.test("sourceSnapshots?.crashes?.source ? 'success' : 'warning'")).toBe(
      false
    );
    expect(CRASH_SOURCE_LITERAL_COMPARISON.test("crashes.source === adapter.id")).toBe(false);
    // An existence check is the honest question and must not be flagged.
    expect(
      CRASH_SOURCE_LITERAL_COMPARISON.test('typeof sourceSnapshots.crashes?.source === "string"')
    ).toBe(false);
  });

  it("guards the guard — the scan reaches the Explore surface it exists to protect", () => {
    const screens = presentationFiles();
    expect(screens.length).toBeGreaterThan(50);
    expect(screens.some((f) => f.includes(path.join("explore", "_components")))).toBe(true);
    // The three files this guard was written for must be inside the scan.
    for (const shipped of [
      path.join("explore", "_components", "explore-page-state.ts"),
      path.join("explore", "_components", "explore-results-board.tsx"),
      path.join("explore", "_components", "explore-geospatial-briefing.tsx"),
    ]) {
      expect(screens.some((f) => f.includes(shipped))).toBe(true);
    }
  });
});
