// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSynthesisContextHistory } from "@/lib/engagement/synthesis-context-history-server";
import * as continuation from "@/lib/engagement/synthesis-context-continuation";
import { synthesisContextHistoryFixture as fixture } from "./fixtures/engagement/synthesis-context-history";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";

type Fixture = ReturnType<typeof fixture>;
const load = (f: Fixture, throughSequence?: number) => loadSynthesisContextHistory(f.client, f.service,
  { ...f.scope, ...(throughSequence === undefined ? {} : { throughSequence }) }, f.controller.signal);
function remove(f: Fixture, table: string, attemptId: unknown) {
  f.rows.set(table, f.rows.get(table)!.filter(row => row.attempt_id !== attemptId));
}
afterEach(() => vi.restoreAllMocks());

describe("current-staff historical context execution", () => {
  it("retains selection reasons at the native Unicode character limit", async () => {
    const f = fixture(); f.history[0].selection.reason = "😀".repeat(4000);
    expect((await load(f)).entries[0].selection?.receipt.reason).toBe(f.history[0].selection.reason);
    f.history[0].selection.reason = "a".repeat(4001);
    await expect(load(f)).rejects.toThrow();
  });
  it("rereads immutable dispatch when output arrives between execution reads", async () => {
    const f = fixture(), first = f.history[0], dispatches = f.rows.get("engagement_synthesis_generation_dispatches")!, outputs = f.rows.get("engagement_synthesis_generation_outputs")!;
    remove(f, "engagement_synthesis_generation_dispatches", first.attempt.id);
    remove(f, "engagement_synthesis_generation_outputs", first.attempt.id);
    f.options.afterRead = (table, filters) => {
      if (table === "engagement_synthesis_generation_dispatches" && filters.attempt_id === first.attempt.id) {
        f.rows.set("engagement_synthesis_generation_dispatches", dispatches);
        f.rows.set("engagement_synthesis_generation_outputs", outputs);
      }
    };
    expect((await load(f)).entries[0].status).toBe("verified");
  });
  it("replays every retained frame, including the final one, without dispatch or credentials", async () => {
    const f = fixture(); f.completeHistory(); const value = await load(f);
    expect(value.manifest.status).toBe("frames_complete");
    expect(value.manifest.verifiedFrameCount).toBe(f.plan.entries.length);
    expect(value.entries.map(entry => entry.status)).toEqual(f.history.map(() => "verified"));
    expect(value.entries.map(entry => entry.result)).toEqual(f.history.map(entry => entry.result));
    expect(value.manifest.entries.map(entry => [entry.captureSha256, entry.resultSha256])).toEqual(
      f.history.map(entry => [entry.outputRow.capture_sha256, entry.result.sha256]));
    expect(value.finalOutputText).toBe(JSON.stringify(f.history.at(-1)!.output));
    expect(value.interpretation).toBe("machine_unreviewed");
    expect(value.sha256).toBe(hash(value.canonical));
    expect(JSON.parse(value.canonical)).toEqual(value.manifest);
    expect(f.serviceRpc).not.toHaveBeenCalled();
    expect(f.trace.some(row => /credential|connection/.test(row.table))).toBe(false);
    expect(f.calls.at(-1)!.name).toBe("read_engagement_synthesis_context_request");
    for (const [table, projection] of [
      ["engagement_synthesis_generation_attempts", "id,request_id,authorization_id,task_index,previous_attempt_id,worker_id,binding_text"],
      ["engagement_synthesis_context_attempt_inputs", "attempt_id,task_text,task_sha256,task_bytes,predecessor_attempt_id,predecessor_selection_id,predecessor_capture_sha256,previous_result_sha256"],
      ["engagement_synthesis_generation_dispatches", "attempt_id,expires_at,receipt_text,receipt_sha256"],
      ["engagement_synthesis_generation_outputs", "attempt_id,capture_text,capture_sha256"],
    ]) {
      const row = f.trace.find(row => row.table === table && Object.values(row.filters).includes(f.history[0].attempt.id));
      expect(row?.columns).toBe(projection); expect(row?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("keeps missing and explicitly cleared choices separate", async () => {
    const f = fixture(); Object.assign(f.history[1].selection, { attemptId: null, origin: "staff", authorizationId: null,
      previousSelectionId: randomUUID() });
    const value = await load(f);
    expect(value.entries.slice(0, 3).map(entry => entry.status)).toEqual(["verified", "cleared", "unselected"]);
    expect(value.manifest.status).toBe("incomplete"); expect(value.finalOutputText).toBeNull();
  });

  it("keeps one selection anchor across ordered pages", async () => {
    const f = fixture(); f.historyOptions.pageSize = 1;
    const value = await load(f);
    expect(value.manifest.verifiedFrameCount).toBe(2);
    const pages = f.calls.filter(row => row.name === "read_engagement_synthesis_generation_selection_history" && row.parameters.p_request === f.scope.requestId);
    expect(pages.map(row => [row.parameters.p_through_sequence, row.parameters.p_after_task_index])).toEqual([[null, -1], [2, 0]]);
  });

  it.each(["requestId", "actorId", "taskIndex", "sequence", "authorizationId", "previousSelectionId"])("rejects self-hashed selection identity %s", async field => {
    const f = fixture(); f.historyOptions.change = (name, raw) => {
      if (name !== "read_engagement_synthesis_generation_selection_history") return raw;
      const page = raw as { requestId: string; entries: Array<{ receiptText: string; receiptSha256: string }> };
      if (page.requestId !== f.scope.requestId) return raw;
      const entry = field === "taskIndex" ? page.entries.at(-1)! : page.entries[0];
      const receipt = JSON.parse(entry.receiptText);
      receipt[field] = field === "taskIndex" ? f.plan.entries.length : field === "sequence" ? 3 : field === "authorizationId" ? null : randomUUID();
      entry.receiptText = JSON.stringify(receipt); entry.receiptSha256 = hash(entry.receiptText);
      return page;
    };
    await expect(load(f, 2)).rejects.toThrow("Historical context execution differs");
  });

  it.each(["id", "sequence", "attemptId"])("rejects duplicate selected %s across pages", async field => {
    const f = fixture(); f.historyOptions.pageSize = 1;
    Object.assign(f.history[1].selection, { [field]: f.history[0].selection[field as "id" | "sequence" | "attemptId"] });
    await expect(load(f, 2)).rejects.toThrow("Historical context execution differs");
  });

  it.each(["predecessor_attempt_id", "predecessor_selection_id", "predecessor_capture_sha256", "previous_result_sha256"])("preserves changed predecessor evidence %s", async field => {
    const f = fixture(); f.history[1].input[field] = field.endsWith("_id") ? randomUUID() : "0".repeat(64);
    const value = await load(f);
    expect(value.entries[1].status).toBe("predecessor_changed"); expect(value.manifest.verifiedFrameCount).toBe(1);
    expect(value.finalOutputText).toBeNull();
  });

  it.each(["maxOutputTokens", "responseByteLimit", "expiresAt"])("rejects self-hashed dispatch beyond retained grant %s", async field => {
    const f = fixture(), first = f.history[0];
    if (field === "expiresAt") first.dispatch.expiresAt = "2100-01-01T00:00:00Z";
    else first.dispatch[field as "maxOutputTokens" | "responseByteLimit"]++;
    first.recapture(); await expect(load(f)).rejects.toThrow("Historical context execution differs");
  });

  it.each(["status", "coverage", "preceding-state", "schema", "truncated"])("keeps invalid retained output explicit for %s", async mode => {
    const f = fixture(), second = f.history[1];
    if (mode === "status") second.output.status = "incomplete";
    if (mode === "coverage") second.output.coveredPartIds.pop();
    if (mode === "preceding-state") second.output.uncertainties.shift();
    second.recapture(mode === "schema" ? "null" : undefined, mode === "truncated" ? "length" : "stop");
    const value = await load(f);
    expect(value.entries[1].status).toBe("invalid_output"); expect(value.manifest.verifiedFrameCount).toBe(1);
    expect(value.entries[1].captureSha256).toBe(second.outputRow.capture_sha256);
  });

  it("rejects an output still missing its dispatch after a fresh read", async () => {
    const f = fixture(); remove(f, "engagement_synthesis_generation_dispatches", f.history[0].attempt.id);
    await expect(load(f)).rejects.toThrow("Historical context execution differs");
  });

  it.each(["claimed", "awaiting_output", "provider_incomplete", "invalid_output"])("retains %s and blocks dependent interpretation", async status => {
    const f = fixture(); f.completeHistory(); const first = f.history[0];
    if (status === "claimed") remove(f, "engagement_synthesis_generation_dispatches", first.attempt.id);
    if (status === "claimed" || status === "awaiting_output") remove(f, "engagement_synthesis_generation_outputs", first.attempt.id);
    if (status === "provider_incomplete") first.recapture(undefined, "stop", 503);
    if (status === "invalid_output") first.recapture("{");
    const value = await load(f);
    expect(value.entries[0].status).toBe(status);
    expect(value.entries[1].status).toBe("blocked_by_predecessor");
    expect(value.entries[1].captureSha256).toBe(f.history[1].outputRow.capture_sha256);
    expect(value.manifest.verifiedFrameCount).toBe(0); expect(value.finalOutputText).toBeNull();
  });

  it("preserves a successor whose original predecessor selection is no longer current", async () => {
    const f = fixture(); f.completeHistory(); const original = structuredClone(f.history[1].input);
    f.history[0].selection.id = randomUUID();
    const value = await load(f);
    expect(value.entries[0].status).toBe("verified"); expect(value.entries[1].status).toBe("predecessor_changed");
    expect(value.entries[2].status).toBe("blocked_by_predecessor");
    expect(f.history[1].input).toEqual(original); expect(value.finalOutputText).toBeNull();
  });

  it("anchors choices and binds late output arrival into the returned manifest", async () => {
    const f = fixture(); f.completeHistory(); const last = f.history.at(-1)!;
    const saved = structuredClone(last.outputRow); remove(f, "engagement_synthesis_generation_outputs", last.attempt.id);
    const before = await load(f, f.history.length);
    f.rows.get("engagement_synthesis_generation_outputs")!.push(saved);
    const after = await load(f, f.history.length);
    expect(before.manifest.throughSequence).toBe(after.manifest.throughSequence);
    expect(before.manifest.status).toBe("incomplete"); expect(after.manifest.status).toBe("frames_complete");
    expect(before.sha256).not.toBe(after.sha256);
    const past = await load(f, 1); expect(past.manifest.verifiedFrameCount).toBe(1); expect(past.finalOutputText).toBeNull();
  });

  it("retains exact unusual provider output bytes", async () => {
    const f = fixture(); f.completeHistory(); const last = f.history.at(-1)!;
    last.output.uncertainties.push("SYNTHETIC é 😀 \u0000\ud800");
    const original = "\n" + JSON.stringify(last.output) + " "; last.recapture(original);
    const value = await load(f);
    expect(value.manifest.status).toBe("frames_complete"); expect(value.finalOutputText).toBe(original);
    expect(JSON.parse(value.entries.at(-1)!.result!.canonical).outputText).toBe(original);
  });

  it("preserves cancellation and refuses access revoked at the final check", async () => {
    const f = fixture(); f.completeHistory(); f.cancel(); const value = await load(f);
    expect(value.request.cancellation).toEqual(f.request.cancellation); expect(value.manifest.status).toBe("frames_complete");
    const denied = fixture(); denied.historyOptions.denyContextRead = 3;
    await expect(load(denied)).rejects.toThrow("Context request unavailable");
    expect(denied.trace.some(row => row.table === "engagement_synthesis_context_attempt_inputs")).toBe(true);
  });

  it.each(["requestId", "throughSequence", "afterTaskIndex", "receiptSha256"])("rejects changed selection %s", async field => {
    const f = fixture(); f.historyOptions.change = (name, raw) => {
      if (name !== "read_engagement_synthesis_generation_selection_history") return raw;
      const page = raw as { requestId: string; entries: Array<{ receiptSha256: string }> };
      if (page.requestId !== f.scope.requestId) return raw;
      if (field === "receiptSha256") page.entries[0].receiptSha256 = "0".repeat(64);
      else Object.assign(page, { [field]: field === "requestId" ? randomUUID() : 999 });
      return page;
    };
    await expect(load(f, 2)).rejects.toThrow("Historical context execution differs");
  });

  it.each(["task_sha256", "task_bytes", "task_index", "binding_text", "capture_sha256", "receipt_sha256"])("rejects original execution drift %s", async field => {
    const f = fixture(), first = f.history[0];
    const row = field.startsWith("task_") && field !== "task_index" ? first.input : field === "capture_sha256" ? first.outputRow
      : field === "receipt_sha256" ? first.dispatchRow : first.attempt;
    row[field] = field === "task_bytes" || field === "task_index" ? 999 : field === "binding_text" ? "{}" : "0".repeat(64);
    await expect(load(f)).rejects.toThrow();
  });

  it("authenticates later captures even when an earlier frame has invalid output", async () => {
    const f = fixture(); f.history[0].recapture("{"); f.history[1].outputRow.capture_sha256 = "0".repeat(64);
    await expect(load(f)).rejects.toThrow();
  });

  it("does not classify an internal processor defect as invalid provider output", async () => {
    const f = fixture(); const create = continuation.createSynthesisContextContinuation;
    vi.spyOn(continuation, "createSynthesisContextContinuation").mockImplementation((...args) => ({ ...create(...args),
      accept: () => { throw new TypeError("SYNTHETIC processor defect"); } }));
    const failure = await load(f).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(TypeError);
    expect((failure as Error | null)?.message).toBe("SYNTHETIC processor defect");
  });

  it("keeps failed storage reads and caller aborts out of retained output statuses", async () => {
    const f = fixture(); f.options.failTable = "engagement_synthesis_context_attempt_inputs";
    await expect(load(f)).rejects.toThrow("execution unavailable");
    const aborted = fixture(); aborted.options.abortTable = "engagement_synthesis_context_attempt_inputs";
    await expect(load(aborted)).rejects.toMatchObject({ name: "AbortError" });
  });
});
