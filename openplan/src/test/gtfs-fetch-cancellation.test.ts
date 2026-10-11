import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCappedBytes, fetchGtfsFeedBytes, type CappedFetchOptions } from "@/lib/gtfs/fetch";
import { fetchPublicUrl } from "@/lib/http/outbound-url";

const url = "https://feeds.example.org/archive.zip";
const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
const options: CappedFetchOptions = { maxBytes: 1024, timeoutMs: 200, subjectLabel: "feed", lookup, env: {} };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("cancellation did not settle")), 750);
    })]);
  } finally { clearTimeout(timer); }
}
afterEach(() => { vi.restoreAllMocks(); });

describe("owned feed download cancellation", () => {
  it("does not resolve or connect for a pre-cancelled feed wrapper", async () => {
    const controller = new AbortController(), reason = new Error("worker stopped");
    controller.abort(reason);
    const dns = vi.fn(lookup), transport = vi.fn<typeof fetch>();
    await expect(fetchGtfsFeedBytes(url, { signal: controller.signal, lookup: dns, fetchImpl: transport, env: {} })).rejects.toBe(reason);
    expect(dns).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("interrupts DNS and never connects when its abandoned lookup finishes", async () => {
    const controller = new AbortController(), reason = new Error("lease unconfirmed");
    const answer = deferred<Awaited<ReturnType<typeof lookup>>>(), entered = deferred<void>();
    const transport = vi.fn<typeof fetch>();
    const pending = fetchCappedBytes(url, { ...options, signal: controller.signal, fetchImpl: transport,
      lookup: () => { entered.resolve(); return answer.promise; } });
    const checked = expect(bounded(pending)).rejects.toBe(reason);
    await entered.promise; controller.abort(reason); await checked;
    answer.resolve(await lookup());
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(transport).not.toHaveBeenCalled();
  });

  it("bounds an unresolved DNS lookup by the existing download deadline", async () => {
    const transport = vi.fn<typeof fetch>();
    const result = await bounded(fetchCappedBytes(url, { ...options, timeoutMs: 10,
      lookup: () => new Promise(() => {}), fetchImpl: transport }));
    expect(result).toMatchObject({ ok: false, code: "fetch_timed_out" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("cancels a late response from a transport that ignores interruption", async () => {
    const controller = new AbortController(), reason = new Error("worker stopped");
    const answer = deferred<Response>(), entered = deferred<void>(), cancelled = deferred<void>();
    const response = new Response(new ReadableStream({ cancel() { cancelled.resolve(); } }));
    const pending = fetchGtfsFeedBytes(url, { signal: controller.signal, lookup, env: {},
      fetchImpl: async () => { entered.resolve(); return answer.promise; } });
    const checked = expect(bounded(pending)).rejects.toBe(reason);
    await entered.promise; controller.abort(reason); await checked;
    answer.resolve(response); await bounded(cancelled.promise);
  });

  it("stops a partial body without converting its prefix to a successful archive", async () => {
    const controller = new AbortController(), reason = new Error("ownership lost");
    const reading = deferred<void>(), cancelled = vi.fn();
    let pulls = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(stream) {
        if (++pulls === 1) stream.enqueue(new Uint8Array([80, 75, 3, 4]));
        else reading.resolve();
      },
      cancel() { cancelled(); return new Promise(() => {}); },
    }, { highWaterMark: 0 }));
    const pending = fetchCappedBytes(url, { ...options, signal: controller.signal, fetchImpl: async () => response });
    const checked = expect(bounded(pending)).rejects.toBe(reason);
    await reading.promise; controller.abort(reason); await checked;
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
  });

  it("bounds a stalled body even when its transport ignores the deadline signal", async () => {
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream({ cancel() { cancelled(); return new Promise(() => {}); } }));
    const result = await bounded(fetchCappedBytes(url, { ...options, timeoutMs: 10, fetchImpl: async () => response }));
    expect(result).toMatchObject({ ok: false, code: "fetch_timed_out" });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
  });

  it("returns an oversized-body refusal without awaiting a stalled producer cleanup", async () => {
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream({
      start(stream) { stream.enqueue(new Uint8Array(1025)); },
      cancel() { cancelled(); return new Promise(() => {}); },
    }));
    const result = await bounded(fetchCappedBytes(url, { ...options, fetchImpl: async () => response }));
    expect(result).toMatchObject({ ok: false, code: "too_large" });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
  });

  it("cleans cancellation listeners after success and retains the completed bytes", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener"), remove = vi.spyOn(controller.signal, "removeEventListener");
    const result = await fetchPublicUrl(url, { signal: controller.signal }, { lookup, env: { NODE_ENV: "test" }, fetchImpl: async () => new Response("PK") });
    expect(result.ok).toBe(true);
    expect(remove.mock.calls.map(call => call[1])).toEqual(add.mock.calls.map(call => call[1]));
    controller.abort();
    if (!result.ok) throw new Error("missing response");
    expect(await result.response.text()).toBe("PK");
  });

  it("interrupts redirect cleanup without requesting the next URL", async () => {
    const controller = new AbortController(), cleaning = deferred<void>();
    const transport = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
      cancel() { cleaning.resolve(); return new Promise(() => {}); },
    }), { status: 302, headers: { location: "/next.zip" } }));
    const pending = fetchPublicUrl(url, { signal: controller.signal }, { lookup, fetchImpl: transport, env: { NODE_ENV: "test" } });
    await cleaning.promise; controller.abort();
    expect(await bounded(pending)).toMatchObject({ ok: false, code: "network_error" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("retains every-hop URL validation with a live cancellation signal", async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/feed.zip" } }));
    const result = await fetchCappedBytes(url, { ...options, signal: new AbortController().signal, fetchImpl: transport });
    expect(result).toMatchObject({ ok: false, code: "host_not_allowed" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("closes a real HTTP response after worker cancellation", async () => {
    const entered = deferred<void>(), headers = deferred<Response>(), closed = deferred<void>();
    const server = createServer((_request, response) => {
      response.on("close", () => closed.resolve());
      response.writeHead(200, { "Content-Type": "application/zip" });
      response.write(Buffer.from([80, 75, 3, 4])); entered.resolve();
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing owned listener");
    const controller = new AbortController(), reason = new Error("lease ended");
    try {
      // The fixture maps the already-validated public URL to our owned server.
      // This proves Node transport cancellation, not public DNS or TLS behavior.
      const pending = fetchCappedBytes(url, { ...options, timeoutMs: 5000, signal: controller.signal,
        fetchImpl: async (_input, init) => {
          const response = await fetch(`http://127.0.0.1:${address.port}/archive.zip`, init);
          headers.resolve(response); return response;
        } });
      const checked = expect(bounded(pending)).rejects.toBe(reason);
      await entered.promise;
      const response = await bounded(headers.promise);
      await bounded((async () => {
        const deadline = Date.now() + 500;
        while (!response.body?.locked && Date.now() < deadline) await new Promise<void>(resolve => setImmediate(resolve));
        expect(response.body?.locked).toBe(true);
      })());
      controller.abort(reason); await checked;
      await bounded(closed.promise);
    } finally {
      controller.abort(); server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
