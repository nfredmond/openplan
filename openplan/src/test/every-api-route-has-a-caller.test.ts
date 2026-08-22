import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripSourceComments } from "./helpers/source-text";

/**
 * THE REPO'S MOST EXPENSIVE RECURRING DEFECT, MADE INTO A BUILD FAILURE.
 *
 * A capability gets built, tested, role-gated and reviewed — and no page calls
 * it. The suite is green because it tests the unit, not the path to the unit.
 * It has happened at least seven times: award close-out controls gated on the
 * wrong permission, closure provenance missing from both `.select()`s, an
 * operator worker declaration documented but never passed through, GIS context
 * layers whose loader had no caller on any public surface, the embed route
 * rendering raw source strings under a translated body, and — the one this
 * guard was written alongside — `/api/workspaces/invitations/decline`, a fully
 * audited email-matched route with nothing in the product calling it, so the
 * only way out of a workspace invitation was to let it expire.
 *
 * WHAT IT CHECKS. Every `route.ts` under `src/app/api` must be called by
 * something that is not another API route and not a test: a component, a page, a
 * hook, or a client helper. "Called" means THE WHOLE PATH APPEARS IN ONE
 * EXPRESSION — every static segment written literally, in order, with each
 * dynamic segment supplied by a `${…}` interpolation or a literal value:
 *
 *     fetch(`/api/models/${modelId}/runs/${runId}/kpis`)   ← counts
 *     `${origin}/api/engage/${shareToken}/subscribe`       ← counts
 *
 * Comments are blanked before the scan (`stripSourceComments`), because a
 * paragraph ABOUT a route is not a call to it — this guard's first version was
 * defeated exactly that way.
 *
 * WHAT IT DOES NOT CHECK. That the caller is reachable in the UI, that the right
 * role sees it, or that the request is well-formed. A guard that tried to would
 * be a type-checker. Reachability past this point is still the job of a test
 * that renders the surface and asserts what a person would see.
 *
 * ═══ WHY THE MATCHER LOOKS FOR A WHOLE PATH (2026-08-12) ═══
 *
 * It used to take the route's longest STATIC PREFIX and then check each
 * remaining word with a bare `String.includes` against the whole file. The two
 * halves need not come from the same line, the same expression, or even the same
 * kind of token — so a SIBLING route's call site could supply the prefix while
 * an unrelated word anywhere in the file supplied the tail.
 *
 * Measured, not guessed. Of 232 routes, 121 have a static segment after their
 * first dynamic one. Deleting every whole-path call site for each in turn and
 * re-running the OLD matcher left 98 OF THOSE 121 STILL GREEN — the guard could
 * not see the deletion of the only caller. Worked examples:
 *
 *   - `api/workspace-gis/layers/[layerId]/references` — prefix from the
 *     DELETE-layer fetch a few lines above, tail from a docblock reading
 *     "export path, references, counts".
 *   - `api/measures/[measureId]/statement` — prefix from the `/public-share`
 *     fetch, tail from a docblock containing the word "statement".
 *   - `api/models/[modelId]/runs/[modelRunId]/kpis` — prefix from the
 *     `/vmt-significance` fetch, tail from `const [kpis, setKpis] = useState`.
 *
 * Requiring the whole path in one expression removes that entirely: there is no
 * "tail" left to satisfy from elsewhere. The cost is that a caller which
 * ASSEMBLES a path in pieces is no longer visible either, and those are real —
 * so they are named, one by one, in `PARTIAL_PATH_CALLERS` below.
 */

/**
 * Routes with NO in-app caller by design, each with the caller that is not in
 * `src/`. Every entry is a claim that can be checked by reading the route.
 */
const EXTERNAL_CALLERS: Record<string, string> = {
  "api/health":
    "Uptime monitoring and container orchestration probe this; it exists to be called from outside.",
  "api/geographies/equity-designation/ingest":
    "Operator/CI data load, authenticated by a shared secret with timingSafeEqual — cross-tenant public reference data, deliberately not driven from a workspace UI.",
  "api/county-runs/[countyRunId]/validate/refresh":
    "County worker callback, authenticated by isAuthenticatedCountyWorkerCallback — the Python worker posts its validation summary back here.",
  "api/csp-report":
    "Browsers post Content-Security-Policy violation reports here — next.config.ts names it in the CSP header's report-uri. Its only in-src mention was a dead file; the real caller was never in src/.",
  "api/aerial/processing-callback":
    "Photogrammetry worker callback — the processing platform posts job status and artifact descriptors here. Authenticated by the callback contract, not by a session.",
  "api/cron/reap-gtfs-ingests":
    "Vercel Cron, scheduled in vercel.json. Closes transit-feed ingests that stopped responding, so a version row written `pending` before any network work cannot sit on a Data Hub card forever. Authenticated by CRON_SECRET, never from a session.",
  "api/cron/reap-model-runs":
    "Vercel Cron, scheduled in vercel.json. Recorded here EXPLICITLY: under the old word-bag matcher it was passing only because `src/lib/models/worker-backed-launch.ts` mentions the path inside backticks in a docblock, so rewording that comment would have broken the build for a reason nobody could have guessed. Comments are now blanked before the scan, which is what makes THIS entry the thing holding it up.",
  "api/cron/sweep-deadlines":
    "Vercel Cron, scheduled in vercel.json at 0 13 * * *. The daily deadline digest: it writes one work_notifications row per person per due record and sends the email when a transport is configured. Authenticated by CRON_SECRET compared with timingSafeSecretEquals, never from a session — nothing in the product calls it, and nothing should, because a user-triggered sweep would let one person mail the whole team.",
  "api/knowledge-base/ocr-callback":
    "OCR worker callback — a self-hosted recogniser (workers/ocr_worker, or anything speaking schemas/ocr_extraction_contract.schema.json) posts per-page text here as a job advances. Bearer-authenticated with OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN, never from a session: this is the route that turns recognised text into citable chunks and flips a scanned document to `ready`, so a caller inside the product would be a way to make a document claim text nobody read. The REQUEST side of the lane (api/knowledge-base/documents/[documentId]/ocr) is wired to the document library's 'Read with OCR' button and needs no entry here.",
  "api/engage/[shareToken]/subscribe/confirm":
    "The double-opt-in confirmation link, clicked from a participant's email client. Its URL is minted inside api/engage/[shareToken]/subscribe/route.ts — an API route, which this scan excludes on purpose so one route cannot vouch for another — and it answers HTML, not JSON, because the browser opening it came from an inbox and not from OpenPlan. A caller inside the product would be a way to confirm a subscription the person never confirmed.",
  "api/aerial/missions/[missionId]/export":
    "410 Gone tombstone for the superseded perimeter export (see src/lib/aerial/dji-export.ts) — its only callers are pre-supersession bookmarks and scripts OUTSIDE this codebase, which the 410 body redirects to the flight-plan export lane. Under the old word-bag matcher this entry excused nothing: the bare word `export` appears in every TS module, so five aerial components matched it spuriously. The whole-path matcher no longer accepts that, so the entry is now load-bearing on its own — and the named tombstone assertion below keeps it deliberate.",
};

/**
 * Callers that ASSEMBLE the path instead of writing it whole, named one by one.
 *
 * The whole-path matcher cannot see `` `${versionBase}/zones` `` or
 * `` `/api/workspaces/invitations/${decision}` ``, and both are real call sites
 * a planner reaches every day. Rather than loosen the matcher back toward
 * substrings, each is recorded here with the file and the exact expression that
 * builds it, so the claim is checkable by reading one line.
 *
 * THIS LIST MAY ONLY SHRINK, and it cleans itself in both directions: the
 * assertions below fail if a named file stops containing its expression, and
 * fail if the route gains an ordinary whole-path caller (delete the entry then).
 * Adding one means a reviewer can ask why the path is not written out.
 */
const PARTIAL_PATH_CALLERS: Record<string, { file: string; expression: string; reason: string }> = {
  "api/workspaces/invitations/accept": {
    file: "src/components/workspaces/invitation-decision.tsx",
    expression: "`/api/workspaces/invitations/${decision}`",
    reason:
      "Accept and decline are the same form with one variable: `decision` is the union 'accept' | 'decline', so the last SEGMENT is the choice. Writing the two paths out would mean two fetches that must be kept identical.",
  },
  "api/workspaces/invitations/decline": {
    file: "src/components/workspaces/invitation-decision.tsx",
    expression: "`/api/workspaces/invitations/${decision}`",
    reason:
      "The other half of the same one-variable form. This is the route whose absence of a caller caused this guard to exist, so its evidence is named rather than inferred.",
  },
  "api/engagement/campaigns/[campaignId]/survey/questions/[questionId]/options/[optionId]": {
    file: "src/components/engagement/survey-builder.tsx",
    expression: "const base = `/api/engagement/campaigns/${campaignId}/survey/questions/${question.id}/options`",
    reason:
      "The option manager holds the collection path in `base` and deletes one option with `${base}/${optionId}` — a five-segment path that would otherwise be written twice in eight lines.",
  },
  "api/network-packages/[packageId]/versions/[versionId]/ingest": {
    file: "src/app/(app)/models/_components/network-package-upload-form.tsx",
    expression: "const versionBase = `/api/network-packages/${packageId}/versions/${versionId}`",
    reason:
      "The upload form runs one ordered sequence against a version it just created — ingest, then zones, corridors, connectors — off a single `versionBase` binding. Splitting the base out is what keeps the four steps provably against the SAME version.",
  },
  "api/network-packages/[packageId]/versions/[versionId]/zones": {
    file: "src/app/(app)/models/_components/network-package-upload-form.tsx",
    expression: "const versionBase = `/api/network-packages/${packageId}/versions/${versionId}`",
    reason: "Step 4 of the same sequence, posted as `${versionBase}/zones`.",
  },
  "api/network-packages/[packageId]/versions/[versionId]/corridors": {
    file: "src/app/(app)/models/_components/network-package-upload-form.tsx",
    expression: "const versionBase = `/api/network-packages/${packageId}/versions/${versionId}`",
    reason: "Step 5 of the same sequence, posted as `${versionBase}/corridors`.",
  },
  "api/network-packages/[packageId]/versions/[versionId]/connectors": {
    file: "src/app/(app)/models/_components/network-package-upload-form.tsx",
    expression: "const versionBase = `/api/network-packages/${packageId}/versions/${versionId}`",
    reason: "Step 6 of the same sequence, posted as `${versionBase}/connectors`.",
  },
  "api/scenarios/[scenarioSetId]/spine/assumption-sets": {
    file: "src/components/scenarios/scenario-spine-panel.tsx",
    expression: "await fetch(`/api/scenarios/${scenarioSetId}/spine/${path}`",
    reason:
      "One `create(kind, payload)` function serves all three spine records; `path` is a ternary over the three literal segment names, which are right above the fetch.",
  },
  "api/scenarios/[scenarioSetId]/spine/data-packages": {
    file: "src/components/scenarios/scenario-spine-panel.tsx",
    expression: "await fetch(`/api/scenarios/${scenarioSetId}/spine/${path}`",
    reason: "Second branch of the same three-way ternary.",
  },
  "api/scenarios/[scenarioSetId]/spine/indicator-snapshots": {
    file: "src/components/scenarios/scenario-spine-panel.tsx",
    expression: "await fetch(`/api/scenarios/${scenarioSetId}/spine/${path}`",
    reason: "Third branch of the same three-way ternary.",
  },
};

/**
 * Routes that ARE missing a caller, recorded so the number can only go down.
 *
 * This is a RATCHET, not an allowlist: each line is a known gap with a real
 * user-facing capability behind it, kept here so the guard can pass today while
 * still failing on anything NEW. Deleting a line when the route gets wired up
 * is the point. Adding one requires a reason a reviewer will ask about.
 */
const KNOWN_UNWIRED: readonly string[] = [
  // A GET that duplicates work the page already does. `/assistant-activity`
  // imports `buildAssistantActivitySummary` from inside this route's own folder
  // and runs its own query, so the HTTP endpoint beside it answers to nobody.
  // Wire it or delete it; do not leave it as a second way to compute the same
  // answer that can drift from the first.
  "api/assistant-activity",
];

/**
 * A ROUTE PATH IN PROSE IS NOT A CALL SITE.
 *
 * Two things enforce that. Comments are blanked before the scan, so a docblock
 * cannot vouch for anything. And the path must begin at the START of a string —
 * `"/api/x"`, `` `/api/x` ``, or `` `${base}/api/x` `` — because prose writes it
 * mid-sentence, after a space. Requiring a quote, backtick or template-close
 * immediately before the path is enough to tell those apart.
 *
 * A dynamic segment is `${…}` (any interpolation, including a call such as
 * `${encodeURIComponent(id)}`) or a literal id. A STATIC segment is never
 * allowed to be an interpolation: that is the hole the old matcher had, and the
 * few genuine cases are named in PARTIAL_PATH_CALLERS instead.
 *
 * The trailing lookahead stops `/api/x/foo` from vouching for `/api/x`: a longer
 * path is a different route, and a child's call site must not excuse its parent.
 * A query string, a closing quote, or a backtick all end the path cleanly.
 */
const DYNAMIC_SEGMENT = "(?:\\$\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}|[A-Za-z0-9._%-]+)";

export function callSitePattern(routeDir: string): RegExp {
  const body = routeDir
    .split("/")
    .map((segment) =>
      segment.startsWith("[") ? DYNAMIC_SEGMENT : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    )
    .join("/");
  return new RegExp(`["'\`}]/${body}(?![A-Za-z0-9._/-])`);
}

/** Every `.ts`/`.tsx` beneath `dir`, matching the walk in `supabase-call-sites`. */
function walkFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walkFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

function routeDirectories(): string[] {
  return walkFiles(path.join(process.cwd(), "src/app/api"))
    .filter((file) => file.endsWith(`${path.sep}route.ts`))
    .map((file) =>
      path.relative(path.join(process.cwd(), "src/app"), path.dirname(file)).split(path.sep).join("/")
    )
    .sort();
}

/**
 * Everything that could hold a call site, with comments blanked. `src/app/api`
 * is excluded so one route referencing another does not vouch for it, and
 * `src/test` so a guard's own assertion text — including the allowlists in THIS
 * file — cannot satisfy the scan it performs.
 */
function callerSources(): string[] {
  const root = path.join(process.cwd(), "src");
  const excluded = [path.join(root, "app", "api"), path.join(root, "test")];
  return walkFiles(root)
    .filter((file) => !excluded.some((dir) => file.startsWith(dir + path.sep)))
    .map((file) => stripSourceComments(readFileSync(file, "utf8")));
}

describe("every API route has a caller", () => {
  const routes = routeDirectories();
  const sources = callerSources();

  const unreferenced = routes.filter((routeDir) => {
    const callSite = callSitePattern(routeDir);
    return !sources.some((source) => callSite.test(source));
  });

  it("is scanning a realistic number of routes and callers", () => {
    // Non-vacuity. A glob that matched nothing would make every assertion below
    // pass by finding no routes to check.
    expect(routes.length).toBeGreaterThan(100);
    expect(sources.length).toBeGreaterThan(100);
  });

  it("recognises a whole path and refuses a bag of words", () => {
    /**
     * THE MATCHER'S OWN REGRESSION TEST, and the reason this rewrite happened.
     * Every line here is a shape that was measured in the repository: the first
     * two are how callers really write a path, the rest are the evidence the old
     * matcher accepted from files that did not call the route at all. If someone
     * loosens the matcher back toward substrings, this fails before any route
     * does — a guard's weakness should not need a repo-wide sweep to notice.
     */
    const route = "api/models/[modelId]/runs/[modelRunId]/kpis";
    const pattern = () => callSitePattern(route);

    expect(pattern().test("await fetch(`/api/models/${modelId}/runs/${runId}/kpis`)")).toBe(true);
    expect(pattern().test('fetch("/api/models/abc/runs/def/kpis?window=7")')).toBe(true);
    expect(pattern().test("fetch(`${origin}/api/models/${a}/runs/${b}/kpis`)")).toBe(true);

    // A sibling route's call site plus the tail word somewhere else in the file.
    expect(
      pattern().test(
        "await fetch(`/api/models/${modelId}/runs/${runId}/vmt-significance`);\nconst [kpis, setKpis] = useState([]);"
      )
    ).toBe(false);
    // The path written mid-sentence rather than at the start of a string.
    expect(pattern().test('const help = "call /api/models/1/runs/2/kpis to read them";')).toBe(false);
    // A child path must not vouch for its parent.
    expect(callSitePattern("api/models/[modelId]/runs").test("fetch(`/api/models/${id}/runs/${r}/kpis`)")).toBe(
      false
    );
    // A static segment supplied by an interpolation is not a whole path — those
    // are named in PARTIAL_PATH_CALLERS, never matched by accident.
    expect(pattern().test("fetch(`/api/models/${modelId}/runs/${runId}/${section}`)")).toBe(false);
  });

  it("finds no API route that nothing in the product calls", () => {
    const accounted = new Set<string>([
      ...Object.keys(EXTERNAL_CALLERS),
      ...Object.keys(PARTIAL_PATH_CALLERS),
      ...KNOWN_UNWIRED,
    ]);
    const surprises = unreferenced.filter((routeDir) => !accounted.has(routeDir));

    expect(
      surprises,
      [
        "These API routes have no caller outside src/app/api and src/test.",
        "A route nothing calls is a capability that shipped where no planner can reach it —",
        "the defect this repo has paid for at least seven times.",
        "",
        "Wire it to a surface. If the caller genuinely lives outside this codebase",
        "(a worker callback, an uptime probe, an operator data load), add it to",
        "EXTERNAL_CALLERS with the name of what calls it. If a caller in src/ builds",
        "the path in pieces, add it to PARTIAL_PATH_CALLERS with the file and the",
        "expression — and consider writing the path out instead.",
      ].join("\n")
    ).toEqual([]);
  });

  it("keeps the unwired list honest as routes get wired up", () => {
    // A ratchet only ratchets if a stale entry is a failure. When a route in
    // KNOWN_UNWIRED gains a caller, this fails until the line is deleted —
    // which is how the list shrinks instead of quietly becoming decoration.
    const stale = KNOWN_UNWIRED.filter((routeDir) => !unreferenced.includes(routeDir));

    expect(
      stale,
      "These routes now HAVE callers. Delete them from KNOWN_UNWIRED — the list may only shrink."
    ).toEqual([]);
  });

  it("proves every assembled-path caller still assembles that path", () => {
    /**
     * The claim in each PARTIAL_PATH_CALLERS entry is "this file builds this
     * path". Nothing else in this suite can see that, so it is checked here by
     * reading the named file — with comments blanked, because an entry excused
     * by a docblock about the fetch would be the original defect wearing a new
     * hat. A rename, a refactor, or a deleted component fails by name.
     */
    const broken = Object.entries(PARTIAL_PATH_CALLERS)
      .map(([routeDir, entry]) => {
        const file = path.join(process.cwd(), entry.file);
        if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
          return `${routeDir}: ${entry.file} does not exist`;
        }
        const source = stripSourceComments(readFileSync(file, "utf8"));
        if (!source.includes(entry.expression)) {
          return `${routeDir}: ${entry.file} no longer contains ${entry.expression}`;
        }
        return null;
      })
      .filter((problem): problem is string => problem !== null);

    expect(
      broken,
      "An assembled-path caller changed. Point the entry at the expression that builds the path now, or wire the route to a whole-path call and delete the entry."
    ).toEqual([]);
  });

  it("keeps the assembled-path list shrink-only", () => {
    // The moment a route gains an ordinary whole-path caller, its entry stops
    // being evidence of anything and becomes a permanent excuse. Same ratchet as
    // KNOWN_UNWIRED, opposite direction: delete the line.
    const redundant = Object.keys(PARTIAL_PATH_CALLERS).filter(
      (routeDir) => !unreferenced.includes(routeDir)
    );

    expect(
      redundant,
      "These routes are now called with the whole path written out. Delete them from PARTIAL_PATH_CALLERS — the list may only shrink."
    ).toEqual([]);
  });

  it("excuses the superseded aerial export tombstone by NAME, never by accident", () => {
    /**
     * Kept from the word-bag era, when `missions/[id]/export` passed the orphan
     * scan with no allowlist entry at all because `export` is a word every TS
     * module contains — a pass by accident, which is how a deliberate 410
     * quietly becomes an unexamined one. The whole-path matcher no longer does
     * that, so the EXTERNAL_CALLERS entry now carries the route on its own; this
     * assertion is what keeps the entry honest about WHAT it is excusing. The
     * entry must exist, must say 410, and the route must still BE the tombstone.
     */
    const tombstone = "api/aerial/missions/[missionId]/export";
    const reason = EXTERNAL_CALLERS[tombstone];
    expect(
      reason,
      "The superseded aerial export tombstone lost its named EXTERNAL_CALLERS entry. Restore it (or, if the route is being deleted or revived, delete this assertion WITH a recorded reason)."
    ).toBeTruthy();
    expect(reason).toContain("410");

    const routeSource = readFileSync(
      path.join(process.cwd(), "src/app/api", "aerial/missions/[missionId]/export", "route.ts"),
      "utf8"
    );
    expect(routeSource, "the excused route no longer answers 410 Gone — it grew a real capability, so it needs a real caller, not an excuse").toContain("410");
  });

  it("names a real route in every allowlist entry", () => {
    // A typo or a renamed route would otherwise sit in the allowlist forever,
    // silently excusing nothing while the real route goes unchecked.
    const known = new Set(routes);
    const phantom = [
      ...Object.keys(EXTERNAL_CALLERS),
      ...Object.keys(PARTIAL_PATH_CALLERS),
      ...KNOWN_UNWIRED,
    ].filter((routeDir) => !known.has(routeDir));

    expect(phantom, "Allowlisted paths that are not routes in this repo.").toEqual([]);
  });

  it("excuses each route exactly once", () => {
    // Three lists is two chances for a route to be excused twice and for the
    // stale-entry ratchets above to cancel each other out.
    const all = [
      ...Object.keys(EXTERNAL_CALLERS),
      ...Object.keys(PARTIAL_PATH_CALLERS),
      ...KNOWN_UNWIRED,
    ];
    const duplicated = all.filter((routeDir, index) => all.indexOf(routeDir) !== index);

    expect(duplicated, "A route is excused by more than one list. Pick the one that is true.").toEqual([]);
  });
});
