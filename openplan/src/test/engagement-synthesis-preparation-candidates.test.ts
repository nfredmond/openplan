import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { listSynthesisPreparationCandidates } from "@/lib/engagement/synthesis-preparation-candidates";

const id = (n: number) => `d1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-10-02T12:00:00.000Z");
const queued = (n: number) => ({ request_id: id(n), status: "queued", lease_until: null });
const running = (n: number, time = now.toISOString()) => ({ request_id: id(n), status: "running", lease_until: time });
function mock(data: unknown = []) {
  const response = vi.fn(async (_signal: AbortSignal): Promise<{ data: unknown; error: unknown }> => ({ data, error: null }));
  const query = { select: vi.fn(), or: vi.fn(), order: vi.fn(), limit: vi.fn(), gt: vi.fn(), abortSignal: response };
  for (const fn of [query.select, query.or, query.order, query.limit, query.gt]) fn.mockReturnValue(query);
  const from = vi.fn(() => query);
  return { query, from, response, service: { from } as unknown as Pick<SupabaseClient, "from"> };
}
const scan = (m: ReturnType<typeof mock>, after: string | null = null, signal = new AbortController().signal) =>
  listSynthesisPreparationCandidates({ service: m.service, after, signal, now });

describe("explicit preparation queue discovery", () => {
  it("queries only queued or expired jobs with a bounded ordered projection", async () => {
    const m = mock([queued(2), running(3)]);
    await expect(scan(m, id(1))).resolves.toEqual({ requestIds: [id(2), id(3)], nextAfter: id(3) });
    expect(m.from).toHaveBeenCalledExactlyOnceWith("engagement_synthesis_preparation_jobs");
    expect(m.query.select).toHaveBeenCalledExactlyOnceWith("request_id,status,lease_until");
    expect(m.query.or).toHaveBeenCalledExactlyOnceWith("status.eq.queued,and(status.eq.running,lease_until.lte.2026-10-02T12:00:00.000Z)");
    expect(m.query.order).toHaveBeenCalledExactlyOnceWith("request_id", { ascending: true });
    expect(m.query.limit).toHaveBeenCalledExactlyOnceWith(64);
    expect(m.query.gt).toHaveBeenCalledExactlyOnceWith("request_id", id(1));
    expect(m.response).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it("continues after a short page and wraps only after an empty page", async () => {
    const m = mock([queued(1)]);
    const first = await scan(m); expect(first.nextAfter).toBe(id(1)); expect(m.query.gt).not.toHaveBeenCalled();
    m.response.mockResolvedValueOnce({ data: [queued(2)], error: null });
    const second = await scan(m, first.nextAfter); expect(second.nextAfter).toBe(id(2));
    m.response.mockResolvedValueOnce({ data: [], error: null });
    expect(await scan(m, second.nextAfter)).toEqual({ requestIds: [], nextAfter: null });
    expect(m.query.gt.mock.calls).toEqual([["request_id", id(1)], ["request_id", id(2)]]);
  });
  it("normalizes UUID case before cursor comparison", async () => {
    const m = mock([{ ...queued(2), request_id: id(2).toUpperCase() }]);
    expect(await scan(m, id(1).toUpperCase())).toEqual({ requestIds: [id(2)], nextAfter: id(2) });
    expect(m.query.gt).toHaveBeenCalledWith("request_id", id(1));
  });
  it.each([
    [queued(2), queued(1)], [queued(1), queued(1)], [queued(0)],
    [{ ...queued(2), status: "prepared" }], [{ ...queued(2), status: "failed" }], [{ ...queued(2), status: "cancelled" }],
    [{ ...queued(2), lease_until: now.toISOString() }], [running(2, "2026-10-02T12:00:00.001Z")],
    [{ ...running(2), lease_until: null }], [running(2, "invalid")],
    [{ ...queued(2), request_id: "not-a-uuid" }], [{ ...queued(2), extra: true }],
    Array.from({ length: 65 }, (_, n) => queued(n + 2)),
  ].map(data => ({ data })))("refuses inconsistent or oversized inventory %#", async ({ data }) => {
    await expect(scan(mock(data), id(1))).rejects.toThrow();
  });
  it.each([null, {}, "", 0])("does not turn malformed inventory into an empty queue %#", async data => {
    await expect(scan(mock(data))).rejects.toThrow();
  });
  it("refuses RPC read errors without disclosing their detail", async () => {
    const m = mock(); m.response.mockResolvedValue({ data: [], error: { message: "PRIVATE" } });
    await expect(scan(m)).rejects.toThrow(/^Preparation queue inventory unavailable$/);
  });
  it("rejects invalid cursor before querying", async () => {
    const m = mock(); await expect(scan(m, "bad,or(status.eq.prepared)")).rejects.toThrow(); expect(m.from).not.toHaveBeenCalled();
  });
  it("rejects invalid cutoff before querying", async () => {
    const m = mock(); await expect(listSynthesisPreparationCandidates({ ...m, after: null, signal: new AbortController().signal, now: new Date(NaN) })).rejects.toThrow(); expect(m.from).not.toHaveBeenCalled();
  });
  it("honors interruption before reading", async () => {
    const m = mock(), c = new AbortController(); c.abort(); await expect(scan(m, null, c.signal)).rejects.toThrow(); expect(m.from).not.toHaveBeenCalled();
  });
  it.each(["caller", "deadline"])("rejects a late success after %s interruption", async kind => {
    const m = mock([queued(1)]), c = new AbortController(), deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    try {
      m.response.mockImplementationOnce(async s => {
        (kind === "caller" ? c : deadline).abort(new Error("interrupted"));
        expect(s.aborted).toBe(true); return { data: [queued(1)], error: null };
      });
      await expect(scan(m, null, c.signal)).rejects.toThrow("interrupted");
      expect(timeout).toHaveBeenCalledWith(10_000);
    } finally { timeout.mockRestore(); }
  });
});
