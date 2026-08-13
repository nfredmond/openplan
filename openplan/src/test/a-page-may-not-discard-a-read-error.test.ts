import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  arrayDiscardedBindings,
  checkedResultNames,
  classifierOnlyBranches,
  countsBy,
  dataOnlyCount,
  droppingTheErrorBinding,
  errorTernarySwallows,
  KEPT_ERROR,
  ratchet,
  relative,
  removingTheErrorCheck,
  ROOT,
  sourceFiles,
  twoStepClassifierOnly,
  uncheckedResultCount,
} from "./helpers/read-error-detectors";

/**
 * A PAGE MAY NOT DISCARD A READ ERROR.
 *
 * `const { data } = await supabase.from(...)` hands back `null` for both "there
 * is nothing here" and "this query failed". A page that destructures only `data`
 * cannot tell the two apart, so every empty-state sentence it renders — written
 * for the first case — states the second one as fact.
 *
 * This is not hypothetical and it is not rare. Two shipped instances, both on
 * surfaces the PUBLIC reads:
 *
 *   - the public plan page rendered "No projects have been published for this
 *     plan yet", an agency publicly stating it had funded nothing, because a
 *     read failed;
 *   - the engagement portal rendered "No published feedback yet. Be the first to
 *     share something", telling residents nobody in their community had taken
 *     part, on the strength of a broken query.
 *
 * WHY A RATCHET RATHER THAN A CLEAN ASSERTION. There were 23 of these across 13
 * pages when this guard was written. Fixing them all in one change would have
 * been a large, unreviewable diff, and a plain assertion would have had to be
 * disabled until that landed — which is how a guard becomes decoration. So the
 * list below was a CEILING that could only fall.
 *
 * THE DEBT WAS PAID (2026-08-03) AND THEN THE DETECTOR GOT BETTER (2026-08-04).
 * All 13 pages were fixed in one coordinated run and `KNOWN_DISCARDED` went
 * empty. Widening R1 to see the conditional spelling — `const { data: rows } =
 * ids.length ? await supabase.from(…) : { data: [] }`, previously a documented
 * miss — then found four live sites on two pages. They are recorded on the
 * ratchet with the whole story at its definition below. The lesson is worth more
 * than the four sites: an empty ratchet measures the DETECTOR as much as the
 * tree, and this one was reading "no page discards a read error" while four did.
 *
 * The list may not grow for any other reason: a page that reacquires a discarded
 * read is a regression to fix, not a number to record.
 *
 * THE DETECTORS NOW LIVE IN `helpers/read-error-detectors.ts`, NOT HERE, and
 * that move is the point of the 2026-08-04 change. The same shapes are checked
 * over three surfaces — pages, API routes, and library/component code — and
 * three hand-maintained copies of a parser would drift. They are unit-tested
 * below on positive AND negative cases, because a detector that finds nothing
 * makes every ratchet above it pass.
 *
 * FIVE SHAPES ARE CAUGHT, each with its own ratchet:
 *
 *   - R1 DATA-ONLY DESTRUCTURE. `const { data } = await …`, and — since
 *     2026-08-04 — the same binding behind a ternary. The error is not bound, so
 *     it cannot be checked even in principle. Four sites, both facts recorded at
 *     the ratchet.
 *   - R2 UNCHECKED RESULT. The whole result is bound to a name and every use of
 *     that name reads `.data`. The error was there and nobody looked. THIS WAS
 *     MISSING FROM THIS FILE UNTIL 2026-08-04 and is the reason for the port:
 *     the ROUTE guard had it, nothing ran it over pages, and six pages carrying
 *     the exact shape were being certified green here. See the ratchet.
 *   - R3 ARRAY DESTRUCTURING. `const [{ data: a }, { data: b }] = await
 *     Promise.all([...])` never matches R1, because that regex anchors on
 *     `const {`. Empty — safety, grants and the reports registry were cleared
 *     2026-08-04. (An earlier draft of this header said 14 and named the
 *     dashboard as well, which was wrong: the dashboard destructures to NAMED
 *     results and checks `.error`. A number written into a comment is a claim
 *     like any other; this one was checked.)
 *   - R4 A CLASSIFIER USED AS THE ONLY ERROR BRANCH, INLINE.
 *     `looksLikePendingSchema(x.error?.message) ? [] : (x.data ?? [])` keeps the
 *     error and then throws it away: it classifies exactly one failure (a
 *     pending migration) and turns every other one — revoked grant, RLS change,
 *     dropped connection — into `[]`, i.e. an answer. There were 16, all on the
 *     project detail page; all collected now. (An earlier count said 17 and
 *     included /rtp; that was WRONG — /rtp's ternary is a retry that preserves
 *     the original result for collection, and the detector excludes that shape.)
 *   - R5 THE SAME THING IN TWO STEPS, which R4 cannot see at all:
 *     `const xPending = looksLikePendingSchema(r.error?.message)` on one line and
 *     `xPending ? [] : (r.data ?? [])` fifty lines later. R4 requires the `?`
 *     within ten characters of the call, so every lane written this way read as
 *     clean. Six sat on the project detail page — the corridor, linked-cycle,
 *     workspace-cycle, report, report-artifact and crash-ingest lanes. Five fed
 *     the spine crosslink board, which stamped each one "Not linked" directly
 *     under a banner promising that a failed read is shown as unavailable rather
 *     than as zero; the sixth fed the map presence panel. All six are collected.
 *
 * WHAT R4/R5 DELIBERATELY DO NOT DO, and why that is the safe choice. They do
 * NOT try to prove the flag reaches something that discloses it — flag flow
 * through object literals, props and RSC boundaries is not statically decidable,
 * and a guard that flags CORRECT code teaches people to override it, which is
 * how the real finding gets ignored the next time. They check only that the
 * RESULT is collected, which is sufficient for honesty: once the failure is
 * disclosed by name, an empty rows array is no longer an unqualified answer.
 *
 * So they miss two things, stated here rather than implied:
 *   - a page that discloses the flag through a prop while never collecting the
 *     result (counted as debt, though nothing false is on screen); and
 *   - a compound condition — `pending || result.error ? [] : result.data` —
 *     where the flag is not the whole ternary test. The project detail page's
 *     recent-runs lane was exactly that, and it was found by reading.
 *
 * WHY PAGES AND NOT ROUTES OR LIBRARIES. An API route that swallows an error
 * returns wrong data or a wrong status — bad, but a different defect with a
 * different fix. A PAGE turns it into a sentence a human reads and believes.
 * Both other surfaces have their own guard now:
 * `a-route-may-not-discard-a-read-error.test.ts` and
 * `a-library-may-not-discard-a-read-error.test.ts`. The scopes are what keep all
 * three readable, and each ratchets its own tree.
 *
 * TO FIX A PAGE: keep the whole result, check the error, and disclose it —
 * `ReadFailureLog` in `src/lib/ui/read-failures.ts` exists for exactly this and
 * both public pages now use it. Then lower the number here.
 */

const APP_DIR = path.join(ROOT, "src", "app");

function pageFiles(): string[] {
  return sourceFiles(APP_DIR, (entry) => entry === "page.tsx" || entry === "layout.tsx");
}

/**
 * The R1 ceiling. It may only ever shrink.
 *
 * The 13 pages that used to be listed here (county-runs, engagement campaign,
 * invoicing, models, plans, programs, projects detail and list, reports detail,
 * both RTP cycle pages, scenarios detail, and the public plan page) all keep
 * their read results and disclose their failures. The public plan page's
 * share-token lookup — the last of those, which used to 404 on a failed read —
 * now renders a shell that says the read failed and explicitly denies the
 * inference that the plan is missing, unpublished, or withdrawn.
 *
 * THIS LIST WENT BACK TO FOUR ON 2026-08-04, AND NOT BECAUSE ANY PAGE
 * REGRESSED. R1 used to anchor on `= await`, so the CONDITIONAL spelling —
 *
 *     const { data: artifactsData } = reportIds.length
 *       ? await supabase.from("report_artifacts").select(…)
 *       : { data: [] };
 *
 * — was invisible to it. That was written down as a known miss in the library
 * guard and asserted as one, which is honest and was still not good enough:
 * closing the miss found four live sites, on two pages, while this ratchet was
 * empty and this header said the debt was paid. The error is exactly as unbound
 * as in the plain spelling, and the "skip the query when there is nothing to
 * look up" idiom means these reads sit on the paths that matter — the artifact
 * list under a report, the modelling evidence under a grant, the narrative draft
 * for the opportunity a planner has open.
 *
 * They are listed rather than fixed here because this lane owns the guards, not
 * the pages. To clear one: bind `error` in BOTH branches (`: { data: [], error:
 * null }` is already the shape three of them nearly use), check it, and hand it
 * to the page's `ReadFailureLog`.
 */
const KNOWN_DISCARDED: ReadonlyArray<readonly [string, number]> = [
  ["src/app/(app)/grants/page.tsx", 3],
  ["src/app/(app)/reports/page.tsx", 1],
];

describe("a page may not discard a read error", () => {
  const known = new Map(KNOWN_DISCARDED.map(([file, count]) => [file, count]));
  const discardedCounts = () => countsBy(pageFiles(), dataOnlyCount);

  it("adds no new page that renders a failed read as an answer", () => {
    const added = [...discardedCounts().keys()].filter((file) => !known.has(file));

    expect(
      added,
      "these pages discard a Supabase read error — keep the result, check `error`, and disclose it with ReadFailureLog"
    ).toEqual([]);
  });

  it("lets no listed page get worse", () => {
    const worsened = [...discardedCounts().entries()]
      .filter(([file, count]) => known.has(file) && count > (known.get(file) ?? 0))
      .map(([file, count]) => `${file}: ${known.get(file)} → ${count}`);

    expect(worsened, "these pages added another discarded read error").toEqual([]);
  });

  /**
   * The staleness half, and the reason the list can only shrink. Without it a
   * fixed page would sit here forever claiming a debt it no longer has, and the
   * next reader would trust a number that had quietly stopped being true.
   */
  it("keeps the ceiling honest — a fixed page must be removed from the list", () => {
    const actual = discardedCounts();
    const stale = KNOWN_DISCARDED.filter(([file, count]) => (actual.get(file) ?? 0) < count).map(
      ([file, count]) => `${file}: listed ${count}, actually ${actual.get(file) ?? 0} — lower or delete this entry`
    );

    expect(stale, "the ratchet moved; update the list").toEqual([]);
  });

  /**
   * The three assertions above all pass trivially if the scan finds nothing —
   * a broken pattern, a wrong directory, a rename. This is the floor.
   */
  it("guards the guard — the scan reaches real pages and the pattern still matches", () => {
    const files = pageFiles();
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((file) => file.endsWith(path.join("(public)", "plan", "[shareToken]", "page.tsx")))).toBe(true);

    // The pattern must match the shape it names, in all three spellings.
    expect(dataOnlyCount(`const { data } = await supabase.from("x").select()`)).toBe(1);
    expect(dataOnlyCount(`const { data: rows } = await supabase.from("x").select()`)).toBe(1);
    expect(
      dataOnlyCount(`const { data: rows } = ids.length ? await supabase.from("x").select() : { data: [] };`)
    ).toBe(1);
    // And must NOT match a read that keeps its error, in either spelling.
    expect(dataOnlyCount(`const { data, error } = await supabase.from("x").select()`)).toBe(0);
    expect(
      dataOnlyCount(`const { data: rows, error } = ids.length ? await supabase.from("x").select() : { data: [], error: null };`)
    ).toBe(0);
  });

  it("has fixed the public surfaces that shipped the defect", () => {
    const actual = discardedCounts();
    // The engagement portal page and its loader disclose read failures now; the
    // portal page must not reacquire one.
    expect(actual.get("src/app/(portal)/engage/[shareToken]/page.tsx") ?? 0).toBe(0);
    expect(actual.get("src/app/(embed)/embed/[shareToken]/page.tsx") ?? 0).toBe(0);
    // The public plan page was the last entry on the ratchet. Named explicitly
    // so that emptying KNOWN_DISCARDED can never quietly un-guard it.
    expect(actual.get("src/app/(public)/plan/[shareToken]/page.tsx") ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R2 — unchecked result reads. PORTED FROM THE ROUTE GUARD, 2026-08-04.
// ---------------------------------------------------------------------------

/**
 * MEASURED 2026-08-04, and every entry here was previously CERTIFIED GREEN by
 * this file. That is the finding, not the list.
 *
 * The shape is
 *
 *     const risksResult = await supabase.from("project_risks").select("id");
 *     const risks = risksResult.data ?? [];
 *
 * — R1 cannot see it (nothing is destructured), R3/R4/R5 cannot see it (no array
 * pattern, no classifier), and the ROUTE guard, which has had this detector
 * since it was written, does not scan `page.tsx`. So a page could bind a read
 * result, never look at its error, render "0" and pass this guard. Six did.
 *
 * The named results are recorded beside each count so the fix is findable
 * without re-running a detector:
 *
 *   data-hub               projectsResult
 *   grants                 legacyRead, legacyAwardsRead
 *   projects/[projectId]   workspaceFallbackRead
 *   reports/[reportId]     projectDatasetLinksResult, projectDatasetsResult,
 *                          projectDatasetRefreshJobsResult, runsResult,
 *                          engagementCampaignResult
 *   invitations/[token]    workspaceResult — the workspace an invitee is being
 *                          asked to join, so a failed read renders the invite as
 *                          if the workspace did not exist
 *
 * THIS LIST WILL GO STALE DURING THE RUN THAT WROTE IT, deliberately and by
 * design: other lanes are repairing these pages right now, and the third
 * assertion of the ratchet turns red the moment one of them lands — which is the
 * correct behaviour, not a broken guard. Lower or delete the entry. Never raise
 * one.
 */
const KNOWN_UNCHECKED_RESULT: ReadonlyArray<readonly [string, number]> = [
  // THE DASHBOARD ENTRY WAS PAID OFF 2026-08-13, and it is worth recording what
  // the debt actually cost while it sat here. `runsResult` fed FOUR KPI tiles
  // and TWO charts, so a failed runs query rendered "0 runs · 0 completed ·
  // N/A · Not available" above an area chart flat on the baseline — a workspace
  // full of analysis, drawn as one that had never run anything. The read now
  // lives in `lib/dashboard/chart-reads.ts` and hands back an OUTCOME; the
  // figures and the tiles refuse to state a number from a read that failed.
  // Recorded and then BUILT UPON is the pattern to watch for: two of those
  // charts were added long after this line was written.
  ["src/app/(app)/data-hub/page.tsx", 1],
  ["src/app/(app)/grants/page.tsx", 2],
  ["src/app/(app)/projects/[projectId]/page.tsx", 1],
  ["src/app/(app)/reports/[reportId]/page.tsx", 5],
  ["src/app/(auth)/invitations/[token]/page.tsx", 1],
];

/** Measured 2026-08-04. May only shrink. */
const KNOWN_ARRAY_DISCARDED: ReadonlyArray<readonly [string, number]> = [];

/** Measured 2026-08-04. May only shrink. */
const KNOWN_CLASSIFIER_ONLY: ReadonlyArray<readonly [string, number]> = [];

/**
 * Measured 2026-08-04, AFTER the six project-detail feeders were collected. May
 * only shrink. It starts empty because the debt it was written for was paid in
 * the same change — which is the honest number, not an aspiration: the detector
 * proves itself against the synthetic cases below and against the tree scan.
 */
const KNOWN_TWO_STEP_CLASSIFIER: ReadonlyArray<readonly [string, number]> = [];

ratchet(
  "a page may not discard a read error — unchecked result",
  KNOWN_UNCHECKED_RESULT,
  pageFiles,
  uncheckedResultCount,
  "these pages bind a read result and only ever read `.data` — check the error and disclose it with ReadFailureLog before rendering the rows",
  "page"
);

ratchet(
  "a page may not discard a read error — array destructuring",
  KNOWN_ARRAY_DISCARDED,
  pageFiles,
  arrayDiscardedBindings,
  "these pages destructure `{ data }` out of an awaited array without keeping `error` — take the whole result and check it",
  "page"
);

ratchet(
  "a page may not classify one failure and swallow the rest",
  KNOWN_CLASSIFIER_ONLY,
  pageFiles,
  classifierOnlyBranches,
  "these pages use looksLikePendingSchema as the ONLY error branch — classify first, then collect what is left with ReadFailureLog",
  "page"
);

ratchet(
  "a page may not split a classifier and its swallow across two statements",
  KNOWN_TWO_STEP_CLASSIFIER,
  pageFiles,
  twoStepClassifierOnly,
  "these pages declare a pending-schema flag and later use it as the ONLY error branch — collect the result too (laneOutcome/collectUnlessPending), so the emptiness is not offered as an answer",
  "page"
);

/**
 * R6 — `r.error ? [] : (r.data ?? [])` (added 2026-08-04, Fable review): the
 * error is read and the empty answer given anyway. Every other detector treats
 * a `.error` read as disclosure; this spelling defeats that assumption and was
 * invisible to every guard. Both listed sites resolve a value to a default when
 * the read failed without collecting the result into the page's
 * ReadFailureLog:
 *
 *   grants/page.tsx      the workspace home geography (×2) — a failed read
 *                        renders the grants registry as though no home
 *                        geography were configured.
 *   projects/[projectId] the workspace row falls back to a second, narrower
 *                        read; when BOTH fail, the page renders with a null
 *                        workspace and neither failure is disclosed.
 */
const KNOWN_ERROR_TERNARY: ReadonlyArray<readonly [string, number]> = [
  ["src/app/(app)/grants/page.tsx", 2],
  ["src/app/(app)/projects/[projectId]/page.tsx", 1],
];

ratchet(
  "a page may not read an error and answer empty anyway",
  KNOWN_ERROR_TERNARY,
  pageFiles,
  errorTernarySwallows,
  "these pages branch on `.error` and yield an empty answer on the failure side — collect the result with ReadFailureLog so the gap is disclosed",
  "page"
);

describe("the detectors are not vacuous", () => {
  it("R2 counts a result whose error is never read, and survives shadowing", () => {
    expect(
      uncheckedResultCount(`
        const risksResult = await supabase.from("project_risks").select("id");
        const risks = risksResult.data ?? [];
      `)
    ).toBe(1);

    // THE CASE A FILE-WIDE GREP GETS WRONG. Grepping the whole file for
    // `risksResult.error` finds the SECOND declaration's check and reports the
    // first read as safe. It is not: the first read's rows were consumed with
    // its error unexamined, and the two declarations have nothing to do with
    // each other.
    expect(
      uncheckedResultCount(`
        const risksResult = await supabase.from("project_risks").select("id");
        const risks = risksResult.data ?? [];

        const risksResult = await supabase.from("project_risks").select("id, severity");
        if (risksResult.error) reads.check("project risks", risksResult);
        const detailed = risksResult.data ?? [];
      `)
    ).toBe(1);
  });

  it("R2 spares every shape a correct page uses", () => {
    // Collected through ReadFailureLog before the rows are taken.
    expect(
      uncheckedResultCount(`
        const risksResult = await supabase.from("project_risks").select("id");
        reads.check("project risks", risksResult);
        const risks = risksResult.data ?? [];
      `)
    ).toBe(0);
    // Checked under an alias in a tuple loop — the result appears bare.
    expect(
      uncheckedResultCount(`
        const [aResult, bResult] = await Promise.all([
          supabase.from("a").select("id"),
          supabase.from("b").select("id"),
        ]);
        for (const [label, result] of [["a", aResult], ["b", bResult]] as const) {
          if (result.error) reads.record(label, result.error.message);
        }
        const a = aResult.data ?? [];
        const b = bResult.data ?? [];
      `)
    ).toBe(0);
    // Count-only reads never touch `.data`.
    expect(
      uncheckedResultCount(`
        const totalResult = await supabase.from("reports").select("id", { count: "exact", head: true });
        const total = totalResult.count ?? 0;
      `)
    ).toBe(0);
    // Not a database read at all.
    expect(
      uncheckedResultCount(`
        const parsed = await requestSchema.parseAsync(body);
        const values = parsed.data ?? [];
      `)
    ).toBe(0);
  });

  it("counts an array binding that drops its error, and spares one that keeps it", () => {
    expect(arrayDiscardedBindings(`const [{ data: a }, { data: b }] = await Promise.all([x, y]);`)).toBe(2);
    // The correct shape must NOT be flagged.
    expect(arrayDiscardedBindings(`const [{ data, error }] = await Promise.all([x]);`)).toBe(0);
    // Named results that keep the whole object — what the dashboard does.
    expect(arrayDiscardedBindings(`const [runsResult, geoResult] = await Promise.all([x, y]);`)).toBe(0);
    // Not awaited — not a read.
    expect(arrayDiscardedBindings(`const [{ data: a }] = someSyncThing;`)).toBe(0);
  });

  it("counts a classifier used as the only error branch, and spares a real collect", () => {
    expect(classifierOnlyBranches(`looksLikePendingSchema(r.error?.message) ? [] : (r.data ?? [])`)).toBe(1);
    // Nested parentheses in the argument must not break the scan.
    expect(classifierOnlyBranches(`looksLikePendingSchema(String(r.error?.message)) ? [] : r.data`)).toBe(1);
    // Used as a plain guard before collecting — the CORRECT shape.
    expect(classifierOnlyBranches(`const pending = looksLikePendingSchema(r.error?.message);\nif (!pending) reads.check("x", r);`)).toBe(0);
  });

  it("counts a two-step classifier, and spares a retry, a collect, and a flag nobody branches on", () => {
    // The shape R4 cannot see: the `?` is fifty lines from the call.
    expect(
      twoStepClassifierOnly(
        `const xPending = looksLikePendingSchema(r.error?.message);\nconst rows = xPending ? [] : (r.data ?? []);`
      )
    ).toBe(1);

    // THE RETRY SHAPE. The false branch yields the original RESULT, error and
    // all, for a collector further down — flagging it would send someone to
    // "fix" correct code, which is how a guard loses its authority.
    expect(
      twoStepClassifierOnly(
        `const packetPending = looksLikePendingSchema(result.error?.message);\nconst finalResult = packetPending ? await narrowerRead() : result;`
      )
    ).toBe(0);

    // Collected as well as classified — the fixed shape, which must be able to
    // leave the ratchet or the ratchet cannot fall.
    expect(
      twoStepClassifierOnly(
        `const xPending = looksLikePendingSchema(r.error?.message);\nconst failed = collectUnlessPending(reads, "x", r);\nconst rows = xPending ? [] : (r.data ?? []);`
      )
    ).toBe(0);

    // A flag that only tints a panel is not this defect; nothing is answered.
    expect(
      twoStepClassifierOnly(
        `const xPending = looksLikePendingSchema(r.error?.message);\nreturn <Panel pending={xPending} />;`
      )
    ).toBe(0);

    // A flag widened to EVERY failure is not this defect either — nothing empty
    // is offered as an answer.
    expect(
      twoStepClassifierOnly(
        `const xPending = looksLikePendingSchema(r.error?.message) || Boolean(r.error);\nconst rows = xPending ? [] : (r.data ?? []);`
      )
    ).toBe(0);

    // Nested parentheses in the argument must not break the scan.
    expect(
      twoStepClassifierOnly(
        `const xPending = looksLikePendingSchema(String(r.error?.message));\nconst rows = xPending ? [] : r.data;`
      )
    ).toBe(1);
  });

  /**
   * WHY THIS ASSERTION CHANGED, 2026-08-04. It used to require each detector to
   * find at least one instance in the tree — a reasonable floor while both had
   * debt, and a trap the moment one was paid off. The array ratchet reached zero
   * and this test failed, reporting a cleanup as a broken detector.
   *
   * A detector at zero cannot prove itself against the tree; that is what the
   * synthetic positive cases above and the responsiveness proofs below are for.
   * What the TREE can still prove is that the scan reaches real files and that
   * each detector runs over every one of them without throwing — so a rename, a
   * moved directory, or a parser that blows up on real syntax still fails here
   * rather than passing as "clean".
   */
  it("guards the guard — the scan reaches real pages and every detector runs over all of them", () => {
    const files = pageFiles();
    expect(files.length).toBeGreaterThan(40);

    let scanned = 0;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(typeof dataOnlyCount(source)).toBe("number");
      expect(typeof uncheckedResultCount(source)).toBe("number");
      expect(typeof arrayDiscardedBindings(source)).toBe("number");
      expect(typeof classifierOnlyBranches(source)).toBe("number");
      expect(typeof twoStepClassifierOnly(source)).toBe("number");
      scanned += 1;
    }
    expect(scanned).toBe(files.length);

    // NO TREE COUNT IS ASSERTED HERE, and that is deliberate — twice now a
    // hardcoded expectation of remaining debt has failed BECAUSE the debt was
    // paid off, reporting a cleanup as a broken detector. A detector at zero
    // proves itself through the synthetic cases above, not through the tree.
  });
});

// ---------------------------------------------------------------------------
// Real-source responsiveness — what an EMPTY ratchet needs
// ---------------------------------------------------------------------------

/**
 * These assert nothing about DEBT. They take pages that are CORRECT, remove the
 * thing that makes them correct, and require the detector to notice. That
 * population GROWS as pages are fixed; paying debt off cannot empty it, which is
 * precisely the property a "count what is left" proof lacks. No file path and no
 * count is written into either test — both are derived from the tree.
 *
 * The patch is applied IN MEMORY, never on disk: other agents hold uncommitted
 * work in this tree, and a mutate-then-restore on a file this lane does not own
 * can lose their edit between the two writes. The detectors read source as a
 * string either way, so the evidence is the same and the risk is not.
 */
describe("the detectors still fire on real page source", () => {
  it("R1 fires when a correct destructure loses its error binding", () => {
    const candidates: string[] = [];
    const responded: string[] = [];

    for (const file of pageFiles()) {
      const source = readFileSync(file, "utf8");
      if (!source.match(KEPT_ERROR)) continue;
      candidates.push(relative(file));
      if (dataOnlyCount(droppingTheErrorBinding(source)) > dataOnlyCount(source)) {
        responded.push(relative(file));
      }
    }

    expect(
      candidates.length,
      "no page destructures `{ data, error }` any more, so R1 has no real source to prove itself against — write a new proof rather than deleting this one"
    ).toBeGreaterThan(0);
    expect(
      responded.length,
      "R1 stopped matching real page source: dropping the `error` binding out of a correct destructure changed nothing"
    ).toBeGreaterThan(0);
  });

  it("R2 fires when a checked result stops being checked", () => {
    const candidates: string[] = [];
    const responded: string[] = [];

    for (const file of pageFiles()) {
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
      "no page binds a read result and checks its error, so R2 has no real source to prove itself against — write a new proof rather than deleting this one"
    ).toBeGreaterThan(0);
    expect(
      responded.length,
      "R2 stopped matching real page source: turning a checked result's `.error` reads into `.data` reads did not make it unchecked"
    ).toBeGreaterThan(0);
  });
});
