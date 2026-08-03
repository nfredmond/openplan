/**
 * A queued model run is pushed at a worker, and the launch says what took it.
 *
 * Before this, a worker-backed run was written to the queue and the route
 * returned 201 with no call to anything. The only way a run could ever execute
 * was for a long-lived process to be polling this database, which quietly made
 * "give your deployment modeling compute" mean "keep a machine running" — and
 * on a deployment with none, the launch reported success and the reaper failed
 * the run some minutes later with no reason a planner could act on.
 *
 * This pins the push seam end to end:
 *   * unconfigured, nothing is called and the answer says so (a polling
 *     deployment must be completely unaffected),
 *   * configured, the run is POSTed with the shared secret and 200/202 is
 *     acceptance,
 *   * a push that fails NEVER fails the launch — the run stays queued, which is
 *     exactly the state that shipped before,
 *   * the route actually reaches the dispatcher and hands the outcome back, so
 *     the surface that renders it has something to render.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  MODEL_RUN_DISPATCH_CONTRACT,
  buildModelRunDispatchPayload,
  checkModelingQueueDepth,
  describeDispatchConfigurationProblem,
  describeModelRunDispatch,
  dispatchModelRun,
  isPushDispatchConfigured,
  isQueueDepthExceeded,
  modelingQueueDepthMessage,
  resolveModelRunDispatchTarget,
  resolveModelingQueueDepth,
  workerRunStageNames,
} from "@/lib/models/run-dispatch";

const RUN_ID = "44444444-4444-4444-8444-444444444444";

function payload() {
  return buildModelRunDispatchPayload({
    requestId: "55555555-5555-4555-8555-555555555555",
    runId: RUN_ID,
    engineKey: "aequilibrae",
    stageNames: [...workerRunStageNames("aequilibrae")],
    occurredAt: "2026-07-29T00:00:00Z",
  });
}

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

const CONFIGURED = env({
  OPENPLAN_MODELING_WORKER_URL: "https://worker.example",
  OPENPLAN_MODELING_WORKER_TOKEN: "shared-secret-value",
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("pushing a queued run at a worker", () => {
  it("calls nothing at all when this deployment configures no push endpoint", async () => {
    const fetcher = vi.fn();
    const outcome = await dispatchModelRun(payload(), { env: env({}), fetcher: fetcher as never });

    // The whole compatibility guarantee in one assertion: a deployment running
    // today's polling worker sees no new request, no new latency, no new
    // failure mode. Silence is the pre-push behaviour, preserved.
    expect(fetcher).not.toHaveBeenCalled();
    expect(outcome).toEqual({ state: "not_configured" });
    expect(isPushDispatchConfigured(env({}))).toBe(false);
  });

  it("POSTs the run pointer to the configured worker with the shared secret", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(202, { status: "accepted", jobReference: "job-7" }));
    const outcome = await dispatchModelRun(payload(), { env: CONFIGURED, fetcher: fetcher as never });

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://worker.example/api/v1/model-runs");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer shared-secret-value");

    // A POINTER, never the job: the worker reads the run out of the same
    // database the poller does, which is what keeps the two lanes identical.
    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual({
      contract: MODEL_RUN_DISPATCH_CONTRACT,
      requestId: "55555555-5555-4555-8555-555555555555",
      runId: RUN_ID,
      engineKey: "aequilibrae",
      stageNames: ["AequilibraE Setup", "Network Assignment", "Artifact Extraction"],
      occurredAt: "2026-07-29T00:00:00Z",
    });

    expect(outcome).toEqual({ state: "accepted", workerHost: "worker.example", jobReference: "job-7" });
  });

  it("accepts a bare 200 or 202 from a pool that answers nothing else", async () => {
    for (const status of [200, 202]) {
      const fetcher = vi.fn().mockResolvedValue(new Response("", { status }));
      const outcome = await dispatchModelRun(payload(), { env: CONFIGURED, fetcher: fetcher as never });
      // Unlike the aerial contract, this worker owes OpenPlan nothing over HTTP
      // — it reports by writing stage rows — so a body is optional and an
      // operator's own pool needs no OpenPlan-specific response shape.
      expect(outcome).toEqual({ state: "accepted", workerHost: "worker.example", jobReference: null });
    }
  });

  it("reports a rejection as a failure to dispatch, naming what the worker said", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("bad token", { status: 401 }));
    const outcome = await dispatchModelRun(payload(), { env: CONFIGURED, fetcher: fetcher as never });

    expect(outcome.state).toBe("dispatch_failed");
    if (outcome.state !== "dispatch_failed") throw new Error("unreachable");
    expect(outcome.detail).toMatch(/401/);
    expect(outcome.detail).toMatch(/bad token/);
    // The host is safe to show and enough to recognise; the token never is.
    expect(outcome.workerHost).toBe("worker.example");
    expect(JSON.stringify(outcome)).not.toContain("shared-secret-value");
  });

  it("never throws when the worker cannot be reached, because a doorbell may not fail a launch", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const outcome = await dispatchModelRun(payload(), { env: CONFIGURED, fetcher: fetcher as never });

    expect(outcome.state).toBe("dispatch_failed");
    if (outcome.state !== "dispatch_failed") throw new Error("unreachable");
    expect(outcome.detail).toMatch(/ECONNREFUSED/);
  });

  it("refuses to ring an unauthenticated worker, and says that is what happened", async () => {
    const halfConfigured = env({ OPENPLAN_MODELING_WORKER_URL: "https://worker.example" });
    const fetcher = vi.fn();
    const outcome = await dispatchModelRun(payload(), { env: halfConfigured, fetcher: fetcher as never });

    // A trigger that starts minutes of compute may not be called without a
    // secret. And the answer must not be "not configured": the operator set a
    // URL and believes they configured it.
    expect(fetcher).not.toHaveBeenCalled();
    expect(outcome.state).toBe("dispatch_failed");
    expect(resolveModelRunDispatchTarget(halfConfigured)).toBeNull();
    expect(describeDispatchConfigurationProblem(halfConfigured)).toMatch(/OPENPLAN_MODELING_WORKER_TOKEN/);
    expect(describeDispatchConfigurationProblem(env({}))).toBeNull();
  });

  it("appends the contract path so a gateway prefix survives", () => {
    const target = resolveModelRunDispatchTarget(
      env({
        OPENPLAN_MODELING_WORKER_URL: "https://gateway.example/aeq/",
        OPENPLAN_MODELING_WORKER_TOKEN: "t",
      })
    );
    expect(target?.endpoint).toBe("https://gateway.example/aeq/api/v1/model-runs");
  });
});

describe("what a planner is told about who will run their queued run", () => {
  it("distinguishes accepted, waiting for a poller, and nothing at all", () => {
    const accepted = describeModelRunDispatch(
      { state: "accepted", workerHost: "worker.example", jobReference: null },
      "undeclared"
    );
    expect(accepted.state).toBe("accepted");
    expect(accepted.headline).toMatch(/worker.example/);

    const waiting = describeModelRunDispatch({ state: "not_configured" }, "deployed");
    expect(waiting.state).toBe("waiting_for_poller");
    expect(waiting.detail).toMatch(/statement of configuration and not a live check/i);

    const unattended = describeModelRunDispatch({ state: "not_configured" }, "absent");
    expect(unattended.state).toBe("unattended");
    expect(unattended.detail).toMatch(/sit queued and then be failed/i);

    // The fourth answer, and the honest one: nothing declared and nowhere to
    // push means there is no evidence in either direction. Saying "it will run"
    // or "it will not" here would both be confident claims from nothing.
    const unknown = describeModelRunDispatch({ state: "not_configured" }, "undeclared");
    expect(unknown.state).toBe("unknown");
    expect(unknown.headline).toMatch(/cannot tell/i);

    for (const outlook of [accepted, waiting, unattended, unknown]) {
      expect(`${outlook.headline} ${outlook.detail}`).not.toMatch(
        /upgrade|subscription|billing|pricing|paid tier|plan tier|contact sales/i
      );
    }
  });

  it("says a push failed rather than implying nothing was configured", () => {
    const outlook = describeModelRunDispatch(
      { state: "dispatch_failed", workerHost: "worker.example", detail: "The worker answered 500." },
      "absent"
    );
    expect(outlook.state).toBe("unattended");
    expect(outlook.detail).toMatch(/could not hand this run to a worker/i);
    expect(outlook.detail).toMatch(/The worker answered 500\./);
    // A failed push leaves the run exactly where it was, and the copy must not
    // imply it was withdrawn.
    expect(outlook.detail).toMatch(/still on the queue/i);
  });

  it("never claims a request was made where the configuration was too broken to make one", async () => {
    // A URL with no token is refused before any request — `fetcher` is never
    // called (asserted above). The sentence a planner reads must not say the
    // worker was asked and declined, because nothing was asked; the older copy
    // said exactly that and then contradicted itself one sentence later with
    // "so nothing is pushed".
    const halfConfigured = await dispatchModelRun(payload(), {
      env: env({ OPENPLAN_MODELING_WORKER_URL: "https://worker.example" }),
      fetcher: (() => {
        throw new Error("a half-configured endpoint must not be called");
      }) as never,
    });

    for (const declaration of ["deployed", "absent", "undeclared"] as const) {
      const outlook = describeModelRunDispatch(halfConfigured, declaration);
      expect(outlook.detail).not.toMatch(/tried to push/i);
      expect(outlook.detail).not.toMatch(/did not take it/i);
      // And the real reason still reaches them, by variable name.
      expect(outlook.detail).toMatch(/OPENPLAN_MODELING_WORKER_TOKEN/);
    }
  });

  it("does not tell a deployment whose push endpoint just failed to configure a push endpoint", () => {
    // The deployment most likely to read this is a scale-to-zero pool that did
    // not wake in time — the exact configuration push exists to serve. Telling
    // it to set the two variables it has already set is an instruction that
    // cannot succeed, and it buries the thing that would actually help.
    const failed = {
      state: "dispatch_failed",
      workerHost: "pool.internal",
      detail: "Could not reach the worker: The operation was aborted due to timeout.",
    } as const;

    for (const declaration of ["absent", "undeclared"] as const) {
      const outlook = describeModelRunDispatch(failed, declaration);
      expect(outlook.detail).not.toMatch(/configur(e|ing) (it as )?a push endpoint/i);
      expect(outlook.detail).toMatch(/already configures/i);
    }

    // Unchanged where there genuinely is nothing configured: that deployment
    // still needs to be told the option exists.
    for (const declaration of ["absent", "undeclared"] as const) {
      const outlook = describeModelRunDispatch({ state: "not_configured" }, declaration);
      expect(outlook.detail).toMatch(/OPENPLAN_MODELING_WORKER_URL/);
    }
  });

  it("never claims acceptance means the run will finish", () => {
    const accepted = describeModelRunDispatch(
      { state: "accepted", workerHost: "worker.example", jobReference: "job-1" },
      "absent"
    );
    expect(accepted.detail).not.toMatch(/will (finish|succeed|complete)/i);
    expect(accepted.detail).toMatch(/reading its work rather than watching the process/i);
  });

  it("says what happens if the worker that accepted the run goes away", () => {
    // The worker answers before it executes, so an acceptance describes a
    // process that may not exist a minute later — routine on the scale-to-zero
    // pool this lane exists for. Left at "a worker took it", a planner would
    // read a stalled run as a running one. The one thing this must not be is
    // silent about the case, so the copy has to name the outcome (stalled, then
    // failed) rather than merely hedge the promise.
    const accepted = describeModelRunDispatch(
      { state: "accepted", workerHost: "worker.example", jobReference: "job-1" },
      "undeclared"
    );
    expect(accepted.detail).toMatch(/stops before finishing|reclaimed mid-run/i);
    expect(accepted.detail).toMatch(/marks a run failed/i);
    // And it must not imply the run is gone: an unclaimed stage is still queued.
    expect(accepted.detail).toMatch(/still queued for another worker/i);
  });

  it("hands a worker's refusal through to the planner instead of swallowing it", async () => {
    // A push worker that is already full answers 503 with its reason rather than
    // accepting work it may never start. That answer has to survive the trip: a
    // 503 read as "accepted" would be the same lie as a queued run nothing will
    // look at, and a 503 flattened to "the worker answered 503" would lose the
    // one sentence explaining what the planner should do.
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(503, {
        error: "pool_at_capacity",
        detail: "This worker already has 8 run(s) waiting and will not accept another.",
      })
    );
    const outcome = await dispatchModelRun(payload(), { env: CONFIGURED, fetcher: fetcher as never });

    expect(outcome.state).toBe("dispatch_failed");
    const outlook = describeModelRunDispatch(outcome, "undeclared");
    expect(outlook.state).not.toBe("accepted");
    expect(outlook.detail).toMatch(/already has 8 run\(s\) waiting/);
    expect(outlook.detail).toMatch(/still on the queue/i);
    // The planner reads the worker's SENTENCE, not its JSON envelope.
    expect(outlook.detail).not.toMatch(/[{}]|"error"/);
  });
});

describe("the operator's optional bound on the worker queue", () => {
  const supabaseThatMustNotBeQueried = {
    from: () => {
      throw new Error("the counting query must be skipped when no bound is set");
    },
  };

  it("is unlimited by default, and does not even count", async () => {
    expect(resolveModelingQueueDepth(env({}))).toBeNull();
    const result = await checkModelingQueueDepth(supabaseThatMustNotBeQueried as never, {
      workspaceId: "w",
      env: env({}),
    });
    expect(result).toEqual({ ok: true, bounded: false, limit: null, inFlight: 0 });
  });

  it("treats a malformed bound as unset rather than as zero", () => {
    // A typo must never lock every workspace out of worker-backed modeling.
    for (const raw of ["0", "-3", "abc", "2.5", " "]) {
      expect(resolveModelingQueueDepth(env({ OPENPLAN_MODELING_QUEUE_DEPTH: raw }))).toBeNull();
    }
    expect(resolveModelingQueueDepth(env({ OPENPLAN_MODELING_QUEUE_DEPTH: "3" }))).toBe(3);
  });

  it("refuses in the operator's name, with nothing to buy", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => ({
              in: () => Promise.resolve({ count: 2, error: null }),
            }),
          }),
        }),
      }),
    };

    const result = await checkModelingQueueDepth(supabase as never, {
      workspaceId: "w",
      env: env({ OPENPLAN_MODELING_QUEUE_DEPTH: "2" }),
    });

    expect(isQueueDepthExceeded(result)).toBe(true);
    const message = modelingQueueDepthMessage(2, 2);
    expect(message).toMatch(/whoever operates this installation/i);
    expect(message).toMatch(/free and has no usage tiers/i);
    expect(message).not.toMatch(
      /upgrade|subscription|billing|pricing|paid tier|plan tier|contact sales/i
    );
  });
});

/* ── The reachability seam ───────────────────────────────────────────────────
 *
 * Everything above is a unit. This is the part that has broken four times in
 * this repo: a capability that is complete, tested and unreachable — a prop not
 * passed, a column not selected, a function never called. So the route is driven
 * for real, and asserted to CALL the dispatcher and HAND BACK its answer, which
 * is the only reason the launch panel has anything to render.
 */

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

const modelMaybeSingleMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const modelRunInsertMock = vi.fn();
const modelRunStagesInsertMock = vi.fn();
const modelRunUpdateEqMock = vi.fn();
const modelUpdateEqMock = vi.fn();
const quotaGteMock = vi.fn();
const prepareWorkerZoneAttributesMock = vi.fn();

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const supabaseStub = {
  auth: { getUser: vi.fn() },
  from: (table: string) => {
    switch (table) {
      case "models":
        return {
          select: () => ({ eq: () => ({ maybeSingle: modelMaybeSingleMock }) }),
          update: () => ({ eq: modelUpdateEqMock }),
        };
      case "workspace_members":
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }) }) };
      case "model_runs":
        return {
          insert: modelRunInsertMock,
          update: () => ({ eq: modelRunUpdateEqMock }),
          select: () => ({ eq: () => ({ gte: quotaGteMock }) }),
        };
      case "model_run_stages":
        return { insert: modelRunStagesInsertMock };
      case "workspace_integration_keys":
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      default:
        throw new Error(`Unexpected table: ${table}`);
    }
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseStub,
  createServiceRoleClient: () => supabaseStub,
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));

vi.mock("@/lib/models/zone-attribute-payload", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    prepareWorkerZoneAttributes: (...args: unknown[]) => prepareWorkerZoneAttributesMock(...args),
  };
});

const { POST: postModelRun } = await import("@/app/api/models/[modelId]/runs/route");

const CORRIDOR = {
  type: "Polygon",
  coordinates: [
    [
      [-121.5, 39.1],
      [-121.4, 39.1],
      [-121.4, 39.2],
      [-121.5, 39.1],
    ],
  ],
};

function launchRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/models/${MODEL_ID}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("the launch route reaches the dispatcher and hands its answer back", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    supabaseStub.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    modelMaybeSingleMock.mockResolvedValue({
      data: {
        id: MODEL_ID,
        workspace_id: WORKSPACE_ID,
        scenario_set_id: null,
        title: "Any-place mobility model",
        model_family: "travel_demand",
        config_version: "v1",
        config_json: { runTemplate: { queryText: "Screen the corridor", corridorGeojson: CORRIDOR } },
      },
      error: null,
    });
    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
    });
    modelRunInsertMock.mockResolvedValue({ error: null });
    modelRunStagesInsertMock.mockResolvedValue({ error: null });
    modelRunUpdateEqMock.mockResolvedValue({ error: null });
    modelUpdateEqMock.mockResolvedValue({ error: null });
    quotaGteMock.mockResolvedValue({ count: 0, error: null });
    prepareWorkerZoneAttributesMock.mockResolvedValue({ status: "supplied", keyOrigin: "workspace", demographics: {} });
  });

  it("pushes an AequilibraE run AFTER its stages are queued, and returns what answered", async () => {
    vi.stubEnv("OPENPLAN_MODELING_WORKER_URL", "https://worker.example");
    vi.stubEnv("OPENPLAN_MODELING_WORKER_TOKEN", "shared-secret-value");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, { status: "accepted", jobReference: "job-9" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postModelRun(launchRequest({ engineKey: "aequilibrae" }), {
      params: Promise.resolve({ modelId: MODEL_ID }),
    });
    const body = (await response.json()) as { modelRunId: string; dispatch: { state: string; workerHost: string } };

    expect(response.status).toBe(201);
    // The stage rows exist BEFORE the push: a worker that answers instantly must
    // find real work, not an empty queue.
    expect(modelRunStagesInsertMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://worker.example/api/v1/model-runs");
    expect(JSON.parse(init.body as string).runId).toBe(body.modelRunId);

    // And it reaches the caller, which is the only reason the launch panel can
    // tell a planner anything at all.
    expect(body.dispatch).toEqual({
      state: "accepted",
      workerHost: "worker.example",
      jobReference: "job-9",
    });
  });

  it("still queues the run — and still answers 201 — when the push fails", async () => {
    vi.stubEnv("OPENPLAN_MODELING_WORKER_URL", "https://worker.example");
    vi.stubEnv("OPENPLAN_MODELING_WORKER_TOKEN", "shared-secret-value");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const response = await postModelRun(launchRequest({ engineKey: "aequilibrae" }), {
      params: Promise.resolve({ modelId: MODEL_ID }),
    });
    const body = (await response.json()) as { status: string; dispatch: { state: string } };

    // A poller may still serve this deployment, so a failed doorbell may not
    // become a failed launch — that would break deployments that work today.
    expect(response.status).toBe(201);
    expect(body.status).toBe("queued");
    expect(modelRunStagesInsertMock).toHaveBeenCalledTimes(1);
    expect(body.dispatch.state).toBe("dispatch_failed");
    expect(mockAudit.error).toHaveBeenCalledWith("model_run_push_failed", expect.anything());
  });

  it("says plainly that nothing was pushed on a deployment that configures nowhere to push", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postModelRun(launchRequest({ engineKey: "behavioral_demand" }), {
      params: Promise.resolve({ modelId: MODEL_ID }),
    });
    const body = (await response.json()) as { dispatch: { state: string } };

    expect(response.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body.dispatch).toEqual({ state: "not_configured" });
  });

  it("refuses a launch over the operator's queue bound, naming the operator", async () => {
    vi.stubEnv("OPENPLAN_MODELING_QUEUE_DEPTH", "1");
    // The bound counts worker-backed runs in flight; this workspace has one.
    const restore = supabaseStub.from;
    supabaseStub.from = ((table: string) =>
      table === "model_runs"
        ? {
            insert: modelRunInsertMock,
            update: () => ({ eq: modelRunUpdateEqMock }),
            select: () => ({
              eq: () => ({
                gte: quotaGteMock,
                in: () => ({ in: () => Promise.resolve({ count: 1, error: null }) }),
              }),
            }),
          }
        : restore(table)) as typeof supabaseStub.from;

    try {
      const response = await postModelRun(launchRequest({ engineKey: "aequilibrae" }), {
        params: Promise.resolve({ modelId: MODEL_ID }),
      });
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(429);
      expect(body.error).toMatch(/whoever operates this installation/i);
      expect(body.error).not.toMatch(
        /upgrade|subscription|billing|pricing|paid tier|plan tier|contact sales/i
      );
      // Refused BEFORE the row is written, so no stranded run record is left.
      expect(modelRunInsertMock).not.toHaveBeenCalled();
    } finally {
      supabaseStub.from = restore;
    }
  });
});
