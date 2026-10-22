import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, readdir, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { installerGuidance } from "../installer-guidance.mjs";
import { installerGuidanceMain } from "../installer-guidance-cli.mjs";

const packages = { codex: "@openai/codex", claude: "@anthropic-ai/claude-code", opencode: "opencode-ai" };
const versions = { codex: "0.154.0", claude: "2.1.263", opencode: "1.18.30" };
async function fixture(t, provider = "codex", layout = "lib") {
  const root = await mkdtemp(join(tmpdir(), "openplan-installer-guidance-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const npmGlobalRoot = join(root, layout, "node_modules");
  const directory = join(npmGlobalRoot, packages[provider]);
  await mkdir(join(directory, "bin"), { recursive: true });
  const binaryPath = join(directory, "bin", provider);
  await writeFile(binaryPath, `#!/bin/sh\ntouch '${root}/UNEXPECTED-EXECUTION'\n`, { mode: 0o700 });
  const metadataPath = join(directory, "package.json");
  const metadata = { name: packages[provider], version: "0.1.0", bin: { [provider]: `bin/${provider}` } };
  const save = value => writeFile(metadataPath, JSON.stringify(value));
  await save(metadata);
  return { root, directory, metadataPath, metadata, save,
    input: { provider, binaryPath, installer: "npm", npmGlobalRoot, platform: "linux" } };
}
function unknown(result, reason) {
  assert.equal(result.installer, "unknown");
  assert.equal(result.ownership, "unverified");
  assert.equal(result.command, null);
  assert.equal(result.installedPackageVersion, null);
  assert.equal(result.executesUpdate, false);
  if (reason) assert.equal(result.reason, reason);
}
async function inventory(root) {
  const result = {};
  async function walk(path) {
    for (const name of await readdir(path)) {
      const file = join(path, name); const stat = await lstat(file);
      if (stat.isDirectory()) await walk(file);
      else if (stat.isFile()) result[file] = createHash("sha256").update(await readFile(file)).digest("hex");
    }
  }
  await walk(root); return result;
}

test("npm entry guidance pins all providers without executing or changing files", async t => {
  for (const provider of Object.keys(packages)) {
    const f = await fixture(t, provider); const before = await inventory(f.root);
    const result = await installerGuidance(f.input);
    assert.equal(result.installer, "npm");
    assert.equal(result.ownership, "operator_declared_entry_verified");
    assert.equal(result.installedPackageVersion, "0.1.0");
    assert.equal(result.testedVersion, versions[provider]);
    assert.deepEqual(result.command, { executable: "npm", args: ["install", "--global", "--prefix", f.root, `${packages[provider]}@${versions[provider]}`] });
    assert.equal(result.executesUpdate, false);
    assert.deepEqual(await inventory(f.root), before);
    assert.ok(!JSON.stringify({ ...result, command: null }).includes(f.root));
    const link = join(f.root, provider); await symlink(f.input.binaryPath, link);
    assert.deepEqual(await installerGuidance({ ...f.input, binaryPath: link }), result);
  }
});
test("npm command stays in the inspected global prefix", async t => {
  const f = await fixture(t);
  assert.deepEqual((await installerGuidance(f.input)).command.args.slice(0, 4), ["install", "--global", "--prefix", f.root]);
  const other = await fixture(t, "codex", "share");
  unknown(await installerGuidance(other.input), "package_layout_unsupported");
});
test("installer and platform need explicit supported declarations", async t => {
  const f = await fixture(t);
  for (const installer of [null, undefined, "bun", "brew", "npm;touch marker"])
    unknown(await installerGuidance({ ...f.input, installer }), "installer_not_verified");
  unknown(await installerGuidance({ ...f.input, platform: "darwin" }), "platform_unsupported");
  unknown(await installerGuidance({ ...f.input, binaryPath: "relative" }), "installation_path_invalid");
  unknown(await installerGuidance({ ...f.input, npmGlobalRoot: "relative" }), "installation_path_invalid");
});
test("a declared global root must own the exact selected binary", async t => {
  const f = await fixture(t); const other = join(f.root, "other-binary"); await writeFile(other, "not the package entry");
  unknown(await installerGuidance({ ...f.input, binaryPath: other }), "binary_entry_mismatch");
  unknown(await installerGuidance({ ...f.input, provider: "claude" }), "installation_unreadable");
});
test("package entries cannot escape their declared package", async t => {
  const f = await fixture(t); const other = join(f.root, "external"); await writeFile(other, "external binary");
  for (const entry of [other, "../../../external", "../external", "..\\external", ""]) {
    await f.save({ ...f.metadata, bin: { codex: entry } });
    unknown(await installerGuidance({ ...f.input, binaryPath: other }));
  }
  await symlink(other, join(f.directory, "escape"));
  await f.save({ ...f.metadata, bin: { codex: "escape" } });
  unknown(await installerGuidance({ ...f.input, binaryPath: other }), "binary_entry_mismatch");
});
test("metadata must be bounded regular provider metadata", async t => {
  const f = await fixture(t);
  for (const value of [{ ...f.metadata, name: packages.claude }, { ...f.metadata, version: "latest;touch marker" }, { ...f.metadata, version: null }, { ...f.metadata, bin: {} }]) {
    await f.save(value); unknown(await installerGuidance(f.input));
  }
  await writeFile(f.metadataPath, "invalid JSON"); unknown(await installerGuidance(f.input), "installation_unreadable");
  await writeFile(f.metadataPath, JSON.stringify(f.metadata) + " ".repeat(65_536));
  unknown(await installerGuidance(f.input), "package_metadata_invalid");
});
test("linked package metadata does not produce an update command", async t => {
  const f = await fixture(t); const saved = join(f.root, "outside-metadata.json"); await writeFile(saved, JSON.stringify(f.metadata));
  await rm(f.metadataPath); await symlink(saved, f.metadataPath);
  unknown(await installerGuidance(f.input), "installation_unreadable");
});
test("CLI enforces complete unique flags and emits safe metadata only", async t => {
  const f = await fixture(t); const args = ["--provider", "codex", "--binary", f.input.binaryPath, "--installer", "npm", "--npm-root", f.input.npmGlobalRoot];
  assert.deepEqual(JSON.parse(await installerGuidanceMain(args)), await installerGuidance(f.input));
  unknown(JSON.parse(await installerGuidanceMain(args.slice(0, 4))), "installer_not_verified");
  for (const bad of [[], ["--provider", "codex"], [...args, "--provider", "codex"], [...args, "--execute"], [...args, "--execute", "yes"], args.slice(0, 6), ["--help", "--execute"], ["--provider", "codex", "--binary", "--installer"], [...args.slice(0, 4), "--npm-root", f.input.npmGlobalRoot]])
    await assert.rejects(installerGuidanceMain(bad), { message: "installer_guidance_arguments_invalid" });
  await assert.rejects(installerGuidanceMain(["--provider", "unknown", "--binary", f.input.binaryPath]), { message: "native_cli_registry_provider_invalid" });
  assert.match(await installerGuidanceMain(["--help"]), /never runs the binary, npm, a model or an update/);
});
