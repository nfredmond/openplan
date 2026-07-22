import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => createServiceRoleClientMock(),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET as reapCron } from "@/app/api/cron/reap-model-runs/route";

const MIN = 60 * 1000;

function makeClient(rows: unknown[]) {
  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  const client = {
    from(_table: string) {
      return {
        select() {
          const builder: Record<string, unknown> = {};
          const chain = () => builder;
          Object.assign(builder, {
            in: chain,
            eq: chain,
            gt: chain,
            order: chain,
            limit: chain,
            then: (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
              Promise.resolve({ data: rows, error: null }).then(resolve),
          });
          return builder;
        },
      };
    },
    rpc(fn: string, params: Record<string, unknown>) {
      rpcCalls.push({ fn, params });
      return Promise.resolve({ data: true, error: null });
    },
  };
  return { client, rpcCalls };
}

function request(auth?: string) {
  return new NextRequest("http://localhost/api/cron/reap-model-runs", {
    headers: auth ? { authorization: auth } : {},
  });
}

describe("GET /api/cron/reap-model-runs", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("rejects a request without the cron secret (401)", async () => {
    const response = await reapCron(request());
    expect(response.status).toBe(401);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token (401)", async () => {
    const response = await reapCron(request("Bearer wrong"));
    expect(response.status).toBe(401);
  });

  it("closes the route when no CRON_SECRET is configured (401)", async () => {
    delete process.env.CRON_SECRET;
    const response = await reapCron(request("Bearer test-secret"));
    expect(response.status).toBe(401);
  });

  it("reaps a crashed run and reports the summary", async () => {
    const frozen = new Date(Date.now() - 50 * MIN).toISOString();
    const rows = [
      {
        id: "run-crashed",
        status: "running",
        created_at: new Date(Date.now() - 60 * MIN).toISOString(),
        updated_at: frozen,
        stages: [{ status: "running", updated_at: frozen }],
      },
      {
        id: "run-live",
        status: "running",
        created_at: new Date(Date.now() - 3 * MIN).toISOString(),
        updated_at: new Date(Date.now() - 1 * MIN).toISOString(),
        stages: [{ status: "running", updated_at: new Date(Date.now() - 1 * MIN).toISOString() }],
      },
    ];
    const { client, rpcCalls } = makeClient(rows);
    createServiceRoleClientMock.mockReturnValue(client);

    const response = await reapCron(request("Bearer test-secret"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { scanned: number; reaped: number; details: Array<{ id: string }> };
    expect(payload.scanned).toBe(2);
    expect(payload.reaped).toBe(1);
    expect(payload.details[0].id).toBe("run-crashed");

    // Exactly one reap RPC — for the crashed run, not the live one.
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("reap_model_run_if_stale");
    expect(rpcCalls[0].params.p_run_id).toBe("run-crashed");
  });
});
