import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCodeLaunch } from "../opencode-launch.mjs";

// Opt in with the pinned installed binary. Only generated synthetic credentials
// are mounted; this probe makes no model request and reads no user account.
test("native launch physically hides private files and refuses credential writes", {
  skip: !process.env.OPENPLAN_OPENCODE_NATIVE_BINARY,
  timeout: 20_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "openplan-opencode-physical-"));
  const providerHome = join(root, "profile"), scratchPath = join(root, "scratch");
  await mkdir(providerHome, { mode: 0o700 });
  await mkdir(scratchPath, { mode: 0o700 });
  const credential = JSON.stringify({ openai: { type: "api", key: "SYNTHETIC_NO_PROVIDER_KEY" } });
  const authPath = join(providerHome, "auth.json");
  await writeFile(authPath, credential, { mode: 0o600 });
  await writeFile(join(providerHome, "AGENTS.md"), "PRIVATE_PROFILE_CANARY");
  await writeFile(join(scratchPath, "AGENTS.md"), "PRIVATE_SCRATCH_CANARY");
  const launch = await openCodeLaunch({
    binaryPath: process.env.OPENPLAN_OPENCODE_NATIVE_BINARY, providerHome, scratchPath,
    relayUrl: `http://127.0.0.1:12345/${"a".repeat(64)}`, serverPassword: "b".repeat(64),
  });
  // A native login update after inspection must affect only a later run.
  const changedCredential = JSON.stringify({ openai: { type: "api", key: "SYNTHETIC_CHANGED_SOURCE" } });
  await writeFile(authPath, changedCredential);
  const script = `
    const fs = require('node:fs');
    function read(path) {
      try { return { value: fs.readFileSync(path, 'utf8') }; }
      catch (error) { return { error: error.code }; }
    }
    const result = {
      scratch: read('/work/AGENTS.md'),
      task: read('/work/task/AGENTS.md'),
      profile: read(process.argv[1] + '/AGENTS.md'),
      credential: read('/work/data/opencode/auth.json'),
    };
    try { fs.writeFileSync('/work/data/opencode/auth.json', 'SYNTHETIC_CHANGED'); result.write = 'allowed'; }
    catch (error) { result.write = error.code; }
    console.log(JSON.stringify(result));
  `;
  const boundary = launch.args.indexOf("--");
  assert.ok(boundary > 0);
  const { stdout } = await promisify(execFile)(launch.command, [
    ...launch.args.slice(0, boundary), "--", "/usr/bin/node", "-e", script, providerHome,
  ], { ...launch.options, timeout: 10_000, maxBuffer: 8192 });
  const result = JSON.parse(stdout);
  assert.deepEqual(result.scratch, { error: "ENOENT" }, "private scratch canary became readable");
  assert.deepEqual(result.task, { error: "ENOENT" }, "private task context became readable");
  assert.deepEqual(result.profile, { error: "ENOENT" }, "private profile became readable");
  assert.deepEqual(result.credential, { value: credential }, "native credential mount is missing");
  assert.equal(result.write, "EROFS", "native credential became writable");
  assert.equal(await readFile(authPath, "utf8"), changedCredential, "native write altered the host credential");
});
