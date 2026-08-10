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
const runFailureHistorySelectMock = vi.fn();
const runFailureHistoryUpdateMock = vi.fn();
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

const gtfsFeedMaybeSingleMock = vi.fn();
const gtfsVersionMaybeSingleMock = vi.fn();
let gtfsTablesRead: string[] = [];

const TRANSIT_FEED_ID = "55555555-5555-4555-8555-555555555555";
const TRANSIT_VERSION_ID = "66666666-6666-4666-8666-666666666666";

const fromMock = vi.fn((table: string) => {
  if (table === "workspaces") {
    return {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock })) })),
    };
  }
  if (table === "model_runs") {
    return {
      // Two distinct reads share this table: the main run load (two .eq's,
      // full projection) and the failure-history read, which asks for
      // `failure_count` alone precisely so a pre-migration deployment fails
      // only the history and never the relaunch.
      select: vi.fn((columns?: string) => {
        if (columns === "failure_count") {
          return { eq: vi.fn(() => ({ maybeSingle: runFailureHistorySelectMock })) };
        }
        return {
          eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: runMaybeSingleMock })) })),
        };
      }),
      // The re-queue now reads its own row count back — `.select().maybeSingle()`
      // is what lets a write that matched nothing be answered as its own
      // outcome instead of passing for success. The failure-history write is
      // the exception: it is deliberately tolerated, so it awaits the bare
      // update and is routed by its payload.
      update: (payload: Record<string, unknown>) => ({
        eq: (..._args: unknown[]) => ({
          select: (..._cols: unknown[]) => ({
            maybeSingle: () =>
              "failure_count" in payload
                ? runFailureHistoryUpdateMock(payload)
                : runUpdateMock(payload),
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
  // The transit-feed rebuild, which reads only when the STORED snapshot names a
  // feed. A run that named none never reaches these — which is itself asserted
  // below, because "resolved to nothing" and "never asked" are different facts.
  if (table === "gtfs_feeds" || table === "gtfs_feed_versions") {
    gtfsTablesRead.push(table);
    const chain: Record<string, unknown> = {
      eq: () => chain,
      maybeSingle: () => (table === "gtfs_feeds" ? gtfsFeedMaybeSingleMock() : gtfsVersionMaybeSingleMock()),
    };
    return { select: vi.fn(() => chain) };
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
      // `engine_key` is spelled out because the column is NOT NULL in the
      // schema, so a row without one is a row the database cannot produce —
      // and its DEFAULT is `deterministic_corridor_v1`, an in-process engine
      // this route now refuses. A fixture omitting it was describing an
      // aequilibrae run while carrying no evidence of being one.
      data: { id: MODEL_RUN_ID, status: "failed", engine_key: "aequilibrae" },
      error: null,
    });
    runUpdateMock.mockResolvedValue({ data: { id: MODEL_RUN_ID }, error: null });
    runFailureHistorySelectMock.mockResolvedValue({ data: { failure_count: 0 }, error: null });
    runFailureHistoryUpdateMock.mockResolvedValue({ data: { id: MODEL_RUN_ID }, error: null });
    prepareWorkerZoneAttributesMock.mockResolvedValue(SUPPLIED_STAMP);
    stageSelectEqMock.mockResolvedValue({ data: [{ id: "stage-1" }], error: null });
    stageUpdateMock.mockResolvedValue({ error: null });
    stageInsertMock.mockResolvedValue({ error: null });
    artifactDeleteEqMock.mockResolvedValue({ error: null });
    kpiDeleteEqMock.mockResolvedValue({ error: null });
    claimDecisionDeleteEqMock.mockResolvedValue({ error: null });
    validationResultDeleteEqMock.mockResolvedValue({ error: null });
    gtfsTablesRead = [];
    // A workspace feed with a healthy ingest in use. The default, so a test that
    // wants the refusal path has to ask for it.
    gtfsFeedMaybeSingleMock.mockResolvedValue({
      data: { id: TRANSIT_FEED_ID, workspace_id: WORKSPACE_ID, agency_name: "Example Transit" },
      error: null,
    });
    gtfsVersionMaybeSingleMock.mockResolvedValue({
      data: {
        id: TRANSIT_VERSION_ID,
        feed_id: TRANSIT_FEED_ID,
        workspace_id: WORKSPACE_ID,
        source_kind: "catalog",
        source_url: "https://example.org/gtfs.zip",
        // The archive was KEPT. `storage_path` — not the checksum — is what says
        // so: `ingest.ts` computes a checksum for all three doors before any
        // storage attempt, so a checksum proves nothing about whether an object
        // exists for the worker to read.
        storage_path: `${WORKSPACE_ID}/${TRANSIT_FEED_ID}/${TRANSIT_VERSION_ID}.zip`,
        checksum_sha256: "a".repeat(64),
        service_start_date: "2025-01-01",
        service_end_date: "2025-04-05",
        frequency_trip_count: 0,
        scheduled_trip_count: 480,
      },
      error: null,
    });
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

  it("preserves the failure history before wiping the failed run", async () => {
    /**
     * The requeue resets status, error_message and every stage IN PLACE, so
     * without this write a run failing for the third time is
     * indistinguishable from one failing for the first — and the failure
     * copy suggests "re-launch to retry" forever. The message captured is the
     * one `summarizeRunFailure` would have shown (run-level first, else the
     * causing stage's), via the same exported helper, so the "which message
     * counts" decision cannot fork.
     */
    runMaybeSingleMock.mockResolvedValue({
      data: {
        id: MODEL_RUN_ID,
        status: "failed",
        engine_key: "aequilibrae",
        error_message: "KeyError: 'households'",
      },
      error: null,
    });
    runFailureHistorySelectMock.mockResolvedValue({ data: { failure_count: 2 }, error: null });

    const res = await relaunchRun(request(), routeContext());

    expect(res.status).toBe(200);
    expect(runFailureHistoryUpdateMock).toHaveBeenCalledTimes(1);
    expect(runFailureHistoryUpdateMock).toHaveBeenCalledWith({
      failure_count: 3,
      last_failure_message: "KeyError: 'households'",
    });
    // The wipe payload must NOT touch the history columns it just wrote.
    const wipe = requeuePayload();
    expect(wipe).not.toHaveProperty("failure_count");
    expect(wipe).not.toHaveProperty("last_failure_message");
  });

  it("records no failure history when relaunching a cancelled run", async () => {
    // A cancelled run is not a failure. Counting it would make a planner who
    // cancelled twice read "failed 2 times" on a run that never failed.
    runMaybeSingleMock.mockResolvedValue({
      data: { id: MODEL_RUN_ID, status: "cancelled", engine_key: "aequilibrae" },
      error: null,
    });

    const res = await relaunchRun(request(), routeContext());

    expect(res.status).toBe(200);
    expect(runFailureHistoryUpdateMock).not.toHaveBeenCalled();
  });

  it("relaunches anyway, and audits, when the history columns do not exist yet", async () => {
    /**
     * The deploy window: app ships before migration 20260810000001. The
     * history read fails on the unknown column — and the RELAUNCH must
     * still work, because losing one increment of history is better than
     * refusing the recovery path. Audited, never silent.
     */
    runFailureHistorySelectMock.mockResolvedValue({
      data: null,
      error: { message: "column model_runs.failure_count does not exist", code: "42703" },
    });

    const res = await relaunchRun(request(), routeContext());

    expect(res.status).toBe(200);
    expect(runFailureHistoryUpdateMock).not.toHaveBeenCalled();
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "model_run_failure_history_unavailable",
      expect.objectContaining({ modelRunId: MODEL_RUN_ID })
    );
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

  it("refuses a deterministic run — the engine every legacy row defaulted to", async () => {
    /**
     * `model_runs.engine_key` is NOT NULL with DEFAULT
     * `deterministic_corridor_v1`, so every row that predates the column reads
     * as deterministic whatever engine actually produced it. The old denylist
     * named only sketch_abm and ite_trip_generation, so all of those were
     * relaunchable: the route would create AequilibraE stages, the worker
     * claims stages BY NAME with no engine filter, and assignment outputs would
     * land on a run labelled deterministic — the engine/provenance mismatch on
     * a claim-boundary surface that this route's own comment forbids.
     */
    runMaybeSingleMock.mockResolvedValue({
      data: { id: MODEL_RUN_ID, status: "failed", engine_key: "deterministic_corridor_v1" },
      error: null,
    });

    const res = await relaunchRun(request(), routeContext());

    expect(res.status).toBe(409);
    expect(runUpdateMock).not.toHaveBeenCalled();
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
    // The TRANSIT stamp is present even here, and deliberately so: a run with
    // no study area still records which feed was named for it (none), and the
    // handoff resolves that without needing geometry. Everything the ZONE
    // rebuild would have added — zoneGeography, zoneAttributes, relaunchedAt —
    // is still absent, which is what this test is about.
    expect(snapshot).toEqual({
      modelId: MODEL_ID,
      transitFeed: expect.objectContaining({ status: "not_selected", feedVersionId: null }),
    });
    expect(await res.json()).toMatchObject({ zoneAttributes: null });
  });
});

/**
 * THE SAME DEFECT, ONE MODULE OVER. The transit stamp is a snapshot of one read
 * too, and OpenPlan tells a planner "bring the feed in again from the Data Hub,
 * then relaunch". A relaunch that re-queued the STORED stamp would make that
 * instruction unable to succeed — the run would re-read its old refusal forever
 * — which is exactly what happened to the demographics above.
 *
 * The stamp therefore remembers the FEED, never the version, and the relaunch
 * re-resolves whichever ingest is in use NOW.
 */
describe("relaunching re-resolves the transit feed the run models from", () => {
  beforeEach(() => {
    givenARelaunchableRun();
    runMaybeSingleMock.mockResolvedValue({
      data: {
        id: MODEL_RUN_ID,
        status: "failed",
        engine_key: "aequilibrae",
        corridor_geojson: CORRIDOR,
        input_snapshot_json: {
          modelId: MODEL_ID,
          // What the previous attempt recorded: the feed was named, and its
          // archive had not been kept.
          transitFeed: {
            version: "transit-feed-v1",
            status: "unavailable",
            feedId: TRANSIT_FEED_ID,
            feedVersionId: null,
            checksumSha256: null,
            reason: "The archive behind this feed's current ingest was not kept…",
          },
        },
      },
      error: null,
    });
  });

  function requeuedStamp(): Record<string, unknown> {
    const payload = runUpdateMock.mock.calls[0][0] as Record<string, unknown>;
    const snapshot = payload.input_snapshot_json as Record<string, unknown>;
    return snapshot.transitFeed as Record<string, unknown>;
  }

  it("re-reads the named feed and adopts the ingest now in use", async () => {
    const res = await relaunchRun(request(), routeContext());

    expect(res.status).toBe(200);
    // The whole recovery: a stamp that said "unavailable" becomes "selected"
    // with no planner picking anything a second time.
    expect(requeuedStamp()).toMatchObject({
      status: "selected",
      feedId: TRANSIT_FEED_ID,
      feedVersionId: TRANSIT_VERSION_ID,
      checksumSha256: "a".repeat(64),
      reason: null,
    });
    expect(gtfsTablesRead).toContain("gtfs_feeds");
    expect(gtfsTablesRead).toContain("gtfs_feed_versions");
  });

  it("re-states the refusal, and reports it to the caller, when it is still true", async () => {
    // A re-ingest that stored nothing again must not read as success. And the
    // ANSWER has to reach the button that was pressed — learning it from the
    // worker's transit stage minutes later is what this reply exists to fix.
    gtfsVersionMaybeSingleMock.mockResolvedValue({
      data: {
        id: TRANSIT_VERSION_ID,
        feed_id: TRANSIT_FEED_ID,
        workspace_id: WORKSPACE_ID,
        source_kind: "catalog",
        source_url: "https://example.org/gtfs.zip",
        // NO OBJECT WAS STORED — the fact the refusal actually turns on. The
        // checksum is present, as it is on every ready version whichever door
        // the feed came through, which is exactly why testing it instead stamped
        // every catalog and URL ingest as handed over with no bytes behind it.
        storage_path: null,
        checksum_sha256: "a".repeat(64),
        service_start_date: null,
        service_end_date: null,
        frequency_trip_count: 0,
        scheduled_trip_count: 0,
      },
      error: null,
    });

    const res = await relaunchRun(request(), routeContext());

    expect(res.status).toBe(200);
    expect(requeuedStamp()).toMatchObject({ status: "unavailable", feedVersionId: null });
    expect(await res.json()).toMatchObject({
      transitFeed: { status: "unavailable", agencyName: "Example Transit" },
    });
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "transit_feed_handoff_unavailable",
      expect.objectContaining({ status: "unavailable" }),
    );
  });

  it("does not go looking for a feed a run never named", async () => {
    // "Resolved to nothing" and "never asked" are different facts, and the
    // second is what a run launched before this capability existed looks like.
    runMaybeSingleMock.mockResolvedValue({
      data: {
        id: MODEL_RUN_ID,
        status: "failed",
        engine_key: "aequilibrae",
        corridor_geojson: CORRIDOR,
        input_snapshot_json: { modelId: MODEL_ID },
      },
      error: null,
    });

    const res = await relaunchRun(request(), routeContext());

    expect(res.status).toBe(200);
    expect(requeuedStamp()).toMatchObject({ status: "not_selected", feedVersionId: null });
    expect(gtfsTablesRead).toEqual([]);
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
