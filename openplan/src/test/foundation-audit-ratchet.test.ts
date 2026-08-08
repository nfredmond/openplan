import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * THE FOUNDATION AUDIT, AS A NUMBER THAT MAY ONLY IMPROVE.
 *
 * ============================================================== WHY THIS EXISTS
 *
 * This repository is ~1,900 commits of largely unaudited work, laid down in
 * STRATA by whatever model was strongest at the time. What was verifiably true
 * before this file existed: the suite passes and ~21 tree-scanning guards exist.
 * What was NOT known is the thing that actually matters — WHAT FRACTION OF THOSE
 * TESTS PROTECT ANYTHING AT ALL. A test that looks protective and proves nothing
 * is worse than no test: it converts an unchecked area into one everybody
 * believes is checked, so nobody looks again.
 *
 * TWO PASSES ARE RECORDED HERE, and they were run for different reasons.
 *
 *   PASS 1 — the tier below Stage B, sampled broadly. 64 mutations across 20
 *   production files sampled by 15 test files: 30 killed, 34 SURVIVED.
 *
 *   PASS 2 — the Title VI surface, targeted by SUBJECT rather than by tier,
 *   because the lane about to be built on it produces civil-rights findings.
 *   44 mutations across 7 production files: 21 killed, 23 SURVIVED, every one of
 *   the 23 re-confirmed against the whole suite. It also found a LIVE DEFECT —
 *   a corridor poverty rate overstated by up to 10x, which trips a published
 *   Title VI flag. See TITLE_VI_AUDIT below.
 *
 * In both passes every verdict was read off the `Tests` summary line's
 * `(\d+) failed` segment alone, every mutation was restored by editing the
 * string back and verified with sha256 against a baseline captured first, and
 * the harness was proven to report a KILL, a SURVIVAL and a HARNESS-ERROR
 * before any verdict was trusted.
 *
 * ================================================== WHAT THIS FILE IS FOR, NOW
 *
 * Three jobs, and the third is the one a future session will care about most:
 *
 *   1. It fails if an audited file is DELETED OR RENAMED without this record
 *      being updated. A hollow guard that vanishes must not be indistinguishable
 *      from a fixed one.
 *   2. It fails if any test written to CLOSE a survivor is removed or renamed.
 *      Those assertions are the entire product of the audit; an ordinary
 *      refactor that drops one would silently reopen the hole, and the suite
 *      would stay green because that is exactly what it did before.
 *   3. It carries the surviving mutations as a ledger whose size may only go
 *      DOWN. Each entry names the file, the mutation, and what a planner loses
 *      if it is real. Fixing one means deleting its entry and lowering the
 *      ceiling; nothing may be added without a deliberate edit here.
 *
 * =========================================== WHAT THIS FILE DOES *NOT* CLAIM
 *
 * About 30 of ~736 test files have been measured across FIVE passes — the
 * foundation sweep, the Title VI surfaces, the `[fact:id]` grounding machinery,
 * the CEQA §15064.3 determination path, and the claim-tier decision procedure
 * (the last three all 2026-08-07). The CEQA pass is the first that found an area
 * already SOLID — 39 of 42 mutations died on the first run, against roughly half
 * in the two earlier sweeps — and the claim-tier pass immediately after it found
 * 5 of 14 surviving, two of which PROMOTED a tier. Neither number generalises to
 * the other, which is the whole reason each pass is recorded separately. It does not speak for the rest, and `records what was NOT
 * audited` below exists so a green run can never be read as "the suite was
 * measured". That would be this audit committing the very defect it was run to
 * find.
 */

const APP_ROOT = join(__dirname, "..", "..");
const AUDIT_DATE = "2026-08-06";

function repoPath(relative: string): string {
  return join(APP_ROOT, relative);
}

// ─────────────────────────────────────────────────────────────────────────────
// WHAT WAS AUDITED
// ─────────────────────────────────────────────────────────────────────────────

type AuditedFile = {
  /** The test file(s) whose protection of this file was measured. */
  sampledBy: string[];
  /** Mutations applied to this file on AUDIT_DATE. */
  mutations: number;
  /** Of those, how many the sampled test file(s) failed to catch. */
  survivors: number;
};

/**
 * Production files whose guards were measured by mutation. The count columns are
 * the audit's raw result and are NOT recomputed here — they are the historical
 * record of what was run on AUDIT_DATE, which is what makes a later run
 * comparable to it.
 */
const AUDITED_PRODUCTION_FILES: Record<string, AuditedFile> = {
  "src/app/api/runs/route.ts": {
    sampledBy: ["src/test/runs-route-auth.test.ts"],
    mutations: 5,
    survivors: 3,
  },
  "src/lib/auth/role-matrix.ts": {
    sampledBy: ["src/test/runs-route-auth.test.ts"],
    mutations: 3,
    survivors: 0,
  },
  "src/app/api/stage-gates/decisions/route.ts": {
    sampledBy: ["src/test/stage-gate-decisions-route.test.ts"],
    mutations: 6,
    survivors: 3,
  },
  "src/app/api/engagement/campaigns/[campaignId]/export/route.ts": {
    sampledBy: ["src/test/engagement-export-route.test.ts"],
    mutations: 4,
    survivors: 2,
  },
  "src/lib/observability/action-audit.ts": {
    sampledBy: ["src/test/action-audit-log.test.ts"],
    mutations: 4,
    survivors: 4,
  },
  "src/lib/analysis/compare.ts": {
    sampledBy: ["src/test/analysis-compare.test.ts"],
    mutations: 6,
    survivors: 3,
  },
  "src/lib/models/evidence-backbone.ts": {
    sampledBy: ["src/test/modeling-evidence-backbone.test.ts"],
    mutations: 6,
    survivors: 3,
  },
  "src/lib/geo/corridor-geometry.ts": {
    sampledBy: ["src/test/corridor-geometry.test.ts"],
    mutations: 6,
    survivors: 5,
  },
  "src/lib/data-sources/crashes.ts": {
    sampledBy: ["src/test/crashes-data-source.test.ts"],
    mutations: 6,
    survivors: 2,
  },
  "src/lib/accessibility/isochrone.ts": {
    sampledBy: ["src/test/isochrone-accessibility.test.ts"],
    mutations: 6,
    survivors: 4,
  },
  "src/lib/engagement/geofence.ts": {
    sampledBy: ["src/test/a-pin-is-inside-the-area-or-it-is-not.test.ts"],
    mutations: 1,
    survivors: 1,
  },
  "src/lib/grants/narrative-evidence.ts": {
    sampledBy: ["src/test/grants-narrative-evidence-proposal.test.ts"],
    mutations: 2,
    survivors: 0,
  },
  "src/app/api/funding-opportunities/[opportunityId]/sections/[sectionId]/draft/route.ts": {
    sampledBy: ["src/test/grants-narrative-evidence-proposal.test.ts"],
    mutations: 1,
    survivors: 1,
  },
  "src/lib/tdm/engine.ts": {
    sampledBy: ["src/test/tdm-engine.test.ts"],
    mutations: 1,
    survivors: 0,
  },
  "src/lib/planner-pack/atp.ts": {
    sampledBy: ["src/test/planner-pack-atp.test.ts"],
    mutations: 2,
    survivors: 1,
  },
};

/**
 * FIVE MUTATIONS WHOSE FILE THIS RECORD CANNOT NAME — and that is a finding
 * about the harness, not a rounding error.
 *
 * The reachability sweep logged a LABEL per run and not the string pair it
 * applied, so three kills (a CEQA threshold, a grounding-faithfulness check, a
 * claim-tier outward-language check) and two survivals ("sketch accessibility",
 * "report access projection") cannot be reproduced from what was written down.
 * A survivor that cannot be re-run cannot be closed honestly, which is why the
 * two survivals are carried in UNREPRODUCIBLE_SURVIVORS rather than quietly
 * dropped. THE RULE FOR THE NEXT AUDIT: log the exact old/new strings, not a
 * label.
 */
const UNATTRIBUTED_2026_08_06 = { mutations: 5, killed: 3, survived: 2 };

/**
 * The 2026-08-06 headline, kept as literals because they are a historical
 * measurement rather than something to recompute. A later audit adds its own
 * block; it does not overwrite this one.
 */
const AUDIT_2026_08_06 = {
  mutationsRun: 64,
  killed: 30,
  survived: 34,
  /** Comment-only / known-kill / runner-failure controls, run before any verdict. */
  controls: 12,
  survivorsClosedSameDay: 16,
};

// ─────────────────────────────────────────────────────────────────────────────
// THE SECOND PASS — the Title VI surface, audited before it is built on
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A SEPARATE AUDIT, RECORDED SEPARATELY. The first pass sampled the tier below
 * Stage B. This one targeted a SUBJECT rather than a tier: everything a Title VI
 * service-equity finding would stand on — the ACS demographics join, the equity
 * screens, and the federal Justice40 designation lookup — because that lane
 * produces civil-rights determinations and the first pass had just shown the
 * unaudited strata to be about half hollow.
 *
 * 44 mutations across 7 production files. 21 killed, 23 SURVIVED. Every one of
 * the 23 was then re-run against the WHOLE suite and survived that too, so
 * "nothing guards this" is measured rather than inferred.
 *
 * THE RESULT THAT JUSTIFIED RUNNING IT: of the ten mutations aimed at
 * `screenEquity` — whose output renders under a literal "Title VI /
 * Environmental Justice Considerations" heading — NINE survived. Every
 * threshold could be moved to a value that switches its flag off forever, and
 * the corridor minority share in `census.ts` could be replaced by its own
 * complement, with 7,471 tests green.
 *
 * AND IT FOUND A LIVE DEFECT, not merely unguarded rules: the corridor poverty
 * rate divided by a denominator that excluded every tract reporting 0% poverty
 * while the numerator summed over all of them. One poor tract among nine
 * affluent ones reported 30% below poverty where the truth is 3%. That number
 * trips the >= 20% Title VI poverty flag, so the overstatement did not stay a
 * statistic — it published a finding.
 */
const TITLE_VI_AUDIT = {
  date: "2026-08-06",
  mutationsRun: 44,
  killed: 21,
  survived: 23,
  /** Negative (comment-only), positive (known-kill), and a VOID runner probe. */
  controls: 3,
  /** Closed with an assertion that was re-run against the original mutation. */
  survivorsClosed: 22,
  /** Survivors whose branch is unreachable with the shipped data (see below). */
  structurallyUnreachable: 1,
};

const TITLE_VI_AUDITED_PRODUCTION_FILES: Record<string, AuditedFile> = {
  "src/lib/data-sources/equity.ts": {
    sampledBy: ["src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts"],
    mutations: 10,
    survivors: 9,
  },
  "src/lib/data-sources/census.ts": {
    sampledBy: ["src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts"],
    mutations: 14,
    survivors: 8,
  },
  "src/lib/data-sources/equity-designation/cejst-national.ts": {
    sampledBy: [
      "src/test/equity-designation.test.ts",
      "src/test/a-missing-equity-dataset-is-not-a-finding-of-none.test.ts",
    ],
    mutations: 7,
    survivors: 3,
  },
  "src/lib/models/equity-screen.ts": {
    sampledBy: ["src/test/equity-screen.test.ts"],
    mutations: 3,
    survivors: 1,
  },
  "src/lib/data-sources/census-tract-ingest.ts": {
    sampledBy: ["src/test/census-tract-ingest.test.ts"],
    mutations: 4,
    survivors: 1,
  },
  "src/lib/geographies/census-tract-scope.ts": {
    sampledBy: ["src/test/census-tract-scope.test.ts"],
    mutations: 4,
    survivors: 1,
  },
  "src/lib/geographies/census-tract-coverage.ts": {
    sampledBy: ["src/test/census-tract-coverage.test.ts"],
    mutations: 2,
    survivors: 0,
  },
};

/**
 * Every entry was re-run AFTER its assertion was written and reported KILLED.
 *
 * Two are worth reading on their own, because both are mistakes this record
 * exists to stop the next session from repeating:
 *
 *   - CE6 (the inverted minority share) was still SURVIVING after the first
 *     assertion written for it, because extracting the corridor share to raw
 *     counts made that path immune while the PER-TRACT percentage — which shades
 *     the choropleth and feeds the 50% high-minority threshold — stayed
 *     invertible. A test named for a rule can exercise a different code path;
 *     only re-running the mutation showed it.
 *   - CE1's original anchor no longer exists, because the defect was FIXED. It
 *     was re-verified by reintroducing the broken aggregation verbatim and
 *     watching the new assertion fail.
 */
const TITLE_VI_CLOSED_SURVIVORS: Record<string, ClosedSurvivor> = {
  EQ1: {
    productionFile: "src/lib/data-sources/equity.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "flags high minority at or above 50%",
    mutation: "highMinorityPct: 50 → 95, so almost no tract counts as high-minority",
  },
  EQ2: {
    productionFile: "src/lib/data-sources/equity.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "minority share at or above 40%",
    mutation: "the corridor Title VI minority flag threshold 40 → 99, so the flag can never fire",
  },
  EQ3: {
    productionFile: "src/lib/data-sources/equity.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "poverty rate at or above 20%",
    mutation: "the corridor Title VI poverty flag threshold 20 → 99, so the flag can never fire",
  },
  EQ4: {
    productionFile: "src/lib/data-sources/equity.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "requires low income AND a burden — never either one alone",
    mutation: "disadvantaged = lowIncome && burdenCount >= 1 → lowIncome || burdenCount >= 1",
  },
  EQ5: {
    productionFile: "src/lib/data-sources/equity.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "pins the threshold table itself",
    mutation: "lowIncomeMedian: 50000 → 500000, so every tract in the US reads as low income",
  },
  EQ6: {
    productionFile: "src/lib/data-sources/equity.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "minority share at or above 40%",
    mutation: "the minority Title VI flag's push guarded by `if (false)` — never emitted at all",
  },
  EQ7: {
    productionFile: "src/lib/data-sources/equity.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "reads an absent denominator as zero, never as a maximal burden",
    mutation: "pct() returns 100 instead of 0 when the denominator is absent",
  },
  EQ8: {
    productionFile: "src/lib/data-sources/equity.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "does not claim a proxy-disadvantaged finding for a study area with no tracts",
    mutation: "proxyDisadvantagedFlag = disadvantagedTracts > 0 → >= 0, so it is always true",
  },
  EQ10: {
    productionFile: "src/lib/data-sources/equity.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "zero-vehicle share at or above 10%",
    mutation: "the zero-vehicle Title VI flag threshold 10 → 99, so the flag can never fire",
  },
  CE1: {
    productionFile: "src/lib/data-sources/census.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "divides poverty by the poverty universe, and counts zero-poverty tracts in it",
    mutation:
      "THE LIVE DEFECT. The poverty denominator excluded tracts reporting 0% poverty while the " +
      "numerator summed over all of them — up to a 10x overstatement. Re-verified by reintroducing " +
      "the broken aggregation verbatim after the fix.",
  },
  CE2: {
    productionFile: "src/lib/data-sources/census.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "stops weighting by population when the tracts that answered hold no people",
    mutation: "measured.population: totalPop > 0 → true, so placeholder zeros become findings",
  },
  CE6: {
    productionFile: "src/lib/data-sources/census.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "derives each tract's minority share as non-white over the race universe",
    mutation:
      "pctMinority = (universe - whiteNonHisp) / universe → whiteNonHisp / universe, so the single " +
      "number a Title VI analysis turns on reports its own complement",
  },
  CE7: {
    productionFile: "src/lib/data-sources/census.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "clamps ACS suppression sentinels to zero instead of carrying them as counts",
    mutation: "the `val < 0` clamp dropped, so ACS's -666666666 flows through as a real count",
  },
  CE9: {
    productionFile: "src/lib/data-sources/census.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "withholds zero-vehicle share only when no household universe existed",
    mutation: "measured.vehicleAccess: totalHH > 0 → true",
  },
  CE10: {
    productionFile: "src/lib/data-sources/census.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "explains an unmeasured universe and stays silent about a measured one",
    mutation:
      "the unavailability note's condition inverted, so absent universes get no explanation and " +
      "measured ones get one",
  },
  CE12: {
    productionFile: "src/lib/data-sources/census.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "withholds median income when no tract reported one",
    mutation: "measured.income: incomeTracts.length > 0 → true",
  },
  CE14: {
    productionFile: "src/lib/data-sources/census.ts",
    testFile: "src/test/a-title-vi-finding-stands-on-a-measured-number.test.ts",
    testName: "stamps provenance from the vintage it actually queried",
    mutation: 'ACS_YEAR "2023" → "2019", moving the vintage stamped on published equity figures',
  },
  J2: {
    productionFile: "src/lib/data-sources/equity-designation/cejst-national.ts",
    testFile: "src/test/equity-designation.test.ts",
    testName: "gives a split tract the benefit of the doubt when only SOME parents are disadvantaged",
    mutation:
      "matched.some(isDisadvantaged) → matched.every(...), so a 2020 tract straddling a " +
      "disadvantaged and a non-disadvantaged 2010 tract loses its designation",
  },
  J6: {
    productionFile: "src/lib/data-sources/equity-designation/cejst-national.ts",
    testFile: "src/test/a-missing-equity-dataset-is-not-a-finding-of-none.test.ts",
    testName: "resolves to not_determined/source_unavailable, never to not_disadvantaged",
    mutation:
      "the DesignationSourceUnavailableError throw replaced by empty sets, so a bundled asset that " +
      "failed to load reads as 'no disadvantaged tracts in this corridor'",
  },
  ES3: {
    productionFile: "src/lib/models/equity-screen.ts",
    testFile: "src/test/equity-screen.test.ts",
    testName: "reads a non-finite KPI as absent rather than rendering NaN or Infinity",
    mutation: "the Number.isFinite check dropped, so a divide-by-zero disparity ratio renders",
  },
  TI4: {
    productionFile: "src/lib/data-sources/census-tract-ingest.ts",
    testFile: "src/test/census-tract-ingest.test.ts",
    testName: "rejects an OVER-LONG county reference, not just a short one",
    mutation:
      "the county-FIPS end anchors dropped (/^\\d{2}$/ → /^\\d{2}/), which the existing " +
      "too-short-code test could not see",
  },
  TS3: {
    productionFile: "src/lib/geographies/census-tract-scope.ts",
    testFile: "src/test/census-tract-scope.test.ts",
    testName: "discloses a truncation of ANY size, not only a large one",
    mutation:
      "the truncation disclosure condition slackened by 1,000 tracts, which the existing " +
      "2,498-tract case still tripped",
  },
};

/**
 * A SURVIVOR THAT IS NOT A HOLE — and the distinction is worth keeping.
 *
 * J1 mutated the `matched.length === 0` branch in `resolveGeoid`, which returns
 * not_determined for a crosswalked 2020 tract whose 2010 parents are all absent
 * from CEJST. It survived, and it survives still, because the branch is
 * UNREACHABLE with the bundled data: all 26,570 crosswalk entries resolve to at
 * least one covered parent. No test driving the real asset can kill it.
 *
 * Writing a test that mocked the crosswalk to reach it would assert a behaviour
 * of the mock, not of the product. Instead the PROPERTY that makes it
 * unreachable is asserted, so a future crosswalk or CEJST refresh that breaks it
 * fails loudly and the branch's behaviour gets decided deliberately rather than
 * quietly becoming live and untested.
 */
const TITLE_VI_STRUCTURAL_SURVIVORS: Record<
  string,
  { productionFile: string; mutation: string; guardedInsteadBy: { testFile: string; testName: string } }
> = {
  J1: {
    productionFile: "src/lib/data-sources/equity-designation/cejst-national.ts",
    mutation:
      "`if (matched.length === 0) return undefined` → returns a DETERMINED not-disadvantaged " +
      "result, turning an unknown tract into a negative finding",
    guardedInsteadBy: {
      testFile: "src/test/equity-designation.test.ts",
      testName: "every crosswalk entry still resolves to at least one CEJST-covered parent",
    },
  },
};

/**
 * FOUND BY THE AUDIT, FIXED, AND NOT A MUTATION RESULT — recorded because the
 * next session will otherwise rediscover them.
 *
 *  - `census-geometry.ts` reimplemented the proxy-disadvantage rule with its own
 *    inline threshold literals, kept in step with `equity.ts` by nothing but a
 *    comment reading "same thresholds as screenEquity". Both now call
 *    `evaluateProxyDisadvantage`. The map shading and the scorecard count cannot
 *    disagree, and a test asserts they do not.
 *  - `ejIndicators.linguisticallyIsolated` was hardcoded `false` with ZERO
 *    consumers. Limited English Proficiency is a real Title VI factor, so a
 *    permanent negative is a false finding waiting for its first reader. Deleted
 *    rather than left dormant; measuring it needs ACS B16004 / C16002.
 *  - The corridor poverty rate and the `census_tracts` view's `pct_below_poverty`
 *    use DIFFERENT denominators (poverty universe vs total population). The
 *    corridor side is now correct; the view is an approximation. The Title VI
 *    tract-service join must not mix the two.
 */
const TITLE_VI_COLLATERAL_FIXES = 3;

// ─────────────────────────────────────────────────────────────────────────────
// WHAT WAS FIXED — and the assertion that proves each fix is still there
// ─────────────────────────────────────────────────────────────────────────────

type ClosedSurvivor = {
  productionFile: string;
  /** The test file that now kills the mutation. */
  testFile: string;
  /** The exact `it(...)` title. Renaming it fails this guard on purpose. */
  testName: string;
  /** What was changed in production to prove the new assertion is not vacuous. */
  mutation: string;
};

/**
 * Every one of these was re-run AFTER the fix and reported KILLED, naming the
 * test below. A fix that cannot be demonstrated is not a fix.
 */
const CLOSED_SURVIVORS: Record<string, ClosedSurvivor> = {
  R3: {
    productionFile: "src/app/api/runs/route.ts",
    testFile: "src/test/runs-route-auth.test.ts",
    testName: "GET scopes the membership lookup to this workspace AND this user",
    mutation: '.eq("user_id", user.id) → .eq("role", "member") on the membership lookup',
  },
  R4: {
    productionFile: "src/app/api/runs/route.ts",
    testFile: "src/test/runs-route-auth.test.ts",
    testName: "GET asks the database only for runs belonging to the requested workspace",
    mutation: '.eq("workspace_id", parsed.data) → .eq("id", parsed.data) on the runs list',
  },
  R7: {
    productionFile: "src/app/api/runs/route.ts",
    testFile: "src/test/runs-route-auth.test.ts",
    testName: "DELETE returns 200 when user is authorized",
    mutation: 'audit.info("run_deleted", …) deleted, so a successful deletion leaves no trace',
  },
  S2: {
    productionFile: "src/app/api/stage-gates/decisions/route.ts",
    testFile: "src/test/stage-gate-decisions-route.test.ts",
    testName: "looks the cited run up by id AND by workspace, not by id alone",
    mutation: '.eq("workspace_id", workspaceId) → a duplicate .eq("id", citedId) on the citation lookup',
  },
  S3: {
    productionFile: "src/app/api/stage-gates/decisions/route.ts",
    testFile: "src/test/stage-gate-decisions-route.test.ts",
    testName: "looks the project up by id AND by workspace, not by id alone",
    mutation: '.eq("workspace_id", workspaceId) → a duplicate .eq("id", projectId) on the project lookup',
  },
  E1: {
    productionFile: "src/app/api/engagement/campaigns/[campaignId]/export/route.ts",
    testFile: "src/test/engagement-export-route.test.ts",
    testName: "returns 403 when the caller is not a member of the campaign's workspace",
    mutation: "the whole `if (!access.allowed) return 403` branch deleted",
  },
  E4: {
    productionFile: "src/app/api/engagement/campaigns/[campaignId]/export/route.ts",
    testFile: "src/test/engagement-export-route.test.ts",
    testName: "asks the database only for the requested campaign's items",
    mutation: '.eq("campaign_id", access.campaign.id) → .eq("status", "approved")',
  },
  A2: {
    productionFile: "src/lib/observability/action-audit.ts",
    testFile: "src/test/action-audit-log.test.ts",
    testName: "writes one assistant_action_executions row per invocation (two execute actions → two rows)",
    mutation: 'execution_source default "manual" → "planner_agent_quick_link"',
  },
  A4: {
    productionFile: "src/lib/observability/action-audit.ts",
    testFile: "src/test/action-audit-log.test.ts",
    testName: "returns the insert error if the audit write fails",
    mutation:
      "looksLikePendingAuthorshipColumns returns true for ANY error, so a permission failure is " +
      "silently retried as a migration gap",
  },
  AC6: {
    productionFile: "src/lib/analysis/compare.ts",
    testFile: "src/test/analysis-compare.test.ts",
    testName: "refuses to subtract the transit-sensitive metrics of a GTFS run from an OSM run",
    mutation: "resolveTransitMethod(baselineMetrics) → resolveTransitMethod(currentMetrics)",
  },
  AC2: {
    productionFile: "src/lib/analysis/compare.ts",
    testFile: "src/test/analysis-compare.test.ts",
    testName: "refuses to subtract the transit-sensitive metrics of a GTFS run from an OSM run",
    mutation: '"accessibilityScore" removed from TRANSIT_SENSITIVE_METRIC_KEYS',
  },
  AC3: {
    productionFile: "src/lib/analysis/compare.ts",
    testFile: "src/test/analysis-compare.test.ts",
    testName: "refuses to subtract the transit-sensitive metrics of a GTFS run from an OSM run",
    mutation: '"totalTransitStops" removed from TRANSIT_SENSITIVE_METRIC_KEYS',
  },
  EB4: {
    productionFile: "src/lib/models/evidence-backbone.ts",
    testFile: "src/test/modeling-evidence-backbone.test.ts",
    testName: "refuses claim-grade for a run with no validation evidence at all",
    mutation: "`|| validationResults.length === 0` dropped from the prototype_only branch",
  },
  EB3: {
    productionFile: "src/lib/models/evidence-backbone.ts",
    testFile: "src/test/modeling-evidence-backbone.test.ts",
    testName: "downgrades to screening grade on a warning with no failure",
    mutation: "`|| warnings.length > 0` dropped from the screening_grade branch",
  },
  EB1: {
    productionFile: "src/lib/models/evidence-backbone.ts",
    testFile: "src/test/modeling-evidence-backbone.test.ts",
    testName: "treats a failing result that omits blocksClaimGrade as blocking",
    mutation: "blocksClaimGrade !== false → blocksClaimGrade === true, making silence permissive",
  },
  B5: {
    productionFile: "src/lib/engagement/geofence.ts",
    testFile: "src/test/a-pin-is-inside-the-area-or-it-is-not.test.ts",
    testName: "refuses a pin north or south of the box, not only east or west of it",
    mutation: "the latitude clause widened by ±90°, i.e. switched off",
  },
};

/**
 * Assertions written alongside the fixes above that close no survivor of their
 * own, but that make one non-vacuous — the symmetric case, the second door into
 * the same refusal. Held to the same existence check, because dropping one
 * quietly narrows a fix back to the single case that happened to be measured.
 */
const SUPPORTING_ASSERTIONS: Array<{ testFile: string; testName: string }> = [
  {
    testFile: "src/test/stage-gate-decisions-route.test.ts",
    testName: "scopes the membership lookup to this workspace AND this user",
  },
  {
    testFile: "src/test/engagement-export-route.test.ts",
    testName: "returns 403 for a role the matrix does not grant engagement.read (deny-by-default)",
  },
  {
    testFile: "src/test/analysis-compare.test.ts",
    testName: "refuses in the other direction too (OSM current, GTFS baseline)",
  },
  {
    testFile: "src/test/analysis-compare.test.ts",
    testName: "still subtracts two runs that recorded the same method",
  },
  {
    testFile: "src/test/modeling-evidence-backbone.test.ts",
    testName: "lets a result that explicitly declares itself non-blocking pass through",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// WHAT STILL SURVIVES — the ledger that may only shrink
// ─────────────────────────────────────────────────────────────────────────────

type OpenSurvivor = {
  productionFile: string;
  sampledBy: string;
  mutation: string;
  /** What a planner loses, or what becomes claimable, if this is ever wrong. */
  consequence: string;
  /**
   * `whole-suite` — re-run against all 7,464 tests and still green, so nothing
   * anywhere in the repository guards it.
   * `sampled-file` — survived the sampled file; sibling coverage not re-measured.
   */
  scope: "whole-suite" | "sampled-file";
};

/**
 * EACH ENTRY IS A FINDING, NOT A TODO. Deleting one requires a test that kills
 * the named mutation — and lowering OPEN_SURVIVOR_CEILING in the same edit.
 *
 * The eleven geometry / crash / accessibility entries were each re-run against
 * the WHOLE suite on AUDIT_DATE and survived, so "nothing catches this" is
 * measured rather than assumed.
 */
/**
 * EMPTY, as of 2026-08-07. All twelve entries left. Eleven were closed by an
 * assertion that was written, then verified by RE-RUNNING THE ORIGINAL MUTATION
 * and watching it fail; the twelfth (CR5) was shown to be unreachable with the
 * adapters that ship and moved to STRUCTURAL_SURVIVORS with a guard on the
 * property that makes it unreachable.
 *
 * The rule is unchanged: nothing may be added here without a deliberate edit,
 * and OPEN_SURVIVOR_CEILING moves in the same commit.
 */
const OPEN_SURVIVORS: Record<string, OpenSurvivor> = {};

/**
 * CLOSED ON 2026-08-07 — the second closing pass, kept separate from the
 * same-day sixteen so neither record can absorb the other.
 *
 * Every entry was re-run after its assertion was written and reported KILLED.
 * Two are worth reading on their own:
 *
 *   - SWEEP_A3 was a LIVE PRODUCTION DEFECT, not merely an unguarded rule. It
 *     is fixed here, and the fix is NOT the obvious one: widening the shared
 *     `loadFundingOpportunityAccess` projection would have hard-failed every
 *     funding route on a deployment predating migration 20260727000015. The
 *     pursuit columns are merged back through one shared pure function instead.
 *   - SWEEP_B9 could not be re-run from what the sweep recorded, so it was
 *     re-probed from scratch. It reproduced on the first attempt.
 */
const CLOSED_2026_08_07: Record<string, ClosedSurvivor> = {
  CG1: {
    productionFile: "src/lib/geo/corridor-geometry.ts",
    testFile: "src/test/corridor-geometry.test.ts",
    testName: "accepts coordinates at the exact bounds and rejects just outside them",
    mutation: "the longitude bound widened 10x (|lon| > 180 → |lon| > 1800)",
  },
  CG2: {
    productionFile: "src/lib/geo/corridor-geometry.ts",
    testFile: "src/test/corridor-geometry.test.ts",
    testName: "rejects a latitude outside the bounds, not only a longitude",
    mutation: "the latitude bound widened 10x (|lat| > 90 → |lat| > 900)",
  },
  CG4: {
    productionFile: "src/lib/geo/corridor-geometry.ts",
    testFile: "src/test/corridor-geometry.test.ts",
    testName: "refuses a degenerate ring of fewer than four points",
    mutation: "the minimum-ring-points check disabled (ring.length < MIN_RING_POINTS → < 0)",
  },
  CG5: {
    productionFile: "src/lib/geo/corridor-geometry.ts",
    testFile: "src/test/corridor-geometry.test.ts",
    testName: "validates EVERY ring, not only the first",
    mutation: "only the first ring is validated (rings.forEach → rings.slice(0, 1).forEach)",
  },
  CG6: {
    productionFile: "src/lib/geo/corridor-geometry.ts",
    testFile: "src/test/corridor-geometry.test.ts",
    testName: "refuses a LineString or a Point where a polygon is required",
    mutation: "the geometry-type gate removed (Polygon/MultiPolygon check → if (false))",
  },
  CR6: {
    productionFile: "src/lib/data-sources/crashes.ts",
    testFile: "src/test/crashes-data-source.test.ts",
    testName: "divides the multi-year total by the years queried, not by one",
    mutation: "crash density no longer annualised (annualBasis = years queried → 1)",
  },
  IA1: {
    productionFile: "src/lib/accessibility/isochrone.ts",
    testFile: "src/test/isochrone-accessibility.test.ts",
    testName: "puts the high tier at 39, with 38 still medium and 40 high",
    mutation: "the high-accessibility tier threshold moved (rawScore >= 39 → >= 30)",
  },
  IA2: {
    productionFile: "src/lib/accessibility/isochrone.ts",
    testFile: "src/test/isochrone-accessibility.test.ts",
    testName: "puts the medium tier at 21, with 20 still low and 22 medium",
    mutation: "the medium tier threshold moved (rawScore >= 21 → >= 15)",
  },
  IA5: {
    productionFile: "src/lib/accessibility/isochrone.ts",
    testFile: "src/test/isochrone-accessibility.test.ts",
    testName: "steps walk+bike mode share at 5 / 10 / 15 / 25",
    mutation: "a transit-mode-share scoring bucket collapsed ([25, 24] → [25, 4])",
  },
  IA6: {
    productionFile: "src/lib/accessibility/isochrone.ts",
    testFile: "src/test/isochrone-accessibility.test.ts",
    testName: "steps zero-vehicle share at 5 / 10 / 20 — the equity term",
    mutation: "the zero-vehicle-household top bucket cut (14 → 2)",
  },
  SWEEP_A3: {
    productionFile: "src/lib/grants/pursuit.ts",
    testFile: "src/test/funding-narrative-draft-route.test.ts",
    testName: "grounds the draft on the solicitation the planner is answering",
    mutation:
      "THE LIVE DEFECT. The standalone narrative drafter used the bare access row, whose projection " +
      "omits all four pursuit columns, so `isProposal` was permanently false and an RFP response " +
      "lost its solicitation number, submission-format note, questions-due date and past-performance " +
      "grounding. Fixed by merging the pursuit context through one shared pure function that BOTH " +
      "drafting doors now call; re-verified by reverting the route to the bare row.",
  },
  SWEEP_B8: {
    productionFile: "src/lib/reports/api.ts",
    testFile: "src/test/projection-strings.test.ts",
    testName: "requests every column ReportAccessRow declares",
    mutation:
      "columns dropped from REPORT_ACCESS_COLUMNS (latest_artifact_url, and separately workspace_id). " +
      "The original sweep string was never recorded, so the CLASS is guarded instead: the projection " +
      "and its row type are two hand-maintained lists that are now asserted to agree in both directions.",
  },
  SWEEP_B9: {
    productionFile: "src/lib/planner-pack/atp.ts",
    testFile: "src/test/planner-pack-atp.test.ts",
    testName: "declares exactly the three categories the ATP bonus recognises",
    mutation:
      "ATP_DAC_SCORING_CATEGORIES narrowed to {\"DAC\"}, dropping both low-income categories. " +
      "Re-probed from scratch on 2026-08-07 because the sweep never recorded a string; it reproduced " +
      "immediately. The existing coverage asserted `.has(\"DAC\")`, one member of three.",
  },
};

/**
 * SURVIVORS WHOSE BRANCH IS UNREACHABLE WITH THE CODE AND DATA THAT SHIP.
 *
 * Not holes, and not fixes either. No test driving the real product can kill
 * these, because the branch cannot be entered — so what is guarded instead is
 * the PROPERTY that makes it unreachable. If a future change breaks that
 * property the guard fails, and the branch's behaviour gets decided
 * deliberately rather than quietly becoming live and untested.
 */
const STRUCTURAL_SURVIVORS: Record<
  string,
  { productionFile: string; mutation: string; guardedInsteadBy: { testFile: string; testName: string } }
> = {
  CR5: {
    productionFile: "src/lib/data-sources/crashes.ts",
    mutation:
      "the fatal-crash floor removed (totalFatalities += Math.max(1, killedCount) → += killedCount)",
    guardedInsteadBy: {
      testFile: "src/test/crashes-data-source.test.ts",
      testName: "CCRS calls a crash fatal only when it recorded a death",
    },
  },
};

/**
 * SURVIVORS THAT CANNOT BE RE-RUN FROM WHAT WAS WRITTEN DOWN.
 *
 * All three survived the WHOLE suite on 2026-08-06, so they are real holes —
 * but the sweep harness logged only a label, so neither the exact string pair
 * nor (for two of them) the file can be stated here without guessing, and
 * guessing is what this whole exercise exists to stop. They are recorded rather
 * than dropped because a forgotten survivor is indistinguishable from a fixed
 * one, which is the defect class the audit found eleven times.
 *
 * TO CLOSE ONE: re-mutate the named surface from scratch, confirm it still
 * survives, write the assertion that kills it, then move it into
 * CLOSED_SURVIVORS with its real mutation string.
 */
const UNREPRODUCIBLE_SURVIVORS: Record<
  string,
  { label: string; surface: string; surfaceNowGuardedBy?: { testFile: string; testName: string } }
> = {
  SWEEP_B7: {
    label: "B7 — sketch accessibility",
    surface:
      "the sketch accessibility scoring path; the sweep harness recorded no file and no string pair, " +
      "so the exact mutation still cannot be stated. The only accessibility scoring path in the " +
      "repository is `classifyWalkBikeAccess`, which /api/analysis consumes — and on 2026-08-07 that " +
      "function gained assertions on BOTH tier cutoffs and all three bucket ladders, four of which " +
      "were mutation-verified (IA1, IA2, IA5, IA6). So the surface is no longer unguarded even though " +
      "this particular mutation cannot be re-run. It stays recorded rather than deleted, because " +
      "'probably covered' is not the same as 'killed' and the difference is what this file is for.",
    surfaceNowGuardedBy: {
      testFile: "src/test/isochrone-accessibility.test.ts",
      testName: "steps walk+bike mode share at 5 / 10 / 15 / 25",
    },
  },
};

/**
 * THE RATCHET. It may only be lowered, and only together with the entry it
 * accounts for. It stood at 12 on 2026-08-06, down from 34 survivors measured
 * that morning: 16 were closed with an assertion that was re-mutated and
 * observed to fail, 3 were found to be carried by a sibling guard rather than by
 * the file named for them (COVERED_BY_A_SIBLING), and 3 could not be reproduced
 * from what the sweep harness recorded (UNREPRODUCIBLE_SURVIVORS).
 */
const OPEN_SURVIVOR_CEILING = 0;

/**
 * Survived the file that is NAMED for the claim, but a different test in the
 * repository kills them. Not open holes — but worth keeping, because "the guard
 * lives somewhere else" is a fact that decays silently when the sibling is
 * refactored, and because the pattern (a file named for a rule that does not
 * test the rule) is the thing this audit exists to find.
 */
const COVERED_BY_A_SIBLING: Record<string, { mutation: string; killedBy: string }> = {
  S5: {
    mutation:
      "the agent-PASS refusal removed from /api/stage-gates/decisions " +
      '(executionSource === "planner_agent_quick_link" && decision !== "HOLD" → if (false))',
    killedBy: "src/test/the-agent-can-hold-a-gate-but-never-pass-one.test.ts",
  },
  A1: {
    mutation: 'the ledger outcome hardcoded (outcome: input.outcome → outcome: "succeeded")',
    killedBy: "src/test/planner-agent-is-a-distinct-principal.test.ts",
  },
  A3: {
    mutation:
      "all four authorship columns (actor_kind, actor_agent_id, approved_by_user_id, approved_at) " +
      "dropped from the insert",
    killedBy: "src/test/planner-agent-is-a-distinct-principal.test.ts",
  },
};

// ─────────────────────────────────────────────────────────────────────────────

function listTestFiles(): string[] {
  const root = repoPath("src/test");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.test\.tsx?$/.test(entry)) {
        out.push(full.slice(repoPath("").length).replace(/^\/+/, ""));
      }
    }
  };
  walk(root);
  return out.sort();
}

const auditedTestFiles = [
  ...new Set([
    ...Object.values(AUDITED_PRODUCTION_FILES).flatMap((entry) => entry.sampledBy),
    ...Object.values(CLOSED_SURVIVORS).map((entry) => entry.testFile),
    ...Object.values(CLOSED_2026_08_07).map((entry) => entry.testFile),
    ...Object.values(STRUCTURAL_SURVIVORS).map((entry) => entry.guardedInsteadBy.testFile),
    ...Object.values(OPEN_SURVIVORS).map((entry) => entry.sampledBy),
    ...Object.values(TITLE_VI_AUDITED_PRODUCTION_FILES).flatMap((entry) => entry.sampledBy),
    ...Object.values(TITLE_VI_CLOSED_SURVIVORS).map((entry) => entry.testFile),
    ...Object.values(TITLE_VI_STRUCTURAL_SURVIVORS).map((entry) => entry.guardedInsteadBy.testFile),
  ]),
].sort();

const allAuditedProductionFiles = [
  ...new Set([
    ...Object.keys(AUDITED_PRODUCTION_FILES),
    ...Object.keys(TITLE_VI_AUDITED_PRODUCTION_FILES),
    ...Object.values(CLOSED_2026_08_07).map((entry) => entry.productionFile),
    ...Object.values(STRUCTURAL_SURVIVORS).map((entry) => entry.productionFile),
  ]),
].sort();

describe("foundation audit ratchet", () => {
  it("every audited file still exists at the path this record names", () => {
    const missingProduction = allAuditedProductionFiles.filter(
      (file) => !existsSync(repoPath(file))
    );
    // A hollow guard whose subject was deleted or renamed must not read as a
    // fixed one. Update this record in the same change that moves the file.
    expect(missingProduction).toEqual([]);

    const missingTests = auditedTestFiles.filter((file) => !existsSync(repoPath(file)));
    expect(missingTests).toEqual([]);
  });

  it("every fix is still carried by the test that proved it", () => {
    const lost: string[] = [];

    for (const [id, fix] of Object.entries({
      ...CLOSED_SURVIVORS,
      ...CLOSED_2026_08_07,
      ...TITLE_VI_CLOSED_SURVIVORS,
    })) {
      if (!existsSync(repoPath(fix.testFile))) {
        lost.push(`${id}: ${fix.testFile} is gone`);
        continue;
      }
      const source = readFileSync(repoPath(fix.testFile), "utf8");
      if (!source.includes(fix.testName)) {
        lost.push(`${id}: "${fix.testName}" is no longer in ${fix.testFile}`);
      }
      if (!existsSync(repoPath(fix.productionFile))) {
        lost.push(`${id}: ${fix.productionFile} is gone`);
      }
    }

    for (const supporting of SUPPORTING_ASSERTIONS) {
      if (!existsSync(repoPath(supporting.testFile))) {
        lost.push(`supporting: ${supporting.testFile} is gone`);
        continue;
      }
      const source = readFileSync(repoPath(supporting.testFile), "utf8");
      if (!source.includes(supporting.testName)) {
        lost.push(`supporting: "${supporting.testName}" is no longer in ${supporting.testFile}`);
      }
    }

    // Each of these titles belongs to an assertion that was proven non-vacuous
    // by re-running the original mutation and watching it fail. Losing the title
    // means losing the proof, and the suite would go back to being green over
    // the hole — which is precisely the state the audit was run to end.
    expect(lost).toEqual([]);
  });

  it("the surviving-mutation ledger may only shrink", () => {
    // Kept in lockstep so neither can drift from the other: adding a survivor
    // without raising the ceiling fails, and closing one without lowering it
    // fails too.
    expect(Object.keys(OPEN_SURVIVORS)).toHaveLength(OPEN_SURVIVOR_CEILING);

    // 34 survived on 2026-08-06. This number may be lowered by a future audit
    // and must never be raised: a rising ceiling means a hole was recorded and
    // left, which is the outcome this file exists to make impossible to do
    // quietly.
    expect(OPEN_SURVIVOR_CEILING).toBeLessThanOrEqual(0);

    // The unreproducible three are held to the same rule. They may only leave
    // this file by being re-mutated and closed, never by being forgotten.
    expect(Object.keys(UNREPRODUCIBLE_SURVIVORS).length).toBeLessThanOrEqual(1);
  });

  it("every open survivor names a real file and states what is at stake", () => {
    for (const [id, survivor] of Object.entries(OPEN_SURVIVORS)) {
      expect(existsSync(repoPath(survivor.productionFile)), `${id}: production file`).toBe(true);
      expect(existsSync(repoPath(survivor.sampledBy)), `${id}: sampling test file`).toBe(true);
      // A one-word reason is how a ledger becomes a list nobody can act on.
      expect(survivor.mutation.length, `${id}: mutation`).toBeGreaterThan(20);
      expect(survivor.consequence.length, `${id}: consequence`).toBeGreaterThan(60);
    }
  });

  it("every sibling-covered survivor still has the sibling that covers it", () => {
    for (const [id, entry] of Object.entries(COVERED_BY_A_SIBLING)) {
      expect(existsSync(repoPath(entry.killedBy)), `${id}: ${entry.killedBy}`).toBe(true);
    }
  });

  it("records what was NOT audited, so a green run cannot be read as coverage", () => {
    const allTestFiles = listTestFiles();

    // The scanner must actually find the suite; a broken walk would make the
    // fraction below meaninglessly small and this whole test reassuring.
    expect(allTestFiles.length).toBeGreaterThan(600);

    const audited = auditedTestFiles.filter((file) => allTestFiles.includes(file));
    expect(audited).toEqual(auditedTestFiles);

    const unaudited = allTestFiles.length - audited.length;

    // THE POINT OF THIS TEST. 15 of 726 files were measured by mutation on
    // 2026-08-06 — about 2%. The remaining ~711 are UNMEASURED: not known to be
    // good, not known to be bad, simply never asked. Any claim that "the suite
    // is proven" is false, and the audit's own README-in-a-test says so here.
    expect(unaudited).toBeGreaterThan(600);
    expect(audited.length / allTestFiles.length).toBeLessThan(0.05);
  });

  it("guards the guard", () => {
    // A record that quietly emptied would make every assertion above vacuous.
    expect(Object.keys(AUDITED_PRODUCTION_FILES).length).toBeGreaterThanOrEqual(15);
    expect(Object.keys(CLOSED_SURVIVORS).length).toBe(AUDIT_2026_08_06.survivorsClosedSameDay);
    expect(auditedTestFiles.length).toBeGreaterThanOrEqual(11);

    // The audit's arithmetic has to close: killed + survived = mutations run.
    expect(AUDIT_2026_08_06.killed + AUDIT_2026_08_06.survived).toBe(AUDIT_2026_08_06.mutationsRun);

    // And the per-file survivor counts have to add up to the headline, or the
    // per-file record and the headline are describing different runs.
    const perFileSurvivors = Object.values(AUDITED_PRODUCTION_FILES).reduce(
      (total, entry) => total + entry.survivors,
      0
    );
    const perFileMutations = Object.values(AUDITED_PRODUCTION_FILES).reduce(
      (total, entry) => total + entry.mutations,
      0
    );
    expect(perFileSurvivors + UNATTRIBUTED_2026_08_06.survived).toBe(AUDIT_2026_08_06.survived);
    expect(perFileMutations + UNATTRIBUTED_2026_08_06.mutations).toBe(AUDIT_2026_08_06.mutationsRun);
    expect(UNATTRIBUTED_2026_08_06.killed + UNATTRIBUTED_2026_08_06.survived).toBe(
      UNATTRIBUTED_2026_08_06.mutations
    );

    // Closed + still open + carried by a sibling + unreproducible must account
    // for all 34. A survivor may change category; it may not leave the file.
    // A survivor may change category; it may not leave the file. The 2026-08-07
    // pass moved eleven from OPEN to CLOSED_2026_08_07, one from OPEN to
    // STRUCTURAL, and two from UNREPRODUCIBLE to CLOSED_2026_08_07 — so the five
    // buckets still account for all 34.
    expect(
      Object.keys(CLOSED_SURVIVORS).length +
        Object.keys(CLOSED_2026_08_07).length +
        Object.keys(OPEN_SURVIVORS).length +
        Object.keys(STRUCTURAL_SURVIVORS).length +
        Object.keys(COVERED_BY_A_SIBLING).length +
        Object.keys(UNREPRODUCIBLE_SURVIVORS).length
    ).toBe(AUDIT_2026_08_06.survived);

    expect(AUDIT_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("the Title VI pass accounts for every mutation it ran", () => {
    expect(TITLE_VI_AUDIT.killed + TITLE_VI_AUDIT.survived).toBe(TITLE_VI_AUDIT.mutationsRun);

    const perFile = Object.values(TITLE_VI_AUDITED_PRODUCTION_FILES);
    expect(perFile.reduce((total, entry) => total + entry.mutations, 0)).toBe(
      TITLE_VI_AUDIT.mutationsRun
    );
    expect(perFile.reduce((total, entry) => total + entry.survivors, 0)).toBe(
      TITLE_VI_AUDIT.survived
    );

    // Every survivor left the pass in exactly one of two ways: closed by an
    // assertion that was re-run against the original mutation, or shown to be
    // unreachable with the shipped data and replaced by a guard on the property
    // that makes it unreachable. Nothing was recorded and abandoned — unlike the
    // first pass, which left twelve open. If a later edit drops a closed
    // survivor, this fails rather than quietly lowering the standard.
    expect(
      Object.keys(TITLE_VI_CLOSED_SURVIVORS).length +
        Object.keys(TITLE_VI_STRUCTURAL_SURVIVORS).length
    ).toBe(TITLE_VI_AUDIT.survived);
    expect(Object.keys(TITLE_VI_CLOSED_SURVIVORS)).toHaveLength(TITLE_VI_AUDIT.survivorsClosed);
    expect(Object.keys(TITLE_VI_STRUCTURAL_SURVIVORS)).toHaveLength(
      TITLE_VI_AUDIT.structurallyUnreachable
    );

    expect(TITLE_VI_COLLATERAL_FIXES).toBeGreaterThan(0);
    expect(TITLE_VI_AUDIT.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps the guard that stands in for every unreachable branch", () => {
    // Both passes' structural survivors, plus the surface guard standing in for
    // the one mutation that still cannot be re-run. Losing any of these turns a
    // reasoned decision back into an open hole with nothing recording it.
    const standIns = [
      ...Object.entries(TITLE_VI_STRUCTURAL_SURVIVORS),
      ...Object.entries(STRUCTURAL_SURVIVORS),
      ...Object.entries(UNREPRODUCIBLE_SURVIVORS)
        .filter(([, entry]) => entry.surfaceNowGuardedBy)
        .map(([id, entry]) => [
          id,
          { productionFile: null, guardedInsteadBy: entry.surfaceNowGuardedBy! },
        ] as const),
    ] as Array<[string, { productionFile: string | null; guardedInsteadBy: { testFile: string; testName: string } }]>;

    expect(standIns.length).toBeGreaterThanOrEqual(3);

    for (const [id, entry] of standIns) {
      if (entry.productionFile) {
        expect(existsSync(repoPath(entry.productionFile)), `${id}: production file`).toBe(true);
      }
      const guardFile = repoPath(entry.guardedInsteadBy.testFile);
      expect(existsSync(guardFile), `${id}: ${entry.guardedInsteadBy.testFile}`).toBe(true);
      expect(readFileSync(guardFile, "utf8"), `${id}: guard assertion`).toContain(
        entry.guardedInsteadBy.testName
      );
    }
  });

  it("keeps the Title VI stand-in guards specifically", () => {
    for (const [id, entry] of Object.entries(TITLE_VI_STRUCTURAL_SURVIVORS)) {
      expect(existsSync(repoPath(entry.productionFile)), `${id}: production file`).toBe(true);
      const guardFile = repoPath(entry.guardedInsteadBy.testFile);
      expect(existsSync(guardFile), `${id}: ${entry.guardedInsteadBy.testFile}`).toBe(true);
      // Losing this assertion turns a reasoned decision back into an open hole.
      expect(readFileSync(guardFile, "utf8"), `${id}: guard assertion`).toContain(
        entry.guardedInsteadBy.testName
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* THE GROUNDING PASS — 2026-08-07                                             */
/* -------------------------------------------------------------------------- */

/**
 * The `[fact:id]` machinery, measured for the first time.
 *
 * It is the other half of the honesty firewall. The claim-tier guard stops a
 * model marking its own run `calibrated_to_counts`; THIS decides whether an
 * AI-drafted grant narrative, RTP chapter or report is defensible — whether
 * every sentence cites a real workspace fact, and whether the figures it asserts
 * appear in the facts it cited. Two files carry it and neither had ever been
 * mutation-tested.
 *
 * TWO SURVIVORS ARE EQUIVALENT MUTANTS AND ARE RECORDED AS SUCH, not claimed
 * fixed. Both mutate code that cannot change behaviour:
 *
 *   - the `1900 <= year <= 2099` branch in `isConsequentialNumber` is dead:
 *     every 4-digit core already returns true from the length clause below it.
 *     Measured across 2028 / 1899 / 2100 / 5000, not reasoned about.
 *   - the `unknownFactIds.length === 0` conjunct in `isFullyGrounded` is
 *     redundant: a sentence with an unknown id is not grounded, so it has
 *     already incremented `ungroundedCount`, and `unknownAll` is only pushed
 *     inside that same branch.
 *
 * Each is pinned by the PROPERTY that makes it equivalent rather than by an
 * assertion that would pass for the wrong reason.
 */
const GROUNDING_AUDIT = {
  date: "2026-08-07",
  mutationsRun: 24,
  killed: 18,
  survived: 6,
  /** A comment-only negative control, confirmed SURVIVING before the run. */
  controls: 1,
  /** Closed with an assertion re-run against the original mutation. */
  survivorsClosed: 4,
  /** Provably equivalent mutants — the code they change is redundant. */
  equivalent: 2,
};

const GROUNDING_AUDITED_PRODUCTION_FILES: Record<string, AuditedFile> = {
  "src/lib/planner-pack/grounding.ts": {
    sampledBy: ["src/test/planner-pack-grounding.test.ts"],
    mutations: 14,
    survivors: 4,
  },
  "src/lib/grants/narrative-grounding.ts": {
    sampledBy: ["src/test/grants-narrative-grounding.test.ts"],
    mutations: 10,
    survivors: 2,
  },
};

/** The four real holes, and the assertion that now kills each one. */
const GROUNDING_CLOSED_SURVIVORS: Record<string, ClosedSurvivor> = {
  G7: {
    productionFile: "src/lib/planner-pack/grounding.ts",
    testFile: "src/test/planner-pack-grounding.test.ts",
    testName: "checks SMALL money, which nothing was asserting",
    mutation:
      "isConsequentialNumber: drop the `$`/`%` clause, so a fabricated \"$500\" or \"4%\" is never cross-checked against its cited fact",
  },
  G13: {
    productionFile: "src/lib/planner-pack/grounding.ts",
    testFile: "src/test/planner-pack-grounding.test.ts",
    testName: "reports one entry per distinct fact id, however many times it was cited",
    mutation: "dedupePreservingOrder returns its input, so cited/unknown id lists become citation tallies",
  },
  N4: {
    productionFile: "src/lib/grants/narrative-grounding.ts",
    testFile: "src/test/grants-narrative-grounding.test.ts",
    testName: "counts DROPPED sentences in the denominator, not only the kept ones",
    mutation:
      "total_sentence_count drops `+ droppedSentences.length`, so a strict-mode draft reports 1 of 1 grounded instead of 1 of 3",
  },
  N9: {
    productionFile: "src/lib/grants/narrative-grounding.ts",
    testFile: "src/test/grants-narrative-grounding.test.ts",
    testName: "rejects a payload whose sentence flags are not booleans",
    mutation: "parseSentence stops rejecting a non-boolean is_grounded, so a malformed row decides what an operator reviews",
  },
};

/** The two provably-equivalent mutants, and the property pinning each. */
const GROUNDING_EQUIVALENT_MUTANTS: Record<
  string,
  { productionFile: string; guardedInsteadBy: { testFile: string; testName: string } }
> = {
  G5: {
    productionFile: "src/lib/planner-pack/grounding.ts",
    guardedInsteadBy: {
      testFile: "src/test/planner-pack-grounding.test.ts",
      testName: "EQUIVALENT MUTANT, recorded: the unknown-id conjunct in the verdict is redundant",
    },
  },
  G8: {
    productionFile: "src/lib/planner-pack/grounding.ts",
    guardedInsteadBy: {
      testFile: "src/test/planner-pack-grounding.test.ts",
      testName: "EQUIVALENT MUTANT, recorded rather than closed: the year clause is dead code",
    },
  },
};

describe("the grounding pass is accounted for", () => {
  it("adds up, and leaves no survivor merely recorded", () => {
    expect(GROUNDING_AUDIT.killed + GROUNDING_AUDIT.survived).toBe(GROUNDING_AUDIT.mutationsRun);

    const perFile = Object.values(GROUNDING_AUDITED_PRODUCTION_FILES);
    expect(perFile.reduce((total, entry) => total + entry.mutations, 0)).toBe(
      GROUNDING_AUDIT.mutationsRun
    );
    expect(perFile.reduce((total, entry) => total + entry.survivors, 0)).toBe(
      GROUNDING_AUDIT.survived
    );

    // Every survivor left this pass either closed or proved equivalent. The
    // first pass left twelve open; that is the standard this replaces.
    expect(
      Object.keys(GROUNDING_CLOSED_SURVIVORS).length +
        Object.keys(GROUNDING_EQUIVALENT_MUTANTS).length
    ).toBe(GROUNDING_AUDIT.survived);
    expect(Object.keys(GROUNDING_CLOSED_SURVIVORS)).toHaveLength(GROUNDING_AUDIT.survivorsClosed);
    expect(Object.keys(GROUNDING_EQUIVALENT_MUTANTS)).toHaveLength(GROUNDING_AUDIT.equivalent);
  });

  it("keeps every assertion this pass added", () => {
    for (const [id, entry] of [
      ...Object.entries(GROUNDING_CLOSED_SURVIVORS).map(
        ([key, value]) =>
          [key, { productionFile: value.productionFile, guardedInsteadBy: { testFile: value.testFile, testName: value.testName } }] as const
      ),
      ...Object.entries(GROUNDING_EQUIVALENT_MUTANTS),
    ]) {
      expect(existsSync(repoPath(entry.productionFile)), `${id}: production file`).toBe(true);
      const guardFile = repoPath(entry.guardedInsteadBy.testFile);
      expect(existsSync(guardFile), `${id}: ${entry.guardedInsteadBy.testFile}`).toBe(true);
      // Deleting the assertion turns a measured result back into an open hole
      // with nothing recording that it was ever looked at.
      expect(readFileSync(guardFile, "utf8"), `${id}: guard assertion`).toContain(
        entry.guardedInsteadBy.testName
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* THE CEQA PASS — 2026-08-07                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The §15064.3 determination path — and the first area measured that is SOLID.
 *
 * This is the highest-stakes output the product produces: a CEQA transportation
 * significance determination, under California statute, that a lead agency may
 * carry into an environmental document. Three files decide it — the arithmetic
 * (`planner-pack/ceqa.ts`), the KPI-to-input derivation
 * (`models/ceqa-vmt-screen.ts`), and the gate that keeps screening-grade
 * evidence out of it without consent (`models/caveat-gate.ts`).
 *
 * 42 mutations. The first 26 were the obvious ones — an inverted determination,
 * a threshold flipped from 15% BELOW to 15% ABOVE, the population check removed,
 * the statutory citation emptied — and ALL 26 DIED. That is far better than
 * anything the earlier passes found (53% and 52% of mutations survived in the
 * foundation and Title VI sweeps), and it is exactly the result that should
 * prompt suspicion rather than a conclusion: a 100% kill rate on obvious
 * mutations may only mean the mutations were obvious.
 *
 * So a second, subtler batch of 16 was run — rounding precision, the delta's
 * denominator, the coercion of a blank cell, one KPI name swapped for another.
 * It found three, and every one was worth finding:
 *
 *   E4 adding `jobs_total` to the population KPI names changed no test, and the
 *      behavioral-onramp KPI set persists `jobs_total` one line from
 *      `population_total` — a per-capita figure over a population that does not
 *      exist, compared to a residential threshold.
 *   D6 removing the blank-cell coercion from `rowNumber` made one empty cell
 *      THROW, which aborts the determination for every other scenario in the
 *      same table rather than skipping the one row.
 *   E3 the `Number.isFinite` belt had no test. Measured against the live stack:
 *      `model_run_kpis.value` is `double precision` and CAN hold Infinity, and
 *      PostgREST serialises it as the STRING "Infinity" — so on the database
 *      path the `typeof === "number"` check is what rejects it, and the belt
 *      only matters to an in-process caller. Both paths are now pinned.
 *
 * All three closed and re-run against the original mutation. No equivalent
 * mutants in this pass.
 */
const CEQA_AUDIT = {
  date: "2026-08-07",
  mutationsRun: 42,
  killed: 39,
  survived: 3,
  /** A comment-only negative control, confirmed SURVIVING before the run. */
  controls: 1,
  survivorsClosed: 3,
};

const CEQA_AUDITED_PRODUCTION_FILES: Record<string, AuditedFile> = {
  "src/lib/planner-pack/ceqa.ts": {
    sampledBy: ["src/test/planner-pack-ceqa.test.ts"],
    mutations: 26,
    survivors: 1,
  },
  "src/lib/models/ceqa-vmt-screen.ts": {
    sampledBy: ["src/test/ceqa-vmt-screen.test.ts"],
    mutations: 12,
    survivors: 2,
  },
  "src/lib/models/caveat-gate.ts": {
    sampledBy: ["src/test/caveat-gate.test.ts", "src/test/modeling-caveat-gate-stages.test.ts"],
    mutations: 4,
    survivors: 0,
  },
};

const CEQA_CLOSED_SURVIVORS: Record<string, ClosedSurvivor> = {
  E4: {
    productionFile: "src/lib/models/ceqa-vmt-screen.ts",
    testFile: "src/test/ceqa-vmt-screen.test.ts",
    testName: "accepts no KPI name that is not a count of residents",
    mutation: "add `jobs_total` to CEQA_POPULATION_KPI_NAMES, so VMT is divided by jobs",
  },
  D6: {
    productionFile: "src/lib/planner-pack/ceqa.ts",
    testFile: "src/test/planner-pack-ceqa.test.ts",
    testName: "treats an empty population cell as zero, and skips only that scenario",
    mutation: "drop the `value === \"\"` coercion in rowNumber, so one blank cell throws and aborts every scenario",
  },
  E3: {
    productionFile: "src/lib/models/ceqa-vmt-screen.ts",
    testFile: "src/test/ceqa-vmt-screen.test.ts",
    testName: "refuses a non-finite number if one ever reaches it in-process",
    mutation: "drop Number.isFinite from findRunLevelKpi, so +Infinity passes the `> 0` test",
  },
};

describe("the CEQA pass is accounted for", () => {
  it("adds up, and closed every survivor", () => {
    expect(CEQA_AUDIT.killed + CEQA_AUDIT.survived).toBe(CEQA_AUDIT.mutationsRun);

    const perFile = Object.values(CEQA_AUDITED_PRODUCTION_FILES);
    expect(perFile.reduce((total, entry) => total + entry.mutations, 0)).toBe(
      CEQA_AUDIT.mutationsRun
    );
    expect(perFile.reduce((total, entry) => total + entry.survivors, 0)).toBe(CEQA_AUDIT.survived);
    expect(Object.keys(CEQA_CLOSED_SURVIVORS)).toHaveLength(CEQA_AUDIT.survivorsClosed);
  });

  it("keeps every assertion this pass added", () => {
    for (const [id, entry] of Object.entries(CEQA_CLOSED_SURVIVORS)) {
      expect(existsSync(repoPath(entry.productionFile)), `${id}: production file`).toBe(true);
      const guardFile = repoPath(entry.testFile);
      expect(existsSync(guardFile), `${id}: ${entry.testFile}`).toBe(true);
      expect(readFileSync(guardFile, "utf8"), `${id}: guard assertion`).toContain(entry.testName);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* THE CLAIM-TIER PASS — 2026-08-07                                            */
/* -------------------------------------------------------------------------- */

/**
 * `resolveModelingClaimDecision` — the honesty firewall's own decision
 * procedure, and the one place in the product that decides how strongly a
 * modelling number may be claimed.
 *
 * 14 mutations, 9 killed. FIVE LIVED, and two of them PROMOTE a tier — the
 * exact outcome the firewall exists to make impossible:
 *
 *   T2  dropping `missingRequiredMetricKeys.length > 0` from the prototype
 *       condition. A run that never produced a required validation metric does
 *       not merely slip to screening-grade — with no failures among the checks
 *       that DID run it falls through to `claim_grade_passed`, the strongest
 *       tier, on the strength of checks that were never the point.
 *   T4  dropping `screeningReasons.length > 0` from the screening condition.
 *       That list is how a caller states a limit the validation table cannot
 *       see (a coarse zone system, a frozen input); ignoring it promotes the run.
 *   T11 the prototype-only report sentence — "Do not use for outward planning
 *       claims" — could be emptied.
 *   T12 a prototype-only run's `statusReason` could be emptied.
 *   T13 a claim-grade pass's `statusReason` could be emptied.
 *
 * The last three are the same defect in three places: a tier with no stated
 * basis is worse than a missing tier, because the badge still renders and still
 * carries authority while the one thing that would let a reviewer weigh it is
 * gone. All five closed and re-run: 5 for 5.
 */
const CLAIM_TIER_AUDIT = {
  date: "2026-08-07",
  mutationsRun: 14,
  killed: 9,
  survived: 5,
  controls: 1,
  survivorsClosed: 5,
};

const CLAIM_TIER_AUDITED_PRODUCTION_FILES: Record<string, AuditedFile> = {
  "src/lib/models/evidence-backbone.ts": {
    sampledBy: [
      "src/test/modeling-evidence-backbone.test.ts",
      "src/test/one-claim-tier-labeler.test.ts",
    ],
    mutations: 14,
    survivors: 5,
  },
};

const CLAIM_TIER_CLOSED_SURVIVORS: Record<string, ClosedSurvivor> = {
  T2: {
    productionFile: "src/lib/models/evidence-backbone.ts",
    testFile: "src/test/modeling-evidence-backbone.test.ts",
    testName: "holds a run at prototype_only when a REQUIRED metric was never validated",
    mutation: "drop missingRequiredMetricKeys from the prototype condition — the run reaches claim_grade_passed",
  },
  T4: {
    productionFile: "src/lib/models/evidence-backbone.ts",
    testFile: "src/test/modeling-evidence-backbone.test.ts",
    testName: "honours a caller's explicit screening reason even when every check passed",
    mutation: "drop screeningReasons from the screening condition — a stated limit stops downgrading",
  },
  T11: {
    productionFile: "src/lib/models/evidence-backbone.ts",
    testFile: "src/test/modeling-evidence-backbone.test.ts",
    testName: "says why a run is prototype-only, and what not to do with it",
    mutation: "empty the prototype-only report sentence",
  },
  T12: {
    productionFile: "src/lib/models/evidence-backbone.ts",
    testFile: "src/test/modeling-evidence-backbone.test.ts",
    testName: "says why a run is prototype-only, and what not to do with it",
    mutation: "empty a prototype-only decision's statusReason",
  },
  T13: {
    productionFile: "src/lib/models/evidence-backbone.ts",
    testFile: "src/test/modeling-evidence-backbone.test.ts",
    testName: "says what a claim-grade pass rests on",
    mutation: "empty a claim-grade decision's statusReason",
  },
};

describe("the claim-tier pass is accounted for", () => {
  it("adds up, and closed every survivor", () => {
    expect(CLAIM_TIER_AUDIT.killed + CLAIM_TIER_AUDIT.survived).toBe(CLAIM_TIER_AUDIT.mutationsRun);
    const perFile = Object.values(CLAIM_TIER_AUDITED_PRODUCTION_FILES);
    expect(perFile.reduce((total, entry) => total + entry.mutations, 0)).toBe(
      CLAIM_TIER_AUDIT.mutationsRun
    );
    expect(perFile.reduce((total, entry) => total + entry.survivors, 0)).toBe(
      CLAIM_TIER_AUDIT.survived
    );
    expect(Object.keys(CLAIM_TIER_CLOSED_SURVIVORS)).toHaveLength(CLAIM_TIER_AUDIT.survivorsClosed);
  });

  it("keeps every assertion this pass added", () => {
    for (const [id, entry] of Object.entries(CLAIM_TIER_CLOSED_SURVIVORS)) {
      expect(existsSync(repoPath(entry.productionFile)), `${id}: production file`).toBe(true);
      const guardFile = repoPath(entry.testFile);
      expect(existsSync(guardFile), `${id}: ${entry.testFile}`).toBe(true);
      expect(readFileSync(guardFile, "utf8"), `${id}: guard assertion`).toContain(entry.testName);
    }
  });
});
