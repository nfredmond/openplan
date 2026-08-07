import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  arrayDiscardedBindings,
  checkedResultNames,
  classifiedAndDisclosedNames,
  classifierOnlyBranches,
  dataOnlyCount,
  droppingTheErrorBinding,
  errorTernarySwallows,
  KEPT_ERROR,
  ratchet,
  relative,
  removingTheErrorCheck,
  removingTheErrorDisclosure,
  ROOT,
  sourceFiles,
  twoStepClassifierOnly,
  uncheckedResultCount,
} from "./helpers/read-error-detectors";

/**
 * A LIBRARY MAY NOT DISCARD A READ ERROR.
 *
 * THE HOLE THIS CLOSES, AND WHY IT WAS THE BIGGEST ONE. Two guards already
 * refuse a read failure answered as an empty result — one over `page.tsx` and
 * `layout.tsx`, one over `route.ts`. Neither scans `src/lib`, `src/components`,
 * or `src/app/**\/_components`, which is where this codebase actually puts most
 * of its reads. Both were green while the class sat wide open one function call
 * away, and the surviving instances there are worse than the ones the earlier
 * guards caught, because a library defect is inherited by every caller at once.
 *
 * WHAT THE FIRST MEASUREMENT FOUND, kept because the size of it is the argument
 * for this guard existing: 109 sites across 12 files (R1 20, R2 56, R3 11, R4
 * 16, R5 6), in code both existing guards certified clean. The five detectors
 * match disjoint shapes, so no site was counted twice. The heaviest single file
 * by a wide margin was `src/lib/assistant/context.ts` with 64 — it builds the
 * grounding context the Planning Agent reasons from, so a failed read there does
 * not render a wrong sentence on one page, it hands the model "this project has
 * no risks, no decisions, no engagement campaigns" as fact and lets it write
 * that into a grant narrative or an RTP chapter.
 *
 * RE-MEASURED at the end of the same run, after nine lanes landed their fixes:
 * 18 sites across 8 files. `assistant/context.ts` is at ZERO on all five,
 * `operations/workspace-summary.ts` and `grants/narrative-evidence.ts` likewise,
 * and R3 and R5 are empty across the whole scanned tree. What is left is listed
 * at its true count below, each entry with the reason it is still there.
 *
 * THE FALSE-POSITIVE PROBLEM IS THE WHOLE DESIGN QUESTION HERE, and it is the
 * reason the route guard refused to walk inward in the first place. A library
 * legitimately returns a value-plus-error seam for its CALLER to surface:
 *
 *     export async function loadOpportunityPursuitContext(…) {
 *       const { data, error } = await client.from("funding_opportunities")…;
 *       …
 *       return { context, error };
 *     }
 *
 * That is the correct shape, not a defect — `src/lib/grants/pursuit.ts` and
 * `loadApprovedSurveyAnswers`/`loadSurveyResponseSessions` in
 * `src/lib/engagement/survey-responses.ts` all do exactly this. A guard that
 * flagged them would be overridden once, and after that the real finding would
 * be overridden too.
 *
 * NO SPECIAL CASE WAS NEEDED. The route guard's existing exemption rule already
 * covers it and was VERIFIED against these files rather than assumed: a result
 * is flagged only when at least one use is `IDENT.data` AND EVERY use is an
 * `IDENT.data` access, so any `.error` read, any bare use, or a reassignment
 * exempts it. A returned seam reads `.error` to put it in the return value; a
 * swallow never does. `pursuit.ts` scores zero on all five detectors, and that
 * is asserted below against the real file, not asserted in prose.
 *
 * THREE DETECTORS WERE CHANGED ON THE EVIDENCE OF THIS SWEEP, which is the rule
 * the brief set — fix the detector, do not add a carve-out. All three came from
 * looking at what the detector reported rather than trusting the count.
 *
 *   - R5, first pass. `budget-queries.ts` declared `const statedBudgetPending =
 *     looksLikePendingSchema(r.error?.message) || Boolean(r.error)`, which a
 *     scanner stopping at the classifier call reads as "classify one failure and
 *     swallow the rest". It is not: that flag is true for EVERY failure, so
 *     nothing empty is ever offered as an answer.
 *   - R4/R5, RE-MEASURED. Six of the six sites still reported after the fix
 *     lanes landed were CORRECT code. `loadAerialMissionsAndPackagesForProject`
 *     returns early with an `unreadableReason` for every non-pending error;
 *     `loadProjectBudgetInputs` turns each error into `unreadableReason(r.error)`
 *     and returns them as `readFailures`; `api/analysis/context` answers 500 on
 *     `r.error && !pending` before the flag is used. `isCollectedSomewhere` only
 *     knew one spelling of disclosure — a call named `check`/`collect`. The rule
 *     is now the SAME one R2 uses: reading the subject's `.error` again, outside
 *     the classifier argument and inside that declaration's scope, exempts it.
 *     Scoped, not file-wide, because `aerial/queries.ts` declares
 *     `missionsResult` in three functions and only one of them checks it.
 *   - R1. See below — the ternary miss was closed, and it was hiding four live
 *     sites.
 *
 * TWO EXTENSIONS THE SHARED DETECTORS TOOK FOR THIS SURFACE, both in
 * `helpers/read-error-detectors.ts`:
 *   - a read may be an `.rpc(` call, not only `.from(`. Routes read tables;
 *     libraries reach for stored functions, and the engagement demographics,
 *     near-duplicate, hotspot and behavioural-onramp KPI loaders are all `.rpc(`
 *     reads with the same `{ data, error }` shape and the same ways of losing it.
 *   - comments are blanked before R1 runs. `src/lib/http/read-outcome.ts` and
 *     `src/lib/ui/read-failures.ts` document the defect by QUOTING it in a doc
 *     block; counting a warning as an instance of the thing it warns about is
 *     how a ratchet acquires debt nobody can pay off.
 *
 * A MISS THAT WAS CLOSED, AND WHY IT IS THE MOST USEFUL THING IN THIS FILE. R1
 * used to anchor on `= await`, so `const { data: rows } = ids.length ? await
 * client.from(…) : { data: [] }` escaped it. That was written down as a known
 * miss and asserted as one — honest, and still wrong to leave: closing it on
 * re-measurement found FOUR live sites, all on `page.tsx` files whose own R1
 * ratchet was empty and whose header said the debt was paid. A documented miss
 * is still a miss. Everything below marked "still misses" should be read as work
 * queued, not as a boundary.
 *
 * WHAT THIS STILL MISSES, stated so a green run is not mistaken for a proof:
 *   - a ternary CONDITION containing braces — an object literal or a callback —
 *     is not seen, because the R1 pattern refuses to cross `{`/`}` rather than
 *     risk reaching into unrelated code below an unterminated declaration. No
 *     instance in this tree is written that way today.
 *   - the query-builder split: `const q = client.from(…)…; const r = await q;`.
 *     The awaited initializer contains no `.from(`, so it is not seen as a read
 *     at all. `loadSurveyResponseSessions` is written this way — it happens to be
 *     CORRECT, so nothing is hidden there today, but a swallow written that way
 *     would be invisible.
 *   - a result handed to a FUNCTION that ignores its error. The bare-identifier
 *     use exempts it, and telling "passed to something that checks" from "passed
 *     to something that swallows" needs an inter-procedural walk none of these
 *     detectors do.
 *
 * TO FIX A LIBRARY FUNCTION: do not swallow and do not throw — RETURN the error
 * for the caller to surface. `{ rows, error }` is the shape this repo has
 * settled on (`loadOpportunityPursuitContext`, `loadApprovedSurveyAnswers`,
 * `aggregateCampaignSurvey`), because it lets the page reach for `ReadFailureLog`
 * and the route reach for `classifyRouteReadFailure` without the library
 * deciding which of those it is talking to. Then lower the number here.
 */

const LIB_DIRS = [path.join(ROOT, "src", "lib"), path.join(ROOT, "src", "components")];
const APP_DIR = path.join(ROOT, "src", "app");

const isSource = (entry: string) => entry.endsWith(".ts") || entry.endsWith(".tsx");

/**
 * `src/lib`, `src/components`, and the per-route `_components` folders.
 *
 * The last one matters as much as the first: a `_components` file is a server
 * component that reads on its own, so it is a page's data layer wearing a
 * component's name, and neither the page guard (which sees only `page.tsx`) nor
 * the route guard has ever looked at one. Two of the sites below live there.
 */
function libFiles(): string[] {
  const shared = LIB_DIRS.flatMap((dir) => sourceFiles(dir, isSource));
  const routeLocal = sourceFiles(APP_DIR, isSource).filter((file) => relative(file).includes("/_components/"));
  return [...shared, ...routeLocal];
}

// ---------------------------------------------------------------------------
// The ratchets — MEASURED 2026-08-04, and every one of them may only shrink
// ---------------------------------------------------------------------------

/**
 * R1 — `const { data } = await …`, or the same binding behind a ternary. The
 * error is not bound, so it cannot be checked even in principle. Was 20 sites /
 * 6 files; now 8 / 4, each looked at rather than counted:
 *
 *   close-loop.ts          `loadCloseLoopEntries`, the OPERATOR builder read.
 *                          Its header says why it is still here: its three
 *                          callers are outside the lane that fixed the public
 *                          read, and the harm is lesser — a planner shown an
 *                          empty builder may re-author entries that exist.
 *   public-portal-data.ts  the signed-URL mint for approved photos. Not a table
 *                          read; a failure drops the photo, not the item.
 *   run-reconcile.ts       an "is the worker alive" probe inside a try/catch
 *                          whose whole contract is best-effort — a failed probe
 *                          means "assume not alive", which is the safe answer.
 *   notifications/         five reads in the engagement notification lane. These
 *     engagement.ts        are the real debt in this list: a failed subscriber
 *                          read sends nobody an update and reports nothing.
 */
const KNOWN_DATA_ONLY: ReadonlyArray<readonly [string, number]> = [
  ["src/lib/engagement/close-loop.ts", 1],
  ["src/lib/engagement/public-portal-data.ts", 1],
  ["src/lib/models/run-reconcile.ts", 1],
  ["src/lib/notifications/engagement.ts", 5],
];

/**
 * R2 — the whole result is bound to a name and every use of that name reads
 * `.data`. The error was right there and nobody looked. Was 56 sites / 6 files
 * and the largest of the five; now 6 / 3. `assistant/context.ts` (33),
 * `operations/workspace-summary.ts` (9) and `grants/narrative-evidence.ts` (8)
 * are all at zero.
 *
 * The three in `survey-responses.ts` each carry their reasoning at the function:
 * `loadSurveyBuilderDefinition` and `loadRecentFingerprintSessions` both name
 * the caller that must change in the same commit as their signature, and
 * `purgeExpiredSurveyDrafts` reports `swept: 0` for a delete that failed. It was
 * FOUR until 2026-08-07, when the builder read gained a pending-column fallback
 * and therefore had to look at its own error to decide whether to retry — the
 * ratchet moving down as a side effect of a feature rather than a cleanup. The
 * two `_components` entries are a server component's own data layer —
 * `projectsRead` on the receivables lane and `versionsResult` on the network
 * packages panel.
 */
const KNOWN_UNCHECKED_RESULT: ReadonlyArray<readonly [string, number]> = [
  ["src/app/(app)/invoicing/_components/receivables-lane.tsx", 1],
  ["src/app/(app)/models/_components/network-packages-panel.tsx", 1],
  ["src/lib/engagement/survey-responses.ts", 3],
];

/**
 * R3 — `const [{ data: a }, { data: b }] = await Promise.all([...])`, which R1
 * cannot see because its regex anchors on `const {`. Was 11 sites / 2 files;
 * now EMPTY across the whole scanned tree.
 */
const KNOWN_ARRAY_DISCARDED: ReadonlyArray<readonly [string, number]> = [];

/**
 * R4 — `looksLikePendingSchema(x.error?.message) ? [] : (x.data ?? [])`, inline.
 * Was 16 sites / 2 files; now 4 / 1, all in `src/lib/aerial/queries.ts`, and
 * they are genuine. That file says in its own header that "each loader
 * encapsulates the `looksLikePendingSchema` guard so a not-yet-applied migration
 * cannot take the page down" — true, and it is exactly the defect: a migration
 * is the only failure it can describe, and every other one comes back as an
 * empty mission list. The two loaders concerned (`loadWorkspaceAerialPostureInputs`
 * and the project-list loader) return `{ missions, packages }` with no failure
 * channel at all, so the fix is a seam, not a branch. The THIRD loader in the
 * same file already has one — `loadAerialMissionsAndPackagesForProject` returns
 * `unreadableReason` — which is why it is not counted here.
 */
const KNOWN_CLASSIFIER_ONLY: ReadonlyArray<readonly [string, number]> = [
  ["src/lib/aerial/queries.ts", 4],
];

/**
 * R5 — the same defect split across two statements, invisible to R4 because the
 * `?` is nowhere near the call. Was 6 sites / 3 files; now EMPTY.
 *
 * Five of those six were never defects: `aerial/queries.ts` and
 * `projects/budget-queries.ts` both classify and then disclose, one by returning
 * early with an `unreadableReason` and one by returning `readFailures`. The
 * detector, not the code, was wrong — see the header.
 */
const KNOWN_TWO_STEP_CLASSIFIER: ReadonlyArray<readonly [string, number]> = [];

/**
 * R6 — `r.error ? [] : (r.data ?? [])`: the error is READ and the empty answer
 * given anyway. Added 2026-08-04 (Fable review): a fresh instance of this
 * spelling planted on every surface was invisible to every guard, because each
 * detector treated any `.error` read as disclosure. Measured at 10 sites /
 * 8 files across all three surfaces; the five below are this guard's share,
 * each looked at rather than counted:
 *
 *   operator-text.ts       a failed CAMPAIGN read (its `translations` read is
 *                          properly disclosed) silently degrades the stated
 *                          source locale to null, which can mislabel operator
 *                          text as untranslated.
 *   public-portal-data.ts  the submission geofence resolves to DISABLED on a
 *                          failed read — a fail-open its own comment records as
 *                          deliberate and undisclosed. It sits here so the
 *                          decision stays visible; do not "fix" it without
 *                          reopening that decision.
 *   run-citations.ts       both halves of the funder-facing citation picker
 *                          ("Empty on any lookup failure" — its own words, and
 *                          a KNOWN OPEN in the A.2 handoff). A failed read
 *                          offers a grant writer an empty citation list.
 *   receivables-lane.tsx / reimbursement-lane.tsx
 *                          the deliverable pickers render empty when the
 *                          deliverables read fails.
 */
const KNOWN_ERROR_TERNARY: ReadonlyArray<readonly [string, number]> = [
  ["src/app/(app)/invoicing/_components/receivables-lane.tsx", 1],
  ["src/app/(app)/invoicing/_components/reimbursement-lane.tsx", 1],
  ["src/lib/engagement/portal-i18n/operator-text.ts", 1],
  ["src/lib/engagement/public-portal-data.ts", 1],
  ["src/lib/reports/run-citations.ts", 2],
];

const RETURN_THE_ERROR =
  "do not swallow and do not throw — return the error for the caller to surface, the way loadOpportunityPursuitContext in src/lib/grants/pursuit.ts does";

ratchet(
  "a library may not discard a read error — data-only destructure",
  KNOWN_DATA_ONLY,
  libFiles,
  dataOnlyCount,
  `these files destructure \`{ data }\` and never bind \`error\` — ${RETURN_THE_ERROR}`,
  "file"
);

ratchet(
  "a library may not discard a read error — unchecked result",
  KNOWN_UNCHECKED_RESULT,
  libFiles,
  uncheckedResultCount,
  `these files bind a read result and only ever read \`.data\` — ${RETURN_THE_ERROR}`,
  "file"
);

ratchet(
  "a library may not discard a read error — array destructuring",
  KNOWN_ARRAY_DISCARDED,
  libFiles,
  arrayDiscardedBindings,
  `these files destructure \`{ data }\` out of an awaited array without keeping \`error\` — ${RETURN_THE_ERROR}`,
  "file"
);

ratchet(
  "a library may not classify one failure and swallow the rest",
  KNOWN_CLASSIFIER_ONLY,
  libFiles,
  classifierOnlyBranches,
  `these files use looksLikePendingSchema as the ONLY error branch — classify first, then ${RETURN_THE_ERROR}`,
  "file"
);

ratchet(
  "a library may not split a classifier and its swallow across two statements",
  KNOWN_TWO_STEP_CLASSIFIER,
  libFiles,
  twoStepClassifierOnly,
  `these files declare a pending-schema flag and later use it as the ONLY error branch — ${RETURN_THE_ERROR}`,
  "file"
);

ratchet(
  "a library may not read an error and answer empty anyway",
  KNOWN_ERROR_TERNARY,
  libFiles,
  errorTernarySwallows,
  `these files branch on \`.error\` and yield an empty answer on the failure side — ${RETURN_THE_ERROR}`,
  "file"
);

// ---------------------------------------------------------------------------
// The correct seam must survive, and that is proved against the real file
// ---------------------------------------------------------------------------

describe("the guard spares the seam this repo tells people to write", () => {
  /**
   * THE MOST IMPORTANT NEGATIVE IN THIS FILE. `loadOpportunityPursuitContext`
   * destructures `{ data, error }`, classifies a pending schema, and RETURNS the
   * error for the route to surface. If any detector flagged it, the correct
   * shape and the defect would be indistinguishable from the ratchet's point of
   * view, and the first person to hit that would learn to ignore this file.
   */
  it("scores src/lib/grants/pursuit.ts at zero on all five detectors", () => {
    const source = readFileSync(path.join(ROOT, "src", "lib", "grants", "pursuit.ts"), "utf8");
    expect({
      dataOnly: dataOnlyCount(source),
      unchecked: uncheckedResultCount(source),
      array: arrayDiscardedBindings(source),
      classifier: classifierOnlyBranches(source),
      twoStep: twoStepClassifierOnly(source),
    }).toEqual({ dataOnly: 0, unchecked: 0, array: 0, classifier: 0, twoStep: 0 });
  });

  it("spares a `{ rows, error }` loader, however it is spelled", () => {
    // Returned in the object, which is what pursuit.ts and the survey loaders do.
    expect(
      uncheckedResultCount(`
        const result = await supabase.from("engagement_survey_answers").select("id");
        return { rows: (result.data ?? []) as Row[], error: result.error ?? null };
      `)
    ).toBe(0);
    // Merged from several reads — `aggregateCampaignSurvey`'s shape.
    expect(
      uncheckedResultCount(`
        const questionsResult = await supabase.from("q").select("id");
        const optionsResult = await supabase.from("o").select("id");
        return {
          questions: (questionsResult.data ?? []) as Q[],
          options: (optionsResult.data ?? []) as O[],
          error: questionsResult.error ?? optionsResult.error ?? null,
        };
      `)
    ).toBe(0);
    // Handed on whole, so the caller owns the decision.
    expect(
      uncheckedResultCount(`
        const result = await supabase.from("x").select("id");
        return toReadOutcome(result);
      `)
    ).toBe(0);
    // Destructured with its error and returned — R1's correct shape.
    expect(
      dataOnlyCount(`
        const { data, error } = await client.from("funding_opportunities").select("id").maybeSingle();
        return { context: parse(data), error };
      `)
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The detectors are not vacuous
// ---------------------------------------------------------------------------

describe("the detectors count what they say they count", () => {
  it("R1 counts both spellings and spares the nested auth read", () => {
    expect(dataOnlyCount(`const { data } = await supabase.from("x").select();`)).toBe(1);
    expect(dataOnlyCount(`const { data: rows } = await supabase.from("x").select();`)).toBe(1);
    // Binds a nested PATTERN, so nothing called `data` is ever in scope.
    expect(dataOnlyCount(`const { data: { user } } = await supabase.auth.getUser();`)).toBe(0);
    // A zod parse is not a database read.
    expect(dataOnlyCount(`const { data } = requestSchema.safeParse(body);`)).toBe(0);
  });

  /**
   * COMMENT BLANKING, ASSERTED. `read-outcome.ts` and `read-failures.ts` both
   * write the defect out in a doc block to explain what they prevent. Without
   * this, the two modules built to FIX this class would sit on its ratchet.
   */
  it("R1 does not count a doc comment that quotes the defect", () => {
    expect(dataOnlyCount(`/**\n * \`const { data } = await …\` hands back null for both cases.\n */\nexport const X = 1;`)).toBe(0);
    expect(dataOnlyCount(`// const { data } = await supabase.from("x").select();\nexport const X = 1;`)).toBe(0);
    const readOutcome = readFileSync(path.join(ROOT, "src", "lib", "http", "read-outcome.ts"), "utf8");
    expect(readOutcome).toContain("const { data } = await");
    expect(dataOnlyCount(readOutcome)).toBe(0);
  });

  it("R2 counts an unchecked result, an rpc read, and survives shadowing", () => {
    expect(
      uncheckedResultCount(`
        const risksResult = await supabase.from("project_risks").select("id");
        const risks = risksResult.data ?? [];
      `)
    ).toBe(1);
    // The lane routes cannot reach: a stored function, read the same careless way.
    expect(
      uncheckedResultCount(`
        const kpisResult = await supabase.rpc("load_behavioral_onramp_kpis_for_workspace", { p_workspace_id: id });
        const kpis = kpisResult.data ?? [];
      `)
    ).toBe(1);
    // A later, properly-checked declaration of the SAME NAME cannot vouch for an
    // earlier one — the trap that hid 13 real defects from a plain grep.
    expect(
      uncheckedResultCount(`
        const optionsResult = await supabase.from("o").select("id");
        const options = optionsResult.data ?? [];

        const optionsResult = await supabase.from("o").select("id, label");
        if (optionsResult.error) return { rows: [], error: optionsResult.error };
        const labelled = optionsResult.data ?? [];
      `)
    ).toBe(1);
  });

  it("R2 spares a count-only read, a reassignment, and a non-read", () => {
    expect(
      uncheckedResultCount(`
        const totalResult = await supabase.from("reports").select("id", { count: "exact", head: true });
        const total = totalResult.count ?? 0;
      `)
    ).toBe(0);
    expect(
      uncheckedResultCount(`
        let runsResult = await supabase.from("model_runs").select("id, claim_status");
        if (looksLikePendingSchema(runsResult.error?.message)) {
          runsResult = await supabase.from("model_runs").select("id");
        }
        const runs = runsResult.data ?? [];
      `)
    ).toBe(0);
    expect(
      uncheckedResultCount(`
        const parsed = await requestSchema.parseAsync(body);
        const values = parsed.data ?? [];
      `)
    ).toBe(0);
  });

  it("R3 counts an array binding that drops its error and spares one that keeps it", () => {
    expect(arrayDiscardedBindings(`const [{ data: a }, { data: b }] = await Promise.all([x, y]);`)).toBe(2);
    expect(arrayDiscardedBindings(`const [{ data, error }] = await Promise.all([x]);`)).toBe(0);
    expect(arrayDiscardedBindings(`const [aResult, bResult] = await Promise.all([x, y]);`)).toBe(0);
    expect(arrayDiscardedBindings(`const [{ data: a }] = someSyncThing;`)).toBe(0);
  });

  it("R4 counts a classifier used as the only error branch and spares a collect", () => {
    expect(classifierOnlyBranches(`looksLikePendingSchema(r.error?.message) ? [] : (r.data ?? [])`)).toBe(1);
    expect(classifierOnlyBranches(`looksLikePendingSchema(String(r.error?.message)) ? [] : r.data`)).toBe(1);
    expect(
      classifierOnlyBranches(`const pending = looksLikePendingSchema(r.error?.message);\nif (!pending) reads.check("x", r);`)
    ).toBe(0);
  });

  it("R5 counts the two-step form and spares a retry, a collect, and a widened flag", () => {
    expect(
      twoStepClassifierOnly(
        `const xPending = looksLikePendingSchema(r.error?.message);\nconst rows = xPending ? [] : (r.data ?? []);`
      )
    ).toBe(1);
    // A retry preserves the original RESULT, error and all, for a collector below.
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
    // THE DETECTOR FIX THIS SWEEP FORCED: a flag true for EVERY failure never
    // offers an empty answer, so it is not this defect.
    expect(
      twoStepClassifierOnly(
        `const statedBudgetPending =\n  looksLikePendingSchema(r.error?.message) || Boolean(r.error);\nconst amount = statedBudgetPending ? null : r.data?.budget_amount ?? null;`
      )
    ).toBe(0);
  });

  /**
   * R6 — the error read that swallows anyway. The exemptions are the risk
   * here (each one is a place the detector can silently stop finding things),
   * so every one is asserted from both sides.
   */
  it("R6 counts an error-ternary swallow and spares every disclosing shape", () => {
    // The defect, in both polarities.
    expect(
      errorTernarySwallows(`const r = await s.from("x").select();\nconst rows = r.error ? [] : (r.data ?? []);`)
    ).toBe(1);
    expect(
      errorTernarySwallows(`const r = await s.from("x").select();\nconst rows = !r.error ? (r.data ?? []) : [];`)
    ).toBe(1);
    // Boolean-wrapped condition.
    expect(
      errorTernarySwallows(`const r = await s.from("x").select();\nconst rows = Boolean(r.error) ? [] : (r.data ?? []);`)
    ).toBe(1);
    // Inline disclosure: the swallow branch carries the error to the caller.
    expect(
      errorTernarySwallows(`const r = await s.from("x").select();\nreturn r.error ? { rows: [], error: r.error } : { rows: r.data ?? [], error: null };`)
    ).toBe(0);
    // A named unreadable sentinel is a disclosure, not an empty answer.
    expect(
      errorTernarySwallows(`const r = await s.from("x").select();\nconst place = r.error ? UNREADABLE_PORTAL_PLACE : candidate(r.data);`)
    ).toBe(0);
    // Classify-then-collect: the bare handoff exempts, whatever the collector is named.
    expect(
      errorTernarySwallows(`const r = await s.from("x").select();\nclassifyRead(reads, "the rows", r);\nconst rows = r.error ? [] : (r.data ?? []);`)
    ).toBe(0);
    // Disclosure elsewhere in scope: a reason string, a log, a return.
    expect(
      errorTernarySwallows(`const r = await s.from("x").select();\nconst why = unreadableReason(r.error);\nconst rows = r.error ? [] : (r.data ?? []);`)
    ).toBe(0);
    // The retry shape: no branch reads .data, the whole result survives.
    expect(
      errorTernarySwallows(`const r = await s.from("x").select();\nconst final = r.error ? await narrowerRead() : r;`)
    ).toBe(0);
    // Optional chaining and nullish coalescing are not ternaries.
    expect(errorTernarySwallows(`const m = r.error?.message ?? null;`)).toBe(0);
    expect(errorTernarySwallows(`const e = r.error ?? fallbackError;`)).toBe(0);
    // Two swallows of the same result cannot vouch for each other.
    expect(
      errorTernarySwallows(
        `const r = await s.from("x").select();\nconst rows = r.error ? [] : (r.data ?? []);\nconst names = r.error ? [] : (r.data ?? []).map((x) => x.name);`
      )
    ).toBe(2);
  });

  /**
   * THE MISS THAT WAS CLOSED. This assertion used to read `.toBe(0)` and was
   * honest about it — the shape was documented as undetected. Closing it found
   * four live sites on pages whose R1 ratchet was empty. A miss recorded is not
   * a miss retired.
   */
  it("sees a data-only destructure behind a ternary", () => {
    expect(
      dataOnlyCount(
        `const { data: artifactsData } = reportIds.length\n  ? await client.from("report_artifacts").select("id")\n  : { data: [], error: null };`
      )
    ).toBe(1);
    // The correct conditional shape keeps `error` and must stay unflagged.
    expect(
      dataOnlyCount(
        `const { data: rows, error } = ids.length\n  ? await client.from("x").select("id")\n  : { data: [], error: null };`
      )
    ).toBe(0);
    // Not a read at all: no `await` anywhere in the initializer.
    expect(dataOnlyCount(`const { data } = ids.length ? cached : { data: [] };`)).toBe(0);
  });

  /**
   * THE REMAINING R1 MISS, asserted rather than described. The pattern refuses
   * to cross `{`/`}` so that an unterminated final declaration cannot reach for
   * an `await` in unrelated code below it; the price is a ternary condition that
   * contains a brace. Nothing in this tree is written that way today.
   */
  it("does NOT yet see a ternary whose CONDITION contains braces", () => {
    expect(
      dataOnlyCount(`const { data } = rows.some((r) => { return r.id; })\n  ? await client.from("x").select("id")\n  : { data: [] };`)
    ).toBe(0);
  });

  /**
   * THE R4/R5 EXEMPTION, ASSERTED, because it is the change most able to make
   * these two detectors silently stop finding anything. Disclosure is recognised
   * however it is spelled — but only inside the declaration's own scope.
   */
  it("R4/R5 spare a classifier whose result is disclosed some other way", () => {
    // Early return on every non-pending failure: the flag is only reachable when
    // the failure really is a pending migration.
    expect(
      classifierOnlyBranches(
        `const r = await client.from("x").select("id");\nif (r.error && !looksLikePendingSchema(r.error?.message)) return { rows: [], unreadable: r.error.message };\nconst rows = looksLikePendingSchema(r.error?.message) ? [] : (r.data ?? []);`
      )
    ).toBe(0);
    // The error turned into a reason and returned — `unreadableReason` is not
    // named `check` or `collect`, which is what the old rule required.
    expect(
      twoStepClassifierOnly(
        `const r = await client.from("x").select("id");\nconst pending = looksLikePendingSchema(r.error?.message);\nconst why = unreadableReason(r.error);\nconst rows = pending ? [] : (r.data ?? []);\nreturn { rows, why };`
      )
    ).toBe(0);
    // AND THE SCOPE RULE THAT KEEPS IT HONEST. A LATER declaration of the same
    // name that discloses cannot vouch for an earlier one that swallows —
    // `aerial/queries.ts` declares `missionsResult` in three functions.
    expect(
      twoStepClassifierOnly(
        `const r = await client.from("x").select("id");\nconst pending = looksLikePendingSchema(r.error?.message);\nconst rows = pending ? [] : (r.data ?? []);\n\nconst r = await client.from("y").select("id");\nconst laterPending = looksLikePendingSchema(r.error?.message);\nconst why = unreadableReason(r.error);\nconst more = laterPending ? [] : (r.data ?? []);`
      )
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Guarding the guard — the scan reaches the tree it claims to
// ---------------------------------------------------------------------------

describe("guards the guard", () => {
  /**
   * Each of the three roots must contribute, separately. A single total would
   * stay comfortably above any floor if `_components` silently stopped being
   * scanned — and `_components` is the root neither existing guard covers, so it
   * is the one most likely to be dropped by a refactor and least likely to be
   * missed.
   */
  it("reaches src/lib, src/components and the route-local _components folders", () => {
    const files = libFiles().map(relative);
    expect(files.filter((file) => file.startsWith("src/lib/")).length).toBeGreaterThan(200);
    expect(files.filter((file) => file.startsWith("src/components/")).length).toBeGreaterThan(100);
    expect(files.filter((file) => file.includes("/_components/")).length).toBeGreaterThan(20);
    expect(files.every((file) => file.endsWith(".ts") || file.endsWith(".tsx"))).toBe(true);
    // Every ratcheted file must still be in the scanned set, or the ratchet is
    // guarding a path that no longer exists.
    for (const [file] of [
      ...KNOWN_DATA_ONLY,
      ...KNOWN_UNCHECKED_RESULT,
      ...KNOWN_ARRAY_DISCARDED,
      ...KNOWN_CLASSIFIER_ONLY,
      ...KNOWN_TWO_STEP_CLASSIFIER,
      ...KNOWN_ERROR_TERNARY,
    ]) {
      expect(files, `${file} is on a ratchet but is not scanned`).toContain(file);
    }
  });

  it("runs every detector over every file without throwing", () => {
    const files = libFiles();
    let scanned = 0;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(typeof dataOnlyCount(source)).toBe("number");
      expect(typeof uncheckedResultCount(source)).toBe("number");
      expect(typeof arrayDiscardedBindings(source)).toBe("number");
      expect(typeof classifierOnlyBranches(source)).toBe("number");
      expect(typeof twoStepClassifierOnly(source)).toBe("number");
      expect(typeof errorTernarySwallows(source)).toBe("number");
      scanned += 1;
    }
    expect(scanned).toBe(files.length);

    // NO TREE-WIDE TOTAL IS ASSERTED. A count of remaining debt fails when the
    // debt is PAID, reporting a cleanup as a broken detector — this repo has
    // done that twice. The synthetic cases hold once the tree reaches zero, and
    // the two responsiveness proofs below hold on a population that GROWS as the
    // debt is paid.
  });
});

// ---------------------------------------------------------------------------
// Real-source responsiveness — what these ratchets will need once they empty
// ---------------------------------------------------------------------------

/**
 * These assert nothing about DEBT. They take library code that is CORRECT,
 * remove the thing that makes it correct, and require the detector to notice.
 * That population GROWS as files are fixed; paying the debt off cannot empty it,
 * which is precisely the property a "count what is left" proof lacks — and this
 * repo has twice shipped a guard-the-guard that went red because a cleanup
 * succeeded.
 *
 * The patch is applied IN MEMORY, never on disk: other agents hold uncommitted
 * work in this tree, and a mutate-then-restore on a file this lane does not own
 * can lose their edit between the two writes. The detectors read source as a
 * string either way, so the evidence is the same and the risk is not.
 */
describe("the detectors still fire on real library source", () => {
  it("R1 fires when a correct destructure loses its error binding", () => {
    const candidates: string[] = [];
    const responded: string[] = [];

    for (const file of libFiles()) {
      const source = readFileSync(file, "utf8");
      if (!source.match(KEPT_ERROR)) continue;
      candidates.push(relative(file));
      if (dataOnlyCount(droppingTheErrorBinding(source)) > dataOnlyCount(source)) {
        responded.push(relative(file));
      }
    }

    expect(
      candidates.length,
      "no library file destructures `{ data, error }` any more, so R1 has no real source to prove itself against — write a new proof rather than deleting this one"
    ).toBeGreaterThan(0);
    expect(
      responded.length,
      "R1 stopped matching real library source: dropping the `error` binding out of a correct destructure changed nothing"
    ).toBeGreaterThan(0);
  });

  it("R2 fires when a checked result stops being checked", () => {
    const candidates: string[] = [];
    const responded: string[] = [];

    for (const file of libFiles()) {
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
      "no library file binds a read result and checks its error, so R2 has no real source to prove itself against — write a new proof rather than deleting this one"
    ).toBeGreaterThan(0);
    expect(
      responded.length,
      "R2 stopped matching real library source: turning a checked result's `.error` reads into `.data` reads did not make it unchecked"
    ).toBeGreaterThan(0);
  });

  /**
   * R4/R5 NEEDED THIS MOST, and did not have it. Their exemption was widened on
   * the evidence that six of six reported sites were correct code — a widened
   * exemption is exactly how a detector stops finding anything while every
   * ratchet above it stays green, and R5's ratchet is now EMPTY, so nothing else
   * in this file would notice.
   *
   * The population is every library result that is classified AND disclosed.
   * Strip the disclosure — leaving the classification untouched — and the count
   * must rise. That set grows as the remaining swallows are given seams, so
   * paying the debt off strengthens this proof instead of emptying it.
   */
  it("R4/R5 fire when a classified result stops being disclosed", () => {
    const candidates: string[] = [];
    const responded: string[] = [];

    for (const file of libFiles()) {
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
      "no library file classifies a read failure and also discloses it, so R4/R5 have no real source to prove their exemption against — write a new proof rather than deleting this one"
    ).toBeGreaterThan(0);
    expect(
      responded.length,
      "R4/R5 stopped matching real library source: removing the disclosure from a classified result did not make it a swallow"
    ).toBeGreaterThan(0);
  });
});
