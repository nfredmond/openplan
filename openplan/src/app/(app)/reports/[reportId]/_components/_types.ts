export type ReportRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  rtp_cycle_id: string | null;
  title: string;
  report_type: string;
  status: string;
  summary: string | null;
  generated_at: string | null;
  latest_artifact_url: string | null;
  latest_artifact_kind: string | null;
  created_at: string;
  updated_at: string;
  rtp_basis_stale: boolean | null;
  rtp_basis_stale_reason: string | null;
  rtp_basis_stale_run_id: string | null;
  rtp_basis_stale_marked_at: string | null;
};

export type ReportProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  summary: string | null;
  status: string;
  plan_type: string | null;
  delivery_phase: string | null;
  updated_at: string | null;
};

export type ReportArtifact = {
  id: string;
  artifact_kind: string;
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

export type LinkedRunRow = {
  id: string;
  title: string;
  summary_text: string | null;
  created_at: string;
};

export type ReportSectionRow = {
  id: string;
  section_key: string;
  title: string;
  enabled: boolean;
  sort_order: number;
  config_json: Record<string, unknown> | null;
};

export type EngagementCampaignLinkRow = {
  id: string;
  title: string;
  summary: string | null;
  public_description: string | null;
  status: string;
  engagement_type: string;
  share_token: string | null;
  allow_public_submissions: boolean;
  submissions_closed_at: string | null;
  updated_at: string;
};

export type ProjectRecordSnapshotEntry = {
  count: number;
  latestTitle: string | null;
  latestAt: string | null;
};

export type ProjectRecordSnapshotListItem = {
  key: string;
  label: string;
  anchor: string;
  value: ProjectRecordSnapshotEntry;
};

export type DriftStatus = "unchanged" | "updated" | "count changed" | "gate changed";

export type DriftItem = {
  key: string;
  label: string;
  status: DriftStatus;
  detail: string;
};

export type DriftAction = { href: string; label: string } | null;

export type PacketFreshness = {
  label: string;
  tone: "success" | "warning" | "neutral" | "info";
  detail: string;
};

export type RunAuditEntry = {
  runId: string;
  gate: { decision: string; missingArtifacts: string[] };
};
