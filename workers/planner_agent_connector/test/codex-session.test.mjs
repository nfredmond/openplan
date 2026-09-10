import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { startCodexSession } from "../codex-session.mjs";
const fixture = fileURLToPath(new URL("./fake-app-server.mjs", import.meta.url));
function session(mode, options = {}) {
  return startCodexSession({ command: process.execPath, args: [fixture, mode], options: { stdio: ["pipe", "pipe", "pipe"], shell: false, env: {} } }, { timeoutMs: 2_000, ...options });
}

function observed(promise) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The protocol request never settled")), 1000);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

for (const [mode, code] of [
  ["malformed", "native_protocol_invalid"], ["unfinished", "native_stream_interrupted"],
  ["empty-response", "native_protocol_invalid"], ["wrong-id", "native_response_unmatched"],
  ["oversized", "native_frame_too_large"], ["hang", "native_timeout"],
]) {
  test(`refuses ${mode} instead of reporting a completed answer`, async () => {
    const provider = session(mode, mode === "hang" ? { timeoutMs: 100 } : {});
    try { await assert.rejects(observed(provider.request("initialize", {})), { code }); }
    finally { await provider.close(); }
  });
}

test("retains a final event that arrives before the correlated start response", async () => {
  const provider = session("success");
  try {
    assert.equal((await provider.request("initialize", {})).version, "fixture");
    await provider.request("turn/start", {});
    const final = await provider.waitFor("turn/completed", (event) => event.threadId === "thread" && event.turn.id === "turn");
    assert.equal(final.turn.status, "completed");
  } finally { await provider.close(); }
});

test("EOF after a start acknowledgement does not create a final receipt", async () => {
  const provider = session("lost-final");
  try {
    await provider.request("initialize", {});
    await provider.request("turn/start", {});
    await assert.rejects(observed(provider.waitFor("turn/completed")), { code: "native_stream_interrupted" });
  } finally { await provider.close(); }
});

test("cancellation ends the owned process and refuses pending work", async () => {
  const controller = new AbortController();
  const provider = session("hang", { signal: controller.signal });
  try {
    const pending = provider.request("initialize", {});
    controller.abort();
    await assert.rejects(pending, { code: "native_cancelled" });
  } finally { await provider.close(); }
});

test("provider permission requests cannot become business or host approval", async () => {
  let calls = 0;
  const provider = session("approval", { onToolCall: async () => { calls++; return {}; } });
  try {
    await provider.request("initialize", {});
    await provider.request("turn/start", {});
    const reply = await provider.request("inspect", {});
    assert.equal(reply.id, "permission-1");
    assert.deepEqual(reply.error, { code: -32601, message: "Unsupported project connector request" }, "Provider permission request was not refused");
    assert.equal(calls, 0);
  } finally { await provider.close(); }
});

test("dynamic calls use the supplied project tool callback", async () => {
  const calls = [];
  const provider = session("tool", { onToolCall: async (params) => {
    calls.push(params); return { success: true, contentItems: [{ type: "inputText", text: "Selected project only" }] };
  } });
  try {
    await provider.request("initialize", {});
    await provider.request("turn/start", {});
    const reply = await provider.request("inspect", {});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tool, "read_selected_project");
    assert.equal(reply.result.contentItems[0].text, "Selected project only");
  } finally { await provider.close(); }
});
