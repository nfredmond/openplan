import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// docs/ops/KNOWN_ISSUES.md is edited by many parallel branches, and integration
// merges have twice kept both an old and a new copy of the same row (November 2:
// KI-2026-11-02-043 to -046 from two lanes, and KI-2026-08-31-013 to -015). A
// reader then cannot tell which disposition is current. One row per id.

const KNOWN_ISSUES = path.join(process.cwd(), "..", "docs", "ops", "KNOWN_ISSUES.md");
const ROW_ID = /^\| ((?:KI|KL)-\d{4}-\d{2}-\d{2}-\d{3}) \|/;

function duplicateRowIds(markdown: string): string[] {
  const seen = new Map<string, number>();
  for (const line of markdown.split("\n")) {
    const match = ROW_ID.exec(line);
    if (match) seen.set(match[1], (seen.get(match[1]) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([id]) => id);
}

describe("known-issue rows", () => {
  const markdown = readFileSync(KNOWN_ISSUES, "utf8");

  it("reads the table rows it is meant to check", () => {
    const rows = markdown.split("\n").filter((line) => ROW_ID.test(line));
    expect(rows.length).toBeGreaterThan(200);
  });

  it("has one row per id", () => {
    expect(duplicateRowIds(markdown)).toEqual([]);
  });

  it("names an id that appears twice", () => {
    const row = "| KI-2026-01-01-001 | Low | x | y | z |";
    expect(duplicateRowIds(`${row}\n| KI-2026-01-01-002 | Low | x | y | z |\n${row}`)).toEqual(["KI-2026-01-01-001"]);
  });
});
