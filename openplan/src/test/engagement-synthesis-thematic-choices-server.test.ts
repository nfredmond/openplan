// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { prepareSynthesisThematicChoice, readSynthesisThematicChoice, retainSynthesisThematicChoice, verifySynthesisThematicChoice } from "@/lib/engagement/synthesis-thematic-choices-server";
import { loadSynthesisContextHistory } from "@/lib/engagement/synthesis-context-history-server";
import { synthesisContextHistoryFixture } from "./fixtures/engagement/synthesis-context-history";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";

/** Only transport is mocked. Source reconstruction, original-response checking
 * and complete context replay run before the choice is constructed. Native
 * permissions and durable writes need the separate SQL/HTTP suites.
 */
async function fixture(complete = true) {
  const f = synthesisContextHistoryFixture(); if (complete) f.completeHistory();
  const history = await loadSynthesisContextHistory(f.client, f.service, f.scope, f.controller.signal);
  const requestId = randomUUID(), actorId = randomUUID(), { binding } = history.request;
  const thematicText = JSON.stringify({ schemaVersion: 1, parentRequestId: binding.parentRequestId,
    selectionSequence: binding.selectionSequence, segmentResultsManifestSha256: binding.segmentResultsManifestSha256,
    contextManifestSha256: binding.contextManifestSha256, frameByteLimit: binding.frameByteLimit });
  const request = { schemaVersion: 1, campaignId: f.scope.campaignId, workspaceId: f.scope.workspaceId,
    request: { ...history.request.state.request, id: requestId, actorId }, cancellation: null,
    thematic: { parentRequestId: binding.parentRequestId, thematicText, thematicSha256: hash(thematicText), createdAt: history.request.state.request.createdAt } };
  const args = { ...f.scope, requestId, actorId, contextRequestId: f.scope.requestId,
    throughSequence: history.manifest.throughSequence!, targetRecordId: binding.targetRecordId };
  const scope = { campaignId: args.campaignId, workspaceId: args.workspaceId, requestId };
  type Row = ReturnType<typeof verifySynthesisThematicChoice>["record"];
  let saved: Row | null = null;
  const options = { denied: "", loseAck: false, abortAt: "", change: null as null | ((row: Row) => void),
    changeRead: null as null | ((row: typeof request, ordinal: number) => void), denySecondRead: false };
  const calls: Array<{ name: string; args: Record<string, unknown>; signal?: AbortSignal }> = [];
  const rpc = vi.fn((name: string, parameters: Record<string, unknown>) => {
    if (!name.includes("thematic")) return f.client.rpc(name, parameters);
    const call = { name, args: parameters, signal: undefined as AbortSignal | undefined }; calls.push(call);
    let data: unknown = null, error: { code: string } | null = options.denied === name ? { code: "42501" } : null;
    if (name === "read_engagement_synthesis_thematic_request") {
      const ordinal = calls.filter(call => call.name === name).length;
      const row = structuredClone(request); options.changeRead?.(row, ordinal); data = row;
      if (options.denySecondRead && ordinal === 2) error = { code: "42501" };
    }
    else if (name === "read_engagement_synthesis_thematic_choice") data = structuredClone(saved);
    else if (name === "retain_engagement_synthesis_thematic_choice" && !error) {
      const replayed = saved !== null, choiceText = parameters.p_choice_text as string;
      saved ??= { schemaVersion: 1, ...scope, targetRecordId: args.targetRecordId, choiceText, choiceSha256: hash(choiceText), createdBy: actorId, createdAt: request.request.createdAt };
      const row = { ...saved, replayed }; options.change?.(row); data = row;
      if (options.loseAck) { data = null; error = { code: "SYNTHETIC_LOST_ACK" }; }
    }
    if (name === options.abortAt) f.controller.abort();
    const result = Promise.resolve({ data, error });
    return Object.assign(result, { abortSignal(signal: AbortSignal) { call.signal = signal; return result; } });
  });
  f.trace.length = 0; f.calls.length = 0;
  const client = { rpc } as unknown as Pick<SupabaseClient, "rpc">;
  return { f, history, request, args, scope, options, calls, client,
    prepare: () => prepareSynthesisThematicChoice(client, f.service, args, f.controller.signal),
    retain: () => retainSynthesisThematicChoice(client, f.service, args, f.controller.signal),
    read: () => readSynthesisThematicChoice(client, scope, args.targetRecordId, f.controller.signal),
    writes: () => calls.filter(call => call.name === "retain_engagement_synthesis_thematic_choice"), saved: () => saved,
    patchBinding: (patch: Record<string, unknown>) => {
      if (typeof patch.parentRequestId === "string") request.thematic.parentRequestId = patch.parentRequestId;
      request.thematic.thematicText = JSON.stringify({ ...JSON.parse(thematicText), ...patch }); request.thematic.thematicSha256 = hash(request.thematic.thematicText);
    } };
}

describe("retained thematic context choices", () => {
  it("inspects complete context without writing and rechecks current request access", async () => {
    const f = await fixture(), result = await f.prepare();
    expect(result.outputText).toBe(f.history.finalOutputText);
    expect(result.choice.historyManifestSha256).toBe(f.history.sha256);
    expect(JSON.parse(result.choiceText)).toEqual(result.choice);
    expect(f.writes()).toEqual([]);
    expect(f.calls.filter(call => call.name === "read_engagement_synthesis_thematic_request")).toHaveLength(2);
  });
  it.each(["requestIntentSha256", "thematicSha256", "choiceText"] as const)("refuses an altered inspected %s before the write", async key => {
    const f = await fixture(), prepared = await f.prepare();
    const expected = { requestIntentSha256: f.request.request.intentSha256, thematicSha256: f.request.thematic.thematicSha256,
      choiceText: prepared.choiceText };
    expected[key] = key === "choiceText" ? prepared.choiceText + " " : "0".repeat(64);
    await expect(retainSynthesisThematicChoice(f.client, f.f.service, { ...f.args, expected }, f.f.controller.signal))
      .rejects.toThrow("Inspected thematic input differs");
    expect(f.writes()).toEqual([]);
  });
  it("recovers an exact inspected choice after losing its acknowledgement", async () => {
    const f = await fixture(), prepared = await f.prepare();
    const command = { ...f.args, expected: { requestIntentSha256: f.request.request.intentSha256,
      thematicSha256: f.request.thematic.thematicSha256, choiceText: prepared.choiceText } };
    f.options.loseAck = true;
    await expect(retainSynthesisThematicChoice(f.client, f.f.service, command, f.f.controller.signal)).rejects.toThrow("save unconfirmed");
    f.options.loseAck = false;
    const replay = await retainSynthesisThematicChoice(f.client, f.f.service, command, f.f.controller.signal);
    expect(replay.record.replayed).toBe(true);
    expect(replay.record.choiceText).toBe(prepared.choiceText);
    expect(f.writes()[1].args).toEqual(f.writes()[0].args);
  });
  it("refuses late access loss before exposing prepared context or writing", async () => {
    const f = await fixture(); f.options.denySecondRead = true;
    await expect(f.prepare()).rejects.toThrow("request unavailable"); expect(f.writes()).toEqual([]);
  });
  it.each(["actor", "intent", "binding"])("refuses a changed %s on the final authenticated read", async field => {
    const f = await fixture();
    f.options.changeRead = (row, ordinal) => {
      if (ordinal !== 2) return;
      if (field === "actor") row.request.actorId = randomUUID();
      if (field === "intent") { row.request.intentText += " "; row.request.intentSha256 = hash(row.request.intentText); }
      if (field === "binding") { row.thematic.thematicText += " "; row.thematic.thematicSha256 = hash(row.thematic.thematicText); }
    };
    await expect(f.retain()).rejects.toThrow("changed during context inspection"); expect(f.writes()).toEqual([]);
  });
  it("reconstructs complete original history and retains exact selected capture/result identities", async () => {
    const f = await fixture(), last = f.history.entries.at(-1)!;
    expect(await f.read()).toBeNull();
    const result = await f.retain();
    expect(result.choice).toEqual({ schemaVersion: 1, targetRecordId: f.args.targetRecordId, contextRequestId: f.args.contextRequestId,
      selectionSequence: f.args.throughSequence, historyManifestSha256: f.history.sha256,
      finalCaptureSha256: last.captureSha256, finalResultSha256: last.resultSha256 });
    expect(result.record).toMatchObject({ ...f.scope, createdBy: f.args.actorId, replayed: false });
    expect(f.writes()[0].args).toEqual({ p_campaign: f.args.campaignId, p_request: f.args.requestId, p_choice_text: JSON.stringify(result.choice) });
    expect((await f.read())?.record.choiceText).toBe(result.record.choiceText);
    expect(f.calls.every(call => call.signal instanceof AbortSignal)).toBe(true);
    expect(f.f.serviceRpc).not.toHaveBeenCalled();
    expect(f.f.trace.some(row => /credential|connection/.test(row.table))).toBe(false);
  });
  it("recovers the same original after lost acknowledgement", async () => {
    const f = await fixture(); f.options.loseAck = true;
    await expect(f.retain()).rejects.toThrow("save unconfirmed"); expect(f.saved()).not.toBeNull();
    f.options.loseAck = false; const result = await f.retain();
    expect(result.record.replayed).toBe(true); expect(f.writes()[1].args).toEqual(f.writes()[0].args);
  });
  it("refuses incomplete context and another thematic actor before writing", async () => {
    const incomplete = await fixture(false); await expect(incomplete.retain()).rejects.toThrow("complete retained context");
    expect(incomplete.writes()).toEqual([]);
    const actor = await fixture(); actor.args.actorId = randomUUID();
    await expect(actor.retain()).rejects.toThrow("Only the thematic requester"); expect(actor.f.trace).toEqual([]); expect(actor.writes()).toEqual([]);
  });
  it.each([
    { parentRequestId: "b0000000-0000-4000-8000-000000000999" }, { selectionSequence: 0 },
    { segmentResultsManifestSha256: "0".repeat(64) }, { contextManifestSha256: "0".repeat(64) },
  ])("refuses a different parent binding %j", async patch => {
    const f = await fixture(); f.patchBinding(patch);
    await expect(f.retain()).rejects.toThrow("requested source and parent"); expect(f.writes()).toEqual([]);
  });
  it("refuses another source or contribution", async () => {
    for (const key of ["sourceId", "sourceSha256"]) {
      const f = await fixture(); const intent = JSON.parse(f.request.request.intentText);
      intent[key] = key === "sourceId" ? randomUUID() : "0".repeat(64);
      f.request.request.intentText = JSON.stringify(intent); f.request.request.intentSha256 = hash(f.request.request.intentText);
      await expect(f.retain()).rejects.toThrow("requested source and parent"); expect(f.writes()).toEqual([]);
    }
    const f = await fixture(); f.args.targetRecordId = `item:${randomUUID()}`;
    await expect(f.retain()).rejects.toThrow("requested source and parent"); expect(f.writes()).toEqual([]);
  });
  it("denies wrong-workspace reads even when there is no saved choice", async () => {
    const f = await fixture(); f.scope.workspaceId = randomUUID();
    await expect(f.read()).rejects.toThrow("identity differs");
    expect(f.calls.map(call => call.name)).toEqual(["read_engagement_synthesis_thematic_request"]);
  });
  it("refuses permission failures and interrupted reads or writes", async () => {
    for (const name of ["read_engagement_synthesis_thematic_request", "retain_engagement_synthesis_thematic_choice"]) {
      const f = await fixture(); f.options.denied = name;
      await expect(f.retain()).rejects.toThrow(); expect(f.saved()).toBeNull();
      const aborted = await fixture(); aborted.options.abortAt = name;
      await expect(aborted.retain()).rejects.toThrow();
      expect(aborted.saved() === null).toBe(name === "read_engagement_synthesis_thematic_request");
    }
    const f = await fixture(); f.options.denied = "read_engagement_synthesis_thematic_choice";
    await expect(f.read()).rejects.toThrow("choice unavailable");
    const before = await fixture(); before.f.controller.abort(); await expect(before.retain()).rejects.toThrow(); expect(before.calls).toEqual([]);
  });
  it("rejects altered scoped receipts, original bytes and authorship", async () => {
    type Row = ReturnType<typeof verifySynthesisThematicChoice>["record"];
    const changes: Array<(row: Row) => void> = [
      row => { row.campaignId = randomUUID(); }, row => { row.workspaceId = randomUUID(); }, row => { row.requestId = randomUUID(); },
      row => { row.targetRecordId = `item:${randomUUID()}`; }, row => { row.choiceSha256 = "0".repeat(64); },
      row => { row.createdBy = randomUUID(); }, row => { delete row.replayed; },
      row => { row.choiceText += " "; row.choiceSha256 = hash(row.choiceText); },
    ];
    for (const change of changes) {
      const f = await fixture(); f.options.change = change; await expect(f.retain()).rejects.toThrow();
    }
  });
});
