export const ACCESS_REQUEST_SERVICE_LANE_VALUES = [
  "self_host_evaluation",
  "managed_hosting_admin",
  "implementation_onboarding",
  "planning_services",
  "custom_software_ai_systems",
] as const;

export type AccessRequestServiceLane = (typeof ACCESS_REQUEST_SERVICE_LANE_VALUES)[number];

export const ACCESS_REQUEST_SERVICE_LANE_LABELS: Record<AccessRequestServiceLane, string> = {
  self_host_evaluation: "Self-host evaluation",
  managed_hosting_admin: "Managed hosting/admin",
  implementation_onboarding: "Implementation/onboarding",
  planning_services: "Planning services",
  custom_software_ai_systems: "Custom software/AI systems",
};

export const ACCESS_REQUEST_FIRST_WORKFLOW_VALUES = [
  "rtp",
  "grants",
  "aerial_evidence",
  "modeling",
  "engagement",
  "other",
] as const;

export type AccessRequestFirstWorkflow = (typeof ACCESS_REQUEST_FIRST_WORKFLOW_VALUES)[number];

export const ACCESS_REQUEST_FIRST_WORKFLOW_LABELS: Record<AccessRequestFirstWorkflow, string> = {
  rtp: "RTP",
  grants: "Grants",
  aerial_evidence: "Aerial evidence",
  modeling: "Modeling",
  engagement: "Engagement",
  other: "Other",
};

export const ACCESS_REQUEST_DEPLOYMENT_POSTURE_VALUES = [
  "nat_ford_managed",
  "self_hosted",
  "agency_cloud",
  "undecided",
] as const;

export type AccessRequestDeploymentPosture = (typeof ACCESS_REQUEST_DEPLOYMENT_POSTURE_VALUES)[number];

export const ACCESS_REQUEST_DEPLOYMENT_POSTURE_LABELS: Record<AccessRequestDeploymentPosture, string> = {
  nat_ford_managed: "Nat Ford managed",
  self_hosted: "Self-hosted",
  agency_cloud: "Agency cloud/vendor environment",
  undecided: "Undecided",
};

export const ACCESS_REQUEST_ORGANIZATION_TYPE_VALUES = [
  "local_agency",
  "rtpa_mpo",
  "consultant",
  "tribal_government",
  "nonprofit_academic",
  "private_sector",
  "other",
] as const;

export type AccessRequestOrganizationType = (typeof ACCESS_REQUEST_ORGANIZATION_TYPE_VALUES)[number];

export const ACCESS_REQUEST_ORGANIZATION_TYPE_LABELS: Record<AccessRequestOrganizationType, string> = {
  local_agency: "City/county/local agency",
  rtpa_mpo: "RTPA/MPO/COG",
  consultant: "Consultant team",
  tribal_government: "Tribal government",
  nonprofit_academic: "Nonprofit/academic",
  private_sector: "Private-sector owner/operator",
  other: "Other",
};

export const ACCESS_REQUEST_DATA_SENSITIVITY_VALUES = [
  "public",
  "internal_planning",
  "confidential_project",
  "regulated_sensitive",
  "unsure",
] as const;

export type AccessRequestDataSensitivity = (typeof ACCESS_REQUEST_DATA_SENSITIVITY_VALUES)[number];

export const ACCESS_REQUEST_DATA_SENSITIVITY_LABELS: Record<AccessRequestDataSensitivity, string> = {
  public: "Public/open data",
  internal_planning: "Internal planning data",
  confidential_project: "Confidential project material",
  regulated_sensitive: "Regulated or sensitive records",
  unsure: "Unsure — needs review",
};

export function labelAccessRequestServiceLane(value: string | null | undefined): string {
  return value && value in ACCESS_REQUEST_SERVICE_LANE_LABELS
    ? ACCESS_REQUEST_SERVICE_LANE_LABELS[value as AccessRequestServiceLane]
    : "Not selected";
}

export function labelAccessRequestFirstWorkflow(value: string | null | undefined): string {
  return value && value in ACCESS_REQUEST_FIRST_WORKFLOW_LABELS
    ? ACCESS_REQUEST_FIRST_WORKFLOW_LABELS[value as AccessRequestFirstWorkflow]
    : "Not selected";
}

export function labelAccessRequestDeploymentPosture(value: string | null | undefined): string {
  return value && value in ACCESS_REQUEST_DEPLOYMENT_POSTURE_LABELS
    ? ACCESS_REQUEST_DEPLOYMENT_POSTURE_LABELS[value as AccessRequestDeploymentPosture]
    : "Not specified";
}

export function labelAccessRequestOrganizationType(value: string | null | undefined): string {
  return value && value in ACCESS_REQUEST_ORGANIZATION_TYPE_LABELS
    ? ACCESS_REQUEST_ORGANIZATION_TYPE_LABELS[value as AccessRequestOrganizationType]
    : "Not specified";
}

export function labelAccessRequestDataSensitivity(value: string | null | undefined): string {
  return value && value in ACCESS_REQUEST_DATA_SENSITIVITY_LABELS
    ? ACCESS_REQUEST_DATA_SENSITIVITY_LABELS[value as AccessRequestDataSensitivity]
    : "Not specified";
}
