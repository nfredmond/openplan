import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildAssistantOperations } from "@/lib/assistant/operations";
import type { ModelAssistantContext } from "@/lib/assistant/context";
import {
  MANAGED_RUN_MODE_KEYS,
  RELAUNCHABLE_RUN_STATUSES,
  WORKER_EXECUTED_RUN_MODE_KEYS,
  isRelaunchableRunStatus,
  isWorkerExecutedRunMode,
} from "@/lib/models/run-modes";
import type { AssistantQuickLink } from "@/lib/assistant/catalog";

/**
 * CAN A PLANNER REACH `launch_model_run`, AND ONLY WHERE IT WOULD WORK?
 *
 * `record_stage_gate_hold` shipped a call site whose condition no real state
 * could satisfy — a control that could never render, whose reachability test
 * passed because the fixture described a board the product cannot build. The
 * two conditions here therefore come from what the ROUTE refuses, and this file
 * checks them against the route's own source rather than against a belief about
 * it:
 *
 *   - a `succeeded` run is refused with a 400. That refusal is what makes this
 *     action registrable at all: a run that has produced a screening gate
 *     cannot be re-rolled until the numbers land better.
 *   - an in-process engine is refused with a 409.
 *
 * An offer that appears where either refusal applies is a control a planner can
 * press and cannot use.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";

const LAUNCH_ROUTE = path.join(
  process.cwd(),
  "src/app/api/models/[modelId]/runs/[modelRunId]/launch/route.ts"
);

function modelContext(
  runs: ModelAssistantContext["recentModelRuns"]
): ModelAssistantContext {
  return {
    kind: "model",
    workspace: { id: WORKSPACE_ID, name: "Test RTPA", role: "admin" },
    model: {
      id: MODEL_ID,
      title: "Corridor screening",
      status: "active",
      modelFamily: "travel_demand",
      summary: null,
      projectId: null,
      scenarioSetId: null,
    },
    readiness: { level: "ready", label: "Ready", detail: "" },
    workflow: [],
    linkageCounts: {},
    launchTemplate: null,
    scenarioEntryOptions: [],
    recentModelRuns: runs,
    schemaPending: false,
  } as unknown as ModelAssistantContext;
}

function relaunchOffer(runs: ModelAssistantContext["recentModelRuns"]): AssistantQuickLink | null {
  const links = buildAssistantOperations(modelContext(runs));
  return links.find((link) => link.id === "model-relaunch-failed-run") ?? null;
}

function run(overrides: Partial<ModelAssistantContext["recentModelRuns"][number]>) {
  return {
    id: RUN_ID,
    status: "failed",
    runTitle: "Grass Valley screening run",
    engineKey: "aequilibrae",
    createdAt: "2026-08-08T17:00:00.000Z",
    completedAt: "2026-08-08T17:02:00.000Z",
    ...overrides,
  };
}

describe("the relaunch offer reaches a planner", () => {
  it("offers a failed worker-backed run, carrying the registered action", () => {
    const offer = relaunchOffer([run({})]);
    expect(offer).not.toBeNull();
    expect(offer!.executeAction).toEqual(
      expect.objectContaining({
        kind: "launch_model_run",
        workspaceId: WORKSPACE_ID,
        modelId: MODEL_ID,
        modelRunId: RUN_ID,
      })
    );
    // The tier a person actually consents at. `review` shows no dialog at all.
    expect(offer!.approval).toBe("approval_required");
  });

  it("carries no study area, engine or zone geography for the agent to choose", () => {
    // The whole argument for registering this action is that the model authors
    // nothing. A payload key that let it pick a resolution would let it move
    // the intrazonal share, which is what decides whether a count comparison
    // can support a screening claim.
    const offer = relaunchOffer([run({})]);
    const keys = Object.keys(offer!.executeAction ?? {});
    for (const forbidden of [
      "corridorGeojson",
      "studyArea",
      "engineKey",
      "zoneGeography",
      "calibrate",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("the offer does not appear where the route would refuse it", () => {
  it("is withheld for a run that already succeeded", () => {
    // The refusal that stops a gate being re-rolled.
    expect(relaunchOffer([run({ status: "succeeded" })])).toBeNull();
  });

  it("is withheld for a run that is still running or queued", () => {
    expect(relaunchOffer([run({ status: "running" })])).toBeNull();
    expect(relaunchOffer([run({ status: "queued" })])).toBeNull();
  });

  it("is withheld for an in-process engine the worker cannot execute", () => {
    for (const engineKey of ["sketch_abm", "ite_trip_generation", "deterministic_corridor_v1"]) {
      expect(relaunchOffer([run({ engineKey })]), engineKey).toBeNull();
    }
  });

  it("is withheld when the engine was never recorded", () => {
    // A run predating the column. Guessing it is worker-backed would offer a
    // control that 409s; null is the honest answer.
    expect(relaunchOffer([run({ engineKey: null })])).toBeNull();
  });

  it("offers ONE run, not a queue, when several qualify", () => {
    const offers = buildAssistantOperations(
      modelContext([
        run({ id: RUN_ID, runTitle: "Newest" }),
        run({ id: "44444444-4444-4444-8444-444444444444", runTitle: "Older" }),
      ])
    ).filter((link) => link.id === "model-relaunch-failed-run");

    // Each relaunch occupies the worker and needs its own approval. A list of
    // them is a wall, not a queue a planner works.
    expect(offers).toHaveLength(1);
    expect(offers[0].label).toContain("Newest");
  });

  it("offers nothing to a model with no runs at all", () => {
    expect(relaunchOffer([])).toBeNull();
  });
});

describe("the offer's conditions match the route's own refusals", () => {
  it("never treats an engine the route rejects as worker-executed", () => {
    /**
     * The route refuses by DENYLIST and this offer allows by ALLOWLIST, which
     * is deliberate — a route should refuse only what it is certain about, an
     * offer should appear only where it will work. The asymmetry is safe in
     * exactly one direction, and this asserts that direction: nothing the route
     * explicitly rejects may be in the allowlist.
     */
    const source = readFileSync(LAUNCH_ROUTE, "utf8");
    const refusalBlock = /engine_key === "([^"]+)" \|\| \w+\.engine_key === "([^"]+)"/.exec(source);
    expect(refusalBlock, "could not find the route's engine refusal").not.toBeNull();

    const refused = [refusalBlock![1], refusalBlock![2]];
    for (const engineKey of refused) {
      expect(WORKER_EXECUTED_RUN_MODE_KEYS as readonly string[]).not.toContain(engineKey);
      expect(isWorkerExecutedRunMode(engineKey), engineKey).toBe(false);
    }
  });

  it("never treats a status the route rejects as relaunchable", () => {
    const source = readFileSync(LAUNCH_ROUTE, "utf8");
    const statusRefusal = /status === "([^"]+)" \|\| \w+\.status === "([^"]+)"/.exec(source);
    expect(statusRefusal, "could not find the route's status refusal").not.toBeNull();

    for (const status of [statusRefusal![1], statusRefusal![2]]) {
      expect(RELAUNCHABLE_RUN_STATUSES as readonly string[]).not.toContain(status);
      expect(isRelaunchableRunStatus(status), status).toBe(false);
    }
  });

  it("keeps every allowlisted engine a real run mode", () => {
    // A typo here would silently disable the offer for everyone rather than
    // failing anywhere.
    for (const key of WORKER_EXECUTED_RUN_MODE_KEYS) {
      expect(MANAGED_RUN_MODE_KEYS as readonly string[]).toContain(key);
    }
  });

  it("accepts no agent body key that could configure the run", () => {
    /**
     * The approval hash covers the ACTION the route rebuilds, not the request
     * body — so a request carrying the action's fields PLUS extras hashes
     * identically to what the planner approved. `refuseOutOfScopeAgentRequest`
     * is what closes that, and it is only as narrow as this list.
     *
     * The route reads nothing from the body today, which is exactly why this
     * needs a guard rather than a comment: widening the list is invisible until
     * some later edit starts reading one of the new keys, and by then an agent
     * can choose a run's engine or resolution inside an approval a planner gave
     * for something else.
     *
     * Verified by mutation: adding `engineKey` and `zoneGeography` here passed
     * every other test in this file.
     */
    const source = readFileSync(LAUNCH_ROUTE, "utf8");
    const declared = /const AGENT_LAUNCH_BODY_KEYS = \[([^\]]*)\]/.exec(source)?.[1];
    expect(declared, "could not find AGENT_LAUNCH_BODY_KEYS").toBeTypeOf("string");

    const keys = declared!
      .split(",")
      .map((key) => key.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);

    expect(keys).toEqual(["workspaceId"]);
    for (const forbidden of [
      "engineKey",
      "zoneGeography",
      "corridorGeojson",
      "studyArea",
      "calibrate",
    ]) {
      expect(keys, `${forbidden} would let an agent configure the run`).not.toContain(forbidden);
    }
  });

  it("projects the engine the offer is keyed on", () => {
    // The context loader must actually ask for `engine_key`; without it every
    // run arrives with a null engine and the offer silently never appears.
    const source = readFileSync(path.join(process.cwd(), "src/lib/assistant/context.ts"), "utf8");
    const modelRunsRead = source.slice(source.indexOf('.from("model_runs")'));
    const projection = /\.select\(\s*"([^"]*)"/.exec(modelRunsRead)?.[1];
    expect(projection, "could not find the model_runs projection").toBeTypeOf("string");
    expect(projection!.split(",").map((column) => column.trim())).toContain("engine_key");
  });
});
