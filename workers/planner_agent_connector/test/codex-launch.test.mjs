import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm, access, constants } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexLaunch } from "../codex-launch.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "openplan-codex-launch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binaryPath = join(root, "runtime", "bin", "codex");
  const providerHome = join(root, "profile"), scratchPath = join(root, "scratch");
  await mkdir(join(root, "runtime", "bin"), { recursive: true });
  await mkdir(providerHome); await mkdir(scratchPath);
  await writeFile(binaryPath, "#!/bin/sh\nprintf '%s\\n' 'codex-cli 0.154.0'\n", { mode: 0o700 });
  return { binaryPath, providerHome, scratchPath };
}

test("disjoint sibling paths preserve profile bytes and mask private history", async t => {
  const options = await fixture(t);
  // A shared string prefix must not be mistaken for directory containment.
  options.scratchPath = `${options.providerHome}-work`;
  await mkdir(options.scratchPath);
  await writeFile(join(options.providerHome, "auth.json"), "synthetic auth", { mode: 0o600 });
  await writeFile(join(options.providerHome, "history.jsonl"), "private history", { mode: 0o600 });
  const launch = await codexLaunch(options);
  assert.equal(launch.command, "/usr/bin/bwrap");
  assert.equal(launch.options.cwd, options.scratchPath);
  const maskIndex = launch.args.indexOf("/provider/history.jsonl");
  assert.ok(maskIndex > 0);
  assert.equal(await readFile(launch.args[maskIndex - 1], "utf8"), "");
  assert.equal(await readFile(join(options.providerHome, "history.jsonl"), "utf8"), "private history");
  assert.equal(await readFile(join(options.providerHome, "auth.json"), "utf8"), "synthetic auth");
});

for (const shape of ["same", "scratch within profile", "profile within scratch", "profile alias within scratch", "scratch alias within profile"]) {
  test(`refuses overlapping directories before masks: ${shape}`, async t => {
    const options = await fixture(t);
    if (shape === "same") options.scratchPath = options.providerHome;
    if (shape === "scratch within profile" || shape === "scratch alias within profile") {
      const nested = join(options.providerHome, "nested"); await mkdir(nested);
      if (shape === "scratch alias within profile") {
        const alias = `${options.scratchPath}-alias`; await symlink(nested, alias); options.scratchPath = alias;
      } else options.scratchPath = nested;
    }
    if (shape === "profile within scratch" || shape === "profile alias within scratch") {
      const nested = join(options.scratchPath, "nested"); await mkdir(nested);
      if (shape === "profile alias within scratch") {
        const alias = `${options.providerHome}-alias`; await symlink(nested, alias); options.providerHome = alias;
      } else options.providerHome = nested;
    }
    await writeFile(join(options.providerHome, "history.jsonl"), "private history", { mode: 0o600 });
    await assert.rejects(codexLaunch(options), { message: "native_path_invalid" });
    assert.ok(!(await readdir(options.scratchPath)).includes("profile-masks"));
    assert.equal(await readFile(join(options.providerHome, "history.jsonl"), "utf8"), "private history");
  });
}

for (const key of ["providerHome", "scratchPath"]) {
  test(`refuses filesystem root as ${key} explicitly`, async t => {
    // A broken guard must not let this test create masks in the filesystem root.
    if (await access("/", constants.W_OK).then(() => true, () => false)) {
      return t.skip("Root-path regression requires an unprivileged test user.");
    }
    const options = await fixture(t);
    options[key] = "/";
    await assert.rejects(codexLaunch(options), { message: "native_path_invalid" });
  });
}
