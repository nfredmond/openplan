import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * RTP PERFORMANCE MEASURES — AND THE ONE DISTINCTION THIS ROUTE EXISTS TO KEEP.
 *
 * A performance measure is a baseline and a target an agency will be held to.
 * "Fatalities: 0 in 2024, target 0 by 2035" is a real Vision Zero baseline, and
 * so is "0% of bridges in poor condition". So a MEASURED ZERO and a BLANK BOX
 * are different facts, and the ordinary ways of writing this code destroy the
 * difference:
 *
 *   - `z.coerce.number()` maps `""` to `0`, so an empty input becomes a
 *     baseline the agency never measured;
 *   - `value || null` maps `0` to `null`, so a measured zero becomes "not
 *     measured";
 *   - `if (payload.baselineValue)` in the PATCH path skips a zero and silently
 *     leaves the old number in place.
 *
 * Every one of those type-checks, and none of them is visible in a response
 * body built from a fixture. So the assertions below read the payload the route
 * actually handed to the database — `dbCalls` — rather than what the mocked
 * client handed back.
 *
 * MUTATIONS RUN AGAINST THIS FILE, with the failure each actually produced.
 * Every line below was verified by breaking the route, running, and restoring —
 * not predicted. Two of the predictions were wrong, and the corrections are the
 * useful part:
 *
 *   1. `baseline_value: … ?? null` -> `|| null`
 *      => "keeps a measured zero as zero" AND "does not collapse a zero and an
 *         absent baseline" fail: `expected null to be +0`.
 *   2. delete the `if (trimmed === "") return null` branch in
 *      `nullableNumberField`
 *      => "an empty box is not a zero" fails: `expected +0 to be null`.
 *   3. PATCH's `!== undefined` -> truthiness
 *      => "keeps a measured zero alongside another edited field" fails:
 *         `expected undefined to be +0`.
 *   4. drop the `error.code === UNIQUE_VIOLATION` branch
 *      => "answers 409, not 500, on a duplicate key" fails: 500 for 409.
 *   5. drop `.eq("workspace_id", membership.workspace_id)` from the cycle read
 *      => ONLY "reads the cycle pinned to the caller's own workspace" fails.
 *      CORRECTION: this was predicted to fail "refuses a cycle in another
 *      workspace" too, and it does NOT. That test sets `cycleRead = null` by
 *      FIXTURE, so it describes a database that returned nothing rather than
 *      one that filtered — it proves the route's handling of an empty read, not
 *      the filter. A mock chain cannot enforce an `.eq`, so the assertion on
 *      the `.eq` ARGUMENTS is the only thing standing between this route and a
 *      cross-workspace write. Do not delete it as redundant.
 *   6. drop `.strict()` from the create schema
 *      => "rejects a body that tries to name its own workspace" fails: 201
 *         for 400.
 *   7. drop `.select("id")` from the DELETE chain
 *      => NOTHING FAILED. That gap is why the projection block near the bottom
 *         of this file exists; see its own comment for the production
 *         consequence.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const MEASURE_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_WORKSPACE_ID = "55555555-5555-4555-8555-555555555555";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import {
  DELETE as deleteMeasure,
  PATCH as patchMeasure,
  POST as postMeasure,
} from "@/app/api/rtp-cycles/[rtpCycleId]/performance-measures/route";

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

const dbCalls: Array<{ table: string; method: string; args: unknown[] }> = [];

const CHAIN_METHODS = ["select", "eq", "in", "order", "limit", "insert", "update", "delete"];

function makeChain(table: string, resolve: (ops: string[]) => QueryResult) {
  const ops: string[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of CHAIN_METHODS) {
    chain[method] = vi.fn((...args: unknown[]) => {
      ops.push(method);
      dbCalls.push({ table, method, args });
      return chain;
    });
  }
  chain.maybeSingle = vi.fn(async () => resolve(ops));
  chain.single = vi.fn(async () => resolve(ops));
  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(resolve(ops)).then(onFulfilled, onRejected);
  return chain;
}

/** The four reads/writes each test varies. */
let membershipRead: QueryResult;
let cycleRead: QueryResult;
let measureRead: QueryResult;
let measureWrite: QueryResult;
let candidateRead: QueryResult;
let candidateFlip: QueryResult;

const STORED_MEASURE = {
  id: MEASURE_ID,
  workspace_id: WORKSPACE_ID,
  rtp_cycle_id: CYCLE_ID,
  measure_key: "fatalities",
  label: "Traffic fatalities",
  unit: "per year",
  baseline_value: 0,
  baseline_year: 2024,
  target_value: 0,
  target_year: 2035,
  data_source: "CCRS",
  notes: null,
  sort_order: 0,
  created_at: "2026-08-05T00:00:00.000Z",
  updated_at: "2026-08-05T00:00:00.000Z",
};

function installClient() {
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => {
      if (table === "workspace_members") {
        return makeChain(table, () => membershipRead);
      }
      if (table === "rtp_cycles") {
        return makeChain(table, () => cycleRead);
      }
      if (table === "rtp_performance_measures") {
        return makeChain(table, (ops) =>
          ops.includes("insert") || ops.includes("update") || ops.includes("delete")
            ? measureWrite
            : measureRead
        );
      }
      // The staging table a transcribed measure is accepted from. Reads answer
      // `candidateRead`; the flip that marks it accepted answers
      // `candidateFlip`, and keeping them apart is what lets a test fail the
      // flip alone without pretending the lookup failed too.
      if (table === "rtp_extraction_candidates") {
        return makeChain(table, (ops) => (ops.includes("update") ? candidateFlip : candidateRead));
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  });
  createServiceRoleClientMock.mockImplementation(() => ({
    from: (table: string) => {
      if (table !== "rtp_extraction_candidates") throw new Error(`Unexpected service-role table: ${table}`);
      return makeChain(table, (ops) => (ops.includes("update") ? candidateFlip : candidateRead));
    },
  }));
}

const routeContext = { params: Promise.resolve({ rtpCycleId: CYCLE_ID }) };

function jsonRequest(method: string, body: unknown) {
  return new NextRequest(`http://localhost/api/rtp-cycles/${CYCLE_ID}/performance-measures`, {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** The payload the route actually handed to `insert`. */
function insertedRow(): Record<string, unknown> | null {
  const call = dbCalls.find((entry) => entry.table === "rtp_performance_measures" && entry.method === "insert");
  return call ? (call.args[0] as Record<string, unknown>) : null;
}

/** The payload the route actually handed to `update`. */
function updatedRow(): Record<string, unknown> | null {
  const call = dbCalls.find((entry) => entry.table === "rtp_performance_measures" && entry.method === "update");
  return call ? (call.args[0] as Record<string, unknown>) : null;
}

function wroteAnything(): boolean {
  return dbCalls.some(
    (entry) =>
      entry.table === "rtp_performance_measures" &&
      (entry.method === "insert" || entry.method === "update" || entry.method === "delete")
  );
}

const VALID_CREATE = {
  measureKey: "fatalities",
  label: "Traffic fatalities",
  unit: "per year",
  dataSource: "CCRS",
};

beforeEach(() => {
  vi.clearAllMocks();
  dbCalls.length = 0;
  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  membershipRead = {
    data: [{ workspace_id: WORKSPACE_ID, role: "admin", workspaces: { name: "Agency", created_at: "2026-01-01" } }],
    error: null,
  };
  cycleRead = { data: { id: CYCLE_ID, workspace_id: WORKSPACE_ID }, error: null };
  measureRead = { data: { id: MEASURE_ID, measure_key: "fatalities" }, error: null };
  measureWrite = { data: STORED_MEASURE, error: null };
  candidateRead = { data: PENDING_MEASURE_CANDIDATE, error: null };
  candidateFlip = { data: { id: CANDIDATE_ID }, error: null };
  installClient();
});

describe("POST /api/rtp-cycles/[rtpCycleId]/performance-measures — zero is a measurement", () => {
  it("keeps a measured zero as zero", async () => {
    const response = await postMeasure(
      jsonRequest("POST", { ...VALID_CREATE, baselineValue: 0, baselineYear: 2024, targetValue: 0, targetYear: 2035 }),
      routeContext
    );

    expect(response.status).toBe(201);
    const row = insertedRow();
    expect(row).not.toBeNull();
    expect(row!.baseline_value).toBe(0);
    expect(row!.target_value).toBe(0);
    // Not null, and not undefined — the two ways a zero gets lost.
    expect(row!.baseline_value).not.toBeNull();
    expect(row!.baseline_value).not.toBeUndefined();
  });

  it("stores an ABSENT baseline as null", async () => {
    const response = await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);

    expect(response.status).toBe(201);
    const row = insertedRow();
    expect(row!.baseline_value).toBeNull();
    expect(row!.baseline_year).toBeNull();
    expect(row!.target_value).toBeNull();
    expect(row!.target_year).toBeNull();
  });

  it("an empty box is not a zero — '' stores null", async () => {
    // Deliberately VALUES ONLY, no year fields. A blank year would be caught
    // by the 1900–2200 range check even if the blank-string branch were gone,
    // and that would let this test report a pass-by-accident: the assertion
    // that has to bite is the stored value, not the year range.
    const response = await postMeasure(
      jsonRequest("POST", { ...VALID_CREATE, baselineValue: "", targetValue: "  " }),
      routeContext
    );

    expect(response.status).toBe(201);
    const row = insertedRow();
    // `Number("")` is 0. If this ever reads 0, an agency is publishing a
    // baseline it never measured.
    expect(row!.baseline_value).toBeNull();
    expect(row!.target_value).toBeNull();
  });

  it("a blank year is null too", async () => {
    const response = await postMeasure(
      jsonRequest("POST", { ...VALID_CREATE, baselineYear: "", targetYear: null }),
      routeContext
    );

    expect(response.status).toBe(201);
    expect(insertedRow()!.baseline_year).toBeNull();
    expect(insertedRow()!.target_year).toBeNull();
  });

  it("does not collapse a zero and an absent baseline into the same stored value", async () => {
    await postMeasure(jsonRequest("POST", { ...VALID_CREATE, baselineValue: 0 }), routeContext);
    const withZero = insertedRow()!.baseline_value;

    dbCalls.length = 0;
    await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);
    const withoutBaseline = insertedRow()!.baseline_value;

    expect(withZero).toBe(0);
    expect(withoutBaseline).toBeNull();
    expect(withZero).not.toBe(withoutBaseline);
  });

  it("accepts a numeric string from a form input", async () => {
    await postMeasure(
      jsonRequest("POST", { ...VALID_CREATE, baselineValue: "12.5", baselineYear: "2024" }),
      routeContext
    );

    const row = insertedRow();
    expect(row!.baseline_value).toBe(12.5);
    expect(row!.baseline_year).toBe(2024);
  });

  it("accepts a negative value — a measure can be a change, not only a level", async () => {
    await postMeasure(jsonRequest("POST", { ...VALID_CREATE, targetValue: -3.2 }), routeContext);

    expect(insertedRow()!.target_value).toBe(-3.2);
  });

  it("refuses an unparseable number instead of quietly storing null", async () => {
    const response = await postMeasure(
      jsonRequest("POST", { ...VALID_CREATE, baselineValue: "about twelve" }),
      routeContext
    );

    expect(response.status).toBe(400);
    expect(wroteAnything()).toBe(false);
  });

  it("refuses a year outside the column's own CHECK range", async () => {
    const response = await postMeasure(jsonRequest("POST", { ...VALID_CREATE, baselineYear: 1492 }), routeContext);

    expect(response.status).toBe(400);
    expect(wroteAnything()).toBe(false);
  });
});

describe("POST — measure_key uniqueness", () => {
  it("answers 409, not 500, on a duplicate key", async () => {
    measureWrite = {
      data: null,
      error: {
        message: 'duplicate key value violates unique constraint "rtp_performance_measures_unique_key"',
        code: "23505",
      },
    };

    const response = await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("already has a performance measure");
    expect(body.error).toContain("fatalities");
    // The Postgres sentence must not be what a planner reads.
    expect(JSON.stringify(body)).not.toContain("duplicate key value violates");
  });

  it("still answers 500 for a genuine write failure", async () => {
    measureWrite = {
      data: null,
      error: { message: "permission denied for table rtp_performance_measures", code: "42501" },
    };

    const response = await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);

    expect(response.status).toBe(500);
  });
});

describe("POST — server-side ownership and scoping", () => {
  it("sets workspace_id, rtp_cycle_id and created_by from the session, not the body", async () => {
    await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);

    const row = insertedRow();
    expect(row!.workspace_id).toBe(WORKSPACE_ID);
    expect(row!.rtp_cycle_id).toBe(CYCLE_ID);
    expect(row!.created_by).toBe(USER_ID);
  });

  it("rejects a body that tries to name its own workspace", async () => {
    const response = await postMeasure(
      jsonRequest("POST", { ...VALID_CREATE, workspaceId: OTHER_WORKSPACE_ID }),
      routeContext
    );

    // zod strips unknown keys by default, which would make this look accepted
    // while the field never reached the code. `.strict()` makes it a refusal.
    expect(response.status).toBe(400);
    expect(wroteAnything()).toBe(false);
  });

  it("reads the cycle pinned to the caller's own workspace", async () => {
    await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);

    const cycleEqs = dbCalls.filter((entry) => entry.table === "rtp_cycles" && entry.method === "eq");
    expect(cycleEqs).toContainEqual(expect.objectContaining({ args: ["workspace_id", WORKSPACE_ID] }));
    expect(cycleEqs).toContainEqual(expect.objectContaining({ args: ["id", CYCLE_ID] }));
  });

  it("refuses a cycle in another workspace without saying it exists", async () => {
    cycleRead = { data: null, error: null };

    const response = await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("RTP cycle not found");
    expect(wroteAnything()).toBe(false);
  });

  it("does not report a FAILED cycle read as a missing cycle", async () => {
    cycleRead = { data: null, error: { message: "permission denied for table rtp_cycles", code: "42501" } };

    const response = await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load the RTP cycle");
    expect(body.error).not.toBe("RTP cycle not found");
    expect(wroteAnything()).toBe(false);
  });

  it("answers 503 while the migration has not been applied", async () => {
    cycleRead = {
      data: null,
      error: { message: "Could not find the table 'public.rtp_cycles' in the schema cache" },
    };

    const response = await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);

    expect(response.status).toBe(503);
    expect(wroteAnything()).toBe(false);
  });

  it("refuses a viewer", async () => {
    membershipRead = {
      data: [{ workspace_id: WORKSPACE_ID, role: "viewer", workspaces: { name: "Agency", created_at: "2026-01-01" } }],
      error: null,
    };

    const response = await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);

    expect(response.status).toBe(403);
    expect(wroteAnything()).toBe(false);
  });

  it("refuses a signed-out caller", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);

    expect(response.status).toBe(401);
    expect(wroteAnything()).toBe(false);
  });

  it("refuses malformed JSON with a 400 rather than a 500", async () => {
    const response = await postMeasure(jsonRequest("POST", "{ not json"), routeContext);

    expect(response.status).toBe(400);
    expect(wroteAnything()).toBe(false);
  });
});

describe("PATCH — updating a measure without losing a zero", () => {
  it("keeps a measured zero", async () => {
    const response = await patchMeasure(
      jsonRequest("PATCH", { measureId: MEASURE_ID, baselineValue: 0 }),
      routeContext
    );

    expect(response.status).toBe(200);
    const updates = updatedRow();
    expect(updates).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(updates!, "baseline_value")).toBe(true);
    expect(updates!.baseline_value).toBe(0);
  });

  it("keeps a measured zero alongside another edited field", async () => {
    // The companion to the test above, and the one that isolates the update
    // BUILDER rather than the "nothing to update" refusal: with a second field
    // present the update always proceeds, so a dropped zero shows up as a
    // missing column instead of as a 400 that could have several causes.
    const response = await patchMeasure(
      jsonRequest("PATCH", { measureId: MEASURE_ID, label: "Fatal crashes", baselineValue: 0, targetValue: 0 }),
      routeContext
    );

    expect(response.status).toBe(200);
    const updates = updatedRow();
    expect(updates!.baseline_value).toBe(0);
    expect(updates!.target_value).toBe(0);
  });

  it("leaves a field absent from the payload untouched", async () => {
    await patchMeasure(jsonRequest("PATCH", { measureId: MEASURE_ID, label: "Fatal crashes" }), routeContext);

    const updates = updatedRow();
    expect(updates!.label).toBe("Fatal crashes");
    expect(Object.prototype.hasOwnProperty.call(updates!, "baseline_value")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(updates!, "target_value")).toBe(false);
  });

  it("clears a measurement when the field is explicitly null or blank", async () => {
    await patchMeasure(
      jsonRequest("PATCH", { measureId: MEASURE_ID, baselineValue: null, targetValue: "" }),
      routeContext
    );

    const updates = updatedRow();
    expect(Object.prototype.hasOwnProperty.call(updates!, "baseline_value")).toBe(true);
    expect(updates!.baseline_value).toBeNull();
    expect(updates!.target_value).toBeNull();
  });

  it("refuses a payload that changes nothing", async () => {
    const response = await patchMeasure(jsonRequest("PATCH", { measureId: MEASURE_ID }), routeContext);

    expect(response.status).toBe(400);
    expect(wroteAnything()).toBe(false);
  });

  it("answers 409 when a rename collides with another measure's key", async () => {
    measureWrite = {
      data: null,
      error: {
        message: 'duplicate key value violates unique constraint "rtp_performance_measures_unique_key"',
        code: "23505",
      },
    };

    const response = await patchMeasure(
      jsonRequest("PATCH", { measureId: MEASURE_ID, measureKey: "bridge-condition" }),
      routeContext
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("bridge-condition");
  });

  it("refuses a measure that is not in this cycle", async () => {
    measureRead = { data: null, error: null };

    const response = await patchMeasure(
      jsonRequest("PATCH", { measureId: MEASURE_ID, label: "Renamed" }),
      routeContext
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Performance measure not found");
    expect(updatedRow()).toBeNull();
  });

  it("does not report a saved change when the write matched no rows", async () => {
    measureWrite = { data: null, error: null };

    const response = await patchMeasure(
      jsonRequest("PATCH", { measureId: MEASURE_ID, label: "Renamed" }),
      routeContext
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("The performance measure was not saved");
    expect(mockAudit.error).toHaveBeenCalledWith("update_matched_no_rows", expect.any(Object));
  });
});

describe("DELETE", () => {
  it("removes a measure that belongs to this cycle", async () => {
    measureWrite = { data: { id: MEASURE_ID }, error: null };

    const response = await deleteMeasure(jsonRequest("DELETE", { measureId: MEASURE_ID }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(
      dbCalls.some((entry) => entry.table === "rtp_performance_measures" && entry.method === "delete")
    ).toBe(true);
  });

  it("does not report a removal that matched no rows as a success", async () => {
    measureWrite = { data: null, error: null };

    const response = await deleteMeasure(jsonRequest("DELETE", { measureId: MEASURE_ID }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("The performance measure was not saved");
    expect(mockAudit.error).toHaveBeenCalledWith("delete_matched_no_rows", expect.any(Object));
  });

  it("refuses a viewer", async () => {
    membershipRead = {
      data: [{ workspace_id: WORKSPACE_ID, role: "viewer", workspaces: { name: "Agency", created_at: "2026-01-01" } }],
      error: null,
    };

    const response = await deleteMeasure(jsonRequest("DELETE", { measureId: MEASURE_ID }), routeContext);

    expect(response.status).toBe(403);
    expect(wroteAnything()).toBe(false);
  });
});

/**
 * WHY THIS BLOCK EXISTS, and what it caught.
 *
 * A mocked Supabase client hands back its fixture whatever was asked for, so
 * every assertion above stays green when a `.select()` is deleted — the defect
 * class CLAUDE.md names ("a mocked Supabase client cannot catch a missing
 * projection; assert on the projection string itself").
 *
 * Proven by mutation, not assumed: deleting `.select("id")` from the DELETE
 * chain left all 32 tests above passing. In production that is not cosmetic.
 * Without a representation to return, PostgREST answers `.maybeSingle()` with
 * `data: null, error: null` for a delete that SUCCEEDED, so
 * `writeMatchedNoRows` fires on every successful removal and the route reports
 * 500 "was not saved" while the row is gone. The planner retries a delete that
 * already happened, and the audit log fills with `delete_matched_no_rows` for
 * deletes that matched fine.
 *
 * So these assert on the CALL and its argument, which is the only part of a
 * projection a mock cannot fake.
 */
describe("the route asks the database for what it claims to return", () => {
  /** The `select` calls made after `method` on the measures table, in order. */
  function selectsAfter(method: string): string[] {
    const entries = dbCalls.filter((entry) => entry.table === "rtp_performance_measures");
    const anchor = entries.findIndex((entry) => entry.method === method);
    if (anchor === -1) return [];
    return entries
      .slice(anchor + 1)
      .filter((entry) => entry.method === "select")
      .map((entry) => String(entry.args[0] ?? ""));
  }

  /** Every column a client reads off the returned measure. */
  const RENDERED_COLUMNS = [
    "id",
    "measure_key",
    "label",
    "unit",
    "baseline_value",
    "baseline_year",
    "target_value",
    "target_year",
    "data_source",
    "notes",
    "sort_order",
  ];

  it("asks the DELETE to return the row it removed", async () => {
    measureWrite = { data: { id: MEASURE_ID }, error: null };

    await deleteMeasure(jsonRequest("DELETE", { measureId: MEASURE_ID }), routeContext);

    // Without this, a successful delete is indistinguishable from one that
    // matched nothing, and the route reports failure for both.
    expect(selectsAfter("delete").length).toBeGreaterThan(0);
  });

  it("asks the INSERT for every column it hands back", async () => {
    await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);

    const projection = selectsAfter("insert")[0];
    expect(projection).toBeDefined();
    for (const column of RENDERED_COLUMNS) {
      expect(projection).toContain(column);
    }
  });

  it("asks the UPDATE for every column it hands back", async () => {
    await patchMeasure(jsonRequest("PATCH", { measureId: MEASURE_ID, label: "Renamed" }), routeContext);

    const projection = selectsAfter("update")[0];
    expect(projection).toBeDefined();
    for (const column of RENDERED_COLUMNS) {
      expect(projection).toContain(column);
    }
  });
});

/**
 * THE SECOND HOLE THE `.eq` ARGUMENTS ARE THE ONLY DEFENCE AGAINST.
 *
 * Note 5 in the header closed this for the CYCLE read and stopped there. The
 * MEASURE lookup and the two writes had the same exposure and no assertion,
 * proven by mutation on 2026-08-05 during adversarial review:
 *
 *   - drop `.eq("rtp_cycle_id")` + `.eq("workspace_id")` from
 *     `loadMeasureInCycle`  => all 35 tests above passed;
 *   - drop them from the UPDATE chain as well, leaving both the lookup and the
 *     write filtered by `id` alone => all 35 still passed.
 *
 * A mock chain cannot enforce a filter, so nothing above could ever have
 * noticed. In production the second mutation is a live cross-plan write: a
 * planner posts the id of a measure belonging to ANOTHER RTP cycle in their own
 * workspace to this cycle's URL and edits or deletes it. RLS does not stop that
 * — both cycles are in a workspace they may write — so the cycle scoping in
 * this route is the ONLY thing standing between two plans. A measure in an
 * adopted plan gets a new baseline and the audit line names the wrong cycle.
 *
 * These assert on the arguments actually handed to `.eq`, split around the
 * write call so the lookup's scoping and the write's scoping are separately
 * defended rather than one covering for the other.
 */
describe("every read and write is pinned to THIS cycle and THIS workspace", () => {
  function measureEntries() {
    return dbCalls.filter((entry) => entry.table === "rtp_performance_measures");
  }

  /** `.eq` arguments used BEFORE the write — i.e. by the measure lookup. */
  function eqArgsBefore(method: string): unknown[][] {
    const entries = measureEntries();
    const anchor = entries.findIndex((entry) => entry.method === method);
    const scope = anchor === -1 ? entries : entries.slice(0, anchor);
    return scope.filter((entry) => entry.method === "eq").map((entry) => entry.args);
  }

  /** `.eq` arguments used AFTER the write call — i.e. by the write itself. */
  function eqArgsAfter(method: string): unknown[][] {
    const entries = measureEntries();
    const anchor = entries.findIndex((entry) => entry.method === method);
    if (anchor === -1) return [];
    return entries
      .slice(anchor + 1)
      .filter((entry) => entry.method === "eq")
      .map((entry) => entry.args);
  }

  const SCOPED_TO_CYCLE = ["rtp_cycle_id", CYCLE_ID];
  const SCOPED_TO_WORKSPACE = ["workspace_id", WORKSPACE_ID];

  it("looks the measure up inside this cycle and this workspace, not by id alone", async () => {
    await patchMeasure(jsonRequest("PATCH", { measureId: MEASURE_ID, label: "Renamed" }), routeContext);

    const lookup = eqArgsBefore("update");
    expect(lookup).toContainEqual(["id", MEASURE_ID]);
    expect(lookup).toContainEqual(SCOPED_TO_CYCLE);
    expect(lookup).toContainEqual(SCOPED_TO_WORKSPACE);
  });

  it("pins the UPDATE itself to this cycle and this workspace", async () => {
    await patchMeasure(jsonRequest("PATCH", { measureId: MEASURE_ID, label: "Renamed" }), routeContext);

    // Not redundant with the lookup: the lookup proves the route READ the right
    // row, and the write is a second statement that can be re-scoped by an
    // ordinary refactor without the read changing at all.
    const write = eqArgsAfter("update");
    expect(write).toContainEqual(["id", MEASURE_ID]);
    expect(write).toContainEqual(SCOPED_TO_CYCLE);
    expect(write).toContainEqual(SCOPED_TO_WORKSPACE);
  });

  it("pins the DELETE to this cycle and this workspace, before and at the write", async () => {
    measureWrite = { data: { id: MEASURE_ID }, error: null };

    await deleteMeasure(jsonRequest("DELETE", { measureId: MEASURE_ID }), routeContext);

    const lookup = eqArgsBefore("delete");
    expect(lookup).toContainEqual(SCOPED_TO_CYCLE);
    expect(lookup).toContainEqual(SCOPED_TO_WORKSPACE);

    const write = eqArgsAfter("delete");
    expect(write).toContainEqual(["id", MEASURE_ID]);
    expect(write).toContainEqual(SCOPED_TO_CYCLE);
    expect(write).toContainEqual(SCOPED_TO_WORKSPACE);
  });

  it("writes the workspace it resolved, even when the caller's active workspace is not the first membership", async () => {
    // The workspace_id written must come from the RESOLVED membership rather
    // than from any constant. With two memberships the fixture can no longer
    // agree with a hardcoded value by accident.
    membershipRead = {
      data: [
        { workspace_id: OTHER_WORKSPACE_ID, role: "admin", workspaces: { name: "Other", created_at: "2026-02-01" } },
      ],
      error: null,
    };
    cycleRead = { data: { id: CYCLE_ID, workspace_id: OTHER_WORKSPACE_ID }, error: null };

    await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);

    expect(insertedRow()!.workspace_id).toBe(OTHER_WORKSPACE_ID);
    const cycleEqs = dbCalls.filter((entry) => entry.table === "rtp_cycles" && entry.method === "eq");
    expect(cycleEqs).toContainEqual(expect.objectContaining({ args: ["workspace_id", OTHER_WORKSPACE_ID] }));
  });
});

describe("sort_order is NOT NULL, so a blank display order is a refusal rather than a null", () => {
  it("refuses an explicit null sort order instead of letting the column's NOT NULL raise a 500", async () => {
    const response = await postMeasure(jsonRequest("POST", { ...VALID_CREATE, sortOrder: null }), routeContext);

    expect(response.status).toBe(400);
    expect(wroteAnything()).toBe(false);
  });

  it("still defaults an ABSENT sort order to 0 — an ordering is not a measurement", async () => {
    await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);

    expect(insertedRow()!.sort_order).toBe(0);
  });
});

describe("the route audits itself", () => {
  it("names all three handlers to the audit log", async () => {
    await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);
    expect(createApiAuditLoggerMock).toHaveBeenCalledWith(
      "rtp_cycles.performance_measures.create",
      expect.anything()
    );

    await patchMeasure(jsonRequest("PATCH", { measureId: MEASURE_ID, label: "x" }), routeContext);
    expect(createApiAuditLoggerMock).toHaveBeenCalledWith(
      "rtp_cycles.performance_measures.update",
      expect.anything()
    );

    await deleteMeasure(jsonRequest("DELETE", { measureId: MEASURE_ID }), routeContext);
    expect(createApiAuditLoggerMock).toHaveBeenCalledWith(
      "rtp_cycles.performance_measures.delete",
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// A BASELINE TRANSCRIBED OUT OF AN ADOPTED PLAN.
//
// A baseline is a measurement of the world, and a model cannot measure. What
// makes a transcribed one legitimate is not that a model produced it but that
// the agency's own adopted document prints it on a page this row will cite,
// and that a person read the quote and accepted it. Everything the route
// refuses about a typed measure it refuses about a transcribed one — and the
// one this file is built around, the blank box that is not a zero, holds in
// both directions.
// ---------------------------------------------------------------------------

const CANDIDATE_ID = "77777777-7777-4777-8777-777777777777";
const FINANCIAL_CANDIDATE_ID = "88888888-8888-4888-8888-888888888888";

const PENDING_MEASURE_CANDIDATE = {
  id: CANDIDATE_ID,
  workspace_id: WORKSPACE_ID,
  rtp_cycle_id: CYCLE_ID,
  target_kind: "performance_measure",
  status: "pending",
  quote_verified: true,
};

/**
 * Every `.eq()` on the staging-table LOOKUP, in order — cut off at the flip.
 *
 * The flip is an `update` on the same table and carries its own `.eq()`s, so a
 * naive filter would concatenate two differently-shaped queries and the
 * scoping assertion would pass on the wrong three.
 */
function candidateLookupFilters(): unknown[][] {
  const flipAt = dbCalls.findIndex(
    (entry) => entry.table === "rtp_extraction_candidates" && entry.method === "update"
  );
  const beforeFlip = flipAt === -1 ? dbCalls : dbCalls.slice(0, flipAt);
  return beforeFlip
    .filter((entry) => entry.table === "rtp_extraction_candidates" && entry.method === "eq")
    .map((call) => call.args);
}

function candidateFlipValues(): Record<string, unknown> | null {
  const call = dbCalls.find((entry) => entry.table === "rtp_extraction_candidates" && entry.method === "update");
  return call ? (call.args[0] as Record<string, unknown>) : null;
}

describe("performance measures — accepting a transcription", () => {
  it("a hand-typed measure asks the staging table nothing", async () => {
    const response = await postMeasure(jsonRequest("POST", VALID_CREATE), routeContext);

    expect(response.status).toBe(201);
    expect(dbCalls.some((entry) => entry.table === "rtp_extraction_candidates")).toBe(false);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(insertedRow()).not.toHaveProperty("extraction_candidate_id");
  });

  it("records the page a transcribed baseline came from and marks the passage accepted", async () => {
    const response = await postMeasure(
      jsonRequest("POST", {
        ...VALID_CREATE,
        baselineValue: 12,
        baselineYear: 2024,
        fromExtractionCandidateId: CANDIDATE_ID,
      }),
      routeContext
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(insertedRow()!.extraction_candidate_id).toBe(CANDIDATE_ID);
    expect(insertedRow()!.baseline_value).toBe(12);
    expect(candidateLookupFilters()).toEqual([
      ["id", CANDIDATE_ID],
      ["rtp_cycle_id", CYCLE_ID],
      ["workspace_id", WORKSPACE_ID],
    ]);
    expect(candidateFlipValues()).toMatchObject({
      status: "accepted",
      accepted_row_id: MEASURE_ID,
      reviewed_by: USER_ID,
    });
    expect(body.extractionCandidate).toEqual({ id: CANDIDATE_ID, recorded: true });
  });

  it("a blank baseline is STILL not a zero when the value was transcribed", async () => {
    /**
     * The measure the plan prints with a target and no stated baseline. The
     * transcribed path must land NULL, exactly as the typed path does — a
     * transcription that quietly wrote 0 would have the agency assert a
     * measurement its own document does not contain.
     */
    const response = await postMeasure(
      jsonRequest("POST", {
        ...VALID_CREATE,
        baselineValue: "",
        targetValue: 0,
        fromExtractionCandidateId: CANDIDATE_ID,
      }),
      routeContext
    );

    expect(response.status).toBe(201);
    expect(insertedRow()!.baseline_value).toBeNull();
    expect(insertedRow()!.target_value).toBe(0);
  });

  it("refuses a passage staged as a financial line, and writes nothing", async () => {
    candidateRead = {
      data: { ...PENDING_MEASURE_CANDIDATE, id: FINANCIAL_CANDIDATE_ID, target_kind: "financial_line" },
      error: null,
    };

    const response = await postMeasure(
      jsonRequest("POST", { ...VALID_CREATE, fromExtractionCandidateId: FINANCIAL_CANDIDATE_ID }),
      routeContext
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("That transcription belongs somewhere else in the plan");
    expect(wroteAnything()).toBe(false);
  });

  it("refuses a passage a colleague already accepted", async () => {
    candidateRead = { data: { ...PENDING_MEASURE_CANDIDATE, status: "accepted" }, error: null };

    const response = await postMeasure(
      jsonRequest("POST", { ...VALID_CREATE, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext
    );

    expect(response.status).toBe(409);
    expect(wroteAnything()).toBe(false);
  });

  it("a failed staging-table read is not an empty one", async () => {
    candidateRead = { data: null, error: { message: "connection terminated unexpectedly" } };

    const response = await postMeasure(
      jsonRequest("POST", { ...VALID_CREATE, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext
    );

    expect(response.status).toBe(500);
    expect(wroteAnything()).toBe(false);
  });

  it("the same bad payload is refused whether or not it names a transcription", async () => {
    const CASES: Array<{ name: string; payload: Record<string, unknown> }> = [
      { name: "a baseline that is not a number", payload: { ...VALID_CREATE, baselineValue: "about twelve" } },
      { name: "a baseline year before 1900", payload: { ...VALID_CREATE, baselineYear: 1492 } },
      { name: "an empty measure key", payload: { ...VALID_CREATE, measureKey: "  " } },
      { name: "a body naming its own workspace", payload: { ...VALID_CREATE, workspaceId: OTHER_WORKSPACE_ID } },
    ];

    for (const testCase of CASES) {
      dbCalls.length = 0;
      const typed = await postMeasure(jsonRequest("POST", testCase.payload), routeContext);
      const typedBody = await typed.json();
      const typedWrote = wroteAnything();

      dbCalls.length = 0;
      const transcribed = await postMeasure(
        jsonRequest("POST", { ...testCase.payload, fromExtractionCandidateId: CANDIDATE_ID }),
        routeContext
      );
      const transcribedBody = await transcribed.json();

      expect(typed.status, testCase.name).toBe(400);
      expect(transcribed.status, testCase.name).toBe(typed.status);
      expect(transcribedBody.error, testCase.name).toBe(typedBody.error);
      expect(typedWrote, testCase.name).toBe(false);
      expect(wroteAnything(), testCase.name).toBe(false);
      // And the strict schema is what refuses the unknown key, so the resolver
      // never even ran.
      expect(dbCalls.some((entry) => entry.table === "rtp_extraction_candidates"), testCase.name).toBe(false);
    }
  });

  it("a PATCH naming only a transcription is still 'nothing to update'", async () => {
    const response = await patchMeasure(
      jsonRequest("PATCH", { measureId: MEASURE_ID, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid performance measure update payload");
    expect(wroteAnything()).toBe(false);
  });

  it("a PATCH that takes the document's baseline records where it came from", async () => {
    const response = await patchMeasure(
      jsonRequest("PATCH", { measureId: MEASURE_ID, baselineValue: 14, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext
    );

    expect(response.status).toBe(200);
    expect(updatedRow()).toMatchObject({ baseline_value: 14, extraction_candidate_id: CANDIDATE_ID });
    expect(candidateFlipValues()).toMatchObject({ status: "accepted", accepted_row_id: MEASURE_ID });
  });
});
