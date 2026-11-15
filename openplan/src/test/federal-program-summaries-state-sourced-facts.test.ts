import { describe, expect, it } from "vitest";
import { usFederalPrograms } from "@/lib/grants/programs/us-federal";

/**
 * A PROGRAM SUMMARY STATES FACTS, NOT PRAISE.
 *
 * A tracked opportunity copies its program's summary, and the SS4A packet
 * prints it on the cover. The SS4A summary said its planning grants were "very
 * accessible to small and rural agencies", which no source says. It now states
 * what USDOT's FY 2026 SS4A NOFO (DOT-SS4A-FY26-01, issued March 27, 2026)
 * states: who may apply, the two grant types and the match. The other federal
 * summaries lost the same class of phrase and kept their facts.
 *
 * Blind category: a promotional phrase not on the list below, and whether a
 * stated fact is still current. Opportunities tracked before this change keep
 * the summary they copied.
 */

const PROMOTIONAL = [
  /\bvery\b/i,
  /\bworkhorse\b/i,
  /\bbackbone\b/i,
  /\bhighly competitive\b/i,
  /\btransformative\b/i,
  /\bone of the few\b/i,
  /\bthe standard source\b/i,
  /\boverlaps heavily\b/i,
  /\bdirectly relevant\b/i,
  /\bpairs naturally\b/i,
  /\brealistic path\b/i,
  /\bgateway\b/i,
  /\bideal\b/i,
  /\bperfect for\b/i,
  /\brobust\b/i,
];

const ss4a = usFederalPrograms.programs.find((program) => program.key === "ss4a")!;

describe("federal program summaries", () => {
  it("carry no promotional phrase", () => {
    const found = usFederalPrograms.programs.flatMap((program) =>
      PROMOTIONAL.filter((pattern) => pattern.test(program.summary)).map((pattern) => `${program.key}: ${pattern}`),
    );
    expect(found).toEqual([]);
  });

  it("state the SS4A applicants, grant types and match from the FY 2026 NOFO", () => {
    expect(ss4a.summary).toContain("Planning and Demonstration Grants");
    expect(ss4a.summary).toContain("Implementation Grants");
    expect(ss4a.summary).toContain(
      "metropolitan planning organizations, political subdivisions of a state or territory (such as cities, towns and counties), federally recognized Tribal governments and multijurisdictional groups of these may apply; states and territories may not",
    );
    expect(ss4a.summary).toContain("The federal share may not exceed 80 percent, so the local match is at least 20 percent");
    expect(ss4a.summary).toContain("Tribal Transportation Program funds as match");
  });
});
