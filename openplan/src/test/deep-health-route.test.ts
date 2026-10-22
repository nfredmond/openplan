import { readdirSync } from "node:fs";
import path from "node:path";
import { unobservedNodeQueues } from "./helpers/node-process-observation";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE OPERATOR'S HEALTH CHECK, AND WHAT THE BUILD EXPECTS OF THE DATABASE.
 *
 * On October 11, 2026 a route went live before the four migrations it read,
 * because code deploys on merge and hosted migrations are applied by hand. The
 * build now records every migration version it ships with; /api/health reports
 * the count and latest, and the token-protected /api/health/deep lists them all
 * beside one database read, one Storage read and the modeling heartbeats.
 *
 * Blind spots, stated: the Supabase client is a fake, so this proves which
 * calls are made and what is reported, not that the hosted project answers.
 */

type HeartbeatResult = { data: unknown[] | null; error: { message: string } | null };
const heartbeatResult: { current: HeartbeatResult } = { current: { data: [], error: null } };
const bucketResult: { current: { data: unknown[] | null; error: { message: string } | null } } = {
  current: { data: [], error: null },
};
const selected: string[] = [];
const rpcCalls: Array<{ name: string; parameters: unknown }> = [];
const processResult: { current: { data: unknown; error: { message: string } | null } } = {
  current: { data: unobservedNodeQueues(), error: null },
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      select: (columns: string) => {
        selected.push(`${table}:${columns}`);
        return Promise.resolve(heartbeatResult.current);
      },
    }),
    storage: { listBuckets: () => Promise.resolve(bucketResult.current) },
    rpc: (name: string, parameters?: unknown) => { rpcCalls.push({ name, parameters: parameters ?? {} }); return Promise.resolve(processResult.current); },
  }),
}));

const { GET } = await import("@/app/api/health/deep/route");
const { GET: PUBLIC_GET } = await import("@/app/api/health/route");
const nextConfig = (await import("../../next.config")).default;
const { parseMigrationVersionList } = await import("@/lib/ops/migration-manifest");

const TOKEN = "deep-health-token-for-tests";

function request(token?: string) {
  return new NextRequest("https://openplan.example/api/health/deep", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("the build records the migrations it expects", () => {
  it("inlines every migration version in the repository, sorted", () => {
    const fromDisk = readdirSync(path.join(process.cwd(), "supabase/migrations"))
      .map((name) => /^([0-9]+)_.*\.sql$/.exec(name)?.[1])
      .filter((version): version is string => Boolean(version))
      .sort();
    const stamped = parseMigrationVersionList(nextConfig.env?.OPENPLAN_BUILD_MIGRATION_VERSIONS);
    expect(fromDisk.length).toBeGreaterThan(400);
    expect(stamped).toEqual(fromDisk);
  });

  it("turns off the X-Powered-By header", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

describe("GET /api/health reports what the build expects", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("gives the count and latest version, not the database's", async () => {
    vi.stubEnv("OPENPLAN_BUILD_MIGRATION_VERSIONS", "20261017000013,20261017000010,20250101000000");
    const payload = await PUBLIC_GET().json();
    expect(payload.deployment.migrations).toEqual({ expected: 3, latest: "20261017000013" });
    expect(payload.checks.database).toBe("not_checked");
  });

  it("says null when the build recorded none", async () => {
    vi.stubEnv("OPENPLAN_BUILD_MIGRATION_VERSIONS", "");
    expect((await PUBLIC_GET().json()).deployment.migrations).toBeNull();
  });
});

describe("GET /api/health/deep", () => {
  beforeEach(() => {
    selected.length = 0;
    heartbeatResult.current = { data: [], error: null };
    rpcCalls.length = 0; processResult.current = { data: unobservedNodeQueues(), error: null };
    bucketResult.current = { data: [{ id: "a" }, { id: "b" }], error: null };
    vi.stubEnv("OPENPLAN_BUILD_MIGRATION_VERSIONS", "20261017000013,20261017000010");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("is off, and says how to turn it on, when no token is configured", async () => {
    vi.stubEnv("OPENPLAN_HEALTH_TOKEN", "");
    const response = await GET(request(TOKEN));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("OPENPLAN_HEALTH_TOKEN");
    expect(selected).toEqual([]);
  });

  it("refuses a missing or wrong token without touching the database", async () => {
    vi.stubEnv("OPENPLAN_HEALTH_TOKEN", TOKEN);
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(selected).toEqual([]);
  });

  it("reads the database and Storage, ages each heartbeat, and lists every expected migration", async () => {
    vi.stubEnv("OPENPLAN_HEALTH_TOKEN", TOKEN);
    vi.useFakeTimers({ now: new Date("2026-10-14T12:00:00Z"), toFake: ["Date"] });
    heartbeatResult.current = {
      data: [
        { worker_kind: "aequilibrae", last_successful_heartbeat_at: "2026-10-14T11:59:30Z" },
        { worker_kind: "activitysim", last_successful_heartbeat_at: "2026-10-14T11:00:00Z" },
      ],
      error: null,
    };

    const response = await GET(request(TOKEN));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(selected).toEqual(["modeling_worker_heartbeats:worker_kind,last_successful_heartbeat_at"]);
    expect(payload.status).toBe("ok");
    expect(payload.checks.database.state).toBe("ok");
    expect(payload.checks.storage).toMatchObject({ state: "ok", buckets: 2 });
    expect(rpcCalls, "Node observations use their dedicated reader").toEqual([{ name: "read_node_queue_process_observations", parameters: {} }]);
    expect(payload.checks.nodeQueueProcesses, "Process availability remains separate from completed work")
      .toMatchObject({ state: "ok", scope: "process_only", jobCompletion: "unassessed", queues: unobservedNodeQueues().queues });
    expect(payload.checks.modelingWorkers).toEqual([
      { kind: "aequilibrae", ageSeconds: 30, fresh: true },
      { kind: "activitysim", ageSeconds: 3600, fresh: false },
    ]);
    expect(payload.migrations).toEqual({
      expected: { count: 2, latest: "20261017000013", versions: ["20261017000010", "20261017000013"] },
      applied: "not_checked",
    });
  });

  it("answers 503 when Storage fails, without repeating the provider's error", async () => {
    vi.stubEnv("OPENPLAN_HEALTH_TOKEN", TOKEN);
    bucketResult.current = { data: null, error: { message: "internal host db-7.private refused" } };

    const response = await GET(request(TOKEN));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toMatchObject({ status: "failed", checks: { database: { state: "ok" }, storage: { state: "failed" } } });
    expect(text).not.toContain("db-7.private");
  });

  it("keeps an unavailable Node observation distinct from no workers", async () => {
    vi.stubEnv("OPENPLAN_HEALTH_TOKEN", TOKEN);
    processResult.current = { data: null, error: { message: "private-node-observation-sentinel" } };
    const response = await GET(request(TOKEN)); const text = await response.text();
    expect(response.status, "Unavailable Node observation must fail deep health").toBe(503);
    const body = JSON.parse(text);
    expect(body.checks.nodeQueueProcesses).toEqual({ state: "failed", ms: expect.any(Number), scope: "process_only", jobCompletion: "unassessed" });
    expect(body.checks.nodeQueueProcesses, "Unavailable observations cannot become zero workers").not.toHaveProperty("queues");
    expect(text).not.toContain("private-node-observation-sentinel");
  });
  it("refuses malformed Node observations instead of forwarding a completion claim", async () => {
    vi.stubEnv("OPENPLAN_HEALTH_TOKEN", TOKEN);
    processResult.current = { data: { ...unobservedNodeQueues(), jobCompletion: "approved" }, error: null };
    const response = await GET(request(TOKEN));
    expect(response.status, "Malformed process facts cannot pass deep health").toBe(503);
    expect((await response.json()).checks.nodeQueueProcesses).not.toHaveProperty("queues");
  });
  it("answers 503 when the database read fails", async () => {
    vi.stubEnv("OPENPLAN_HEALTH_TOKEN", TOKEN);
    heartbeatResult.current = { data: null, error: { message: "relation does not exist" } };

    const response = await GET(request(TOKEN));
    expect(response.status).toBe(503);
    expect((await response.json()).checks.database.state).toBe("failed");
  });
});
