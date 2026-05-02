import { describe, expect, it } from "vitest";

import { SCREENING_GRADE_STAGES, isScreeningGradeStage } from "@/lib/models/caveat-gate";
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

  it("does not silently widen — a synthetic certified stage is not gated", () => {
    expect(isScreeningGradeStage("certified-modeling")).toBe(false);
  });

  it("fails closed when stage is null or undefined", () => {
    expect(isScreeningGradeStage(null)).toBe(true);
    expect(isScreeningGradeStage(undefined)).toBe(true);
    expect(isScreeningGradeStage("")).toBe(true);
  });
});
