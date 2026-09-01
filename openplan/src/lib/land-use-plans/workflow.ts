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

export type PublicDraftReadinessInput = {
  applicableRequirementKeys: readonly string[];
  completedRequirementKeys: readonly string[];
  hasDesignation: boolean;
  hasImplementationAction: boolean;
  requiredReviewPrerequisiteKeys: readonly string[];
  completedProcessKeys: readonly string[];
  requiresConsultation: boolean;
  consultationStatus: string | null;
};

export type AdoptionReadinessInput = {
  requiredPrerequisites: ReadonlyArray<{ key: string; label: string }>;
  processRecords: ReadonlyArray<{ processKey: string; status: string }>;
  hasClosedReviewRelease: boolean;
};

/** The exact adoption gate, shared by the workbench and write route. */
export function buildAdoptionBlockers(input: AdoptionReadinessInput): string[] {
  const processByKey = new Map(input.processRecords.map((record) => [record.processKey, record.status]));
  const missingLabels = input.requiredPrerequisites
    .filter((step) => processByKey.get(step.key) !== "complete")
    .map((step) => step.label);
  return [
    ...(missingLabels.length ? [`Complete adoption prerequisites: ${missingLabels.join(", ")}`] : []),
    ...(!input.hasClosedReviewRelease ? ["Close and freeze the exact latest public-review release"] : []),
  ];
}

/**
 * The exact reasons a working version cannot become a public-review snapshot.
 * Both the workbench and the freeze API use this function so a planner sees the
 * same gate the server will enforce before they press the irreversible control.
 */
export function buildPublicDraftBlockers(input: PublicDraftReadinessInput): string[] {
  const completedRequirements = new Set(input.completedRequirementKeys);
  const completedProcesses = new Set(input.completedProcessKeys);
  const missingRequirements = input.applicableRequirementKeys.filter(
    (key) => !completedRequirements.has(key),
  );
  const missingReviewSteps = input.requiredReviewPrerequisiteKeys.filter(
    (key) => !completedProcesses.has(key),
  );

  return [
    ...(missingRequirements.length
      ? [`Complete applicable sections: ${missingRequirements.join(", ")}`]
      : []),
    ...(!input.hasDesignation ? ["Attach a versioned mapped-designation layer"] : []),
    ...(!input.hasImplementationAction ? ["Add at least one implementation action"] : []),
    ...(missingReviewSteps.length
      ? [`Complete review prerequisites: ${missingReviewSteps.join(", ")}`]
      : []),
    ...(input.requiresConsultation
      && !["complete", "not_applicable"].includes(input.consultationStatus ?? "")
      ? ["Complete or mark the private tribal-consultation record not applicable"]
      : []),
  ];
}

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
