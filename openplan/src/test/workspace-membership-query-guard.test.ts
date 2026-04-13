import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const EXCLUDED_SEGMENTS = new Set(["test"]);

function collectSourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      return EXCLUDED_SEGMENTS.has(entry.name) ? [] : collectSourceFiles(fullPath);
    }

    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

function collectWorkspaceMembershipQueryOffenders() {
  const riskyPatterns = [
    /from\("workspace_members"\)[\s\S]{0,320}?limit\(1\)/g,
    /from\("workspace_members"\)[\s\S]{0,320}?maybeSingle\(\)/g,
    /from\("workspace_members"\)[\s\S]{0,320}?single\(\)/g,
  ];

  return collectSourceFiles(SOURCE_ROOT)
    .map((filePath) => ({
      filePath,
      content: fs.readFileSync(filePath, "utf8"),
    }))
    .filter(({ content }) =>
      riskyPatterns.some((pattern) => {
        const snippets = Array.from(content.matchAll(pattern)).map((match) => match[0]);
        return snippets.some(
          (snippet) => !snippet.includes('.eq("workspace_id"') && !snippet.includes("loadCurrentWorkspaceMembership")
        );
      })
    )
    .map(({ filePath }) => path.relative(process.cwd(), filePath));
}

describe("workspace membership query guard", () => {
  it("does not use arbitrary workspace-membership fallbacks in app source", () => {
    expect(collectWorkspaceMembershipQueryOffenders()).toEqual([]);
  });
});
