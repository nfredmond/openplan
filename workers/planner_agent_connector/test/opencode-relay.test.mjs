import { request as httpRequest } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openCodeRelay } from "../opencode-relay.mjs";

const model = "gpt-6";
const body = { model, store: false, stream: true, tools: [{ type: "function", name: "StructuredOutput" }], input: "SYNTHETIC project" };
const headers = { authorization: "Bearer SYNTHETIC_NOT_A_KEY", "content-type": "application/json" };
const stream = () => new Response("event: response.completed\ndata: {}\n\n", { headers: { "content-type": "text/event-stream" } });
function post(relay, changes = {}) {
  return fetch(`${relay.baseUrl}/responses`, { method: "POST", headers, body: JSON.stringify(body), ...changes });
}

// A real loopback HTTP request exercises native-facing parsing. The injected
// upstream captures forwarding without sending a credential or paying a provider.
test("forwards one frozen model request without exposing a provider URL option", async () => {
  const calls = [];
  const relay = await openCodeRelay({ model, fetchImpl: async (url, init) => { calls.push({ url, init }); return stream(); } });
  try {
    const response = await post(relay); assert.equal(response.status, 200); assert.match(await response.text(), /response.completed/);
    assert.equal(relay.failure, null); assert.equal(relay.forwardedRequests, 1);
    assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
    assert.equal(calls[0].init.redirect, "manual");
    assert.deepEqual(JSON.parse(calls[0].init.body.toString()), body);
    assert.deepEqual(calls[0].init.headers, { ...headers, accept: "text/event-stream" });
    assert.equal((await post(relay)).status, 409);
    assert.equal(relay.failure, "native_request_budget_exceeded"); assert.equal(calls.length, 1);
  } finally { await relay.close(); }
});

test("unrelated origin, method and secret-path probes cannot consume a turn", async () => {
  const relay = await openCodeRelay({ model, fetchImpl: async () => stream() });
  try {
    assert.equal((await post(relay, { headers: { ...headers, origin: "https://unrelated.invalid" } })).status, 404);
    assert.equal((await fetch(relay.baseUrl + "/responses")).status, 404);
    assert.equal((await fetch(new URL("/responses", relay.baseUrl), { method: "POST", headers, body: JSON.stringify(body) })).status, 404);
    assert.equal(relay.reservedRequests, 0); assert.equal(relay.failure, null);
    const response = await post(relay, { headers: { ...headers, "x-harmless-control": "true" } });
    assert.equal(response.status, 200); await response.text(); assert.equal(relay.forwardedRequests, 1);
  } finally { await relay.close(); }
});

for (const [name, change] of [
  ["different model", { model: "gpt-other" }], ["provider storage", { store: true }],
  ["missing storage disposition", { store: undefined }], ["nonstreaming", { stream: false }],
  ["extra tool", { tools: [...body.tools, { type: "function", name: "read" }] }],
  ["wrong tool", { tools: [{ type: "function", name: "bash" }] }],
  ["wrong tool type", { tools: [{ type: "web_search", name: "StructuredOutput" }] }],
]) test(`refuses ${name} before an upstream request`, async () => {
  let calls = 0;
  const relay = await openCodeRelay({ model, fetchImpl: async () => { calls++; return stream(); } });
  try {
    assert.equal((await post(relay, { body: JSON.stringify({ ...body, ...change }) })).status, 502);
    assert.equal(relay.failure, "native_relay_scope_mismatch"); assert.equal(calls, 0);
  } finally { await relay.close(); }
});

for (const [name, changes, expected] of [
  ["missing native authentication", { headers: { "content-type": "application/json" } }, "native_relay_request_invalid"],
  ["wrong authentication scheme", { headers: { ...headers, authorization: "Basic synthetic" } }, "native_relay_request_invalid"],
  ["wrong media type", { headers: { ...headers, "content-type": "text/plain" } }, "native_relay_request_invalid"],
  ["invalid JSON", { body: "{" }, "native_relay_request_invalid"],
  ["oversized request", { body: JSON.stringify({ ...body, input: "x".repeat(200_001) }) }, "native_input_too_large"],
]) test(`refuses ${name}`, async () => {
  let calls = 0;
  const relay = await openCodeRelay({ model, fetchImpl: async () => { calls++; return stream(); } });
  try {
    assert.ok((await post(relay, changes)).status >= 400);
    assert.equal(relay.failure, expected); assert.equal(calls, 0);
  } finally { await relay.close(); }
});

for (const [name, response, expected] of [
  ["redirect", () => new Response(null, { status: 302, headers: { location: "https://unrelated.invalid" } }), "native_redirect_refused"],
  ["provider error", () => new Response("limited", { status: 429 }), "native_upstream_refused"],
  ["wrong response type", () => new Response("{}", { headers: { "content-type": "application/json" } }), "native_upstream_refused"],
  ["missing response body", () => new Response(null, { headers: { "content-type": "text/event-stream" } }), "native_upstream_refused"],
]) test(`refuses upstream ${name} without a retry`, async () => {
  const relay = await openCodeRelay({ model, fetchImpl: async () => response() });
  try {
    assert.equal((await post(relay)).status, 502); assert.equal(relay.failure, expected);
    assert.equal((await post(relay)).status, 409); assert.equal(relay.forwardedRequests, 1);
  } finally { await relay.close(); }
});

test("bounds streamed output independently of Content-Length", async () => {
  const relay = await openCodeRelay({ model, fetchImpl: async () => new Response("x".repeat(256_001), { headers: { "content-type": "text/event-stream" } }) });
  try {
    await assert.rejects(async () => { const response = await post(relay); await response.text(); });
    assert.equal(relay.failure, "native_output_too_large"); assert.equal(relay.forwardedRequests, 1);
  } finally { await relay.close(); }
});

test("concurrent native retries cannot forward a second model request", async () => {
  let release, calls = 0;
  const upstream = new Promise(resolve => { release = resolve; });
  const relay = await openCodeRelay({ model, fetchImpl: async () => { calls++; await upstream; return stream(); } });
  try {
    const first = post(relay).catch(error => error);
    while (calls === 0) await new Promise(resolve => setTimeout(resolve, 1));
    const pendingSecond = post(relay).catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 20));
    release();
    const [response, second] = await Promise.all([first, pendingSecond]);
    assert.equal(second.status, 409);
    assert.ok(response instanceof Error || response.status >= 400, "First in-flight request must not complete after the budget violation");
    if (response instanceof Response) await response.arrayBuffer().catch(() => {});
    assert.equal(relay.failure, "native_request_budget_exceeded"); assert.equal(calls, 1);
  } finally { release(); await relay.close(); }
});

test("caller cancellation aborts the upstream request and owned listener", async () => {
  const stop = new AbortController(); let upstreamSignal;
  const relay = await openCodeRelay({ model, signal: stop.signal, fetchImpl: async (_url, init) => {
    upstreamSignal = init.signal;
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  } });
  try {
    const pending = post(relay).catch(error => error);
    while (!upstreamSignal) await new Promise(resolve => setTimeout(resolve, 1));
    stop.abort(); assert.ok(await pending instanceof Error); assert.equal(upstreamSignal.aborted, true);
  } finally { await relay.close(); }
});

for (const value of [null, "", "openai/gpt-6", "x".repeat(141), "gpt\n6"]) test(`refuses invalid model ${JSON.stringify(value)}`, async () => {
  let relay;
  try { await assert.rejects(async () => { relay = await openCodeRelay({ model: value }); }, { message: "native_model_invalid" }); }
  finally { await relay?.close(); }
});


test("upstream deadline interrupts a stalled provider", { timeout: 2000 }, async () => {
  let upstreamSignal; const failures = []; const watchdog = new AbortController();
  const timer = setTimeout(() => watchdog.abort(), 200);
  const relay = await openCodeRelay({ model, signal: watchdog.signal, deadlineMs: 30, onFailure: error => failures.push(error.code), fetchImpl: async (_url, init) => {
    upstreamSignal = init.signal;
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  } });
  try {
    const response = await post(relay).catch(error => error);
    assert.equal(watchdog.signal.aborted, false, "Upstream deadline must fire before the independent watchdog");
    assert.equal(response.status, 502); assert.equal(upstreamSignal.aborted, true);
    assert.deepEqual(failures, ["native_relay_interrupted"]);
    assert.equal((await post(relay)).status, 409); assert.equal(failures.length, 1);
  } finally { clearTimeout(timer); await relay.close(); }
});

test("idle request body expires before reaching the provider", { timeout: 2000 }, async () => {
  const relay = await openCodeRelay({ model, requestTimeoutMs: 30, fetchImpl: async () => { throw Error("must not forward"); } });
  let request;
  const timer = setTimeout(() => request?.destroy(new Error("body_timeout_watchdog")), 200);
  try {
    await new Promise(resolve => {
      request = httpRequest(`${relay.baseUrl}/responses`, { method: "POST", headers: { ...headers, "content-length": "100" } });
      request.once("error", resolve); request.once("response", resolve); request.flushHeaders(); request.write("{");
    });
    assert.equal(relay.failure, "native_relay_timeout"); assert.equal(relay.forwardedRequests, 0);
  } finally { clearTimeout(timer); request?.destroy(); await relay.close(); }
});
