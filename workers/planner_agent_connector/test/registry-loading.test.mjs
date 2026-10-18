import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

// Exercise Node loading from private copied source, without a provider process,
// sandbox, account, HTTP server or installed CLI. Never alter repository inputs.
test("Node registry loading stays module-relative and refuses changed or absent bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "registry-loading-"));
  try {
    const moduleDir = join(root, "connector space # é");
    const ambient = join(root, "unrelated-cwd");
    await mkdir(moduleDir);
    await mkdir(ambient);
    const modulePath = join(moduleDir, "tested-cli-versions.mjs");
    const manifestPath = join(moduleDir, "tested-cli-versions.json");
    const manifest = await readFile(new URL("../tested-cli-versions.json", import.meta.url), "utf8");
    await copyFile(new URL("../tested-cli-versions.mjs", import.meta.url), modulePath);
    await writeFile(manifestPath, manifest);
    await writeFile(join(ambient, "tested-cli-versions.json"), "{}");
    const script = `
      import assert from 'node:assert/strict';
      const { testedCliRecord, assertTestedCliVersion } = await import(${JSON.stringify(pathToFileURL(modulePath).href)});
      for (const [provider, version, output] of [
        ['codex', '0.154.0', 'codex-cli 0.154.0'],
        ['claude', '2.1.263', '2.1.263 (Claude Code)'],
        ['opencode', '1.18.30', '1.18.30'],
      ]) {
        const record = testedCliRecord(provider);
        assert.equal(record.version, version);
        assert.equal(record.installedCliAcceptance.observedAt, null);
        assert.equal(record.fixtureReplay.recordedNativeFrames, 'unknown');
        assertTestedCliVersion(provider, output);
        assert.throws(() => assertTestedCliVersion(provider, output + '-unreviewed'), { message: 'native_version_unsupported' });
      }
      process.stdout.write('strict registry loaded');
    `;
    const load = () => spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: ambient, encoding: "utf8", timeout: 5_000, maxBuffer: 16_384,
    });
    const valid = load();
    assert.equal(valid.error, undefined);
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(valid.stdout, "strict registry loaded");

    // Whitespace keeps the parsed JSON unchanged, but violates the exact pin.
    await writeFile(manifestPath, `${manifest}\n`);
    const changed = load();
    assert.equal(changed.error, undefined);
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /Error: native_cli_registry_unreviewed/);

    // Even a valid ambient copy cannot replace a missing adjacent manifest.
    await writeFile(join(ambient, "tested-cli-versions.json"), manifest);
    await rm(manifestPath);
    const absent = load();
    assert.equal(absent.error, undefined);
    assert.equal(absent.status, 1);
    assert.match(absent.stderr, /Cannot find module '\.\/tested-cli-versions\.json'/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
