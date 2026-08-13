import type { CountyRunStage } from "@/lib/models/county-onramp";

export type CaveatGateConsent = {
  acceptScreeningGrade?: boolean;
};

export type CaveatGateReason = "screening_grade_refused";

export type CaveatGateDecision<T> = {
  accepted: T[];
  rejected: T[];
  reason: CaveatGateReason | null;
};

export const SCREENING_GRADE_STAGES = new Set<CountyRunStage>([
  "bootstrap-incomplete",
  "runtime-complete",
  "validation-scaffolded",
  "validated-screening",
]);

export const NON_SCREENING_GRADE_STAGES = new Set<string>([]);

export function isScreeningGradeStage(stage: CountyRunStage | string | null | undefined): boolean {
  const normalizedStage = typeof stage === "string" ? stage.trim() : "";
  if (!normalizedStage) return true;
  if (SCREENING_GRADE_STAGES.has(normalizedStage as CountyRunStage)) return true;
  if (NON_SCREENING_GRADE_STAGES.has(normalizedStage)) return false;
  return true;
}

export function partitionScreeningGradeRows<T>({
  rows,
  consent,
  resolveStage,
}: {
  rows: T[];
  consent: CaveatGateConsent | undefined;
  resolveStage: (row: T) => CountyRunStage | string | null | undefined;
}): CaveatGateDecision<T> {
  if (consent?.acceptScreeningGrade) {
    return { accepted: rows, rejected: [], reason: null };
  }

  const accepted: T[] = [];
  const rejected: T[] = [];

  for (const row of rows) {
    if (isScreeningGradeStage(resolveStage(row))) {
      rejected.push(row);
    } else {
      accepted.push(row);
    }
  }

  return {
    accepted,
    rejected,
    reason: rejected.length > 0 ? "screening_grade_refused" : null,
  };
}

/**
 * The held-back count, said to the planner who is looking at the gap.
 *
 * This string RENDERS — it is the line under the county-run "Held back" banner.
 * It used to end "(pass acceptScreeningGrade:true to include)", which names a
 * function parameter no planner can pass and no screen exposes. The meaning is
 * unchanged: N sources are held back, and including them is the reader's choice
 * (the banner's own link is how that choice is made).
 */
export function describeScreeningGradeRefusal(count: number): string {
  if (count <= 0) return "";
  return `${count} screening-grade source${count === 1 ? "" : "s"} held back until you choose to include them.`;
}
