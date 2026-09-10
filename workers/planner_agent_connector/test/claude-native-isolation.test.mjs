import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeLaunch, claudeTurnArgs } from "../claude-launch.mjs";
import { runClaudeCommand, claudeTurnResult, claudeAccountSummary } from "../claude-process.mjs";
import { connectorProviderAdapter } from "../native-provider.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const connectionId = "11111111-1111-4111-8111-111111111111";
const setup = { version: 2, provider: "claude", appUrl: "http://127.0.0.1:3219", connectionId,
  workspaceId: "22222222-2222-4222-8222-222222222222", projectId: "33333333-3333-4333-8333-333333333333",
  expectedAuthMode: "claude_subscription", token: `op_pc_${connectionId}.${"s".repeat(43)}` };
const { inspect: inspectClaudeConnection, generate: runClaudeProjectTurn } = connectorProviderAdapter(setup);

const binary = process.env.OPENPLAN_CLAUDE_NATIVE_BINARY;

// This is the installed CLI with synthetic OAuth and a local Messages server.
// No real credential or provider call is used. The fixture grants extra turns
// only to inspect several forced refusals in one native process.
test("installed Claude refuses host tools and inherited context", { skip: !binary, timeout: 30_000 }, async () => {
  const outputSchema = JSON.parse(await readFile(new URL("./project-output-schema.json", import.meta.url), "utf8"));
  const root = await mkdtemp(join(tmpdir(), "openplan-claude-isolation-"));
  console.log(`Native Claude fixture: ${root}`);
  const profile = join(root, "profile"), work = join(root, "work");
  await mkdir(profile, { mode: 0o700 }); await mkdir(work, { mode: 0o700 });
  await writeFile(join(profile, ".credentials.json"), JSON.stringify({ claudeAiOauth: {
    accessToken: "SYNTHETIC_NATIVE_OAUTH_CANARY", refreshToken: "SYNTHETIC_REFRESH_CANARY", expiresAt: Date.now() + 86_400_000,
    scopes: ["user:inference", "user:profile"], subscriptionType: "pro", rateLimitTier: "default_claude_pro",
  } }), { mode: 0o600 });
  const configPath = join(root, "connection.json");
  await writeFile(configPath, JSON.stringify({ setup, binaryPath: binary, providerHome: profile }), { mode: 0o600 });
  const cli = fileURLToPath(new URL("../connector.mjs", import.meta.url));
  const cliStatus = await promisify(execFile)(process.execPath, [cli, "models", "--config", configPath], { timeout: 5000 });
  assert.deepEqual(JSON.parse(cliStatus.stdout), { status: "connected", authMode: "claude_subscription", planType: "pro", nativeVersion: "2.1.263", models: [], modelsUnavailable: true });
  assert.ok(!cliStatus.stdout.includes(setup.token));
  const settings = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "printf ran > /work/hook-ran" }] }] } });
  await writeFile(join(profile, "settings.json"), settings);
  const nativeConfig = JSON.stringify({ customInstructions: "PRIVATE_NATIVE_CONFIG_CANARY" });
  await writeFile(join(profile, ".claude.json"), nativeConfig);
  await writeFile(join(profile, "CLAUDE.md"), "PRIVATE_HOME_INSTRUCTIONS_CANARY");
  await writeFile(join(work, "CLAUDE.md"), "PRIVATE_PROJECT_INSTRUCTIONS_CANARY");
  await writeFile(join(root, "unrelated.txt"), "PRIVATE_UNMOUNTED_CASE_CANARY");
  await mkdir(join(profile, "skills")); await mkdir(join(profile, "skills", "private"));
  await writeFile(join(profile, "skills", "private", "SKILL.md"), "---\nname: private\ndescription: PRIVATE_SKILL_CANARY\n---\nPrivate unrelated record");
  const launch = await claudeLaunch({ binaryPath: binary, providerHome: profile, scratchPath: work });
  const sandboxArgs = launch.args.slice(0, launch.args.indexOf("--") + 1);
  const masked = await runClaudeCommand({ ...launch, args: [...sandboxArgs, "/usr/bin/cat", "/provider/CLAUDE.md"] }, { timeoutMs: 5000 });
  assert.equal(masked, "", "The mount namespace exposed the original private profile entry");
  await assert.rejects(runClaudeCommand({ ...launch, args: [...sandboxArgs, "/usr/bin/cat", join(root, "unrelated.txt")] }, { timeoutMs: 5000 }), { code: "native_process_failed" });
  const nativeStatus = await runClaudeCommand({ ...launch, args: [...launch.args, "auth", "status", "--json"] }, { statusQuery: true, timeoutMs: 5000 });
  assert.deepEqual(claudeAccountSummary(JSON.parse(nativeStatus)), { status: "connected", authMode: "claude_subscription", planType: "pro" });
  const forced = [
    ["Bash", { command: "cat /provider/.credentials.json" }],
    ["Read", { file_path: "/provider/.credentials.json" }],
    ["Write", { file_path: "/work/model-write", content: "unapproved" }],
    ["WebFetch", { url: "https://example.com", prompt: "Read it" }],
    ["mcp__private__read", { path: "/provider/.credentials.json" }],
  ];
  const requests = []; let serverFailure, replyMode = "forced";
  const cancelled = new AbortController();
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || !request.url.startsWith("/v1/messages")) { response.writeHead(404); response.end(); return; }
      let raw = "";
      for await (const chunk of request) { raw += chunk; if (raw.length > 300_000) throw new Error("fixture_request_too_large"); }
      const body = JSON.parse(raw); requests.push(body);
      if (replyMode === "cancel") { cancelled.abort(); return; }
      const index = replyMode === "forced" ? requests.length - 1 : forced.length;
      if (index > forced.length) throw new Error("unexpected_extra_model_request");
      const content = index < forced.length
        ? { type: "tool_use", id: `tool_${index}`, name: forced[index][0], input: forced[index][1] }
        : { type: "tool_use", id: "structured_final", name: "StructuredOutput", input: { answer: "SYNTHETIC selected project answer", citations: ["project:33333333-3333-4333-8333-333333333333"], submittal: null } };
      const message = { id: `msg_${index}`, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0 } };
      const events = [{ type: "message_start", message },
        { type: "content_block_start", index: 0, content_block: { ...content, input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(content.input) } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 12 } },
        { type: "message_stop" }];
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
    } catch (error) { serverFailure = error; response.writeHead(500); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const model = "claude-sonnet-4-6", args = claudeTurnArgs({ model, instructions: "Use only the supplied selected project record.",
      outputSchema });
    args[args.indexOf("--max-turns") + 1] = "12";
    const fixtureLaunch = { ...launch, args: [...launch.args, ...args], options: { ...launch.options,
      env: { ...launch.options.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}` } } };
    const stdout = await runClaudeCommand(fixtureLaunch, { input: "SYNTHETIC selected project. Return its brief answer.", timeoutMs: 20_000 });
    if (serverFailure) throw serverFailure;
    const result = claudeTurnResult(stdout, model);
    assert.equal(JSON.parse(result.answer).answer, "SYNTHETIC selected project answer");
    assert.equal(requests.length, forced.length + 1);
    assert.deepEqual(requests[0].tools.map(tool => tool.name), ["StructuredOutput"]);
    const recorded = JSON.stringify(requests);
    for (const canary of ["SYNTHETIC_NATIVE_OAUTH_CANARY", "SYNTHETIC_REFRESH_CANARY", "PRIVATE_HOME_INSTRUCTIONS_CANARY", "PRIVATE_PROJECT_INSTRUCTIONS_CANARY", "PRIVATE_SKILL_CANARY", "PRIVATE_NATIVE_CONFIG_CANARY"]) {
      assert.ok(!recorded.includes(canary), `Native context leaked ${canary}`);
    }
    const outputs = requests.at(-1).messages.flatMap(message => Array.isArray(message.content) ? message.content : []).filter(item => item.type === "tool_result");
    for (const [index, [name]] of forced.entries()) {
      const refused = outputs.find(item => item.tool_use_id === `tool_${index}`);
      assert.ok(refused, `Missing refusal for ${name}`);
      assert.equal(refused.is_error, true, `Native runtime accepted ${name}`);
      assert.match(JSON.stringify(refused.content), /unknown tool|no such tool available|not available|not found|not enabled|not allowed|unrecognized tool/i);
    }
    await assert.rejects(access(join(work, "model-write")), { code: "ENOENT" });
    await assert.rejects(access(join(work, "hook-ran")), { code: "ENOENT" });
    assert.equal(await readFile(join(profile, "settings.json"), "utf8"), settings);
    assert.equal(await readFile(join(profile, ".claude.json"), "utf8"), nativeConfig);
    await writeFile(join(root, "requests.json"), JSON.stringify(requests, null, 2), { mode: 0o600 });
    await writeFile(join(root, "stdout.jsonl"), stdout, { mode: 0o600 });
    const schema = outputSchema;
    const options = { binaryPath: binary, providerHome: profile, modelProvider: `http://127.0.0.1:${server.address().port}`,
      model, expectedAuthMode: "claude_subscription", instructions: "Use only the selected record.", prompt: "SYNTHETIC selected project.", outputSchema: schema };
    const nextWork = async name => { const path = join(root, name); await mkdir(path, { mode: 0o700 }); return path; };
    const account = await inspectClaudeConnection({ ...options, scratchPath: await nextWork("inspect"), includeModels: true });
    assert.deepEqual(account, { status: "connected", authMode: "claude_subscription", planType: "pro", nativeVersion: "2.1.263", models: [], modelsUnavailable: true });
    assert.equal(requests.length, forced.length + 1, "Model catalog inspection made a model request");
    replyMode = "structured";
    const wrapped = await runClaudeProjectTurn({ ...options, scratchPath: await nextWork("wrapped") });
    assert.equal(wrapped.provider, "claude"); assert.equal(wrapped.model, model); assert.equal(wrapped.authMode, "claude_subscription");
    assert.equal(JSON.parse(wrapped.answer).answer, "SYNTHETIC selected project answer");
    assert.equal(requests.length, forced.length + 2, "The wrapper generated more than one answer");
    const emptyProfile = await nextWork("signed-out-profile");
    const signedOut = await inspectClaudeConnection({ ...options, providerHome: emptyProfile, scratchPath: await nextWork("signed-out-inspect") });
    assert.equal(signedOut.status, "needs_login");
    await assert.rejects(runClaudeProjectTurn({ ...options, providerHome: emptyProfile, scratchPath: await nextWork("signed-out-turn") }), { code: "native_needs_login" });
    assert.equal(requests.length, forced.length + 2, "A signed-out turn reached a model");
    replyMode = "cancel";
    await assert.rejects(runClaudeProjectTurn({ ...options, scratchPath: await nextWork("cancel"), signal: cancelled.signal }), { code: "native_cancelled" });
    assert.equal(requests.length, forced.length + 3, "Cancellation regenerated the native request");
    assert.equal(await readFile(join(profile, ".claude.json"), "utf8"), nativeConfig);
    assert.equal(await readFile(join(profile, "settings.json"), "utf8"), settings);
    await writeFile(join(root, "wrapper-evidence.json"), JSON.stringify({ account, wrapped, signedOut, cancellation: "native_cancelled", totalRequests: requests.length }, null, 2), { mode: 0o600 });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
