/**
 * Relaunching a run rebuilds the inputs it will be run with.
 *
 * THE DEFECT THESE PIN. `input_snapshot_json.zoneAttributes` is the pointer the
 * AequilibraE worker follows to a run's zone demographics, and it is a snapshot
 * of one read — taken with whatever Census key the workspace had at the original
 * launch. This route used to re-queue the row and leave that stamp untouched, so
 * a run stamped `{status: "unavailable", reason: "No US Census API key…"}`
 * re-read the same refusal every time. "Add a key under Settings → Integrations,
 * then relaunch" is the obvious recovery AND what the worker's own error text
 * says — and it could never succeed. An instruction the product gives a planner
 * that cannot work is a false statement, not a rough edge.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const prepareWorkerZoneAttributesMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadModelAccessMock = vi.fn();
const authGetUserMock = vi.fn();
const workspaceMaybeSingleMock = vi.fn();
const runMaybeSingleMock = vi.fn();
const runUpdateMock = vi.fn();
const stageSelectEqMock = vi.fn();
const stageUpdateMock = vi.fn();
const stageInsertMock = vi.fn();
const artifactDeleteEqMock = vi.fn();
const kpiDeleteEqMock = vi.fn();
const claimDecisionDeleteEqMock = vi.fn();
const validationResultDeleteEqMock = vi.fn();

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fromMock = vi.fn((table: string) => {
  if (table === "workspaces") {
    return {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock })) })),
    };
  }
  if (table === "model_runs") {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: runMaybeSingleMock })) })),
      })),
      // The re-queue now reads its own row count back — `.select().maybeSingle()`
      // is what lets a write that matched nothing be answered as its own
      // outcome instead of passing for success.
      update: (payload: Record<string, unknown>) => ({
        eq: (..._args: unknown[]) => ({
          select: (..._cols: unknown[]) => ({
            maybeSingle: () => runUpdateMock(payload),
          }),
        }),
      }),
    };
  }
  if (table === "model_run_stages") {
    return {
      select: vi.fn(() => ({ eq: stageSelectEqMock })),
      insert: (payload: unknown) => stageInsertMock(payload),
      update: (payload: Record<string, unknown>) => ({
        eq: (..._args: unknown[]) => stageUpdateMock(payload),
      }),
    };
  }
  if (table === "model_run_artifacts") {
    return { delete: vi.fn(() => ({ eq: artifactDeleteEqMock })) };
  }
  if (table === "model_run_kpis") {
    return { delete: vi.fn(() => ({ eq: kpiDeleteEqMock })) };
  }
  if (table === "modeling_claim_decisions") {
    return { delete: vi.fn(() => ({ eq: claimDecisionDeleteEqMock })) };
  }
  if (table === "modeling_validation_results") {
    return { delete: vi.fn(() => ({ eq: validationResultDeleteEqMock })) };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  // `withWorkspaceIntegrationContext` loads the workspace's decrypted keys with
  // this; the real one is exercised in its own suite.
  createServiceRoleClient: () => {
    throw new Error("no service-role key in this test");
  },
}));

vi.mock("@/lib/models/zone-attribute-payload", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    prepareWorkerZoneAttributes: (...args: unknown[]) => prepareWorkerZoneAttributesMock(...args),
  };
});

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/models/api", () => ({
  loadModelAccess: (...args: unknown[]) => loadModelAccessMock(...args),
}));

import { POST as relaunchRun } from "@/app/api/models/[modelId]/runs/[modelRunId]/launch/route";

function request() {
  return new NextRequest(
    `http://localhost/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/launch`,
    { method: "POST" },
  );
}

function routeContext() {
  return { params: Promise.resolve({ modelId: MODEL_ID, modelRunId: MODEL_RUN_ID }) };
}

/** Any place — no jurisdiction is baked into the route or this suite. */
const CORRIDOR = {
  type: "Polygon",
  coordinates: [
    [
      [-121.1, 39.2],
      [-121.0, 39.2],
      [-121.0, 39.3],
      [-121.1, 39.2],
    ],
  ],
};

const SUPPLIED_STAMP = {
  version: "zone-attributes-v1",
  status: "supplied",
  storageRef: `storage://run-artifacts/model-runs/${MODEL_RUN_ID}/zone-attributes.json`,
  sourceId: "us_census_acs5",
  sourceLabel: "American Community Survey 2023 5-year (US Census Bureau)",
  vintage: "2023",
  keyOrigin: "workspace",
  demographics: { status: "supplied", geographies: 42, reason: null },
  equity: { status: "supplied", level: "tract", geographies: 42, reason: null },
  reason: null,
  geographyIndexTruncated: false,
};

/** The stamp a run launched before the workspace had a Census key carries. */
const STALE_UNAVAILABLE_STAMP = {
  ...SUPPLIED_STAMP,
  status: "unavailable",
  storageRef: null,
  keyOrigin: "none",
  demographics: {
    status: "unavailable",
    geographies: 0,
    reason: "No US Census API key is available.",
  },
  equity: {
    status: "unavailable",
    level: null,
    geographies: 0,
    reason: "No US Census API key is available.",
  },
};

function requeuePayload(): Record<string, unknown> {
  return runUpdateMock.mock.calls[0][0] as Record<string, unknown>;
}

/** A relaunchable failed run, everything green. Shared by both suites below. */
function givenARelaunchableRun() {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: { user: { id: "44444444-4444-4444-8444-444444444444" } },
    });
    loadModelAccessMock.mockResolvedValue({
      model: { id: MODEL_ID, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      allowed: true,
      error: null,
    });
    workspaceMaybeSingleMock.mockResolvedValue({
      data: { plan: "pilot", subscription_plan: "pilot", subscription_status: "active" },
      error: null,
    });
    runMaybeSingleMock.mockResolvedValue({
      data: { id: MODEL_RUN_ID, status: "failed" },
      error: null,
    });
    runUpdateMock.mockResolvedValue({ data: { id: MODEL_RUN_ID }, error: null });
    prepareWorkerZoneAttributesMock.mockResolvedValue(SUPPLIED_STAMP);
    stageSelectEqMock.mockResolvedValue({ data: [{ id: "stage-1" }], error: null });
    stageUpdateMock.mockResolvedValue({ error: null });
    stageInsertMock.mockResolvedValue({ error: null });
    artifactDeleteEqMock.mockResolvedValue({ error: null });
    kpiDeleteEqMock.mockResolvedValue({ error: null });
    claimDecisionDeleteEqMock.mockResolvedValue({ error: null });
    validationResultDeleteEqMock.mockResolvedValue({ error: null });
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
}

describe("/api/models/[modelId]/runs/[modelRunId]/launch", () => {
  beforeEach(givenARelaunchableRun);

  it("requeues a failed run with a NOT NULL-safe reset payload", async () => {
    const res = await relaunchRun(request(), routeContext());

    expect(res.status).toBe(200);
    expect(runUpdateMock).toHaveBeenCalledTimes(1);
    const payload = runUpdateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe("queued");
    // model_runs.result_summary_json is NOT NULL DEFAULT '{}'::jsonb — a null
    // here 500s the relaunch (regression found in the first live worker e2e).
    expect(payload.result_summary_json).toEqual({});
    expect(payload.result_summary_json).not.toBeNull();
    // Existing stages get reset rather than re-inserted.
    expect(stageUpdateMock).toHaveBeenCalledTimes(1);
    expect((stageUpdateMock.mock.calls[0][0] as Record<string, unknown>).status).toBe("queued");
  });

  it("refuses to re-queue an in-process engine's run to the worker with 409", async () => {
    // A failed ite_trip_generation run has no corridor; re-queuing it would
    // hand it to the AequilibraE worker (which falls back to the pilot bbox)
    // and write assignment outputs under a trip-gen engine_key — an
    // engine/provenance mismatch. The route must refuse instead.
    runMaybeSingleMock.mockResolvedValue({
      data: { id: MODEL_RUN_ID, status: "failed", engine_key: "ite_trip_generation" },
      error: null,
    });
    const res = await relaunchRun(request(), routeContext());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("in-process"),
    });
    expect(runUpdateMock).not.toHaveBeenCalled();
    expect(kpiDeleteEqMock).not.toHaveBeenCalled();

    runMaybeSingleMock.mockResolvedValue({
      data: { id: MODEL_RUN_ID, status: "failed", engine_key: "sketch_abm" },
      error: null,
    });
    const sketchRes = await relaunchRun(request(), routeContext());
    expect(sketchRes.status).toBe(409);
  });

  it("re-queues a failed behavioral_demand preflight (async engine), resetting its stages", async () => {
    runMaybeSingleMock.mockResolvedValue({
      data: { id: MODEL_RUN_ID, status: "failed", engine_key: "behavioral_demand" },
      error: null,
    });
    const res = await relaunchRun(request(), routeContext());
    expect(res.status).toBe(200);
    expect(runUpdateMock).toHaveBeenCalledTimes(1);
    expect((runUpdateMock.mock.calls[0][0] as Record<string, unknown>).status).toBe("queued");
    // Existing stages are reset, not re-created.
    expect(stageUpdateMock).toHaveBeenCalledTimes(1);
    expect(stageInsertMock).not.toHaveBeenCalled();
  });

  it("creates behavioral preflight stages (not AequilibraE stages) when a behavioral run has none", async () => {
    runMaybeSingleMock.mockResolvedValue({
      data: { id: MODEL_RUN_ID, status: "failed", engine_key: "behavioral_demand" },
      error: null,
    });
    stageSelectEqMock.mockResolvedValue({ data: [], error: null }); // no existing stages
    const res = await relaunchRun(request(), routeContext());
    expect(res.status).toBe(200);
    expect(stageInsertMock).toHaveBeenCalledTimes(1);
    const stages = stageInsertMock.mock.calls[0][0] as Array<{ stage_name: string }>;
    expect(stages.map((s) => s.stage_name)).toEqual([
      "AequilibraE Setup",
      "Network Assignment",
      "Artifact Extraction",
      "ActivitySim Bundle & Preflight",
    ]);
  });

  it("refuses to relaunch a running or succeeded run", async () => {
    runMaybeSingleMock.mockResolvedValue({
      data: { id: MODEL_RUN_ID, status: "running" },
      error: null,
    });
    const res = await relaunchRun(request(), routeContext());
    expect(res.status).toBe(400);
    expect(runUpdateMock).not.toHaveBeenCalled();
  });

  it("deletes the run's claim-tier evidence alongside the KPIs it graded", async () => {
    // The worker writes modeling_claim_decisions / modeling_validation_results
    // MID-RUN (inside Artifact Extraction, before terminal status), so a run
    // that failed late already carries a tier — possibly calibrated_to_counts.
    // A relaunch that deleted the KPIs but kept those rows left a run that
    // could die early on its second attempt and permanently display a
    // calibrated badge over outputs this route destroyed. Neither
    // loadModelRunClaimStatuses nor the vmt-significance GET checks run status,
    // so the stale tier would render unchallenged.
    const res = await relaunchRun(request(), routeContext());

    expect(res.status).toBe(200);
    expect(claimDecisionDeleteEqMock).toHaveBeenCalledWith("model_run_id", MODEL_RUN_ID);
    expect(validationResultDeleteEqMock).toHaveBeenCalledWith("model_run_id", MODEL_RUN_ID);
  });

  it("refuses the relaunch when the claim-tier evidence cannot be deleted", async () => {
    // Proceeding would requeue a run still wearing its old grade — the exact
    // stale-tier display the delete exists to prevent.
    claimDecisionDeleteEqMock.mockResolvedValue({
      error: { message: "delete refused", code: "42501" },
    });

    const res = await relaunchRun(request(), routeContext());

    expect(res.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "model_run_cleanup_failed",
      expect.objectContaining({ claimDecisionDeleteCode: "42501" }),
    );
  });

  it("logs and 500s when the requeue update fails", async () => {
    runUpdateMock.mockResolvedValue({ data: null, error: { message: "boom", code: "23502" } });
    const res = await relaunchRun(request(), routeContext());
    expect(res.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "model_run_requeue_failed",
      expect.objectContaining({ code: "23502" }),
    );
  });

  it("answers a requeue that matched no rows as a policy gap, not a silent success", async () => {
    // The route already read this exact row through the caller's own client and
    // passed every membership check, so zero rows here is the database
    // disagreeing with the application. Reporting it as a success would leave a
    // run showing "queued" in the UI that no worker will ever claim.
    runUpdateMock.mockResolvedValue({ data: null, error: null });

    const res = await relaunchRun(request(), routeContext());

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; details: string };
    expect(body.error).toMatch(/model run was not saved/i);
    expect(body.details).toMatch(/row-level security/);
  });
});

describe("relaunching rebuilds the demographics the run will be built from", () => {
  beforeEach(() => {
    givenARelaunchableRun();
    runMaybeSingleMock.mockResolvedValue({
      data: {
        id: MODEL_RUN_ID,
        status: "failed",
        engine_key: "aequilibrae",
        corridor_geojson: CORRIDOR,
        input_snapshot_json: { modelId: MODEL_ID, zoneAttributes: STALE_UNAVAILABLE_STAMP },
      },
      error: null,
    });
  });

  it("replaces a stale 'no Census key' stamp instead of re-queueing it forever", async () => {
    // The workspace has since added its key, so the rebuild answers. Before
    // this, the run re-read the refusal above and failed identically however
    // many times a planner pressed relaunch.
    const res = await relaunchRun(request(), routeContext());

    expect(res.status).toBe(200);
    expect(prepareWorkerZoneAttributesMock).toHaveBeenCalledTimes(1);
    expect(prepareWorkerZoneAttributesMock.mock.calls[0][0]).toMatchObject({
      modelRunId: MODEL_RUN_ID,
      corridorGeojson: CORRIDOR,
      zoneGeography: "tract",
    });

    const snapshot = requeuePayload().input_snapshot_json as Record<string, unknown>;
    expect(snapshot.zoneAttributes).toEqual(SUPPLIED_STAMP);
    // Everything else the original launch recorded survives the rebuild.
    expect(snapshot.modelId).toBe(MODEL_ID);
    // And the caller is told the recovery worked, rather than finding out from
    // a worker failure minutes later.
    expect(await res.json()).toMatchObject({
      status: "queued",
      zoneAttributes: { status: "supplied", keyOrigin: "workspace" },
    });
  });

  it("rebuilds at the zone geography the run was originally built at", async () => {
    runMaybeSingleMock.mockResolvedValue({
      data: {
        id: MODEL_RUN_ID,
        status: "failed",
        engine_key: "aequilibrae",
        corridor_geojson: CORRIDOR,
        input_snapshot_json: { zoneGeography: "block_group" },
      },
      error: null,
    });

    await relaunchRun(request(), routeContext());

    // A relaunch may not quietly change the resolution — and the stamp is
    // written back so the worker's own resolve_zone_geography cannot resolve a
    // different one from its environment than the app just fetched at.
    expect(prepareWorkerZoneAttributesMock.mock.calls[0][0]).toMatchObject({
      zoneGeography: "block_group",
    });
    const snapshot = requeuePayload().input_snapshot_json as Record<string, unknown>;
    expect(snapshot.zoneGeography).toBe("block_group");
  });

  it("still queues the run, and says so, when the rebuild cannot read demographics", async () => {
    prepareWorkerZoneAttributesMock.mockResolvedValue(STALE_UNAVAILABLE_STAMP);

    const res = await relaunchRun(request(), routeContext());

    // The worker may still have a key of its own, so this is a degraded run
    // rather than a refused one — but the fresh reason is stamped and the
    // caller is told, instead of the run looking healthy until it dies.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      zoneAttributes: { status: "unavailable", reason: "No US Census API key is available." },
    });
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "zone_attribute_handoff_unavailable",
      expect.objectContaining({ status: "unavailable" }),
    );
  });

  it("does not invent a demographics stamp for a run with no study area", async () => {
    runMaybeSingleMock.mockResolvedValue({
      data: {
        id: MODEL_RUN_ID,
        status: "failed",
        engine_key: "aequilibrae",
        corridor_geojson: null,
        input_snapshot_json: { modelId: MODEL_ID },
      },
      error: null,
    });

    const res = await relaunchRun(request(), routeContext());

    // Nothing to resolve demographics FOR. The worker refuses this run by name
    // ("This run has no study area…"), which is the true reason; manufacturing
    // a second one here would only bury it.
    expect(res.status).toBe(200);
    expect(prepareWorkerZoneAttributesMock).not.toHaveBeenCalled();
    const snapshot = requeuePayload().input_snapshot_json as Record<string, unknown>;
    expect(snapshot).toEqual({ modelId: MODEL_ID });
    expect(await res.json()).toMatchObject({ zoneAttributes: null });
  });
});

/**
 * The relaunch button is the surface a planner reaches AFTER a run died for want
 * of a worker, so "requeued" alone is not an answer: it is the same word that
 * preceded the failure they are looking at. The route resolves the outlook
 * server-side, because the panel that renders it is handed a run and nothing
 * about the deployment — and the same outcome means different things depending
 * on whether a poller is declared.
 */
describe("relaunching says whether anything will execute the run this time", () => {
  beforeEach(givenARelaunchableRun);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("tells a deployment with no worker that the relaunch will not run either", async () => {
    vi.stubEnv("OPENPLAN_MODELING_WORKER", "absent");
    vi.stubEnv("OPENPLAN_MODELING_WORKER_URL", "");
    vi.stubEnv("OPENPLAN_MODELING_WORKER_TOKEN", "");

    const res = await relaunchRun(request(), routeContext());
    const body = (await res.json()) as {
      dispatch: { state: string };
      executionOutlook: { state: string; headline: string; detail: string };
    };

    expect(res.status).toBe(200);
    expect(body.dispatch).toEqual({ state: "not_configured" });
    expect(body.executionOutlook.state).toBe("unattended");
    expect(body.executionOutlook.headline).toMatch(/nothing on this openplan installation/i);
    // Free product: the way out is an operator running a worker, never a purchase.
    expect(`${body.executionOutlook.headline} ${body.executionOutlook.detail}`).not.toMatch(
      /upgrade|subscription|billing|pricing|paid tier|contact sales/i
    );
  });

  it("reads the deployment's own declaration rather than assuming it has none", async () => {
    // The failure this pins: resolving the outlook without the declaration (or
    // with a hardcoded "undeclared") makes the route tell a deployment that HAS
    // declared a poller that nothing declares one — a confident statement about
    // its configuration that is simply false.
    vi.stubEnv("OPENPLAN_MODELING_WORKER", "deployed");
    vi.stubEnv("OPENPLAN_MODELING_WORKER_URL", "");
    vi.stubEnv("OPENPLAN_MODELING_WORKER_TOKEN", "");

    const res = await relaunchRun(request(), routeContext());
    const body = (await res.json()) as { executionOutlook: { state: string; detail: string } };

    expect(body.executionOutlook.state).toBe("waiting_for_poller");
    expect(body.executionOutlook.detail).not.toMatch(/nothing declares/i);
  });
});
