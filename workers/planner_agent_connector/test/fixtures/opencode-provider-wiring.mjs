import { mock } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

const mode = process.argv[2], model = "gpt-6-astra";
const sessionId = `ses_${"A".repeat(26)}`, turnId = `msg_${"C".repeat(26)}`;
const output = { answer: "SYNTHETIC wiring answer", citations: [], submittal: null };
const options = { binaryPath: "/synthetic/native", providerHome: "/synthetic/profile", scratchPath: "/synthetic/scratch",
  model, expectedAuthMode: "opencode_api", instructions: "SYNTHETIC frozen instructions", prompt: "SYNTHETIC frozen packet",
  outputSchema: { type: "object", additionalProperties: false }, includeModels: mode !== "inspectNoModels" };
const controller = new AbortController(); options.signal = controller.signal;
const trace = { models: 0, requests: 0, closes: [], violations: [], relayCreated: false };
const check = (actual, expected, label) => { if (!isDeepStrictEqual(actual, expected)) trace.violations.push(label); };
const account = ["needsLogin", "inspectMissing"].includes(mode) ? { status: "needs_login", authMode: null, planType: null } :
  mode === "unsupported" ? { status: "unsupported_auth_mode", authMode: null, planType: null } :
  { status: "connected", authMode: mode === "changedMode" ? "apiKey" : "opencode_api", planType: null };
const launch = { account };
let relayOptions, nativeSignal, turn;
const relay = { baseUrl: `http://127.0.0.1:12345/${"a".repeat(64)}`, forwardedRequests: 0, failure: null,
  close: async () => { await new Promise(resolve => setTimeout(resolve, 5));
    trace.closes.push("relay"); if (mode === "lateRelayFailure") relay.failure = "native_relay_interrupted"; } };
const server = { failure: null, close: async () => {
  await new Promise(resolve => setTimeout(resolve, 15));
  trace.closes.push("server"); if (mode === "lateServerFailure") server.failure = "native_timeout";
  if (mode === "lateCancellation") controller.abort();
  if (mode === "serverCloseFailure") throw Object.assign(new Error("native_process_close_failed"), { code: "native_process_close_failed" });
}, request: async (path, args = {}) => {
  trace.requests += 1;
  if (mode === "callerCancellation") controller.abort();
  if (["relayFailure", "callerCancellation"].includes(mode)) {
    relay.failure = "native_relay_upstream_invalid"; relayOptions.onFailure();
    check(nativeSignal.aborted, true, "relay failure did not cancel native process");
    throw Object.assign(new Error("native_http_failed"), { code: "native_http_failed" });
  }
  if (path === "/session") {
    check(args.method, "POST", "session method");
    check(args.body.permission, [{ permission: "*", pattern: "*", action: "deny" },
      { permission: "StructuredOutput", pattern: "*", action: "allow" }], "session permissions");
    return { id: mode === "badSession" ? "bad" : sessionId };
  }
  if (args.method === "POST") {
    check(path, `/session/${sessionId}/message`, "turn session path");
    check(args.body.model, { providerID: "openai", modelID: model }, "turn model");
    check(args.body.agent, "openplan", "turn agent");
    check(args.body.system, options.instructions, "frozen instructions");
    check(args.body.format, { type: "json_schema", schema: options.outputSchema, retryCount: 0 }, "output schema and no retries");
    check(args.body.parts, [{ type: "text", text: options.prompt }], "frozen prompt");
    check(/^msg_[a-zA-Z0-9]{26}$/.test(args.body.messageID), true, "supplied parent ID");
    const id = mode === "badTurn" ? "bad" : turnId;
    const part = (type, letter, extra = {}) => ({ type, id: `prt_${letter.repeat(26)}`, sessionID: sessionId, messageID: id, ...extra });
    turn = { info: { id, sessionID: sessionId, parentID: args.body.messageID, role: "assistant", modelID: model, providerID: "openai",
      agent: "openplan", mode: "openplan", path: { cwd: "/work/task" }, time: { created: 100, completed: 200 }, finish: "tool-calls", structured: output },
      parts: [part("step-start", "D"), part("tool", "E", { tool: "StructuredOutput", callID: "call_synthetic",
        state: { status: "completed", input: output, metadata: { valid: true }, time: { start: 120, end: 180 } } }),
      part("step-finish", "F", { reason: "tool-calls" })] };
    relay.forwardedRequests = mode === "zeroBudget" ? 0 : 1;
    return turn;
  }
  check(path, `/session/${sessionId}/message/${turnId}`, "exact readback path");
  const readback = structuredClone(turn);
  if (mode === "changedReadback") readback.info.structured.answer = "CHANGED";
  return readback;
} };

mock.module(new URL("../../opencode-launch.mjs", import.meta.url).href, { namedExports: {
  OPENCODE_PROTOCOL_VERSION: "1.18.30", openCodeLaunch: async value => {
    check(value.binaryPath, options.binaryPath, "binary binding"); check(value.providerHome, options.providerHome, "profile binding");
    check(value.scratchPath, options.scratchPath, "scratch binding");
    check(/^[a-f0-9]{64}$/.test(value.serverPassword), true, "server secret");
    if (!mode.startsWith("inspect")) check(value.relayUrl, relay.baseUrl, "relay binding");
    return launch;
  },
} });
mock.module(new URL("../../opencode-models.mjs", import.meta.url).href, { namedExports: {
  inspectOpenCodeModels: async value => { trace.models += 1; check(value, launch, "catalog uses inspected launch");
    return mode === "unknownModel" ? [] : [{ id: model, label: model, isDefault: false }]; },
} });
mock.module(new URL("../../opencode-relay.mjs", import.meta.url).href, { namedExports: {
  openCodeRelay: async value => { relayOptions = value; trace.relayCreated = true; check(value.model, model, "relay model"); return relay; },
} });
mock.module(new URL("../../opencode-process.mjs", import.meta.url).href, { namedExports: {
  startOpenCodeServer: async (value, { signal }) => { nativeSignal = signal; check(value, launch, "server uses inspected launch"); return server; },
} });
const { inspectOpenCodeConnection, runOpenCodeProjectTurn } = await import("../../opencode-provider.mjs");
const errors = { needsLogin: "native_needs_login", unsupported: "native_unsupported_auth_mode", changedMode: "native_auth_mode_changed",
  unknownModel: "native_model_unavailable", badSession: "native_protocol_invalid", badTurn: "native_protocol_invalid",
  zeroBudget: "native_request_budget_mismatch", relayFailure: "native_relay_upstream_invalid", lateRelayFailure: "native_relay_interrupted",
  lateServerFailure: "native_timeout", changedReadback: "native_result_mismatch", serverCloseFailure: "native_process_close_failed",
  callerCancellation: "native_cancelled", lateCancellation: "native_cancelled" };
if (mode.startsWith("inspect")) {
  const result = await inspectOpenCodeConnection(options);
  check(result.status, account.status, "inspection status"); check(result.authMode, account.authMode, "inspection mode");
  check(result.nativeVersion, "1.18.30", "inspection version");
  check(trace.models, mode === "inspectGood" ? 1 : 0, "inspection model opt-in");
  check(trace.relayCreated, false, "inspection must not open generating relay");
  if (mode === "inspectGood") { check(result.models.length, 1, "returned catalog"); check(result.modelsTruncated, false, "catalog completeness"); }
} else {
  if (errors[mode]) await assert.rejects(runOpenCodeProjectTurn(options), { message: errors[mode] });
  else assert.deepEqual(await runOpenCodeProjectTurn(options), {
    provider: "opencode", model, authMode: "opencode_api", planType: null, threadId: sessionId, turnId, answer: JSON.stringify(output),
  });
  const beforeServer = ["needsLogin", "unsupported", "changedMode", "unknownModel"].includes(mode);
  check(trace.closes, beforeServer ? ["relay"] : ["server", "relay"], "close server before relay and caller cleanup");
  check(trace.requests, beforeServer ? 0 : ["badSession", "relayFailure", "callerCancellation"].includes(mode) ? 1 : mode === "badTurn" ? 2 : 3, "request count");
  check(trace.models, ["needsLogin", "unsupported", "changedMode"].includes(mode) ? 0 : 1, "catalog preflight");
}
assert.deepEqual(trace.violations, []);
console.log(`provider wiring ${mode} passed`);
