import { describe, expect, it } from "vitest";

import {
  NON_SCREENING_GRADE_STAGES,
  describeScreeningGradeRefusal,
  isScreeningGradeStage,
  partitionScreeningGradeRows,
} from "@/lib/models/caveat-gate";

describe("isScreeningGradeStage", () => {
  it("treats every documented county run stage as screening-grade", () => {
    expect(isScreeningGradeStage("bootstrap-incomplete")).toBe(true);
    expect(isScreeningGradeStage("runtime-complete")).toBe(true);
    expect(isScreeningGradeStage("validation-scaffolded")).toBe(true);
    expect(isScreeningGradeStage("validated-screening")).toBe(true);
  });

  it("fails closed on null/undefined stage", () => {
    expect(isScreeningGradeStage(null)).toBe(true);
    expect(isScreeningGradeStage(undefined)).toBe(true);
  });

  it("fails closed on unknown or blank stage strings", () => {
    expect(isScreeningGradeStage("certified-modeling")).toBe(true);
    expect(isScreeningGradeStage("")).toBe(true);
    expect(isScreeningGradeStage("   ")).toBe(true);
  });
});

describe("partitionScreeningGradeRows", () => {
  const rows = [
    { id: "a", stage: "validated-screening" },
    { id: "b", stage: "certified-modeling" },
    { id: "c", stage: null },
  ];

  it("refuses screening-grade rows by default", () => {
    const decision = partitionScreeningGradeRows({
      rows,
      consent: undefined,
      resolveStage: (row) => row.stage,
    });

    expect(decision.accepted.map((r) => r.id)).toEqual([]);
    expect(decision.rejected.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(decision.reason).toBe("screening_grade_refused");
  });

  it("passes through every row when acceptScreeningGrade: true", () => {
    const decision = partitionScreeningGradeRows({
      rows,
      consent: { acceptScreeningGrade: true },
      resolveStage: (row) => row.stage,
    });

    expect(decision.accepted).toHaveLength(3);
    expect(decision.rejected).toHaveLength(0);
    expect(decision.reason).toBeNull();
  });

  it("reports no refusal reason when all rows are explicitly registered as non-screening", () => {
    NON_SCREENING_GRADE_STAGES.add("certified-modeling");
    try {
      const decision = partitionScreeningGradeRows({
        rows: [{ id: "b", stage: "certified-modeling" }],
        consent: undefined,
        resolveStage: (row) => row.stage,
      });

      expect(decision.accepted).toHaveLength(1);
      expect(decision.rejected).toHaveLength(0);
      expect(decision.reason).toBeNull();
    } finally {
      NON_SCREENING_GRADE_STAGES.delete("certified-modeling");
    }
  });
});

describe("describeScreeningGradeRefusal", () => {
  it("returns empty string for zero refusals", () => {
    expect(describeScreeningGradeRefusal(0)).toBe("");
  });

  it("pluralizes the refusal count", () => {
    expect(describeScreeningGradeRefusal(1)).toMatch(/1 screening-grade source held back/);
    expect(describeScreeningGradeRefusal(3)).toMatch(/3 screening-grade sources held back/);
  });
});
