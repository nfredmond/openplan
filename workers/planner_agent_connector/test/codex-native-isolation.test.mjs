import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const binary = process.env.OPENPLAN_CODEX_NATIVE_BINARY;
const driver = fileURLToPath(new URL("./native-driver.mjs", import.meta.url));

// Exercise the installed runtime, not a mock of its sandbox or config parser.
// The only model endpoint is this local scripted server: no provider bill or
// real account is used. Keep the synthetic fixture on disk for inspection.
for (const expectedAuthMode of ["apiKey", "chatgpt"]) test(`native isolation and exact auth mode: ${expectedAuthMode}`, { skip: !binary, timeout: 45_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "openplan-native-isolation-"));
  const profile = join(root, "profile"), work = join(root, "work");
  await mkdir(profile, { mode: 0o700 }); await mkdir(work, { mode: 0o700 });
  await writeFile(join(profile, "auth.json"), JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "SYNTHETIC_NO_PROVIDER_KEY" }));
  const sourceConfig = '[mcp_servers.canary]\ncommand="/bin/sh"\nargs=["-c","printf started > /work/mcp-started"]\n';
  await writeFile(join(profile, "config.toml"), sourceConfig);
  await writeFile(join(profile, "AGENTS.md"), "PRIVATE_HOME_CANARY must never enter selected project context");
  await writeFile(join(work, "AGENTS.md"), "PRIVATE_PROJECT_RULE_CANARY must never enter selected project context");
  await mkdir(join(profile, "skills"));
  await mkdir(join(profile, "skills/private"));
  await writeFile(join(profile, "skills/private/SKILL.md"), "---\nname: private-canary\ndescription: PRIVATE_SKILL_CANARY\n---\nPrivate unrelated case");
  const forced = [
    ["exec_command", { cmd: "cat /provider/AGENTS.md" }],
    ["shell", { command: ["cat", "/provider/AGENTS.md"] }],
    ["view_image", { path: "/provider/AGENTS.md" }],
    ["apply_patch", { patch: "*** Begin Patch\n*** Add File: /work/model-write\n+unauthorized\n*** End Patch" }],
    ["list_mcp_resources", {}],
    ["read_mcp_resource", { server: "canary", uri: "file:///provider/auth.json" }],
  ];
  const requests = [];
  let serverFailure;
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/v1/responses") { response.writeHead(404); response.end(); return; }
      let raw = "";
      for await (const chunk of request) { raw += chunk; if (raw.length > 256_000) throw new Error("fixture_request_too_large"); }
      const body = JSON.parse(raw); requests.push(body);
      const index = requests.length - 1;
      const item = index < forced.length
        ? { type: "function_call", id: `fc_${index}`, call_id: `call_${index}`, name: forced[index][0], arguments: JSON.stringify(forced[index][1]) }
        : { type: "message", id: "msg_final", role: "assistant", status: "completed", content: [{ type: "output_text", text: "SYNTHETIC project-only reply.", annotations: [] }] };
      const events = [
        { type: "response.created", response: { id: `resp_${index}`, object: "response", status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: { id: `resp_${index}`, object: "response", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } } },
      ];
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
    } catch (error) { serverFailure = error; response.writeHead(500); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
    if (expectedAuthMode === "chatgpt") {
      await assert.rejects(promisify(execFile)(process.execPath, [driver, binary, profile, work, endpoint, expectedAuthMode], { timeout: 35_000, maxBuffer: 100_000 }), (error) => {
        assert.match(error.stderr, /native_auth_mode_changed/);
        return true;
      });
      assert.equal(requests.length, 0, "Changed account mode made a model request");
      return;
    }
    const { stdout } = await promisify(execFile)(process.execPath, [driver, binary, profile, work, endpoint, expectedAuthMode], { timeout: 35_000, maxBuffer: 100_000 });
    if (serverFailure) throw serverFailure;
    await writeFile(join(root, "requests.json"), JSON.stringify(requests, null, 2));
    const result = JSON.parse(stdout);
    assert.equal(result.status, "completed");
    assert.equal(result.authMode, expectedAuthMode);
    assert.equal(result.model, "fixture-model");
    assert.equal(result.items.at(-1).text, "SYNTHETIC project-only reply.");
    assert.equal(requests.length, forced.length + 1);
    const recorded = JSON.stringify(requests);
    for (const marker of ["PRIVATE_HOME_CANARY", "PRIVATE_PROJECT_RULE_CANARY", "PRIVATE_SKILL_CANARY"]) assert.ok(!recorded.includes(marker), `Leaked ${marker}`);
    const tools = requests[0].tools.map((tool) => tool.name ?? tool.type);
    for (const [name] of forced) assert.ok(!tools.includes(name), `Exposed forbidden ${name}`);
    const outputs = requests.at(-1).input.filter((item) => item.type === "function_call_output");
    for (const [index, [name]] of forced.entries()) {
      const output = outputs.find((item) => item.call_id === `call_${index}`);
      assert.ok(output, `Missing refusal for ${name}`);
      assert.match(output.output, /unsupported call/, `Native runtime executed ${name}`);
    }
    await assert.rejects(access(join(work, "mcp-started")), { code: "ENOENT" });
    await assert.rejects(access(join(work, "model-write")), { code: "ENOENT" });
    assert.equal(await readFile(join(profile, "config.toml"), "utf8"), sourceConfig);
    assert.match(await readFile(join(profile, "AGENTS.md"), "utf8"), /PRIVATE_HOME_CANARY/);
    console.log(`Native isolation fixture: ${root}`);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
