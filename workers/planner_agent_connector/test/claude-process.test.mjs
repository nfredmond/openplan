import { test } from "node:test";
import assert from "node:assert/strict";
import { runClaudeCommand, claudeAccountSummary, claudeTurnResult } from "../claude-process.mjs";
import { claudeTurnArgs } from "../claude-launch.mjs";

const model = "claude-sonnet-4-6";
function records() {
  return [{ type: "system", subtype: "init", session_id: "fixture-session", model, apiKeySource: "none", tools: ["StructuredOutput"], mcp_servers: [] },
    { type: "result", subtype: "success", is_error: false, session_id: "fixture-session", uuid: "fixture-result",
      modelUsage: { [model]: { inputTokens: 20, outputTokens: 12 } }, structured_output: { answer: "Selected project only" } }];
}
const lines = events => events.map(event => JSON.stringify(event)).join("\n") + "\n";
function processLaunch(code) { return { command: process.execPath, args: ["-e", code], options: { env: {}, shell: false, stdio: ["pipe", "pipe", "pipe"] } }; }

test("returns only the final structured result and native identifiers", () => {
  assert.deepEqual(claudeTurnResult(lines(records()), model), { threadId: "fixture-session", turnId: "fixture-result", answer: '{"answer":"Selected project only"}' });
});
for (const [name, change, code] of [
  ["changed started model", events => { events[0].model = "other"; }, "native_model_changed"],
  ["native API key selected", events => { events[0].apiKeySource = "ANTHROPIC_API_KEY"; }, "native_auth_mode_changed"],
  ["fallback model usage", events => { events[1].modelUsage = { other: {} }; }, "native_model_changed"],
  ["additional model usage", events => { events[1].modelUsage.other = {}; }, "native_model_changed"],
  ["host tool enabled", events => { events[0].tools.push("Bash"); }, "native_capability_changed"],
  ["MCP connected", events => { events[0].mcp_servers.push({ name: "private" }); }, "native_capability_changed"],
  ["missing final", events => { events.pop(); }, "native_stream_interrupted"],
  ["duplicate final", events => { events.push(events[1]); }, "native_stream_interrupted"],
  ["wrong session", events => { events[1].session_id = "other"; }, "native_stream_interrupted"],
  ["failed completion", events => { events[1].is_error = true; }, "native_turn_failed"],
  ["turn limit", events => { events[1].subtype = "error_max_turns"; }, "native_turn_failed"],
  ["missing receipt id", events => { delete events[1].uuid; }, "native_protocol_invalid"],
  ["text without structured output", events => { delete events[1].structured_output; events[1].result = "Not a structured receipt"; }, "native_answer_missing"],
  ["oversized answer", events => { events[1].structured_output.answer = "x".repeat(64_001); }, "native_answer_too_large"],
]) test(`refuses ${name}`, () => { const events = records(); change(events); assert.throws(() => claudeTurnResult(lines(events), model), { code }); });

test("malformed and non-object stream frames are refused", () => {
  for (const text of ["not json\n", "null\n", "[]\n"]) assert.throws(() => claudeTurnResult(text, model), { code: "native_protocol_invalid" });
});
test("account summaries omit personal identifiers and refuse other billing modes", () => {
  const native = { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "pro", email: "SYNTHETIC_PRIVATE_EMAIL", orgId: "SYNTHETIC_PRIVATE_ORG" };
  assert.deepEqual(claudeAccountSummary(native), { status: "connected", authMode: "claude_subscription", planType: "pro" });
  assert.deepEqual(claudeAccountSummary({ loggedIn: false }), { status: "needs_login", authMode: null, planType: null });
  for (const changed of [{ authMethod: "api_key" }, { apiProvider: "bedrock" }, { subscriptionType: "unknown" }]) assert.equal(claudeAccountSummary({ ...native, ...changed }).status, "unsupported_auth_mode");
  assert.throws(() => claudeAccountSummary({}), { code: "native_account_unreadable" });
});
test("turn arguments disable host capabilities and keep selected model/schema", () => {
  const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
  const args = claudeTurnArgs({ model, instructions: "Selected project only", outputSchema: schema });
  const value = key => args[args.indexOf(key) + 1];
  for (const flag of ["--strict-mcp-config", "--no-chrome", "--no-session-persistence"]) assert.ok(args.includes(flag));
  assert.equal(value("--tools"), ""); assert.equal(value("--setting-sources"), "");
  assert.equal(value("--permission-mode"), "dontAsk"); assert.equal(value("--permission-prompts"), "none");
  assert.equal(value("--model"), model); assert.equal(value("--system-prompt"), "Selected project only");
  assert.equal(value("--max-turns"), "2");
  assert.deepEqual(JSON.parse(value("--json-schema")), schema); assert.deepEqual(JSON.parse(value("--mcp-config")), { mcpServers: {} });
});
test("command output waits for successful process exit", async () => {
  const success = processLaunch('process.stdin.pipe(process.stdout)');
  assert.equal(await runClaudeCommand(success, { input: "retained answer" }), "retained answer");
  const failure = processLaunch('process.stdout.write("completed answer");process.stderr.write("SYNTHETIC_PRIVATE_KEY");process.exitCode=1');
  await assert.rejects(runClaudeCommand(failure), error => { assert.equal(error.code, "native_process_failed"); assert.ok(!String(error).includes("SYNTHETIC_PRIVATE_KEY")); return true; });
});
test("signed-out exit is accepted only for an explicit account status query", async () => {
  const launch = processLaunch('process.stdout.write(JSON.stringify({loggedIn:false}));process.exitCode=1');
  assert.equal(JSON.parse(await runClaudeCommand(launch, { statusQuery: true })).loggedIn, false);
  await assert.rejects(runClaudeCommand(launch), { code: "native_process_failed" });
  await assert.rejects(runClaudeCommand(processLaunch('process.stdout.write("{}");process.exitCode=1'), { statusQuery: true }), { code: "native_process_failed" });
});
test("cancellation, deadlines and output bounds close owned processes", async () => {
  const hang = processLaunch('setTimeout(()=>process.exit(0),300)');
  await assert.rejects(runClaudeCommand(hang, { timeoutMs: 50 }), { code: "native_timeout" });
  const controller = new AbortController(); const pending = runClaudeCommand(hang, { signal: controller.signal, timeoutMs: 200 }); controller.abort();
  await assert.rejects(pending, { code: "native_cancelled" });
  await assert.rejects(runClaudeCommand(processLaunch('process.stdout.write("x".repeat(1000001))')),
    { code: "native_output_too_large" });
  await assert.rejects(runClaudeCommand(processLaunch('process.stderr.write("x".repeat(256001))')),
    { code: "native_stderr_too_large" });
});
