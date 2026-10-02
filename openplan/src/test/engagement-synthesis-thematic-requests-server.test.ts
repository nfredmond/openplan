import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSynthesisGenerationInput } from "@/lib/engagement/synthesis-generation-input";
import { createSynthesisGenerationRecords } from "@/lib/engagement/synthesis-generation-records";
import { createSynthesisGenerationTasks } from "@/lib/engagement/synthesis-generation-tasks";
import { createSynthesisGenerationPlan } from "@/lib/engagement/synthesis-generation-plan";
import { assembleSynthesisGenerationResults, createSynthesisGenerationResult } from "@/lib/engagement/synthesis-generation-results";
import { createSynthesisGenerationContext } from "@/lib/engagement/synthesis-generation-context";
import { createSynthesisThematicRequest, readSynthesisThematicRequest, verifySynthesisThematicRequest } from "@/lib/engagement/synthesis-thematic-requests-server";
import { loadSynthesisGenerationHistory } from "@/lib/engagement/synthesis-generation-selected-results-server";
import { makeSourceSnapshot, savedSource, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";
vi.mock("@/lib/engagement/synthesis-generation-selected-results-server", () => ({ loadSynthesisGenerationHistory: vi.fn() }));
type State = ReturnType<typeof verifySynthesisThematicRequest>["state"];
const loadHistory = vi.mocked(loadSynthesisGenerationHistory);
beforeEach(() => { vi.resetAllMocks(); });
function fixture(snapshot = makeSourceSnapshot(1)) {
  const saved = savedSource(snapshot), input = createSynthesisGenerationInput(saved, sourceScope);
  const records = createSynthesisGenerationRecords(input, saved, sourceScope);
  const plan = createSynthesisGenerationTasks(records, input, saved, sourceScope, 4096);
  const job = { jobId: "a0000000-0000-4000-8000-000000000010", planSha256: plan.manifestSha256,
    configurationRevisionId: "a0000000-0000-4000-8000-000000000011", configurationHash: "b".repeat(64),
    provider: "api_connection" as const, modelId: "synthetic-context" };
  const selections = plan.tasks.map((task, index) => ({ taskSha256: task.sha256,
    attemptId: `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}` }));
  const results = plan.tasks.map((task, index) => {
    const binding = { ...job, ...selections[index] };
    return createSynthesisGenerationResult(binding, { schemaVersion: 1, binding,
      startedAt: "2026-09-30T00:00:00Z", finishedAt: "2026-09-30T00:01:00Z", outcome: "returned",
      outputText: JSON.stringify({ status: "complete", coveredPartIds: JSON.parse(task.canonical).input.parts.map((part: { id: string }) => part.id),
        observations: [], uncertainty: "SYNTHETIC context not interpreted" }), providerReceiptText: null,
      finishReason: "stop", responseId: null, inputTokens: null, outputTokens: null, failureCode: null });
  });
  const args = { job, selections, results, plan, records, input, saved, scope: sourceScope, taskByteLimit: 4096 };
  const inventory = assembleSynthesisGenerationResults(args), sequence = selections.length;
  return { args, inventory, sequence, context: createSynthesisGenerationContext(inventory, args, sequence) };
}
function serviceFixture() {
  const f = fixture();
  const intent = { schemaVersion: 1, sourceId: sourceScope.requestId, sourceSha256: f.args.saved.snapshotSha256,
    connectionId: "e0000000-0000-4000-8000-000000000001", configurationRevisionId: f.args.job.configurationRevisionId,
    configurationHash: f.args.job.configurationHash, modelId: f.args.job.modelId, taskByteLimit: 4096 };
  const intentText = JSON.stringify(intent), request = { id: f.args.job.jobId, intentText, intentSha256: sourceHash(intentText) };
  const history: Awaited<ReturnType<typeof loadSynthesisGenerationHistory>> = { campaignId: sourceScope.campaignId,
    workspaceId: sourceScope.workspaceId, requesterId: "a0000000-0000-4000-8000-000000000020", inventory: f.inventory, executions: [],
    selections: { schemaVersion: 1, requestId: request.id, throughSequence: f.sequence, entries: [], selections: f.args.selections,
      plan: createSynthesisGenerationPlan(request, f.args.saved, sourceScope) } };
  loadHistory.mockResolvedValue(history);
  const args = { campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId, requestId: "a0000000-0000-4000-8000-000000000040",
    actorId: "a0000000-0000-4000-8000-000000000041", parentRequestId: request.id, throughSequence: f.sequence,
    frameByteLimit: 4096, intentText };

  let stored: State | null = null;
  const controller = new AbortController();
  const options = { sourceDenied: false, writeDenied: false, lostAcknowledgement: false, abortSource: false, abortWrite: false,
    changeResponse: null as null | ((state: State) => void) };
  const trace: Array<{ name: string; args: Record<string, unknown>; signal?: AbortSignal }> = [];
  const rpc = vi.fn((name: string, parameters: Record<string, unknown>) => {
    const row = { name, args: parameters, signal: undefined as AbortSignal | undefined }; trace.push(row);
    let data: unknown = null, error: { code: string } | null = null;
    if (name === "read_engagement_synthesis_sources") { data = f.args.saved; if (options.sourceDenied) error = { code: "42501" }; if (options.abortSource) controller.abort(); }
    else if (name === "create_engagement_synthesis_thematic_request") {
      if (options.writeDenied) error = { code: "42501" };
      else {
        const replayed = stored !== null;
        if (!stored) stored = { schemaVersion: 1, campaignId: args.campaignId, workspaceId: args.workspaceId,
          request: { id: args.requestId, actorId: args.actorId, intentText: parameters.p_intent_text as string,
            intentSha256: sourceHash(parameters.p_intent_text as string), createdAt: "2026-09-30T00:00:00Z" }, cancellation: null,
          thematic: { parentRequestId: args.parentRequestId, thematicText: parameters.p_thematic_text as string,
            thematicSha256: sourceHash(parameters.p_thematic_text as string), createdAt: "2026-09-30T00:00:00Z" } };
        data = { ...structuredClone(stored), replayed };
        options.changeResponse?.(data as State);
        if (options.lostAcknowledgement) { data = null; error = { code: "SYNTHETIC_LOST_ACK" }; }
      }
      if (options.abortWrite) controller.abort();
    } else if (name === "read_engagement_synthesis_thematic_request") { data = structuredClone(stored); if (!stored) error = { code: "42501" }; }
    else throw new Error(`Unexpected context RPC ${name}`);
    const result = Promise.resolve({ data, error }); return Object.assign(result, { abortSignal(signal: AbortSignal) { row.signal = signal; return result; } });
  });
  const client = { rpc } as unknown as Pick<SupabaseClient, "rpc">;
  const service = { rpc: vi.fn(), from: vi.fn() } as unknown as Pick<SupabaseClient, "rpc" | "from">;
  const scope = { campaignId: args.campaignId, workspaceId: args.workspaceId, requestId: args.requestId };
  return { f, history, args, scope, controller, options, trace, client, service, stored: () => stored };
}
const create = (f: ReturnType<typeof serviceFixture>) => createSynthesisThematicRequest(f.client, f.service, f.args, f.controller.signal);
const writes = (f: ReturnType<typeof serviceFixture>) => f.trace.filter(row => row.name === "create_engagement_synthesis_thematic_request");

// Historical access and original-byte joins have their own native/integration
// suites. This boundary uses real source/task/result reconstruction after that
// reader, and mocks only the RPC transport and historical loader.
describe("verified thematic-stage request service", () => {
  it("derives all input digests and writes with the current staff client and new actor", async () => {
    const f = serviceFixture(), value = await create(f);
    expect(loadHistory).toHaveBeenCalledWith(f.client, f.service, { campaignId: f.args.campaignId, workspaceId: f.args.workspaceId,
      requestId: f.args.parentRequestId, throughSequence: f.args.throughSequence }, f.controller.signal);
    expect(value.binding).toEqual({ schemaVersion: 1, parentRequestId: f.args.parentRequestId, selectionSequence: f.f.sequence,
      segmentResultsManifestSha256: f.f.inventory.manifestSha256, contextManifestSha256: f.f.context.manifestSha256,
      frameByteLimit: 4096 });
    expect(writes(f)).toHaveLength(1); expect(value.state.request.actorId).toBe(f.args.actorId);
    expect(value.state.request.actorId).not.toBe(f.history.requesterId);
    expect(writes(f)[0].args).toEqual({ p_campaign: f.args.campaignId, p_request: f.args.requestId,
      p_intent_text: f.args.intentText, p_thematic_text: JSON.stringify(value.binding) });
    expect(f.trace[0].args).toEqual({ p_campaign: sourceScope.campaignId, p_request: sourceScope.requestId });
    expect(f.trace.every(row => row.signal instanceof AbortSignal)).toBe(true);
    expect(f.service.rpc).not.toHaveBeenCalled(); expect(f.service.from).not.toHaveBeenCalled();
    expect((await readSynthesisThematicRequest(f.client, f.scope, f.controller.signal)).binding).toEqual(value.binding);
  });

  it("reuses exact intent after a lost acknowledgement and preserves the saved actor", async () => {
    const f = serviceFixture(); f.options.lostAcknowledgement = true;
    await expect(create(f)).rejects.toThrow("save unconfirmed"); expect(f.stored()).not.toBeNull();
    f.options.lostAcknowledgement = false;
    const value = await create(f); expect(value.state.replayed).toBe(true);
    expect(writes(f)[0].args).toEqual(writes(f)[1].args);
    expect(value.state.request).toEqual(f.stored()!.request);
  });

  it("requires complete results and a selected contribution without issuing writes", async () => {
    for (const status of ["incomplete", "empty_selection"] as const) {
      const f = serviceFixture(); f.history.inventory.status = status;
      await expect(create(f)).rejects.toThrow("complete retained results"); expect(f.trace).toEqual([]);
    }
    const f = serviceFixture(); f.history.inventory.contributionIds = [];
    await expect(create(f)).rejects.toThrow("selected contribution"); expect(f.trace).toEqual([]);
  });

  it("refuses foreign or changed history before reading another source", async () => {
    for (const mutate of [
      (f: ReturnType<typeof serviceFixture>) => { f.history.campaignId = f.args.workspaceId; },
      (f: ReturnType<typeof serviceFixture>) => { f.history.workspaceId = f.args.campaignId; },
      (f: ReturnType<typeof serviceFixture>) => { f.history.selections.requestId = f.args.requestId; },
      (f: ReturnType<typeof serviceFixture>) => { f.history.inventory.job.jobId = f.args.requestId; },
      (f: ReturnType<typeof serviceFixture>) => { f.history.selections.throughSequence++; },
    ]) {
      const f = serviceFixture(); mutate(f);
      await expect(create(f)).rejects.toThrow("history identity differs"); expect(f.trace).toEqual([]);
    }
  });

  it("reconstructs source, tasks and original selected results before writing", async () => {
    for (const mutate of [
      (f: ReturnType<typeof serviceFixture>) => { f.history.inventory.entries.pop(); },
      (f: ReturnType<typeof serviceFixture>) => { f.history.selections.plan.taskPlan.tasks.pop(); },
      (f: ReturnType<typeof serviceFixture>) => { f.history.selections.selections[0].attemptId = f.args.requestId; },
      (f: ReturnType<typeof serviceFixture>) => { f.f.args.saved.snapshotText += " "; },
      (f: ReturnType<typeof serviceFixture>) => { const intent = JSON.parse(f.args.intentText); intent.sourceId = f.args.requestId; f.args.intentText = JSON.stringify(intent); },
      (f: ReturnType<typeof serviceFixture>) => { const intent = JSON.parse(f.args.intentText); intent.sourceSha256 = "0".repeat(64); f.args.intentText = JSON.stringify(intent); },
    ]) {
      const f = serviceFixture(); mutate(f);
      await expect(create(f)).rejects.toThrow(); expect(writes(f)).toEqual([]);
    }
  });

  it("keeps permission loss distinct from a saved request and checks interruption", async () => {
    const deniedHistory = serviceFixture(); loadHistory.mockRejectedValueOnce(new Error("SYNTHETIC history denied"));
    await expect(create(deniedHistory)).rejects.toThrow("history denied"); expect(deniedHistory.trace).toEqual([]);
    const deniedSource = serviceFixture(); deniedSource.options.sourceDenied = true;
    await expect(create(deniedSource)).rejects.toThrow("source unavailable"); expect(writes(deniedSource)).toEqual([]);
    const deniedWrite = serviceFixture(); deniedWrite.options.writeDenied = true;
    await expect(create(deniedWrite)).rejects.toThrow("save unconfirmed"); expect(deniedWrite.stored()).toBeNull();
    const before = serviceFixture(); before.controller.abort();
    await expect(create(before)).rejects.toThrow(); expect(before.trace).toEqual([]);
    const history = serviceFixture(); loadHistory.mockImplementationOnce(async () => { history.controller.abort(); return history.history; });
    await expect(create(history)).rejects.toThrow(); expect(history.trace).toEqual([]);
    const source = serviceFixture(); source.options.abortSource = true;
    await expect(create(source)).rejects.toThrow(); expect(writes(source)).toEqual([]);
    const write = serviceFixture(); write.options.abortWrite = true;
    await expect(create(write)).rejects.toThrow(); expect(write.stored()).not.toBeNull();
  });

  it("rejects changed receipts even when their altered bytes are rehashed", async () => {
    for (const mutate of [
      (state: State) => { state.campaignId = sourceScope.workspaceId; },
      (state: State) => { state.workspaceId = sourceScope.campaignId; },
      (state: State) => { state.request.id = state.thematic.parentRequestId; },
      (state: State) => { state.request.actorId = state.thematic.parentRequestId; },
      (state: State) => { state.request.intentSha256 = "0".repeat(64); },
      (state: State) => { state.thematic.thematicSha256 = "0".repeat(64); },
      (state: State) => { state.thematic.parentRequestId = state.request.id; },
      (state: State) => { state.thematic.thematicText += " "; state.thematic.thematicSha256 = sourceHash(state.thematic.thematicText); },
      (state: State) => { state.request.intentText += " "; state.request.intentSha256 = sourceHash(state.request.intentText); },
      (state: State) => { delete state.replayed; },
    ]) {
      const f = serviceFixture(); f.options.changeResponse = mutate;
      await expect(create(f)).rejects.toThrow();
    }
  });

  it("refuses invalid inputs and unavailable or interrupted history reads", async () => {
    const f = serviceFixture(); f.args.parentRequestId = f.args.requestId;
    await expect(create(f)).rejects.toThrow("own parent"); expect(loadHistory).not.toHaveBeenCalled();
    for (const patch of [{ throughSequence: -1 }, { frameByteLimit: 4095 }, { frameByteLimit: 1048577 }]) {
      const invalid = serviceFixture(); Object.assign(invalid.args, patch); await expect(create(invalid)).rejects.toThrow(); expect(invalid.trace).toEqual([]);
    }
    const missing = serviceFixture(); await expect(readSynthesisThematicRequest(missing.client, missing.scope, missing.controller.signal)).rejects.toThrow("unavailable");
    const aborted = serviceFixture(); aborted.controller.abort(); await expect(readSynthesisThematicRequest(aborted.client, aborted.scope, aborted.controller.signal)).rejects.toThrow(); expect(aborted.trace).toEqual([]);
  });
});
