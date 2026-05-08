import { describe, expect, it } from "vitest";

import {
  NON_SCREENING_GRADE_STAGES,
  SCREENING_GRADE_STAGES,
  isScreeningGradeStage,
} from "@/lib/models/caveat-gate";
import { countyRunStageSchema } from "@/lib/models/county-onramp";

describe("modeling caveat gate — stage coverage", () => {
  it("treats every documented CountyRunStage as screening-grade", () => {
    const documentedStages = countyRunStageSchema.options;
    expect(documentedStages.length).toBeGreaterThan(0);

    for (const stage of documentedStages) {
      expect(SCREENING_GRADE_STAGES.has(stage)).toBe(true);
      expect(isScreeningGradeStage(stage)).toBe(true);
    }
  });

  it("fails closed for a synthetic certified stage until it is explicitly registered", () => {
    expect(isScreeningGradeStage("certified-modeling")).toBe(true);

    NON_SCREENING_GRADE_STAGES.add("certified-modeling");
    try {
      expect(isScreeningGradeStage("certified-modeling")).toBe(false);
    } finally {
      NON_SCREENING_GRADE_STAGES.delete("certified-modeling");
    }
  });

  it("fails closed when stage is null, undefined, empty, or whitespace-only", () => {
    expect(isScreeningGradeStage(null)).toBe(true);
    expect(isScreeningGradeStage(undefined)).toBe(true);
    expect(isScreeningGradeStage("")).toBe(true);
    expect(isScreeningGradeStage("  ")).toBe(true);
  });
});
