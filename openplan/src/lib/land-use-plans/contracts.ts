/** Shared Land Use Plans contracts. Public legal terms live in descriptors. */

export const PLAN_VERSION_STATES = [
  "working",
  "public_review",
  "adopted",
  "superseded",
  "repealed",
] as const;

export type PlanVersionState = (typeof PLAN_VERSION_STATES)[number];

export const PLAN_VERSION_KINDS = ["original", "revision", "amendment"] as const;
export type PlanVersionKind = (typeof PLAN_VERSION_KINDS)[number];

export const PLAN_CONTENT_NODE_KINDS = [
  "section",
  "goal",
  "objective",
  "policy",
  "standard",
  "program",
  "implementation_action",
] as const;
export type PlanContentNodeKind = (typeof PLAN_CONTENT_NODE_KINDS)[number];

export type LandUsePlan = {
  id: string;
  workspaceId: string;
  title: string;
  descriptorId: string;
  planKindKey: string;
  authorityLabel: string;
  geographyLabel: string;
  geographyGeojson: Record<string, unknown> | null;
  localRequirementsNotice: string | null;
  currentWorkingVersionId: string | null;
  currentAdoptedVersionId: string | null;
};

export type PlanVersion = {
  id: string;
  planId: string;
  versionNumber: number;
  versionKind: PlanVersionKind;
  state: PlanVersionState;
  basedOnVersionId: string | null;
  contentHash: string | null;
  frozenAt: string | null;
  frozenBy: string | null;
};

export type PlanContentNode = {
  id: string;
  versionId: string;
  parentNodeId: string | null;
  nodeKind: PlanContentNodeKind;
  requirementKey: string | null;
  title: string;
  body: string | null;
  sortOrder: number;
  evidenceDocumentId: string | null;
  evidenceUrl: string | null;
};

export type PlanRelationship = {
  id: string;
  planId: string;
  relatedPlanId: string | null;
  relatedPlanLabel: string;
  relationshipKind: "parent" | "child" | "overlapping" | "supersedes" | "implements";
};

export type PlanReviewEvent = {
  id: string;
  versionId: string;
  eventKind:
    | "internal_consistency"
    | "environmental_review"
    | "public_draft"
    | "hearing"
    | "recommendation"
    | "comment_response";
  occurredOn: string | null;
  decisionBody: string | null;
  engagementCampaignId: string | null;
  evidenceDocumentId: string | null;
  notes: string | null;
};

export type PlanDecision = {
  id: string;
  planId: string;
  versionId: string;
  versionContentHash: string;
  decisionKind: "adoption" | "amendment" | "repeal";
  decisionBody: string;
  instrumentType: string;
  instrumentIdentifier: string;
  vote: string | null;
  decidedOn: string;
  effectiveOn: string | null;
  supportingDocumentId: string;
};

export type PlanDesignationReference = {
  id: string;
  versionId: string;
  layerId: string;
  layerVersionId: string;
  designationSetLabel: string;
  legendMetadata: Record<string, unknown>;
  publicFieldKeys: string[];
  legendField: string | null;
  policyNodeIds: string[];
};

export type PlanProcessRecord = {
  id: string;
  versionId: string;
  descriptorId: string;
  processKey: string;
  status: "not_started" | "in_progress" | "complete" | "not_applicable";
  dueOn: string | null;
  completedOn: string | null;
  evidenceDocumentId: string | null;
};

export type PlanReviewRelease = {
  id: string;
  planId: string;
  versionId: string;
  versionContentHash: string;
  roundNumber: number;
  shareToken: string;
  reviewMethod: "engagement_campaign" | "external_process";
  reviewOpenOn: string;
  reviewCloseOn: string;
  status: "open" | "closed" | "withdrawn";
  outcomeHash: string | null;
};

export type ImplementationAction = {
  id: string;
  versionId: string;
  contentNodeId: string | null;
  title: string;
  responsibleParty: string | null;
  dueOn: string | null;
  status: "not_started" | "in_progress" | "completed" | "deferred";
  projectId: string | null;
  programId: string | null;
};

export type JurisdictionPlanDescriptor = {
  id: string;
  jurisdictionLabel: string;
  authorityScope: string;
  configured: boolean;
  verifiedAt: string;
  reviewDueAt: string;
  terminology: {
    plan: string;
    section: string;
    adoptionInstrument: string;
    implementationReport: string;
  };
  planKinds: Array<{ key: string; label: string }>;
  requirements: Array<{
    key: string;
    label: string;
    applicability: "required" | "conditional" | "locally_defined";
    condition?: string;
    sourceUrls: string[];
  }>;
  processSteps: Array<{
    key: string;
    label: string;
    required: boolean;
    decisionBody?: string;
    deadline?: string;
    reviewPrerequisite?: boolean;
    adoptionPrerequisite?: boolean;
    sourceUrls: string[];
  }>;
  disclosure: string;
  sourceUrls: string[];
};
