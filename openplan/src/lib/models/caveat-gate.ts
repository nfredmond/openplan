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

export function isScreeningGradeStage(stage: CountyRunStage | string | null | undefined): boolean {
  if (!stage) return true;
  return SCREENING_GRADE_STAGES.has(stage as CountyRunStage);
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

export function describeScreeningGradeRefusal(count: number): string {
  if (count <= 0) return "";
  return `${count} screening-grade source${count === 1 ? "" : "s"} held back (pass acceptScreeningGrade:true to include).`;
}
