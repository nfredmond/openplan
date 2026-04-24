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
