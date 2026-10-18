import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import test from "node:test";

const cli = fileURLToPath(new URL("../connector.mjs", import.meta.url));
const providers = { codex: ["@openai/codex", "chatgpt", "0.154.0"], claude: ["@anthropic-ai/claude-code", "claude_subscription", "2.1.263"], opencode: ["opencode-ai", "opencode_api", "1.18.30"] };
const uid = n => `${n}`.repeat(8) + "-1111-4111-8111-111111111111";
async function fixture(t, provider = "codex", legacy = false) {
  const root = await mkdtemp(join(tmpdir(), "openplan-connector-install-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const globalRoot = join(root, "lib", "node_modules");
  const packagePath = join(globalRoot, providers[provider][0]);
  const binaryPath = join(packagePath, "bin", provider);
  const profile = join(root, "profile");
  await mkdir(join(packagePath, "bin"), { recursive: true }); await mkdir(profile);
  await writeFile(binaryPath, `#!/bin/sh\ntouch '${root}/NATIVE-RAN'\n`, { mode: 0o700 });
  await writeFile(join(packagePath, "package.json"), JSON.stringify({ name: providers[provider][0], version: "0.1.0", bin: { [provider]: `bin/${provider}` } }));
  await writeFile(join(profile, "auth.json"), "SYNTHETIC_PROFILE_CANARY");
  const setup = { version: legacy ? 1 : 2, ...(legacy ? {} : { provider }), appUrl: "http://127.0.0.1:3219", connectionId: uid(1), workspaceId: uid(2), projectId: uid(3), expectedAuthMode: providers[provider][1], token: `op_pc_${uid(1)}.${"x".repeat(43)}` };
  const configPath = join(root, "connection.json");
  await writeFile(configPath, JSON.stringify({ setup, binaryPath, providerHome: profile }), { mode: 0o600 });
  return { root, globalRoot, profile, setup, configPath };
}
async function inventory(root) {
  const values = {};
  async function walk(dir) {
    for (const name of await readdir(dir)) {
      const path = join(dir, name); const stat = await lstat(path);
      if (stat.isDirectory()) {
        values[path] = { type: "directory", mode: stat.mode & 0o777 };
        await walk(path);
      } else values[path] = { type: "file", mode: stat.mode & 0o777, sha256: createHash("sha256").update(await readFile(path)).digest("hex") };
    }
  }
  await walk(root); return values;
}
async function run(args) {
  return await promisify(execFile)(process.execPath, [cli, ...args], { timeout: 5000, maxBuffer: 12_000 });
}
test("ordinary connector install-check binds each saved provider without native work or connection disclosure", async t => {
  for (const provider of Object.keys(providers)) {
    const f = await fixture(t, provider); const before = await inventory(f.root);
    let output;
    await assert.doesNotReject(async () => { output = await run(["install-check", "--config", f.configPath, "--installer", "npm", "--npm-root", f.globalRoot]); }, "Configured install-check did not complete");
    assert.ok(!output.stdout.includes(f.setup.token), "Connection token entered guidance");
    assert.ok(!output.stdout.includes(f.profile), "Provider profile path entered guidance");
    assert.ok(!output.stdout.includes("SYNTHETIC_PROFILE_CANARY"), "Profile content entered guidance");
    const result = JSON.parse(output.stdout);
    assert.equal(result.provider, provider, "Saved provider was replaced");
    assert.equal(result.installer, "npm", "Explicit npm declaration was not preserved");
    assert.deepEqual(result.command, { executable: "npm", args: ["install", "--global", "--prefix", f.root, `${providers[provider][0]}@${providers[provider][2]}`] });
    assert.deepEqual(await inventory(f.root), before, "Install-check changed configuration, profile or binary files");
  }
});
test("ordinary connector keeps undeclared installers unknown and legacy Codex configuration readable", async t => {
  const f = await fixture(t, "codex", true);
  const result = JSON.parse((await run(["install-check", "--config", f.configPath])).stdout);
  assert.equal(result.provider, "codex"); assert.equal(result.installer, "unknown");
  assert.equal(result.command, null); assert.equal(result.executesUpdate, false);
});
test("install-check refuses incomplete declarations and write flags before using the connection", async t => {
  const f = await fixture(t);
  for (const flags of [["--installer", "npm"], ["--npm-root", f.globalRoot], ["--installer", "brew", "--npm-root", f.globalRoot], ["--update"], ["--update", "yes"], ["--installer", "npm", "--installer", "npm", "--npm-root", f.globalRoot]]) {
    await assert.rejects(run(["install-check", "--config", f.configPath, ...flags]), error => {
      assert.equal(error.code, 1); assert.match(error.stderr, /connector_arguments_invalid/);
      assert.ok(!error.stderr.includes(f.setup.token)); return true;
    });
  }
  const help = await run(["--help"]); assert.match(help.stdout, /install-check/);
  assert.match(help.stdout, /without running the provider/);
});
