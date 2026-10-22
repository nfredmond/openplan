import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const output = "/home/nathaniel/.local/state/openplan/a0-tested-cli-version-registry-20261016";
assert.equal(process.env.TMPDIR, join(output, "tmp"), "Run only with the owned private TMPDIR under the compiler lock.");
const logs = mkdtempSync(join(output, "campaign-"));
const modulePath = "workers/planner_agent_connector/tested-cli-versions.mjs";
const manifestPath = "workers/planner_agent_connector/tested-cli-versions.json";
const testPath = "workers/planner_agent_connector/test/tested-cli-versions.test.mjs";
const read = path => readFileSync(resolve(repo, path), "utf8");
const hash = text => createHash("sha256").update(text).digest("hex");
const paths = [modulePath, manifestPath, testPath, ...["codex", "claude", "opencode"].map(p => `workers/planner_agent_connector/${p}-launch.mjs`)];
const originals = new Map(paths.map(path => [path, read(path)]));
const results = [];
const names = {
  evidence: "registry retains exact historical contracts and hashes existing evidence",
  malformed: "parser refuses malformed and duplicate registry data",
  provider: "parser refuses wrong providers and crossed provider proof",
  unproven: "parser refuses unproven acceptance and invented recording or native dates",
  version: "copied proof cannot bless another version and exact output still matters",
};
function replace(path, before, after) {
  const source = read(path);
  assert.equal(source.split(before).length - 1, 1, `Mutation anchor must be unique: ${before}`);
  writeFileSync(resolve(repo, path), source.replace(before, after));
}
function run(id, target) {
  const result = spawnSync(process.execPath, ["--max-old-space-size=1024", "--test", "--test-concurrency=1", "--test-reporter=tap",
    ...(target ? ["--test-name-pattern", `^${target}$`] : []), testPath], {
    cwd: repo, encoding: "utf8", timeout: 15_000, maxBuffer: 256_000,
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=1024" },
  });
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  writeFileSync(join(logs, `control-${id}.log`), log, { mode: 0o600 });
  return { result, log };
}
function restore() {
  for (const [path, source] of originals) {
    if (read(path) !== source) writeFileSync(resolve(repo, path), source);
    assert.equal(hash(read(path)), hash(source), `Exact restoration failed: ${path}`);
  }
}
function control(id, mutate, target, survivor = false) {
  try {
    mutate();
    const { result, log } = run(id, target);
    assert.equal(result.error, undefined, `${id}: test process failed to run`);
    if (survivor) {
      assert.equal(result.status, 0, `${id}: harmless control failed`);
      assert.match(log, /# pass 8\n/);
    } else {
      assert.equal(result.status, 1, `${id}: targeted mutation survived`);
      assert.ok(log.includes(`not ok 1 - ${target}\n`), `${id}: wrong test failed`);
      assert.match(log, /ERR_ASSERTION|AssertionError/, `${id}: expected an assertion failure`);
    }
    results.push({ id, outcome: survivor ? "survived" : "killed", assertion: target ?? "all eight tests", restored: true });
    process.stdout.write(`${id}: ${survivor ? "survived" : "killed"}\n`);
  } catch (error) {
    results.push({ id, outcome: "unexpected", error: error.message, restored: true });
    process.stdout.write(`${id}: UNRESOLVED ${error.message}\n`);
  } finally { restore(); }
}

mkdirSync(output, { mode: 0o700, recursive: true });
// Prove the runner can report a survivor before trusting any killed mutation.
for (const path of paths.filter(path => path !== manifestPath)) {
  control(`harmless-${path.split("/").at(-1)}`, () => writeFileSync(resolve(repo, path), `${read(path)}\n// Harmless control.\n`), undefined, true);
}

const cases = [
  ["source-bound", 'if (typeof source !== "string" || Buffer.byteLength(source) > 32_768)', 'if (false)', names.malformed],
  ["shape", 'Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))', 'false', names.unproven],
  ["schema", 'registry.schemaVersion !== 1', 'false', names.malformed],
  ["date", 'registry.recordedOn !== "2026-10-16"', 'false', names.malformed],
  ["entry-count", 'registry.entries.length !== PROVIDERS.length', 'false', names.malformed],
  ["provider", '!PROVIDERS.includes(entry.provider)', 'false', names.provider],
  ["duplicate", 'seen.has(entry.provider)', 'false', names.malformed],
  ["version-shape", '!/^\\d+\\.\\d+\\.\\d+$/.test(entry.version)', 'false', names.unproven],
  ["output-format", 'entry.versionOutput !== (entry.provider === "codex" ? `codex-cli ${entry.version}` :\n        entry.provider === "claude" ? `${entry.version} (Claude Code)` : entry.version)', 'false', names.unproven],
  ["platform", 'entry.platform !== "linux"', 'false', names.unproven],
  ["task", 'entry.task !== "retained-project-task"', 'false', names.unproven],
  ["acceptance", 'entry.acceptance !== "preserved-exact-version"', 'false', names.unproven],
  ["fixture-tier", 'entry.fixtureReplay.status !== "scripted-source"', 'false', names.unproven],
  ["recording-tier", 'entry.fixtureReplay.recordedNativeFrames !== "unknown"', 'false', names.unproven],
  ["native-tier", 'entry.installedCliAcceptance.status !== "historical-report"', 'false', names.unproven],
  ["native-date", 'entry.installedCliAcceptance.observedAt !== null', 'false', names.unproven],
  ["native-scope", 'entry.installedCliAcceptance.scope !== "installed-cli-with-scripted-local-responses"', 'false', names.unproven],
  ["live-tier", '!["historical-report", "unknown"].includes(entry.liveProviderAcceptance.status)', 'false', names.unproven],
  ["live-date", 'entry.liveProviderAcceptance.observedAt !== null', 'false', names.unproven],
  ["unknown-live-proof", 'entry.liveProviderAcceptance.report !== null', 'false', names.unproven],
  ["reference-prefix", '!value.path.startsWith(prefix)', 'false', names.unproven],
  ["reference-traversal", 'value.path.includes("..")', 'false', names.unproven],
  ["reference-characters", '!/^[a-zA-Z0-9_./-]+$/.test(value.path)', 'false', names.unproven],
  ["reference-hash", '!/^[a-f0-9]{64}$/.test(value.sha256)', 'false', names.unproven],
  ["limits-type", '!Array.isArray(entry.limits)', 'false', names.unproven],
  ["limits-empty", 'entry.limits.length < 1', 'false', names.unproven],
  ["limits-count", 'entry.limits.length > 8', 'false', names.unproven],
  ["limits-content", 'entry.limits.some(limit => typeof limit !== "string" || !limit.length || limit.length > 300)', 'false', names.unproven],
  ["review-pin", 'createHash("sha256").update(source).digest("hex") !== REVIEWED_MANIFEST_SHA256', 'false', names.version],
  ["lookup", 'record.provider === provider', 'true', names.evidence],
  ["freeze", 'Object.freeze(value);', '// Broken: omit freezing.', names.evidence],
  ["version-refusal", 'output.trim() !== testedCliRecord(provider).versionOutput', 'false', names.version],
];
for (const [id, before, after, target] of cases) control(id, () => replace(modulePath, before, after), target);

// Check the test's evidence oracle, even when an editor also changes the pin.
control("evidence-byte-binding", () => {
  const previous = read(manifestPath), changed = JSON.parse(previous);
  changed.entries[0].fixtureReplay.source.sha256 = "0".repeat(64);
  const next = `${JSON.stringify(changed, null, 2)}\n`;
  writeFileSync(resolve(repo, manifestPath), next);
  replace(modulePath, hash(previous), hash(next));
}, names.evidence);

for (const provider of ["codex", "claude", "opencode"]) {
  const path = `workers/planner_agent_connector/${provider}-launch.mjs`;
  const target = `real ${provider} launcher consumes registry and refuses before profile access`;
  control(`${provider}-allow-untested`, () => replace(path, `  assertTestedCliVersion("${provider}", version.stdout);`, "  // Broken: omit the version gate."), target);
  const oldCheck = provider === "codex" ? 'version.stdout.trim() !== "codex-cli 0.154.0"' :
    provider === "claude" ? 'version.stdout.trim() !== "2.1.263 (Claude Code)"' : 'version.stdout.trim() !== "1.18.30"';
  control(`${provider}-bypass-registry`, () => replace(path, `  assertTestedCliVersion("${provider}", version.stdout);`, `  if (${oldCheck}) throw new Error("native_version_unsupported");`), target);
}

const final = run("restored-final");
assert.equal(final.result.status, 0, "Restored final tests failed");
restore();
writeFileSync(join(logs, "controls.json"), `${JSON.stringify({
  sourceHashes: Object.fromEntries([...originals].map(([path, source]) => [path, hash(source)])),
  controls: results, final: { passed: 8, failed: 0, skipped: 0 },
  blinds: ["No installed provider binary, sandbox execution, account or model use.", "Historical reports are hash-bound documents, not re-executed native receipts.", "Integrity pin cannot protect against an editor changing both code and evidence.", "No recorded-native-frame provenance, current browser, usage-state or full T1 acceptance."],
}, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Receipts: ${logs}\n`);
assert.equal(results.filter(result => result.outcome === "unexpected").length, 0, "Unresolved mutation controls remain");
