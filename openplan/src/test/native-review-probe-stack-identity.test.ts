// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const require = createRequire(import.meta.url);
const suites = ["artifact-storage-writes-rls.test.ts", "measure-period-parent-migration.test.ts"];

/** Execute each real native probe with its real shared guard. Only container
 * discovery, Docker transport and native test registration are intercepted.
 * This prevents any database access even if the guard is accidentally removed.
 */
function loadProbe(filename: string, container: string) {
  const docker = vi.fn(() => "synthetic transport acknowledgement");
  const source = readFileSync(resolve("src/test", filename), "utf8");
  const compiled = ts.transpileModule(`${source}\nmodule.exports.identityProbe = probe;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} as { identityProbe: () => unknown } };
  runInNewContext(compiled, {
    module: loaded,
    exports: loaded.exports,
    process,
    require(id: string) {
      if (id === "node:child_process") return { execFileSync: docker };
      if (id === "./helpers/live-catalog") return { resolveLocalDbContainer: () => container };
      if (id === "./helpers/contract-verification-stack") return { requireContractVerificationStack };
      if (id === "./local-supabase-env") return { LIVE_RLS: false };
      if (id === "vitest") return { describe: { skipIf: () => () => {} } };
      return require(id);
    },
  });
  return { probe: loaded.exports.identityProbe, docker };
}

afterEach(() => vi.unstubAllEnvs());

describe.each(suites)("native probe stack identity: %s", filename => {
  it.each([
    ["supabase_db_openplan-restore-target-1", "false"],
    ["supabase_db_openplan-restore-target-123456", "true"],
    ["supabase_db_independent-fixes-20261001", "false"],
    ["supabase_db_openplan", "true"],
  ])("dispatches the real probe only to approved %s with CI=%s", (container, ci) => {
    vi.stubEnv("GITHUB_ACTIONS", ci);
    const { probe, docker } = loadProbe(filename, container);
    expect(probe()).toBe("synthetic transport acknowledgement");
    expect(docker).toHaveBeenCalledTimes(1);
    const [command, args, options] = docker.mock.calls[0] as unknown as [string, string[], { input: string }];
    expect(command).toBe("docker");
    expect(args.slice(0, 4)).toEqual(["exec", "-i", container, "psql"]);
    expect(options.input).toContain("BEGIN;");
    expect(options.input).toContain("ROLLBACK;");
  });

  it.each([
    ["supabase_db_openplan-demo", "false"],
    ["supabase_db_unknown", "true"],
    ["supabase_db_openplan", "false"],
    ["supabase_db_openplan-restore-target-0", "true"],
    ["supabase_db_openplan-restore-target-1-demo", "true"],
  ])("refuses %s with CI=%s before Docker dispatch", (container, ci) => {
    vi.stubEnv("GITHUB_ACTIONS", ci);
    const { probe, docker } = loadProbe(filename, container);
    expect(probe).toThrow("Select an explicitly named disposable contract verification stack");
    expect(docker).not.toHaveBeenCalled();
  });
});
