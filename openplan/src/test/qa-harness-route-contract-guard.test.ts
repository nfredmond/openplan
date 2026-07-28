import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * REGRESSION GUARD — the qa-harness smokes and the app's API routes are one
 * contract, and nothing else checks it.
 *
 * The browser smokes in `qa-harness/` drive real user journeys end to end, and
 * every one of them calls app API routes by literal path and verb. But the
 * harness is plain CommonJS JavaScript living OUTSIDE `openplan/src`, with its
 * own package.json — so `tsc` never sees it, `eslint` never walks it, and no
 * unit test imports it. When a route is renamed, split, or loses a verb, the
 * only thing that notices is a smoke run against a live deployment, minutes to
 * days later, if anyone runs it at all.
 *
 * That is exactly how tightening the engagement share-token API broke a smoke:
 * the mint moved from a caller-supplied token on PATCH
 * /api/engagement/campaigns/{id} to a server-minted POST
 * /api/engagement/campaigns/{id}/share-token, and the type checker had nothing
 * to say about it because the caller was a `.js` file two directories up.
 *
 * So this guard statically reads the harness the way a compiler would: it finds
 * every API call site, resolves the path it names to a route file on disk, and
 * asserts that file still exports the verb being used. It cannot prove the
 * request SUCCEEDS — only a live smoke does that — but it makes "the route the
 * harness calls no longer exists" a build failure instead of a surprise.
 *
 * TWO CALL-SITE SHAPES, because covering only the first misses eleven
 * couplings — including every public engagement-portal write:
 *
 *   (a) appFetch / expectAppFetch — a signed-in `fetch` executed inside the
 *       page so it carries the planner's session cookie. Sixteen harness files
 *       declare their own `appFetch`; the remaining two take it from
 *       `fixtures/provision.js` and wrap it in `expectAppFetch`. Both put the
 *       route path first and the payload second, and both infer the verb the
 *       same way (see METHOD INFERENCE below).
 *
 *   (b) page.waitForResponse(...) — a call the harness does not make itself. It
 *       clicks a button and waits for the request the UI issues, asserting the
 *       verb with `response.request().method() === 'POST'` and the path with
 *       `response.url().includes('/api/...')`. These are the couplings that
 *       exist only because a component fetches something, so they are the ones
 *       most likely to rot unnoticed.
 *
 * METHOD INFERENCE. Every appFetch in the harness — the sixteen local copies
 * and the shared factory — defaults its verb to `payload ? 'POST' : 'GET'`, and
 * an explicit trailing method literal overrides it. This guard reproduces that
 * rule, and a test below pins the rule to the harness sources so the inference
 * cannot silently diverge from what the harness actually does.
 */

const HTTP_VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type HttpVerb = (typeof HTTP_VERBS)[number];

const API_DIR = path.join(process.cwd(), "src", "app", "api");

/**
 * The harness is a sibling package of `openplan/`, not a child of it. Walk up
 * from wherever vitest was invoked rather than hardcoding `../qa-harness`, so
 * the guard still finds it if the suite is ever run from a different depth.
 * Not finding it is a hard failure: a guard that quietly scans nothing is worse
 * than no guard.
 */
function locateHarnessDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, "qa-harness");
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate the qa-harness package by walking up from ${process.cwd()}. ` +
      "This guard exists to keep the harness and the API routes in step; it must not pass by finding nothing."
  );
}

const HARNESS_DIR = locateHarnessDir();

/** Top-level harness scripts. `fixtures/` holds shared helpers, not call sites. */
function harnessFiles(): string[] {
  return readdirSync(HARNESS_DIR)
    .filter((entry) => entry.endsWith(".js"))
    .sort();
}

// ---------------------------------------------------------------------------
// Source scanning
// ---------------------------------------------------------------------------

type CallShape = "appFetch" | "waitForResponse";

type Coupling = {
  file: string;
  line: number;
  shape: CallShape;
  /** The path exactly as written, template placeholders and all. */
  apiPath: string;
  method: HttpVerb;
};

/** A call site the scanner could see but could not read. Never dropped silently. */
type Unscannable = {
  file: string;
  line: number;
  shape: CallShape;
  detail: string;
};

/**
 * Index of the `)` that closes the `(` at `openIndex`, skipping over string and
 * template-literal contents so a bracket inside a payload cannot unbalance the
 * count. Returns -1 when the call never closes, which is reported rather than
 * ignored.
 */
function matchingParen(source: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/** Split an argument list on the commas that belong to it, not to its arguments. */
function splitTopLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];

    if (quote) {
      current += char;
      if (char === "\\") {
        current += inner[index + 1] ?? "";
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) args.push(current.trim());
  return args;
}

/** The contents of a single-token string or template literal, else null. */
function stringLiteralValue(argument: string | undefined): string | null {
  if (!argument) return null;
  const match = /^(['"`])([\s\S]*)\1$/.exec(argument.trim());
  return match ? match[2] : null;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function explicitMethodArgument(args: string[]): HttpVerb | null {
  for (const argument of args) {
    const literal = stringLiteralValue(argument);
    if (literal && (HTTP_VERBS as readonly string[]).includes(literal)) return literal as HttpVerb;
  }
  return null;
}

/**
 * The harness's own default: a payload means POST, no payload means GET.
 * `expectAppFetch(route, payload, expectedStatus, label, method)` passes its
 * method straight through to appFetch, so the same rule covers both.
 */
function inferredMethod(args: string[]): HttpVerb {
  const payload = args[1];
  if (!payload || payload === "undefined" || payload === "null") return "GET";
  return "POST";
}

function scanAppFetchCalls(file: string, source: string, into: Coupling[], unscannable: Unscannable[]): void {
  const callPattern = /\b(?:expectAppFetch|appFetch)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = callPattern.exec(source))) {
    // `function appFetch(` and `function expectAppFetch(` are declarations, not calls.
    const preceding = source.slice(Math.max(0, match.index - 32), match.index);
    if (/function\s+$/.test(preceding)) continue;

    const open = match.index + match[0].length - 1;
    const close = matchingParen(source, open);
    const line = lineOf(source, match.index);

    if (close < 0) {
      unscannable.push({ file, line, shape: "appFetch", detail: "argument list never closes" });
      continue;
    }

    const args = splitTopLevelArgs(source.slice(open + 1, close));
    const apiPath = stringLiteralValue(args[0]);

    if (apiPath === null) {
      unscannable.push({
        file,
        line,
        shape: "appFetch",
        detail: `route argument is not a literal path: ${args[0] ?? "<missing>"}`,
      });
      continue;
    }

    // appFetch can address any app path; only the API surface is this guard's business.
    if (!apiPath.startsWith("/api/")) continue;

    into.push({
      file,
      line,
      shape: "appFetch",
      apiPath,
      method: explicitMethodArgument(args.slice(1)) ?? inferredMethod(args),
    });
  }
}

function scanWaitForResponseBlocks(
  file: string,
  source: string,
  into: Coupling[],
  unscannable: Unscannable[]
): void {
  const blockPattern = /\bwaitForResponse\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(source))) {
    const open = match.index + match[0].length - 1;
    const close = matchingParen(source, open);
    const line = lineOf(source, match.index);

    if (close < 0) {
      unscannable.push({ file, line, shape: "waitForResponse", detail: "argument list never closes" });
      continue;
    }

    const block = source.slice(open + 1, close);
    // Waiting on a page, an asset, or a public HTML route is not an API coupling.
    if (!block.includes("/api/")) continue;

    const urlMatch = /\.url\(\)\s*\.includes\(\s*(['"`])([\s\S]*?)\1\s*\)/.exec(block);
    if (!urlMatch || !urlMatch[2].startsWith("/api/")) {
      unscannable.push({
        file,
        line,
        shape: "waitForResponse",
        detail: "block names an /api/ path but asserts no literal `response.url().includes('/api/…')`",
      });
      continue;
    }

    const methodMatch = /\.method\(\)\s*===\s*['"]([A-Z]+)['"]/.exec(block);
    if (!methodMatch || !(HTTP_VERBS as readonly string[]).includes(methodMatch[1])) {
      // Without a method assertion the wait matches any verb, so there is no
      // verb to check. Assert one in the harness rather than guessing here.
      unscannable.push({
        file,
        line,
        shape: "waitForResponse",
        detail: `awaits ${urlMatch[2]} without asserting \`response.request().method() === '…'\``,
      });
      continue;
    }

    into.push({
      file,
      line,
      shape: "waitForResponse",
      apiPath: urlMatch[2],
      method: methodMatch[1] as HttpVerb,
    });
  }
}

type Scan = { couplings: Coupling[]; unscannable: Unscannable[] };

function scanHarness(): Scan {
  const couplings: Coupling[] = [];
  const unscannable: Unscannable[] = [];

  for (const file of harnessFiles()) {
    const source = readFileSync(path.join(HARNESS_DIR, file), "utf8");
    scanAppFetchCalls(file, source, couplings, unscannable);
    scanWaitForResponseBlocks(file, source, couplings, unscannable);
  }

  return { couplings, unscannable };
}

// ---------------------------------------------------------------------------
// Path -> route file resolution
// ---------------------------------------------------------------------------

type Resolution =
  | { kind: "resolved"; routeFile: string; routeId: string }
  | { kind: "missing"; reason: string };

function directoriesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * `/api/foo/${ids.barId}/baz` -> `src/app/api/foo/[whateverItIsCalled]/baz/route.ts`.
 *
 * A segment holding a `${…}` placeholder is a runtime id, so it matches the
 * directory's sole dynamic child WHATEVER that child is named — the harness must
 * not have to know whether the param is `[campaignId]`, `[modelId]`, or
 * `[shareToken]`. A literal segment matches a real directory of that name, and
 * falls back to the sole dynamic child only when no such directory exists (a
 * hardcoded id in a harness URL). Query strings and fragments are stripped.
 */
function resolveRouteFile(apiPath: string): Resolution {
  const cleaned = apiPath.split("?")[0].split("#")[0];
  const segments = cleaned.replace(/^\/api\//, "").split("/").filter(Boolean);

  let dir = API_DIR;
  for (const segment of segments) {
    const children = directoriesIn(dir);
    const isPlaceholder = segment.includes("${");

    if (!isPlaceholder && children.includes(segment)) {
      dir = path.join(dir, segment);
      continue;
    }

    const dynamic = children.filter((child) => child.startsWith("[") && child.endsWith("]"));
    if (dynamic.length === 1) {
      dir = path.join(dir, dynamic[0]);
      continue;
    }

    return {
      kind: "missing",
      reason: `no route directory for segment "${segment}" under src/app/api/${path.relative(API_DIR, dir) || "."}`,
    };
  }

  const routeFile = path.join(dir, "route.ts");
  if (!existsSync(routeFile)) {
    return { kind: "missing", reason: `${path.relative(API_DIR, dir)} has no route.ts` };
  }

  return { kind: "resolved", routeFile, routeId: path.relative(API_DIR, dir).split(path.sep).join("/") };
}

/** Every export form Next.js accepts for a route handler. */
function exportedVerbs(source: string): HttpVerb[] {
  return HTTP_VERBS.filter(
    (verb) =>
      new RegExp(`export\\s+(?:async\\s+)?function\\s+${verb}\\b`).test(source) ||
      new RegExp(`export\\s+const\\s+${verb}\\s*[:=]`).test(source) ||
      new RegExp(`export\\s*\\{[^}]*\\b${verb}\\b[^}]*\\}`).test(source)
  );
}

const routeSourceCache = new Map<string, string>();
function routeSource(routeFile: string): string {
  const cached = routeSourceCache.get(routeFile);
  if (cached !== undefined) return cached;
  const source = readFileSync(routeFile, "utf8");
  routeSourceCache.set(routeFile, source);
  return source;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Couplings this guard cannot verify, keyed by `METHOD path-as-written`, each
 * with the reason it is exempt.
 *
 * WHAT BELONGS HERE, and nothing else:
 *   - a harness call whose route path is built at runtime, so no literal exists
 *     to resolve;
 *   - a `waitForResponse` on an /api/ path with no method assertion, where the
 *     verb is genuinely unknowable from the source;
 *   - a route the harness calls deliberately expecting a 404/405 (asserting
 *     that something is NOT reachable).
 *
 * "The smoke is stale", "the route moved", and "this is annoying" are not
 * reasons — those are the failures the guard is for. Fix the harness instead.
 *
 * It is EMPTY today, and that is the intended steady state: every one of the
 * harness's API call sites names a literal path and a knowable verb, and every
 * one of them resolves. Adding an entry should feel like a concession.
 */
const UNVERIFIABLE_COUPLINGS: Record<string, string> = {};

function couplingKey(coupling: Pick<Coupling, "method" | "apiPath">): string {
  return `${coupling.method} ${coupling.apiPath}`;
}

type Offender = { key: string; problem: string; sites: string[] };

function offenders(scan: Scan, allowlist: Record<string, string> = UNVERIFIABLE_COUPLINGS): Offender[] {
  const problems = new Map<string, Offender>();

  const record = (key: string, problem: string, site: string) => {
    const existing = problems.get(key);
    if (existing) {
      existing.sites.push(site);
      return;
    }
    problems.set(key, { key, problem, sites: [site] });
  };

  for (const call of scan.unscannable) {
    record(`UNREADABLE ${call.file}:${call.line}`, call.detail, `${call.file}:${call.line}`);
  }

  for (const coupling of scan.couplings) {
    const site = `${coupling.file}:${coupling.line}`;
    const resolution = resolveRouteFile(coupling.apiPath);

    if (resolution.kind === "missing") {
      record(couplingKey(coupling), `route file not found — ${resolution.reason}`, site);
      continue;
    }

    const verbs = exportedVerbs(routeSource(resolution.routeFile));
    if (!verbs.includes(coupling.method)) {
      record(
        couplingKey(coupling),
        `src/app/api/${resolution.routeId}/route.ts exports [${verbs.join(", ") || "no verbs"}] but not ${coupling.method}`,
        site
      );
    }
  }

  return [...problems.values()].filter((offender) => !(offender.key in allowlist));
}

describe("every API route the qa-harness calls still exists and still exports that verb", () => {
  it("resolves every harness call site to a live route handler", () => {
    const failures = offenders(scanHarness()).map(
      (offender) => `${offender.key} → ${offender.problem} [${offender.sites.join(", ")}]`
    );

    expect(failures).toEqual([]);
  });

  it("keeps the allowlist honest — no stale or unnecessary entries", () => {
    // An exemption for a coupling that now verifies fine is a comment claiming
    // something untrue. Delete it instead of carrying it.
    const stillBroken = new Set(offenders(scanHarness(), {}).map((offender) => offender.key));
    const stale = Object.keys(UNVERIFIABLE_COUPLINGS).filter((key) => !stillBroken.has(key));

    expect(stale).toEqual([]);
  });

  it("guards the guard — the scan reaches the harness and reads both call-site shapes", () => {
    const files = harnessFiles();
    expect(files.length).toBeGreaterThanOrEqual(18);

    const { couplings, unscannable } = scanHarness();
    const appFetchCalls = couplings.filter((coupling) => coupling.shape === "appFetch");
    const uiDrivenCalls = couplings.filter((coupling) => coupling.shape === "waitForResponse");
    const distinctRoutes = new Set(
      couplings
        .map((coupling) => resolveRouteFile(coupling.apiPath))
        .filter((resolution): resolution is Extract<Resolution, { kind: "resolved" }> => resolution.kind === "resolved")
        .map((resolution) => resolution.routeId)
    );

    // Current totals are far above these floors (139 couplings across 40 routes).
    // The floors exist so the scan cannot quietly degrade to matching nothing —
    // a silent zero is the one failure mode a static guard cannot survive.
    expect(couplings.length).toBeGreaterThanOrEqual(100);
    expect(appFetchCalls.length).toBeGreaterThanOrEqual(90);
    expect(uiDrivenCalls.length).toBeGreaterThanOrEqual(8);
    expect(distinctRoutes.size).toBeGreaterThanOrEqual(25);
    expect(unscannable).toEqual([]);

    // Both shapes must be represented by real, named couplings. The share-token
    // mint is the appFetch coupling that broke when the API tightened; the
    // public engagement submit and the moderation PATCH exist only through a UI
    // click, so nothing but shape (b) sees them.
    const keys = new Set(couplings.map((coupling) => couplingKey(coupling)));
    expect(keys.has("POST /api/engagement/campaigns/${ids.campaignId}/share-token")).toBe(true);
    expect(keys.has("GET /api/workspaces/current")).toBe(true);
    expect(
      uiDrivenCalls.some((coupling) => coupling.method === "POST" && coupling.apiPath.includes("/submit"))
    ).toBe(true);
    expect(uiDrivenCalls.some((coupling) => coupling.method === "PATCH")).toBe(true);
  });

  it("guards the guard — the verb detector and method inference behave", () => {
    expect(exportedVerbs("export async function POST() {}")).toEqual(["POST"]);
    expect(exportedVerbs("export const PUT = handler;")).toEqual(["PUT"]);
    expect(exportedVerbs("export { GET, DELETE };")).toEqual(["GET", "DELETE"]);
    expect(exportedVerbs("// POST is not implemented here")).toEqual([]);

    // An explicit trailing literal wins; otherwise the payload decides.
    expect(explicitMethodArgument(["{ a: 1 }", "'PATCH'"])).toBe("PATCH");
    expect(explicitMethodArgument(["{ a: 1 }", "200", "'Some label'"])).toBe(null);
    expect(inferredMethod(["'/api/x'", "{ a: 1 }"])).toBe("POST");
    expect(inferredMethod(["'/api/x'"])).toBe("GET");
    expect(inferredMethod(["'/api/x'", "null"])).toBe("GET");
    expect(inferredMethod(["'/api/x'", "undefined", "200", "'Label'"])).toBe("GET");

    // Argument splitting must survive payloads that contain commas and braces.
    expect(splitTopLevelArgs("`/api/a/${b}/c`, { x: 1, y: [2, 3] }, 'PATCH'")).toEqual([
      "`/api/a/${b}/c`",
      "{ x: 1, y: [2, 3] }",
      "'PATCH'",
    ]);
  });

  it("guards the guard — path resolution follows the real directory names", () => {
    // A placeholder segment must bind to whatever the param directory is
    // actually called, and the guard must never assume the name.
    const dynamic = resolveRouteFile("/api/engagement/campaigns/${ids.campaignId}/categories");
    expect(dynamic.kind).toBe("resolved");
    expect(dynamic.kind === "resolved" && dynamic.routeId).toBe("engagement/campaigns/[campaignId]/categories");

    const publicRoute = resolveRouteFile("/api/engage/${shareToken}/submit");
    expect(publicRoute.kind).toBe("resolved");
    expect(publicRoute.kind === "resolved" && publicRoute.routeId).toBe("engage/[shareToken]/submit");

    // Query strings are not part of the route path.
    expect(resolveRouteFile("/api/projects?workspaceId=abc").kind).toBe("resolved");

    // And a path with no route behind it must be reported, not resolved.
    expect(resolveRouteFile("/api/definitely-not-a-route/here").kind).toBe("missing");
  });

  it("guards the guard — the harness still infers its verb the way this scan assumes", () => {
    // Every appFetch in the harness defaults to `payload ? 'POST' : 'GET'`. If
    // one ever stops doing that, `inferredMethod` above becomes a lie for that
    // file's untyped calls, and this guard would start asserting the wrong verb
    // instead of no verb. Pin the rule to the sources that implement it.
    const sources = [
      ...harnessFiles().map((file) => path.join(HARNESS_DIR, file)),
      path.join(HARNESS_DIR, "fixtures", "provision.js"),
    ];

    const definitions = sources
      .map((file) => ({ file: path.basename(file), source: readFileSync(file, "utf8") }))
      .filter(({ source }) => /function\s+appFetch\s*\(/.test(source));

    expect(definitions.length).toBeGreaterThanOrEqual(17);

    const divergent = definitions
      .filter(({ source }) => !source.includes("payload ? 'POST' : 'GET'"))
      .map(({ file }) => file);

    expect(divergent).toEqual([]);
  });
});
