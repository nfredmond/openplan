// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const buildCommand = (JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: { build: string };
}).scripts.build;

// Invoke the actual npm command with a small executable in place of Next.
// The child reports its real V8 limit. This does not measure webpack memory.
function runBuild(nodeOptions: string | undefined, exitCode = 0) {
  const directory = mkdtempSync(join(tmpdir(), "openplan-build-memory-"));
  try {
    mkdirSync(join(directory, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify({
      name: "openplan-build-command-probe",
      scripts: { build: buildCommand },
    }));
    writeFileSync(join(directory, "node_modules", ".bin", "next"), `#!/usr/bin/env node
const v8 = require("node:v8");
console.log(JSON.stringify({
  options: process.env.NODE_OPTIONS,
  arguments: process.argv.slice(2),
  heapLimitMiB: v8.getHeapStatistics().heap_size_limit / 1024 / 1024
}));
process.exit(${exitCode});
`, { mode: 0o700 });
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    if (nodeOptions !== undefined) env.NODE_OPTIONS = nodeOptions;
    const result = spawnSync("npm", ["run", "--silent", "build"], {
      cwd: directory,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    const output = JSON.parse(result.stdout.trim()) as {
      options: string;
      arguments: string[];
      heapLimitMiB: number;
    };
    return { status: result.status, output };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("the build command respects operator memory settings", () => {
  it.each([undefined, ""])("retains the default heap for absent options: %s", (options) => {
    const result = runBuild(options);
    expect(result.status).toBe(0);
    expect(result.output.options).toBe("--max-old-space-size=6144");
    expect(result.output.heapLimitMiB).toBeGreaterThanOrEqual(6144);
    expect(result.output.heapLimitMiB).toBeLessThan(6244);
  });

  it("passes the operator heap to the real child without appending a larger heap", () => {
    const result = runBuild("--max-old-space-size=512");
    expect(result.status).toBe(0);
    expect(result.output.options).toBe("--max-old-space-size=512");
    expect(result.output.heapLimitMiB).toBeGreaterThanOrEqual(512);
    expect(result.output.heapLimitMiB).toBeLessThan(612);
  });

  it("preserves the operator's complete options and the webpack invocation", () => {
    const result = runBuild("--trace-warnings --max-old-space-size=768");
    expect(result.status).toBe(0);
    expect(result.output.options).toBe("--trace-warnings --max-old-space-size=768");
    expect(result.output.heapLimitMiB).toBeGreaterThanOrEqual(768);
    expect(result.output.heapLimitMiB).toBeLessThan(868);
    expect(result.output.arguments).toEqual(["build", "--webpack"]);
  });

  it("returns a failed compiler's exit status", () => {
    expect(runBuild("--max-old-space-size=512", 7).status).toBe(7);
  });
});
