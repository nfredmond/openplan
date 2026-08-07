import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";

/**
 * ONE pending-schema classifier.
 *
 * WHAT WENT WRONG. Twenty local definitions of `looksLikePendingSchema` existed
 * across `src/`, in five different patterns, plus anonymous regexes asking the
 * same question inline. They disagreed. The narrowest — five API routes under
 * `reports/` and `scenarios/` — matched only
 * `/column .* does not exist|schema cache/i`, so a MISSING TABLE was not a
 * pending migration there; the widest — the projects page helper — also matched
 * "could not find the … column". One database error was an expected setup gap on
 * one surface and a hard failure on another, decided by nothing but which file
 * the reader happened to be in.
 *
 * `@/lib/supabase/pending-schema` is the union of all five and the only place
 * the question may be asked. Its own doc comment records the cost of the union
 * (a typo'd column in an untyped `.select()` now degrades quietly) and why that
 * direction was chosen anyway.
 *
 * FIVE THINGS ARE ASSERTED HERE, and they are not the same assertion:
 *
 *   1. LOCAL-COPY RATCHET — no file re-declares `looksLikePendingSchema`. It was
 *      listed as a ceiling because twenty of them could not be migrated in one
 *      reviewable change; all twenty were converted in the same run, so the list
 *      is EMPTY and this is now the plain rule its name always claimed. The
 *      third direction is what forced it down, and it may only ever shrink.
 *   2. NAMED-VARIANT ALLOWLIST — the exact set of `looksLikePending*` definitions
 *      is pinned, so a new name cannot be invented to sidestep (1).
 *   3. INLINE-REGEX RATCHET — the anonymous form of the same detector.
 *   4. CANONICAL BEHAVIOR TABLE — what the one classifier answers.
 *   5. GUARD-THE-GUARD — that the scan reaches the tree at all.
 *
 * EXPECT THIS FILE TO GO RED DURING A MIGRATION WAVE, and do not read that as a
 * regression. Direction (3) of each ratchet fails the moment a listed file is
 * FIXED, because a stale ceiling is a number that has quietly stopped being
 * true. Lower or delete the entry; never raise one. That is exactly what
 * happened on 2026-08-04: all twenty local copies were converted at once and
 * this file went red for succeeding.
 *
 * WHAT REMAINS IS RATCHET (3) — six inline detectors across five files, listed
 * at their true counts below. They are real debt, not an accounting artefact.
 *
 * NO TREE-WIDE TOTAL IS ASSERTED anywhere below. Twice now a guard-the-guard in
 * this repo has asserted "N instances remain" and failed because the debt was
 * PAID, reporting a cleanup as a broken detector. Detectors prove themselves
 * here on synthetic input, which stays true at zero.
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const CANONICAL = path.join(SRC, "lib", "supabase", "pending-schema.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Tests may define and quote detectors freely — they assert on them.
      return entry === "test" ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

/** Every scanned file except the canonical module, which is allowed to be one. */
function scannedFiles(): string[] {
  return sourceFiles(SRC).filter((file) => file !== CANONICAL);
}

// ---------------------------------------------------------------------------
// 1 — LOCAL-COPY RATCHET
// ---------------------------------------------------------------------------

/**
 * Re-measured 2026-08-04 and now EMPTY. May only ever shrink.
 *
 * All twenty files — the data-hub, invoicing, projects, both RTP and the
 * scenarios surfaces, the reports and scenarios route lanes, and the three
 * library helpers — import `looksLikePendingSchema` from
 * `@/lib/supabase/pending-schema` instead of answering the question themselves.
 * A file that re-declares one is a regression to fix, not a number to record.
 */
const KNOWN_LOCAL_COPIES: ReadonlyArray<readonly [string, number]> = [];

/** `function looksLikePendingSchema` — the definition, not a call and not the name in prose. */
const LOCAL_COPY = /function\s+looksLikePendingSchema\b/g;

function localCopyCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of scannedFiles()) {
    // Comments are stripped so a file may still EXPLAIN why its copy diverged;
    // several of the twenty do, and prose is not a second implementation.
    const found = stripComments(readFileSync(file, "utf8")).match(LOCAL_COPY);
    if (found?.length) counts.set(relative(file), found.length);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// 2 — NAMED-VARIANT ALLOWLIST
// ---------------------------------------------------------------------------

/**
 * Every `looksLikePending*` definition in `src/`, as `name@file`.
 *
 * WHY AN EXACT SET rather than another ratchet: a ceiling on the canonical NAME
 * is trivially defeated by picking a different one, and this repo already has
 * fourteen differently-named answers to one question. An exact set makes a new
 * name fail loudly, which is the point — the author then either uses the
 * canonical classifier or argues the narrower scope onto this list.
 *
 * TWO ARE KEEPERS, and they are keepers for DIFFERENT reasons — the distinction
 * matters, because only one of them is safe to call on an arbitrary message:
 *
 *   - `looksLikePendingFinalizerSchema` is CONTENT-anchored. Its body requires
 *     `finalized_by` or `finalized_at` to appear in the message, so it cannot
 *     false-positive on any other failure and cannot be replaced by the union.
 *   - `looksLikePendingStageGateProjectScope` is CALL-SITE anchored, NOT content
 *     anchored: its pattern is the same unanchored narrow subset several others
 *     use. What makes it a keeper is documented at its definition — it is called
 *     on exactly one read, the `project_id`-scoped decision read added by
 *     20260728000011, so the caller can name that migration instead of reporting
 *     a generic outage. Widening it would be harmless; MOVING it would not be.
 *   - `looksLikePendingUniverseColumns` (added 2026-08-07) is CONTENT-anchored
 *     like the finalizer variant: the message must name `poverty_universe` or
 *     `race_universe`. THE UNION WOULD BE WRONG THERE FOR A SHARPER REASON THAN
 *     USUAL. Its route answers a Title VI service-equity question, and the
 *     universes added by 20260805000010 are the denominators the minority and
 *     poverty shares are divided by. A wider classifier would answer "apply the
 *     migrations" to a permission failure or a typo in another projected column,
 *     which on this surface means telling an agency its civil-rights analysis is
 *     one migration away when the real fault is something else entirely.
 *
 * The rest are unanchored subsets of the canonical union and are expected to
 * disappear as their lanes are converted. Delete the entry when that happens —
 * the staleness assertion below will not let a fixed file stay listed.
 *
 * The twenty `looksLikePendingSchema@…` entries that used to sit in the middle
 * of this list are GONE as of 2026-08-04, because the local copies they named
 * are gone. Nothing outside `@/lib/supabase/pending-schema` answers the question
 * under the canonical name any more.
 */
const ALLOWED_VARIANTS: ReadonlyArray<string> = [
  "looksLikePendingAssemblySchema@src/lib/grants/application.ts",
  "looksLikePendingAuthorshipColumns@src/lib/observability/action-audit.ts",
  "looksLikePendingColumn@src/app/(app)/grants/page.tsx",
  "looksLikePendingFinalizerSchema@src/lib/grants/application.ts",
  "looksLikePendingNetworkLinkColumn@src/app/(app)/models/[modelId]/page.tsx",
  "looksLikePendingPlaceColumns@src/app/(app)/county-runs/page.tsx",
  "looksLikePendingPlaceColumns@src/app/(app)/explore/page.tsx",
  "looksLikePendingPlaceColumns@src/app/(app)/safety/page.tsx",
  "looksLikePendingProfileSchema@src/app/api/invoicing/invoices/[invoiceId]/route.ts",
  "looksLikePendingProfileSchema@src/app/api/invoicing/invoices/route.ts",
  "looksLikePendingPursuitSchema@src/lib/grants/pursuit.ts",
  "looksLikePendingReportRunsSchema@src/lib/reports/run-citations.ts",
  "looksLikePendingScenarioSpineSchema@src/lib/scenarios/api.ts",
  "looksLikePendingStageGateProjectScope@src/lib/stage-gates/decision-queries.ts",
  "looksLikePendingUniverseColumns@src/app/api/title-vi/service-equity/route.ts",
];

function definedVariants(): string[] {
  const found: string[] = [];
  for (const file of scannedFiles()) {
    const code = stripComments(readFileSync(file, "utf8"));
    for (const match of code.matchAll(/function\s+(looksLikePending[A-Z]\w*)/g)) {
      found.push(`${match[1]}@${relative(file)}`);
    }
  }
  return found.sort();
}

// ---------------------------------------------------------------------------
// 3 — INLINE-REGEX RATCHET
// ---------------------------------------------------------------------------

/** Block comments and whole-line comments only; a file may still EXPLAIN a pattern. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");
}

/** Index just past the delimiter that closes the one opened before `from`. */
function balancedEnd(source: string, from: number, open: string, close: string): number {
  let depth = 1;
  let i = from;
  while (i < source.length && depth > 0) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) depth -= 1;
    i += 1;
  }
  return i;
}

/**
 * Cut out the bodies of every named `looksLikePending*` detector, so a variant's
 * own regex is not double-counted as an inline one.
 *
 * This is exactly "outside allowlisted variant bodies" BECAUSE of assertion (2)
 * above: that assertion is what guarantees the set of `looksLikePending*`
 * definitions equals the allowlist, so cutting all of them cuts only allowlisted
 * ones. Weakening (2) silently widens this exemption.
 */
function withoutDetectorBodies(source: string): string {
  let out = source;
  for (;;) {
    const match = /function\s+looksLikePending[A-Z]\w*\s*\(/.exec(out);
    if (!match) break;
    const parenEnd = balancedEnd(out, match.index + match[0].length, "(", ")");
    const brace = out.indexOf("{", parenEnd);
    if (brace < 0) break;
    out = out.slice(0, match.index) + out.slice(balancedEnd(out, brace + 1, "{", "}"));
  }
  return out;
}

/**
 * A regex LITERAL, not a string. The leading `/` is what makes this a detector
 * rather than error copy: a page that renders the sentence "column … does not
 * exist" to an operator is telling the truth, not classifying anything.
 */
const REGEX_LITERAL = /\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[gimsuy]*/g;

/**
 * Inline patterns asking the pending-schema question anonymously.
 *
 * "schema cache" alone is enough — nothing else in this product says it. "does
 * not exist" alone is NOT: it appears in ordinary copy and in unrelated
 * assertions, so it must be paired with `relation` or `column` to count.
 */
function inlinePendingSchemaRegexes(source: string): number {
  let count = 0;
  for (const match of withoutDetectorBodies(stripComments(source)).matchAll(REGEX_LITERAL)) {
    const body = match[0].toLowerCase();
    const namesSchemaCache = body.includes("schema cache");
    const namesMissingObject =
      body.includes("does not exist") && (body.includes("relation") || body.includes("column"));
    if (namesSchemaCache || namesMissingObject) count += 1;
  }
  return count;
}

/**
 * Measured 2026-08-04: 6 inline detectors across 5 files. May only shrink.
 *
 * Two of these are deliberately narrow and carry their reasoning at the call
 * site — `campaign-translations.ts` names the exact column an unapplied
 * migration adds, and argues there that answering 503 for a typo would tell
 * every caller to come back later for something that will never arrive. That
 * argument is honest and it is recorded, but the pattern is still a second
 * answer to a question that now has one place to live. Convert or argue; do not
 * leave it unlisted.
 */
const KNOWN_INLINE_DETECTORS: ReadonlyArray<readonly [string, number]> = [
  ["src/app/(app)/reports/[reportId]/_components/_helpers.ts", 2],
  ["src/app/api/analysis/context/route.ts", 1],
  ["src/lib/engagement/campaign-translations.ts", 1],
  ["src/lib/models/evidence-backbone.ts", 1],
  ["src/lib/reports/api.ts", 1],
];

function inlineCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of scannedFiles()) {
    const found = inlinePendingSchemaRegexes(readFileSync(file, "utf8"));
    if (found > 0) counts.set(relative(file), found);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// The three ratchet directions, shared by (1) and (3).
// ---------------------------------------------------------------------------

function ratchet(
  name: string,
  known: ReadonlyArray<readonly [string, number]>,
  measure: () => Map<string, number>,
  fixHint: string
) {
  const listed = new Map(known.map(([file, count]) => [file, count]));

  describe(name, () => {
    it("adds no new file", () => {
      expect([...measure().keys()].filter((file) => !listed.has(file)), fixHint).toEqual([]);
    });

    it("lets no listed file get worse", () => {
      const worsened = [...measure().entries()]
        .filter(([file, count]) => listed.has(file) && count > (listed.get(file) ?? 0))
        .map(([file, count]) => `${file}: ${listed.get(file)} → ${count}`);
      expect(worsened, "these files added another private pending-schema detector").toEqual([]);
    });

    it("keeps the ceiling honest — a fixed file must be removed from the list", () => {
      const actual = measure();
      const stale = known
        .filter(([file, count]) => (actual.get(file) ?? 0) < count)
        .map(
          ([file, count]) =>
            `${file}: listed ${count}, actually ${actual.get(file) ?? 0} — lower or delete this entry`
        );
      expect(stale, "the ratchet moved; update the list").toEqual([]);
    });
  });
}

ratchet(
  "one pending-schema classifier — no local copy of looksLikePendingSchema",
  KNOWN_LOCAL_COPIES,
  localCopyCounts,
  "these files define their own looksLikePendingSchema — import it from @/lib/supabase/pending-schema instead"
);

ratchet(
  "one pending-schema classifier — no inline pending-schema regex",
  KNOWN_INLINE_DETECTORS,
  inlineCounts,
  "these files test a pending-schema regex inline — call looksLikePendingSchema from @/lib/supabase/pending-schema instead"
);

describe("one pending-schema classifier — named variants", () => {
  it("invents no new looksLikePending* name", () => {
    expect(
      definedVariants(),
      "a new pending-schema detector name appeared. Use looksLikePendingSchema from " +
        "@/lib/supabase/pending-schema, or — if the narrower scope is genuinely load-bearing, " +
        "the way the finalizer-column and stage-gate-scope variants are — add it to " +
        "ALLOWED_VARIANTS with the argument for why the union would be wrong there."
    ).toEqual([...ALLOWED_VARIANTS].sort());
  });

  /**
   * The finalizer variant is the one this file claims is CONTENT-anchored, and a
   * claim in a comment is worth nothing on its own. If someone drops the column
   * names from its body it becomes another unanchored subset and the comment
   * above becomes false, so the anchor is asserted rather than described.
   *
   * No equivalent assertion exists for the stage-gate variant ON PURPOSE — it is
   * call-site anchored, its body is an ordinary narrow subset, and asserting a
   * content anchor it does not have would be a false claim in a guard.
   */
  it("keeps the finalizer variant anchored on the columns it is named for", () => {
    const source = readFileSync(path.join(SRC, "lib", "grants", "application.ts"), "utf8");
    const body = source.slice(source.indexOf("function looksLikePendingFinalizerSchema"));
    expect(body.slice(0, body.indexOf("\n}")), "the finalizer detector lost its column anchor").toMatch(
      /finalized_\(\?:by\|at\)|finalized_by|finalized_at/
    );
  });

  /** The same assertion for the other content-anchored variant, same reason. */
  it("keeps the universe variant anchored on the columns it is named for", () => {
    const source = readFileSync(
      path.join(SRC, "app", "api", "title-vi", "service-equity", "route.ts"),
      "utf8"
    );
    const body = source.slice(source.indexOf("function looksLikePendingUniverseColumns"));
    expect(
      body.slice(0, body.indexOf("\n}")),
      "the universe detector lost its column anchor — it would now answer 'apply the migrations' to " +
        "a permission failure on a civil-rights surface"
    ).toMatch(/poverty_universe|race_universe/);
  });
});

// ---------------------------------------------------------------------------
// 4 — CANONICAL BEHAVIOR TABLE
// ---------------------------------------------------------------------------

describe("the canonical classifier answers the five real PostgREST shapes", () => {
  it.each([
    ['relation "public.funding_awards" does not exist', "missing table, Postgres wording (42P01)"],
    ["column funding_awards.closure_basis does not exist", "missing column, Postgres wording (42703)"],
    [
      "Could not find the table 'public.rtp_cycles' in the schema cache",
      "missing table, PostgREST wording (PGRST205)",
    ],
    [
      "Could not find the 'finalized_by' column of 'application_sections' in the schema cache",
      "missing column, PostgREST wording (PGRST204)",
    ],
    [
      "Could not find a relationship between 'reports' and 'projects' in the schema cache",
      "a bare schema-cache message with no 'does not exist'",
    ],
  ])("classifies %j as pending (%s)", (message) => {
    expect(looksLikePendingSchema(message)).toBe(true);
  });

  /**
   * THE ROW THAT MATTERS MOST. A permission failure and an RLS refusal are
   * security-relevant outcomes. Classifying either as a pending migration would
   * answer 503 "apply the latest migrations" to an operator whose migrations are
   * already applied, and would bury the one signal that says a grant or a policy
   * changed. Widening this pattern to swallow them is how that happens.
   */
  it.each([
    ["permission denied for table projects", "a revoked grant is not a missing table"],
    ["JWT expired", "an expired session is not a schema gap"],
    [
      'new row violates row-level security policy for table "projects"',
      "a policy refusal is not a migration to apply",
    ],
  ])("refuses to classify %j as pending (%s)", (message) => {
    expect(looksLikePendingSchema(message)).toBe(false);
  });

  it("treats no message as no classification", () => {
    expect(looksLikePendingSchema(null)).toBe(false);
    expect(looksLikePendingSchema(undefined)).toBe(false);
    expect(looksLikePendingSchema("")).toBe(false);
  });

  /**
   * The union's whole purpose: the shapes the narrow variants missed. The five
   * routes under reports/ and scenarios/ matched neither of these, so a missing
   * TABLE reached a planner as a hard failure there and as a setup notice three
   * files away.
   */
  it("covers the shapes the narrowest variants missed", () => {
    expect(looksLikePendingSchema('relation "public.report_runs" does not exist')).toBe(true);
    expect(looksLikePendingSchema("Could not find the table 'public.report_runs' in the schema cache")).toBe(
      true
    );
  });
});

// ---------------------------------------------------------------------------
// 5 — GUARD-THE-GUARD
// ---------------------------------------------------------------------------

describe("guards the guard", () => {
  it("reaches a populated tree, excludes tests, and excludes the canonical module", () => {
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(files.every((file) => !file.includes(`${path.sep}test${path.sep}`))).toBe(true);
    expect(files.includes(CANONICAL)).toBe(false);
    // The canonical module must still be on disk — an excluded path that no
    // longer exists would make the exclusion above pass for the wrong reason.
    expect(statSync(CANONICAL).isFile()).toBe(true);
  });

  it("runs every detector over every scanned file without throwing", () => {
    const files = scannedFiles();
    let scanned = 0;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(typeof inlinePendingSchemaRegexes(source)).toBe("number");
      expect(Array.isArray(stripComments(source).match(LOCAL_COPY) ?? [])).toBe(true);
      scanned += 1;
    }
    expect(scanned).toBe(files.length);

    // NO TREE-WIDE TOTAL IS ASSERTED. A count of remaining debt fails when the
    // debt is PAID, which reports a cleanup as a broken detector — this repo has
    // done that twice. The synthetic cases below are what keep the detectors
    // honest once the tree reaches zero.
  });

  it("the inline detector fires on a real inline pattern", () => {
    expect(inlinePendingSchemaRegexes(`if (/column .* does not exist|schema cache/i.test(m)) return [];`)).toBe(
      1
    );
    expect(inlinePendingSchemaRegexes(`const P = /relation .* does not exist/i;`)).toBe(1);
  });

  /**
   * PRECISION, which is the half that decides whether anyone trusts this. A
   * false positive here sends someone to "fix" a sentence, and a guard that
   * flags correct code gets overridden and then ignored.
   */
  it("the inline detector spares copy, bare phrases, and allowlisted bodies", () => {
    // Error COPY, not a detector. The words are the same; there is no regex.
    expect(
      inlinePendingSchemaRegexes(`const hint = "The column claim_status does not exist in the schema cache.";`)
    ).toBe(0);
    // "does not exist" with neither anchor — an ordinary sentence or assertion.
    expect(inlinePendingSchemaRegexes(`expect(msg).toMatch(/does not exist/i);`)).toBe(0);
    // A named variant's own body is the allowlist's business, not this ratchet's.
    expect(
      inlinePendingSchemaRegexes(
        `function looksLikePendingThing(m: string | null): boolean {\n  return /column .* does not exist|schema cache/i.test(m ?? "");\n}`
      )
    ).toBe(0);
    // A comment explaining the pattern is not an implementation of it.
    expect(
      inlinePendingSchemaRegexes(`/* matches /relation .* does not exist|schema cache/i */\nconst x = 1;`)
    ).toBe(0);
  });

  /**
   * THE LOCAL-COPY DETECTOR AGAINST REAL SOURCE, which is what an empty ratchet
   * needs and a synthetic string cannot give. With the ratchet at zero, nothing
   * in the SCANNED tree matches `LOCAL_COPY` by design — so a pattern that had
   * silently stopped matching would look identical to a paid-off debt.
   *
   * The one file that must always match is the canonical module, and it is
   * excluded from the scan for exactly that reason. Asserting against it costs
   * nothing and cannot go stale: `pending-schema.ts` losing this definition is a
   * much larger failure than a drifted regex, and it would be caught here first.
   */
  it("the local-copy pattern still matches the canonical definition on disk", () => {
    expect(
      stripComments(readFileSync(CANONICAL, "utf8")).match(LOCAL_COPY) ?? [],
      "LOCAL_COPY no longer matches the definition it is named for — the empty ratchet above is proving nothing"
    ).toHaveLength(1);
  });

  it("the local-copy detector distinguishes a definition from a call", () => {
    expect("export function looksLikePendingSchema(m: string) {".match(LOCAL_COPY)).toHaveLength(1);
    // Importing and calling the canonical one is the FIX, and must never count.
    expect(
      `import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";\nif (looksLikePendingSchema(e.message)) return null;`.match(
        LOCAL_COPY
      )
    ).toBeNull();
    // A longer name is a different function; the variant allowlist owns it.
    expect("function looksLikePendingSchemaForReports(m: string) {".match(LOCAL_COPY)).toBeNull();
  });
});
