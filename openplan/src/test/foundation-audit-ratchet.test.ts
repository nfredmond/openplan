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
 * On 2026-08-06, 64 mutations were run against 20 production files sampled by 15
 * test files. 30 were killed. 34 SURVIVED. Every verdict was read off the
 * `Tests` summary line's `(\d+) failed` segment alone, every mutation was
 * restored by editing the string back and verified with sha256 against a
 * baseline captured first, and the harness was proven to report a KILL, a
 * SURVIVAL and a HARNESS-ERROR before any verdict was trusted.
 *
 * ================================================== WHAT THIS FILE IS FOR, NOW
 *
 * Three jobs, and the third is the one a future session will care about most:
 *
 *   1. It fails if an audited file is DELETED OR RENAMED without this record
 *      being updated. A hollow guard that vanishes must not be indistinguishable
 *      from a fixed one.
 *   2. It fails if any of the sixteen tests written to CLOSE a survivor is
 *      removed or renamed. Those assertions are the entire product of the audit;
 *      an ordinary refactor that drops one would silently reopen the hole, and
 *      the suite would stay green because that is exactly what it did before.
 *   3. It carries the surviving mutations as a ledger whose size may only go
 *      DOWN. Each entry names the file, the mutation, and what a planner loses
 *      if it is real. Fixing one means deleting its entry and lowering the
 *      ceiling; nothing may be added without a deliberate edit here.
 *
 * =========================================== WHAT THIS FILE DOES *NOT* CLAIM
 *
 * 15 of 726 test files were measured. It does not speak for the other 711, and
 * `records what was NOT audited` below exists so a green run can never be read
 * as "the suite was measured". That would be this audit committing the very
 * defect it was run to find.
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
const OPEN_SURVIVORS: Record<string, OpenSurvivor> = {
  CG1: {
    productionFile: "src/lib/geo/corridor-geometry.ts",
    sampledBy: "src/test/corridor-geometry.test.ts",
    mutation: "the longitude bound widened 10× (|lon| > 180 → |lon| > 1800)",
    consequence:
      "A corridor whose coordinates are not longitudes at all is accepted as valid geometry, and " +
      "every downstream area/length figure computed from it is meaningless rather than absent.",
    scope: "whole-suite",
  },
  CG2: {
    productionFile: "src/lib/geo/corridor-geometry.ts",
    sampledBy: "src/test/corridor-geometry.test.ts",
    mutation: "the latitude bound widened 10× (|lat| > 90 → |lat| > 900)",
    consequence:
      "Same as CG1 on the other axis. The pair matters together: nothing in the suite varies a " +
      "coordinate out of range, so the whole range check is untested.",
    scope: "whole-suite",
  },
  CG4: {
    productionFile: "src/lib/geo/corridor-geometry.ts",
    sampledBy: "src/test/corridor-geometry.test.ts",
    mutation: "the minimum-ring-points check disabled (ring.length < MIN_RING_POINTS → < 0)",
    consequence:
      "A degenerate ring of one or two vertices passes validation as a polygon. It encloses no " +
      "area, so any per-area metric derived from it divides by zero or reports zero.",
    scope: "whole-suite",
  },
  CG5: {
    productionFile: "src/lib/geo/corridor-geometry.ts",
    sampledBy: "src/test/corridor-geometry.test.ts",
    mutation: "only the first ring is validated (rings.forEach → rings.slice(0, 1).forEach)",
    consequence:
      "Holes and secondary rings go unchecked. A multipolygon study area — which is what an " +
      "agency with two disjoint service areas has — is validated on one of its parts.",
    scope: "whole-suite",
  },
  CG6: {
    productionFile: "src/lib/geo/corridor-geometry.ts",
    sampledBy: "src/test/corridor-geometry.test.ts",
    mutation: "the geometry-type gate removed (Polygon/MultiPolygon check → if (false))",
    consequence:
      "A LineString or Point is accepted where a polygon is required, so the type contract the " +
      "rest of the geometry code assumes is enforced nowhere.",
    scope: "whole-suite",
  },
  CR5: {
    productionFile: "src/lib/data-sources/crashes.ts",
    sampledBy: "src/test/crashes-data-source.test.ts",
    mutation: "the fatal-crash floor removed (totalFatalities += Math.max(1, killedCount) → += killedCount)",
    consequence:
      "A record flagged fatal whose killed-count is 0 or null contributes zero deaths. The floor " +
      "exists because a fatal crash killed at least one person; without it a safety page can " +
      "under-report fatalities on exactly the records whose data is worst.",
    scope: "whole-suite",
  },
  CR6: {
    productionFile: "src/lib/data-sources/crashes.ts",
    sampledBy: "src/test/crashes-data-source.test.ts",
    mutation: "crash density no longer annualised (annualBasis = years queried → 1)",
    consequence:
      "A four-year crash total is presented as an annual rate — a 4× overstatement on a number " +
      "planners put in grant applications and safety findings.",
    scope: "whole-suite",
  },
  IA1: {
    productionFile: "src/lib/accessibility/isochrone.ts",
    sampledBy: "src/test/isochrone-accessibility.test.ts",
    mutation: "the high-accessibility tier threshold moved (rawScore >= 39 → >= 30)",
    consequence:
      "A tier boundary a planner reports as a finding. Nothing pins either threshold, so the " +
      "labels 'high' and 'medium' can move without a single test noticing.",
    scope: "whole-suite",
  },
  IA2: {
    productionFile: "src/lib/accessibility/isochrone.ts",
    sampledBy: "src/test/isochrone-accessibility.test.ts",
    mutation: "the medium tier threshold moved (rawScore >= 21 → >= 15)",
    consequence:
      "As IA1, on the lower boundary: places that are scored 'low accessibility' today would be " +
      "reported as 'medium', and nothing in the suite pins where that line sits.",
    scope: "whole-suite",
  },
  IA5: {
    productionFile: "src/lib/accessibility/isochrone.ts",
    sampledBy: "src/test/isochrone-accessibility.test.ts",
    mutation: "a transit-mode-share scoring bucket collapsed ([25, 24] → [25, 4])",
    consequence:
      "The score curve is re-shaped in the middle of its range with no test on the bucket table, " +
      "so a place's accessibility score changes without any recorded reason.",
    scope: "whole-suite",
  },
  IA6: {
    productionFile: "src/lib/accessibility/isochrone.ts",
    sampledBy: "src/test/isochrone-accessibility.test.ts",
    mutation: "the zero-vehicle-household top bucket cut (14 → 2)",
    consequence:
      "Zero-vehicle share is the equity term of the accessibility score. Flattening its top bucket " +
      "removes most of the credit carless households earn — an equity finding, silently.",
    scope: "whole-suite",
  },
  SWEEP_A3: {
    productionFile:
      "src/app/api/funding-opportunities/[opportunityId]/sections/[sectionId]/draft/route.ts",
    sampledBy: "src/test/grants-narrative-evidence-proposal.test.ts",
    mutation:
      "the four pursuit columns dropped from the sibling route's patch, making it behave like " +
      "loadFundingOpportunityAccess already does",
    consequence:
      "THIS ONE IS A LIVE PRODUCTION DEFECT, not only an unguarded claim. " +
      "loadFundingOpportunityAccess never selects pursuit_kind / solicitation_number / " +
      "submission_format_note / questions_due_at, so `isProposal` is permanently false on the " +
      "standalone narrative-draft route: a planner answering an RFP gets a draft with no " +
      "solicitation number, no submission-format note, no questions-due date and no " +
      "past-performance grounding, and nothing says anything was dropped. The per-section drafter " +
      "patches the same columns in, so the two doors into one feature disagree silently. Fixing " +
      "the projection is the real close; the guard follows it.",
    scope: "whole-suite",
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
const UNREPRODUCIBLE_SURVIVORS: Record<string, { label: string; surface: string }> = {
  SWEEP_B7: {
    label: "B7 — sketch accessibility",
    surface: "the sketch accessibility scoring path; file not recorded by the sweep harness",
  },
  SWEEP_B8: {
    label: "B8 — report access projection",
    surface:
      "a report-access `.select()` projection; file not recorded. The projection class is the " +
      "one a mocked Supabase client provably cannot catch, so this is the likeliest of the three " +
      "to be a live defect rather than only an unguarded rule.",
  },
  SWEEP_B9: {
    label: "B9 — atp packet",
    surface:
      "src/lib/planner-pack/atp.ts (inferred from the sweep's own baseline sha file, which lists " +
      "atp.ts, and from B10 having mutated it — inferred, not recorded)",
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
const OPEN_SURVIVOR_CEILING = 12;

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
    ...Object.values(OPEN_SURVIVORS).map((entry) => entry.sampledBy),
  ]),
].sort();

describe("foundation audit ratchet", () => {
  it("every audited file still exists at the path this record names", () => {
    const missingProduction = Object.keys(AUDITED_PRODUCTION_FILES).filter(
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

    for (const [id, fix] of Object.entries(CLOSED_SURVIVORS)) {
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
    expect(OPEN_SURVIVOR_CEILING).toBeLessThanOrEqual(12);

    // The unreproducible three are held to the same rule. They may only leave
    // this file by being re-mutated and closed, never by being forgotten.
    expect(Object.keys(UNREPRODUCIBLE_SURVIVORS).length).toBeLessThanOrEqual(3);
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
    expect(
      Object.keys(CLOSED_SURVIVORS).length +
        Object.keys(OPEN_SURVIVORS).length +
        Object.keys(COVERED_BY_A_SIBLING).length +
        Object.keys(UNREPRODUCIBLE_SURVIVORS).length
    ).toBe(AUDIT_2026_08_06.survived);

    expect(AUDIT_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
