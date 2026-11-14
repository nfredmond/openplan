import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pagingFake } from "./helpers/paging-fake";

/**
 * A MODEL RUN'S CORRIDOR COMMENT TOTAL COUNTS EVERY COMMENT.
 *
 * `engagement_items_near_geometry` returns one row per approved comment near
 * the run's corridor. PostgREST stops a function result at 1,000 rows with no
 * error, exactly as it does a table read, so a corridor with 1,234 nearby
 * comments reported a total of 1,000. The fake holds that cap.
 */

const nearbyFixture = vi.fn();
const nearbyPaging = pagingFake(() => nearbyFixture(), { serverCap: 1000 });
const rpc = vi.fn((...args: unknown[]) => {
  nearbyPaging.calls.push(["rpc", ...args]);
  return nearbyPaging.chain;
});
const runMaybeSingle = vi.fn();

function readChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in"]) chain[method] = () => chain;
  chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

const fakeSupabase = {
  auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) },
  rpc,
  from: vi.fn((table: string) => {
    if (table === "model_runs") return { select: () => ({ eq: () => ({ maybeSingle: runMaybeSingle }) }) };
    if (table === "engagement_categories") return readChain({ data: [], error: null });
    if (table === "engagement_campaigns") return readChain({ data: [], error: null });
    throw new Error(`unexpected table ${table}`);
  }),
};

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => fakeSupabase) }));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { GET } from "@/app/api/models/[modelId]/runs/[modelRunId]/engagement/route";

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

function get() {
  return GET(new NextRequest(`http://localhost/api/models/${MODEL_ID}/runs/${RUN_ID}/engagement`), {
    params: Promise.resolve({ modelId: MODEL_ID, modelRunId: RUN_ID }),
  });
}

function nearbyComments(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${String(i).padStart(6, "0")}`,
    campaign_id: "campaign-1",
    category_id: null,
    title: null,
    body: "Crossing is hard",
    latitude: 39.2,
    longitude: -121.0,
    votes_count: 0,
    distance_meters: i,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  nearbyPaging.reset();
  runMaybeSingle.mockResolvedValue({
    data: {
      id: RUN_ID,
      workspace_id: "ws-1",
      corridor_geojson: { type: "LineString", coordinates: [[-121, 39.2], [-121.01, 39.21]] },
    },
    error: null,
  });
});

describe("GET /api/models/[modelId]/runs/[modelRunId]/engagement", () => {
  it("totals every nearby comment past the 1,000-row cap, in a total order", async () => {
    nearbyFixture.mockResolvedValue({ data: nearbyComments(1234), error: null });

    const response = await get();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary.total).toBe(1234);
    expect(nearbyPaging.calls[0]).toEqual([
      "rpc",
      "engagement_items_near_geometry",
      expect.objectContaining({ p_workspace_id: "ws-1", p_buffer_meters: 150 }),
    ]);
    expect(nearbyPaging.calls.filter(([method]) => method === "order").slice(0, 2).map(([, column]) => column)).toEqual([
      "distance_meters",
      "id",
    ]);
  });

  it("answers a failed read with an error, never a short total", async () => {
    nearbyFixture.mockResolvedValue({ data: nearbyComments(1234), error: null });
    nearbyPaging.failPage(2, { message: "statement timeout", code: "57014" });

    const response = await get();

    expect(response.status).toBe(500);
  });
});
