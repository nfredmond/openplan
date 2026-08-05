/**
 * Every path that exports an RTP must export the SAME document.
 *
 * There are two, and they were built years apart: the direct export route
 * behind the "Export HTML/PDF" links a planner clicks (six call sites across
 * the cycle page, the document page and the report detail), and the
 * report-generate route that produces a board packet. Before this change the
 * first passed FOUR fields and no options at all while the second passed the
 * rich set — so anything wired to the packet route appeared in board packets
 * and nowhere else, and nobody would notice, because both produce a document
 * that looks complete.
 *
 * This is derived from the callers rather than from a list of two files, so a
 * third export path added later has to comply as well.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const APP_ROOT = process.cwd();

/** The option keys that carry the plan's money and its public record. */
const REQUIRED_OPTIONS = ["fiscalConstraint", "horizonBands", "commentResponse"] as const;

function callerFiles(): string[] {
  // ripgrep-free: git grep is available everywhere the suite runs, and this
  // enumerates callers rather than trusting a hand-written list.
  const out = execFileSync(
    "git",
    ["grep", "-l", "buildRtpExportHtml", "--", "src/app"],
    { cwd: APP_ROOT, encoding: "utf8" }
  );
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((path) => !path.includes("/test/"));
}

describe("both RTP export paths carry the financial element and the comment record", () => {
  it("finds more than one export path, or this guard is guarding nothing", () => {
    // If someone consolidates to a single path this assertion should be
    // revisited deliberately — but a silent drop to one caller would otherwise
    // make every assertion below vacuously true.
    expect(callerFiles().length).toBeGreaterThan(1);
  });

  it("passes the financial element and the comment record from EVERY caller", () => {
    for (const file of callerFiles()) {
      const source = readFileSync(join(APP_ROOT, file), "utf8");
      for (const option of REQUIRED_OPTIONS) {
        // Matches both `fiscalConstraint,` (shorthand) and `fiscalConstraint: x`.
        // The first version of this check required the colon and failed on a
        // route that passes it correctly by shorthand.
        const passed = new RegExp(`\\b${option}\\s*[,:]`).test(source);
        expect(
          passed,
          `${file} calls buildRtpExportHtml without passing \`${option}\`, so its document omits it while the other path includes it`
        ).toBe(true);
      }
    }
  });

  it("asks the database for the per-project cost columns in every caller", () => {
    // The lists render a programmed cost. A caller whose PROJECTION omits it
    // exports every project as "no cost recorded" — which reads as a plan that
    // priced nothing, not as a dropped column.
    //
    // Scans only `.select("…")` literals. A plain substring search over the
    // file passed while the projection was broken, because `link.estimated_cost`
    // elsewhere in the same file contains the same characters — found by
    // mutation, which is the only reason this reads the select strings.
    for (const file of callerFiles()) {
      const source = readFileSync(join(APP_ROOT, file), "utf8");
      const projections = [...source.matchAll(/\.select\(\s*"([^"]*)"/g)].map((match) => match[1]);
      expect(
        projections.some((projection) => projection.includes("estimated_cost")),
        `${file} exports project lists without selecting estimated_cost in any .select()`
      ).toBe(true);

      // Without these the fiscal check runs with no basis year and no rate, and
      // the document reports CONSTANT dollars while the plan actually records
      // an inflation assumption — a quieter error than a missing section.
      expect(
        projections.some((projection) => projection.includes("annual_inflation_rate")),
        `${file} exports a fiscal finding without selecting annual_inflation_rate`
      ).toBe(true);
    }
  });
});
