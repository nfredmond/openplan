import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSynthesisHistory } from "@/lib/engagement/synthesis-history-read";
const url = "/api/engagement/campaigns/synthetic/synthesis/proposals?mode=preview&requestId=retained&throughSequence=5";
const scope = () => ({ userId: "synthetic-staff", workspaceId: "synthetic-workspace", isCurrent: () => true });
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("bounded current-authority synthesis history reads", () => {
  it("retries busy reads with the same identity and query, then returns fresh evidence", async () => {
    const fresh = new Response("synthetic current evidence");
    const transport = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValue(fresh);
    vi.stubGlobal("fetch", transport);
    const result = readSynthesisHistory(url, scope());
    await vi.advanceTimersByTimeAsync(199); expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(transport).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(599); expect(transport).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(await result).toBe(fresh);
    expect(transport).toHaveBeenCalledTimes(3);
    for (const [target, options] of transport.mock.calls) {
      expect(target).toBe(url);
      expect(options).toEqual({ method: "GET", cache: "no-store", signal: undefined,
        headers: { "x-openplan-expected-user": "synthetic-staff", "x-openplan-expected-workspace": "synthetic-workspace" } });
    }
  });
  it("stops after three unavailable responses without inventing evidence", async () => {
    const unavailable = new Response(null, { status: 503 });
    const transport = vi.fn().mockResolvedValue(unavailable); vi.stubGlobal("fetch", transport);
    const result = readSynthesisHistory(url, scope()); await vi.advanceTimersByTimeAsync(2000);
    expect(transport).toHaveBeenCalledTimes(3); expect(await result).toBe(unavailable);
  });
  it.each([200, 401, 403, 404, 409, 429, 500])("does not retry status %i", async status => {
    const response = new Response(null, { status }), transport = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", transport);
    const result = readSynthesisHistory(url, scope()); await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBe(response); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("stops on a fresh access denial after a busy reply", async () => {
    const denied = new Response(null, { status: 403 });
    const transport = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValue(denied); vi.stubGlobal("fetch", transport);
    const result = readSynthesisHistory(url, scope()); await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBe(denied); expect(transport).toHaveBeenCalledTimes(2);
  });
  it("does not retry transport failures", async () => {
    const error = new Error("synthetic offline"), transport = vi.fn().mockRejectedValue(error); vi.stubGlobal("fetch", transport);
    await expect(readSynthesisHistory(url, scope())).rejects.toBe(error); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("cancels a backoff immediately without another request", async () => {
    const controller = new AbortController(), transport = vi.fn().mockResolvedValue(new Response(null, { status: 503 })); vi.stubGlobal("fetch", transport);
    const result = readSynthesisHistory(url, { ...scope(), signal: controller.signal });
    let outcome = "pending";
    void result.then(() => { outcome = "resolved"; }, (error: Error) => { outcome = error.message; });
    await vi.advanceTimersByTimeAsync(1); controller.abort(new Error("synthetic leave"));
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toBe("synthetic leave"); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("does not fetch a superseded scope or retry one invalidated during backoff", async () => {
    let current = false;
    const transport = vi.fn().mockResolvedValue(new Response(null, { status: 503 })); vi.stubGlobal("fetch", transport);
    await expect(readSynthesisHistory(url, { ...scope(), isCurrent: () => current })).rejects.toMatchObject({ name: "AbortError" });
    expect(transport).not.toHaveBeenCalled(); current = true;
    const result = readSynthesisHistory(url, { ...scope(), isCurrent: () => current });
    const outcome = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1); current = false; await vi.advanceTimersByTimeAsync(1000); await outcome;
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("discards a reply if the scope changes while its read is in flight", async () => {
    let current = true, finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const result = readSynthesisHistory(url, { ...scope(), isCurrent: () => current });
    current = false; finish(new Response("synthetic private text"));
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
});
