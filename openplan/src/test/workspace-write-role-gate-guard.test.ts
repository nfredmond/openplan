import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * REGRESSION GUARD — a mutating API route may not authorize by row-visibility
 * alone.
 *
 * OpenPlan's workspace-content RLS write policies are ROLE-BLIND. Every one of
 * them asks the same question:
 *
 *   workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
 *
 * That is membership, not permission. When the read-only "viewer" tier shipped,
 * every route that resolved a row through RLS and then wrote it happily let a
 * viewer create, update, and delete workspace content — contradicting the tier's
 * one promise to the user: "Read everything, change nothing."
 *
 * Fixing the routes that existed is not enough, because the next mutating route
 * will be written the same way. So: any route file that exports a mutating verb
 * AND deals in workspaces must contain a real authorization gate, or be named in
 * the allowlist below with a reason. There is no third option.
 *
 * The gate does not have to be inline — most modules delegate to their own
 * loader (`loadModelAccess`, `loadScenarioSetAccess`, …). Those loaders are
 * accepted only because a second assertion below proves each one actually
 * consults the role matrix; a helper cannot become a recognized gate just by
 * being named like one.
 */

const API_DIR = path.join(process.cwd(), "src", "app", "api");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return entry === "route.ts" ? [full] : [];
  });
}

/** Route path relative to src/app/api, with forward slashes on every platform. */
function routeId(file: string): string {
  return path.relative(API_DIR, file).split(path.sep).join("/");
}

const MUTATING_VERBS = ["POST", "PUT", "PATCH", "DELETE"] as const;

/** Every way Next.js accepts a route handler export. */
function mutatingVerbs(source: string): string[] {
  return MUTATING_VERBS.filter(
    (verb) =>
      new RegExp(`export\\s+(?:async\\s+)?function\\s+${verb}\\b`).test(source) ||
      new RegExp(`export\\s+const\\s+${verb}\\s*[:=]`).test(source) ||
      new RegExp(`export\\s*\\{[^}]*\\b${verb}\\b[^}]*\\}`).test(source)
  );
}

/** A route "deals in workspaces" if it names one at all. */
function touchesWorkspace(source: string): boolean {
  return /workspace_id|workspaceId/.test(source);
}

/**
 * Symbols that constitute a real write gate. Two are the primitives in
 * role-matrix.ts; the rest are module loaders and route-local predicates that
 * delegate to them. The second test below proves every entry here is backed by
 * an actual role check.
 */
const RECOGNIZED_GATES = [
  // The policy table itself.
  "canAccessWorkspaceAction",
  "isReadOnlyWorkspaceRole",
  // Shared helpers for modules with no matrix action of their own.
  "requireWorkspaceWriteAccess",
  "requireNetworkPackageWriteAccess",
  // Module loaders that resolve a parent record and apply the matrix.
  "loadModelAccess",
  "loadPlanAccess",
  "loadProgramAccess",
  "loadProjectAccess",
  "loadScenarioSetAccess",
  "loadCampaignAccess",
  "loadFundingOpportunityAccess",
  "validateCampaignCategoryAccess",
  // Owner/admin predicates for workspace administration surfaces.
  "requireIntegrationKeyManager",
  "canManageWorkspaceMembers",
  "isManagerRole",
] as const;

/**
 * Routes that legitimately mutate without a workspace-role gate. Each entry
 * states WHY. Keep this list minimal: "the route is inconvenient to gate" is
 * not a reason, and neither is "RLS covers it" — role-blind RLS is the bug.
 */
const UNGATED_BY_DESIGN: Record<string, string> = {
  // Worker callback. Authenticated by a shared bearer token and executed as the
  // service role: the caller is the aerial processing worker reporting on a job
  // it was handed, not a workspace member acting on their own behalf.
  "aerial/processing-callback/route.ts":
    "worker callback authenticated by a shared bearer token, not by a session",

  // The assistant answers and PROPOSES; it never writes workspace content here.
  // Anything it proposes is executed by a different route, and each of those
  // routes carries its own gate (approvals go through
  // /api/assistant/actions/approvals, which uses canAccessWorkspaceAction).
  "assistant/route.ts": "reads context and answers; performs no workspace write",
  "assistant/chat/route.ts": "reads context and answers; performs no workspace write",

  // Public participation. These are the resident-facing surfaces of a published
  // engagement campaign, reached by share token with no session at all — the
  // submitter is a member of nothing. Their authorization is the campaign's own
  // published/accepting-submissions state, checked in the handler.
  "engage/[shareToken]/submit/route.ts": "public share-token submission; the submitter has no workspace role",
  "engage/[shareToken]/survey/submit/route.ts": "public share-token survey response; no session",
  "engage/[shareToken]/items/[itemId]/translate/route.ts":
    "public share-token translation of an already-public item; its only write is a translation cache, and the caller holds no workspace role to check",

  // Self-service account plumbing. Refusing a viewer here would break the
  // read-only tier rather than enforce it.
  "workspaces/active/route.ts":
    "switches which workspace the caller is looking at; a viewer must be able to change their own view",
  "workspaces/bootstrap/route.ts":
    "self-provisions the caller's FIRST workspace, where by definition they hold no prior role",
  "workspaces/invitations/accept/route.ts":
    "the caller acts on their own invitation; their role in that workspace is the thing being established",
  "workspaces/invitations/decline/route.ts": "the caller declines their own invitation",
};

type RouteFile = { id: string; source: string; verbs: string[] };

function mutatingWorkspaceRoutes(): RouteFile[] {
  return walk(API_DIR)
    .sort()
    .map((file) => {
      const source = readFileSync(file, "utf8");
      return { id: routeId(file), source, verbs: mutatingVerbs(source) };
    })
    .filter((route) => route.verbs.length > 0 && touchesWorkspace(route.source));
}

describe("every mutating workspace route authorizes by ROLE, not by row visibility", () => {
  it("gates or explicitly exempts each one", () => {
    const offenders = mutatingWorkspaceRoutes()
      .filter((route) => !RECOGNIZED_GATES.some((gate) => route.source.includes(gate)))
      .filter((route) => !(route.id in UNGATED_BY_DESIGN))
      .map((route) => `${route.id} [${route.verbs.join(",")}]`);

    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist honest — no stale or unnecessary entries", () => {
    // An allowlist entry that has since been gated, deleted, or turned
    // read-only is a comment claiming something untrue. Delete it instead.
    const routes = new Map(mutatingWorkspaceRoutes().map((route) => [route.id, route]));
    const stale: string[] = [];

    for (const id of Object.keys(UNGATED_BY_DESIGN)) {
      const route = routes.get(id);
      if (!route) {
        stale.push(`${id} → no longer a mutating workspace route`);
        continue;
      }
      const gate = RECOGNIZED_GATES.find((candidate) => route.source.includes(candidate));
      if (gate) {
        stale.push(`${id} → now gated by ${gate}; drop the exemption`);
      }
    }

    expect(stale).toEqual([]);
  });

  it("recognizes only gates that actually consult a role", () => {
    // A name is not a gate. Every recognized symbol must be DEFINED somewhere in
    // src, and its defining file must perform a real role check — otherwise a
    // future `loadSomethingAccess` that only checks membership could be added to
    // the list above and silently reopen this whole class of bug.
    const sources = collectSourceFiles(path.join(process.cwd(), "src"));
    const ROLE_CHECK =
      /canAccessWorkspaceAction|isReadOnlyWorkspaceRole|normalizeWorkspaceRole|requireWorkspaceWriteAccess|role === "owner"/;

    const unproven: string[] = [];
    for (const gate of RECOGNIZED_GATES) {
      const definition = new RegExp(
        `(?:export\\s+)?(?:async\\s+)?function\\s+${gate}\\b|(?:export\\s+)?const\\s+${gate}\\s*[:=]`
      );
      const definingFiles = sources.filter(({ source }) => definition.test(source));

      if (definingFiles.length === 0) {
        unproven.push(`${gate} → no definition found in src/`);
        continue;
      }

      for (const { file, source } of definingFiles) {
        if (!ROLE_CHECK.test(source)) {
          unproven.push(`${gate} → defined in ${file} without any role check`);
        }
      }
    }

    expect(unproven).toEqual([]);
  });

  it("guards the guard — the scan reaches the routes and sees their verbs", () => {
    const routes = mutatingWorkspaceRoutes();
    expect(routes.length).toBeGreaterThan(80);

    // Routes fixed by the audit this guard came from: each must now be gated.
    for (const id of [
      "county-runs/route.ts",
      "county-runs/[countyRunId]/enqueue/route.ts",
      "network-packages/route.ts",
      "projects/[projectId]/records/route.ts",
      "projects/[projectId]/records/[recordId]/route.ts",
    ]) {
      const route = routes.find((candidate) => candidate.id === id);
      expect(route, `${id} should be scanned as a mutating workspace route`).toBeDefined();
      expect(
        RECOGNIZED_GATES.some((gate) => route!.source.includes(gate)),
        `${id} should carry a write gate`
      ).toBe(true);
    }

    // The detector must see all four verbs and every export form.
    expect(mutatingVerbs("export async function POST() {}")).toEqual(["POST"]);
    expect(mutatingVerbs("export const PUT = handler;")).toEqual(["PUT"]);
    expect(mutatingVerbs("export { PATCH, DELETE };")).toEqual(["PATCH", "DELETE"]);
    expect(mutatingVerbs("export async function GET() {}")).toEqual([]);
    // A comment mentioning a verb is not an export.
    expect(mutatingVerbs("// POST is not implemented here")).toEqual([]);
  });
});

function collectSourceFiles(dir: string): Array<{ file: string; source: string }> {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // The test directory would match its own assertions' text.
      return entry === "test" ? [] : collectSourceFiles(full);
    }
    if (!/\.tsx?$/.test(entry)) return [];
    return [{ file: path.relative(process.cwd(), full), source: readFileSync(full, "utf8") }];
  });
}
