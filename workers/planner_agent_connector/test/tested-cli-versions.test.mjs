import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseTestedCliRegistry, testedCliRecord, assertTestedCliVersion } from "../tested-cli-versions.mjs";
import { codexLaunch, CODEX_PROTOCOL_VERSION } from "../codex-launch.mjs";
import { claudeLaunch, CLAUDE_PROTOCOL_VERSION } from "../claude-launch.mjs";
import { openCodeLaunch, OPENCODE_PROTOCOL_VERSION } from "../opencode-launch.mjs";

const source = await readFile(new URL("../tested-cli-versions.json", import.meta.url), "utf8");
const repo = new URL("../../../", import.meta.url);
const contracts = [
  ["codex", "0.154.0", "codex-cli 0.154.0", codexLaunch, CODEX_PROTOCOL_VERSION],
  ["claude", "2.1.263", "2.1.263 (Claude Code)", claudeLaunch, CLAUDE_PROTOCOL_VERSION],
  ["opencode", "1.18.30", "1.18.30", openCodeLaunch, OPENCODE_PROTOCOL_VERSION],
];

test("registry retains exact historical contracts and hashes existing evidence", async () => {
  const registry = parseTestedCliRegistry(source);
  assert.equal(registry.recordedOn, "2026-10-16");
  for (const [provider, version, output, , exportedVersion] of contracts) {
    const record = testedCliRecord(provider);
    assert.equal(record.version, version);
    assert.equal(exportedVersion, version);
    assert.equal(record.versionOutput, output);
    assert.equal(record.installedCliAcceptance.status, "historical-report");
    assert.equal(record.installedCliAcceptance.observedAt, null);
    assert.equal(record.fixtureReplay.status, "scripted-source");
    assert.equal(record.fixtureReplay.recordedNativeFrames, "unknown");
    assert.equal(record.liveProviderAcceptance.status, provider === "codex" ? "historical-report" : "unknown");
    for (const reference of [record.fixtureReplay.source, record.installedCliAcceptance.report, record.liveProviderAcceptance.report].filter(Boolean)) {
      const bytes = await readFile(new URL(reference.path, repo));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), reference.sha256, `${provider} evidence bytes changed: ${reference.path}`);
    }
    assert.throws(() => { record.version = "999.0.0"; }, TypeError);
    assert.throws(() => { record.fixtureReplay.recordedNativeFrames = "recorded"; }, TypeError);
  }
});

test("parser refuses malformed and duplicate registry data", () => {
  for (const bad of [null, new String(source), "{", "x".repeat(32769), `${source}${" ".repeat(32769)}`, "[]", "null", "{}", JSON.stringify({ ...JSON.parse(source), schemaVersion: 2 }),
    JSON.stringify({ ...JSON.parse(source), recordedOn: "2026-10-17" }),
    JSON.stringify({ ...JSON.parse(source), entries: [] })]) {
    assert.throws(() => parseTestedCliRegistry(bad), { message: "native_cli_registry_invalid" });
  }
  const changed = JSON.parse(source);
  changed.entries[1] = structuredClone(changed.entries[0]);
  assert.throws(() => parseTestedCliRegistry(JSON.stringify(changed)), { message: "native_cli_registry_duplicate_provider" });
  // JSON.parse alone silently overwrites duplicate property names.
  assert.throws(() => parseTestedCliRegistry(source.replace('"schemaVersion": 1,', '"schemaVersion": 1, "schemaVersion": 1,')), { message: "native_cli_registry_unreviewed" });
});

test("parser refuses wrong providers and crossed provider proof", () => {
  const unknown = JSON.parse(source);
  unknown.entries[0].provider = "other";
  assert.throws(() => parseTestedCliRegistry(JSON.stringify(unknown)), { message: "native_cli_registry_provider_invalid" });
  assert.throws(() => testedCliRecord("constructor"), { message: "native_cli_registry_provider_invalid" });
  const crossed = JSON.parse(source);
  crossed.entries[0].installedCliAcceptance.report = crossed.entries[1].installedCliAcceptance.report;
  assert.throws(() => parseTestedCliRegistry(JSON.stringify(crossed)), { message: "native_cli_registry_unreviewed" });
});

test("parser refuses unproven acceptance and invented recording or native dates", () => {
  for (const change of [
    record => { record.acceptance = "tested"; },
    record => { record.fixtureReplay.status = "live-recording"; },
    record => { record.installedCliAcceptance.status = "unknown"; },
    record => { record.installedCliAcceptance.observedAt = "2026-10-16"; },
    record => { record.installedCliAcceptance.scope = "live-provider"; },
    record => { record.fixtureReplay.recordedNativeFrames = "recorded"; },
    record => { record.liveProviderAcceptance.status = "accepted"; },
    record => { record.liveProviderAcceptance.status = "accepted"; record.liveProviderAcceptance.report = null; },
    record => { record.liveProviderAcceptance.observedAt = "2026-10-16"; },
    record => { record.liveProviderAcceptance.status = "unknown"; },
  ]) {
    const changed = JSON.parse(source); change(changed.entries[0]);
    assert.throws(() => parseTestedCliRegistry(JSON.stringify(changed)), { message: "native_cli_registry_unproven" });
  }
  for (const change of [
    record => { record.installedCliAcceptance.report.path = "../outside"; },
    record => { record.installedCliAcceptance.report.path = "workers/elsewhere"; },
    record => { record.installedCliAcceptance.report.path = "docs/reviews/../outside"; },
    record => { record.installedCliAcceptance.report.path = "docs/reviews/invalid?path"; },
    record => { record.installedCliAcceptance.report.path = null; },
    record => { record.fixtureReplay.source.sha256 = null; },
    record => { record.fixtureReplay.source.sha256 = "missing"; },
    record => { record.version = ">=0.154.0"; },
    record => { record.version = ">=0.154.0"; record.versionOutput = "codex-cli >=0.154.0"; },
    record => { record.version = null; },
    record => { record.versionOutput = "other"; },
    record => { record.platform = "all"; },
    record => { record.task = "all-tasks"; },
    record => { record.unrecognizedAcceptance = true; },
    record => { record.limits = "none"; },
    record => { record.limits = []; },
    record => { record.limits = Array(9).fill("limit"); },
    record => { record.limits = [null]; },
    record => { record.limits = [""]; },
    record => { record.limits = ["x".repeat(301)]; },
  ]) {
    const changed = JSON.parse(source); change(changed.entries[0]);
    assert.throws(() => parseTestedCliRegistry(JSON.stringify(changed)), { message: "native_cli_registry_invalid" });
  }
});

test("copied proof cannot bless another version and exact output still matters", () => {
  const changed = JSON.parse(source);
  changed.entries[0].version = "0.154.1";
  changed.entries[0].versionOutput = "codex-cli 0.154.1";
  assert.throws(() => parseTestedCliRegistry(JSON.stringify(changed)), { message: "native_cli_registry_unreviewed" });
  for (const [provider, , output] of contracts) {
    assertTestedCliVersion(provider, `\n${output}\n`);
    for (const bad of [null, `${output}\nextra`, `${output}-new`, ...contracts.filter(row => row[0] !== provider).map(row => row[2])]) {
      assert.throws(() => assertTestedCliVersion(provider, bad), { message: "native_version_unsupported" });
    }
  }
});

// These are version-output shell stubs, not installed provider binaries. Only
// launch construction runs. No bubblewrap, model server or account is started.
for (const [provider, version, output, launch] of contracts) {
  test(`real ${provider} launcher consumes registry and refuses before profile access`, async () => {
    const root = await mkdtemp(join(tmpdir(), `registry-${provider}-`));
    const bin = join(root, "bin"), profile = join(root, "profile"), scratch = join(root, "scratch");
    await mkdir(bin, { mode: 0o700 }); await mkdir(profile, { mode: 0o700 }); await mkdir(scratch, { mode: 0o700 });
    const binaryPath = join(bin, provider);
    const options = { binaryPath, providerHome: profile, scratchPath: scratch,
      relayUrl: `http://127.0.0.1:12345/${"a".repeat(64)}`, serverPassword: "b".repeat(64) };
    const probe = async text => writeFile(binaryPath, `#!/bin/sh\nprintf '%s\\n' '${text}'\n`, { mode: 0o700 });
    for (const bad of [output.replace(version, "999.0.0"), ...contracts.filter(row => row[0] !== provider).map(row => row[2])]) {
      await probe(bad);
      await assert.rejects(launch({ ...options, providerHome: join(root, "absent-profile") }), { message: "native_version_unsupported" });
      assert.deepEqual(await readdir(scratch), [], "version refusal created scratch state");
    }
    await writeFile(binaryPath, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    await assert.rejects(launch(options), { message: "native_version_unavailable" });
    await probe(output);
    // Mock the registry seam only in this child. The actual launcher must call
    // it with its provider and discovered output before reading the profile.
    // Separate parser/output tests above exercise the real registry guard.
    const exportName = provider === "opencode" ? "openCodeLaunch" : `${provider}Launch`;
    const wiringScript = `
      import { mock } from 'node:test';
      import assert from 'node:assert/strict';
      mock.module(${JSON.stringify(new URL("../tested-cli-versions.mjs", import.meta.url).href)}, {
        namedExports: {
          testedCliRecord: p => { assert.equal(p, ${JSON.stringify(provider)}); return { version: ${JSON.stringify(version)} }; },
          assertTestedCliVersion: (p, text) => {
            assert.equal(p, ${JSON.stringify(provider)}); assert.equal(text.trim(), ${JSON.stringify(output)});
            throw new Error('registry_wiring_observed');
          },
        },
      });
      const { ${exportName}: launch } = await import(${JSON.stringify(new URL(`../${provider}-launch.mjs`, import.meta.url).href)});
      await assert.rejects(launch(${JSON.stringify({ ...options, providerHome: join(root, "absent-profile") })}), { message: 'registry_wiring_observed' });
      process.stdout.write('registry wiring observed');
    `;
    const wiring = await promisify(execFile)(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "-e", wiringScript], { timeout: 5_000, maxBuffer: 16_384 });
    assert.equal(wiring.stdout, "registry wiring observed");
    const result = await launch(options);
    assert.equal(result.command, "/usr/bin/bwrap");
    assert.equal(result.options.shell, false);
    assert.ok(result.args.includes("--die-with-parent"));
    assert.ok(result.args.includes("--ro-bind"));
    assert.equal(result.options.env.HOME, "/home/openplan");
  });
}
