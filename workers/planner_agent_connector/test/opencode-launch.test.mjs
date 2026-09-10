import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCodeLaunch } from "../opencode-launch.mjs";

async function fixture(version = "1.18.30") {
  const root = await mkdtemp(join(tmpdir(), "openplan-opencode-launch-"));
  const binaryPath = join(root, "opencode"), providerHome = join(root, "profile"), scratchPath = join(root, "scratch");
  await mkdir(providerHome); await mkdir(scratchPath);
  await writeFile(binaryPath, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, { mode: 0o700 });
  return { binaryPath, providerHome, scratchPath, relayUrl: `http://127.0.0.1:12345/${"a".repeat(64)}`, serverPassword: "b".repeat(64) };
}

test("mounts only the private credential file and fresh runtime", async () => {
  const options = await fixture();
  await writeFile(join(options.providerHome, "auth.json"), "synthetic", { mode: 0o600 });
  await writeFile(join(options.providerHome, "history.json"), "private history");
  await writeFile(join(options.scratchPath, "AGENTS.md"), "private context");
  const launch = await openCodeLaunch(options);
  const authIndex = launch.args.indexOf(join(options.providerHome, "auth.json"));
  assert.equal(launch.args[authIndex - 1], "--ro-bind");
  assert.equal(launch.args[authIndex + 1], "/work/data/opencode/auth.json");
  assert.ok(!launch.args.includes(options.providerHome)); assert.ok(!launch.args.includes(options.scratchPath));
  assert.ok(launch.args.includes(join(options.scratchPath, "opencode-runtime")));
  assert.ok(launch.args.includes("--pure"));
  assert.equal(launch.options.shell, false); assert.equal(launch.command, "/usr/bin/bwrap");
  assert.equal(launch.options.env.OPENAI_API_KEY, undefined); assert.equal(launch.options.env.OPENCODE_AUTH_CONTENT, undefined);
  assert.equal(launch.options.env.OPENCODE_DISABLE_DEFAULT_PLUGINS, "1");
  assert.equal(launch.options.env.OPENCODE_DISABLE_EXTERNAL_SKILLS, "1");
  assert.equal(launch.options.env.OPENCODE_DISABLE_CLAUDE_CODE, "1");
  assert.equal(launch.options.env.OPENCODE_DISABLE_PROJECT_CONFIG, "1");
  assert.equal(launch.options.env.OPENCODE_DISABLE_MODELS_FETCH, "1");
  const config = JSON.parse(launch.options.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(config.enabled_providers, ["openai"]);
  assert.deepEqual(config.permission, { "*": "deny", StructuredOutput: "allow" });
  assert.deepEqual(config.agent.openplan.permission, config.permission);
  assert.deepEqual(config.plugin, []); assert.deepEqual(config.mcp, {});
  assert.equal(config.provider.openai.options.baseURL, options.relayUrl);
  for (const name of ["title", "summary", "compaction"]) assert.equal(config.agent[name].disable, true);
  assert.equal(config.share, "disabled"); assert.equal(config.autoupdate, false); assert.equal(config.snapshot, false);
});

test("missing credentials remain absent so native inspection can report sign-in needed", async () => {
  const options = await fixture(); const launch = await openCodeLaunch(options);
  assert.ok(!launch.args.includes(join(options.providerHome, "auth.json")));
  assert.deepEqual(await readdir(join(options.scratchPath, "opencode-runtime/data/opencode")), []);
});

for (const [key, value, code] of [
  ["binaryPath", "opencode", "native_path_invalid"],
  ["providerHome", null, "native_path_invalid"],
  ["scratchPath", "relative", "native_path_invalid"],
  ["serverPassword", "weak", "native_server_secret_invalid"],
  ["relayUrl", "https://example.com", "native_relay_origin_invalid"],
  ["relayUrl", "broken", "native_relay_origin_invalid"],
  ["relayUrl", `https://127.0.0.1:1234/${"a".repeat(64)}`, "native_relay_origin_invalid"],
  ["relayUrl", `http://127.0.0.1/${"a".repeat(64)}`, "native_relay_origin_invalid"],
  ["relayUrl", `http://127.0.0.1:1234/${"a".repeat(64)}#changed`, "native_relay_origin_invalid"],
  ["relayUrl", `http://localhost:1234/${"a".repeat(64)}`, "native_relay_origin_invalid"],
  ["relayUrl", `http://user:secret@127.0.0.1:1234/${"a".repeat(64)}`, "native_relay_origin_invalid"],
  ["relayUrl", "http://127.0.0.1:1234/responses", "native_relay_origin_invalid"],
  ["relayUrl", `http://127.0.0.1:1234/${"a".repeat(64)}?changed=true`, "native_relay_origin_invalid"],
]) test(`refuses invalid ${key}: ${String(value)}`, async () => {
  await assert.rejects(openCodeLaunch({ ...await fixture(), [key]: value }), { message: code });
});

for (const shape of ["profile root", "scratch root", "same", "scratch within profile", "profile within scratch"]) test(`refuses unsafe layout: ${shape}`, async () => {
  const options = await fixture();
  if (shape === "profile root") options.providerHome = "/";
  if (shape === "scratch root") options.scratchPath = "/";
  if (shape === "same") options.scratchPath = options.providerHome;
  if (shape === "scratch within profile") { options.scratchPath = join(options.providerHome, "scratch"); await mkdir(options.scratchPath); }
  if (shape === "profile within scratch") { options.providerHome = join(options.scratchPath, "profile"); await mkdir(options.providerHome); }
  await assert.rejects(openCodeLaunch(options), { message: "native_path_invalid" });
  if (options.scratchPath !== "/") assert.ok(!(await readdir(options.scratchPath)).includes("opencode-runtime"));
});

for (const shape of ["public", "symlink", "directory", "oversized"]) test(`refuses ${shape} native credentials`, async () => {
  const options = await fixture(), file = join(options.providerHome, "auth.json");
  if (shape === "directory") await mkdir(file, { mode: 0o700 });
  else if (shape === "symlink") await symlink(options.binaryPath, file);
  else { await writeFile(file, "x".repeat(shape === "oversized" ? 256_001 : 1), { mode: 0o600 }); if (shape === "public") await chmod(file, 0o644); }
  await assert.rejects(openCodeLaunch(options), { message: "native_credentials_not_private" });
});

test("refuses a different installed version", async () => {
  await assert.rejects(openCodeLaunch(await fixture("1.18.29")), { message: "native_version_unsupported" });
});

test("refuses reuse of a native runtime", async () => {
  const options = await fixture(); await openCodeLaunch(options);
  await assert.rejects(openCodeLaunch(options), { code: "EEXIST" });
});


test("failed version execution is an explicit refusal", async () => {
  const options = await fixture(); await writeFile(options.binaryPath, "#!/bin/sh\nexit 1\n");
  await assert.rejects(openCodeLaunch(options), { message: "native_version_unavailable" });
});

for (const key of ["providerHome", "scratchPath"]) test(`refuses a file as ${key}`, async () => {
  const options = await fixture(); options[key] = options.binaryPath;
  await assert.rejects(openCodeLaunch(options), { message: "native_path_invalid" });
});


test("refuses a preexisting runtime even before its task directory exists", async () => {
  const options = await fixture();
  const runtime = join(options.scratchPath, "opencode-runtime"); await mkdir(runtime);
  await writeFile(join(runtime, "untrusted-state"), "SYNTHETIC preexisting native state");
  await assert.rejects(openCodeLaunch(options), { code: "EEXIST" });
  assert.deepEqual(await readdir(runtime), ["untrusted-state"]);
});
