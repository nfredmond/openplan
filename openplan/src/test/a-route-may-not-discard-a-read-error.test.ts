import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import {
  arrayDiscardedBindings,
  blankComments,
  checkedResultNames,
  classifiedAndDisclosedNames,
  classifierOnlyBranches,
  dataOnlyCount,
  droppingTheErrorBinding,
  KEPT_ERROR,
  ratchet,
  relative,
  removingTheErrorCheck,
  removingTheErrorDisclosure,
  ROOT,
  sourceFiles,
  statementEnd,
  twoStepClassifierOnly,
  uncheckedResultCount,
} from "./helpers/read-error-detectors";

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
 * WHY NO WALK INTO LIBRARY FUNCTIONS FROM HERE. Library loaders legitimately
 * return a value-plus-error seam for the ROUTE to surface —
 * `loadOpportunityPursuitContext` returns `{ context, error }` and hands the
 * failure up rather than deciding it, which is the correct shape, not a defect.
 * A walk inward from a route could not tell that from a swallow, and a guard
 * that flags correct code is worse than one that misses: the first override
 * teaches everyone downstream that this file is noise, and after that it stops
 * being read at all. The route is where the status is chosen, so the route is
 * where this is checked. `src/lib` is now scanned DIRECTLY, by
 * `a-library-may-not-discard-a-read-error.test.ts`, which answered the question
 * this paragraph deferred: the exemption rule below (any `.error` read, any bare
 * use) already tells a returned seam from a swallow, and was verified against
 * `pursuit.ts` rather than assumed.
 *
 * FIVE DETECTORS, each ratcheted, ALL FIVE SHARED with the page and library
 * guards via `helpers/read-error-detectors.ts`:
 *
 *   R1 — DATA-ONLY DESTRUCTURE. `const { data } = await …`, or the same binding
 *        behind a ternary. The error is not bound, so it cannot be checked even
 *        in principle.
 *   R2 — UNCHECKED RESULT. The whole result is bound to a name, and every use of
 *        that name reads `.data`. The error was available and nobody looked.
 *   R3 — ARRAY DESTRUCTURING. `const [{ data: a }, { data: b }] = await
 *        Promise.all([…])`, which R1 cannot see because its regex anchors on
 *        `const {`.
 *   R4 — A CLASSIFIER AS THE ONLY ERROR BRANCH, inline.
 *   R5 — the same, split across two statements.
 *
 * R3/R4/R5 WERE ADDED 2026-08-04 AND THAT IS THE FINDING, not a tidy-up. This
 * file had carried its OWN copy of R1 and R2 since it was written and had never
 * been asked the other three questions, so it certified 179 routes green while
 * knowing about two of the five shapes — and five R3 sites were sitting in it,
 * two of them feeding an AI close-loop draft with an unread comment set. The
 * local copies are gone with them: one parser, three surfaces, no drift.
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
 * THE R1 AND R2 RATCHETS ARE EMPTY (2026-08-04). Every route listed when this
 * guard was written — 19 data-only destructures across 17 files, and 13 shadowed
 * unchecked results across 2 — was repaired in the same run, so the first
 * assertion of each has become the plain rule its name always claimed. The lists
 * are kept rather than deleted: they are the mechanism that made the cleanup
 * reviewable, and they may only ever shrink. A route that reacquires a discarded
 * read is a regression to fix, not a number to record. R3 carries the five sites
 * nothing had ever looked for; R4 and R5 start empty.
 *
 * That is what the third ratchet direction is for, and it did its job here: this
 * file went red the moment the routes were fixed, because a ceiling that
 * outlives its debt is a number that has quietly stopped being true. Lower or
 * delete the entry. Never raise one.
 *
 * AN EMPTY RATCHET PROVES NOTHING ON ITS OWN, which is why the real-source
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

const API_DIR = path.join(ROOT, "src", "app", "api");

function routeFiles(): string[] {
  return sourceFiles(API_DIR, (entry) => entry === "route.ts");
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

/**
 * R3 — `const [{ data: a }, { data: b }] = await Promise.all([…])`.
 *
 * MEASURED 2026-08-04, THE FIRST TIME THIS SURFACE WAS ASKED. R3/R4/R5 were
 * built for the page guard and inherited by the library guard; nothing had ever
 * run them over `src/app/api`, so this file certified 179 routes green while
 * knowing about two of the five shapes. Five sites were waiting:
 *
 *   closeloop/draft   BOTH bindings — the approved engagement items and their
 *                     categories — feed the AI close-loop draft. A failed items
 *                     read does not fail the request; it hands the model an empty
 *                     comment set and asks it to summarise what the public said.
 *                     That is this defect class at its worst: the output is a
 *                     paragraph, in an agency's voice, about a community that was
 *                     never read.
 *   export            `categories` only (the items binding already keeps its
 *                     error) — a CSV export whose category labels silently blank.
 *   models/…/engagement  both bindings, feeding a run's engagement rollup.
 *
 * The fix is the same one the rest of this file describes: destructure to NAMED
 * results and hand each to `classifyRouteReadFailure`.
 */
const KNOWN_ARRAY_DISCARDED: ReadonlyArray<readonly [string, number]> = [
  ["src/app/api/engagement/campaigns/[campaignId]/closeloop/draft/route.ts", 2],
  ["src/app/api/engagement/campaigns/[campaignId]/export/route.ts", 1],
  ["src/app/api/models/[modelId]/runs/[modelRunId]/engagement/route.ts", 2],
];

/**
 * R4/R5 — a pending-schema classifier used as the only error branch, inline or
 * split across two statements. Measured 2026-08-04: EMPTY across all 179 routes.
 *
 * `api/analysis/context` reads as this shape and is not it: it answers 500 on
 * `result.error && !pending` before the flag is ever used as a ternary test, so
 * the flag is only reachable when the failure really is a pending migration.
 * The detector was corrected to see that (any read of the subject's `.error`
 * outside the classifier argument, within that declaration's scope, is a
 * disclosure) rather than carved out — see `helpers/read-error-detectors.ts`.
 */
const KNOWN_CLASSIFIER_ONLY: ReadonlyArray<readonly [string, number]> = [];
const KNOWN_TWO_STEP_CLASSIFIER: ReadonlyArray<readonly [string, number]> = [];

const CLASSIFY_IT =
  "keep the whole result and pass it to classifyRouteReadFailure from @/lib/http/read-outcome";

ratchet(
  "a route may not discard a read error — data-only destructure",
  KNOWN_DATA_ONLY,
  routeFiles,
  dataOnlyCount,
  `these routes destructure \`{ data }\` and never bind \`error\` — ${CLASSIFY_IT}`,
  "route"
);

ratchet(
  "a route may not discard a read error — unchecked result",
  KNOWN_UNCHECKED_RESULT,
  routeFiles,
  uncheckedResultCount,
  `these routes bind a read result and only ever read \`.data\` — ${CLASSIFY_IT} before using the rows`,
  "route"
);

ratchet(
  "a route may not discard a read error — array destructuring",
  KNOWN_ARRAY_DISCARDED,
  routeFiles,
  arrayDiscardedBindings,
  `these routes destructure \`{ data }\` out of an awaited array without keeping \`error\` — ${CLASSIFY_IT}`,
  "route"
);

ratchet(
  "a route may not classify one failure and swallow the rest",
  KNOWN_CLASSIFIER_ONLY,
  routeFiles,
  classifierOnlyBranches,
  `these routes use looksLikePendingSchema as the ONLY error branch — classify first, then ${CLASSIFY_IT}`,
  "route"
);

ratchet(
  "a route may not split a classifier and its swallow across two statements",
  KNOWN_TWO_STEP_CLASSIFIER,
  routeFiles,
  twoStepClassifierOnly,
  `these routes declare a pending-schema flag and later use it as the ONLY error branch — ${CLASSIFY_IT}`,
  "route"
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

describe("guards the guard", () => {
  it("scans a real route tree", () => {
    const routes = routeFiles();
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.every((file) => file.endsWith(`${path.sep}route.ts`))).toBe(true);
  });

  it("runs every detector over every route without throwing", () => {
    const routes = routeFiles();
    let scanned = 0;
    for (const file of routes) {
      const source = readFileSync(file, "utf8");
      expect(typeof dataOnlyCount(source)).toBe("number");
      expect(typeof uncheckedResultCount(source)).toBe("number");
      expect(typeof arrayDiscardedBindings(source)).toBe("number");
      expect(typeof classifierOnlyBranches(source)).toBe("number");
      expect(typeof twoStepClassifierOnly(source)).toBe("number");
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

    for (const file of routeFiles()) {
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

    for (const file of routeFiles()) {
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

  /**
   * R4/R5 arrive on this surface with EMPTY ratchets, which is exactly the state
   * in which a detector can stop working unnoticed. Their exemption — a result
   * whose error is read again outside the classifier is disclosed, not
   * swallowed — is wide by design, so it is the piece most able to silently
   * swallow everything. Take routes that classify AND disclose, strip only the
   * disclosure, and require the count to rise.
   */
  it("R4/R5 still fire on real route source, not only on synthetic input", () => {
    const candidates: string[] = [];
    const responded: string[] = [];

    for (const file of routeFiles()) {
      const source = readFileSync(file, "utf8");
      const baseline = classifierOnlyBranches(source) + twoStepClassifierOnly(source);
      for (const name of classifiedAndDisclosedNames(source)) {
        candidates.push(`${relative(file)}:${name}`);
        const stripped = removingTheErrorDisclosure(source, name);
        if (classifierOnlyBranches(stripped) + twoStepClassifierOnly(stripped) > baseline) {
          responded.push(`${relative(file)}:${name}`);
        }
      }
    }

    expect(
      candidates.length,
      "no route classifies a read failure and also discloses it, so R4/R5 have no real source to prove their exemption against — write a new proof rather than deleting this one"
    ).toBeGreaterThan(0);
    expect(
      responded.length,
      "R4/R5 stopped matching real route source: removing the disclosure from a classified result did not make it a swallow"
    ).toBeGreaterThan(0);
  });
});

describe("R3/R4/R5 count what they say they count on this surface too", () => {
  it("R3 counts each awaited array binding that drops its error", () => {
    expect(
      arrayDiscardedBindings(
        `const [{ data: itemsData }, { data: categoriesData }] = await Promise.all([a, b]);`
      )
    ).toBe(2);
    // One binding keeps its error — the export route's shape, which must count 1.
    expect(
      arrayDiscardedBindings(
        `const [{ data: categories }, { data: itemsData, error: itemsError }] = await Promise.all([a, b]);`
      )
    ).toBe(1);
    // Named results are R2's business, not R3's.
    expect(arrayDiscardedBindings(`const [itemsResult, categoriesResult] = await Promise.all([a, b]);`)).toBe(0);
    // Not awaited — not a read.
    expect(arrayDiscardedBindings(`const [{ data: a }] = someSyncThing;`)).toBe(0);
  });

  it("R4/R5 count a swallow and spare a route that returns before using the flag", () => {
    expect(classifierOnlyBranches(`const rows = looksLikePendingSchema(r.error?.message) ? [] : (r.data ?? []);`)).toBe(
      1
    );
    // `api/analysis/context`'s shape: everything that is not a pending migration
    // has already answered 500, so the flag cannot stand for another failure.
    expect(
      twoStepClassifierOnly(
        `const r = await supabase.from("x").select("id");\nconst pending = looksLikePendingSchema(r.error?.message);\nif (r.error && !pending) return NextResponse.json({ error: "failed" }, { status: 500 });\nconst rows = pending ? [] : (r.data ?? []);`
      )
    ).toBe(0);
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
