import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compareMigrationSets,
  deepHealthUrl,
  formatResult,
  runDeepHealthCheck,
} from "../../scripts/ops/check-deep-health.mjs";

/**
 * THE SCHEDULED CHECK THAT FAILS WHEN THE DATABASE LACKS A MIGRATION.
 *
 * The Production Health workflow asks the deployment which migrations it was
 * built with (/api/health/deep) and asks Supabase which ones the hosted project
 * has applied (Management API), then fails when the first set is not inside the
 * second. Hosted migrations may be applied out of numeric order: on October 14,
 * 2026 the hosted project had 20261017000011 and 20261017000012 applied ahead
 * of main, so the comparison is between sets, never the latest version.
 *
 * Blind spots, stated: fetch is a fake. That the Management API path and shape
 * match the hosted project was checked once by hand, read-only, on October 14,
 * 2026 (416 rows of { version, name }); a change on Supabase's side would show
 * up as this check failing with "unexpected shape", not as a pass.
 */

const HEALTH_URL = "https://openplan.example/api/health";
const PROJECT_REF = "abcdefghijklmnopqrst";

type Route = { status: number; body: unknown };
let routes: Record<string, Route>;
let calls: { url: string; authorization: string | null }[];

function deepBody(versions: string[], overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    service: "openplan",
    deployment: { commit: "abcdef123456", version: "0.68.0" },
    checks: {
      database: { state: "ok", ms: 12 },
      storage: { state: "ok", ms: 20, buckets: 11 },
      modelingWorkers: [{ kind: "aequilibrae", ageSeconds: 30, fresh: true }],
    },
    migrations: { expected: { count: versions.length, latest: versions.at(-1), versions }, applied: "not_checked" },
    ...overrides,
  };
}

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, authorization: headers.get("authorization") });
      const route = routes[url];
      if (!route) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(route.body), { status: route.status, headers: { "content-type": "application/json" } });
    }),
  );
  vi.stubEnv("OPENPLAN_HEALTH_URL", HEALTH_URL);
  vi.stubEnv("OPENPLAN_HEALTH_TOKEN", "");
  vi.stubEnv("OPENPLAN_SUPABASE_PROJECT_REF", "");
  vi.stubEnv("SUPABASE_ACCESS_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function configure() {
  vi.stubEnv("OPENPLAN_HEALTH_TOKEN", "health-token");
  vi.stubEnv("OPENPLAN_SUPABASE_PROJECT_REF", PROJECT_REF);
  vi.stubEnv("SUPABASE_ACCESS_TOKEN", "sbp_access_token");
}

const MANAGEMENT_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/migrations`;

describe("compareMigrationSets", () => {
  it("finds a missing version below the latest applied one", () => {
    expect(compareMigrationSets(["11", "12", "13"], ["10", "13"])).toEqual({ missing: ["11", "12"], extra: ["10"] });
  });

  it("passes when the database is ahead, applied out of order", () => {
    expect(compareMigrationSets(["10", "13"], ["10", "11", "12", "13"])).toEqual({ missing: [], extra: ["11", "12"] });
  });
});

describe("check-deep-health", () => {
  it("allows the three serial backend probe budgets before its client deadline", async () => {
    vi.stubEnv("OPENPLAN_HEALTH_TOKEN", "health-token");
    routes[`${HEALTH_URL}/deep`] = { status: 200, body: deepBody(["1"]) };
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      await runDeepHealthCheck([]);
      expect(timeout.mock.calls, "Checker budget must cover three eight-second server probes").toEqual([[30_000]]);
    } finally { timeout.mockRestore(); }
  });
  it("derives the deep route from the public health URL", () => {
    expect(deepHealthUrl("https://x.example/api/health")).toBe("https://x.example/api/health/deep");
    expect(deepHealthUrl("https://x.example/api/health/?a=1")).toBe("https://x.example/api/health/deep");
  });

  it("is off, and says what it is not checking, when nothing is configured", async () => {
    const result = await runDeepHealthCheck([]);
    expect(result).toMatchObject({ off: true });
    expect(formatResult(result)).toContain("Nothing compares the migrations");
    expect(calls).toEqual([]);
  });

  it("fails, naming the missing setting, when only the project ref is set", async () => {
    vi.stubEnv("OPENPLAN_SUPABASE_PROJECT_REF", PROJECT_REF);
    await expect(runDeepHealthCheck([])).rejects.toThrow(/OPENPLAN_HEALTH_TOKEN is not set[\s\S]*SUPABASE_ACCESS_TOKEN is not set/);
  });

  it("fails in plain words when the deployed code expects a migration the database lacks", async () => {
    configure();
    routes[`${HEALTH_URL}/deep`] = { status: 200, body: deepBody(["20261017000010", "20261017000011", "20261017000013"]) };
    routes[MANAGEMENT_URL] = {
      status: 200,
      body: [
        { version: "20261017000010", name: "a" },
        { version: "20261017000013", name: "c" },
      ],
    };

    await expect(runDeepHealthCheck([])).rejects.toThrow(
      /expects 1 migration the database has not applied[\s\S]*missing: 20261017000011/,
    );
    expect(calls.map((call) => [call.url, call.authorization])).toEqual([
      [`${HEALTH_URL}/deep`, "Bearer health-token"],
      [MANAGEMENT_URL, "Bearer sbp_access_token"],
    ]);
  });

  it("passes when every expected migration is applied, and reports the ones applied ahead", async () => {
    configure();
    routes[`${HEALTH_URL}/deep`] = { status: 200, body: deepBody(["20261017000010", "20261017000013"]) };
    routes[MANAGEMENT_URL] = {
      status: 200,
      body: ["20261017000010", "20261017000011", "20261017000012", "20261017000013"].map((version) => ({ version, name: "x" })),
    };

    const result = await runDeepHealthCheck([]);
    const text = formatResult(result);
    expect(text).toContain("the database has all 2 the deployed code expects (4 applied in total)");
    expect(text).toContain("Applied ahead of this build, not an error: 20261017000011, 20261017000012");
    expect(text).not.toContain("health-token");
    expect(text).not.toContain("sbp_access_token");
  });

  it("fails when the deployment cannot reach its database or Storage", async () => {
    configure();
    routes[`${HEALTH_URL}/deep`] = {
      status: 503,
      body: deepBody(["1"], { status: "failed", checks: { database: { state: "ok" }, storage: { state: "failed" } } }),
    };
    await expect(runDeepHealthCheck([])).rejects.toThrow(/cannot reach part of its backend[\s\S]*storage check: failed/);
  });

  it("says deep health is off on the deployment when the route answers 404", async () => {
    configure();
    await expect(runDeepHealthCheck([])).rejects.toThrow(/Deep health is off on the deployment/);
  });

  it("fails when the deployment does not report its migrations", async () => {
    configure();
    routes[`${HEALTH_URL}/deep`] = { status: 200, body: deepBody([], { migrations: { expected: null, applied: "not_checked" } }) };
    await expect(runDeepHealthCheck([])).rejects.toThrow(/does not report which migrations it expects/);
  });

  it("runs the deep check alone when no project ref is set", async () => {
    vi.stubEnv("OPENPLAN_HEALTH_TOKEN", "health-token");
    routes[`${HEALTH_URL}/deep`] = { status: 200, body: deepBody(["1"]) };
    const text = formatResult(await runDeepHealthCheck([]));
    expect(text).toContain("deep health passed");
    expect(text).toContain("Migration check: off");
    expect(calls).toHaveLength(1);
  });
});
