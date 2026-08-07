import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE PRODUCT'S OWN VOICE, GUARDED AT THE ONE PLACE A TEST CAN REACH IT.
 *
 * Nathaniel's diagnosis, 2026-07-30: the interface copy "sounds weirdly like a
 * dev in places, almost looking like placeholders" — the voice of the people
 * (and models) BUILDING OpenPlan seeping into the thing they are building. His
 * audience point is the hard half and no test can hold it: planners range from
 * people shaky on planning terminology to people more technical than this
 * codebase, and copy pitched at either end loses the other. Finding that line is
 * judgement, done in the writing.
 *
 * WHAT A TEST *CAN* HOLD is the mechanical half — the moment an internal
 * identifier is rendered verbatim to a planner. Those are not a matter of tone:
 * `calibrated_to_counts` on a checkbox label, `ite_trip_generation` in an empty
 * state. Both shipped, both were found by scanning rather than by reading, and
 * both had a plain-English label sitting unused a few files away.
 *
 * SCOPE, DELIBERATELY NARROW. It reads JSX TEXT NODES — what sits between a
 * closing `>` and the next `<` — in `src/app` and `src/components`. Not props,
 * not template expressions, not `.ts` files. A wider scan drowns in `.select()`
 * strings and type literals, and a guard whose failures are mostly noise gets an
 * allowlist entry rather than a fix, which is how a guard stops working.
 *
 * WHAT IT DOES NOT CHECK, said plainly so nobody reads a green run as "the copy
 * is good": whether a sentence is clear, whether it assumes knowledge a planner
 * does not have, whether it patronises one who does. It catches a raw identifier
 * on screen. That is one defect class out of many in the same area.
 *
 * HONESTY COPY IS NOT A TARGET. "This could not be read" versus "there is none",
 * claim-tier disclosures, machine-translation labels — those are load-bearing
 * and deliberately precise. This guard never asks for one to be softened; it
 * asks for the machine's word to be replaced by the planner's word for the same
 * thing, which is what the tier label functions already exist to do.
 */

const APP_ROOT = path.join(__dirname, "..", "..");
const SCANNED_DIRS = ["src/app", "src/components"];

/**
 * A rendered text node: between a closing `>` and the next `<`.
 *
 * MATCHED ACROSS NEWLINES, and that is not a detail. The first version of this
 * guard scanned line by line, which meant it could only see copy that happened
 * to open and close on one line. Proven by mutation: moving the leaked
 * identifier into ordinary flowing prose inside a multi-line `<p>` made it
 * invisible, and the guard stayed green — a guard that catches a leak only when
 * it is formatted a particular way is worse than none, because everybody
 * believes the area is covered.
 */
const TEXT_NODE = />([^<>{}]{3,})</gs;

/**
 * Two-or-more snake_case segments — the shape of a column or enum name —
 * NOT preceded by a dot.
 *
 * The dot is what separates `calibrated_to_counts` rendered on a checkbox from
 * `milestone.target_date` inside a `.filter()` callback that happens to sit
 * between a `>` and a `<` because of a `!==` earlier on the line. Both look
 * identical to a text-node scan; only one of them is on screen.
 */
const SNAKE_CASE = /(?<![.\w])[a-z][a-z0-9]*_[a-z][a-z0-9_]+\b/;

/**
 * Things a sentence on screen does not contain and an expression does.
 *
 * Matching text nodes across newlines means a `>` that closes one JSX element
 * and a `<` that opens the next, several statements later, look like one very
 * long text node holding all the code between them. This is what tells the two
 * apart: rendered copy in this codebase carries no straight double quote (it
 * uses `&apos;`/`&quot;` or typographic marks), no semicolon, no backtick, and
 * none of these keywords.
 */
const LOOKS_LIKE_CODE =
  /!==|===|&&|\|\||\?\?|=>|\.\w+\(|["`;]|\b(?:case|const|let|var|return|function|import|export|typeof|null|undefined)\b/;

/** Words that mean the copy was never finished. */
const UNFINISHED = /\bTODO\b|\bFIXME\b|\bXXX\b|\bTBD\b|\blorem ipsum\b/i;

/**
 * Paths and filenames a planner is genuinely meant to type or find.
 *
 * These are the legitimate reason a rendered string contains an underscore, and
 * they are recognised by SHAPE rather than listed by name — an operator
 * instruction naming `workers/aequilibrae_worker/DEPLOY.md` is telling somebody
 * where to look, and a new one should not need an allowlist entry.
 */
const LOOKS_LIKE_A_PATH = /[\w./-]*\/[\w./-]*_[\w./-]*|\b[\w-]+_[\w-]+\.(py|md|ts|tsx|sql|json|ya?ml|sh|zip|csv)\b/;

/**
 * Strings that are allowed to carry an internal identifier, each with the reason.
 *
 * A RATCHET, NOT AN ALLOWLIST: every entry is a claim a reviewer can check, and
 * the staleness assertion below fails if one stops matching anything — so a
 * fixed string cannot leave its excuse behind. Adding a line means arguing that
 * a planner is better served by the machine's word than by their own.
 */
const ALLOWED: ReadonlyArray<{ readonly fragment: string; readonly reason: string }> = [
  {
    fragment: "zone_id",
    reason:
      "The network-package upload form telling a planner which property their own GeoJSON must " +
      "carry. Here the machine's word IS the planner's word: they have to type it into their file, " +
      "and any plainer phrasing would leave them guessing at the exact spelling.",
  },
  {
    fragment: "corridor_name",
    reason: "Same form, same reason — a property name a planner writes into their own data.",
  },
];

type Finding = { file: string; line: number; text: string; why: string };

function tsxFilesUnder(dir: string): string[] {
  const absolute = path.join(APP_ROOT, dir);
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".tsx")) found.push(full);
    }
  };
  walk(absolute);
  return found;
}

/**
 * Blank out comments so a note between builders — which this repository writes
 * a great many of, deliberately — is never mistaken for copy. Lengths are
 * preserved so match offsets still map to the right line.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/^[ \t]*\/\/.*$/gm, (line) => " ".repeat(line.length));
}

export function findCopyLeaks(source: string, relative: string): Finding[] {
  const findings: Finding[] = [];
  const cleaned = withoutComments(source);

  for (const match of cleaned.matchAll(TEXT_NODE)) {
    const text = match[1].replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (ALLOWED.some((entry) => text.includes(entry.fragment))) continue;
    // A `>` inside `!==` or `=>` makes an ordinary expression look like a text
    // node. Nothing a planner reads contains these.
    if (LOOKS_LIKE_CODE.test(text)) continue;

    const line = cleaned.slice(0, match.index ?? 0).split("\n").length;

    if (UNFINISHED.test(text)) {
      findings.push({ file: relative, line, text, why: "unfinished copy" });
      continue;
    }
    if (!SNAKE_CASE.test(text)) continue;
    // A path or filename is a thing a planner is meant to find, not an internal
    // name leaking onto the screen.
    if (LOOKS_LIKE_A_PATH.test(text)) continue;
    findings.push({ file: relative, line, text, why: "internal identifier" });
  }
  return findings;
}

function scan(): Finding[] {
  return SCANNED_DIRS.flatMap((dir) =>
    tsxFilesUnder(dir).flatMap((file) =>
      findCopyLeaks(readFileSync(file, "utf8"), path.relative(APP_ROOT, file))
    )
  );
}

describe("interface copy speaks to planners, not about the database", () => {
  it("renders no internal identifier and no unfinished copy", () => {
    const findings = scan();

    expect(
      findings.map((finding) => `${finding.file}:${finding.line} (${finding.why}) — ${finding.text}`),
      "A planner is being shown the machine's word for something. Two of these shipped: " +
        "`calibrated_to_counts` on a run-configuration checkbox and `ite_trip_generation` in an " +
        "empty state — and BOTH had a plain-English label already defined a few files away " +
        "(`modelingClaimStatusLabel`). Use the label function, or write the planner's word for it. " +
        "If the identifier genuinely is what a planner must type or find, it is a path and this " +
        "guard already ignores it."
    ).toEqual([]);
  });

  it("scans enough of the interface to be worth trusting", () => {
    // Without this the assertion above could pass by finding nothing — the
    // failure mode that makes a guard worse than no guard, because it converts
    // an unchecked area into one everybody believes is checked.
    const files = SCANNED_DIRS.flatMap(tsxFilesUnder);
    expect(files.length).toBeGreaterThan(200);

    // And it must still be able to SEE a leak. This is the positive control:
    // the detector is run over a string shaped exactly like the two that
    // shipped, and must report it.
    const leak = '<span className="font-semibold">calibrated_to_counts</span>';
    const rendered = [...leak.matchAll(TEXT_NODE)].map((match) => match[1].trim());
    expect(rendered.some((text) => SNAKE_CASE.test(text) && !LOOKS_LIKE_A_PATH.test(text))).toBe(true);

    // And must NOT report an operator instruction naming a real file.
    const filePath = "<code>workers/aequilibrae_worker/DEPLOY.md</code>";
    const paths = [...filePath.matchAll(TEXT_NODE)].map((match) => match[1].trim());
    expect(paths.every((text) => LOOKS_LIKE_A_PATH.test(text))).toBe(true);
  });

  it("keeps the ratchet honest — a fixed string must lose its excuse", () => {
    const rendered = SCANNED_DIRS.flatMap(tsxFilesUnder)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    const stale = ALLOWED.filter((entry) => !rendered.includes(entry.fragment)).map(
      (entry) => entry.fragment
    );
    expect(stale, "these allowances no longer match any rendered string — delete them").toEqual([]);
  });
});
