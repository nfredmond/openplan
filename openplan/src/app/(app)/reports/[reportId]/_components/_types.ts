import type { ProjectStageGateSnapshot } from "@/lib/stage-gates/summary";

export type ReportDetailRouteParams = { params: Promise<{ reportId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

export type ReportRow = {
  id: string;
  workspace_id: string;
  /** Null for RTP-cycle and campaign-targeted reports. */
  project_id: string | null;
  rtp_cycle_id: string | null;
  /** Optional: absent until the campaign-target migration is applied. */
  engagement_campaign_id?: string | null;
  land_use_plan_id?: string | null;
  title: string;
  report_type: string;
  status: string;
  summary: string | null;
  generated_at: string | null;
  latest_artifact_url: string | null;
  latest_artifact_kind: string | null;
  created_at: string;
  updated_at: string;
  metadata_json: Record<string, unknown> | null;
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
  /** Null for inline HTML artifacts; a bucket object path for stored files. */
  storage_path: string | null;
  metadata_json: Record<string, unknown> | null;
};

export type LinkedRunRow = {
  id: string;
  title: string;
  summary_text: string | null;
  metrics?: Record<string, unknown> | null;
  created_at: string;
};

/** A resolved typed report citation (report_runs.model_run_id / county_run_id). */
export type { TypedRunCitation } from "@/lib/reports/run-citations";

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

export type CurrentProjectRecordEntry = ProjectRecordSnapshotEntry;

export type ProjectRecordSnapshotListItem = {
  key: string;
  label: string;
  anchor: string;
  value: ProjectRecordSnapshotEntry;
};

export type ProjectRecordSnapshotKey =
  | "deliverables"
  | "risks"
  | "issues"
  | "decisions"
  | "meetings";

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

export type StageGateSnapshotControlHealth =
  ProjectStageGateSnapshot["controlHealth"];

export type ScenarioSpineRow = {
  scenario_set_id?: string | null;
  updated_at?: string | null;
  snapshot_at?: string | null;
};

export type EngagementCampaignSnapshot = {
  id: string;
  title: string;
  status: string | null;
  updatedAt: string | null;
};

export type EngagementCategoryRow = {
  id: string;
  label: string | null;
  slug: string | null;
  description: string | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type EngagementItemRow = {
  id: string;
  campaign_id: string;
  category_id: string | null;
  status: string | null;
  source_type: string | null;
  latitude: number | null;
  longitude: number | null;
  moderation_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type StageGateDecisionRow = {
  gate_id: string;
  decision: string;
  rationale: string | null;
  decided_at: string | null;
  missing_artifacts?: string[] | null;
};
