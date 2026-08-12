import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MEASURE_CLAIM_COLUMNS } from "@/lib/measures/claims";

/**
 * THE CLAIM ROUTES — eligibility, the two role gates, and the decision record.
 *
 * ============================================================================
 * WHAT IS MOCKED AND WHAT IS NOT
 * ============================================================================
 *
 * The Supabase client and the membership lookup are mocked; the AUTHORIZATION
 * LOGIC is not. `canAccessWorkspaceAction` runs for real against the real role
 * matrix, so the assertion that a member may submit a claim and may not approve
 * one is about the product's actual policy table rather than about a boolean
 * this file made up.
 *
 * Eligibility is not mocked either. `resolveMeasureClaimCategories` and
 * `checkMeasureClaimEligibility` run against a real parsed ordinance rule, so
 * the refusal below is the one a planner would get.
 *
 * WHAT A MOCKED CLIENT CANNOT PROVE, stated so nobody reads more into these
 * than they carry: it cannot catch a missing `.select()` column and it cannot
 * prove RLS. The projection is therefore asserted as a STRING against the
 * exported constant (`public-engagement-page.test.tsx`'s recorded lesson), and
 * the row-level rules live in `measure-claims-migration.test.ts`.
 */

const createClientMock = vi.fn();
const membershipMock = vi.fn();
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const MEASURE_ID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const PERIOD_ID = "11111111-1111-4111-8111-111111111111";
const RECIPIENT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const CLAIM_ID = "55555555-5555-4555-8555-555555555555";

/** A real ordinance rule — no category list is written anywhere in the code. */
const ORDINANCE_RULE = {
  version: 1,
  offTheTop: [{ id: "admin", label: "Administration", percent: 1 }],
  categories: [
    { id: "local_streets", label: "Local streets and roads", percentOfAllocable: 60, distribution: { kind: "pooled" } },
    { id: "transit", label: "Transit operations", percentOfAllocable: 40, distribution: { kind: "pooled" } },
  ],
  basisDefinitions: [],
};

type Scenario = {
  role: string;
  fund?: Record<string, unknown> | null;
  period?: Record<string, unknown> | null;
  recipient?: Record<string, unknown> | null;
  rules?: Array<Record<string, unknown>>;
  allocations?: Array<Record<string, unknown>>;
  claim?: Record<string, unknown> | null;
};

let scenario: Scenario;
let capturedSelects: string[] = [];
let capturedInserts: Array<Record<string, unknown>> = [];
let capturedUpdates: Array<Record<string, unknown>> = [];
/**
 * EVERY `.eq()` THE ROUTES APPLY, BY TABLE.
 *
 * RECORDED BECAUSE A MUTATION SURVIVED WITHOUT IT. The first version of this
 * fake ignored the filter arguments, so replacing
 * `.eq("workspace_id", membership.workspace_id)` with a duplicate `.eq("id", …)`
 * — deleting the tenant scope on the fund lookup — changed nothing and every
 * test stayed green. That is the recorded lesson from
 * `service-role-pages-have-no-rls-net`: the `.eq()` chain IS the access
 * control, and a fake that records nothing proves none of it.
 */
let capturedFilters: Array<{ table: string; column: string; value: unknown }> = [];

/** A terminal that answers both `.maybeSingle()`/`.single()` and a bare await. */
function terminal(data: unknown) {
  const result = { data, error: null };
  return {
    maybeSingle: async () => result,
    single: async () => result,
    then: (resolve: (value: unknown) => unknown) => resolve(result),
  };
}

function chain(table: string, data: unknown) {
  const node: Record<string, unknown> = { ...terminal(data) };
  node.eq = (column: string, value: unknown) => {
    capturedFilters.push({ table, column, value });
    return chain(table, data);
  };
  node.in = () => chain(table, data);
  node.order = () => chain(table, data);
  node.limit = () => chain(table, data);
  return node as ReturnType<typeof terminal> & { eq: (column: string, value: unknown) => unknown };
}

function filtersOn(table: string): Array<{ column: string; value: unknown }> {
  return capturedFilters.filter((filter) => filter.table === table).map(({ column, value }) => ({ column, value }));
}

const fromMock = vi.fn((table: string) => {
  const rowsFor = (): unknown => {
    switch (table) {
      case "measure_funds":
        return scenario.fund === undefined ? { id: MEASURE_ID, workspace_id: WORKSPACE_ID, program_id: "p", currency_code: "USD" } : scenario.fund;
      case "measure_fund_periods":
        return scenario.period === undefined
          ? { id: PERIOD_ID, period_start: "2026-01-01", fiscal_year_label: "FY26" }
          : scenario.period;
      case "measure_recipients":
        return scenario.recipient === undefined
          ? { id: RECIPIENT_ID, name: "Alder", is_active: true }
          : scenario.recipient;
      case "measure_allocation_rules":
        return scenario.rules ?? [{ id: "rule-1", rule: ORDINANCE_RULE, effective_from: "2025-01-01" }];
      case "measure_allocations":
        return scenario.allocations ?? [];
      case "measure_claims":
        return scenario.claim === undefined ? null : scenario.claim;
      default:
        throw new Error(`Unexpected table: ${table}`);
    }
  };

  return {
    select: (columns: string) => {
      capturedSelects.push(columns);
      return chain(table, rowsFor());
    },
    insert: (row: Record<string, unknown>) => {
      capturedInserts.push(row);
      return {
        select: (columns: string) => {
          capturedSelects.push(columns);
          return terminal({ id: CLAIM_ID, ...row });
        },
      };
    },
    update: (row: Record<string, unknown>) => {
      capturedUpdates.push(row);
      return {
        eq: (column: string, value: unknown) => (capturedFilters.push({ table, column, value }), {
          select: (columns: string) => {
            capturedSelects.push(columns);
            return terminal({ id: CLAIM_ID, ...row });
          },
        }),
      };
    },
    delete: () => ({
      eq: (column: string, value: unknown) => (capturedFilters.push({ table, column, value }), {
        select: () => terminal({ id: CLAIM_ID }),
      }),
    }),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));
vi.mock("@/lib/workspaces/current", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadCurrentWorkspaceMembership: async () => membershipMock(),
  };
});

import { POST as createClaim } from "@/app/api/measures/[measureId]/claims/route";
import { DELETE as deleteClaim, PATCH as patchClaim } from "@/app/api/measures/[measureId]/claims/[claimId]/route";

function claimsContext() {
  return { params: Promise.resolve({ measureId: MEASURE_ID }) };
}
function claimContext() {
  return { params: Promise.resolve({ measureId: MEASURE_ID, claimId: CLAIM_ID }) };
}
function post(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/measures/${MEASURE_ID}/claims`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
function patch(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/measures/${MEASURE_ID}/claims/${CLAIM_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const VALID_CLAIM = {
  recipientId: RECIPIENT_ID,
  periodId: PERIOD_ID,
  categoryId: "transit",
  amount: 12500.5,
  status: "submitted",
};

beforeEach(() => {
  vi.clearAllMocks();
  capturedSelects = [];
  capturedInserts = [];
  capturedUpdates = [];
  capturedFilters = [];
  scenario = { role: "member" };
  membershipMock.mockImplementation(() => ({
    membership: { workspace_id: WORKSPACE_ID, role: scenario.role, workspaces: null },
    workspace: null,
  }));
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: fromMock,
  });
});

describe("filing a claim", () => {
  it("accepts a category the ordinance declares", async () => {
    const response = await createClaim(post(VALID_CLAIM), claimsContext());
    expect(response.status).toBe(201);

    const payload = (await response.json()) as { categorySource: string };
    expect(payload.categorySource).toBe("ordinance_rule");
    expect(capturedInserts[0].category_id).toBe("transit");
    expect(capturedInserts[0].amount).toBe(12500.5);
  });

  /**
   * ELIGIBILITY IS THE MEASURE'S OWN ANSWER.
   *
   * `bike_paths` is a perfectly reasonable category for some other ordinance.
   * This one does not declare it, so the claim is refused — and the refusal
   * lists what the measure DOES declare, because "invalid category" alone sends
   * a clerk to read an ordinance PDF and guess at a spelling.
   */
  it("refuses a category the measure does not declare, and says what it does", async () => {
    const response = await createClaim(post({ ...VALID_CLAIM, categoryId: "bike_paths" }), claimsContext());
    expect(response.status).toBe(400);

    const payload = (await response.json()) as { error: string; reason: string; declaredCategoryIds: string[] };
    expect(payload.reason).toBe("category_not_in_measure");
    expect(payload.declaredCategoryIds).toEqual(["local_streets", "transit"]);
    expect(payload.error).toContain("local_streets");
    expect(capturedInserts).toHaveLength(0);
  });

  /**
   * THE RULE IN FORCE AT THE CLAIM'S OWN PERIOD, not the newest rule.
   *
   * An ordinance amended in July does not retroactively change what June's
   * money could be spent on. The measure here has a later rule version that
   * drops `transit`; the claim's period predates it, so `transit` is still
   * eligible. Getting this backwards would silently refuse valid historic
   * claims — or worse, accept invalid ones.
   */
  it("resolves the categories from the rule in force at the claim's period", async () => {
    scenario.rules = [
      { id: "rule-1", rule: ORDINANCE_RULE, effective_from: "2025-01-01" },
      {
        id: "rule-2",
        rule: {
          version: 1,
          categories: [{ id: "local_streets", label: "Local streets", percentOfAllocable: 100, distribution: { kind: "pooled" } }],
        },
        effective_from: "2026-07-01",
      },
    ];
    scenario.period = { id: PERIOD_ID, period_start: "2026-01-01", fiscal_year_label: "FY26" };

    const accepted = await createClaim(post(VALID_CLAIM), claimsContext());
    expect(accepted.status).toBe(201);

    // The same claim against a period AFTER the amendment is refused.
    capturedInserts = [];
    scenario.period = { id: PERIOD_ID, period_start: "2026-08-01", fiscal_year_label: "FY27" };
    const refused = await createClaim(post(VALID_CLAIM), claimsContext());
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { declaredCategoryIds: string[] }).declaredCategoryIds).toEqual([
      "local_streets",
    ]);
  });

  /**
   * THE FISCAL YEAR COMES FROM THE PERIOD, NEVER FROM THE BODY.
   *
   * A claim that named its own year could be bucketed against a year its period
   * does not belong to, and every annual total on the page would quietly
   * disagree with the receipt ledger.
   */
  it("takes the fiscal year from the period and ignores one supplied in the body", async () => {
    scenario.period = { id: PERIOD_ID, period_start: "2026-01-01", fiscal_year_label: "FY26" };
    const response = await createClaim(
      post({ ...VALID_CLAIM, fiscalYearLabel: "FY99", workspaceId: "some-other-workspace" }),
      claimsContext()
    );
    expect(response.status).toBe(201);
    expect(capturedInserts[0].fiscal_year_label).toBe("FY26");
    expect(capturedInserts[0].workspace_id).toBe(WORKSPACE_ID);
  });

  /**
   * A CREATE ENDPOINT THAT ACCEPTED `status: "paid"` WOULD BE A WAY TO PAY A
   * CLAIM WITH NO DECISION ON THE RECORD.
   *
   * Exactly the shape the agent refusal for this lane is written against, and
   * refused for a human caller too.
   */
  it("refuses to file a claim into a decided state", async () => {
    for (const status of ["approved", "paid", "denied", "under_review"]) {
      const response = await createClaim(post({ ...VALID_CLAIM, status }), claimsContext());
      expect(response.status, `status=${status} must not be settable at creation`).toBe(400);
    }
    expect(capturedInserts).toHaveLength(0);
  });

  it("refuses a retired recipient", async () => {
    scenario.recipient = { id: RECIPIENT_ID, name: "Birch", is_active: false };
    const response = await createClaim(post(VALID_CLAIM), claimsContext());
    expect(response.status).toBe(400);
    expect(((await response.json()) as { reason: string }).reason).toBe("recipient_inactive");
  });

  /**
   * A MEASURE THAT HAS DECLARED NOTHING REFUSES, rather than accepting
   * anything. Letting a claim invent its own category would make the whole
   * eligibility check decorative.
   */
  it("refuses when the measure has no categories at all", async () => {
    scenario.rules = [];
    scenario.allocations = [];
    const response = await createClaim(post(VALID_CLAIM), claimsContext());
    expect(response.status).toBe(409);
    expect(((await response.json()) as { reason: string }).reason).toBe("no_categories_recorded");
  });

  /**
   * AN ORDINANCE RECORDED AS NARRATIVE TEXT still has categories: the ones
   * somebody has actually allocated to by hand.
   */
  it("falls back to the hand-entered allocations for a narrative ordinance", async () => {
    scenario.rules = [
      { id: "rule-n", rule: { version: 1, kind: "narrative", text: "A formula this form cannot express." }, effective_from: "2025-01-01" },
    ];
    scenario.allocations = [{ category_id: "bridge_program" }, { category_id: "bridge_program" }];

    const refused = await createClaim(post(VALID_CLAIM), claimsContext());
    expect(refused.status).toBe(400);

    const accepted = await createClaim(post({ ...VALID_CLAIM, categoryId: "bridge_program" }), claimsContext());
    expect(accepted.status).toBe(201);
    expect(((await accepted.json()) as { categorySource: string }).categorySource).toBe("recorded_allocations");
  });

  /** A projection typo is a runtime error here; the string itself is the guard. */
  it("reads and writes back the full claim projection", () => {
    expect(MEASURE_CLAIM_COLUMNS).toContain("decided_by");
    expect(MEASURE_CLAIM_COLUMNS).toContain("paid_on");
    expect(MEASURE_CLAIM_COLUMNS).toContain("denial_reason");
  });
});

describe("deciding a claim", () => {
  beforeEach(() => {
    scenario.claim = {
      id: CLAIM_ID,
      status: "submitted",
      amount: "12500.50",
      recipient_id: RECIPIENT_ID,
      category_id: "transit",
      fiscal_year_label: "FY26",
      submitted_on: "2026-02-01",
    };
  });

  /**
   * THE MONEY GATE, ASSERTED AGAINST THE REAL ROLE MATRIX.
   *
   * A member runs the fund day to day and may submit or withdraw. Approving,
   * denying and paying commit public money and need owner or admin — the same
   * `invoices.write` authority the product already uses for the other
   * direction of this seam.
   */
  it("lets a member submit and withdraw, and refuses them the decisions", async () => {
    scenario.role = "member";

    scenario.claim = { ...scenario.claim, status: "draft", submitted_on: null };
    expect((await patchClaim(patch({ status: "submitted" }), claimContext())).status).toBe(200);

    scenario.claim = { ...scenario.claim, status: "submitted", submitted_on: "2026-02-01" };
    expect((await patchClaim(patch({ status: "withdrawn" }), claimContext())).status).toBe(200);

    for (const status of ["under_review", "approved", "denied"]) {
      const response = await patchClaim(
        patch(status === "denied" ? { status, denialReason: "Ineligible" } : { status }),
        claimContext()
      );
      expect(response.status, `a member must not be able to set ${status}`).toBe(403);
    }
  });

  it("lets an admin decide", async () => {
    scenario.role = "admin";
    const response = await patchClaim(patch({ status: "approved" }), claimContext());
    expect(response.status).toBe(200);
  });

  /**
   * THE DECISION AUTHOR COMES FROM THE SESSION, NEVER FROM THE BODY.
   *
   * A decision author a caller could name is not an author. The body below
   * tries to attribute the approval to somebody else and to backdate it; both
   * are ignored.
   */
  it("stamps the decider from the session and ignores one supplied in the body", async () => {
    scenario.role = "owner";
    const response = await patchClaim(
      patch({ status: "approved", decidedBy: OTHER_USER_ID, decided_by: OTHER_USER_ID, decidedAt: "2001-01-01T00:00:00Z" }),
      claimContext()
    );
    expect(response.status).toBe(200);

    const update = capturedUpdates[0];
    expect(update.decided_by).toBe(USER_ID);
    expect(update.decided_by).not.toBe(OTHER_USER_ID);
    expect(typeof update.decided_at).toBe("string");
    expect(update.decided_at).not.toBe("2001-01-01T00:00:00Z");
  });

  it("refuses a denial with no reason, and records the reason when given", async () => {
    scenario.role = "admin";

    const refused = await patchClaim(patch({ status: "denied" }), claimContext());
    expect(refused.status).toBe(400);
    expect(capturedUpdates).toHaveLength(0);

    const accepted = await patchClaim(
      patch({ status: "denied", denialReason: "The invoices fall outside the eligible period." }),
      claimContext()
    );
    expect(accepted.status).toBe(200);
    expect(capturedUpdates[0].denial_reason).toBe("The invoices fall outside the eligible period.");
  });

  /**
   * PAYING REQUIRES A DATE — the defect fix, enforced at the route as well as
   * in the database so the message names the field instead of the constraint.
   */
  it("refuses to mark a claim paid with no payment date", async () => {
    scenario.role = "admin";
    scenario.claim = { ...scenario.claim, status: "approved" };

    const refused = await patchClaim(patch({ status: "paid" }), claimContext());
    expect(refused.status).toBe(400);
    expect(capturedUpdates).toHaveLength(0);

    const accepted = await patchClaim(patch({ status: "paid", paidOn: "2026-04-01" }), claimContext());
    expect(accepted.status).toBe(200);
    expect(capturedUpdates[0].paid_on).toBe("2026-04-01");
  });

  /**
   * PAID AND DENIED ARE TERMINAL. Reversing either is a new record — a refund,
   * or a fresh claim — not an edit of this one.
   */
  it("refuses an illegal transition and names what is possible instead", async () => {
    scenario.role = "owner";
    scenario.claim = { ...scenario.claim, status: "paid", paid_on: "2026-04-01" };

    const response = await patchClaim(patch({ status: "approved" }), claimContext());
    expect(response.status).toBe(409);
    const payload = (await response.json()) as { allowedNextStatuses: string[]; details: string };
    expect(payload.allowedNextStatuses).toEqual([]);
    expect(payload.details).toContain("final");
    expect(capturedUpdates).toHaveLength(0);
  });

  /**
   * WHAT A PUBLIC BODY ASKED FOR IS PART OF THE RECORD.
   *
   * Editing a submitted claim's amount would let a reviewer quietly reshape the
   * request they are deciding on.
   */
  it("refuses to edit the amount of a claim that has left draft", async () => {
    scenario.role = "owner";
    const refused = await patchClaim(patch({ amount: 999 }), claimContext());
    expect(refused.status).toBe(409);
    expect(capturedUpdates).toHaveLength(0);

    scenario.claim = { ...scenario.claim, status: "draft", submitted_on: null };
    const accepted = await patchClaim(patch({ amount: 999 }), claimContext());
    expect(accepted.status).toBe(200);
    expect(capturedUpdates[0].amount).toBe(999);
  });

  it("deletes a draft and refuses to delete anything else", async () => {
    scenario.role = "member";

    scenario.claim = { ...scenario.claim, status: "draft", submitted_on: null };
    expect((await deleteClaim(new NextRequest(`http://localhost/x`, { method: "DELETE" }), claimContext())).status).toBe(200);

    for (const status of ["submitted", "approved", "paid", "denied", "withdrawn"]) {
      scenario.claim = { ...scenario.claim, status };
      const response = await deleteClaim(new NextRequest(`http://localhost/x`, { method: "DELETE" }), claimContext());
      expect(response.status, `a ${status} claim must not be deletable`).toBe(409);
    }
  });

  /** A measure in another workspace is NOT FOUND, never found-and-refused. */
  it("answers 404 for a measure outside the caller's workspace", async () => {
    scenario.role = "owner";
    scenario.fund = null;
    const response = await patchClaim(patch({ status: "approved" }), claimContext());
    expect(response.status).toBe(404);
  });

  /**
   * THE `.eq()` CHAIN IS THE ACCESS CONTROL, so it is asserted as data.
   *
   * A 404 for a fund the fake said was absent proves only that the route reads
   * `data === null`. What actually keeps one workspace's fund out of another's
   * hands is the WORKSPACE FILTER on the lookup, and a fake that ignores its
   * arguments cannot see whether that filter was sent — which is why the
   * "unscoped fund lookup" mutation survived the first draft of this file.
   *
   * The claim lookup is scoped to the FUND rather than the workspace on
   * purpose: the fund was already proven to sit in the caller's workspace, so
   * scoping the claim to it is the tighter of the two constraints.
   */
  it("scopes the fund lookup to the caller's workspace and the claim to that fund", async () => {
    scenario.role = "owner";
    const response = await patchClaim(patch({ status: "approved" }), claimContext());
    expect(response.status).toBe(200);

    expect(filtersOn("measure_funds")).toEqual([
      { column: "id", value: MEASURE_ID },
      { column: "workspace_id", value: WORKSPACE_ID },
    ]);
    expect(filtersOn("measure_claims")).toEqual([
      { column: "id", value: CLAIM_ID },
      { column: "measure_fund_id", value: MEASURE_ID },
      // The UPDATE itself, scoped to the row that was just verified.
      { column: "id", value: CLAIM_ID },
    ]);
  });

  it("scopes every lookup on the create path too", async () => {
    scenario.role = "member";
    scenario.claim = undefined;
    const response = await createClaim(post(VALID_CLAIM), claimsContext());
    expect(response.status).toBe(201);

    expect(filtersOn("measure_funds")).toEqual([
      { column: "id", value: MEASURE_ID },
      { column: "workspace_id", value: WORKSPACE_ID },
    ]);
    // The period and the recipient are scoped to the FUND, so one workspace's
    // measure cannot borrow another measure's period or payee.
    expect(filtersOn("measure_fund_periods")).toEqual([
      { column: "id", value: PERIOD_ID },
      { column: "measure_fund_id", value: MEASURE_ID },
    ]);
    expect(filtersOn("measure_recipients")).toEqual([
      { column: "id", value: RECIPIENT_ID },
      { column: "measure_fund_id", value: MEASURE_ID },
    ]);
    expect(filtersOn("measure_allocation_rules")).toEqual([{ column: "measure_fund_id", value: MEASURE_ID }]);
  });

  it("refuses an unauthenticated caller before reading anything", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: fromMock,
    });
    const response = await patchClaim(patch({ status: "approved" }), claimContext());
    expect(response.status).toBe(401);
    expect(capturedUpdates).toHaveLength(0);
  });
});
