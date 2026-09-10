import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { once } from "node:events";

export class OpenCodeRelayError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Native OpenCode's step count is advisory. This private per-turn endpoint
// allows exactly one upstream model request, independently of native retries.
// It forwards native authentication without reading or retaining credentials.
export async function openCodeRelay({ model, signal, fetchImpl = fetch, onFailure = () => {}, deadlineMs = 120_000, requestTimeoutMs = 10_000 }) {
  if (typeof model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,139}$/.test(model)) {
    throw new OpenCodeRelayError("native_model_invalid");
  }
  signal?.throwIfAborted();
  const nonce = randomBytes(32).toString("hex"), path = `/${nonce}/responses`;
  const stopped = new AbortController();
  let failure = null, attempts = 0, forwarded = 0;
  const fail = (code) => {
    if (!failure) { failure = code; onFailure(new OpenCodeRelayError(code)); }
    stopped.abort();
  };
  const server = createServer(async (request, response) => {
    // Unrelated localhost traffic cannot consume this turn or inspect its data.
    if (request.method !== "POST" || request.url !== path || request.headers.origin !== undefined) {
      response.writeHead(404); response.end(); return;
    }
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !/^Bearer [^\r\n]{1,8192}$/.test(authorization) ||
      !/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? "")) {
      response.writeHead(400); response.end(); fail("native_relay_request_invalid"); return;
    }
    if (attempts >= 1 || stopped.signal.aborted) {
      response.writeHead(409); response.end(); fail("native_request_budget_exceeded"); return;
    }
    // Reserve before reading or forwarding; concurrent retries cannot race it.
    attempts += 1;
    const aborted = AbortSignal.any([stopped.signal, ...(signal ? [signal] : []), AbortSignal.timeout(deadlineMs)]);
    const disconnect = () => { if (!response.writableFinished) stopped.abort(); };
    response.on("close", disconnect);
    request.setTimeout(requestTimeoutMs, () => { fail("native_relay_timeout"); request.destroy(); });
    try {
      let size = 0; const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 200_000) throw new OpenCodeRelayError("native_input_too_large");
        chunks.push(chunk);
      }
      aborted.throwIfAborted();
      const bytes = Buffer.concat(chunks);
      let body;
      try { body = JSON.parse(bytes.toString("utf8")); } catch { throw new OpenCodeRelayError("native_relay_request_invalid"); }
      if (!body || body.model !== model || body.store !== false || body.stream !== true ||
        !Array.isArray(body.tools) || body.tools.length !== 1 || body.tools[0]?.type !== "function" ||
        body.tools[0]?.name !== "StructuredOutput") {
        throw new OpenCodeRelayError("native_relay_scope_mismatch");
      }
      forwarded += 1;
      const upstream = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST", redirect: "manual", signal: aborted,
        headers: { authorization, "content-type": "application/json", accept: "text/event-stream" }, body: bytes,
      });
      if (!upstream.ok || !upstream.body || !/^text\/event-stream(?:;|$)/i.test(upstream.headers.get("content-type") ?? "")) {
        await upstream.body?.cancel();
        throw new OpenCodeRelayError(upstream.status >= 300 && upstream.status < 400 ? "native_redirect_refused" : "native_upstream_refused");
      }
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      let outputBytes = 0;
      for await (const chunk of upstream.body) {
        outputBytes += chunk.length;
        if (outputBytes > 256_000) throw new OpenCodeRelayError("native_output_too_large");
        aborted.throwIfAborted();
        if (!response.write(chunk)) await once(response, "drain", { signal: aborted });
      }
      response.end();
    } catch (error) {
      fail(error instanceof OpenCodeRelayError ? error.code : "native_relay_interrupted");
      if (!response.headersSent) { response.writeHead(502); response.end(); }
      else response.destroy();
    } finally { response.off("close", disconnect); }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const stop = () => { stopped.abort(); server.closeAllConnections(); };
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/${nonce}`,
    get failure() { return failure; },
    get reservedRequests() { return attempts; },
    get forwardedRequests() { return forwarded; },
    async close() {
      signal?.removeEventListener("abort", stop); stop();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
