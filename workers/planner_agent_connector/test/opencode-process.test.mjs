import { test as nodeTest, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { startOpenCodeServer } from "../opencode-process.mjs";

const test = (name, fn) => nodeTest(name, { timeout: 2000 }, fn);
const fixtures = [];
// Deliberately broken shutdown code must not strand a fixture or prevent the
// next mutation from running. These PIDs come only from this test's children.
afterEach(async () => {
  for (const receipt of fixtures.splice(0)) {
    const owned = await receipt().catch(() => null);
    if (owned) {
      try { process.kill(owned.pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  }
});

async function fixture(mode = "normal") {
  const root = await mkdtemp(join(tmpdir(), "openplan-opencode-process-"));
  const receiptPath = join(root, "receipt.json");
  const receipt = async () => JSON.parse(await readFile(receiptPath, "utf8"));
  fixtures.push(receipt);
  return { receipt,
    launch: { account: { status: "connected", authMode: "opencode_api" }, command: process.execPath,
      args: [fileURLToPath(new URL("./fixtures/opencode-server.mjs", import.meta.url))],
      options: { cwd: root, stdio: ["pipe", "pipe", "pipe"], shell: false,
        env: { MODE: mode, RECEIPT_PATH: receiptPath, OPENCODE_SERVER_PASSWORD: "b".repeat(64), OPENCODE_SERVER_USERNAME: "openplan" } } } };
}

function gone(pid) { assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "owned child is still running"); }

test("authenticates startup and requests, then waits for owned child exit", async () => {
  const f = await fixture("splitBanner"), server = await startOpenCodeServer(f.launch);
  try {
    assert.deepEqual(await server.request("/session", { method: "POST", body: { title: "SYNTHETIC" } }),
      { id: "ses_synthetic", received: { title: "SYNTHETIC" } });
    await server.request("/session/ses_synthetic/message/msg_synthetic");
    const receipt = await f.receipt();
    assert.equal(receipt.requests.length, 3);
    assert.ok(receipt.requests.every(item => item.authenticated));
    assert.equal(server.failure, null);
  } finally { await server.close(); }
  gone((await f.receipt()).pid);
  await server.close();
  await assert.rejects(server.request("/global/health"), { message: "native_process_closed" });
});

for (const [mode, code] of [
  ["earlyExit", "native_process_exited"], ["noBanner", "native_startup_timeout"],
  ["wrongOrigin", "native_origin_invalid"], ["duplicateBanner", "native_origin_invalid"],
  ["invalidPort", "native_origin_invalid"], ["zeroPort", "native_origin_invalid"],
  ["stdoutOverflow", "native_output_too_large"], ["stderrOverflow", "native_stderr_too_large"],
  ["rejectAuth", "native_http_failed"], ["emptyHealth", "native_http_failed"],
  ["unhealthy", "native_health_invalid"], ["wrongVersion", "native_health_invalid"],
]) test(`startup refusal: ${mode}`, async () => {
  const f = await fixture(mode);
  await assert.rejects(startOpenCodeServer(f.launch, { startupTimeoutMs: 500, killGraceMs: 30 }), { message: code });
  gone((await f.receipt()).pid);
});

test("missing binary has a fixed error and no retained child", async () => {
  const f = await fixture(); f.launch.command = "/nonexistent/openplan-native-binary";
  await assert.rejects(startOpenCodeServer(f.launch), { message: "native_process_unavailable" });
  await assert.rejects(f.receipt(), { code: "ENOENT" });
});

for (const mode of ["needs_login", "unsupported_auth_mode", "wrong_backend"]) test(`refuses account before spawning: ${mode}`, async () => {
  const f = await fixture();
  if (mode === "wrong_backend") f.launch.account.authMode = "apiKey";
  else f.launch.account.status = mode;
  await assert.rejects(startOpenCodeServer(f.launch), { message: "native_account_unavailable" });
  await assert.rejects(f.receipt(), { code: "ENOENT" });
});

for (const key of ["OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME"]) test(`refuses weak native server configuration: ${key}`, async () => {
  const f = await fixture(); f.launch.options.env[key] = "wrong";
  await assert.rejects(startOpenCodeServer(f.launch), { message: "native_server_secret_invalid" });
  await assert.rejects(f.receipt(), { code: "ENOENT" });
});

test("already-cancelled startup does not spawn", async () => {
  const f = await fixture(), controller = new AbortController(); controller.abort();
  const original = childProcess.spawn; let spawns = 0;
  childProcess.spawn = function (...args) { spawns += 1; return original.apply(this, args); };
  syncBuiltinESMExports();
  try {
    await assert.rejects(startOpenCodeServer(f.launch, { signal: controller.signal }), { message: "native_cancelled" });
    assert.equal(spawns, 0, "already-cancelled startup spawned a child");
  } finally { childProcess.spawn = original; syncBuiltinESMExports(); }
  await assert.rejects(f.receipt(), { code: "ENOENT" });
});

test("cancellation terminates a held request and waits for child exit", async () => {
  const f = await fixture("stall"), controller = new AbortController();
  const server = await startOpenCodeServer(f.launch, { signal: controller.signal });
  const pending = server.request("/session", { method: "POST", body: {} });
  controller.abort();
  await assert.rejects(pending, { message: "native_cancelled" });
  await server.close(); gone((await f.receipt()).pid);
});

test("shutdown escalates when the owned child ignores termination", async () => {
  const f = await fixture("ignoreTerm"), server = await startOpenCodeServer(f.launch, { killGraceMs: 30 });
  await server.close(); const receipt = await f.receipt();
  assert.equal(receipt.terminated, true); gone(receipt.pid);
});

test("unexpected exit remains a failure after startup", async () => {
  const f = await fixture("laterExit"), server = await startOpenCodeServer(f.launch);
  await delay(150);
  assert.equal(server.failure, "native_process_exited");
  await assert.rejects(server.request("/global/health"), { message: "native_process_exited" });
  await server.close(); gone((await f.receipt()).pid);
});

test("lifetime expiry stops an otherwise healthy server", async () => {
  const f = await fixture(), server = await startOpenCodeServer(f.launch, { lifetimeMs: 200 });
  await delay(250);
  assert.equal(server.failure, "native_timeout");
  await server.close(); gone((await f.receipt()).pid);
});

for (const [mode, code] of [["redirect", "native_http_failed"], ["wrongType", "native_http_failed"], ["errorStatus", "native_http_failed"],
  ["badJson", "native_http_failed"], ["oversized", "native_output_too_large"], ["stall", "native_request_timeout"]]) {
  test(`request refusal: ${mode}`, async () => {
    const f = await fixture(mode), server = await startOpenCodeServer(f.launch, { requestTimeoutMs: 200 });
    await assert.rejects(server.request("/session", { method: "POST", body: {} }), { message: code });
    await server.close(); const receipt = await f.receipt(); gone(receipt.pid);
    assert.ok(!receipt.requests.some(item => item.path === "/redirect-target"));
  });
}

test("unrelated routes and oversized input never reach the native server", async () => {
  const f = await fixture(), server = await startOpenCodeServer(f.launch);
  try {
    for (const [path, options] of [["/provider", {}], ["//example.com", {}], ["/session", { method: "DELETE" }],
      ["/session", { method: "POST", body: [] }], ["/global/health", { body: {} }],
      ["/session/ses_synthetic/message", {}]]) {
      await assert.rejects(server.request(path, options), { message: "native_request_invalid" });
    }
    const cyclic = {}; cyclic.self = cyclic;
    await assert.rejects(server.request("/session", { method: "POST", body: cyclic }), { message: "native_request_invalid" });
    await assert.rejects(server.request("/session", { method: "POST", body: { text: "x".repeat(200001) } }), { message: "native_input_too_large" });
    assert.equal((await f.receipt()).requests.length, 1);
    assert.equal(server.failure, null);
    await server.request("/session", { method: "POST", body: { title: "SYNTHETIC control after refusals" } });
  } finally { await server.close(); }
});
