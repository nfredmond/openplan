import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A NARROW ACTION MAY NOT RIDE A WIDE ROUTE — asserted at the route, because
 * that is the only place it is true.
 *
 * `POST /api/gtfs/feeds/[feedId]/refresh` accepts one more thing than the
 * `refresh_gtfs_feed` action does: `adoptDespiteCollapse`, the flag by which a
 * PERSON who has read the collapse assessment says "yes, adopt the smaller
 * refetch anyway". `promoteGtfsFeedVersion` withholds a refetch with 20% fewer
 * routes or stops precisely because a drop that size is as likely to be a
 * truncated download as a real service cut, and adopting it would move every
 * number that reads transit service with nothing on screen changing.
 *
 * THE ATTACK THIS CLOSES, AND WHY THE TYPE DOES NOT CLOSE IT. The approval hash
 * covers the action the ROUTE REBUILDS from its own parsed params — here
 * `{ kind, workspaceId, gtfsFeedId }` — and not the request body. So a body of
 * `{ workspaceId, adoptDespiteCollapse: true }` hashes to exactly what the
 * planner approved, passes verification, and then adopts a collapse nobody
 * consented to. The union variant in `catalog.ts` carries no such field, and
 * that is worth nothing on its own: the type lives in the browser bundle, and
 * anything holding a session cookie can post whatever body it likes with the
 * agent execution-source header attached.
 *
 * WHY THIS FILE EXISTS AT ALL. Nothing else in the suite asserts that any route
 * calls `refuseOutOfScopeAgentRequest` — `every-action-route-verifies-its-own-
 * approval` checks the verifier and the ledger and stops there. Deleting the
 * call from this route left every other test green when it was tried. That is
 * the definition of an unguarded rule, and this repository's standing lesson is
 * that an unguarded rule is a rule that has already been broken once.
 *
 * THE CHECKS BELOW RUN BEFORE ANY DATABASE WORK, which is what makes this
 * harness small: the refusal is answered off the parsed body, so no Supabase
 * client is ever constructed on the refusing path. The manual case deliberately
 * runs one step further, into the auth check, to prove it was NOT refused.
 */

const authGetUserMock = vi.fn();
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), requestId: "test" };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: authGetUserMock } }),
  createServiceRoleClient: () => {
    throw new Error("the service-role client must not be reached in these cases");
  },
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));

vi.mock("@/lib/gtfs/ingest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gtfs/ingest")>();
  return {
    ...actual,
    runGtfsIngest: () => {
      throw new Error("no ingest may run in these cases");
    },
  };
});

import { POST } from "@/app/api/gtfs/feeds/[feedId]/refresh/route";
import { ASSISTANT_ACTION_EXECUTION_SOURCE } from "@/lib/assistant/action-approval-server";

const FEED_ID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

function refreshRequest(body: Record<string, unknown>, options?: { agentSourced?: boolean }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options?.agentSourced) {
    headers["x-openplan-assistant-execution-source"] = ASSISTANT_ACTION_EXECUTION_SOURCE;
    headers["x-openplan-assistant-input-hash"] = "not-checked-on-this-path";
    headers["x-openplan-assistant-approval-id"] = "not-checked-on-this-path";
  }

  return new NextRequest(`http://localhost/api/gtfs/feeds/${FEED_ID}/refresh`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function feedParams() {
  return { params: Promise.resolve({ feedId: FEED_ID }) };
}

describe("the refresh route refuses an agent request wider than its action", () => {
  // CALL HISTORY IS PER-TEST, NOT PER-FILE.
  //
  // `authGetUserMock` is module-level, and two tests here assert it was NOT
  // called — "before any database work" is the whole point of the refusal.
  // Another test in this file legitimately DOES call it, so with no clearing
  // between tests those assertions only hold while the refusals happen to run
  // first. File order gave them that; `--sequence.shuffle` does not.
  //
  // `clearAllMocks` resets call history and keeps implementations, which is
  // exactly the distinction these tests need.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects adoptDespiteCollapse from the Planner Agent, naming the key, before any database work", async () => {
    // The service-role client throws if constructed and the ingest throws if
    // called, so reaching a 400 here also proves nothing was read or written.
    const response = await POST(
      refreshRequest({ workspaceId: WORKSPACE_ID, adoptDespiteCollapse: true }, { agentSourced: true }),
      feedParams()
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; details: string };
    expect(body.error).toBe("Planner Agent action carried fields outside its own payload");
    // The refusal names the offending key rather than emitting a shape error.
    // A refusal a planner cannot act on gets reported as a bug in the feature.
    expect(body.details).toContain("adoptDespiteCollapse");
    expect(body.details).toContain("workspaceId");

    expect(authGetUserMock).not.toHaveBeenCalled();
  });

  it("rejects it even when set to false, because the key is the boundary", async () => {
    // `adoptDespiteCollapse: false` changes nothing today. It is still refused,
    // because the rule is "the action may send its own keys and no others" — a
    // rule about values would have to be re-litigated the moment a default
    // flips, and a boundary that depends on a default is not a boundary.
    const response = await POST(
      refreshRequest({ workspaceId: WORKSPACE_ID, adoptDespiteCollapse: false }, { agentSourced: true }),
      feedParams()
    );

    expect(response.status).toBe(400);
    expect(authGetUserMock).not.toHaveBeenCalled();
  });

  it("lets the action's own payload through to the rest of the route", async () => {
    // Non-vacuity in the direction that matters: if the scope check refused
    // everything, the two assertions above would pass while the registered
    // action could never execute at all.
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await POST(
      refreshRequest({ workspaceId: WORKSPACE_ID }, { agentSourced: true }),
      feedParams()
    );

    // 401 rather than 400: it got past the scope check and into the auth check.
    expect(response.status).toBe(401);
    expect(authGetUserMock).toHaveBeenCalled();
  });

  it("leaves a PERSON using the endpoint untouched", async () => {
    /**
     * THE HALF THAT WOULD BE EASY TO BREAK WHILE FIXING THE OTHER HALF.
     *
     * `adoptDespiteCollapse` exists for a human who was shown both counts and
     * decided the smaller refetch is the real service. Refusing it on a manual
     * request would delete the only way to accept a genuine service cut, and the
     * planner would be stuck looking at a withheld version with no control that
     * could adopt it. The scope check keys on the execution-source header, not
     * on the key.
     */
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await POST(
      refreshRequest({ workspaceId: WORKSPACE_ID, adoptDespiteCollapse: true }),
      feedParams()
    );

    expect(response.status).toBe(401);
    expect(authGetUserMock).toHaveBeenCalled();
  });
});
