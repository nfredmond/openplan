import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
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
  it("fails closed unless the current review and matrix preserve the v1 scope", () => {
    expect(run("--check")).toMatch(
      /Product direction is current through \d{4}-\d{2}-\d{2}/,
    );
  });

  it("builds a fresh-context packet from the live repository state", () => {
    const packet = run("--packet");
    const pageCount = countFiles(resolve(APP_ROOT, "src/app"), "/page.tsx");
    const routeCount = countFiles(resolve(APP_ROOT, "src/app/api"), "/route.ts");

    expect(packet).toContain("Fresh-context OpenPlan product-direction review packet");
    expect(packet).toContain(`Planner pages: ${pageCount}`);
    expect(packet).toContain(`API routes: ${routeCount}`);
    expect(packet).toContain("ultimate free planning operating system");
    expect(packet).toContain("## Binding v1 contract");
    expect(packet).toContain("## Current roadmap");
    expect(packet).toContain("## Current capability matrix");
  });
});
