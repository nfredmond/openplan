import type { JurisdictionPlanDescriptor } from "./contracts";

export type LandUsePlanWorkflowInput = {
  descriptor: JurisdictionPlanDescriptor;
  applicableRequirementKeys: readonly string[];
  completedRequirementKeys: readonly string[];
  hasDesignation: boolean;
  hasImplementationAction: boolean;
  hasStoredGeography: boolean;
  processRecords: ReadonlyArray<{ processKey: string; status: string }>;
  hasReviewRelease: boolean;
  hasClosedReviewRelease: boolean;
  hasAdoptionDecision: boolean;
  hasPublishedReport: boolean;
  hasImplementationReport: boolean;
};

export type LandUsePlanWorkflowStep = {
  key: string;
  label: string;
  complete: boolean;
  humanOnly?: boolean;
};

export function buildLandUsePlanWorkflow(input: LandUsePlanWorkflowInput): LandUsePlanWorkflowStep[] {
  const completedRequirements = new Set(input.completedRequirementKeys);
  const applicable = input.applicableRequirementKeys.length
    ? input.applicableRequirementKeys
    : input.descriptor.requirements
        .filter((requirement) => requirement.applicability === "required")
        .map((requirement) => requirement.key);
  const contentComplete = applicable.every((key) => completedRequirements.has(key));
  const processByKey = new Map(input.processRecords.map((record) => [record.processKey, record.status]));
  const resolved = (key: string) => processByKey.get(key) === "complete";
  const derived: Record<string, boolean> = {
    setup: input.hasStoredGeography,
    content: contentComplete,
    public_draft: input.hasReviewRelease,
    adoption: input.hasAdoptionDecision,
    implementation_report: input.hasImplementationReport,
  };
  const descriptorSteps = input.descriptor.processSteps
    .filter((step) => step.required)
    .map((step) => ({
      key: step.key,
      label: step.label,
      complete: derived[step.key] ?? resolved(step.key),
      humanOnly: ["public_draft", "adoption"].includes(step.key),
    }));

  return [
    ...descriptorSteps,
    { key: "applicable_content", label: `Applicable ${input.descriptor.terminology.section}s`, complete: contentComplete },
    { key: "designations", label: "Mapped designations", complete: input.hasDesignation, humanOnly: true },
    { key: "implementation", label: "Implementation program", complete: input.hasImplementationAction },
    { key: "review_publication", label: "Public review release", complete: input.hasReviewRelease, humanOnly: true },
    { key: "comment_disposition", label: "Frozen comment disposition", complete: input.hasClosedReviewRelease, humanOnly: true },
    { key: "publication", label: "Published frozen packet", complete: input.hasPublishedReport, humanOnly: true },
    { key: "reporting", label: input.descriptor.terminology.implementationReport, complete: input.hasImplementationReport },
  ].filter((step, index, steps) => steps.findIndex((candidate) => candidate.key === step.key) === index);
}

export function percentComplete(steps: readonly LandUsePlanWorkflowStep[]): number {
  if (steps.length === 0) return 0;
  return Math.round((steps.filter((step) => step.complete).length / steps.length) * 100);
}
