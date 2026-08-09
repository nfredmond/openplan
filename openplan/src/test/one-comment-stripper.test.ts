import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "@/test/helpers/source-text";

/**
 * ONE COMMENT STRIPPER, AND THE LIST MAY ONLY SHRINK.
 *
 * Five guards were broken in one day by a comment reaching the matcher — in
 * BOTH directions, a comment making a check pass and a comment making one fail.
 * The fix was a single tested helper (`helpers/source-text.ts`). This is the
 * part that makes the fix hold, because the reason four copies existed is that
 * nothing stopped a fifth.
 *
 * AND THE FIRST INVENTORY WAS WRONG, which is why this scans for the REGEX
 * rather than for a name. That count came from grepping for the identifiers
 * `stripComments` / `withoutComments`, so it found four and missed every file
 * that inlines the same regex without naming a function. There were seven more.
 * Searching for a label instead of the artifact is the very mistake this whole
 * area is about; the detector below matches the thing itself.
 *
 * WHY THE REMAINING SEVEN ARE ALLOWLISTED RATHER THAN FIXED HERE. Six of them
 * sit in lanes another session is actively working in, and editing across that
 * seam mid-flight is how uncommitted work gets destroyed. They are recorded so
 * whoever next touches one migrates it, and so the number cannot quietly grow
 * in the meantime.
 *
 * SIX OF THE SEVEN STRIP BLOCK COMMENTS ONLY, so a `//` comment still defeats
 * them. That is not a hypothetical: it is the same hole, six more times, and it
 * is why an entry here is a debt rather than an exemption.
 */

const TEST_ROOT = path.join(process.cwd(), "src");
const SHARED_HELPER = "src/test/helpers/source-text.ts";
const THIS_GUARD = "src/test/one-comment-stripper.test.ts";

/**
 * The block-comment-stripping regex, matched as source text.
 *
 * Deliberately narrow: it looks for the exact `/\*[\s\S]*?\*\/` construction
 * every private copy uses, not for the word "comment". A guard that matched
 * prose about comment stripping would be the joke writing itself.
 */
const PRIVATE_STRIPPER = /replace\(\s*\/\\\/\\\*\[\\s\\S\]\*\?\\\*\\\/\/[a-z]*\s*,/;

/**
 * Files that still carry their own stripper. SHRINK-ONLY: migrating one to
 * `stripSourceComments` and deleting its entry is the intended change. Adding
 * an entry is not — write the guard against the shared helper instead.
 *
 * Marked `blockOnly` where a `//` comment still defeats the guard, so the debt
 * is legible rather than uniform.
 */
const KNOWN_PRIVATE_STRIPPERS: Record<string, { blockOnly: boolean; lane: string }> = {
  // EMPTY, as of 2026-08-09. All eleven private strippers are migrated: four
  // in c135c42d, four by the concurrent session in d5e68a1d, three here.
  //
  // An empty list is the point of a shrink-only ratchet, not a reason to delete
  // it — the guard's job now is to keep it empty. Adding an entry back is
  // allowed only with the reason written down; reaching for one usually means
  // the shared helper needs a case, not that a file needs its own copy.
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

function filesWithAPrivateStripper(): string[] {
  return sourceFiles(TEST_ROOT)
    .map((full) => path.relative(process.cwd(), full).split(path.sep).join("/"))
    .filter((rel) => rel !== SHARED_HELPER && rel !== THIS_GUARD)
    .filter((rel) => PRIVATE_STRIPPER.test(readFileSync(path.join(process.cwd(), rel), "utf8")));
}

describe("comment stripping lives in one place", () => {
  it("detects a private stripper at all — this guard is not vacuous", () => {
    // If the detector stops matching, every assertion below passes by finding
    // nothing. Proven against the exact construction the copies use.
    const sample = 'const clean = source.replace(/\\/\\*[\\s\\S]*?\\*\\//g, "");';
    expect(PRIVATE_STRIPPER.test(sample)).toBe(true);
    // ...and does NOT match prose describing one.
    expect(PRIVATE_STRIPPER.test("// strips /* block */ comments from source")).toBe(false);
  });

  it("adds no new private stripper", () => {
    const unlisted = filesWithAPrivateStripper().filter(
      (file) => !(file in KNOWN_PRIVATE_STRIPPERS)
    );

    expect(
      unlisted,
      `${unlisted.join(", ")} rolls its own comment stripper. Import stripSourceComments from ` +
        "@/test/helpers/source-text instead: four private copies existed and no two behaved alike, " +
        "two of them missing trailing comments entirely. If you genuinely need different behaviour, " +
        "add it to the shared helper with a test, not to a file nobody will find."
    ).toEqual([]);
  });

  it("keeps the known list honest — an entry that no longer applies must go", () => {
    // A stale entry is worse than none: it says a debt exists where it does not,
    // and it hides the fact that the count went down.
    const actual = new Set(filesWithAPrivateStripper());
    const stale = Object.keys(KNOWN_PRIVATE_STRIPPERS).filter((file) => !actual.has(file));

    expect(
      stale,
      `${stale.join(", ")} no longer has a private stripper — delete the entry so the ratchet ` +
        "records the improvement."
    ).toEqual([]);
  });

  it("uses the shared helper for its own scanning", () => {
    // Eating the cooking: this guard reads source too, so a comment quoting the
    // regex must not register as a stripper.
    const prose = [
      "// Historically this file used source.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '') and should not.",
      "const clean = stripSourceComments(source);",
    ].join("\n");

    expect(PRIVATE_STRIPPER.test(stripSourceComments(prose))).toBe(false);
  });
});
