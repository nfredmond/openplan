import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// This reviewed snapshot preserves existing acceptance. Labels or cloned proof
// references cannot admit another version. Updating the pin requires review of
// the replacement evidence, not a discovery probe or a provider fallback.
const REVIEWED_MANIFEST_SHA256 = "0a32b6136c2bdef170223f43e6806aa2bc002a6d33b641cf37612ddee2931d3b";
const PROVIDERS = ["codex", "claude", "opencode"];

function requireKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) {
    throw new Error("native_cli_registry_invalid");
  }
}

function requireReference(value, prefix) {
  requireKeys(value, ["path", "sha256"]);
  if (typeof value.path !== "string" || !value.path.startsWith(prefix) ||
    value.path.includes("..") || !/^[a-zA-Z0-9_./-]+$/.test(value.path) ||
    typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error("native_cli_registry_invalid");
  }
}

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Evidence dates are deliberately unknown where this review has no exact native
// receipt. Historical reports and scripted sources remain separate claim tiers.
export function parseTestedCliRegistry(source) {
  if (typeof source !== "string" || Buffer.byteLength(source) > 32_768) throw new Error("native_cli_registry_invalid");
  let registry;
  try { registry = JSON.parse(source); } catch { throw new Error("native_cli_registry_invalid"); }
  requireKeys(registry, ["schemaVersion", "recordedOn", "entries"]);
  if (registry.schemaVersion !== 1 || registry.recordedOn !== "2026-10-16" ||
    !Array.isArray(registry.entries) || registry.entries.length !== PROVIDERS.length) throw new Error("native_cli_registry_invalid");
  const seen = new Set();
  for (const entry of registry.entries) {
    requireKeys(entry, ["provider", "version", "versionOutput", "platform", "task", "acceptance", "fixtureReplay", "installedCliAcceptance", "liveProviderAcceptance", "limits"]);
    if (!PROVIDERS.includes(entry.provider)) throw new Error("native_cli_registry_provider_invalid");
    if (seen.has(entry.provider)) throw new Error("native_cli_registry_duplicate_provider");
    seen.add(entry.provider);
    if (typeof entry.version !== "string" || !/^\d+\.\d+\.\d+$/.test(entry.version) ||
      entry.versionOutput !== (entry.provider === "codex" ? `codex-cli ${entry.version}` :
        entry.provider === "claude" ? `${entry.version} (Claude Code)` : entry.version) ||
      entry.platform !== "linux" || entry.task !== "retained-project-task") throw new Error("native_cli_registry_invalid");
    if (entry.acceptance !== "preserved-exact-version") throw new Error("native_cli_registry_unproven");
    requireKeys(entry.fixtureReplay, ["status", "recordedNativeFrames", "source"]);
    if (entry.fixtureReplay.status !== "scripted-source" || entry.fixtureReplay.recordedNativeFrames !== "unknown") throw new Error("native_cli_registry_unproven");
    requireReference(entry.fixtureReplay.source, "workers/planner_agent_connector/test/");
    requireKeys(entry.installedCliAcceptance, ["status", "observedAt", "report", "scope"]);
    if (entry.installedCliAcceptance.status !== "historical-report" || entry.installedCliAcceptance.observedAt !== null ||
      entry.installedCliAcceptance.scope !== "installed-cli-with-scripted-local-responses") throw new Error("native_cli_registry_unproven");
    requireReference(entry.installedCliAcceptance.report, "docs/reviews/");
    requireKeys(entry.liveProviderAcceptance, ["status", "observedAt", "report"]);
    if (!["historical-report", "unknown"].includes(entry.liveProviderAcceptance.status) || entry.liveProviderAcceptance.observedAt !== null) throw new Error("native_cli_registry_unproven");
    if (entry.liveProviderAcceptance.status === "historical-report") requireReference(entry.liveProviderAcceptance.report, "docs/reviews/");
    else if (entry.liveProviderAcceptance.report !== null) throw new Error("native_cli_registry_unproven");
    if (!Array.isArray(entry.limits) || entry.limits.length < 1 || entry.limits.length > 8 ||
      entry.limits.some(limit => typeof limit !== "string" || !limit.length || limit.length > 300)) throw new Error("native_cli_registry_invalid");
  }
  // Pin exact bytes as well as structure, including duplicate JSON properties.
  // A plausible version with copied proof does not establish compatibility.
  if (createHash("sha256").update(source).digest("hex") !== REVIEWED_MANIFEST_SHA256) throw new Error("native_cli_registry_unreviewed");
  return freeze(registry);
}

// Resolve the adjacent file through Node, not Vite's browser-asset URL transform.
// Read the original bytes so the same strict manifest pin applies in both hosts.
const registry = parseTestedCliRegistry(readFileSync(createRequire(import.meta.url).resolve("./tested-cli-versions.json"), "utf8"));

export function testedCliRecord(provider) {
  const entry = registry.entries.find(record => record.provider === provider);
  if (!entry) throw new Error("native_cli_registry_provider_invalid");
  return entry;
}

// Match the existing CLI output contract exactly, including provider spelling.
export function assertTestedCliVersion(provider, output) {
  if (typeof output !== "string" || output.trim() !== testedCliRecord(provider).versionOutput) throw new Error("native_version_unsupported");
}
