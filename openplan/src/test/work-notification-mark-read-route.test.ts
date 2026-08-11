import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/work-notifications/read.
 *
 * WHAT IS ACTUALLY AT STAKE HERE is not the button — it is what the product
 * SAYS when the write changes nothing. `work_notifications` carries a
 * restrictive writer gate, so a viewer's update matches zero rows and PostgREST
 * reports that as a SUCCESSFUL statement with `error: null`. A route that read
 * only `.error` would answer 200 over a reminder that is still unread. That is
 * the `runs` defect — a saved map view discarded for every user of every role
 * while the route logged success — reproduced in a new module.
 *
 * MUTATION-VERIFIED (each reverted after): dropping `.select("id")` from the
 * single-row update so the write cannot see its own row count, and answering
 * 200 instead of 404 on zero rows, each fail the zero-row test below.
 */

const getUserMock = vi.fn();
const updateChain = {
  eq: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
};

const supabase = {
  auth: { getUser: () => getUserMock() },
  from: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabase,
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { NextRequest } from "next/server";

import { POST } from "@/app/api/work-notifications/read/route";

const USER = "aaaaaaaa-0000-4000-8000-00000000000a";
const NOTIFICATION = "11111111-2222-4333-8444-555555555555";

/** A chain that records what it was asked and answers a configured result. */
function chain(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown]> = [];
  const self: Record<string, unknown> = {
    calls,
    eq(column: string, value: unknown) {
      calls.push([column, value]);
      return self;
    },
    select() {
      (self as { selected?: boolean }).selected = true;
      return self;
    },
    maybeSingle: async () => result,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return self;
}

function request(body: unknown) {
  return new NextRequest("https://plan.example.gov/api/work-notifications/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: USER } } });
  updateChain.eq.mockReset();
  updateChain.select.mockReset();
  updateChain.maybeSingle.mockReset();
});

describe("marking a reminder read", () => {
  it("refuses a signed-out caller", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const response = await POST(request({ markAll: true }));
    expect(response.status).toBe(401);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("refuses a body that names nothing", async () => {
    const response = await POST(request({ workspaceId: "anything" }));
    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("marks one read and reports it", async () => {
    const update = chain({ data: { id: NOTIFICATION }, error: null });
    supabase.from.mockReturnValue({ update: () => update });

    const response = await POST(request({ notificationId: NOTIFICATION }));

    expect(response.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith("work_notifications");
    // Scoped by id alone: the RLS policy supplies the recipient, and a
    // workspace id from the request body would be a claim, not a fact.
    expect((update.calls as Array<[string, unknown]>)).toEqual([["id", NOTIFICATION]]);
    expect((update as { selected?: boolean }).selected).toBe(true);
  });

  it("answers 404 — not a cheerful 200 — when the write matched nothing", async () => {
    // The viewer case and the someone-else's-reminder case both land here.
    const update = chain({ data: null, error: null });
    supabase.from.mockReturnValue({ update: () => update });

    const response = await POST(request({ notificationId: NOTIFICATION }));
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(String(body.error)).toContain("reminder");
  });

  it("answers 500 for a real database failure, which is a different thing", async () => {
    const update = chain({ data: null, error: { code: "42501", message: "permission denied" } });
    supabase.from.mockReturnValue({ update: () => update });

    const response = await POST(request({ notificationId: NOTIFICATION }));
    expect(response.status).toBe(500);
  });

  it("marks all read for the caller only, and counts what it changed", async () => {
    const update = chain({ data: [{ id: "n-1" }, { id: "n-2" }], error: null });
    supabase.from.mockReturnValue({ update: () => update });

    const response = await POST(request({ markAll: true }));
    const body = (await response.json()) as { marked?: number };

    expect(response.status).toBe(200);
    expect(body.marked).toBe(2);
    expect(update.calls).toEqual([
      ["recipient_user_id", USER],
      ["is_read", false],
    ]);
  });
});
