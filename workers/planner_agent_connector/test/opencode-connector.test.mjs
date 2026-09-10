import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkedConnectorSetup, checkedConnectorJob, readPrivateJson } from "../connector-client.mjs";
import { connectorProviderAdapter } from "../native-provider.mjs";
import { inspectOpenCodeConnection, runOpenCodeProjectTurn } from "../opencode-provider.mjs";
import { inspectCodexConnection, runCodexProjectTurn } from "../codex-provider.mjs";
import { inspectClaudeConnection, runClaudeProjectTurn } from "../claude-provider.mjs";
import { connectorCycle, writeConnectorJournal } from "../connector-worker.mjs";

const connectionId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const id = "44444444-4444-4444-8444-444444444444";
const attemptId = "55555555-5555-4555-8555-555555555555";
const setup = { version: 2, provider: "opencode", appUrl: "http://127.0.0.1:3219", connectionId, workspaceId, projectId,
  expectedAuthMode: "opencode_api", token: `op_pc_${connectionId}.${"s".repeat(43)}` };
const config = { setup, binaryPath: "/synthetic/opencode", providerHome: "/synthetic/profile" };
const packet = { version: 1, workspaceId, project: { id: projectId, name: "SYNTHETIC project" },
  source: { id: `project:${projectId}`, href: `/projects/${projectId}`, label: "SYNTHETIC project" } };
const packetCanonical = JSON.stringify(packet);
const job = { id, attemptId, workspaceId, projectId, provider: "opencode", authMode: "opencode_api", model: "gpt-6-astra",
  packetCanonical, packetHash: createHash("sha256").update(packetCanonical).digest("hex"), question: "What is known?",
  prompt: JSON.stringify({ question: "What is known?", selectedProjectRecord: packet }), instructions: "SYNTHETIC instructions",
  outputSchema: { type: "object" }, leaseExpiresAt: "2099-01-01T00:00:00Z" };
const answer = { provider: "opencode", authMode: "opencode_api", model: job.model, planType: null,
  answer: '{"answer":"Cost not supplied"}', threadId: "fixture-session", turnId: "fixture-turn" };

for (const provider of ["codex", "claude", "opencode", "anthropic", "unknown"]) {
  for (const mode of ["chatgpt", "apiKey", "claude_subscription", "opencode_api", "automatic"]) {
    test(`setup provider/account binding: ${provider}/${mode}`, () => {
      const candidate = { ...setup, provider, expectedAuthMode: mode };
      const valid = provider === "codex" && ["chatgpt", "apiKey"].includes(mode) ||
        provider === "claude" && mode === "claude_subscription" || provider === "opencode" && mode === "opencode_api";
      if (valid) assert.deepEqual(checkedConnectorSetup(candidate), candidate);
      else assert.throws(() => checkedConnectorSetup(candidate), /connector_config_invalid/);
    });
  }
}

test("OpenCode requires version two and explicit provider identity", () => {
  const { provider, ...implicit } = setup;
  assert.equal(provider, "opencode");
  for (const candidate of [{ ...setup, version: 1 }, { ...implicit, version: 1 }, implicit]) {
    assert.throws(() => checkedConnectorSetup(candidate), /connector_config_invalid/);
  }
});

test("dispatch selects the actual OpenCode functions and preserves Codex and Claude adapters", () => {
  assert.deepEqual(connectorProviderAdapter(setup), { provider: "opencode", inspect: inspectOpenCodeConnection, generate: runOpenCodeProjectTurn });
  assert.deepEqual(connectorProviderAdapter({ ...setup, provider: "codex", expectedAuthMode: "chatgpt" }),
    { provider: "codex", inspect: inspectCodexConnection, generate: runCodexProjectTurn });
  assert.deepEqual(connectorProviderAdapter({ ...setup, provider: "claude", expectedAuthMode: "claude_subscription" }),
    { provider: "claude", inspect: inspectClaudeConnection, generate: runClaudeProjectTurn });
  assert.throws(() => connectorProviderAdapter({ ...setup, expectedAuthMode: "apiKey" }), /connector_config_invalid/);
});

test("OpenCode packets cannot omit or switch provider or account mode", () => {
  assert.deepEqual(checkedConnectorJob(job, setup), job);
  for (const change of [{ provider: undefined }, { provider: "codex" }, { provider: "claude" }, { authMode: "apiKey" },
    { authMode: "claude_subscription" }, { projectId: workspaceId }]) {
    assert.throws(() => checkedConnectorJob({ ...job, ...change }, setup), /connector_job_invalid/);
  }
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "openplan-opencode-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let inspections = 0, generations = 0;
  const calls = [];
  const options = {
    inspect: async () => { inspections++; return { status: "connected", authMode: "opencode_api" }; },
    generate: async native => {
      generations++;
      assert.equal(native.expectedAuthMode, "opencode_api");
      assert.equal(native.model, job.model);
      assert.equal(native.prompt, job.prompt);
      assert.equal((await readPrivateJson(join(directory, "pending.json"))).phase, "running");
      return answer;
    },
    request: async (scope, body) => {
      assert.deepEqual(scope, setup);
      calls.push(structuredClone(body));
      if (body.operation === "claim") return { status: "connected", turn: job };
      if (body.operation === "status") return { id, attemptId, state: "running", leaseExpiresAt: job.leaseExpiresAt };
      return { id, attemptId, state: body.failureCode ? "failed" : "succeeded" };
    },
  };
  return { directory, options, calls, get inspections() { return inspections; }, get generations() { return generations; } };
}

test("OpenCode claim and saved delivery retain exact mode, model and answer through response loss", async t => {
  const f = await fixture(t), request = f.options.request;
  let delivery;
  f.options.request = async (scope, body) => {
    if (body.operation === "finish") {
      delivery = structuredClone(body);
      assert.deepEqual((await readPrivateJson(join(f.directory, "pending.json"))).delivery, body);
      throw new Error("synthetic_response_loss");
    }
    return request(scope, body);
  };
  await assert.rejects(connectorCycle(config, f.directory, f.options), /synthetic_response_loss/);
  assert.deepEqual(f.calls[0], { operation: "claim", status: "connected", authMode: "opencode_api" });
  assert.equal(delivery.answer, answer.answer);
  assert.deepEqual(delivery.receipt, { schemaVersion: 1, provider: "opencode", model: job.model, authMode: "opencode_api",
    planType: null, threadId: answer.threadId, turnId: answer.turnId });
  assert.equal((await readPrivateJson(join(f.directory, "pending.json"))).phase, "completed");
  f.options.request = async (_scope, body) => { assert.deepEqual(body, delivery); return { id, attemptId, state: "succeeded" }; };
  assert.deepEqual(await connectorCycle(config, f.directory, f.options), { state: "succeeded", turnId: id });
  assert.equal(f.inspections, 1); assert.equal(f.generations, 1);
  assert.equal((await readPrivateJson(join(f.directory, "pending.json"))).phase, "delivered");
  assert.deepEqual((await readdir(f.directory)).filter(name => /^(inspect|turn)-/.test(name)), []);
});

for (const field of ["provider", "authMode", "model"]) {
  test(`OpenCode rejects a changed result ${field} without retaining its answer`, async t => {
    const f = await fixture(t);
    f.options.generate = async () => ({ ...answer, [field]: "wrong" });
    assert.equal((await connectorCycle(config, f.directory, f.options)).state, "failed");
    assert.deepEqual(f.calls.at(-1), { operation: "finish", turnId: id, attemptId, answer: null, receipt: null, failureCode: "native_result_mismatch" });
  });
}

test("OpenCode refuses a changed inspected account before starting generation", async t => {
  const f = await fixture(t);
  f.options.inspect = async () => ({ status: "connected", authMode: "apiKey" });
  await assert.rejects(connectorCycle(config, f.directory, f.options), /connector_auth_mode_changed/);
  assert.equal(f.generations, 0);
});

test("OpenCode crash recovery reports interruption without another account inspection or generation", async t => {
  const f = await fixture(t);
  await writeConnectorJournal(f.directory, { version: 1, connectionId, appUrl: setup.appUrl, phase: "running", job });
  assert.equal((await connectorCycle(config, f.directory, f.options)).state, "failed");
  assert.equal(f.inspections, 0); assert.equal(f.generations, 0);
  assert.deepEqual(f.calls, [{ operation: "finish", turnId: id, attemptId, answer: null, receipt: null, failureCode: "native_connector_interrupted" }]);
});

test("OpenCode cannot replay a saved request through a different native provider", async t => {
  const f = await fixture(t);
  await writeConnectorJournal(f.directory, { version: 1, connectionId, appUrl: setup.appUrl, phase: "running", job });
  await assert.rejects(connectorCycle({ ...config, setup: { ...setup, provider: "codex", expectedAuthMode: "apiKey" } }, f.directory, f.options), /connector_job_invalid/);
  assert.equal(f.inspections, 0); assert.equal(f.generations, 0); assert.equal(f.calls.length, 0);
});
