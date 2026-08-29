export const JURISDICTION_READINESS_STATUSES = [
  "supported",
  "partial",
  "unavailable",
  "unassessed",
] as const;

export type JurisdictionReadinessStatus = (typeof JURISDICTION_READINESS_STATUSES)[number];

export type JurisdictionReadinessJob = {
  id: string;
  label: string;
  description: string;
  plannerIds: string[];
  organizationIds: string[];
  artifactIds: string[];
};

export type JurisdictionReadinessSource = {
  id: string;
  path: string;
  sha256: string;
};

export type JurisdictionReadinessJurisdiction = {
  id: string;
  label: string;
  country: string;
  subdivision: string | null;
  assessmentKind: string;
};

export type JurisdictionReadinessAuthority = {
  kind: "statute" | "data_source" | "program_catalog";
  label: string;
  agency: string;
  url: string;
};

export type JurisdictionReadinessClaim = {
  id: string;
  jurisdictionId: string;
  jobId: string;
  status: Exclude<JurisdictionReadinessStatus, "unassessed">;
  applicability: string;
  sourceIds: string[];
  adapterIds: string[];
  authorities: JurisdictionReadinessAuthority[];
  limitations: string[];
};

export type JurisdictionReadinessRegistry = {
  schema: "openplan.jurisdiction-readiness.v1";
  registryVersion: string;
  releaseVersion: string;
  reviewedAt: string;
  reviewBy: string;
  statuses: JurisdictionReadinessStatus[];
  jobs: JurisdictionReadinessJob[];
  jurisdictions: JurisdictionReadinessJurisdiction[];
  sources: JurisdictionReadinessSource[];
  claims: JurisdictionReadinessClaim[];
};

export type JurisdictionReadinessPlace = {
  countryCode: string | null;
  subdivisionCode: string | null;
  label?: string | null;
};

export type JurisdictionReadinessReport = {
  schema: "openplan.jurisdiction-readiness-report.v1";
  registryVersion: string;
  registrySha256: string | null;
  reviewedAt: string;
  reviewBy: string;
  jurisdiction: {
    id: string | null;
    label: string;
    country: string | null;
    subdivision: string | null;
    assessmentKind: string | null;
  };
  job: JurisdictionReadinessJob;
  status: JurisdictionReadinessStatus;
  statusLabel: string;
  applicability: string;
  sources: JurisdictionReadinessSource[];
  adapterIds: string[];
  authorities: JurisdictionReadinessAuthority[];
  limitations: string[];
};
