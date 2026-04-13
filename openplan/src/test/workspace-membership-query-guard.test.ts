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

describe("workspace membership query guard", () => {
  it("does not use arbitrary first-membership reads in app source", () => {
    const offenders = collectSourceFiles(SOURCE_ROOT)
      .map((filePath) => ({
        filePath,
        content: fs.readFileSync(filePath, "utf8"),
      }))
      .filter(({ content }) => {
        const snippets = Array.from(content.matchAll(/from\("workspace_members"\)[\s\S]{0,320}?limit\(1\)/g)).map((match) => match[0]);
        return snippets.some((snippet) => !snippet.includes('.eq("workspace_id"'));
      })
      .map(({ filePath }) => path.relative(process.cwd(), filePath));

    expect(offenders).toEqual([]);
  });
});
