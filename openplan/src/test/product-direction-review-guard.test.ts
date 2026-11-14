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

// Match the file NAME, not a path suffix: a "/page.tsx" suffix never matches
// the backslash paths resolve() returns on Windows, and an expected count of
// zero then agrees with a packet that also counted zero.
function countFiles(root: string, name: string): number {
  return readdirSync(root, { withFileTypes: true }).reduce((count, entry) => {
    if (entry.isDirectory()) return count + countFiles(resolve(root, entry.name), name);
    return count + Number(entry.isFile() && entry.name === name);
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
    expect(registry.schemaVersion).toBe(3);
    // One job is proven (November 14, 2026): the safety action plan and SS4A
    // application in three places, run by an agent on the hosted site. The
    // direction check above read its record and its six PDFs and accepted them.
    expect(registry.provenJobs).toHaveLength(1);
    expect(registry.provenJobs[0]).toMatchObject({
      jobId: "safety-action-plan-and-ss4a-in-three-places",
      commit: "ccf88a9219fa58b67842a8f1dd41dbe3b371f8e5",
      places: [
        { kind: "county", geoid: "06091", stateFips: ["06"] },
        { kind: "county", geoid: "32017", stateFips: ["32"] },
        { kind: "aiannh", geoid: "3010R", stateFips: ["32"] },
      ],
    });
    // The record, six PDFs, the record's README and the four inputs files.
    expect(registry.provenJobs[0].evidence).toHaveLength(12);
    expect(registry.readinessRegistry).toMatchObject({
      schema: "openplan.jurisdiction-readiness.v1",
      path: "openplan/src/lib/jurisdiction-readiness/registry.v1.json",
    });
    const frozenReadiness = JSON.parse(
      readFileSync(resolve(APP_ROOT, "src/lib/jurisdiction-readiness/registry.v1.json"), "utf8"),
    );
    expect(frozenReadiness.releaseVersion).toBe("0.72.0");
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
        const name = String(file).split(require('node:path').sep).join('/');
        if (name.includes('/docs/reviews/product-direction/') && name.endsWith('.md')) {
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

  // Version 3 is the first registry with a provenJobs list. A version 2
  // registry, or one without the list, is refused rather than read as having
  // no proven jobs.
  it.each([
    ["a version 2 registry", "registry.schemaVersion = 2;", /schemaVersion must be 3, found 2/],
    ["a registry without a provenJobs list", "delete registry.provenJobs;", /capability registry has no provenJobs list/],
  ])("refuses %s", (_name, edit, rejection) => {
    const directory = mkdtempSync(resolve(tmpdir(), "openplan-review-registry-version-"));
    const preload = resolve(directory, "registry.cjs");
    writeFileSync(preload, `const fs = require('node:fs'); const sep = require('node:path').sep; const read = fs.readFileSync;
      fs.readFileSync = function(file, ...args) {
        const value = read.call(this, file, ...args);
        if (String(file).split(sep).join('/').endsWith('/US_PLANNING_CAPABILITY_REGISTRY.json')) {
          const registry = JSON.parse(String(value)); ${edit}
          return JSON.stringify(registry);
        }
        return value;
      }; require('node:module').syncBuiltinESMExports();`);
    try {
      expect(() => execFileSync(process.execPath, ["--require", preload, SCRIPT, "--check"], {
        cwd: APP_ROOT, encoding: "utf8", stdio: "pipe",
      })).toThrow(rejection);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  // Each case edits the readiness registry in memory and re-pins its hash in
  // the capability registry, so only the rule under test can reject it.
  it.each([
    ["an unchanged registry", "", null],
    ["a dropped territory", "drop:US-VI", /has no entry for US-VI/],
    ["a dropped state", "drop:US-WY", /has no entry for US-WY/],
    ["an invented code", "invent:US-XX", /US-XX is not a known state, DC or territory/],
    ["an unassessed cell with an adapter", "unassessed:US-NV/land-use-plan", /US-NV\/land-use-plan is unassessed but names adapters/],
    ["an unassessed cell with an authority", "unassessed-authority:US-NV/safety-analysis", /US-NV\/safety-analysis is unassessed but names adapters or authorities/],
  ])("checks the readiness entries for %s", (_name, mutation, rejection) => {
    const directory = mkdtempSync(resolve(tmpdir(), "openplan-review-readiness-"));
    const preload = resolve(directory, "readiness.cjs");
    writeFileSync(preload, `const fs = require('node:fs'); const crypto = require('node:crypto');
      const sep = require('node:path').sep; const read = fs.readFileSync; let text = null;
      function mutated(file) {
        if (text !== null) return text;
        const registry = JSON.parse(read.call(fs, file, 'utf8'));
        const [kind, target] = ${JSON.stringify(mutation)}.split(':');
        if (kind === 'drop') {
          registry.jurisdictions = registry.jurisdictions.filter((j) => j.id !== target);
          registry.claims = registry.claims.filter((c) => c.jurisdictionId !== target);
        } else if (kind === 'invent') {
          registry.jurisdictions.push({ id: target, label: target, country: 'US', subdivision: target.slice(3), assessmentKind: 'code-inventory' });
        } else if (kind === 'unassessed') {
          registry.claims.find((c) => c.id === target).status = 'unassessed';
        } else if (kind === 'unassessed-authority') {
          Object.assign(registry.claims.find((c) => c.id === target), { status: 'unassessed', adapterIds: [] });
        }
        text = JSON.stringify(registry);
        return text;
      }
      fs.readFileSync = function(file, ...args) {
        const name = String(file).split(sep).join('/');
        if (name.endsWith('/jurisdiction-readiness/registry.v1.json')) return mutated(file);
        const value = read.call(this, file, ...args);
        if (name.endsWith('/US_PLANNING_CAPABILITY_REGISTRY.json')) {
          const pinned = JSON.parse(String(value));
          const path = require('node:path').resolve(require('node:path').dirname(file), '..', '..', pinned.readinessRegistry.path);
          pinned.readinessRegistry.sha256 = crypto.createHash('sha256').update(JSON.stringify(JSON.parse(mutated(path)))).digest('hex');
          return JSON.stringify(pinned);
        }
        return value;
      }; require('node:module').syncBuiltinESMExports();`);
    const check = () => execFileSync(process.execPath, ["--require", preload, SCRIPT, "--check"], {
      cwd: APP_ROOT, encoding: "utf8", stdio: "pipe",
    });
    try {
      if (rejection === null) expect(check()).toContain("Product direction records checked");
      else expect(check).toThrow(rejection);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it("builds a fresh-context packet from the live repository state", () => {
    const packet = run("--packet");
    const pageCount = countFiles(resolve(APP_ROOT, "src/app"), "page.tsx");
    const routeCount = countFiles(resolve(APP_ROOT, "src/app/api"), "route.ts");
    expect(pageCount).toBeGreaterThan(0);
    expect(routeCount).toBeGreaterThan(0);

    expect(packet).toContain("Fresh-context OpenPlan product-direction review packet");
    expect(packet).toContain(`Planner pages: ${pageCount}`);
    expect(packet).toContain(`API routes: ${routeCount}`);
    expect(packet).toContain("ultimate free planning operating system");
    expect(packet).toContain("Direction gate at generation:");
    expect(packet).toContain("## Binding v1 contract");
    expect(packet).toContain("## Current roadmap");
    // The roadmap is a status page; definitions moved to MILESTONES.md and a
    // fresh reviewer still needs them in the packet.
    expect(packet).toContain("## Milestone definitions");
    expect(packet).toContain("## M0. Trustworthy candidate, review and documentation");
    expect(packet).toContain("## Current capability matrix");
  });
});
