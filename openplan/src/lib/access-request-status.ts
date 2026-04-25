export const ACCESS_REQUEST_STATUSES = [
  "new",
  "reviewing",
  "contacted",
  "invited",
  "provisioned",
  "deferred",
  "declined",
] as const;

export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];

export const ACCESS_REQUEST_TRIAGE_STATUSES = [
  "reviewing",
  "contacted",
  "invited",
  "deferred",
  "declined",
] as const;

export type AccessRequestTriageStatus = (typeof ACCESS_REQUEST_TRIAGE_STATUSES)[number];

export const ACCESS_REQUEST_PROVISIONABLE_STATUSES = ["contacted", "invited"] as const;

export type AccessRequestProvisionableStatus = (typeof ACCESS_REQUEST_PROVISIONABLE_STATUSES)[number];

export const ACCESS_REQUEST_TRIAGE_SIDE_EFFECTS = {
  reviewEventRecorded: true,
  outboundEmailSent: false,
  workspaceProvisioned: false,
} as const;

export const ACCESS_REQUEST_PROVISIONING_SIDE_EFFECTS = {
  reviewEventRecorded: true,
  outboundEmailSent: false,
  workspaceProvisioned: true,
  ownerInvitationCreated: true,
} as const;

const ACCESS_REQUEST_TRIAGE_TRANSITIONS: Record<AccessRequestStatus, AccessRequestTriageStatus[]> = {
  new: ["reviewing", "deferred", "declined"],
  reviewing: ["contacted", "deferred", "declined"],
  contacted: ["invited", "deferred", "declined"],
  invited: ["deferred", "declined"],
  provisioned: [],
  deferred: [],
  declined: [],
};

export function isAccessRequestTriageStatus(value: string): value is AccessRequestTriageStatus {
  return ACCESS_REQUEST_TRIAGE_STATUSES.includes(value as AccessRequestTriageStatus);
}

export function getAccessRequestTransitionOptions(status: AccessRequestStatus): AccessRequestTriageStatus[] {
  return ACCESS_REQUEST_TRIAGE_TRANSITIONS[status] ?? [];
}

export function canTransitionAccessRequestStatus(
  currentStatus: AccessRequestStatus,
  nextStatus: AccessRequestTriageStatus,
): boolean {
  return getAccessRequestTransitionOptions(currentStatus).includes(nextStatus);
}

export function canProvisionAccessRequestStatus(
  status: AccessRequestStatus,
): status is AccessRequestProvisionableStatus {
  return ACCESS_REQUEST_PROVISIONABLE_STATUSES.includes(status as AccessRequestProvisionableStatus);
}

export function accessRequestStatusLabel(status: AccessRequestStatus): string {
  const labels: Record<AccessRequestStatus, string> = {
    new: "New",
    reviewing: "Reviewing",
    contacted: "Contacted",
    invited: "Invited",
    provisioned: "Provisioned",
    deferred: "Deferred",
    declined: "Declined",
  };

  return labels[status] ?? status;
}

export function accessRequestTriageActionLabel(status: AccessRequestTriageStatus): string {
  const labels: Record<AccessRequestTriageStatus, string> = {
    reviewing: "Mark reviewing",
    contacted: "Mark contacted",
    invited: "Mark invited",
    deferred: "Defer",
    declined: "Decline",
  };

  return labels[status];
}

export function accessRequestTriageSideEffectLabel(): string {
  return "Records review status only; no outbound email or workspace is created.";
}

export function accessRequestProvisioningSideEffectLabel(): string {
  return "Creates a pilot workspace and owner invite; no outbound email is sent.";
}
