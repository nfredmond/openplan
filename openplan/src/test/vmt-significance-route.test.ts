import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The persisted determination route, tested for the three things that make
 * persistence safe rather than merely convenient:
 *
 *   1. THE JURISDICTION GATE. A workspace whose jurisdiction has no registered
 *      framework gets a refusal that names its reason — never a stored
 *      determination, and never a silent success.
 *   2. THE CLAIM FIREWALL. The VMT is read from the run's stored KPIs by name,
 *      so a request body cannot smuggle a number past the KPI namespaces that
 *      keep rate-based and uncalibrated figures out of a determination.
 *   3. THE RUN GATE. The model-run list hides the screen for a run that has not
 *      succeeded or came from an engine whose VMT may not carry a determination,
 *      but hiding a panel is not a gate — anyone with write access can call this
 *      route. The server enforces the same rule and records what it enforced on.
 */

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));

import { GET, POST } from "@/app/api/models/[modelId]/runs/[modelRunId]/vmt-significance/route";

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

const VALID_BODY = {
  referenceVmtPerCapita: 22,
  thresholdPct: 0.15,
  projectType: "residential" as const,
  referenceLabel: "regional" as const,
  inputBasis: "screening" as const,
};

type State = {
  role: string;
  runStatus: string | null;
  runEngineKey: string | null;
  runTitle: string | null;
  workspaceRow: Record<string, unknown> | null;
  workspaceError: { message: string } | null;
  kpis: Array<Record<string, unknown>>;
  kpiError: { message: string } | null;
  claimDecisions: Array<{ model_run_id: string | null; claim_status: string | null }>;
  claimDecisionsError: { message: string } | null;
  savedRows: Array<Record<string, unknown>>;
  savedError: { message: string } | null;
  insertError: { message: string; code?: string } | null;
};

let state: State;
let insertedRows: Array<Record<string, unknown>>;

/**
 * A thenable query builder: every chained filter returns itself, and awaiting it
 * resolves to the table's canned result. That mirrors supabase-js closely enough
 * for a route test without pinning the exact chain order.
 */
function builder(result: { data: unknown; error: unknown }, onInsert?: (row: unknown) => void) {
  const self: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    self[method] = () => self;
  }
  self.insert = (row: unknown) => {
    onInsert?.(row);
    return self;
  };
  self.maybeSingle = async () => result;
  self.single = async () => result;
  self.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) => resolve(result);
  return self;
}

function supabaseMock() {
  return {
    auth: { getUser: authGetUserMock },
    from: (table: string) => {
      switch (table) {
        case "models":
          return builder({ data: { id: MODEL_ID, workspace_id: WORKSPACE_ID }, error: null });
        case "workspace_members":
          return builder({ data: { workspace_id: WORKSPACE_ID, role: state.role }, error: null });
        case "model_runs":
          return builder({
            data: {
              id: MODEL_RUN_ID,
              model_id: MODEL_ID,
              run_title: state.runTitle,
              status: state.runStatus,
              engine_key: state.runEngineKey,
            },
            error: null,
          });
        case "workspaces":
          return builder({ data: state.workspaceRow, error: state.workspaceError });
        case "model_run_kpis":
          return builder({ data: state.kpis, error: state.kpiError });
        case "modeling_claim_decisions":
          return builder({ data: state.claimDecisions, error: state.claimDecisionsError });
        case "vmt_significance_screenings":
          return builder(
            state.insertError
              ? { data: null, error: state.insertError }
              : { data: state.savedRows[0] ?? null, error: state.savedError },
            (row) => insertedRows.push(row as Record<string, unknown>)
          );
        default:
          throw new Error(`Unexpected table: ${table}`);
      }
    },
  };
}

function routeContext(modelId = MODEL_ID, modelRunId = MODEL_RUN_ID) {
  return { params: Promise.resolve({ modelId, modelRunId }) };
}

function postRequest(payload: unknown) {
  return new NextRequest(
    `http://localhost/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/vmt-significance`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

function getRequest() {
  return new NextRequest(
    `http://localhost/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/vmt-significance`
  );
}

/** A workspace whose stated home geography is inside the shipped framework. */
const CALIFORNIA_WORKSPACE = {
  home_geography_source: "tigerweb",
  home_geography_kind: "county",
  home_geography_ref: "06000",
  home_geography_label: "A county",
  home_country_code: "US",
  home_subdivision_code: "CA",
};

const SCREENING_KPIS = [
  { kpi_name: "resident_vmt_per_capita", kpi_label: "Resident VMT per Capita", value: 25.7, unit: "", geometry_ref: null },
  { kpi_name: "population_total", kpi_label: "Population", value: 102322, unit: "", geometry_ref: null },
];

describe("/api/models/[modelId]/runs/[modelRunId]/vmt-significance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedRows = [];
    state = {
      role: "admin",
      runStatus: "succeeded",
      runEngineKey: "aequilibrae",
      runTitle: "Live worker run",
      workspaceRow: { ...CALIFORNIA_WORKSPACE },
      workspaceError: null,
      kpis: [...SCREENING_KPIS],
      kpiError: null,
      claimDecisions: [{ model_run_id: MODEL_RUN_ID, claim_status: "screening_grade" }],
      claimDecisionsError: null,
      savedRows: [],
      savedError: null,
      insertError: null,
    };
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    createClientMock.mockResolvedValue(supabaseMock());
  });

  it("requires an authenticated user", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    expect((await POST(postRequest(VALID_BODY), routeContext())).status).toBe(401);
  });

  it("answers 401, not 400, when an unauthenticated caller sends a malformed payload", async () => {
    // Validating before authenticating told a stranger that this route exists
    // and what shape it wants. Who you are is settled before what you sent is
    // examined — the order every neighbouring route uses.
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await POST(postRequest({ nonsense: true }), routeContext());
    expect(response.status).toBe(401);
    expect((await response.json()) as { issues?: unknown }).not.toHaveProperty("issues");
  });

  it("refuses to store a determination from a run that has not succeeded", async () => {
    // The panel is hidden for such a run; that is a rendering decision, and any
    // workspace writer can post here directly. A determination is permanent and
    // citable, so partial KPIs from a failed or in-flight run may not become one.
    for (const status of ["failed", "running", "queued", null]) {
      insertedRows = [];
      state.runStatus = status;

      const response = await POST(postRequest(VALID_BODY), routeContext());
      expect(response.status).toBe(409);

      const payload = (await response.json()) as { kind: string; reason: string; run_status: string | null };
      expect(payload.kind).toBe("run_not_succeeded");
      expect(payload.run_status).toBe(status);
      expect(payload.reason).toMatch(/succeeded/i);
      expect(insertedRows).toEqual([]);
    }
  });

  it("tells an ineligible engine apart from an unfinished run, because a planner acts differently on each", async () => {
    // Waiting fixes an unfinished run. Nothing fixes an engine whose VMT may not
    // carry a determination, so the two refusals must not be worded or coded alike.
    state.runEngineKey = "sketch_abm";

    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(422);

    const payload = (await response.json()) as { kind: string; reason: string; engine_key: string };
    expect(payload.kind).toBe("engine_not_supported");
    expect(payload.engine_key).toBe("sketch_abm");
    expect(payload.reason).toMatch(/will not change by re-running/i);
    expect(payload.reason).not.toMatch(/has not finished/i);
    expect(insertedRows).toEqual([]);
  });

  it("refuses a run whose engine was never recorded rather than assuming an eligible one", async () => {
    state.runEngineKey = null;

    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(422);
    const payload = (await response.json()) as { kind: string; reason: string };
    expect(payload.kind).toBe("engine_not_supported");
    expect(payload.reason).toMatch(/no engine is recorded/i);
    expect(insertedRows).toEqual([]);
  });

  it("keeps the run's status and engine on the stored row, so a later reader can audit it", async () => {
    await POST(postRequest(VALID_BODY), routeContext());

    const inputs = insertedRows[0].inputs_json as {
      subjectRun: { status: string; engineKey: string };
    };
    expect(inputs.subjectRun).toEqual({ status: "succeeded", engineKey: "aequilibrae" });
  });

  it("refuses a viewer, who may read everything and change nothing", async () => {
    state.role = "viewer";
    expect((await POST(postRequest(VALID_BODY), routeContext())).status).toBe(403);
    // …and still lets them read the saved history.
    expect((await GET(getRequest(), routeContext())).status).toBe(200);
  });

  it("stores the determination with its framework, jurisdiction, tier, and basis", async () => {
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(201);

    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0];
    // 25.7 against a cut line of 18.7 (22 × 0.85).
    expect(row.determination).toBe("potentially_significant");
    expect(row.vmt_per_capita).toBe(25.7);
    expect(row.threshold_vmt_per_capita).toBe(18.7);
    expect(row.framework_id).toBe("us_ca_ceqa_15064_3_v1");
    expect(row.jurisdiction_country).toBe("US");
    expect(row.jurisdiction_subdivision).toBe("CA");
    expect(row.jurisdiction_basis).toBe("workspace_home_geography");
    expect(row.claim_status).toBe("screening_grade");
    expect(row.claim_status_source).toBe("recorded_claim_decision");
    expect(row.input_basis).toBe("screening");
    expect(row.vmt_kpi_name).toBe("resident_vmt_per_capita");
    expect(row.workspace_id).toBe(WORKSPACE_ID);
    expect(row.model_run_id).toBe(MODEL_RUN_ID);
    expect(row.county_run_id).toBeNull();
    expect(row.created_by).toBe(USER_ID);
  });

  it("records 'not recorded' rather than a default tier when the run has no claim decision", async () => {
    state.claimDecisions = [];
    await POST(postRequest(VALID_BODY), routeContext());

    expect(insertedRows[0].claim_status).toBeNull();
    expect(insertedRows[0].claim_status_source).toBe("not_recorded");
  });

  it("refuses to store a determination when the claim-tier read fails, rather than calling it 'not recorded'", async () => {
    // `not_recorded` asserts that this run HAS NO claim decision. On a failed
    // query that is a false statement, and the table is append-only, so nothing
    // could ever correct it — a run recorded `prototype_only` would have its
    // warning quietly erased into something vaguer.
    state.claimDecisionsError = { message: "connection reset" };

    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(500);
    const payload = (await response.json()) as { details: string };
    expect(payload.details).toContain("connection reset");
    expect(payload.details).toMatch(/not recorded/i);
    expect(insertedRows).toEqual([]);
  });

  it("reports a failed claim-tier read to a reader instead of answering 'not recorded'", async () => {
    state.claimDecisionsError = { message: "connection reset" };

    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(500);
    expect((await response.json()) as { details: string }).toMatchObject({
      details: expect.stringContaining("connection reset"),
    });
  });

  it("takes the strongest recorded tier when a run carries several claim decisions", async () => {
    state.claimDecisions = [
      { model_run_id: MODEL_RUN_ID, claim_status: "prototype_only" },
      { model_run_id: MODEL_RUN_ID, claim_status: "calibrated_to_counts" },
      { model_run_id: MODEL_RUN_ID, claim_status: "not_a_tier" },
    ];

    await POST(postRequest(VALID_BODY), routeContext());
    expect(insertedRows[0].claim_status).toBe("calibrated_to_counts");
  });

  it("refuses to store a determination for a jurisdiction no framework covers, and says why", async () => {
    state.workspaceRow = { ...CALIFORNIA_WORKSPACE, home_subdivision_code: "OH", home_geography_label: "An Ohio county" };

    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(422);

    const payload = (await response.json()) as { reason: string };
    expect(payload.reason).toContain("An Ohio county");
    expect(payload.reason).toContain("US-OH");
    expect(payload.reason).toMatch(/will not issue a significance determination/i);
    expect(insertedRows).toEqual([]);
  });

  it("refuses when the workspace has not said where it works", async () => {
    state.workspaceRow = null;

    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(422);
    const payload = (await response.json()) as { reason: string };
    expect(payload.reason).toMatch(/has not stated where it works/i);
    expect(insertedRows).toEqual([]);
  });

  it("reports a failed geography read as a failure, not as an unknown jurisdiction", async () => {
    // A silent degrade here would send a planner to fix a home geography that is
    // already set, while the real fault was a database error.
    state.workspaceError = { message: "connection reset" };

    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(500);
    const payload = (await response.json()) as { details: string };
    expect(payload.details).toContain("connection reset");
    expect(insertedRows).toEqual([]);
  });

  it("reads VMT from the stored KPIs, so a body cannot supply one", async () => {
    const response = await POST(
      postRequest({ ...VALID_BODY, vmtPerCapita: 1, dailyVmt: 1 }),
      routeContext()
    );

    // The schema is strict: an unknown key is rejected outright rather than
    // ignored, so nobody can believe they supplied the VMT.
    expect(response.status).toBe(400);
    expect(insertedRows).toEqual([]);
  });

  it("refuses a run with no VMT-family KPI instead of estimating one", async () => {
    state.kpis = [
      { kpi_name: "total_trips", value: 628262, geometry_ref: null },
      // The ITE trip-generation lane's rate-based VMT, whose name is deliberately
      // outside every CEQA KPI namespace. It must not be consumed here.
      { kpi_name: "project_daily_vmt_screen", value: 99999, geometry_ref: null },
    ];

    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(422);
    const payload = (await response.json()) as { details: string };
    expect(payload.details).toMatch(/never estimates VMT/i);
    expect(insertedRows).toEqual([]);
  });

  it("refuses a calibrated basis on a run that stores no calibrated VMT", async () => {
    const response = await POST(
      postRequest({ ...VALID_BODY, inputBasis: "calibrated" }),
      routeContext()
    );

    expect(response.status).toBe(422);
    const payload = (await response.json()) as { details: string };
    expect(payload.details).toContain("resident_vmt_per_capita_calibrated");
    expect(insertedRows).toEqual([]);
  });

  it("stores a calibrated-basis determination from the calibrated KPI, marked as such", async () => {
    state.kpis = [
      ...SCREENING_KPIS,
      { kpi_name: "resident_vmt_per_capita_calibrated", value: 18, unit: "", geometry_ref: null },
    ];

    const response = await POST(
      postRequest({ ...VALID_BODY, inputBasis: "calibrated" }),
      routeContext()
    );

    expect(response.status).toBe(201);
    expect(insertedRows[0].input_basis).toBe("calibrated");
    expect(insertedRows[0].vmt_per_capita).toBe(18);
    expect(insertedRows[0].vmt_kpi_name).toBe("resident_vmt_per_capita_calibrated");
    // 18 is below the 18.7 cut line — a different determination from the
    // screening basis, which is exactly why the basis has to be stored.
    expect(insertedRows[0].determination).toBe("less_than_significant");
  });

  it("ignores a geometry-scoped calibrated slice, which is not the run total", async () => {
    state.kpis = [
      ...SCREENING_KPIS,
      { kpi_name: "resident_vmt_per_capita_calibrated", value: 18, geometry_ref: "corridor-1" },
    ];

    expect(
      (await POST(postRequest({ ...VALID_BODY, inputBasis: "calibrated" }), routeContext())).status
    ).toBe(422);
  });

  it("rejects a threshold expressed as a percent rather than a fraction", async () => {
    expect((await POST(postRequest({ ...VALID_BODY, thresholdPct: 15 }), routeContext())).status).toBe(
      400
    );
  });

  it("names the reason when a reference baseline rounds away to zero, instead of a generic save failure", async () => {
    // A stored determination keeps its reference to three decimal places, so
    // 0.0004 arrives at the table as 0 and trips the CHECK. That surfaced as
    // "Failed to save the determination" — a 500 naming nothing actionable.
    const response = await POST(
      postRequest({ ...VALID_BODY, referenceVmtPerCapita: 0.0004 }),
      routeContext()
    );

    expect(response.status).toBe(422);
    const payload = (await response.json()) as { error: string; details: string };
    expect(payload.error).not.toMatch(/failed to save/i);
    expect(payload.details).toMatch(/three decimal places/i);
    expect(payload.details).toContain("0.0004");
    expect(payload.details).toMatch(/nothing was saved/i);
    expect(insertedRows).toEqual([]);
  });

  it("screens a run whose title is blank rather than throwing on an empty scenario", async () => {
    // A whitespace-only run title trims to an empty scenario id, which the engine
    // drops — leaving no scenario and an unhandled throw from the row builder.
    state.runTitle = "   ";

    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(201);
    expect(insertedRows[0].scenario_id).toBe(MODEL_RUN_ID);
  });

  it("does not report a saved-but-unreadable determination as a failure", async () => {
    // The write landed; only the read-back did not. Answering 4xx/5xx here would
    // invite a retry that stores a second determination.
    state.savedRows = [];

    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { created: boolean; screening: unknown; details: string };
    expect(payload.created).toBe(true);
    expect(payload.screening).toBeNull();
    expect(payload.details).toMatch(/could not read it back/i);
    expect(payload.details).toMatch(/retrying would store a second determination/i);
  });

  it("returns the gate, the tier, and the saved history to a reader", async () => {
    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      framework: { kind: string; framework?: { frameworkId: string } };
      claimTier: { claimStatus: string | null; claimStatusSource: string };
    };
    expect(payload.framework.kind).toBe("covered");
    expect(payload.framework.framework?.frameworkId).toBe("us_ca_ceqa_15064_3_v1");
    expect(payload.claimTier).toEqual({
      claimStatus: "screening_grade",
      claimStatusSource: "recorded_claim_decision",
    });
  });

  it("hands an uncovered reader the refusal reason rather than an empty gate", async () => {
    state.workspaceRow = { ...CALIFORNIA_WORKSPACE, home_subdivision_code: "TX" };

    const payload = (await (await GET(getRequest(), routeContext())).json()) as {
      framework: { kind: string; reason: string };
    };
    expect(payload.framework.kind).toBe("not_covered");
    expect(payload.framework.reason).toContain("US-TX");
  });

  it("rejects a non-uuid run id", async () => {
    expect((await POST(postRequest(VALID_BODY), routeContext(MODEL_ID, "nope"))).status).toBe(400);
  });
});
