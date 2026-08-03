import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
 * WHAT IT CHECKS. Every `route.ts` under `src/app/api` must be mentioned by
 * something that is not another API route and not a test: a component, a page,
 * a hook, or a client helper. Matching is by the route's longest STATIC path
 * prefix plus its remaining static segments, so a call site that builds its URL
 * from a template literal — `` `/api/models/${id}/runs` `` or
 * `` `/api/workspaces/invitations/${decision}` `` — still counts. That is
 * deliberately generous: this guard is here to catch a route with NO caller at
 * all, which is the failure that keeps happening, not to prove a specific call
 * site is correct.
 *
 * WHAT IT DOES NOT CHECK. That the caller is reachable in the UI, that the
 * right role sees it, or that the request is well-formed. A guard that tried to
 * would be a type-checker. Reachability past this point is still the job of a
 * test that renders the surface and asserts what a person would see.
 *
 * WHEN THIS FAILS, THE FIX IS ALMOST NEVER THE ALLOWLIST. A new orphan means a
 * capability shipped that nobody can use. Wire it up. Add to the allowlist only
 * when the caller genuinely is not in this codebase — and say who does call it.
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
  // Network package ingest, which the product ITSELF describes as unbuilt:
  // `network-packages-panel.tsx` tells a planner in as many words that "Ingest
  // is API-only for now — there is no in-app upload form yet." Honest, and a
  // real gap; listed here so it stays counted rather than excused.
  "api/network-packages",
  "api/network-packages/[packageId]/versions",
  "api/network-packages/[packageId]/versions/[versionId]/connectors",
  "api/network-packages/[packageId]/versions/[versionId]/corridors",
  "api/network-packages/[packageId]/versions/[versionId]/ingest",
  "api/network-packages/[packageId]/versions/[versionId]/zones",
  // A GET that duplicates work the page already does. `/assistant-activity`
  // imports `buildAssistantActivitySummary` from inside this route's own folder
  // and runs its own query, so the HTTP endpoint beside it answers to nobody.
  // Wire it or delete it; do not leave it as a second way to compute the same
  // answer that can drift from the first.
  "api/assistant-activity",
  // EMPTY, and that is the goal state rather than a missing list. Every API
  // route in this repo now has a caller in the product, or an EXTERNAL_CALLERS
  // entry naming what calls it from outside. Adding a line here means shipping
  // a capability nobody can reach, so it needs a reason a reviewer will ask
  // about — and the test below fails if a line stays after the route is wired.
];

/**
 * A ROUTE PATH IN PROSE IS NOT A CALL SITE.
 *
 * The first version of this guard asked whether the path appeared ANYWHERE in a
 * source file. It therefore counted `POST /api/aerial/processing-callback/custody`
 * written inside an operator-facing sentence ("retry through …") and inside a
 * docblock, and passed a route that nothing in the product called — the exact
 * defect it exists to catch, excused by its own documentation.
 *
 * A real call site writes the path at the START of a string: `"/api/x"`,
 * `` `/api/x` ``, or `` `${base}/api/x` ``. Prose writes it mid-sentence, after
 * a space. Requiring a quote, backtick or template-close immediately before the
 * path is enough to tell those apart, and it costs nothing to keep true.
 */
function callSitePattern(prefix: string): RegExp {
  return new RegExp(`["'\`}]${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}

/** `api/models/[modelId]/runs` -> `/api/models`, plus `["runs"]`. */
function staticParts(routeDir: string): { prefix: string; tail: string[] } {
  const segments = routeDir.split("/");
  const leading: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith("[")) break;
    leading.push(segment);
  }
  return {
    prefix: `/${leading.join("/")}`,
    tail: segments.slice(leading.length).filter((segment) => !segment.startsWith("[")),
  };
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
 * Everything that could hold a call site. `src/app/api` is excluded so one
 * route referencing another does not vouch for it, and `src/test` so a guard's
 * own assertion text — including the allowlists in THIS file — cannot satisfy
 * the scan it performs.
 */
function callerSources(): string[] {
  const root = path.join(process.cwd(), "src");
  const excluded = [path.join(root, "app", "api"), path.join(root, "test")];
  return walkFiles(root)
    .filter((file) => !excluded.some((dir) => file.startsWith(dir + path.sep)))
    .map((file) => readFileSync(file, "utf8"));
}

describe("every API route has a caller", () => {
  const routes = routeDirectories();
  const sources = callerSources();

  const unreferenced = routes.filter((routeDir) => {
    const { prefix, tail } = staticParts(routeDir);
    const callSite = callSitePattern(prefix);
    return !sources.some(
      (source) => callSite.test(source) && tail.every((segment) => source.includes(segment))
    );
  });

  it("is scanning a realistic number of routes and callers", () => {
    // Non-vacuity. A glob that matched nothing would make every assertion below
    // pass by finding no routes to check.
    expect(routes.length).toBeGreaterThan(100);
    expect(sources.length).toBeGreaterThan(100);
  });

  it("finds no API route that nothing in the product calls", () => {
    const accounted = new Set<string>([...Object.keys(EXTERNAL_CALLERS), ...KNOWN_UNWIRED]);
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
        "EXTERNAL_CALLERS with the name of what calls it.",
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

  it("names a real route in every allowlist entry", () => {
    // A typo or a renamed route would otherwise sit in the allowlist forever,
    // silently excusing nothing while the real route goes unchecked.
    const known = new Set(routes);
    const phantom = [...Object.keys(EXTERNAL_CALLERS), ...KNOWN_UNWIRED].filter(
      (routeDir) => !known.has(routeDir)
    );

    expect(phantom, "Allowlisted paths that are not routes in this repo.").toEqual([]);
  });
});
