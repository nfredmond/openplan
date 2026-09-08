import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = process.cwd();
const SCRIPT = resolve(APP_ROOT, "scripts/ops/product-direction-review.mjs");

function run(...args: string[]): string {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    cwd: APP_ROOT,
    encoding: "utf8",
  });
}

function countFiles(root: string, suffix: string): number {
  return readdirSync(root, { withFileTypes: true }).reduce((count, entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return count + countFiles(path, suffix);
    return count + Number(entry.isFile() && path.endsWith(suffix));
  }, 0);
}

describe("the recurring product-direction review", () => {
  it("checks that the review and matrix preserve the v1 scope", () => {
    expect(run("--check")).toMatch(
      /Product direction records checked; review deadline \d{4}-\d{2}-\d{2}/,
    );
  });

  it("checks the machine-readable proof registry and frozen validation protocol", () => {
    const source = run("--check");
    const registry = JSON.parse(
      readFileSync(
        resolve(APP_ROOT, "../docs/product/US_PLANNING_CAPABILITY_REGISTRY.json"),
        "utf8",
      ),
    );
    expect(Object.keys(registry.dimensions)).toEqual(
      expect.arrayContaining(["planner", "organization", "state", "capability", "artifact", "accessibility", "operations"]),
    );
    expect(registry.dimensions.state).toHaveLength(56);
    expect(registry.schemaVersion).toBe(2);
    expect(registry.readinessRegistry).toMatchObject({
      schema: "openplan.jurisdiction-readiness.v1",
      path: "openplan/src/lib/jurisdiction-readiness/registry.v1.json",
    });
    const frozenReadiness = JSON.parse(
      readFileSync(resolve(APP_ROOT, "src/lib/jurisdiction-readiness/registry.v1.json"), "utf8"),
    );
    expect(frozenReadiness.releaseVersion).toBe("0.44.0");
    expect(registry.currentRelease).toBe(`v${JSON.parse(readFileSync(resolve(APP_ROOT, "package.json"), "utf8")).version}`);
    expect(source).toContain("Product direction records checked");
  });

  it("keeps overdue strategy reviews advisory without changing their recorded dates", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "openplan-review-clock-"));
    const clock = resolve(directory, "clock.cjs");
    writeFileSync(clock, `const RealDate = Date; global.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : ['2099-01-01T00:00:00Z'])); }
    };`);
    try {
      const output = execFileSync(process.execPath, ["--require", clock, SCRIPT, "--check"], {
        cwd: APP_ROOT, encoding: "utf8",
      });
      expect(output).toContain("Product direction records checked");
      expect(output).not.toContain("is current");
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it("still rejects a frozen-artifact hash mismatch", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "openplan-review-hash-"));
    const preload = resolve(directory, "hash.cjs");
    writeFileSync(preload, `const fs = require('node:fs'); const read = fs.readFileSync;
      fs.readFileSync = function(file, ...args) {
        if (String(file).endsWith('NATIONWIDE_VALIDATION_PREREGISTRATION_V1.sha256')) return '0'.repeat(64);
        return read.call(this, file, ...args);
      }; require('node:module').syncBuiltinESMExports();`);
    try {
      expect(() => execFileSync(process.execPath, ["--require", preload, SCRIPT, "--check"], {
        cwd: APP_ROOT, encoding: "utf8", stdio: "pipe",
      })).toThrow(/preregistration hash does not match/);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it.each([
    ["v0.43.0", true],
    ["v99.0.0", false],
  ])("handles a strategy review recorded for %s without rewriting it", (reviewedRelease, accepted) => {
    const directory = mkdtempSync(resolve(tmpdir(), "openplan-review-release-"));
    const preload = resolve(directory, "release.cjs");
    writeFileSync(preload, `const fs = require('node:fs'); const read = fs.readFileSync;
      fs.readFileSync = function(file, ...args) {
        const value = read.call(this, file, ...args);
        if (String(file).includes('/docs/reviews/product-direction/') && String(file).endsWith('.md')) {
          return String(value).replace(/current_release: v\\d+\\.\\d+\\.\\d+/, 'current_release: ${reviewedRelease}');
        }
        return value;
      }; require('node:module').syncBuiltinESMExports();`);
    const check = () => execFileSync(process.execPath, ["--require", preload, SCRIPT, "--check"], {
      cwd: APP_ROOT, encoding: "utf8", stdio: "pipe",
    });
    try {
      if (accepted) expect(check()).toContain("Product direction records checked");
      else expect(check).toThrow(/latest review claims future release/);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it("builds a fresh-context packet from the live repository state", () => {
    const packet = run("--packet");
    const pageCount = countFiles(resolve(APP_ROOT, "src/app"), "/page.tsx");
    const routeCount = countFiles(resolve(APP_ROOT, "src/app/api"), "/route.ts");

    expect(packet).toContain("Fresh-context OpenPlan product-direction review packet");
    expect(packet).toContain(`Planner pages: ${pageCount}`);
    expect(packet).toContain(`API routes: ${routeCount}`);
    expect(packet).toContain("ultimate free planning operating system");
    expect(packet).toContain("Direction gate at generation:");
    expect(packet).toContain("## Binding v1 contract");
    expect(packet).toContain("## Current roadmap");
    expect(packet).toContain("## Current capability matrix");
  });
});
