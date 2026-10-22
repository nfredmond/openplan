import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Use the application's jsdom/Vite environment and real, unmocked imports.
// Importing launchers must not execute them. No provider or dispatch runs here.
async function loadRealModules() {
  let importFailure: unknown;
  const loaded = await Promise.all([
    import("../../../workers/planner_agent_connector/tested-cli-versions.mjs"),
    import("../../../workers/planner_agent_connector/codex-launch.mjs"),
    import("../../../workers/planner_agent_connector/claude-launch.mjs"),
    import("../../../workers/planner_agent_connector/opencode-launch.mjs"),
  ]).catch((error: unknown) => { importFailure = error; return null; });
  expect(importFailure, "real registry and launcher imports must load through Vite").toBeUndefined();
  if (!loaded) throw new Error("Registry import assertion did not stop an absent result.");
  return loaded;
}

describe("strict registry through the application Vite loader", () => {
  it("loads every real launcher with the same exact frozen manifest", async () => {
    const [{ assertTestedCliVersion, parseTestedCliRegistry, testedCliRecord }, codex, claude, opencode] = await loadRealModules();
    const source = readFileSync(resolve(process.cwd(), "../workers/planner_agent_connector/tested-cli-versions.json"), "utf8");
    expect(createHash("sha256").update(source).digest("hex")).toBe("0a32b6136c2bdef170223f43e6806aa2bc002a6d33b641cf37612ddee2931d3b");
    const parsed = parseTestedCliRegistry(source);
    expect(parsed.recordedOn).toBe("2026-10-16");
    for (const [provider, version, output] of [
      ["codex", "0.154.0", "codex-cli 0.154.0"],
      ["claude", "2.1.263", "2.1.263 (Claude Code)"],
      ["opencode", "1.18.30", "1.18.30"],
    ]) {
      const record = testedCliRecord(provider);
      expect(record).toEqual(parsed.entries.find((entry: { provider: string }) => entry.provider === provider));
      expect(record.version).toBe(version);
      expect(record.versionOutput).toBe(output);
      expect(record.installedCliAcceptance.observedAt).toBeNull();
      expect(record.fixtureReplay.recordedNativeFrames).toBe("unknown");
      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record.fixtureReplay)).toBe(true);
      assertTestedCliVersion(provider, output);
      expect(() => assertTestedCliVersion(provider, `${output}-unreviewed`)).toThrow("native_version_unsupported");
    }
    expect([codex.CODEX_PROTOCOL_VERSION, claude.CLAUDE_PROTOCOL_VERSION, opencode.OPENCODE_PROTOCOL_VERSION]).toEqual(["0.154.0", "2.1.263", "1.18.30"]);
  });

  it("still rejects byte changes that preserve the parsed manifest", async () => {
    const [{ parseTestedCliRegistry }] = await loadRealModules();
    const source = readFileSync(resolve(process.cwd(), "../workers/planner_agent_connector/tested-cli-versions.json"), "utf8");
    expect(() => parseTestedCliRegistry(`${source}\n`)).toThrow("native_cli_registry_unreviewed");
  });
});
