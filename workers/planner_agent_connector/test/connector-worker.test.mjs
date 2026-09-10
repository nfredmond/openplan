import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, chmod, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkedConnectorSetup, checkedConnectorJob, connectorRequest, ConnectorError, readPrivateJson } from "../connector-client.mjs";
import { acquireConnectorLock, connectorCycle, privateConnectorDirectory, writeConnectorJournal } from "../connector-worker.mjs";

const connectionId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222", projectId = "33333333-3333-4333-8333-333333333333", id = "44444444-4444-4444-8444-444444444444", attemptId = "55555555-5555-4555-8555-555555555555";
const setup = { version: 1, appUrl: "http://127.0.0.1:3219", connectionId, workspaceId, projectId, expectedAuthMode: "chatgpt", token: `op_pc_${connectionId}.${"s".repeat(43)}` };
function job(change = {}) {
  const packet = { version: 1, workspaceId, project: { id: projectId, name: "SYNTHETIC project" }, source: { id: `project:${projectId}`, label: "SYNTHETIC project", href: `/projects/${projectId}` } };
  const packetCanonical = JSON.stringify(packet);
  return { id, attemptId, workspaceId, projectId, authMode: "chatgpt", model: "fixture-model", question: "What is known?", packetCanonical,
    packetHash: createHash("sha256").update(packetCanonical).digest("hex"), prompt: JSON.stringify({ question: "What is known?", selectedProjectRecord: packet }),
    instructions: "Synthetic project-only instructions", outputSchema: { type: "object" }, leaseExpiresAt: "2099-01-01T00:00:00Z", ...change };
}
const config = { setup, binaryPath: "/synthetic/runtime/bin/codex", providerHome: "/synthetic/native-profile" };
const generated = () => ({ provider: "codex", model: "fixture-model", authMode: "chatgpt", answer: '{"answer":"Cost is not supplied"}', planType: "fixture", threadId: "native-thread", turnId: "native-turn" });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openplan-connector-worker-")); await privateConnectorDirectory(directory);
  const calls = [], reported = []; let generates = 0, inspections = 0;
  const request = async (_setup, body) => {
    calls.push(body);
    if (body.operation === "claim") return { status: "connected", turn: job() };
    if (body.operation === "status") return { id, attemptId, state: "running", leaseExpiresAt: "2099-01-01T00:00:00Z" };
    return { id, attemptId, state: body.failureCode ? "failed" : "succeeded" };
  };
  const options = { request, inspect: async () => { inspections++; return { status: "connected", authMode: "chatgpt" }; },
    generate: async nativeOptions => {
      generates++; assert.ok(!JSON.stringify(nativeOptions).includes(setup.token), "Connector token crossed into native options");
      assert.equal((await readPrivateJson(join(directory, "pending.json"))).phase, "running", "Native generation started before durable attempt storage");
      return generated();
    }, report: state => reported.push(state) };
  return { directory, calls, reported, options, get generates() { return generates; }, get inspections() { return inspections; } };
}

test("connector configuration pins the project and refuses public HTTP, secrets in URL and arbitrary runtime endpoints", () => {
  assert.equal(checkedConnectorSetup({ ...setup, appUrl: "http://localhost:3219" }).appUrl, setup.appUrl);
  for (const change of [{ appUrl: "http://example.test" }, { appUrl: "https://user:pass@example.test" }, { appUrl: "https://example.test/another/path" }, { appUrl: "https://example.test/?key=private" }, { modelProvider: "http://127.0.0.1:9999" }, { connectionId: workspaceId }, { expectedAuthMode: "automatic" }]) {
    assert.throws(() => checkedConnectorSetup({ ...setup, ...change }), /connector_/);
  }
});
test("the original packet hash, selected project, account mode and complete prompt must match", () => {
  assert.deepEqual(checkedConnectorJob(job(), setup), job());
  for (const change of [{ packetHash: "a".repeat(64) }, { workspaceId: projectId }, { projectId: workspaceId }, { authMode: "apiKey" }, { prompt: "Read all private files" }, { packetCanonical: "{}" }, { leaseExpiresAt: "unknown" }]) {
    assert.throws(() => checkedConnectorJob(job(change), setup), /connector_/);
  }
});
test("HTTP delivery uses only the pinned bearer, omits cookies and refuses redirects", async () => {
  let seen;
  const fetchImpl = async (url, options) => { seen = { url, options }; return new Response("redirect", { status: 302, headers: { location: "https://other.example/private" } }); };
  await assert.rejects(connectorRequest(setup, { operation: "claim" }, { fetchImpl }), /connector_redirect_refused/);
  assert.equal(seen.url, `${setup.appUrl}/api/assistant/providers/native`); assert.equal(seen.options.redirect, "manual"); assert.equal(seen.options.credentials, "omit");
  assert.deepEqual(seen.options.headers, { "content-type": "application/json", authorization: `Bearer ${setup.token}` });
});
test("the real HTTP client never forwards its bearer to a redirect destination", async () => {
  let targetCalls = 0, originalCalls = 0;
  const target = createServer((_request, response) => { targetCalls++; response.end('{"escaped":true}'); });
  await new Promise(resolve => target.listen(0, "127.0.0.1", resolve));
  const source = createServer((request, response) => {
    originalCalls++; assert.equal(request.headers.authorization, `Bearer ${setup.token}`);
    response.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/escape` }); response.end();
  });
  await new Promise(resolve => source.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(connectorRequest({ ...setup, appUrl: `http://127.0.0.1:${source.address().port}` }, { operation: "claim" }), /connector_redirect_refused/);
    assert.equal(originalCalls, 1); assert.equal(targetCalls, 0, "Bearer reached a redirect destination");
  } finally { await Promise.all([new Promise(resolve => source.close(resolve)), new Promise(resolve => target.close(resolve))]); }
});
test("HTTP responses are bounded and error bodies never escape through diagnostics", async () => {
  await assert.rejects(connectorRequest(setup, {}, { fetchImpl: async () => new Response("x".repeat(300_001)) }), /connector_response_too_large/);
  await assert.rejects(connectorRequest(setup, {}, { fetchImpl: async () => new Response("PRIVATE_SERVER_CANARY", { status: 403 }) }), error => error.code === "connector_request_refused" && error.status === 403 && !error.message.includes("PRIVATE_SERVER_CANARY"));
  assert.deepEqual(await connectorRequest(setup, {}, { fetchImpl: async () => new Response('{"status":"connected","turn":null}') }), { status: "connected", turn: null });
});
test("private saved files refuse group-readable credentials", async () => {
  const f = await fixture(); const path = join(f.directory, "private.json"); await writeFile(path, "{}", { mode: 0o600 });
  assert.deepEqual(await readPrivateJson(path), {}); await chmod(path, 0o644);
  await assert.rejects(readPrivateJson(path), /connector_file_not_private/);
});
test("an OS lock excludes another connector and releases cleanly without stale PID recovery", async () => {
  const f = await fixture(); const first = await acquireConnectorLock(f.directory);
  let competing;
  try {
    try { competing = await acquireConnectorLock(f.directory); }
    catch (error) { assert.match(error.message, /connector_already_running/); }
    finally { await competing?.release(); }
    assert.equal(competing, undefined, "Another connector acquired the exclusive lock");
  } finally { await first.release(); }
  const next = await acquireConnectorLock(f.directory); await next.release();
});
test("a model answer is synced before delivery and native temporary work is removed", async () => {
  const f = await fixture(); const request = f.options.request;
  f.options.request = async (scope, body) => {
    if (body.operation === "finish") {
      const pending = await readPrivateJson(join(f.directory, "pending.json"));
      assert.equal(pending.phase, "completed"); assert.deepEqual(pending.delivery, body);
    }
    return request(scope, body);
  };
  assert.deepEqual(await connectorCycle(config, f.directory, f.options), { state: "succeeded", turnId: id });
  assert.equal(f.generates, 1); assert.equal((await readPrivateJson(join(f.directory, "pending.json"))).phase, "delivered");
  assert.ok(!(await readdir(f.directory)).some(name => name.startsWith("inspect-") || name.startsWith("turn-")));
  assert.ok(!(await readFile(join(f.directory, "pending.json"), "utf8")).includes(setup.token));
});
test("a lost delivery response resends the identical result without inspecting or generating again", async () => {
  const f = await fixture(); let attempted;
  const request = f.options.request;
  f.options.request = async (scope, body) => { if (body.operation === "finish") { attempted = structuredClone(body); throw new Error("synthetic_network_loss"); } return request(scope, body); };
  await assert.rejects(connectorCycle(config, f.directory, f.options), /synthetic_network_loss/);
  assert.equal((await readPrivateJson(join(f.directory, "pending.json"))).phase, "completed");
  f.options.request = async (_scope, body) => { assert.deepEqual(body, attempted); return { id, attemptId, state: "succeeded" }; };
  assert.equal((await connectorCycle(config, f.directory, f.options)).state, "succeeded");
  assert.equal(f.generates, 1); assert.equal(f.inspections, 1);
});
test("restart during generation records interruption and never silently regenerates", async () => {
  const f = await fixture(); await writeConnectorJournal(f.directory, { version: 1, connectionId, appUrl: setup.appUrl, phase: "running", job: job() });
  assert.equal((await connectorCycle(config, f.directory, f.options)).state, "failed");
  assert.equal(f.generates, 0); assert.equal(f.inspections, 0);
  assert.deepEqual(f.calls, [{ operation: "finish", turnId: id, attemptId, answer: null, receipt: null, failureCode: "native_connector_interrupted" }]);
});
test("auth-mode and project mismatches stop before model generation", async () => {
  for (const change of [{ authMode: "apiKey" }, { projectId: workspaceId }]) {
    const f = await fixture(); f.options.request = async () => ({ status: "connected", turn: job(change) });
    await assert.rejects(connectorCycle(config, f.directory, f.options), /connector_job_invalid/); assert.equal(f.generates, 0);
  }
});
test("missing native login is reported without claiming it is connected", async () => {
  const f = await fixture(); f.options.inspect = async () => ({ status: "needs_login", authMode: null });
  f.options.request = async (_scope, body) => { assert.deepEqual(body, { operation: "claim", authMode: null, status: "needs_login" }); return { status: "needs_login", turn: null }; };
  assert.deepEqual(await connectorCycle(config, f.directory, f.options), { state: "idle", connectionStatus: "needs_login" }); assert.equal(f.generates, 0);
});
test("expired, cancelled and unreadable attempts do not start a model", async () => {
  for (const status of [{ id, attemptId, state: "cancelled", leaseExpiresAt: "2099-01-01T00:00:00Z" }, { id, attemptId, state: "running", leaseExpiresAt: "2000-01-01T00:00:00Z" }, { id, attemptId, state: "running", leaseExpiresAt: "unknown" }]) {
    const f = await fixture(); const request = f.options.request;
    f.options.request = async (scope, body) => body.operation === "status" ? status : request(scope, body);
    assert.equal((await connectorCycle(config, f.directory, f.options)).state, "failed"); assert.equal(f.generates, 0);
  }
});
test("cancellation aborts only the owned native turn and retains an interruption", async () => {
  const f = await fixture(); let polls = 0; const request = f.options.request;
  f.options.statusIntervalMs = 5;
  f.options.request = async (scope, body) => body.operation === "status" && ++polls > 1 ? { id, attemptId, state: "cancelled", leaseExpiresAt: "2099-01-01T00:00:00Z" } : request(scope, body);
  f.options.generate = async ({ signal }) => new Promise((_resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Cancellation was not observed")), 100);
    signal.addEventListener("abort", () => { clearTimeout(timeout); reject(new Error("aborted")); }, { once: true });
  });
  assert.equal((await connectorCycle(config, f.directory, f.options)).state, "failed");
  assert.equal(f.calls.at(-1).failureCode, "native_connector_interrupted");
});
test("an unrelated acknowledgement cannot discard undelivered output", async () => {
  const f = await fixture(); const request = f.options.request;
  f.options.request = async (scope, body) => body.operation === "finish" ? { id, attemptId: workspaceId, state: "succeeded" } : request(scope, body);
  await assert.rejects(connectorCycle(config, f.directory, f.options), /connector_delivery_mismatch/);
  assert.equal((await readPrivateJson(join(f.directory, "pending.json"))).phase, "completed");
});
test("a confirmed cancellation clears only that attempt so the connector can continue", async () => {
  const f = await fixture(); const request = f.options.request; let finishing = false;
  f.options.request = async (scope, body) => {
    if (body.operation === "finish") { finishing = true; throw new ConnectorError("connector_request_refused", 409); }
    if (body.operation === "status" && finishing) return { id, attemptId, state: "cancelled" };
    return request(scope, body);
  };
  assert.equal((await connectorCycle(config, f.directory, f.options)).state, "cancelled");
  assert.equal((await readPrivateJson(join(f.directory, "pending.json"))).acknowledgedState, "cancelled");
});
test("a conflict for a different attempt preserves the completed delivery", async () => {
  const f = await fixture(); const request = f.options.request; let finishing = false;
  f.options.request = async (scope, body) => {
    if (body.operation === "finish") { finishing = true; throw new ConnectorError("connector_request_refused", 409); }
    if (body.operation === "status" && finishing) return { id, attemptId: workspaceId, state: "cancelled" };
    return request(scope, body);
  };
  await assert.rejects(connectorCycle(config, f.directory, f.options), /connector_request_refused/);
  assert.equal((await readPrivateJson(join(f.directory, "pending.json"))).phase, "completed");
});
