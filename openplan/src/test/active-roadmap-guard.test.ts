import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(process.cwd(), "..");
const DOCS_ROOT = resolve(REPO_ROOT, "docs");
const MARKER = "openplan-active-roadmap";

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

function field(block: string, name: string): string {
  const match = block.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
  if (!match) throw new Error(`Active roadmap is missing ${name}`);
  return match[1].trim();
}

function list(block: string, name: string): string[] {
  const match = block.match(new RegExp(`^${name}:\\s*\\n((?:- .+\\n?)+)`, "m"));
  if (!match) throw new Error(`Active roadmap is missing ${name}`);
  return match[1]
    .trim()
    .split("\n")
    .map((line) => line.replace(/^- /, "").trim());
}

describe("the canonical development roadmap", () => {
  it("has exactly one active marker and its mechanical references are current", () => {
    const active = markdownFiles(DOCS_ROOT).filter((path) =>
      readFileSync(path, "utf8").includes(MARKER),
    );
    expect(active.map((path) => path.replace(`${REPO_ROOT}/`, ""))).toEqual([
      "docs/ROADMAP.md",
    ]);

    const markdown = readFileSync(active[0], "utf8");
    const block = markdown.match(/<!-- openplan-active-roadmap\n([\s\S]*?)-->/)?.[1];
    expect(block, "roadmap marker must be a closed metadata block").toBeTruthy();

    const reviewedCommit = field(block!, "reviewed_commit");
    expect(reviewedCommit).toMatch(/^[0-9a-f]{8,40}$/);
    expect(() =>
      execFileSync("git", ["cat-file", "-e", `${reviewedCommit}^{commit}`], {
        cwd: REPO_ROOT,
        stdio: "ignore",
      }),
    ).not.toThrow();

    const reviewBy = field(block!, "review_by");
    expect(reviewBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const today = new Date().toISOString().slice(0, 10);
    expect(reviewBy >= today, `roadmap review expired on ${reviewBy}`).toBe(true);

    for (const path of list(block!, "paths")) {
      expect(existsSync(resolve(REPO_ROOT, path)), `missing roadmap path: ${path}`).toBe(true);
    }

    const packageJson = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "openplan/package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    for (const command of list(block!, "npm_commands")) {
      expect(packageJson.scripts?.[command], `missing npm command: ${command}`).toBeTruthy();
    }

    expect(field(block!, "current_release")).toMatch(/^v\d+\.\d+\.\d+$/);
  });
});
