import { describe, expect, it } from "vitest";

/**
 * THE GUIDED FIRST MODEL RUN — a walkthrough, never a launch.
 *
 * The contract under test:
 *   1. A model with NO recorded runs offers the in-panel guide, and the
 *      workflow id it carries is one the catalog resolves — including for the
 *      "model-first-run" spelling, which the route's keyword fallback lands on
 *      the same branch (there is no such catalog id today; adding one belongs
 *      to catalog.ts's owner).
 *   2. The response quotes the launcher's own registry — engine descriptions
 *      and caveats verbatim from MANAGED_RUN_MODE_DEFINITIONS, the
 *      zone-resolution consequence verbatim from
 *      LINK_VALIDATION_NOT_SUPPORTED_CAVEAT — never a paraphrase free to drift
 *      from what the planner sees on screen.
 *   3. It GUIDES ONLY: nothing in the first-run state carries an
 *      executeAction. Creating a run is a recorded refusal (the registered
 *      launch_model_run action re-queues an EXISTING run precisely because the
 *      planner authored its configuration).
 *   4. Once runs exist, the launch workflow answers as before — the guide does
 *      not shadow the ordinary launch plan.
 *
 * Contexts are built by the REAL loader (`loadAssistantContext` with kind
 * "model") against a recording fake — never hand-written — per the stage-gate
 * lesson: a described fixture proves the assertion, only a built one proves
 * the feature.
 */

import { loadAssistantContext, type ModelAssistantContext } from "@/lib/assistant/context";
import { buildAssistantOperations } from "@/lib/assistant/operations";
import { buildAssistantResponse } from "@/lib/assistant/respond";
import { resolveAssistantWorkflowId } from "@/lib/assistant/catalog";
import { MANAGED_RUN_MODE_DEFINITIONS } from "@/lib/models/run-modes";
import { LINK_VALIDATION_NOT_SUPPORTED_CAVEAT } from "@/lib/models/zone-resolution";

type QueryResult = { data?: unknown; error?: { message: string } | null; count?: number | null };

function createModelSupabase(params: {
  workspaceId: string;
  modelId: string;
  modelRuns: Array<{ id: string; status: string; run_title: string; engine_key: string | null }>;
}) {
  const responses: Record<string, QueryResult> = {
    models: {
      data: {
        id: params.modelId,
        workspace_id: params.workspaceId,
        project_id: null,
        scenario_set_id: null,
        title: "First Run QA Model",
        model_family: "screening",
        status: "draft",
        config_version: "v1",
        owner_label: null,
        assumptions_summary: null,
        input_summary: null,
        output_summary: null,
        summary: null,
        config_json: {},
        last_validated_at: null,
        last_run_recorded_at: null,
      },
      error: null,
    },
    workspace_members: {
      data: {
        workspace_id: params.workspaceId,
        role: "owner",
        workspaces: { id: params.workspaceId, name: "Model QA" },
      },
      error: null,
    },
    model_links: { data: [], error: null },
    model_runs: {
      data: params.modelRuns.map((run) => ({
        ...run,
        created_at: "2026-08-01T00:00:00.000Z",
        completed_at: null,
      })),
      error: null,
    },
  };

  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      const result = () => responses[table] ?? { data: [], error: null, count: 0 };
      chain.select = self;
      chain.eq = self;
      chain.in = self;
      chain.not = self;
      chain.neq = self;
      chain.order = self;
      chain.limit = self;
      chain.maybeSingle = () => Promise.resolve(result());
      chain.then = (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(onFulfilled, onRejected);
      return chain;
    },
  };
}

async function loadModel(
  modelId: string,
  modelRuns: Array<{ id: string; status: string; run_title: string; engine_key: string | null }> = []
): Promise<ModelAssistantContext> {
  const supabase = createModelSupabase({ workspaceId: "ws-model-1", modelId, modelRuns });
  const context = (await loadAssistantContext(supabase as never, "user-1", {
    kind: "model",
    id: modelId,
    workspaceId: "ws-model-1",
    runId: null,
    baselineRunId: null,
  })) as ModelAssistantContext | null;
  expect(context).not.toBeNull();
  return context as ModelAssistantContext;
}

describe("the guided first model run", () => {
  it("a model with no runs offers the guide, with a workflow id the route provably resolves", async () => {
    for (const modelId of ["model-guide-a", "model-guide-b"]) {
      const context = await loadModel(modelId);
      const links = buildAssistantOperations(context);
      const guide = links.find((entry) => entry.id === "model-first-run-guide");
      expect(guide, "expected the first-run guide quick link").toBeDefined();
      expect(guide?.href).toBe(`/models/${modelId}`);
      expect(guide?.executeAction).toBeUndefined();
      expect(guide?.workflowId).toBe("model-launch");

      // The click path, end to end: the panel submits the link's workflowId and
      // prompt to /api/assistant, which gates them through
      // resolveAssistantWorkflowId. Both the carried id and the
      // "model-first-run" spelling must land on the launch workflow — anything
      // else and the guide is a shipped-invisible answer.
      expect(resolveAssistantWorkflowId("model", guide?.workflowId ?? null, guide?.prompt ?? null)).toBe("model-launch");
      expect(resolveAssistantWorkflowId("model", "model-first-run", guide?.prompt ?? null)).toBe("model-launch");
    }
  });

  it("the guided answer quotes the launcher registry verbatim and links the launcher, binding varied", async () => {
    for (const modelId of ["model-quote-a", "model-quote-b"]) {
      const context = await loadModel(modelId);
      const response = buildAssistantResponse(context, "model-launch");
      expect(response.title).toContain("Plan the first run");

      const text = [response.summary, ...response.findings, ...response.nextSteps].join("\n");
      // Engines and caveats, verbatim from the registry the launcher renders.
      for (const definition of MANAGED_RUN_MODE_DEFINITIONS.filter((entry) => entry.availability !== "prototype")) {
        expect(text).toContain(definition.summaryDetail);
        expect(text).toContain(definition.caveatSummary);
      }
      // The zone-resolution consequence, verbatim from the shared vocabulary.
      expect(text).toContain(LINK_VALIDATION_NOT_SUPPORTED_CAVEAT);
      // The launcher link carries THIS model's id.
      expect(text).toContain(`/models/${modelId}`);
      // The walkthrough never claims the copilot will run anything.
      expect(text).toContain("press launch yourself");
    }
  });

  it("the guided answer and its quick links carry no executeAction — guidance, never creation", async () => {
    const context = await loadModel("model-noact");
    const response = buildAssistantResponse(context, "model-launch");
    for (const entry of response.quickLinks ?? []) {
      expect(
        entry.executeAction,
        `first-run quick link "${entry.id}" carries an executeAction — the guide must never create or launch a run`
      ).toBeUndefined();
    }
  });

  it("the model-first-run spelling reaches the same guided answer directly", async () => {
    const context = await loadModel("model-alias");
    const response = buildAssistantResponse(context, "model-first-run");
    expect(response.title).toContain("Plan the first run");
  });

  it("once a run exists, the launch workflow answers with the ordinary launch plan, not the guide", async () => {
    const context = await loadModel("model-hasruns", [
      { id: "run-1", status: "failed", run_title: "First attempt", engine_key: "aequilibrae" },
    ]);
    const response = buildAssistantResponse(context, "model-launch");
    expect(response.title).not.toContain("Plan the first run");
    expect(response.title).toContain("Recommended next launch step");
    // And the guide quick link is not offered — the retry offer takes over.
    const links = buildAssistantOperations(context);
    expect(links.find((entry) => entry.id === "model-first-run-guide")).toBeUndefined();
    expect(links.find((entry) => entry.id === "model-relaunch-failed-run")).toBeDefined();
  });

  it("a pending model-run schema withholds the guide — an unreadable history is not an empty one", async () => {
    const supabase = createModelSupabase({ workspaceId: "ws-model-1", modelId: "model-pending", modelRuns: [] });
    const original = supabase.from.bind(supabase);
    (supabase as { from: (table: string) => unknown }).from = (table: string) => {
      if (table === "model_runs") {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.select = self;
        chain.eq = self;
        chain.order = self;
        chain.limit = self;
        chain.then = (onFulfilled: (value: QueryResult) => unknown) =>
          Promise.resolve({ data: null, error: { message: 'relation "public.model_runs" does not exist' } }).then(
            onFulfilled
          );
        return chain;
      }
      return original(table);
    };
    const context = (await loadAssistantContext(supabase as never, "user-1", {
      kind: "model",
      id: "model-pending",
      workspaceId: "ws-model-1",
      runId: null,
      baselineRunId: null,
    })) as ModelAssistantContext | null;
    expect(context).not.toBeNull();
    expect(context?.schemaPending).toBe(true);
    const links = buildAssistantOperations(context as ModelAssistantContext);
    expect(links.find((entry) => entry.id === "model-first-run-guide")).toBeUndefined();
  });
});
