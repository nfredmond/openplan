import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { enqueueSynthesisPreparation, readSynthesisPreparation, retrySynthesisPreparation, verifySynthesisPreparation, type SynthesisPreparationState } from "@/lib/engagement/synthesis-preparation-server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { campaignId: id(1), workspaceId: id(2), requestId: id(3) };
const actorId = id(4), date = "2026-10-02T12:00:00+00:00";
const enqueue = { ...scope, actorId, stage: "segment" as const, intentSha256: "a".repeat(64) };
function state(): SynthesisPreparationState {
  return { ...enqueue, schemaVersion: 1, status: "queued", attempts: 0, leaseUntil: null,
    failureCode: null, sealSha256: null, cancelled: false, createdAt: date, updatedAt: date };
}
function client(data: unknown, code?: string, after?: (signal: AbortSignal) => void) {
  const abortSignal = vi.fn(async (signal: AbortSignal) => { after?.(signal); return { data, error: code ? { code, message: "PRIVATE diagnostic" } : null }; });
  const rpc = vi.fn(() => ({ abortSignal }));
  return { rpc, abortSignal, db: { rpc } as unknown as Pick<SupabaseClient, "rpc"> };
}
const signal = () => new AbortController().signal;

describe("staff preparation custody adapter", () => {
  it("reads unqueued as null without enqueueing", async () => {
    const mock = client(null);
    expect(await readSynthesisPreparation(mock.db, scope, signal())).toBeNull();
    expect(mock.rpc.mock.calls).toEqual([["read_engagement_synthesis_preparation", { p_campaign: scope.campaignId, p_request: scope.requestId }]]);
  });
  it("allows another current staff reader to inspect the original requester's state", async () => {
    const saved = { ...state(), actorId: id(99) };
    expect(await readSynthesisPreparation(client(saved).db, scope, signal())).toEqual(saved);
  });
  it.each(["segment", "context", "thematic"] as const)("enqueues exact %s identity once", async stage => {
    const saved = { ...state(), stage, replayed: false }, mock = client(saved);
    expect(await enqueueSynthesisPreparation(mock.db, { ...enqueue, stage }, signal())).toEqual(saved);
    expect(mock.rpc.mock.calls).toEqual([["enqueue_engagement_synthesis_preparation", {
      p_campaign: scope.campaignId, p_request: scope.requestId, p_stage: stage, p_intent_sha256: enqueue.intentSha256,
    }]]);
    expect(mock.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it("recovers enqueue replay after preparation and cancellation", async () => {
    const saved = { ...state(), status: "prepared", attempts: 1, sealSha256: "b".repeat(64), cancelled: true, replayed: true };
    expect(await enqueueSynthesisPreparation(client(saved).db, enqueue, signal())).toEqual(saved);
  });
  it.each([0, 1])("retries observed attempt %s and accepts later failed progress", async attempt => {
    const saved = { ...state(), attempts: 2, status: "failed", failureCode: "input_unavailable" }, mock = client(saved);
    expect(await retrySynthesisPreparation(mock.db, { ...scope, actorId, attempt }, signal())).toEqual(saved);
    expect(mock.rpc.mock.calls).toEqual([["retry_engagement_synthesis_preparation", { p_campaign: scope.campaignId, p_request: scope.requestId, p_attempt: attempt }]]);
  });
  it.each(["campaignId", "workspaceId", "requestId"] as const)("rejects foreign %s", field => {
    expect(() => verifySynthesisPreparation({ ...state(), [field]: id(99) }, scope)).toThrow("scope differs");
  });
  it.each([
    ["running without lease", { status: "running", attempts: 1 }],
    ["nonrunning with lease", { leaseUntil: date }],
    ["failed without reason", { status: "failed" }],
    ["nonfailed with reason", { failureCode: "access_unavailable" }],
    ["prepared without seal", { status: "prepared", attempts: 1 }],
    ["unprepared with seal", { sealSha256: "b".repeat(64) }],
    ["unclaimed running", { status: "running", leaseUntil: date }],
    ["unclaimed prepared", { status: "prepared", sealSha256: "b".repeat(64) }],
    ["cancelled without cancellation", { status: "cancelled" }],
  ])("refuses contradictory state: %s", (_name, patch) => {
    expect(() => verifySynthesisPreparation({ ...state(), ...patch }, scope)).toThrow("state differs");
  });
  it.each([
    ["worker token", { leaseToken: id(9) }], ["unknown stage", { stage: "unknown" }],
    ["unknown status", { status: "approved" }], ["unknown failure", { status: "failed", failureCode: "PRIVATE detail" }],
    ["invalid hash", { intentSha256: "bad" }], ["negative attempt", { attempts: -1 }],
    ["unsafe attempt", { attempts: Number.MAX_SAFE_INTEGER + 1 }], ["fractional attempt", { attempts: 0.5 }],
  ])("refuses malformed staff state: %s", (_name, patch) => {
    expect(() => verifySynthesisPreparation({ ...state(), ...patch }, scope)).toThrow();
  });
  it.each(["null", "actor", "stage", "intent", "replay"])("refuses unconfirmed enqueue: %s", kind => {
    const saved = { ...state(), replayed: false as boolean | undefined };
    if (kind === "actor") saved.actorId = id(99);
    if (kind === "stage") saved.stage = "thematic";
    if (kind === "intent") saved.intentSha256 = "c".repeat(64);
    if (kind === "replay") saved.replayed = undefined;
    return expect(enqueueSynthesisPreparation(client(kind === "null" ? null : saved).db, enqueue, signal())).rejects.toMatchObject({ kind: "unavailable", status: 503 });
  });
  it.each(["null", "actor", "attempt"])("refuses unconfirmed retry: %s", kind => {
    const saved = { ...state(), actorId: kind === "actor" ? id(99) : actorId, attempts: kind === "attempt" ? 0 : 1 };
    return expect(retrySynthesisPreparation(client(kind === "null" ? null : saved).db, { ...scope, actorId, attempt: 1 }, signal())).rejects.toMatchObject({ kind: "unavailable", status: 503 });
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])("refuses invalid attempt %s before transport", async attempt => {
    const mock = client(state());
    await expect(retrySynthesisPreparation(mock.db, { ...scope, actorId, attempt }, signal())).rejects.toThrow();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", "forbidden", 403], ["PT409", "conflict", 409], ["23505", "conflict", 409],
    ["22023", "invalid", 400], ["22P02", "invalid", 400], ["PT503", "unavailable", 503], ["unknown", "unavailable", 503]] as const)(
    "maps native %s without diagnostic exposure or a write retry", async (code, kind, status) => {
      const mock = client(null, code);
      await expect(enqueueSynthesisPreparation(mock.db, enqueue, signal())).rejects.toMatchObject({ kind, status, message: `Synthesis preparation ${kind}` });
      expect(mock.rpc).toHaveBeenCalledTimes(1);
    });
  it("maps malformed native output to unavailable", async () => {
    await expect(readSynthesisPreparation(client({ private: "detail" }).db, scope, signal())).rejects.toMatchObject({ kind: "unavailable", status: 503 });
  });
  it.each(["before", "during"])("honors caller abort %s RPC", async when => {
    const c = new AbortController();
    const mock = client(state(), undefined, bounded => { c.abort(); expect(bounded.aborted).toBe(true); });
    if (when === "before") c.abort();
    await expect(readSynthesisPreparation(mock.db, scope, c.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(mock.rpc).toHaveBeenCalledTimes(when === "before" ? 0 : 1);
  });
  it("refuses late output after the bounded deadline expires", async () => {
    const c = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(c.signal);
    try {
      const mock = client(state(), undefined, bounded => { c.abort(new DOMException("Deadline expired", "TimeoutError")); expect(bounded.aborted).toBe(true); });
      await expect(readSynthesisPreparation(mock.db, scope, signal())).rejects.toMatchObject({ name: "TimeoutError" });
      expect(timeout).toHaveBeenCalledWith(10_000);
    } finally { timeout.mockRestore(); }
  });
});
