import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ENV_NAMESPACE, ENV_EXCUSED_FROM_EXAMPLE } from "./helpers/operator-env-vars";

/**
 * AN OPERATOR SETTING NOBODY CAN DISCOVER IS NOT A SETTING.
 *
 * `.env.example` is the only place a person deploying OpenPlan finds out that a
 * knob exists. Nothing in the codebase announces itself: a limit read through
 * `process.env` has a working default, so a deployment that needs a different
 * value behaves *plausibly* rather than visibly wrongly, and the operator never
 * learns there was a number to change. That is a self-serve failure (product
 * non-negotiable #4) — the agency has to ask someone, which is exactly the
 * dependency the product exists to remove.
 *
 * WHY THIS GUARD DID NOT ALREADY EXIST, AND HOW IT WAS FOUND.
 * `docs-mechanical-cross-references.test.ts` already checks this cross-reference
 * — in ONE DIRECTION. It asserts that every env var THE DOCS NAME appears in
 * `.env.example`, which catches a doc describing a setting that was renamed or
 * removed. It cannot catch the opposite and more common case: a setting added
 * to the CODE and written down nowhere. Nothing was watching that direction.
 *
 * Found on 2026-08-06 while reviewing the transit lane:
 * `OPENPLAN_GTFS_MAX_CATALOG_BYTES` had been added to `src/lib/gtfs/limits.ts`
 * hours earlier — a real bound, with a real default, protecting the process from
 * a catalog large enough to exhaust it — and appeared in no operator-facing file
 * at all. Two more turned up in the same sweep
 * (`OPENPLAN_ENGAGEMENT_LAYER_FEATURE_CAP`, `OPENPLAN_ENGAGEMENT_LAYER_MAX_BYTES`),
 * both months old, both refusals whose message names the operator, neither
 * discoverable by one.
 *
 * ZERO EXCEPTIONS, DELIBERATELY. All three gaps were closed before this guard
 * landed, so it starts absolute rather than with a ratchet. An exception list on
 * a guard this cheap to satisfy is an invitation: the correct response to a
 * failure here is four lines in `.env.example`, and there is no case where
 * documenting a setting is the wrong move. If a name genuinely must not be
 * documented, that is a conversation, not an entry.
 *
 * WHAT IT DOES NOT CHECK: that the description is accurate, that the default is
 * sensible, or that the variable is read where it claims to be. Only that a
 * person who reads `.env.example` learns the setting exists.
 */

const SRC_DIR = path.join(process.cwd(), "src");
const ENV_EXAMPLE = path.join(process.cwd(), ".env.example");

/** `process.env.NAME` and `process.env["NAME"]`. */
const DIRECT_READ = /\bprocess\.env\.([A-Z][A-Z0-9_]*)|process\.env\[\s*"([A-Z][A-Z0-9_]*)"\s*\]/g;

/**
 * A name held in a constant and read indirectly — the shape `limits.ts` uses
 * (`env: "OPENPLAN_GTFS_MAX_CATALOG_BYTES"` on a limit descriptor, resolved
 * later through a lookup). Matching only `process.env.X` would have missed
 * EVERY GTFS bound, which is to say it would have missed the defect that caused
 * this file to be written.
 */
const NAMESPACED_STRING_LITERAL =
  /"((?:OPENPLAN_|NEXT_PUBLIC_|SUPABASE_|RESEND_|CRON_|LODES_|ANTHROPIC_|CENSUS_|CHROME_)[A-Z0-9_]+)"/g;

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // `src/test` is excluded: a test may legitimately name an env var it sets
      // for itself (OPENPLAN_RLS_LIVE_TEST), which no operator ever sets.
      if (entry.name === "test" || entry.name === "node_modules") continue;
      sourceFiles(full, found);
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

function environmentNamesReadBySource(): Map<string, string[]> {
  const names = new Map<string, string[]>();

  const record = (name: string, file: string) => {
    if (!APP_ENV_NAMESPACE.test(name)) return;
    const relative = path.relative(process.cwd(), file);
    const sites = names.get(name);
    if (sites) {
      if (!sites.includes(relative)) sites.push(relative);
    } else {
      names.set(name, [relative]);
    }
  };

  for (const file of sourceFiles(SRC_DIR)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(DIRECT_READ)) record(match[1] ?? match[2], file);
    for (const match of source.matchAll(NAMESPACED_STRING_LITERAL)) record(match[1], file);
  }

  return names;
}

describe("every operator setting is discoverable", () => {
  /**
   * NON-VACUITY. The assertion below is "this list is empty", which is equally
   * what a scanner that found no files, no names, or the wrong namespace
   * returns. This repository has shipped that failure — a guard reporting the
   * absence of a problem it never looked for — more than once, so the detector
   * proves itself first.
   */
  it("finds the settings that certainly exist", () => {
    const names = environmentNamesReadBySource();

    expect(sourceFiles(SRC_DIR).length).toBeGreaterThan(500);
    expect(names.size).toBeGreaterThan(40);

    // One from each discovery mechanism: a direct `process.env` read, and a
    // name held in a constant. If the second stops being found, every limit in
    // `src/lib/gtfs/limits.ts` silently leaves the guard's view.
    expect([...names.keys()]).toContain("CRON_SECRET");
    expect([...names.keys()]).toContain("OPENPLAN_GTFS_MAX_CATALOG_BYTES");

    // And a platform variable must NOT be collected — otherwise the guard would
    // demand that `.env.example` document Vercel's own build environment.
    expect([...names.keys()]).not.toContain("VERCEL_GIT_COMMIT_SHA");
    expect([...names.keys()]).not.toContain("NODE_ENV");

    // The excused names ARE collected — they are read by the application — and
    // are filtered later, by the shared list rather than by this file's opinion.
    // Asserting it here is what stops a future edit from "fixing" a failure by
    // narrowing the scanner instead of documenting the setting.
    for (const excused of ENV_EXCUSED_FROM_EXAMPLE) {
      expect([...names.keys()], `${excused} must still be seen by the scanner`).toContain(excused);
    }
  });

  it("names every one of them in .env.example", () => {
    const example = readFileSync(ENV_EXAMPLE, "utf8");
    const names = environmentNamesReadBySource();

    const undocumented = [...names.entries()]
      // A handful of names are deliberately NOT in `.env.example` — see
      // `ENV_EXCUSED_FROM_EXAMPLE`, which is shared with
      // `docs-mechanical-cross-references.test.ts` precisely so the two guards
      // cannot hold different opinions about the same variable. They did, for
      // about an hour on 2026-08-06, and the gate went red with each half
      // correct on its own terms.
      .filter(([name]) => !ENV_EXCUSED_FROM_EXAMPLE.has(name))
      .filter(([name]) => !example.includes(name))
      .map(([name, sites]) => `${name} (read by ${sites[0]}${sites.length > 1 ? ` +${sites.length - 1} more` : ""})`)
      .sort();

    expect(
      undocumented,
      "These settings are read by the application and appear nowhere in .env.example, so nobody " +
        "deploying OpenPlan can discover that they exist. Every one has a working default, which is " +
        "exactly the problem: a deployment that needs a different value behaves plausibly rather " +
        "than visibly wrongly, and the operator never learns there was a number to change. Add each " +
        "to .env.example — commented out, with what it does and what happens when it is unset."
    ).toEqual([]);
  });
});
