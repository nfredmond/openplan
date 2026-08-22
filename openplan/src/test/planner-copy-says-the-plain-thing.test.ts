import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripSourceComments } from "@/test/helpers/source-text";
import {
  BANNED_TERMS,
  PROTECTED_CLAIMS,
  type ProtectedClaim,
} from "@/test/helpers/jargon-ledger";

/**
 * THE VOICE, RATCHETED — and the claim boundaries, held open underneath it.
 *
 * Nathaniel used OpenPlan as a human on 2026-08-13 and said the copy "seems
 * like an agent talking to another agent"; asked whether to teach the
 * vocabulary or hide it, he said "make it much more ELI5". Three lanes are now
 * rewriting copy in parallel. This file is what stops them producing three
 * voices, and — more importantly — what stops a plainer sentence becoming a
 * weaker one.
 *
 * TWO ASSERTIONS, AND THE SECOND IS THE POINT.
 *
 *   1. BANNED TERMS SHRINK. Every term in the ledger has a recorded count of
 *      current occurrences in rendered copy. The count is an EQUALITY, not a
 *      ceiling: a lane that adds one fails, and a lane that removes one ALSO
 *      fails until it lowers the number here. Progress gets banked in the
 *      repository instead of in a chat message nobody reads again.
 *
 *   2. CLAIM BOUNDARIES SURVIVE THE REWRITE. Rewriting copy is how a caveat
 *      gets dropped. Each protected claim declares MEANING TOKENS — the
 *      permission half and the prohibition half — asserted against the ONE file
 *      that defines the sentence. The wording may change completely; both
 *      halves must still be there. Assertion 1 alone would actively reward
 *      deleting a caveat, since deleting text is the cheapest way to lower a
 *      count. These two only make sense together.
 *
 * WHAT THIS CANNOT SEE, said plainly so a green run is not read as "the copy is
 * good":
 *
 *   - It reads JSX TEXT NODES and string literals in a declared list of
 *     copy-only modules. Copy passed through a prop as a variable, or built by
 *     concatenation, is invisible.
 *   - It cannot tell PLANNER copy from OPERATOR copy. `<details>` subtrees are
 *     stripped, because `operator-detail-stays-out-of-planner-copy.test.tsx`
 *     already forces operator text inside one — that disclosure is the only
 *     machine-readable signal for "this is addressed to whoever runs the
 *     deployment". Operator text NOT in a `<details>` is counted as planner
 *     copy, which is a false positive with a real fix: move it.
 *   - It cannot tell whether a sentence is clear, whether it assumes knowledge
 *     a planner lacks, or whether it patronises one who does not. That is
 *     judgement, done in the writing.
 *   - It cannot see nesting, density or layout. jsdom applies no stylesheet and
 *     has no box model. Card depth is measured in a real browser by
 *     `qa-harness/openplan-local-card-nesting-audit.js`.
 *
 * MUTATION-VERIFIED 2026-08-13 — see the round report for which mutation
 * produced which failure.
 */

const APP_ROOT = path.join(__dirname, "..", "..");
const SCANNED_DIRS = ["src/app", "src/components"];

/**
 * Modules that are PURE COPY, scanned as string literals rather than as JSX.
 *
 * These are where the product's voice actually lives — the nav's labels, the
 * Help page's paragraph per module, the participant catalog that renders to
 * residents in 22 languages. A JSX-only scan misses every one of them, which is
 * how "Portal posture" and "Mode: {mode}" reached the public portal.
 *
 * Deliberately a list, not a glob: a glob over `src/lib` drowns in `.select()`
 * projections and enum literals, and a guard whose failures are mostly noise
 * gets silenced rather than fixed.
 */
const COPY_MODULES = [
  "src/lib/help/module-descriptions.ts",
  "src/components/nav/nav-registry.ts",
  "src/lib/engagement/portal-i18n/messages.ts",
  "src/lib/models/county-onramp.ts",
  "src/lib/models/run-modes.ts",
  "src/lib/dashboard/chart-catalog.ts",
];

/** A rendered text node: between a closing `>` and the next `<`, across lines. */
const TEXT_NODE = new RegExp(">([^<>{}]{3,})<", "gs");

/**
 * Things a sentence on screen does not contain and an expression does.
 *
 * Copied rather than shared with
 * `interface-copy-does-not-leak-internal-vocabulary.test.ts` on purpose: that
 * guard's filters are tuned to ITS question (is a raw identifier on screen?),
 * and coupling the two would mean tightening one silently loosens the other.
 */
const LOOKS_LIKE_CODE =
  /!==|===|&&|\|\||\?\?|=>|\.\w+\(|["`;]|\b(?:case|const|let|var|return|function|import|export|typeof|null|undefined)\b/;

/**
 * Operator copy lives inside a `<details>`. Strip those subtrees before
 * counting: a migration name or an env var inside the disclosure is correct
 * there, and counting it would push a lane to delete the fact instead of
 * moving it.
 *
 * BLIND SPOT, stated: a disclosure rendered by a component wrapper rather than
 * a literal `<details>` element is not stripped.
 */
function withoutOperatorDisclosures(source: string): string {
  return source.replace(/<details[\s\S]*?<\/details>/g, " ");
}

function filesUnder(dir: string, extension: string): string[] {
  const absolute = path.join(APP_ROOT, dir);
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(extension)) found.push(full);
    }
  };
  walk(absolute);
  return found;
}

/** Quoted string literals long enough to be a sentence, from a copy module. */
function copyStringsIn(source: string): string[] {
  const cleaned = stripSourceComments(source);
  const found: string[] = [];
  for (const match of cleaned.matchAll(/"((?:\\.|[^"\\]){12,})"/g)) {
    const value = match[1];
    if (!/\s/.test(value)) continue;
    if (/^[a-z0-9_.\-/]+$/i.test(value)) continue;
    found.push(value);
  }
  return found;
}

/** Rendered text nodes from one .tsx file. */
function renderedTextIn(source: string): string[] {
  const cleaned = withoutOperatorDisclosures(stripSourceComments(source));
  const found: string[] = [];
  for (const match of cleaned.matchAll(TEXT_NODE)) {
    const text = match[1].replace(/\s+/g, " ").trim();
    if (!text || LOOKS_LIKE_CODE.test(text)) continue;
    found.push(text);
  }
  return found;
}

/**
 * A term, matched on word boundaries with the ordinary English endings.
 *
 * `\brecord\b` alone would miss "records" — the plural is how the tic actually
 * appears ("invoice records", "report records"), so a guard that only saw the
 * singular would have called the worst offender clean.
 */
function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}(?:s|es|ed|ing)?\\b`, "gi");
}

function countTerms(strings: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of BANNED_TERMS) {
    const pattern = termPattern(entry.term);
    let total = 0;
    for (const text of strings) {
      const matches = text.match(pattern);
      if (matches) total += matches.length;
    }
    counts.set(entry.term, total);
  }
  return counts;
}

function collectCopy(): string[] {
  const rendered = SCANNED_DIRS.flatMap((dir) => filesUnder(dir, ".tsx")).flatMap((file) =>
    renderedTextIn(readFileSync(file, "utf8"))
  );
  const modules = COPY_MODULES.flatMap((file) =>
    copyStringsIn(readFileSync(path.join(APP_ROOT, file), "utf8"))
  );
  return [...rendered, ...modules];
}

/**
 * TODAY'S COUNTS, measured 2026-08-13 before any copy work. An equality:
 * higher fails as a regression, LOWER fails until the number is lowered here in
 * the same commit that improved the copy.
 *
 * A term at 0 is a term the product has stopped saying. Do not delete its row —
 * 0 is the assertion that it stays gone.
 */
const BASELINE: Readonly<Record<string, number>> = {
  artifact: 44,
  attribute: 4,
  basemap: 4,
  basis: 24,
  bootstrap: 0,
  cadence: 4,
  campaign: 71,
  "claim tier": 1,
  compose: 3,
  deterministic: 1,
  downstream: 8,
  durable: 3,
  entity: 1,
  geometry: 12,
  "governance hold": 4,
  ingest: 8,
  input: 42,
  intake: 12,
  lane: 55,
  legible: 1,
  migration: 21,
  mode: 14,
  "moderation queue": 1,
  operator: 46,
  packet: 126,
  payload: 2,
  populate: 1,
  posture: 52,
  preset: 13,
  provenance: 12,
  readiness: 33,
  record: 265,
  registry: 21,
  resolve: 3,
  scaffold: 3,
  schema: 6,
  signal: 8,
  spine: 9,
  "study area": 23,
  submission: 11,
  surface: 15,
  trace: 19,
  upstream: 0,
  workspace: 160,
};

describe("planner copy says the plain thing", () => {
  const copy = collectCopy();

  it("scans enough copy to be worth trusting, and can still see a violation", () => {
    // Without this, every assertion below could pass by finding nothing — the
    // failure mode that turns an unchecked area into one everybody believes is
    // checked.
    expect(copy.length).toBeGreaterThan(2000);

    // POSITIVE CONTROL: the detector must report a real sentence from the RTP
    // document page, and must not report an ordinary planner sentence.
    const jargon = countTerms(["Portfolio posture", "No summary on file for this linked packet record."]);
    expect(jargon.get("posture")).toBe(1);
    expect(jargon.get("packet")).toBe(1);
    expect(jargon.get("record")).toBe(1);

    const clean = countTerms(["Add the projects this plan will fund, and say what each one costs."]);
    expect([...clean.values()].reduce((sum, n) => sum + n, 0)).toBe(0);

    // And operator copy behind a disclosure must not be counted as planner copy.
    const withDisclosure = renderedTextIn(
      "<p>Something did not load.</p><details><summary>For whoever runs this</summary><p>Apply the migration.</p></details>"
    );
    expect(withDisclosure.join(" ")).not.toContain("migration");
  });

  it("uses no term from the ledger more often than the recorded baseline", () => {
    const counts = countTerms(copy);
    const actual: Record<string, number> = {};
    for (const [term, count] of counts) actual[term] = count;

    expect(
      actual,
      "A term of art moved in the wrong direction. If a count ROSE, a lane is " +
        "saying the machine's word for something a planner already has a word for — " +
        "src/test/helpers/jargon-ledger.ts says what to say instead. If a count " +
        "FELL, good: lower the number in BASELINE in the same commit, so the " +
        "improvement is banked and cannot silently come back."
    ).toEqual(BASELINE);
  });
});

/**
 * Claims whose wording lives in one named symbol in one real file. A claim
 * with no symbol is documented in the ledger and NOT asserted here — an
 * assertion that cannot name what it reads cannot fail for the right reason.
 */
const ANCHORED_CLAIMS: ReadonlyArray<ProtectedClaim & { readonly file: string }> =
  PROTECTED_CLAIMS.flatMap((claim) => {
    const file = claim.definedAt.split(" ")[0];
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) return [];
    // `src/lib/**/read-failures.ts` names a PATTERN, not a file.
    if (file.includes("*")) return [];
    if (claim.symbols.length === 0) return [];
    return [{ ...claim, file }];
  });

/**
 * The text of ONE declaration — the sentence as it ships, not the file it
 * ships in.
 *
 * THIS FUNCTION IS THE GUARD. A first version compared meaning tokens against
 * the WHOLE FILE and passed a mutation that deleted "and not good enough to
 * design, permit, or certify anything" straight out of
 * `SCREENING_GRADE_SUMMARY`, because four unrelated sentences further down the
 * same file still matched a prohibition token. The window is what makes the
 * check able to fail.
 *
 * A `const` runs to the terminating `;` at the start of a line or end of a
 * statement; a `function` to the closing brace in column 0; a quoted catalog
 * key to the start of the next key. Comments are stripped first, so a comment
 * explaining a caveat can never stand in for the caveat.
 */
function declarationText(source: string, symbol: string): string | null {
  const cleaned = stripSourceComments(source);
  const isKey = symbol.startsWith('"');
  const anchor = isKey
    ? cleaned.indexOf(`${symbol}:`)
    : cleaned.search(new RegExp(`export (?:const|function) ${symbol}\\b`));
  if (anchor < 0) return null;
  const rest = cleaned.slice(anchor);
  if (isKey) {
    // The next KEY, at the catalog's two-space indent — not the next quoted
    // line, which is usually this key's own wrapped value.
    const next = rest.slice(1).search(/\n {2}"[a-zA-Z]/);
    return next < 0 ? rest : rest.slice(0, next + 1);
  }
  if (/^export function/.test(rest)) {
    const end = rest.indexOf("\n}");
    return end < 0 ? rest : rest.slice(0, end + 2);
  }
  const end = rest.search(/;\s*\n/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

function halvesPresent(text: string, claim: ProtectedClaim): { permission: boolean; prohibition: boolean } {
  const haystack = text.toLowerCase();
  return {
    permission: claim.permission.some((token) => haystack.includes(token.toLowerCase())),
    prohibition: claim.prohibition.some((token) => haystack.includes(token.toLowerCase())),
  };
}

describe("plainer never means weaker", () => {
  it("keeps both halves of every claim boundary alive in the sentence that ships it", () => {
    const broken: string[] = [];
    for (const claim of ANCHORED_CLAIMS) {
      const source = readFileSync(path.join(APP_ROOT, claim.file), "utf8");
      for (const symbol of claim.symbols) {
        const text = declarationText(source, symbol);
        if (text === null) {
          broken.push(`${claim.id}: ${symbol} no longer exists in ${claim.file}`);
          continue;
        }
        const halves = halvesPresent(text, claim);
        if (!halves.permission) broken.push(`${claim.id} (${symbol}): nothing says what the reader MAY conclude`);
        if (!halves.prohibition) broken.push(`${claim.id} (${symbol}): nothing says what they may NOT conclude`);
      }
    }

    expect(
      broken,
      "A claim boundary lost a half. OpenPlan's figures go into grant applications " +
        "and adopted plans: a caveat that keeps only its permission has been WIDENED, " +
        "which is the same defect as deleting it. Reword freely — both halves must " +
        "survive the rewording. The meaning tokens are in jargon-ledger.ts."
    ).toEqual([]);
  });

  it("reads one declaration, not the file around it", () => {
    expect(ANCHORED_CLAIMS.length).toBeGreaterThanOrEqual(10);

    // POSITIVE CONTROL, and the exact mutation that defeated the first version
    // of this guard: the summary widened to its permission half, inside a file
    // whose OTHER sentences still carry prohibitions.
    const source = readFileSync(path.join(APP_ROOT, "src/lib/help/screening-grade.ts"), "utf8");
    const widenedFile = source.replace(
      /Screening-grade means the result is good enough to compare options and set priorities[^"]*/,
      "Screening-grade means the result is good enough to compare options and set priorities."
    );
    expect(widenedFile, "the mutation must actually change the file").not.toEqual(source);

    const claim = PROTECTED_CLAIMS.find((entry) => entry.id === "screening-grade");
    expect(claim).toBeDefined();

    const real = declarationText(source, "SCREENING_GRADE_SUMMARY");
    const widened = declarationText(widenedFile, "SCREENING_GRADE_SUMMARY");
    expect(real).not.toBeNull();
    expect(widened).not.toBeNull();
    expect(halvesPresent(real as string, claim as ProtectedClaim).prohibition).toBe(true);
    expect(halvesPresent(widened as string, claim as ProtectedClaim).prohibition).toBe(false);

    // And the window must be a window: reading the whole file would still see a
    // prohibition after the mutation, which is precisely the false pass.
    expect(halvesPresent(widenedFile, claim as ProtectedClaim).prohibition).toBe(true);
  });
});
