import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";

/**
 * A ROUTE MAY NOT DISCARD A READ ERROR.
 *
 * The route-side twin of `a-page-may-not-discard-a-read-error.test.ts`. A
 * Supabase read hands back `null` data for both "there is nothing here" and
 * "this query failed"; a route that answers `{ items: data ?? [] }` with a 200
 * has told its caller the workspace has none of the thing. By then the error is
 * gone — the 200 is the last place the truth existed — and every page rendering
 * that response repeats the claim as its own. This product has shipped that
 * sentence to the PUBLIC twice.
 *
 * SCOPE: `route.ts` files under `src/app/api`, and nothing else.
 *
 * WHY NO WALK INTO LIBRARY FUNCTIONS, deliberately, in v1. Library loaders here
 * legitimately return a value-plus-error seam for the ROUTE to surface —
 * `loadOpportunityPursuitContext` returns `{ context, error }` and hands the
 * failure up rather than deciding it, which is the correct shape, not a defect.
 * It also destructures `{ data, error }` from its own read. A walk inward would
 * reach both and could not tell either from a swallow, and a guard
 * that flags correct code is worse than one that misses: the first override
 * teaches everyone downstream that this file is noise, and after that it stops
 * being read at all. The route is where the status is chosen, so the route is
 * where this is checked. Extending inward needs a way to tell a returned seam
 * from a swallowed error, which is a separate change with its own evidence.
 *
 * TWO DETECTORS, both ratcheted:
 *
 *   R1 — DATA-ONLY DESTRUCTURE. `const { data } = await …`. The error is not
 *        bound, so it cannot be checked even in principle.
 *   R2 — UNCHECKED RESULT. The whole result is bound to a name, and every use of
 *        that name reads `.data`. The error was available and nobody looked.
 *
 * R2 MUST SURVIVE VARIABLE SHADOWING, which is the trap that hid 13 real
 * defects from a plain grep. Two route files declare a result, never check its
 * `.error`, and then LATER re-declare the SAME NAME and check that one properly.
 * A file-wide search for `fundingAwardsResult.error` finds the second one and
 * concludes the first is fine. It is not. So a declaration's scope ENDS at the
 * next re-declaration of its identifier: a later declaration can never vouch for
 * an earlier one.
 *
 * WHAT EXEMPTS A DECLARATION, and why one rule covers all five benign patterns
 * with no special-casing. A declaration is flagged only when at least one use is
 * `IDENT.data` AND EVERY use is an `IDENT.data` access. Any `.error` read, any
 * bare-identifier use, or a reassignment exempts it — which spares, without
 * naming any of them:
 *
 *   - the `for (const [name, result] of [["project", projectResult], …])` loop
 *     that checks the error under an alias (the result appears bare);
 *   - classify-then-RETURN, which reads `.error` before any `?? []`;
 *   - retry-then-check, which reassigns;
 *   - the `[a, b, c].map((r) => r.error).filter(Boolean)` gate (bare in an array);
 *   - count-only queries, which never touch `.data` at all.
 *
 * THE MISS, STATED SO NOBODY MISTAKES GREEN FOR PROVEN: a result handed to a
 * FUNCTION that ignores its error is not flagged. The bare-identifier use
 * exempts it, and distinguishing "passed to something that checks" from "passed
 * to something that swallows" is the same inward walk refused above.
 *
 * BOTH RATCHETS ARE NOW EMPTY (2026-08-04). Every route listed when this guard
 * was written — 19 data-only destructures across 17 files, and 13 shadowed
 * unchecked results across 2 — was repaired in the same run, so the first
 * assertion of each ratchet has become the plain rule its name always claimed.
 * The lists are kept rather than deleted: they are the mechanism that made the
 * cleanup reviewable, and they may only ever shrink. A route that reacquires a
 * discarded read is a regression to fix, not a number to record.
 *
 * That is what the third ratchet direction is for, and it did its job here: this
 * file went red the moment the routes were fixed, because a ceiling that
 * outlives its debt is a number that has quietly stopped being true. Lower or
 * delete the entry. Never raise one.
 *
 * AN EMPTY RATCHET PROVES NOTHING ON ITS OWN, which is why the two real-source
 * responsiveness tests at the bottom now matter more than the ratchets do. A
 * detector that silently stopped matching real route syntax would make every
 * assertion above pass, and would convert an unchecked area into one everybody
 * believes is checked.
 *
 * TO FIX A ROUTE: keep the whole result and call `classifyRouteReadFailure` from
 * `@/lib/http/read-outcome`. It returns `null` when there was no error, a 503
 * when the message is an unapplied migration, and a 500 otherwise. It does not
 * log — keep the route's own audit call, which is what an operator searches for.
 */

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, "src", "app", "api");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === "route.ts" ? [full] : [];
  });
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

// ---------------------------------------------------------------------------
// R1 — data-only destructure
// ---------------------------------------------------------------------------

/**
 * `const { data } = await …` and `const { data: rows } = await …`.
 *
 * The renamed form requires a plain IDENTIFIER after the colon on purpose. It is
 * what excludes `const { data: { user } } = await supabase.auth.getUser()`,
 * which binds nothing called `data` and is the standard session read in every
 * route in this tree.
 */
const DATA_ONLY = /const\s*\{\s*data(?:\s*:\s*[A-Za-z_$][\w$]*)?\s*\}\s*=\s*await/g;

function dataOnlyCount(source: string): number {
  return source.match(DATA_ONLY)?.length ?? 0;
}

// ---------------------------------------------------------------------------
// R2 — unchecked result reads
// ---------------------------------------------------------------------------

/**
 * Blank out comments while PRESERVING every offset, so the scan below can slice
 * by index. A comment naming `result.error` must not vouch for a read, and a
 * comment naming `result.data` must not incriminate one.
 *
 * Whole-line comments only, matching the convention in the page-side guard: a
 * trailing `//` cannot be stripped without a real lexer, because `"https://…"`
 * would go with it.
 */
function blankComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? " ".repeat(line.length) : line))
    .join("\n");
}

/**
 * Index of the `;` that ends the statement starting at `from`.
 *
 * A balanced scan, not a regex. An initializer holds `Promise.all([...])` with
 * arbitrary nesting, and object literals full of semicolon-free commas; a regex
 * that "mostly" found the end would undercount silently, which is the failure
 * mode that makes a guard stop being read.
 */
function statementEnd(source: string, from: number): number {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === ";" && depth === 0) return i;
  }
  return source.length;
}

/** `const x =`, `let x =`, and `const [a, b, c] =`. Object patterns are R1's job. */
const DECLARATION = /\b(?:const|let|var)\s+(?:([A-Za-z_$][\w$]*)|\[([^\]]*)\])\s*(?::[^=]*)?=/g;

type Declaration = { names: string[]; start: number; end: number; initializer: string };

function declarations(source: string): Declaration[] {
  const found: Declaration[] = [];
  for (const match of source.matchAll(DECLARATION)) {
    const start = match.index ?? 0;
    const afterEquals = start + match[0].length;
    const end = statementEnd(source, afterEquals);
    const names = match[1]
      ? [match[1]]
      : match[2]
          .split(",")
          .map((part) => part.trim())
          .filter((part) => /^[A-Za-z_$][\w$]*$/.test(part));
    found.push({ names, start, end, initializer: source.slice(afterEquals, end) });
  }
  return found;
}

/**
 * A database read, in any of the three spellings that matter:
 * `await supabase.from(…)`, the `cond ? await supabase.from(…) : { data: [],
 * error: null }` ternary, and `await Promise.all([… .from(…) …])`. All three
 * reduce to the same question — does the initializer await something that came
 * out of `.from(`.
 */
function isReadDeclaration(initializer: string): boolean {
  return /\bawait\b/.test(initializer) && initializer.includes(".from(");
}

/**
 * What each use of `name` reads: the property name, or `null` for a bare use.
 *
 * The lookbehind excludes `.name`, so `row.result` is not counted as a use of a
 * variable called `result`.
 */
function usesOf(source: string, name: string, from: number, to: number): Array<string | null> {
  const region = source.slice(from, to);
  const identifier = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}(?![\\w$])`, "g");
  const uses: Array<string | null> = [];
  for (const match of region.matchAll(identifier)) {
    const trailing = region.slice((match.index ?? 0) + name.length);
    const property = /^\s*\??\.\s*([A-Za-z_$][\w$]*)/.exec(trailing);
    uses.push(property ? property[1] : null);
  }
  return uses;
}

/**
 * Read results whose error nobody looked at, with the offset just past each
 * declaration — so a proof below can insert a check into REAL source and watch
 * the count fall.
 *
 * The scope rule is the shadowing answer: a declaration's uses are counted only
 * up to the NEXT declaration of the same identifier, because a later,
 * properly-checked declaration cannot vouch for an earlier one.
 */
function uncheckedResults(source: string): Array<{ name: string; endsAt: number }> {
  const code = blankComments(source);
  const declared = declarations(code);
  const found: Array<{ name: string; endsAt: number }> = [];

  for (let i = 0; i < declared.length; i += 1) {
    const declaration = declared[i];
    if (!isReadDeclaration(declaration.initializer)) continue;

    for (const name of declaration.names) {
      const shadow = declared.slice(i + 1).find((later) => later.names.includes(name));
      const uses = usesOf(code, name, declaration.end, shadow ? shadow.start : code.length);
      if (uses.length === 0) continue;
      if (!uses.includes("data")) continue;
      if (!uses.every((use) => use === "data")) continue;
      found.push({ name, endsAt: declaration.end + 1 });
    }
  }

  return found;
}

function uncheckedResultCount(source: string): number {
  return uncheckedResults(source).length;
}

// ---------------------------------------------------------------------------
// The ratchets
// ---------------------------------------------------------------------------

/**
 * Re-measured 2026-08-04 and now EMPTY. May only ever shrink.
 *
 * The 17 routes that used to sit here — the three public `engage/` doors, five
 * engagement campaign routes, the application export, both knowledge-base
 * document routes, the three `map-features` layers, both model-run routes and
 * the project RTP links — all keep the whole result and classify it now.
 */
const KNOWN_DATA_ONLY: ReadonlyArray<readonly [string, number]> = [];

/**
 * Re-measured 2026-08-04 and also EMPTY. May only ever shrink.
 *
 * The 13 sites were 5 in the report generator and 8 in the RTP chapter draft
 * route, each shadowed later in its own file by a second declaration of the same
 * name that WAS checked — which is why a grep found nothing here. Both files now
 * read `.error` before their rows at every one of those declarations.
 */
const KNOWN_UNCHECKED_RESULT: ReadonlyArray<readonly [string, number]> = [];

function countsBy(detect: (source: string) => number): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of routeFiles(API_DIR)) {
    const found = detect(readFileSync(file, "utf8"));
    if (found > 0) counts.set(relative(file), found);
  }
  return counts;
}

function ratchet(
  name: string,
  known: ReadonlyArray<readonly [string, number]>,
  detect: (source: string) => number,
  fixHint: string
) {
  const listed = new Map(known.map(([file, count]) => [file, count]));

  describe(name, () => {
    it("adds no new route", () => {
      expect([...countsBy(detect).keys()].filter((file) => !listed.has(file)), fixHint).toEqual([]);
    });

    it("lets no listed route get worse", () => {
      const worsened = [...countsBy(detect).entries()]
        .filter(([file, count]) => listed.has(file) && count > (listed.get(file) ?? 0))
        .map(([file, count]) => `${file}: ${listed.get(file)} → ${count}`);
      expect(worsened, "these routes added another discarded read error").toEqual([]);
    });

    it("keeps the ceiling honest — a fixed route must be removed from the list", () => {
      const actual = countsBy(detect);
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
  "a route may not discard a read error — data-only destructure",
  KNOWN_DATA_ONLY,
  dataOnlyCount,
  "these routes destructure `{ data }` and never bind `error` — keep the whole result and pass it to classifyRouteReadFailure from @/lib/http/read-outcome"
);

ratchet(
  "a route may not discard a read error — unchecked result",
  KNOWN_UNCHECKED_RESULT,
  uncheckedResultCount,
  "these routes bind a read result and only ever read `.data` — check it with classifyRouteReadFailure from @/lib/http/read-outcome before using the rows"
);

// ---------------------------------------------------------------------------
// The detectors are not vacuous
// ---------------------------------------------------------------------------

describe("R1 counts a data-only destructure and nothing else", () => {
  it("counts both spellings of the defect", () => {
    expect(dataOnlyCount(`const { data } = await supabase.from("x").select();`)).toBe(1);
    expect(dataOnlyCount(`const { data: rows } = await supabase.from("x").select();`)).toBe(1);
  });

  it("spares a read that keeps its error", () => {
    expect(dataOnlyCount(`const { data, error } = await supabase.from("x").select();`)).toBe(0);
    // The renamed-and-kept form, which is what the identifier constraint in
    // DATA_ONLY is protecting: loosen it to `[^}]*` and this shape — the
    // CORRECT one, used in 113 route files — is flagged as the defect.
    expect(dataOnlyCount(`const { data: mission, error } = await supabase.from("x").maybeSingle();`)).toBe(0);
  });

  /**
   * The session read every route in this tree performs. Its binding is a nested
   * PATTERN, not an identifier, so nothing called `data` is ever in scope and
   * there is no error to discard at that position.
   */
  it("spares the nested auth pattern", () => {
    expect(dataOnlyCount(`const { data: { user } } = await supabase.auth.getUser();`)).toBe(0);
    expect(dataOnlyCount(`const {\n  data: { user },\n} = await supabase.auth.getUser();`)).toBe(0);
  });

  it("spares a count-only read and a zod parse", () => {
    expect(dataOnlyCount(`const { count, error } = await supabase.from("x").select("*", { count: "exact" });`)).toBe(0);
    expect(dataOnlyCount(`const { success, data } = requestSchema.safeParse(body);`)).toBe(0);
    expect(dataOnlyCount(`const { data } = requestSchema.safeParse(body);`)).toBe(0);
  });
});

describe("R2 counts an unchecked result and survives shadowing", () => {
  it("counts a result whose error is never read", () => {
    const source = `
      const awardsResult = await supabase.from("funding_awards").select("id");
      const awards = (awardsResult.data ?? []) as Row[];
    `;
    expect(uncheckedResultCount(source)).toBe(1);
  });

  it("counts each unchecked binding of a Promise.all destructure", () => {
    const source = `
      const [linksResult, campaignsResult] = await Promise.all([
        supabase.from("rtp_cycle_project_links").select("id"),
        supabase.from("engagement_campaigns").select("id"),
      ]);
      const links = linksResult.data ?? [];
      const campaigns = campaignsResult.data ?? [];
    `;
    expect(uncheckedResultCount(source)).toBe(2);
  });

  /**
   * THE CASE A FILE-WIDE GREP GETS WRONG, and the reason this detector parses
   * scopes at all. Grepping the whole file for `awardsResult.error` finds the
   * SECOND declaration's check and reports the first read as safe. It is not:
   * the first read's rows were consumed with its error unexamined, and the two
   * declarations have nothing to do with each other.
   */
  it("counts exactly 1 when an unchecked read is shadowed by a checked one", () => {
    const source = `
      const awardsResult = await supabase.from("funding_awards").select("id");
      const awards = (awardsResult.data ?? []) as Row[];

      const awardsResult = await supabase.from("funding_awards").select("id, amount");
      if (awardsResult.error) return NextResponse.json({ error: "no" }, { status: 500 });
      const detailed = awardsResult.data ?? [];
    `;
    expect(uncheckedResultCount(source)).toBe(1);
  });

  it("spares a tuple loop that checks the error under an alias", () => {
    const source = `
      const [projectResult, scenarioResult] = await Promise.all([
        supabase.from("projects").select("id"),
        supabase.from("scenario_sets").select("id"),
      ]);
      for (const [name, result] of [
        ["project", projectResult],
        ["scenario", scenarioResult],
      ] as const) {
        if (result.error) return NextResponse.json({ error: name }, { status: 500 });
      }
      const project = projectResult.data ?? [];
      const scenario = scenarioResult.data ?? [];
    `;
    expect(uncheckedResultCount(source)).toBe(0);
  });

  it("spares classify-then-return", () => {
    const source = `
      const reportsResult = await supabase.from("reports").select("id");
      const failure = classifyRouteReadFailure("reports", reportsResult);
      if (failure) return NextResponse.json(failure.body, { status: failure.status });
      const reports = reportsResult.data ?? [];
    `;
    expect(uncheckedResultCount(source)).toBe(0);
  });

  it("spares retry-then-check", () => {
    const source = `
      let runsResult = await supabase.from("model_runs").select("id, claim_status");
      if (looksLikePendingSchema(runsResult.error?.message)) {
        runsResult = await supabase.from("model_runs").select("id");
      }
      const runs = runsResult.data ?? [];
    `;
    expect(uncheckedResultCount(source)).toBe(0);
  });

  it("spares a map-over-errors gate", () => {
    const source = `
      const [deliverablesResult, risksResult] = await Promise.all([
        supabase.from("project_deliverables").select("id"),
        supabase.from("project_risks").select("id"),
      ]);
      const countErrors = [deliverablesResult, risksResult].map((result) => result.error).filter(Boolean);
      if (countErrors.length > 0) return NextResponse.json({ error: "failed" }, { status: 500 });
      const deliverables = deliverablesResult.data ?? [];
      const risks = risksResult.data ?? [];
    `;
    expect(uncheckedResultCount(source)).toBe(0);
  });

  it("spares a count-only query, which never reads data", () => {
    const source = `
      const totalResult = await supabase.from("reports").select("id", { count: "exact", head: true });
      const total = totalResult.count ?? 0;
    `;
    expect(uncheckedResultCount(source)).toBe(0);
  });

  it("spares a result that is not a database read", () => {
    const source = `
      const parsed = await requestSchema.parseAsync(body);
      const values = parsed.data ?? [];
    `;
    expect(uncheckedResultCount(source)).toBe(0);
  });

  /**
   * The documented MISS, asserted rather than described — so that a later change
   * claiming to close it has something to turn red. A result handed to a helper
   * is exempt because the bare use could equally be a check.
   */
  it("does NOT flag a result handed to a function that ignores its error", () => {
    const source = `
      const rowsResult = await supabase.from("reports").select("id");
      const rows = pluckRows(rowsResult);
    `;
    expect(uncheckedResultCount(source)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Real-source responsiveness — the proof machinery an EMPTY ratchet needs
// ---------------------------------------------------------------------------

/** `const { data, error } = await …` — the correct shape, which R1 must not flag. */
const KEPT_ERROR = /const(\s*\{\s*data(?:\s*:\s*[A-Za-z_$][\w$]*)?)\s*,\s*error(?:\s*:\s*[A-Za-z_$][\w$]*)?\s*\}\s*=\s*await/g;

/** Drop the `error` binding, leaving the `data` one exactly as it was written. */
function droppingTheErrorBinding(source: string): string {
  return source.replace(KEPT_ERROR, "const$1 } = await");
}

/**
 * Read results this file both binds AND checks: every use is `.data` or
 * `.error`, with at least one of each.
 *
 * A result also used BARE is skipped, because R2 exempts those however they are
 * rewritten — including one in the candidate set would make the proof below
 * report a miss that is documented behaviour, not a broken detector.
 */
function checkedResultNames(source: string): string[] {
  const code = blankComments(source);
  const declared = declarations(code);
  const names: string[] = [];

  for (let i = 0; i < declared.length; i += 1) {
    const declaration = declared[i];
    if (!isReadDeclaration(declaration.initializer)) continue;

    for (const name of declaration.names) {
      const shadow = declared.slice(i + 1).find((later) => later.names.includes(name));
      const uses = usesOf(code, name, declaration.end, shadow ? shadow.start : code.length);
      if (!uses.includes("error") || !uses.includes("data")) continue;
      if (!uses.every((use) => use === "error" || use === "data")) continue;
      names.push(name);
    }
  }

  return names;
}

/** Rewrite every `NAME.error` read into a `.data` read — the smallest edit that un-checks one result. */
function removingTheErrorCheck(source: string, name: string): string {
  return source.replace(
    new RegExp(`\\b${name.replace(/\$/g, "\\$")}(\\s*\\??\\s*)\\.(\\s*)error\\b`, "g"),
    `${name}$1.$2data`
  );
}

describe("guards the guard", () => {
  it("scans a real route tree", () => {
    const routes = routeFiles(API_DIR);
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.every((file) => file.endsWith(`${path.sep}route.ts`))).toBe(true);
  });

  it("runs both detectors over every route without throwing", () => {
    const routes = routeFiles(API_DIR);
    let scanned = 0;
    for (const file of routes) {
      const source = readFileSync(file, "utf8");
      expect(typeof dataOnlyCount(source)).toBe("number");
      expect(typeof uncheckedResultCount(source)).toBe("number");
      scanned += 1;
    }
    expect(scanned).toBe(routes.length);

    // NO TREE-WIDE TOTAL IS ASSERTED. A count of remaining debt fails when the
    // debt is PAID, reporting a cleanup as a broken detector — this repo has
    // done that twice. The synthetic cases above hold once the tree reaches zero.
  });

  it("blanks comments without moving any offset", () => {
    const source = `const a = 1; // result.error\n/* result.data */\nconst b = 2;`;
    const blanked = blankComments(source);
    expect(blanked).toHaveLength(source.length);
    expect(blanked.split("\n").map((line) => line.length)).toEqual(
      source.split("\n").map((line) => line.length)
    );
    expect(blanked).not.toContain("result.data");
  });

  it("finds the end of a statement whose initializer nests", () => {
    const source = `const r = await Promise.all([f(a; b), g({ x: 1 })]); const s = 2;`;
    expect(statementEnd(source, source.indexOf("await"))).toBe(source.indexOf(");") + 1);
  });

  /**
   * REAL-SOURCE RESPONSIVENESS, and the reason the two tests below are shaped
   * the way they are.
   *
   * WHAT THEY REPLACE. The proof that stood here pointed at
   * `KNOWN_UNCHECKED_RESULT[0]`, read that route off disk, and asserted the
   * listed count still stood in it. It failed the moment the route was FIXED —
   * the exact trap this repo has now walked into three times: an assertion about
   * remaining DEBT reports a cleanup as a broken detector, and the guard goes
   * red for succeeding.
   *
   * So these assert nothing about debt. They take routes that are CORRECT,
   * remove the thing that makes them correct, and require the detector to
   * notice. That population GROWS as routes are fixed; paying debt off cannot
   * empty it, which is precisely the property the old proof lacked. No file path
   * and no count is written into either test — both are derived from the tree.
   *
   * The patch is applied IN MEMORY, never on disk: other agents hold uncommitted
   * work in this tree, and a mutate-then-restore on a file this lane does not own
   * can lose their edit between the two writes. The detectors read source as a
   * string either way, so the evidence is the same and the risk is not.
   */
  it("R1 still fires on real route source, not only on synthetic input", () => {
    const candidates: string[] = [];
    const responded: string[] = [];

    for (const file of routeFiles(API_DIR)) {
      const source = readFileSync(file, "utf8");
      if (!source.match(KEPT_ERROR)) continue;
      candidates.push(relative(file));
      if (dataOnlyCount(droppingTheErrorBinding(source)) > dataOnlyCount(source)) {
        responded.push(relative(file));
      }
    }

    expect(
      candidates.length,
      "no route destructures `{ data, error }` any more, so R1 has no real source to prove itself against — write a new proof rather than deleting this one"
    ).toBeGreaterThan(0);
    expect(
      responded.length,
      "R1 stopped matching real route source: dropping the `error` binding out of a correct destructure changed nothing"
    ).toBeGreaterThan(0);
  });

  it("R2 still fires on real route source, not only on synthetic input", () => {
    const candidates: string[] = [];
    const responded: string[] = [];

    for (const file of routeFiles(API_DIR)) {
      const source = readFileSync(file, "utf8");
      const baseline = uncheckedResultCount(source);
      for (const name of checkedResultNames(source)) {
        candidates.push(`${relative(file)}:${name}`);
        if (uncheckedResultCount(removingTheErrorCheck(source, name)) > baseline) {
          responded.push(`${relative(file)}:${name}`);
        }
      }
    }

    expect(
      candidates.length,
      "no route binds a read result and checks its error, so R2 has no real source to prove itself against — write a new proof rather than deleting this one"
    ).toBeGreaterThan(0);
    expect(
      responded.length,
      "R2 stopped matching real route source: turning a checked result's `.error` reads into `.data` reads did not make it unchecked"
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// classifyRouteReadFailure — the answer the fixed routes will give
// ---------------------------------------------------------------------------

describe("classifyRouteReadFailure", () => {
  it("returns null when the read carried no error", () => {
    expect(classifyRouteReadFailure("reports", { data: [], error: null })).toBeNull();
    expect(classifyRouteReadFailure("reports", { data: null, error: undefined })).toBeNull();
    // A read with no result object at all is not something this can describe;
    // inventing a 500 would report a failure that may not have happened.
    expect(classifyRouteReadFailure("reports", null)).toBeNull();
    expect(classifyRouteReadFailure("reports", undefined)).toBeNull();
  });

  it("answers 503 for an unapplied migration and says which action fixes it", () => {
    const failure = classifyRouteReadFailure("reports", {
      error: { message: 'relation "public.reports" does not exist' },
    });
    expect(failure?.status).toBe(503);
    expect(failure?.pending).toBe(true);
    expect(failure?.body.error).toBe("Reports schema is not available yet");
    expect(failure?.body.hint).toContain("migrations");
  });

  it("lets a route supply the wording its module is known by", () => {
    const failure = classifyRouteReadFailure("knowledge base documents", {
      error: { message: "Could not find the table 'public.kb_documents' in the schema cache" },
    }, {
      pendingError: "Knowledge Base schema is not available yet",
      pendingHint: "Apply the latest Supabase migrations before using the Knowledge Base.",
    });
    expect(failure?.status).toBe(503);
    expect(failure?.body).toEqual({
      error: "Knowledge Base schema is not available yet",
      hint: "Apply the latest Supabase migrations before using the Knowledge Base.",
    });
  });

  /**
   * THE ROW THIS MODULE EXISTS FOR. A permission failure is not a setup step and
   * not an empty result. It must arrive as a 500 that names the failure, so the
   * client cannot render it as "none" and an operator cannot be told to apply a
   * migration that is already applied.
   */
  it("answers 500 for a permission failure and denies the empty-result reading", () => {
    const failure = classifyRouteReadFailure("funding awards", {
      error: { message: "permission denied for table funding_awards" },
    });
    expect(failure?.status).toBe(500);
    expect(failure?.pending).toBe(false);
    expect(failure?.body.error).toBe("Failed to load funding awards");
    expect(failure?.body.hint).toBe("This is a read failure, not an empty result.");
  });

  it("hands the database's own words back for the route's audit call", () => {
    expect(
      classifyRouteReadFailure("reports", { error: { message: "  JWT expired  " } })?.message
    ).toBe("JWT expired");
    // An error with nothing to say still gets a message, because an audit entry
    // reading `undefined` tells an operator less than one that says so.
    expect(classifyRouteReadFailure("reports", { error: { message: null } })?.message).toBe(
      "no message reported"
    );
    expect(classifyRouteReadFailure("reports", { error: {} })?.message).toBe("no message reported");
  });

  it("leads the 503 with a capital and leaves the 500 subject as written", () => {
    const pending = classifyRouteReadFailure("scenario spine", {
      error: { message: "column scenario_sets.spine_version does not exist" },
    });
    expect(pending?.body.error).toBe("Scenario spine schema is not available yet");

    const failed = classifyRouteReadFailure("scenario spine", {
      error: { message: "connection terminated unexpectedly" },
    });
    expect(failed?.body.error).toBe("Failed to load scenario spine");
  });
});
