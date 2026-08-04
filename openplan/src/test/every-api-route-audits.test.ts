import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every API route logs its outcomes through createApiAuditLogger — the host
 * log is currently the deployment's ONLY audit surface outside assistant
 * actions, so a route that logs nothing is invisible to the operator forever.
 * The 2026-08-03 review found exactly two silent routes, and they were the
 * worst possible two: the public subscribe-confirm and unsubscribe endpoints,
 * which mutate members of the public's email-subscription state.
 *
 * Matching is on the CALL (`createApiAuditLogger(`), not the import — this
 * repo has already shipped a guard defeated by import-only matching.
 */

const API_DIR = path.join(process.cwd(), "src", "app", "api");

/** Routes that deliberately do not audit, each with its reason. */
const ALLOWLISTED_SILENT: ReadonlyArray<{ route: string; reason: string }> = [
  {
    route: "health/route.ts",
    reason:
      "read-only liveness probe, no writes, deliberately shallow; auditing it would log every uptime check",
  },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return entry === "route.ts" ? [full] : [];
  });
}

describe("every API route audits its outcomes", () => {
  const allowlisted = new Set(ALLOWLISTED_SILENT.map((e) => path.join(API_DIR, e.route)));
  const routes = walk(API_DIR);

  it("scans a real route tree (the guard itself is not vacuous)", () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it("every non-allowlisted route CALLS createApiAuditLogger", () => {
    const silent = routes
      .filter((file) => !allowlisted.has(file))
      .filter((file) => !readFileSync(file, "utf8").includes("createApiAuditLogger("))
      .map((file) => path.relative(API_DIR, file));
    expect(silent).toEqual([]);
  });

  it("every allowlist entry is still real (ratchet: the list only shrinks)", () => {
    const stale = ALLOWLISTED_SILENT.filter((entry) =>
      readFileSync(path.join(API_DIR, entry.route), "utf8").includes("createApiAuditLogger(")
    ).map((entry) => entry.route);
    expect(stale).toEqual([]);
  });
});
