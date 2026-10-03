import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
const timer = vi.hoisted(() => ({ delay: vi.fn() }));
vi.mock("node:timers/promises", () => ({ setTimeout: timer.delay, default: { setTimeout: timer.delay } }));
import { claimSynthesisPreparation, finishSynthesisPreparation, runSynthesisPreparationAttempt } from "@/lib/engagement/synthesis-preparation-worker";
const id = (n: number) => `d1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const requestId = id(1), token = id(2), date = "2026-10-02T12:00:00.000Z", later = "2026-10-02T12:02:00.000Z";
function leased() { return { schemaVersion: 1, requestId, campaignId: id(3), workspaceId: id(4), actorId: id(5), intentSha256: "a".repeat(64), stage: "segment", status: "running", attempts: 1, leaseUntil: later, leaseToken: token, failureCode: null, sealSha256: null, cancelled: false, createdAt: date, updatedAt: date }; }
function claimed() { return { ...leased(), claim: { token, request_id: requestId, attempt: 1, claimed_at: date, initial_lease_until: later }, active: true }; }
const completed = () => ({ ...leased(), status: "prepared", leaseUntil: null, sealSha256: "b".repeat(64) });
const signal = () => new AbortController().signal;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let ticks: Array<() => void>;
beforeEach(() => {
  ticks = []; timer.delay.mockReset();
  timer.delay.mockImplementation((_ms: number, _value: unknown, options: { signal: AbortSignal }) => new Promise<void>((resolve, reject) => {
    const stop = () => reject(options.signal.reason);
    options.signal.addEventListener("abort", stop, { once: true });
    ticks.push(() => { options.signal.removeEventListener("abort", stop); resolve(); });
    if (options.signal.aborted) stop();
  }));
});
function mock() {
  const response = vi.fn(async (name: string, _args: Record<string, unknown>, _signal: AbortSignal): Promise<{ data: unknown; error: unknown }> => ({ data: name.startsWith("claim_") ? claimed() : name.startsWith("renew_") ? leased() : completed(), error: null }));
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => ({ abortSignal: (s: AbortSignal) => response(name, args, s) }));
  return { rpc, response, service: { rpc } as unknown as Pick<SupabaseClient, "rpc"> };
}
describe("preparation worker lease and interruption recovery", () => {
  it("records the reconstructed seal under the exact claim without dispatch", async () => {
    const m = mock(), prepare = vi.fn(async () => ({ sealSha256: "b".repeat(64) }));
    expect((await runSynthesisPreparationAttempt({ ...m, requestId, token, signal: signal(), prepare })).state).toBe("prepared");
    expect(m.rpc.mock.calls).toEqual([["claim_engagement_synthesis_preparation", { p_request: requestId, p_token: token }], ["finish_engagement_synthesis_preparation", { p_request: requestId, p_token: token, p_seal_sha256: "b".repeat(64), p_failure_code: null }]]);
    expect(prepare).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ requestId, leaseToken: token, stage: "segment" }), expect.any(AbortSignal));
    expect(timer.delay).toHaveBeenCalledWith(30_000, undefined, { signal: expect.any(AbortSignal) });
  });
  it("records only an explicit known preparation failure", async () => {
    const m = mock(); m.response.mockResolvedValueOnce({ data: claimed(), error: null }).mockResolvedValueOnce({ data: { ...leased(), status: "failed", leaseUntil: null, failureCode: "input_unavailable" }, error: null });
    expect((await runSynthesisPreparationAttempt({ ...m, requestId, token, signal: signal(), prepare: async () => ({ failureCode: "input_unavailable" }) })).state).toBe("failed");
    expect(m.rpc.mock.calls[1]).toEqual(["finish_engagement_synthesis_preparation", { p_request: requestId, p_token: token, p_seal_sha256: null, p_failure_code: "input_unavailable" }]);
  });
  it.each([null, { ...claimed(), active: false, leaseToken: id(99), attempts: 2 }])("never starts unavailable or superseded work", async data => {
    const m = mock(), prepare = vi.fn(); m.response.mockResolvedValue({ data, error: null });
    await expect(runSynthesisPreparationAttempt({ ...m, requestId, token, signal: signal(), prepare })).resolves.toEqual({ state: "not_active" }); expect(prepare).not.toHaveBeenCalled(); expect(m.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["missing", "token", "request", "future-attempt", "inactive-future-attempt", "interval", "active-missing", "cancelled", "lease-token", "old-active-attempt", "nonrunning"])("refuses inconsistent claim %s", async kind => {
    const m = mock(), data: Record<string, unknown> = claimed(), claim = { ...claimed().claim };
    if (kind === "missing") data.claim = undefined;
    if (kind === "token") claim.token = id(99);
    if (kind === "request") claim.request_id = id(99);
    if (kind === "future-attempt" || kind === "inactive-future-attempt") claim.attempt = 2;
    if (kind === "inactive-future-attempt") data.active = false;
    if (kind === "interval") claim.initial_lease_until = date;
    if (kind === "active-missing") data.active = undefined;
    if (kind === "cancelled") data.cancelled = true;
    if (kind === "lease-token") data.leaseToken = id(99);
    if (kind === "old-active-attempt") data.attempts = 2;
    if (kind === "nonrunning") Object.assign(data, { status: "queued", leaseUntil: null });
    if (kind !== "missing") data.claim = claim;
    m.response.mockResolvedValue({ data, error: null }); await expect(claimSynthesisPreparation(m.service, requestId, token, signal())).rejects.toThrow();
  });
  it("renews during work then completes", async () => {
    const m = mock(), started = deferred<void>(), done = deferred<void>();
    const pending = runSynthesisPreparationAttempt({ ...m, requestId, token, signal: signal(), prepare: async (_lease, s) => { started.resolve(); await done.promise; expect(s.aborted).toBe(false); return { sealSha256: "b".repeat(64) }; } });
    await started.promise; ticks[0](); await vi.waitFor(() => expect(m.rpc).toHaveBeenCalledWith("renew_engagement_synthesis_preparation", { p_request: requestId, p_token: token }));
    done.resolve(); expect((await pending).state).toBe("prepared"); expect(m.rpc.mock.calls.map(c => c[0])).toEqual(["claim_engagement_synthesis_preparation", "renew_engagement_synthesis_preparation", "finish_engagement_synthesis_preparation"]);
  });
  it.each(["rpc", "identity", "cancelled", "nonrunning"])("aborts late preparation after renewal %s failure", async kind => {
    const m = mock(), started = deferred<void>(), done = deferred<void>(); let workSignal!: AbortSignal;
    m.response.mockResolvedValueOnce({ data: claimed(), error: null }).mockResolvedValueOnce({ data: { ...leased(), actorId: kind === "identity" ? id(99) : id(5), cancelled: kind === "cancelled", ...(kind === "nonrunning" ? { status: "queued", leaseUntil: null } : {}) }, error: kind === "rpc" ? { message: "PRIVATE detail" } : null });
    const pending = runSynthesisPreparationAttempt({ ...m, requestId, token, signal: signal(), prepare: async (_lease, s) => { workSignal = s; started.resolve(); await done.promise; return { sealSha256: "b".repeat(64) }; } });
    const rejected = expect(pending).rejects.toThrow(); await started.promise; ticks[0](); await vi.waitFor(() => expect(workSignal.aborted).toBe(true)); done.resolve(); await rejected;
    expect(m.rpc.mock.calls.map(c => c[0])).not.toContain("finish_engagement_synthesis_preparation");
  });
  it("joins an in-flight renewal before completion", async () => {
    const m = mock(), started = deferred<void>(), done = deferred<void>(), renewal = deferred<{ data: unknown; error: null }>();
    m.response.mockResolvedValueOnce({ data: claimed(), error: null }).mockImplementationOnce(() => renewal.promise);
    const pending = runSynthesisPreparationAttempt({ ...m, requestId, token, signal: signal(), prepare: async () => { started.resolve(); await done.promise; return { sealSha256: "b".repeat(64) }; } });
    await started.promise; ticks[0](); await vi.waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(2)); done.resolve(); await Promise.resolve(); await Promise.resolve(); expect(m.rpc).toHaveBeenCalledTimes(2);
    renewal.resolve({ data: leased(), error: null }); expect((await pending).state).toBe("prepared");
  });
  it("leaves thrown preparation unconfirmed", async () => {
    const m = mock(); await expect(runSynthesisPreparationAttempt({ ...m, requestId, token, signal: signal(), prepare: async () => { throw new Error("lost input read"); } })).rejects.toThrow("lost input read"); expect(m.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["before", "during"])("honors caller interruption %s work", async when => {
    const m = mock(), c = new AbortController(), prepare = vi.fn(async () => { c.abort(); return { sealSha256: "b".repeat(64) }; }); if (when === "before") c.abort();
    await expect(runSynthesisPreparationAttempt({ ...m, requestId, token, signal: c.signal, prepare })).rejects.toMatchObject({ name: "AbortError" }); expect(m.rpc).toHaveBeenCalledTimes(when === "before" ? 0 : 1);
  });
  it.each(["campaignId", "workspaceId", "actorId", "stage", "intentSha256", "attempts", "leaseToken", "createdAt"])("refuses foreign completion %s", async field => {
    const m = mock(), lease = await claimSynthesisPreparation(m.service, requestId, token, signal());
    const value = field === "stage" ? "context" : field === "intentSha256" ? "c".repeat(64) : field === "attempts" ? 2 : field === "createdAt" ? later : id(99);
    m.response.mockResolvedValue({ data: { ...completed(), [field]: value }, error: null }); await expect(finishSynthesisPreparation(m.service, lease!, { sealSha256: "b".repeat(64) }, signal())).rejects.toThrow("attempt differs");
  });
  it("recovers exact completion after cancellation", async () => {
    const m = mock(), lease = await claimSynthesisPreparation(m.service, requestId, token, signal()); m.response.mockResolvedValue({ data: { ...completed(), cancelled: true }, error: null });
    expect((await finishSynthesisPreparation(m.service, lease!, { sealSha256: "b".repeat(64) }, signal())).cancelled).toBe(true);
  });
  it("refuses a different completed seal", async () => {
    const m = mock(), lease = await claimSynthesisPreparation(m.service, requestId, token, signal()); await expect(finishSynthesisPreparation(m.service, lease!, { sealSha256: "c".repeat(64) }, signal())).rejects.toThrow("completion differs");
  });
  it("refuses a late claim acknowledgement after deadline", async () => {
    const m = mock(), c = new AbortController(), timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(c.signal);
    try { m.response.mockImplementationOnce(async () => { c.abort(new DOMException("expired", "TimeoutError")); return { data: claimed(), error: null }; });
      await expect(claimSynthesisPreparation(m.service, requestId, token, signal())).rejects.toMatchObject({ name: "TimeoutError" }); expect(timeout).toHaveBeenCalledWith(10_000);
    } finally { timeout.mockRestore(); }
  });
  it("refuses renewal failure received after preparation returns", async () => {
    const m = mock(), started = deferred<void>(), done = deferred<void>(), renewal = deferred<{ data: unknown; error: unknown }>();
    m.response.mockResolvedValueOnce({ data: claimed(), error: null }).mockImplementationOnce(() => renewal.promise);
    const pending = runSynthesisPreparationAttempt({ ...m, requestId, token, signal: signal(), prepare: async () => { started.resolve(); await done.promise; return { sealSha256: "b".repeat(64) }; } });
    const rejected = expect(pending).rejects.toThrow("acknowledgement unavailable");
    await started.promise; ticks[0](); await vi.waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(2));
    done.resolve(); await Promise.resolve(); await Promise.resolve();
    renewal.resolve({ data: null, error: { message: "PRIVATE" } }); await rejected; expect(m.rpc).toHaveBeenCalledTimes(2);
  });
  it("refuses a foreign request before preparation", async () => {
    const m = mock(); m.response.mockResolvedValue({ data: { ...claimed(), requestId: id(99) }, error: null });
    await expect(claimSynthesisPreparation(m.service, requestId, token, signal())).rejects.toThrow("scope differs");
  });
  it.each(["wrong-failure", "opposite-outcome"])("refuses completion %s", async kind => {
    const m = mock(), lease = await claimSynthesisPreparation(m.service, requestId, token, signal());
    m.response.mockResolvedValue({ data: kind === "opposite-outcome" ? completed() : { ...leased(), status: "failed", leaseUntil: null, failureCode: "preparation_failed" }, error: null });
    await expect(finishSynthesisPreparation(m.service, lease!, { failureCode: "input_unavailable" }, signal())).rejects.toThrow("completion differs");
  });

});
