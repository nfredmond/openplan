/**
 * THE PRE-LAUNCH COVERAGE DISCLOSURE — and the two answers it must never give.
 *
 *   IT MUST NEVER SAY `no` WHEN IT DOES NOT KNOW. "This agency does not serve
 *   your city" and "we could not check" send a planner to completely different
 *   places, and only one of them is a fact this route can establish.
 *
 *   IT MUST NEVER ANSWER ABOUT ANOTHER WORKSPACE'S FEED.
 *   `gtfs_feeds.workspace_id IS NULL` is a PUBLIC preloaded feed every tenant
 *   can read, and the rest of this lane names the workspace on every query for
 *   that reason.
 *
 * It is a POST that writes nothing — the study-area geometry is the input and a
 * corridor polygon does not fit in a query string. `workspace-write-role-gate-
 * guard.test.ts` carries the matching allowlist entry with that reason.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const checkWorkspaceMembershipMock = vi.fn();
const authGetUserMock = vi.fn();
const feedMaybeSingleMock = vi.fn();
const versionMaybeSingleMock = vi.fn();
const stopCountMock = vi.fn();

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const FEED_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const feedFilters: Array<{ column: string; value: unknown }> = [];

const fromMock = vi.fn((table: string) => {
  if (table === "gtfs_feeds") {
    const chain: Record<string, unknown> = {
      eq: (column: string, value: unknown) => {
        feedFilters.push({ column, value });
        return chain;
      },
      maybeSingle: feedMaybeSingleMock,
    };
    return { select: () => chain };
  }
  if (table === "gtfs_feed_versions") {
    const chain: Record<string, unknown> = {
      eq: () => chain,
      maybeSingle: versionMaybeSingleMock,
    };
    return { select: () => chain };
  }
  if (table === "gtfs_stop_service_levels") {
    const chain: Record<string, unknown> = {
      eq: () => chain,
      gte: () => chain,
      lte: () => chain,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(stopCountMock()).then(resolve),
    };
    return { select: () => chain };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));
vi.mock("@/lib/workspaces/membership", () => ({
  checkWorkspaceMembership: (...args: unknown[]) => checkWorkspaceMembershipMock(...args),
}));

import { POST as checkCoverage } from "@/app/api/gtfs/feeds/study-area-coverage/route";

const CORRIDOR = {
  type: "Polygon",
  coordinates: [
    [
      [-121.5, 38.5],
      [-121.4, 38.5],
      [-121.4, 38.6],
      [-121.5, 38.6],
      [-121.5, 38.5],
    ],
  ],
};

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/gtfs/feeds/study-area-coverage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { workspaceId: WORKSPACE_ID, feedId: FEED_ID, corridorGeojson: CORRIDOR };

beforeEach(() => {
  vi.clearAllMocks();
  feedFilters.length = 0;
  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  authGetUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
  checkWorkspaceMembershipMock.mockResolvedValue({ ok: true, role: "viewer" });
  createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
  feedMaybeSingleMock.mockResolvedValue({
    data: { id: FEED_ID, agency_name: "Example Transit" },
    error: null,
  });
  versionMaybeSingleMock.mockResolvedValue({
    data: {
      id: VERSION_ID,
      service_start_date: "2025-01-01",
      service_end_date: "2025-04-05",
      frequency_trip_count: 0,
    },
    error: null,
  });
  stopCountMock.mockReturnValue({ count: 412, error: null });
});

afterEach(() => vi.clearAllMocks());

describe("POST /api/gtfs/feeds/study-area-coverage", () => {
  it("answers yes, and discloses the schedule window and the frequencies limit at once", async () => {
    const res = await checkCoverage(request(VALID_BODY));

    expect(res.status).toBe(200);
    // A planner deciding which of four feeds to pick needs all three answers in
    // the same breath: does it serve here, how old is it, and can the skim read
    // it at all.
    expect(await res.json()).toEqual({
      coverage: "yes",
      stopServiceRowsInStudyArea: 412,
      reason: null,
      serviceEndDate: "2025-04-05",
      usesFrequencies: false,
    });
  });

  it("scopes the feed read to this workspace, so a public preloaded feed is not answered about", async () => {
    await checkCoverage(request(VALID_BODY));
    expect(feedFilters).toEqual([
      { column: "id", value: FEED_ID },
      { column: "workspace_id", value: WORKSPACE_ID },
    ]);
  });

  it("says not_determined — not 404 and not `no` — when no ingest is in use", async () => {
    // The feed EXISTS. "There is no completed ingest in use" is the answer, and
    // a 404 would tell the planner their feed is gone.
    versionMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const res = await checkCoverage(request(VALID_BODY));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.coverage).toBe("not_determined");
    expect(body.reason).toMatch(/no completed ingest in use/);
  });

  it("reports a zero stop count as a real `no`", async () => {
    stopCountMock.mockReturnValue({ count: 0, error: null });

    const body = (await (await checkCoverage(request(VALID_BODY))).json()) as Record<string, unknown>;
    expect(body.coverage).toBe("no");
  });

  it("never turns a failed count into a `no`", async () => {
    stopCountMock.mockReturnValue({ count: null, error: { message: "statement timeout" } });

    const body = (await (await checkCoverage(request(VALID_BODY))).json()) as Record<string, unknown>;
    expect(body.coverage).toBe("not_determined");
    expect(body.reason).toMatch(/statement timeout/);
  });

  it("answers a non-member with 404 rather than 403", async () => {
    // Confirming the workspace exists is an enumeration oracle.
    checkWorkspaceMembershipMock.mockResolvedValue({ ok: false, kind: "not_member" });

    const res = await checkCoverage(request(VALID_BODY));
    expect(res.status).toBe(404);
  });

  it("refuses an unauthenticated caller", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const res = await checkCoverage(request(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("404s a feed this workspace does not own", async () => {
    feedMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const res = await checkCoverage(request(VALID_BODY));
    expect(res.status).toBe(404);
  });

  it("rejects a body that is not a study-area coverage question", async () => {
    const res = await checkCoverage(request({ workspaceId: WORKSPACE_ID, feedId: FEED_ID }));
    expect(res.status).toBe(400);
  });
});
