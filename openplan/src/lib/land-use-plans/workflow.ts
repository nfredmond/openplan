import type { JurisdictionPlanDescriptor } from "./contracts";

export type LandUsePlanWorkflowInput = {
  descriptor: JurisdictionPlanDescriptor;
  applicableRequirementKeys: readonly string[];
  completedRequirementKeys: readonly string[];
  hasDesignation: boolean;
  hasImplementationAction: boolean;
  reviewEventKinds: readonly string[];
  versionState: string;
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
  const reviews = new Set(input.reviewEventKinds);

  return [
    { key: "setup", label: "Plan setup and geography", complete: true },
    {
      key: "content",
      label: `Applicable ${input.descriptor.terminology.section}s`,
      complete: applicable.every((key) => completedRequirements.has(key)),
    },
    { key: "designations", label: "Mapped designations", complete: input.hasDesignation, humanOnly: true },
    { key: "implementation", label: "Implementation program", complete: input.hasImplementationAction },
    { key: "consistency", label: "Internal-consistency review", complete: reviews.has("internal_consistency") },
    { key: "environmental_review", label: "Environmental-review record", complete: reviews.has("environmental_review") },
    { key: "public_draft", label: "Frozen public draft", complete: ["public_review", "adopted", "superseded"].includes(input.versionState), humanOnly: true },
    { key: "hearing", label: "Hearings", complete: reviews.has("hearing") },
    { key: "recommendation", label: "Recommendation", complete: reviews.has("recommendation") },
    { key: "adoption", label: "Adoption decision", complete: input.hasAdoptionDecision, humanOnly: true },
    { key: "publication", label: "Published frozen packet", complete: input.hasPublishedReport, humanOnly: true },
    { key: "annual_report", label: input.descriptor.terminology.implementationReport, complete: input.hasImplementationReport },
  ];
}

export function percentComplete(steps: readonly LandUsePlanWorkflowStep[]): number {
  if (steps.length === 0) return 0;
  return Math.round((steps.filter((step) => step.complete).length / steps.length) * 100);
}

