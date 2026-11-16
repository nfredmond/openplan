import { describe, expect, it } from "vitest";
import { usCaPrograms } from "@/lib/grants/programs/us-ca";

/**
 * CALIFORNIA PROGRAM TEXT STATES FACTS, NOT PRAISE.
 *
 * A tracked opportunity copies its program's summary, and the ATP packet
 * prints the cycle and match notes. The ATP entry called itself "California's
 * flagship competitive program" and a "Strong fit for small and rural
 * agencies", which no source says, and its leverage note and cost-effectiveness
 * guidance implied every applicant is scored on leverage and a benefit-cost
 * ratio. It now states what the CTC's 2027 ATP Guidelines (adopted March 19,
 * 2026) state: the three components and their shares (section 5), no match
 * (section 6), leveraging scored only for Large and Medium applications
 * (section 18), and the Commission's own benefit-cost tool (section 38.2).
 * California's federal-program summaries lost the six phrases lane 50 removed
 * from the federal catalog, and three state summaries lost the same class.
 *
 * Blind category: a promotional phrase not on the list below, and whether a
 * stated fact is still current after the 2027 cycle. Opportunities tracked
 * before this change keep the summary they copied.
 */

const PROMOTIONAL = [
  /\bvery\b/i,
  /\bflagship\b/i,
  /\bstrong fit\b/i,
  /\bworkhorse\b/i,
  /\bbackbone\b/i,
  /\bhighly competitive\b/i,
  /\bone of the few\b/i,
  /\bthe standard source\b/i,
  /\boverlaps heavily\b/i,
  /\bdirectly relevant\b/i,
  /\bpairs naturally\b/i,
  /\brealistic path\b/i,
  /\bdependable\b/i,
  /\bskew large\b/i,
  /\bpractical entry point\b/i,
  /\bworth tracking\b/i,
  /\bessential step\b/i,
  /\bgateway\b/i,
  /\bideal\b/i,
  /\bperfect for\b/i,
  /\brobust\b/i,
];

const summaries: Array<[string, string]> = [
  ...usCaPrograms.programs.map((program): [string, string] => [program.key, program.summary]),
  ...(usCaPrograms.federalProgramAdministration ?? []).flatMap((entry): Array<[string, string]> =>
    entry.summary ? [[`federal:${entry.programKey}`, entry.summary]] : [],
  ),
];

const atp = usCaPrograms.programs.find((program) => program.key === "atp")!;

describe("California program text", () => {
  it("reads every state and federal-administration summary", () => {
    expect(summaries.length).toBeGreaterThanOrEqual(12);
  });

  it("carries no promotional phrase", () => {
    const found = summaries.flatMap(([key, summary]) =>
      PROMOTIONAL.filter((pattern) => pattern.test(summary)).map((pattern) => `${key}: ${pattern}`),
    );
    expect(found).toEqual([]);
  });

  it("states the ATP components, shares and disadvantaged-community floor from the 2027 guidelines", () => {
    expect(atp.summary).toContain("2027 ATP Guidelines (Cycle 8, adopted March 19, 2026)");
    expect(atp.summary).toContain(
      "50 percent to the Statewide Component, 10 percent to the Small Urban and Rural Component (areas of 5,001 to 200,000 people, and rural areas of 5,000 or less) and 40 percent to the MPO Component",
    );
    expect(atp.summary).toContain("at least 25 percent to projects that benefit disadvantaged communities");
    expect(atp.typicalApplicants).toContain("federally recognized tribal governments");
    expect(atp.eligibleProjectTypes).toContain("Non-infrastructure education and encouragement programs");
    // Review 68: the guidelines say "no later than the date designated in statute of each odd-numbered year", and give the 2027 dates.
    expect(atp.cycleNote).toContain("no later than a statutory date in each odd-numbered year");
    expect(atp.cycleNote).not.toContain("adopts an ATP program each odd-numbered year");
  });

  it("says leverage scores only in Large and Medium applications and asks for no benefit-cost ratio", () => {
    expect(atp.matchRequirement).toContain("No local match required");
    expect(atp.matchRequirement).toContain("only in Large and Medium project applications");
    const cost = atp.applicationSections!.find((section) => section.key === "cost-effectiveness-leverage")!;
    // Review 68: the Small and Medium rubrics still ask whether cost-effectiveness was considered (Question 5 note).
    expect(cost.guidance).not.toContain("Small applications score neither");
    expect(cost.guidance).toContain("The Small and Medium scoring rubrics still ask evaluators whether the application shows that cost-effectiveness was considered.");
    expect(cost.guidance).toContain("the application asks for no benefit-cost ratio");
    expect(cost.guidance).not.toMatch(/relate expected benefit to cost/i);
  });

  it("keeps the ATP section keys saved applications are identified by", () => {
    expect(atp.applicationSections!.map((section) => section.key)).toEqual([
      "project-narrative",
      "need-and-safety",
      "disadvantaged-communities",
      "community-engagement",
      "cost-effectiveness-leverage",
      "implementation-schedule",
      "budget-narrative",
    ]);
  });
});
