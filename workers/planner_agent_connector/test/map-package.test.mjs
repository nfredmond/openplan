import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildSkillManifest, MAP_PACKAGE_SKILL_ROOT, verifiedSkillManifest } from "../map-package-skill.mjs";
import { claudeMapArgs, claudeMapEnv, claudeMapSettings, foldClaudeMapEvent, initialClaudeMapState } from "../map-package-claude.mjs";
import { checkedMapClaim, downscalePreview, mapPackageCycle, readMapRunJournal } from "../map-package-run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), "openplan-map-package-test-"));
after(() => rm(scratch, { recursive: true, force: true }));
const manifest = await verifiedSkillManifest();

async function fakeClaude(mode) {
  const path = join(scratch, `claude-${mode}-${randomUUID()}`);
  await writeFile(path, `#!/bin/sh\nFAKE_CLAUDE_MODE=${mode} exec "${process.execPath}" "${join(here, "fake-claude-map.mjs")}" "$@"\n`);
  await chmod(path, 0o700);
  return path;
}

function claimFor(overrides = {}) {
  const brief = { version: 1, kind: "openplan.map_package_brief", client: "Synthetic Agency", practice: true,
    studyArea: { type: "FeatureCollection", features: [{ type: "Feature", properties: { role: "site", name: null }, geometry: { type: "Point", coordinates: [-121.1, 38.8] } }] } };
  const briefCanonical = JSON.stringify(brief);
  return { id: randomUUID(), attemptId: randomUUID(), workspaceId: randomUUID(), projectId: randomUUID(), title: "Synthetic figures",
    provider: "claude", authMode: "claude_subscription", model: "claude-fable-5-1", effort: "high",
    briefCanonical, briefHash: createHash("sha256").update(briefCanonical).digest("hex"),
    skill: { name: "transportation-gis", treeHash: manifest.treeHash }, promptVersion: 1, prompt: "Build the synthetic package.",
    leaseExpiresAt: new Date(Date.now() + 600_000).toISOString(), ...overrides };
}

function fakeApp({ claim = claimFor(), heartbeatState = "running" } = {}) {
  const calls = [];
  let claimed = false;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(url, "http://127.0.0.1:3000/api/map-packages/connector");
    assert.match(init.headers.authorization, /^Bearer op_pc_/);
    calls.push(body);
    const reply = value => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
    switch (body.operation) {
      case "claim": { const pkg = claimed ? null : claim; claimed = true; return reply({ status: "connected", package: pkg }); }
      case "heartbeat": return reply({ state: heartbeatState, leaseExpiresAt: null });
      case "upload": return reply({ uploads: body.files.map(file => ({ name: file.name, url: `https://storage.example.test/${file.name}?token=t` })) });
      case "complete": return reply({ state: "ready" });
      case "fail": return reply({ state: "failed", failureCode: body.failureCode });
      default: return new Response("{}", { status: 400 });
    }
  };
  return { calls, fetchImpl };
}

async function connection(mode) {
  const home = await mkdtemp(join(scratch, "home-"));
  const providerHome = join(home, ".claude");
  const configDir = join(home, "openplan-connection");
  await mkdir(providerHome); await mkdir(configDir);
  return {
    config: { binaryPath: await fakeClaude(mode), providerHome,
      setup: { version: 2, provider: "claude", appUrl: "http://127.0.0.1:3000", connectionId: randomUUID(), workspaceId: randomUUID(),
        projectId: randomUUID(), expectedAuthMode: "claude_subscription", token: `op_pc_${"0".repeat(8)}` } },
    runsRoot: join(home, "OpenPlan Map Packages"), connectorDir: configDir,
  };
}
// The token must match the setup's connection id for checkedConnectorSetup.
function withToken(config) {
  config.setup.token = `op_pc_${config.setup.connectionId}.${"A".repeat(43)}`;
  return config;
}

describe("map package skill copy", () => {
  it("matches its recorded manifest, and a one-byte change is refused", async () => {
    assert.equal((await buildSkillManifest()).treeHash, manifest.treeHash);
    const copy = join(scratch, "skill-copy", "transportation-gis");
    await cp(MAP_PACKAGE_SKILL_ROOT, copy, { recursive: true });
    await writeFile(join(copy, "SKILL.md"), `${await readFile(join(copy, "SKILL.md"), "utf8")} `);
    await cp(join(MAP_PACKAGE_SKILL_ROOT, "..", "MANIFEST.json"), join(scratch, "skill-copy", "MANIFEST.json"));
    await assert.rejects(verifiedSkillManifest(copy, join(scratch, "skill-copy", "MANIFEST.json")), { code: "skill_manifest_mismatch" });
  });
});

describe("map package Claude launch", () => {
  const settings = claudeMapSettings({ runDir: "/home/p/OpenPlan Map Packages/run", claudeConfigDir: "/home/p/.claude", connectorDir: "/home/p/openplan-connection", home: "/home/p" });

  it("keeps the credentials and the connection folder out of every tool", () => {
    for (const secret of ["/home/p/.claude", "/home/p/openplan-connection", "/home/p/.claude.json"]) {
      for (const tool of ["Read", "Edit", "Write"]) {
        assert.ok(settings.permissions.deny.includes(`${tool}(/${secret})`), `${tool} ${secret}`);
        assert.ok(settings.permissions.deny.includes(`${tool}(/${secret}/**)`), `${tool} ${secret}/**`);
      }
      assert.ok(settings.sandbox.filesystem.denyRead.includes(secret));
    }
    assert.deepEqual(settings.sandbox.credentials.files, [{ path: "/home/p/.claude", mode: "deny" }, { path: "/home/p/openplan-connection", mode: "deny" }]);
    assert.equal(settings.sandbox.enabled, true);
    assert.equal(settings.sandbox.failIfUnavailable, true);
    assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
    assert.equal(settings.permissions.defaultMode, "dontAsk");
    assert.equal(settings.permissions.blockReadsOutsideWorkingDirectories, true);
    // Writes are pre-approved only inside the run folder; nothing approves Bash outside the sandbox.
    assert.deepEqual(settings.permissions.allow.filter(rule => /^(Edit|Write)\(/.test(rule)),
      ["Edit(//home/p/OpenPlan Map Packages/run/**)", "Write(//home/p/OpenPlan Map Packages/run/**)"]);
    assert.ok(!settings.permissions.allow.some(rule => rule.startsWith("Bash")));
  });

  it("refuses a run folder inside the connection folder or a connection folder at home", () => {
    assert.throws(() => claudeMapSettings({ runDir: "/home/p/c/run", claudeConfigDir: "/home/p/.claude", connectorDir: "/home/p/c", home: "/home/p" }), /map_run_path_invalid/);
    assert.throws(() => claudeMapSettings({ runDir: "/home/p/run", claudeConfigDir: "/home/p/.claude", connectorDir: "/home/p", home: "/home/p" }), /map_run_path_invalid/);
  });

  it("names the model and effort and ignores the planner's own settings files", () => {
    const args = claudeMapArgs({ model: "claude-fable-5-1", effort: "high", pluginDir: "/run/plugin", settings });
    const value = flag => args[args.indexOf(flag) + 1];
    assert.equal(value("--model"), "claude-fable-5-1");
    assert.equal(value("--effort"), "high");
    assert.equal(value("--setting-sources"), "");
    assert.equal(value("--permission-mode"), "dontAsk");
    assert.equal(value("--plugin-dir"), "/run/plugin");
    assert.deepEqual(JSON.parse(value("--settings")), settings);
    assert.throws(() => claudeMapArgs({ model: "gpt-6-astra", effort: "high", pluginDir: "/p", settings }), /map_run_model_invalid/);
  });

  it("pins every model alias and passes no API key", () => {
    process.env.ANTHROPIC_API_KEY = "SYNTHETIC-KEY-MUST-NOT-PASS";
    try {
      const env = claudeMapEnv({ model: "claude-fable-5-1", home: "/home/p", claudeConfigDir: "/home/p/.claude", path: "/usr/bin" });
      assert.equal(env.ANTHROPIC_API_KEY, undefined);
      for (const key of ["ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"]) {
        assert.equal(env[key], "claude-fable-5-1", key);
      }
    } finally { delete process.env.ANTHROPIC_API_KEY; }
  });

  it("turns the stream into short plain progress lines without paths or query strings", () => {
    let state = initialClaudeMapState();
    state = foldClaudeMapEvent(state, { type: "assistant", message: { content: [
      { type: "tool_use", name: "Read", input: { file_path: "/home/p/secret/folder/fig01.png" } },
      { type: "tool_use", name: "WebFetch", input: { url: "https://example.gov/data?token=SECRET" } },
    ] } });
    assert.deepEqual(state.recent, ["Reading fig01.png", "Reading example.gov"]);
    assert.equal(state.steps, 2);
  });
});

describe("map package claim checks", () => {
  it("refuses any model other than Claude Fable 5.1, a changed brief and another kit", async () => {
    await assert.rejects(checkedMapClaim(claimFor({ model: "claude-opus-5-5" })), { code: "map_package_runner_refused" });
    await assert.rejects(checkedMapClaim(claimFor({ effort: "medium" })), { code: "map_package_runner_refused" });
    await assert.rejects(checkedMapClaim(claimFor({ briefHash: "0".repeat(64) })), { code: "map_brief_mismatch" });
    await assert.rejects(checkedMapClaim(claimFor({ skill: { name: "transportation-gis", treeHash: "1".repeat(64) } })), { code: "map_skill_version_mismatch" });
    assert.equal((await checkedMapClaim(claimFor())).skillTreeHash, manifest.treeHash);
  });
});

describe("map package cycle", () => {
  it("runs the agent, finds the package and delivers measured files with an honest receipt", async () => {
    const { config, runsRoot, connectorDir } = await connection("success");
    withToken(config);
    const app = fakeApp();
    const uploaded = [];
    const put = async (url, path, contentType) => { uploaded.push({ url, contentType, sha256: createHash("sha256").update(await readFile(path)).digest("hex") }); return "uploaded"; };
    process.env.ANTHROPIC_API_KEY = "SYNTHETIC-KEY-MUST-NOT-PASS";
    let result;
    try { result = await mapPackageCycle(config, { runsRoot, connectorDir, fetchImpl: app.fetchImpl, put, heartbeatMs: 10_000 }); }
    finally { delete process.env.ANTHROPIC_API_KEY; }
    assert.equal(result, "ready");
    const upload = app.calls.find(call => call.operation === "upload");
    assert.deepEqual(upload.receipt.modelsUsed, ["claude-fable-5-1"]);
    assert.equal(upload.receipt.model, "claude-fable-5-1");
    assert.equal(upload.receipt.kitChanged, false);
    assert.deepEqual(upload.receipt.qa, { checks: 40, passed: 38, failed: 0, notes: 2 });
    assert.deepEqual(upload.receipt.gates, { data: "passed", cartography: "pending" });
    assert.deepEqual(upload.receipt.figures.map(figure => [figure.id, figure.preview]), [["fig01_study_area", "fig01_study_area.png"], ["fig02_crashes", null]]);
    assert.deepEqual(upload.files.map(file => [file.role, file.name]), [["package_zip", "synthetic_maps_20261010.zip"], ["figure_preview", "fig01_study_area.png"], ["run_report", "openplan_report.md"]]);
    assert.equal(upload.files[0].sha256, createHash("sha256").update("synthetic-zip-bytes").digest("hex"));
    assert.deepEqual(uploaded.map(item => item.sha256), upload.files.map(file => file.sha256));
    assert.ok(app.calls.some(call => call.operation === "complete"));
    const runDir = join(runsRoot, (await readdir(runsRoot))[0]);
    assert.equal((await readMapRunJournal(runDir)).phase, "delivered");
    const launch = JSON.parse(await readFile(join(runDir, "openplan_fake_launch.json"), "utf8"));
    assert.equal(launch.prompt, "Build the synthetic package.");
    assert.equal(launch.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(launch.env.CLAUDE_CONFIG_DIR, config.providerHome);
    assert.deepEqual(JSON.parse(await readFile(join(runDir, "inputs", "openplan_study_area.geojson"), "utf8")).features[0].geometry.type, "Point");
    assert.equal((await buildSkillManifest(join(runDir, "openplan-skill-plugin", "skills", "transportation-gis"))).treeHash, manifest.treeHash);
  });

  for (const [mode, code] of [["extra-model", "map_package_other_model_used"], ["wrong-init-model", "map_package_model_changed"],
    ["api-key", "map_package_api_key_billing"], ["max-turns", "map_package_max_turns"]]) {
    it(`fails without uploading when ${mode}`, async () => {
      const { config, runsRoot, connectorDir } = await connection(mode);
      withToken(config);
      const app = fakeApp();
      const result = await mapPackageCycle(config, { runsRoot, connectorDir, fetchImpl: app.fetchImpl, put: async () => assert.fail("uploaded"), heartbeatMs: 10_000 });
      assert.equal(result, code);
      assert.deepEqual(app.calls.filter(call => call.operation === "fail").map(call => call.failureCode), [code]);
      assert.ok(!app.calls.some(call => call.operation === "upload"));
    });
  }

  it("stops the agent when the app says the package was cancelled", { timeout: 20_000 }, async () => {
    const { config, runsRoot, connectorDir } = await connection("wait");
    withToken(config);
    const app = fakeApp({ heartbeatState: "cancelled" });
    const result = await mapPackageCycle(config, { runsRoot, connectorDir, fetchImpl: app.fetchImpl, put: async () => assert.fail("uploaded"), heartbeatMs: 50, maxMs: 15_000 });
    assert.equal(result, "stopped");
    assert.ok(!app.calls.some(call => call.operation === "upload"));
  });

  it("never restarts an agent cut off mid-run, and resumes only an upload", async () => {
    const { config, runsRoot, connectorDir } = await connection("success");
    withToken(config);
    const cut = join(runsRoot, "cut-off-run"); await mkdir(cut, { recursive: true });
    const cutJournal = { schemaVersion: 1, connectionId: config.setup.connectionId, packageId: randomUUID(), attemptId: randomUUID(), phase: "running" };
    await writeFile(join(cut, "openplan_run.json"), JSON.stringify(cutJournal));
    const app = fakeApp({ claim: null });
    assert.equal(await mapPackageCycle(config, { runsRoot, connectorDir, fetchImpl: app.fetchImpl, spawnImpl: undefined }), "connected");
    assert.deepEqual(app.calls.filter(call => call.operation === "fail").map(call => [call.packageId, call.failureCode]), [[cutJournal.packageId, "map_package_connector_restarted"]]);
    assert.equal((await readMapRunJournal(cut)).phase, "stopped");
    // A later cycle leaves the stopped run alone: no second report, no upload.
    const later = fakeApp({ claim: null });
    assert.equal(await mapPackageCycle(config, { runsRoot, connectorDir, fetchImpl: later.fetchImpl, put: async () => assert.fail("uploaded") }), "connected");
    assert.deepEqual(later.calls.map(call => call.operation), ["claim"]);

    const built = join(runsRoot, "built-run"); await mkdir(built, { recursive: true });
    const zip = join(built, "x_maps_20261010.zip"); await writeFile(zip, "zip");
    const builtJournal = { schemaVersion: 1, connectionId: config.setup.connectionId, packageId: randomUUID(), attemptId: randomUUID(), phase: "built",
      receipt: { schemaVersion: 1 }, files: [{ role: "package_zip", name: "x_maps_20261010.zip", path: zip, contentType: "application/zip", bytes: 3, sha256: "a".repeat(64) }] };
    await writeFile(join(built, "openplan_run.json"), JSON.stringify(builtJournal));
    const resumed = fakeApp({ claim: null });
    const spawnImpl = () => assert.fail("the agent ran again");
    assert.equal(await mapPackageCycle(config, { runsRoot, connectorDir, fetchImpl: resumed.fetchImpl, spawnImpl, put: async () => "uploaded" }), "ready");
    assert.deepEqual(resumed.calls.map(call => call.operation), ["upload", "complete"]);
  });
});

describe("map package figure previews", () => {
  const pillow = spawnSync("python3", ["-I", "-c", "import PIL"]).status === 0;
  it("shrinks a large figure to page size and leaves an unreadable one alone", { skip: pillow ? false : "python3 with Pillow is not installed" }, async () => {
    const big = join(scratch, "big.png"), small = join(scratch, "small.png"), broken = join(scratch, "broken.png");
    spawnSync("python3", ["-I", "-c", "import sys\nfrom PIL import Image\nImage.new('RGB', (3000, 2000), 'white').save(sys.argv[1])", big]);
    assert.equal(await downscalePreview(big, small), small);
    const width = Number(spawnSync("python3", ["-I", "-c", "import sys\nfrom PIL import Image\nprint(Image.open(sys.argv[1]).size[0])", small], { encoding: "utf8" }).stdout.trim());
    assert.equal(width, 1600);
    await writeFile(broken, "not a png");
    assert.equal(await downscalePreview(broken, join(scratch, "broken-small.png")), null);
  });
});
