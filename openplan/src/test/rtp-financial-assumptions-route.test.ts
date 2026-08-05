import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * THE FINANCIAL LEDGER OF AN RTP CYCLE, AND THE ONE MISTAKE THAT WOULD BE
 * INVISIBLE AFTERWARDS.
 *
 * `rtp_financial_assumptions.horizon_band_id` has a foreign key. A foreign key
 * asks "does this band exist"; it cannot ask "does it belong to the plan cycle
 * this money is being recorded against". An agency running two RTP cycles in
 * one workspace has bands in both, so a stale band id — a form left open on the
 * other plan, a copied request, a future agent — satisfies the foreign key
 * perfectly and attributes revenue to the wrong plan's wrong period. Both
 * plans' fiscal-constraint figures are then wrong, on the one number a funder
 * verifies, with nothing in either row to show it.
 *
 * WHY THIS HARNESS MODELS FILTERS INSTEAD OF RETURNING FIXTURES.
 * A mock that hands back its fixture whatever was asked cannot tell "the route
 * scoped the query" from "the route asked for anything and got lucky" — the
 * defect class this repo has already paid for. So the fake below keeps rows in
 * tables and APPLIES the recorded `.eq()` filters to them. Delete
 * `.eq("rtp_cycle_id", …)` from the band lookup and the cross-cycle band starts
 * matching, the insert happens, and the assertions below fail. That is the only
 * shape in which they prove anything.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

/** The plan the planner is looking at. */
const CYCLE_ID = "44444444-4444-4444-8444-444444444444";
/** The SAME agency's other plan — the cross-cycle hazard, same workspace. */
const OTHER_CYCLE_ID = "55555555-5555-4555-8555-555555555555";
/** Another agency's plan entirely. */
const FOREIGN_CYCLE_ID = "66666666-6666-4666-8666-666666666666";

const BAND_ID = "77777777-7777-4777-8777-777777777777";
/** A real band, in this workspace, belonging to the OTHER cycle. */
const OTHER_CYCLE_BAND_ID = "88888888-8888-4888-8888-888888888888";
/** A real band in another workspace's plan. */
const FOREIGN_BAND_ID = "99999999-9999-4999-8999-999999999999";
/**
 * A row that should not exist: it names THIS cycle but another workspace.
 * Nothing in the product can create one, which is why it is here — it is the
 * only shape in which the band lookup's `workspace_id` filter is more than
 * decoration, and a filter nothing can fail is a filter nobody will notice
 * losing.
 */
const MISMATCHED_BAND_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const ASSUMPTION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
/** A ledger line belonging to the other cycle. */
const OTHER_CYCLE_ASSUMPTION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const NOW = "2026-08-05T00:00:00.000Z";
const INSERTED_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), requestId: "test" };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import {
  DELETE as deleteAssumption,
  PATCH as patchAssumption,
  POST as postAssumption,
} from "@/app/api/rtp-cycles/[rtpCycleId]/financial-assumptions/route";

// ---------------------------------------------------------------------------
// A tiny in-memory PostgREST: rows in tables, and `.eq()` filters that filter.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type QueryError = { message: string; code?: string } | null;
type Filter = { column: string; value: unknown };
type Operation = "select" | "insert" | "update" | "delete";

let tables: Record<string, Row[]> = {};
let tableFailures: Record<string, QueryError> = {};
let queries: Array<{ table: string; operation: Operation; filters: Filter[] }> = [];
let writes: Array<{ table: string; operation: Operation; values: Row | null; filters: Filter[] }> = [];

const PASSTHROUGH_METHODS = ["order", "limit", "in", "is", "not", "range", "filter", "match"];

function makeChain(table: string) {
  const filters: Filter[] = [];
  let operation: Operation = "select";
  let payload: Row | null = null;
  let memo: { data: Row[]; error: QueryError } | null = null;

  const rowsOf = () => (tables[table] ??= []);

  function run(): { data: Row[]; error: QueryError } {
    if (memo) return memo;
    queries.push({ table, operation, filters: [...filters] });

    const failure = tableFailures[table];
    if (failure) {
      memo = { data: [], error: failure };
      return memo;
    }

    if (operation === "insert") {
      const inserted: Row = { id: INSERTED_ID, created_at: NOW, updated_at: NOW, ...(payload ?? {}) };
      rowsOf().push(inserted);
      writes.push({ table, operation, values: { ...(payload ?? {}) }, filters: [...filters] });
      memo = { data: [inserted], error: null };
      return memo;
    }

    const matched = rowsOf().filter((row) => filters.every((f) => row[f.column] === f.value));

    if (operation === "update") {
      writes.push({ table, operation, values: { ...(payload ?? {}) }, filters: [...filters] });
      for (const row of matched) Object.assign(row, payload ?? {});
      memo = { data: matched, error: null };
      return memo;
    }

    if (operation === "delete") {
      writes.push({ table, operation, values: null, filters: [...filters] });
      const removed = [...matched];
      tables[table] = rowsOf().filter((row) => !removed.includes(row));
      memo = { data: removed, error: null };
      return memo;
    }

    memo = { data: matched, error: null };
    return memo;
  }

  const chain: Record<string, unknown> = {};

  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((column: string, value: unknown) => {
    filters.push({ column, value });
    return chain;
  });
  chain.insert = vi.fn((values: Row) => {
    operation = "insert";
    payload = values;
    return chain;
  });
  chain.update = vi.fn((values: Row) => {
    operation = "update";
    payload = values;
    return chain;
  });
  chain.delete = vi.fn(() => {
    operation = "delete";
    return chain;
  });
  for (const method of PASSTHROUGH_METHODS) {
    chain[method] = vi.fn(() => chain);
  }

  chain.maybeSingle = vi.fn(async () => {
    const result = run();
    if (result.error) return { data: null, error: result.error };
    return { data: result.data[0] ?? null, error: null };
  });
  chain.single = vi.fn(async () => {
    const result = run();
    if (result.error) return { data: null, error: result.error };
    if (result.data.length === 0) {
      return { data: null, error: { code: "PGRST116", message: "no rows returned" } };
    }
    return { data: result.data[0], error: null };
  });
  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(run()).then(onFulfilled, onRejected);

  return chain;
}

function installClient() {
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => makeChain(table)),
  });
}

function seed(role = "admin") {
  tables = {
    workspace_members: [
      {
        user_id: USER_ID,
        workspace_id: WORKSPACE_ID,
        role,
        workspaces: { name: "Regional Agency", created_at: "2026-01-01T00:00:00.000Z" },
      },
    ],
    rtp_cycles: [
      { id: CYCLE_ID, workspace_id: WORKSPACE_ID },
      { id: OTHER_CYCLE_ID, workspace_id: WORKSPACE_ID },
      { id: FOREIGN_CYCLE_ID, workspace_id: OTHER_WORKSPACE_ID },
    ],
    rtp_horizon_bands: [
      { id: BAND_ID, rtp_cycle_id: CYCLE_ID, workspace_id: WORKSPACE_ID, label: "First ten years" },
      {
        id: OTHER_CYCLE_BAND_ID,
        rtp_cycle_id: OTHER_CYCLE_ID,
        workspace_id: WORKSPACE_ID,
        label: "2035–2050",
      },
      {
        id: FOREIGN_BAND_ID,
        rtp_cycle_id: FOREIGN_CYCLE_ID,
        workspace_id: OTHER_WORKSPACE_ID,
        label: "Phase 2",
      },
      {
        id: MISMATCHED_BAND_ID,
        rtp_cycle_id: CYCLE_ID,
        workspace_id: OTHER_WORKSPACE_ID,
        label: "Impossible band",
      },
    ],
    rtp_financial_assumptions: [
      {
        id: ASSUMPTION_ID,
        workspace_id: WORKSPACE_ID,
        rtp_cycle_id: CYCLE_ID,
        horizon_band_id: BAND_ID,
        entry_kind: "revenue",
        source_name: "Local sales tax measure",
        amount: 1000,
        amount_basis_year: 2026,
        notes: null,
        created_at: NOW,
        updated_at: NOW,
      },
      {
        id: OTHER_CYCLE_ASSUMPTION_ID,
        workspace_id: WORKSPACE_ID,
        rtp_cycle_id: OTHER_CYCLE_ID,
        horizon_band_id: OTHER_CYCLE_BAND_ID,
        entry_kind: "revenue",
        source_name: "The other plan's money",
        amount: 5000,
        amount_basis_year: 2026,
        notes: null,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
  };
}

function request(method: "POST" | "PATCH" | "DELETE", body: unknown, cycleId = CYCLE_ID) {
  return new NextRequest(`http://localhost/api/rtp-cycles/${cycleId}/financial-assumptions`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext(cycleId = CYCLE_ID) {
  return { params: Promise.resolve({ rtpCycleId: cycleId }) };
}

const ledgerWrites = (operation: Operation) =>
  writes.filter((write) => write.table === "rtp_financial_assumptions" && write.operation === operation);

/**
 * The columns one write actually sent, narrowed away from `values: Row | null`.
 *
 * A DELETE records no values, so the union is honest and worth keeping. Throwing
 * here rather than reaching through an optional chain is deliberate: `?.amount`
 * on a write that never happened yields `undefined`, and `expect(undefined).toBeNull()`
 * fails for the right reason only by luck — while `expect(undefined).not.toBe(0)`
 * would pass a route that wrote nothing at all.
 */
function writtenValues(operation: Operation, index = 0): Row {
  const write = ledgerWrites(operation)[index];
  if (!write || !write.values) {
    throw new Error(`expected a ${operation} on rtp_financial_assumptions carrying values`);
  }
  return write.values;
}

const validLine = {
  horizonBandId: BAND_ID,
  entryKind: "revenue",
  sourceName: "Federal STBG apportionment",
  amount: 1_200_000,
  amountBasisYear: 2026,
};

beforeEach(() => {
  vi.clearAllMocks();
  queries = [];
  writes = [];
  tableFailures = {};
  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  seed();
  installClient();
});

describe("POST /api/rtp-cycles/[rtpCycleId]/financial-assumptions — cross-cycle attribution", () => {
  it("REFUSES a horizon band that belongs to a DIFFERENT cycle in the same workspace", async () => {
    // The band exists, the workspace is right, and the foreign key would be
    // perfectly satisfied. Only the cycle is wrong — which is exactly the
    // mistake nothing downstream could detect.
    const response = await postAssumption(
      request("POST", { ...validLine, horizonBandId: OTHER_CYCLE_BAND_ID }),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("That period is not part of this plan");
    expect(body.details).toContain("different plan cycle");

    // Nothing was written. Not a partial row, not a row with a corrected band.
    expect(ledgerWrites("insert")).toEqual([]);
    expect(tables.rtp_financial_assumptions).toHaveLength(2);

    expect(mockAudit.warn).toHaveBeenCalledWith(
      "horizon_band_not_in_cycle",
      expect.objectContaining({ rtpCycleId: CYCLE_ID, horizonBandId: OTHER_CYCLE_BAND_ID }),
    );
  });

  it("refuses a horizon band from another workspace's plan", async () => {
    const response = await postAssumption(
      request("POST", { ...validLine, horizonBandId: FOREIGN_BAND_ID }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(ledgerWrites("insert")).toEqual([]);
  });

  it("refuses a band that names this cycle but another workspace", async () => {
    // Defence in depth, and the only test that can fail if the band lookup's
    // `workspace_id` filter is dropped — the cycle filter alone catches every
    // band the product can actually produce.
    const response = await postAssumption(
      request("POST", { ...validLine, horizonBandId: MISMATCHED_BAND_ID }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(ledgerWrites("insert")).toEqual([]);
  });

  it("does not report a FAILED band lookup as a band from the wrong cycle", async () => {
    // A read that failed reaches the same branch a read that found nothing
    // reaches. Telling a planner their period belongs to another plan — when
    // the database never answered — sends them looking for a data error that
    // does not exist.
    tableFailures.rtp_horizon_bands = { message: "permission denied for table rtp_horizon_bands", code: "42501" };

    const response = await postAssumption(request("POST", validLine), routeContext());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load the horizon band");
    expect(body.hint).toContain("read failure, not an empty result");
    expect(body.error).not.toBe("That period is not part of this plan");
    expect(ledgerWrites("insert")).toEqual([]);
  });

  it("answers 503 when the financial-plan schema has not been migrated yet", async () => {
    tableFailures.rtp_horizon_bands = {
      message: "Could not find the table 'public.rtp_horizon_bands' in the schema cache",
    };

    const response = await postAssumption(request("POST", validLine), routeContext());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("The RTP financial plan schema is not available yet");
    expect(body.hint).toContain("20260805000003");
    expect(ledgerWrites("insert")).toEqual([]);
  });

  it("records the line when the band really does belong to this cycle", async () => {
    const response = await postAssumption(request("POST", validLine), routeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assumption.horizon_band_id).toBe(BAND_ID);

    expect(writtenValues("insert")).toMatchObject({
      workspace_id: WORKSPACE_ID,
      rtp_cycle_id: CYCLE_ID,
      horizon_band_id: BAND_ID,
      entry_kind: "revenue",
      source_name: "Federal STBG apportionment",
      amount: 1_200_000,
      amount_basis_year: 2026,
      created_by: USER_ID,
    });
  });
});

describe("POST — what an amount may be", () => {
  it("refuses a negative amount with a sentence explaining why", async () => {
    const response = await postAssumption(request("POST", { ...validLine, amount: -250_000 }), routeContext());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid financial assumption payload");
    expect(body.details).toContain("zero or greater");
    expect(body.details).toContain("offsets a real line");
    expect(ledgerWrites("insert")).toEqual([]);
  });

  it("refuses an amount that is not a number rather than treating it as zero", async () => {
    for (const amount of ["", "1200000", null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      writes = [];
      const response = await postAssumption(request("POST", { ...validLine, amount }), routeContext());
      expect(response.status, `amount ${String(amount)}`).toBe(400);
      expect(ledgerWrites("insert"), `amount ${String(amount)}`).toEqual([]);
    }
  });

  it("refuses an amount larger than the ledger column can hold", async () => {
    const response = await postAssumption(
      request("POST", { ...validLine, amount: 1e15 }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(ledgerWrites("insert")).toEqual([]);
  });

  it("accepts zero, which is a figure an agency may deliberately record", async () => {
    const response = await postAssumption(request("POST", { ...validLine, amount: 0 }), routeContext());

    expect(response.status).toBe(200);
    expect(writtenValues("insert").amount).toBe(0);
  });

  it("stores an omitted or emptied basis year as NULL, never as a year of zero", async () => {
    for (const amountBasisYear of [undefined, null, ""]) {
      writes = [];
      const response = await postAssumption(
        request("POST", { ...validLine, amountBasisYear, notes: "" }),
        routeContext(),
      );

      expect(response.status, `basis year ${String(amountBasisYear)}`).toBe(200);
      const inserted = writtenValues("insert");
      expect(inserted.amount_basis_year, `basis year ${String(amountBasisYear)}`).toBeNull();
      expect(inserted.notes).toBeNull();
    }
  });
});

describe("POST — the entry kinds come from the fiscal engine's own union", () => {
  it("accepts every kind the constraint engine can account for", async () => {
    for (const entryKind of ["revenue", "operations_maintenance", "other_cost"]) {
      writes = [];
      const response = await postAssumption(request("POST", { ...validLine, entryKind }), routeContext());
      expect(response.status, entryKind).toBe(200);
      expect(writtenValues("insert").entry_kind).toBe(entryKind);
    }
  });

  it("refuses a kind the engine would silently drop from the constraint check", async () => {
    const response = await postAssumption(
      request("POST", { ...validLine, entryKind: "capital_cost" }),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.acceptedEntryKinds).toContain("operations_maintenance");
    expect(ledgerWrites("insert")).toEqual([]);
  });
});

describe("POST — who may write, and to which workspace's plan", () => {
  it("refuses an unauthenticated request", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await postAssumption(request("POST", validLine), routeContext());

    expect(response.status).toBe(401);
    expect(ledgerWrites("insert")).toEqual([]);
  });

  it("refuses a viewer, who may read a plan but not price it", async () => {
    seed("viewer");

    const response = await postAssumption(request("POST", validLine), routeContext());

    expect(response.status).toBe(403);
    expect(ledgerWrites("insert")).toEqual([]);
  });

  it("cannot reach a cycle in another workspace, and does not confirm it exists", async () => {
    const response = await postAssumption(
      request("POST", { ...validLine, horizonBandId: FOREIGN_BAND_ID }, FOREIGN_CYCLE_ID),
      routeContext(FOREIGN_CYCLE_ID),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("RTP cycle not found");
    expect(ledgerWrites("insert")).toEqual([]);
    // The band was never even looked up — the cycle gate came first.
    expect(queries.some((query) => query.table === "rtp_horizon_bands")).toBe(false);
  });

  it("does not answer 404 when the cycle lookup itself failed", async () => {
    tableFailures.rtp_cycles = { message: "permission denied for table rtp_cycles", code: "42501" };

    const response = await postAssumption(request("POST", validLine), routeContext());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load the RTP cycle");
    expect(ledgerWrites("insert")).toEqual([]);
  });

  it("rejects a malformed cycle id before it touches anything", async () => {
    const response = await postAssumption(request("POST", validLine, "not-a-uuid"), routeContext("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });
});

describe("PATCH — a line already in the ledger", () => {
  it("re-verifies the band when a line is MOVED to another period", async () => {
    // The same cross-cycle hazard, one edit later. A route that checked the
    // band only on create would let an existing line be walked into the other
    // plan's period.
    const response = await patchAssumption(
      request("PATCH", { assumptionId: ASSUMPTION_ID, horizonBandId: OTHER_CYCLE_BAND_ID }),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("That period is not part of this plan");
    expect(ledgerWrites("update")).toEqual([]);
    expect(tables.rtp_financial_assumptions[0].horizon_band_id).toBe(BAND_ID);
  });

  it("updates only the fields that were sent", async () => {
    const response = await patchAssumption(
      request("PATCH", { assumptionId: ASSUMPTION_ID, amount: 2_500_000, notes: "Board-adopted figure" }),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assumption.amount).toBe(2_500_000);

    expect(writtenValues("update")).toEqual({ amount: 2_500_000, notes: "Board-adopted figure" });
    // The source name and basis year were not sent, so they are untouched.
    expect(tables.rtp_financial_assumptions[0].source_name).toBe("Local sales tax measure");
    expect(tables.rtp_financial_assumptions[0].amount_basis_year).toBe(2026);
  });

  it("refuses a negative amount on an edit too", async () => {
    const response = await patchAssumption(
      request("PATCH", { assumptionId: ASSUMPTION_ID, amount: -1 }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(ledgerWrites("update")).toEqual([]);
    expect(tables.rtp_financial_assumptions[0].amount).toBe(1000);
  });

  it("refuses an edit that changes nothing", async () => {
    const response = await patchAssumption(request("PATCH", { assumptionId: ASSUMPTION_ID }), routeContext());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.details).toContain("No changes were requested");
    expect(ledgerWrites("update")).toEqual([]);
  });

  it("cannot edit a line that belongs to the OTHER cycle through this cycle's door", async () => {
    const response = await patchAssumption(
      request("PATCH", { assumptionId: OTHER_CYCLE_ASSUMPTION_ID, amount: 1 }),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Financial assumption not found");
    expect(ledgerWrites("update")).toEqual([]);
    expect(tables.rtp_financial_assumptions[1].amount).toBe(5000);
  });

  it("refuses a viewer", async () => {
    seed("viewer");

    const response = await patchAssumption(
      request("PATCH", { assumptionId: ASSUMPTION_ID, amount: 42 }),
      routeContext(),
    );

    expect(response.status).toBe(403);
    expect(ledgerWrites("update")).toEqual([]);
  });

  it("reports a write that matched no rows as unsaved rather than as saved", async () => {
    // The row was read through the caller's own client and the role check
    // passed, so zero matched rows is the database refusing an allowed write —
    // a missing permissive policy — not a missing record.
    const response = await patchAssumption(
      request("PATCH", { assumptionId: ASSUMPTION_ID, amount: 7 }),
      routeContext(),
    );
    expect(response.status).toBe(200);

    // Now make the update match nothing by deleting the row between read and
    // write, which is what a refused policy looks like from the outside.
    const original = tables.rtp_financial_assumptions[0];
    const patched = await (async () => {
      createClientMock.mockResolvedValue({
        auth: { getUser: authGetUserMock },
        from: vi.fn((table: string) => {
          const chain = makeChain(table);
          if (table === "rtp_financial_assumptions") {
            const update = chain.update as (values: Row) => unknown;
            chain.update = vi.fn((values: Row) => {
              tables.rtp_financial_assumptions = tables.rtp_financial_assumptions.filter(
                (row) => row !== original,
              );
              return update(values);
            });
          }
          return chain;
        }),
      });
      return patchAssumption(
        request("PATCH", { assumptionId: ASSUMPTION_ID, amount: 9 }),
        routeContext(),
      );
    })();
    const body = await patched.json();

    expect(patched.status).toBe(500);
    expect(body.error).toBe("The financial assumption was not saved");
    expect(body.details).toContain("row-level security policy");
  });
});

describe("DELETE — removing a line from the ledger", () => {
  it("removes a line that belongs to this cycle", async () => {
    const response = await deleteAssumption(request("DELETE", { assumptionId: ASSUMPTION_ID }), routeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(tables.rtp_financial_assumptions.map((row) => row.id)).toEqual([OTHER_CYCLE_ASSUMPTION_ID]);
  });

  it("cannot delete the OTHER cycle's line through this cycle's door", async () => {
    const response = await deleteAssumption(
      request("DELETE", { assumptionId: OTHER_CYCLE_ASSUMPTION_ID }),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Financial assumption not found");
    expect(ledgerWrites("delete")).toEqual([]);
    expect(tables.rtp_financial_assumptions).toHaveLength(2);
  });

  it("refuses a viewer", async () => {
    seed("viewer");

    const response = await deleteAssumption(request("DELETE", { assumptionId: ASSUMPTION_ID }), routeContext());

    expect(response.status).toBe(403);
    expect(ledgerWrites("delete")).toEqual([]);
    expect(tables.rtp_financial_assumptions).toHaveLength(2);
  });

  it("rejects a body with no assumption id", async () => {
    const response = await deleteAssumption(request("DELETE", {}), routeContext());

    expect(response.status).toBe(400);
    expect(ledgerWrites("delete")).toEqual([]);
  });
});

describe("the route audits itself", () => {
  it("names this route in the host log for each verb", async () => {
    await postAssumption(request("POST", validLine), routeContext());
    await patchAssumption(request("PATCH", { assumptionId: ASSUMPTION_ID, amount: 5 }), routeContext());
    await deleteAssumption(request("DELETE", { assumptionId: ASSUMPTION_ID }), routeContext());

    const names = createApiAuditLoggerMock.mock.calls.map((call) => call[0]);
    expect(names).toEqual([
      "rtp_cycles.financial_assumptions.create",
      "rtp_cycles.financial_assumptions.update",
      "rtp_cycles.financial_assumptions.delete",
    ]);
  });
});
