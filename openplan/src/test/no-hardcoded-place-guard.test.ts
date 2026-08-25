import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "@/test/helpers/source-text";

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
  // The published-ceiling module is part of the same evidence catalog: it
  // computes /legal's worst-published-figure from the dated records above,
  // naming each record's source run (2026-08-04, decision #7).
  path.join("src", "lib", "examples", "published-ceiling.ts"),
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

/**
 * Shipped code may not BRANCH on a five-digit place code.
 *
 * WHY THIS EXISTS SEPARATELY from BANNED_PLACE_PATTERNS above. That list names
 * ONE county, so it was blind for months to
 * `input.geographyId.toLowerCase().includes("06061")` in the county-onramp
 * worker payload builder — a different county, the same defect, sitting in the
 * lane the earlier sweep had just cleaned. A guard that enumerates instances
 * cannot see the category.
 *
 * WHAT IT MATCHES, AND WHY NOT SIMPLY EVERY FIVE-DIGIT STRING. A bare scan for
 * quoted five-digit literals was written first and immediately found a `12500`
 * placeholder in a currency input — a false positive of a class that would keep
 * arriving, and a noisy guard gets exemptions bolted on until it means nothing.
 * So the match is scoped to the shape that is actually the defect: a five-digit
 * literal on either side of an equality, or inside a membership test. A FIPS
 * code in a data structure is a registry and is allowed; a FIPS code deciding
 * what the code DOES is not.
 *
 * The exempt codes are Postgres SQLSTATEs that OpenPlan legitimately compares
 * against on the write path. That is a closed external vocabulary with
 * published meanings, which is exactly what a county FIPS is not. Exempting
 * these by VALUE rather than by the shape `something.code === "…"` is
 * deliberate: the shape would also silently excuse `county.code === "06057"`,
 * which is the defect. Every addition here must be a real SQLSTATE, named.
 */
const NON_PLACE_FIVE_DIGIT_CODES: readonly string[] = [
  "42703", // undefined_column — the deploy/migrate degradation path matches it
  "23514", // check_violation
  "23505", // unique_violation
  "23503", // foreign_key_violation
  "22023", // invalid_parameter_value
];

const FIPS_BRANCH =
  /(?:[=!]==?\s*|\.(?:includes|startsWith|endsWith|indexOf)\(\s*|case\s+)["'`](\d{5})["'`]|["'`](\d{5})["'`]\s*[=!]==?/g;

/**
 * Comments are stripped first: a comment that quotes an error code or an
 * example FIPS is prose, not a branch, and prose reaching a matcher has broken
 * five guards in this repository in both directions.
 */
function fipsBranchesIn(source: string): string[] {
  return [...stripSourceComments(source).matchAll(FIPS_BRANCH)]
    .map((match) => match[1] ?? match[2])
    .filter((code) => !NON_PLACE_FIVE_DIGIT_CODES.includes(code));
}

describe("no hardcoded place in shipped product code", () => {
  it("branches on no county FIPS literal", () => {
    const offenders: string[] = [];

    for (const file of shippedSourceFiles()) {
      const relative = path.relative(process.cwd(), file);
      for (const code of fipsBranchesIn(readFileSync(file, "utf8"))) {
        offenders.push(
          `${relative} → branches on "${code}". Geography comes from the user, never from a literal.`
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it("guards that guard — the FIPS scan bites, and it is not merely quiet", () => {
    // The exact expression this guard was written after, and the shapes near it.
    expect(fipsBranchesIn('geographyId.toLowerCase().includes("06061")')).toEqual(["06061"]);
    expect(fipsBranchesIn("if (fips === '06057') return PILOT;")).toEqual(["06057"]);
    expect(fipsBranchesIn('if (`36061` === fips) return NYC;')).toEqual(["36061"]);
    expect(fipsBranchesIn('switch (id) { case "06001": return X; }')).toEqual(["06001"]);
    expect(fipsBranchesIn('COUNTIES.indexOf("48201")')).toEqual(["48201"]);
    // A SQLSTATE match is code, not a place, and must stay silent.
    expect(fipsBranchesIn('if (error.code === "42703") return false;')).toEqual([]);
    // A comment naming a FIPS is prose. A placeholder or a lookup key is data.
    expect(fipsBranchesIn('// e.g. county FIPS "06057"')).toEqual([]);
    expect(fipsBranchesIn('<Input placeholder="12500" />')).toEqual([]);
    expect(fipsBranchesIn('const RATES = { "06057": 1.2 };')).toEqual([]);
    // Wrong length is never a county FIPS.
    expect(fipsBranchesIn('if (state === "06") return CA;')).toEqual([]);
    expect(fipsBranchesIn('if (tract === "06057000100") return T;')).toEqual([]);
  });

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
