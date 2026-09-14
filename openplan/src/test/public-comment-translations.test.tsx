import { createHash, webcrypto } from "node:crypto";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePublicCommentTranslations } from "@/components/engagement/use-public-comment-translations";
const item = { id: "22222222-2222-4222-8222-222222222222", title: "  SYNTHETIC title  ", body: "SYNTHETIC body\n" };
const token = "SYNTHETIC-public-token", requestId = "33333333-3333-4333-8333-333333333333", child = "44444444-4444-4444-8444-444444444444";
const sourceHash = createHash("sha256").update(JSON.stringify([item.title, item.body])).digest("hex");
const queued = (state = "queued", id = requestId) => ({ source: "queue", sourceHash, request: { requestId: id, language: "es", state, translated: state === "completed" ? "  SINTÉTICO resultado\n" : null } });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn<typeof fetch>();
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const render = () => renderHook(({ share = token, items = [item], preview = false }) => usePublicCommentTranslations(share, items, preview), { initialProps: { share: token, items: [item], preview: false } });
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); fetchMock.mockImplementation(async () => response(queued(), 202)); vi.spyOn(document, "hidden", "get").mockReturnValue(true); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("public comment translation recovery", () => {
  it("queues the exact displayed hash and retains the pending request", async () => {
    const view = render(); await act(() => view.result.current.translateComment(item.id, "es"));
    expect(fetchMock).toHaveBeenCalledOnce(); expect(fetchMock.mock.calls[0][0]).toBe(`/api/engage/${token}/items/${item.id}/translate`);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ language: "es", sourceHash });
    expect(view.result.current.translations[item.id]).toMatchObject({ status: "pending", text: null, requestId, sourceHash, language: "es" });
  });
  it("recovers the same pending request with GET and no new POST", async () => {
    const view = render(); await act(() => view.result.current.translateComment(item.id, "es")); fetchMock.mockResolvedValue(response(queued("completed")));
    await act(() => view.result.current.checkTranslation(item.id));
    const url = new URL(String(fetchMock.mock.calls[1][0]), "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({ language: "es", sourceHash, requestId }); expect(fetchMock.mock.calls[1][1]?.method).toBe("GET");
    expect(view.result.current.translations[item.id]).toMatchObject({ status: "done", text: "  SINTÉTICO resultado\n", requestId });
  });
  it("recovers an unacknowledged request by lookup instead of resending it", async () => {
    fetchMock.mockRejectedValueOnce(new Error("SYNTHETIC lost acknowledgement")); const view = render(); await act(() => view.result.current.translateComment(item.id, "es"));
    expect(view.result.current.translations[item.id].status).toBe("unconfirmed");
    await act(() => view.result.current.retryTranslation(item.id)); expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockResolvedValue(response(queued())); await act(() => view.result.current.checkTranslation(item.id));
    const url = new URL(String(fetchMock.mock.calls[1][0]), "http://localhost"); expect(url.searchParams.has("requestId")).toBe(false); expect(fetchMock.mock.calls[1][1]?.method).toBe("GET");
    expect(view.result.current.translations[item.id]).toMatchObject({ requestId, status: "pending" });
  });
  it.each(["failed", "interrupted", "incomplete", "cancelled"])("creates an explicitly requested successor for %s", async state => {
    fetchMock.mockResolvedValueOnce(response(queued(state))); const view = render(); await act(() => view.result.current.translateComment(item.id, "es"));
    expect(fetchMock).toHaveBeenCalledOnce(); expect(view.result.current.translations[item.id].status).toBe("failed");
    fetchMock.mockResolvedValue(response(queued("queued", child), 202)); await act(() => view.result.current.retryTranslation(item.id));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ language: "es", sourceHash, retryOf: requestId });
    expect(view.result.current.translations[item.id]).toMatchObject({ requestId: child, status: "pending" });
  });
  it("allows a new root only after conclusive missing recovery", async () => {
    fetchMock.mockRejectedValueOnce(new Error("SYNTHETIC network")); const view = render(); await act(() => view.result.current.translateComment(item.id, "es"));
    fetchMock.mockResolvedValueOnce(response({ source: "missing", language: "es", sourceHash, translated: null })); await act(() => view.result.current.checkTranslation(item.id));
    expect(view.result.current.translations[item.id].status).toBe("missing"); fetchMock.mockResolvedValue(response(queued(), 202));
    await act(() => view.result.current.retryTranslation(item.id)); expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ language: "es", sourceHash });
  });
  it("preserves cached exact words", async () => {
    fetchMock.mockResolvedValue(response({ source: "cache", language: "es", sourceHash, translated: "  SINTÉTICO cache\n" }));
    const view = render(); await act(() => view.result.current.translateComment(item.id, "es")); expect(view.result.current.translations[item.id]).toMatchObject({ status: "done", text: "  SINTÉTICO cache\n" });
  });
  it.each([400, 403, 404, 409])("keeps the original on public refusal %i", async status => {
    fetchMock.mockResolvedValue(response({ error: "SYNTHETIC refusal" }, status)); const view = render(); await act(() => view.result.current.translateComment(item.id, "es"));
    expect(view.result.current.translations[item.id]).toMatchObject({ status: "unavailable", text: null });
    await act(() => view.result.current.retryTranslation(item.id)); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each([429, 500, 503])("requires recovery after unconfirmed response %i", async status => {
    fetchMock.mockResolvedValue(response({ error: "SYNTHETIC unavailable" }, status)); const view = render(); await act(() => view.result.current.translateComment(item.id, "es"));
    expect(view.result.current.translations[item.id]).toMatchObject({ status: "unconfirmed", text: null });
  });
  it.each(["response", "body"] as const)("does not revive a cleared translation after a late %s", async stage => {
    const wait = deferred<Response>(), body = deferred<unknown>(); const held = response(queued("completed")); vi.spyOn(held, "json").mockReturnValue(body.promise);
    fetchMock.mockImplementationOnce(() => stage === "response" ? wait.promise : Promise.resolve(held)); const view = render();
    let running!: Promise<void>; act(() => { running = view.result.current.translateComment(item.id, "es"); });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce()); act(() => view.result.current.clearTranslation(item.id));
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => { if (stage === "response") wait.resolve(response(queued("completed"))); else body.resolve(queued("completed")); await running; });
    expect(view.result.current.translations[item.id]).toBeUndefined();
  });
  it.each(["share", "source", "preview", "removed"] as const)("ignores work after %s changes", async change => {
    const wait = deferred<Response>(); fetchMock.mockReturnValueOnce(wait.promise); const view = render(); let running!: Promise<void>;
    act(() => { running = view.result.current.translateComment(item.id, "es"); }); await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    view.rerender({ share: change === "share" ? token + "-changed" : token, preview: change === "preview", items: change === "removed" ? [] : [{ ...item, body: change === "source" ? "SYNTHETIC corrected" : item.body }] });
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => { wait.resolve(response(queued("completed"))); await running; }); expect(view.result.current.translations[item.id]).toBeUndefined();
  });
  it("cancels observation on unmount", async () => {
    const wait = deferred<Response>(); fetchMock.mockReturnValueOnce(wait.promise); const view = render(); let running!: Promise<void>;
    act(() => { running = view.result.current.translateComment(item.id, "es"); }); await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce()); view.unmount();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true); wait.resolve(response(queued("completed"))); await running;
  });
  it("does not overwrite a new locale with an old response", async () => {
    const wait = deferred<Response>(); fetchMock.mockReturnValueOnce(wait.promise); const view = render(); let running!: Promise<void>;
    act(() => { running = view.result.current.translateComment(item.id, "es"); }); await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    fetchMock.mockResolvedValue(response({ source: "cache", sourceHash, language: "vi", translated: "SYNTHETIC Vietnamese" }));
    await act(() => view.result.current.translateComment(item.id, "vi")); await act(async () => { wait.resolve(response(queued("completed"))); await running; });
    expect(view.result.current.translations[item.id]).toMatchObject({ status: "done", language: "vi", text: "SYNTHETIC Vietnamese" });
  });
  it("sends no preview requests", async () => {
    const view = render(); view.rerender({ share: token, items: [item], preview: true }); await act(() => view.result.current.translateComment(item.id, "es")); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([{ ...queued("completed"), sourceHash: "b".repeat(64) }, { ...queued(), request: { ...queued().request, language: "vi" } }, { ...queued(), private: true }])("rejects substituted public response (%#)", async value => {
    fetchMock.mockResolvedValue(response(value)); const view = render(); await act(() => view.result.current.translateComment(item.id, "es")); expect(view.result.current.translations[item.id]).toMatchObject({ status: "unconfirmed", text: null });
  });
  it("rejects another request during exact status recovery", async () => {
    const view = render(); await act(() => view.result.current.translateComment(item.id, "es")); fetchMock.mockResolvedValue(response(queued("completed", child)));
    await act(() => view.result.current.checkTranslation(item.id)); expect(view.result.current.translations[item.id]).toMatchObject({ status: "unconfirmed", text: null, requestId });
  });
  it("polls existing work for a bounded period without creating another request", async () => {
    vi.useFakeTimers(); vi.spyOn(document, "hidden", "get").mockReturnValue(false); const view = render();
    await act(() => view.result.current.translateComment(item.id, "es"));
    for (let i = 0; i < 15; i++) await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(fetchMock).toHaveBeenCalledTimes(11); expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(view.result.current.translations[item.id]).toMatchObject({ status: "pending", requestId }); view.unmount();
  });
});
