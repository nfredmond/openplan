import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OpenPlan must work for any agency, anywhere in the US — CLAUDE.md
 * non-negotiables #0 and #1. This guard exists because that promise had
 * quietly rotted from the inside:
 *
 *   - Nine create-flow placeholders told every new agency, in every state, to
 *     name their first program / plan / project / RTP cycle after one county.
 *   - A county-specific evidence component rendered inside the authed app,
 *     gated on a run-name string match.
 *   - The model detail page decided whether a workspace had a passing county
 *     run by comparing against a constant exported from that same county's
 *     example module — runtime business logic keyed to a place.
 *   - The sketch-ABM zone grid anchored synthetic centroids there.
 *   - A 503 KB file of that county's link volumes was served publicly with no
 *     referrer at all.
 *
 * None of it was visible from any single file, which is precisely why it
 * survived. This asserts the cleanup holds.
 *
 * WHAT IS DELIBERATELY NOT BANNED: the STATE of Nevada. National data sources
 * legitimately name states — FARS encodes state FIPS 32, the CCRS county-code
 * table is a California reference, and `county-utils.ts` maps every state name
 * to its abbreviation. Banning the bare word would force those honest
 * references into hiding, so this bans the county and the agency instead.
 */

const SRC = path.join(process.cwd(), "src");

/**
 * The pilot county, the pilot agency, and its towns/corridors — the literals
 * that made the product look like one place's software.
 */
const BANNED_PLACE_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  { label: "Nevada County (the pilot county)", pattern: /nevada\s+county|nevada[-_]county/i },
  { label: "NCTC (the pilot agency)", pattern: /\bnctc\b/i },
  { label: "Grass Valley", pattern: /grass\s+valley/i },
  { label: "Nevada City", pattern: /nevada\s+city/i },
  { label: "the pilot county FIPS (06057)", pattern: /\b06057\b/ },
];

/**
 * The public evidence catalog is a dated record of one real validated run, kept
 * deliberately: it is honest proof that a screening run happened and was
 * checked against observed counts. It is evidence ABOUT a place, not the
 * product being fitted TO one — and it is the only place allowed to say so.
 */
const ALLOWLIST: readonly string[] = [
  path.join("src", "lib", "examples", "nevada-county-2026-03-24.ts"),
  path.join("src", "app", "(public)", "examples", "page.tsx"),
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(full) ? [full] : [];
  });
}

/**
 * Tests are scanned separately from shipped code. A fixture string naming a
 * county is untidy; a placeholder or a runtime branch naming one is a defect.
 * This guard is about the second.
 */
function shippedSourceFiles(): string[] {
  const testDir = path.join(SRC, "test");
  return walk(SRC).filter((file) => !file.startsWith(testDir));
}

describe("no hardcoded place in shipped product code", () => {
  it("names no pilot county or agency outside the public evidence catalog", () => {
    const offenders: string[] = [];

    for (const file of shippedSourceFiles()) {
      const relative = path.relative(process.cwd(), file);
      if (ALLOWLIST.some((allowed) => relative.endsWith(allowed))) continue;

      const contents = readFileSync(file, "utf8");
      for (const { label, pattern } of BANNED_PLACE_PATTERNS) {
        if (pattern.test(contents)) offenders.push(`${relative} → ${label}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist honest — every entry must exist and still need the exemption", () => {
    for (const allowed of ALLOWLIST) {
      const full = path.join(process.cwd(), allowed);
      const contents = readFileSync(full, "utf8");
      const stillMatches = BANNED_PLACE_PATTERNS.some(({ pattern }) => pattern.test(contents));
      expect(
        stillMatches,
        `${allowed} is allowlisted but no longer names the pilot place — drop it from the allowlist`
      ).toBe(true);
    }
  });

  it("guards the guard — the scan reaches shipped files and the patterns bite", () => {
    const files = shippedSourceFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((file) => file.includes(path.join("src", "components")))).toBe(true);
    // The allowlisted evidence module must be inside the scanned set, or the
    // allowlist above would be silently pointless.
    expect(files.some((file) => file.endsWith(ALLOWLIST[0]))).toBe(true);
    expect(BANNED_PLACE_PATTERNS.some(({ pattern }) => pattern.test("Nevada County Transportation"))).toBe(true);
    expect(BANNED_PLACE_PATTERNS.some(({ pattern }) => pattern.test("nevada-county-runtime"))).toBe(true);
    // The state, and a state-name lookup table, must NOT trip it.
    expect(BANNED_PLACE_PATTERNS.some(({ pattern }) => pattern.test('Nevada: "NV"'))).toBe(false);
    expect(BANNED_PLACE_PATTERNS.some(({ pattern }) => pattern.test("state FIPS 32 = Nevada"))).toBe(false);
  });
});
