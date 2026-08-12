import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * MAINTENANCE OF EFFORT — the upsert that erased the figure it existed to keep.
 *
 * ============================================================================
 * THE DEFECT, STATED PLAINLY
 * ============================================================================
 *
 * The route's own header says both figures are optional on every write because
 * "the required figure comes from the ordinance and the reported figure from
 * the recipient's own audited accounts; they arrive months apart". The row it
 * built then read
 *
 *     required_amount: payload.data.requiredAmount ?? null
 *
 * so the March write that carried only the reported figure sent an explicit
 * NULL for the required one and overwrote the figure entered the previous
 * September. A maintenance-of-effort record with the required side blank reads
 * as "the ordinance asks nothing of this city", on a page a citizens' oversight
 * committee reads and on a `not_determined` line nobody can resolve.
 *
 * ============================================================================
 * WHAT IS ASSERTED HERE AND WHAT WAS PROVEN AGAINST POSTGRES
 * ============================================================================
 *
 * This file asserts the half a fake can see: which KEYS reach the upsert
 * payload. A field the caller did not mention must be ABSENT from the object,
 * and a field sent as `null` must be present and null. Asserting the object's
 * keys rather than a stored value is deliberate — the same reason
 * `public-engagement-page.test.tsx` asserts on the `.select()` projection
 * string itself: a mocked client models no column semantics at all, so the only
 * honest assertion is about what the route hands it.
 *
 * The OTHER half is PostgREST's, and a mocked client cannot demonstrate it, so
 * it was run against the live local stack on 2026-08-12 with the service key
 * and `Prefer: resolution=merge-duplicates` — three requests against one
 * (recipient, year) row:
 *
 *   1. `{required_amount: 1250000.00}`     -> {required 1250000.00, reported null}
 *   2. `{reported_amount: 1310500.00}`     -> {required 1250000.00, reported 1310500.00}
 *          ^ required_amount absent from the payload: THE STORED FIGURE SURVIVED
 *   3. `{required_amount: null, reported_amount: 1310500.00}`
 *                                          -> {required null,       reported 1310500.00}
 *          ^ exactly what `?? null` used to send: THE STORED FIGURE WAS ERASED
 *
 * PostgREST builds its `INSERT … ON CONFLICT DO UPDATE SET` column list from
 * the payload's own keys, so an omitted column takes its default on insert and
 * is untouched on conflict. Line 3 is the defect reproduced; line 2 is the fix.
 */

const createClientMock = vi.fn();
const membershipMock = vi.fn();
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const MEASURE_ID = "44444444-4444-4444-8444-444444444444";
const RECIPIENT_ID = "77777777-7777-4777-8777-777777777777";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "00000000-0000-4000-8000-000000000001";

let capturedUpserts: Array<Record<string, unknown>> = [];
let capturedOnConflict: Array<unknown> = [];
let role = "admin";

function terminal(data: unknown) {
  return {
    select: () => ({
      single: async () => ({ data, error: null }),
    }),
  };
}

const fromMock = vi.fn((table: string) => ({
  select: () => ({
    eq: () => ({
      eq: () => ({
        maybeSingle: async () =>
          table === "measure_funds"
            ? { data: { id: MEASURE_ID, workspace_id: WORKSPACE_ID, program_id: "p-1" }, error: null }
            : { data: { id: RECIPIENT_ID }, error: null },
      }),
    }),
  }),
  upsert: (row: Record<string, unknown>, options: unknown) => {
    capturedUpserts.push(row);
    capturedOnConflict.push(options);
    return terminal({ id: "moe-1", ...row });
  },
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => mockAudit }));
vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: async () => membershipMock(),
}));

import { POST as upsertMoe } from "@/app/api/measures/[measureId]/moe/route";

function post(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/measures/x/moe", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const context = () => ({ params: Promise.resolve({ measureId: MEASURE_ID }) });

/** Everything a valid write needs except the two money figures. */
const BASE = {
  recipientId: RECIPIENT_ID,
  fiscalYearLabel: "FY2030",
  basisNote: "Ordinance 14-3 section 7, as read by the Finance Director.",
  statedOn: "2030-03-02",
};

beforeEach(() => {
  vi.clearAllMocks();
  capturedUpserts = [];
  capturedOnConflict = [];
  role = "admin";
  membershipMock.mockImplementation(async () => ({
    membership: { workspace_id: WORKSPACE_ID, role },
  }));
  createClientMock.mockImplementation(() => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: fromMock,
  }));
});

describe("measure maintenance-of-effort upsert — an absent figure is not a withdrawn one", () => {
  it("leaves a field the caller never sent out of the upsert payload entirely", async () => {
    const response = await upsertMoe(post({ ...BASE, reportedAmount: 1310500 }), context());

    expect(response.status).toBe(201);
    expect(capturedUpserts).toHaveLength(1);
    const row = capturedUpserts[0];

    expect(row.reported_amount).toBe(1310500);
    // THE WHOLE FIX. The key must be ABSENT, not present-and-null: PostgREST
    // builds its ON CONFLICT DO UPDATE column list from the payload's keys, so
    // a key that is not there is a column that is not touched.
    expect(Object.prototype.hasOwnProperty.call(row, "required_amount")).toBe(false);
  });

  it("does the same in the other direction, for the figure that arrives first", async () => {
    await upsertMoe(post({ ...BASE, requiredAmount: 1250000 }), context());
    const row = capturedUpserts[0];

    expect(row.required_amount).toBe(1250000);
    expect(Object.prototype.hasOwnProperty.call(row, "reported_amount")).toBe(false);
  });

  /**
   * THE OTHER HALF, and the reason "just never write null" would have been the
   * wrong fix: withdrawing a figure has to remain possible. A figure entered
   * against the wrong year, or read out of a superseded ordinance, must be
   * removable — and an explicit null is how a caller says so.
   */
  it("writes an explicit null, because a figure withdrawn on purpose is a real instruction", async () => {
    await upsertMoe(post({ ...BASE, requiredAmount: null, reportedAmount: 1310500 }), context());
    const row = capturedUpserts[0];

    expect(Object.prototype.hasOwnProperty.call(row, "required_amount")).toBe(true);
    expect(row.required_amount).toBeNull();
  });

  /**
   * The browser sends "" for an empty money input, and `coerceOptionalMoney`
   * turns it into null. That is a person clearing the box — an instruction —
   * and it must reach the database as one rather than being dropped as "not
   * sent". The two paths to `null` are the same answer and must behave alike.
   */
  it("treats an emptied input as an explicit withdrawal, not as an absent field", async () => {
    await upsertMoe(post({ ...BASE, requiredAmount: "", reportedAmount: 1310500 }), context());
    const row = capturedUpserts[0];

    expect(Object.prototype.hasOwnProperty.call(row, "required_amount")).toBe(true);
    expect(row.required_amount).toBeNull();
  });

  it("sends both when both are given, and keeps the (recipient, year) conflict target", async () => {
    await upsertMoe(post({ ...BASE, requiredAmount: 1250000, reportedAmount: 1310500 }), context());

    expect(capturedUpserts[0]).toMatchObject({
      required_amount: 1250000,
      reported_amount: 1310500,
      recipient_id: RECIPIENT_ID,
      fiscal_year_label: "FY2030",
      workspace_id: WORKSPACE_ID,
      stated_by: USER_ID,
    });
    // The uniqueness the whole two-writes-months-apart design rests on.
    expect(capturedOnConflict[0]).toEqual({ onConflict: "recipient_id,fiscal_year_label" });
  });

  /**
   * A recorded 0.00 is a fact somebody entered — "this city was required to
   * spend nothing" — and is not the same as an unanswered year. `?? null`
   * happened not to break this one (0 is not nullish), but the rule is the same
   * one and it belongs under a test rather than under an accident of operator
   * precedence.
   */
  it("keeps a recorded zero apart from an unrecorded figure", async () => {
    await upsertMoe(post({ ...BASE, requiredAmount: 0 }), context());
    const row = capturedUpserts[0];

    expect(Object.prototype.hasOwnProperty.call(row, "required_amount")).toBe(true);
    expect(row.required_amount).toBe(0);
  });

  it("refuses a viewer, so the gate is the role matrix and not this route's memory", async () => {
    role = "viewer";
    const response = await upsertMoe(post({ ...BASE, requiredAmount: 1250000 }), context());

    expect(response.status).toBe(403);
    expect(capturedUpserts).toEqual([]);
  });
});

/*
 * ==========================================================================
 * MUTATION RESULTS — 2026-08-12
 * ==========================================================================
 *
 *   restore `required_amount: payload.data.requiredAmount ?? null` and
 *   `reported_amount: payload.data.reportedAmount ?? null` on the row literal
 *   (the shipped defect)
 *     -> "leaves a field the caller never sent out of the upsert payload
 *        entirely" and "does the same in the other direction" both fail on
 *        hasOwnProperty; the two null tests still pass, which is exactly why
 *        the absent case had to be asserted by KEY and not by value.
 *
 *   change `!== undefined` to a truthiness test (`if (payload.data.requiredAmount)`)
 *     -> "keeps a recorded zero apart from an unrecorded figure" fails, and so
 *        do both null tests: a withdrawal would silently become a no-op.
 *
 *   drop the `{ onConflict: … }` option
 *     -> "sends both when both are given" fails on the conflict target.
 */
