import operatorControlsTemplate from "@/lib/stage-gates/templates/lapm_pm_invoicing_controls_v0.1.json";

export type OperatorWorkflowStatus =
  | "not_started"
  | "collecting_support"
  | "pm_review"
  | "principal_review"
  | "hold"
  | "approved";

export type LapmReadinessStatus =
  | "not_assessed"
  | "internal_control_ready"
  | "candidate"
  | "lapm_ready"
  | "deferred"
  | "not_applicable";

export type InvoiceLifecycleStatus =
  | "not_started"
  | "drafting"
  | "internal_review"
  | "approved_for_submission"
  | "submitted"
  | "partially_paid"
  | "paid"
  | "disputed"
  | "closeout_complete";

export type OperatorFieldDefinition = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  allowed_values?: string[];
  definition: string;
};

export type OperatorControlProfile = {
  profile_id: string;
  gate_id: string;
  evidence_id: string;
  title: string;
  goal: string;
  operator_fields: OperatorFieldDefinition[];
  acceptance_criteria: string[];
};

export type OperatorControlsTemplate = {
  control_pack_id: string;
  version: string;
  workflow_statuses: Array<{ key: OperatorWorkflowStatus; label: string; definition: string }>;
  lapm_readiness_statuses: Array<{ key: LapmReadinessStatus; label: string; definition: string }>;
  invoice_lifecycle_statuses: Array<{ key: InvoiceLifecycleStatus; label: string; definition: string }>;
  labeling_guardrails: {
    lapm_ready_requires: string[];
    must_use_deferred_or_internal_only_when: string[];
    never_label_lapm_ready_when: string[];
  };
  profiles: OperatorControlProfile[];
};

const controls = operatorControlsTemplate as OperatorControlsTemplate;

const profilesById = new Map(controls.profiles.map((profile) => [profile.profile_id, profile] as const));
const profilesByEvidenceId = new Map(controls.profiles.map((profile) => [profile.evidence_id, profile] as const));

export type LapmReadyCheckInput = {
  hasExactCitation: boolean;
  hasRevisionDate: boolean;
  hasSourceUrl: boolean;
  evidenceApproved: boolean;
  workflowStatus: OperatorWorkflowStatus;
  lapmReadinessStatus: LapmReadinessStatus;
  unresolvedPolicyDelta: boolean;
  unresolvedExceptions: boolean;
  reviewRequired?: boolean;
  reviewComplete?: boolean;
};

export function getStageGateOperatorControls(): OperatorControlsTemplate {
  return controls;
}

export function getOperatorControlProfile(profileId: string): OperatorControlProfile | null {
  return profilesById.get(profileId) ?? null;
}

export function getOperatorControlProfileByEvidenceId(evidenceId: string): OperatorControlProfile | null {
  return profilesByEvidenceId.get(evidenceId) ?? null;
}

export function canLabelAsLapmReady(input: LapmReadyCheckInput): boolean {
  if (!input.hasExactCitation || !input.hasRevisionDate || !input.hasSourceUrl) {
    return false;
  }

  if (!input.evidenceApproved || input.workflowStatus !== "approved") {
    return false;
  }

  if (input.lapmReadinessStatus !== "lapm_ready") {
    return false;
  }

  if (input.unresolvedPolicyDelta || input.unresolvedExceptions) {
    return false;
  }

  if (input.reviewRequired && !input.reviewComplete) {
    return false;
  }

  return true;
}

export function mustTreatAsDeferredOrInternalOnly(input: {
  hasPlaceholders: boolean;
  exactFormApplicabilityResolved: boolean;
  projectPhaseEvidenceReady: boolean;
  paymentOrCloseoutSupportReady: boolean;
}): boolean {
  return (
    input.hasPlaceholders ||
    !input.exactFormApplicabilityResolved ||
    !input.projectPhaseEvidenceReady ||
    !input.paymentOrCloseoutSupportReady
  );
}
