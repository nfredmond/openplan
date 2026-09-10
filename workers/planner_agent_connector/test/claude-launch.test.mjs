import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod, symlink, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeLaunch } from "../claude-launch.mjs";

async function fixture(version = "2.1.263 (Claude Code)") {
  const root = await mkdtemp(join(tmpdir(), "openplan-claude-launch-"));
  const binaryPath = join(root, "claude"), providerHome = join(root, "profile"), scratchPath = join(root, "scratch");
  await mkdir(providerHome); await mkdir(scratchPath);
  await writeFile(binaryPath, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, { mode: 0o700 });
  return { binaryPath, providerHome, scratchPath };
}

test("launch preserves private credentials and masks inherited profile files with valid JSON", async () => {
  const options = await fixture();
  await writeFile(join(options.providerHome, ".credentials.json"), "synthetic credential", { mode: 0o600 });
  await writeFile(join(options.providerHome, ".claude.json"), '{"private":"canary"}');
  await mkdir(join(options.providerHome, "skills"));
  const launch = await claudeLaunch({ ...options, modelProvider: "http://127.0.0.1:12345/" });
  assert.equal(launch.command, "/usr/bin/bwrap");
  assert.equal(launch.options.shell, false);
  assert.equal(launch.options.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:12345");
  assert.equal(launch.options.env.CLAUDE_CODE_DISABLE_FAST_MODE, "1");
  assert.equal(launch.options.env.HOME, "/home/openplan");
  assert.equal(launch.options.env.ANTHROPIC_API_KEY, undefined);
  const configIndex = launch.args.indexOf("/provider/.claude.json");
  assert.ok(configIndex > 0);
  assert.equal(await readFile(launch.args[configIndex - 1], "utf8"), "{}");
  assert.ok(launch.args.includes("/provider/skills"));
  assert.ok(!launch.args.includes("/provider/.credentials.json"));
  assert.equal(await readFile(join(options.providerHome, ".credentials.json"), "utf8"), "synthetic credential");
  assert.equal(await readFile(join(options.providerHome, ".claude.json"), "utf8"), '{"private":"canary"}');
});

test("ordinary launch has no provider endpoint override", async () => {
  const launch = await claudeLaunch(await fixture());
  assert.equal(launch.options.env.ANTHROPIC_BASE_URL, undefined);
});

for (const endpoint of ["broken", "https://127.0.0.1:1234", "http://localhost:1234", "http://example.com", "http://127.0.0.1/path", "http://u:p@127.0.0.1", "http://127.0.0.1?x=1", "http://127.0.0.1#x", "", null, false, 3]) {
  test(`refuses fixture endpoint ${JSON.stringify(endpoint)} before filesystem access`, async () => {
    await assert.rejects(claudeLaunch({ binaryPath: "/missing/claude", providerHome: "/missing/profile", scratchPath: "/missing/scratch", modelProvider: endpoint }), { message: "native_fixture_origin_invalid" });
  });
}

test("refuses relative launch paths before execution", async () => {
  await assert.rejects(claudeLaunch({ binaryPath: "claude", providerHome: "/missing", scratchPath: "/missing2" }), { message: "native_path_invalid" });
});

test("refuses an unsupported native version", async () => {
  await assert.rejects(claudeLaunch(await fixture("2.1.262 (Claude Code)")), { message: "native_version_unsupported" });
});

test("refuses failed native version discovery", async () => {
  const options = await fixture();
  await writeFile(options.binaryPath, "#!/bin/sh\nexit 1\n");
  await assert.rejects(claudeLaunch(options), { message: "native_version_unavailable" });
});

for (const shape of ["profile root", "scratch root", "same", "scratch within profile", "profile within scratch"]) {
  test(`refuses unsafe directory layout: ${shape}`, async () => {
    const options = await fixture();
    if (shape === "profile root") options.providerHome = "/";
    if (shape === "scratch root") options.scratchPath = "/";
    if (shape === "same") options.scratchPath = options.providerHome;
    if (shape === "scratch within profile") { options.scratchPath = join(options.providerHome, "scratch"); await mkdir(options.scratchPath); }
    if (shape === "profile within scratch") { options.providerHome = join(options.scratchPath, "profile"); await mkdir(options.providerHome); }
    await assert.rejects(claudeLaunch(options), { message: "native_path_invalid" });
    // The refusal happens before a profile mask or any native credential read.
    if (options.scratchPath !== "/") assert.ok(!(await readdir(options.scratchPath)).includes("profile-masks"));
  });
}

for (const shape of ["public", "symlink", "directory"]) {
  test(`refuses ${shape} credential file`, async () => {
    const options = await fixture(), credential = join(options.providerHome, ".credentials.json");
    if (shape === "directory") await mkdir(credential);
    else if (shape === "symlink") await symlink(options.binaryPath, credential);
    else { await writeFile(credential, "synthetic"); await chmod(credential, 0o644); }
    await assert.rejects(claudeLaunch(options), { message: "native_credentials_not_private" });
  });
}

test("refuses profile symlinks instead of following them", async () => {
  const options = await fixture();
  await symlink(options.binaryPath, join(options.providerHome, "settings.json"));
  await assert.rejects(claudeLaunch(options), { message: "native_profile_entry_unsupported" });
});

test("refuses an unbounded inherited profile", async () => {
  const options = await fixture();
  await Promise.all(Array.from({ length: 513 }, (_, index) => writeFile(join(options.providerHome, String(index)), "")));
  await assert.rejects(claudeLaunch(options), { message: "native_profile_too_large" });
});
