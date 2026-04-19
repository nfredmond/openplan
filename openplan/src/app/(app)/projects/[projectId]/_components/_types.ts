export type ProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  summary: string | null;
  status: string;
  plan_type: string;
  delivery_phase: string;
  created_at: string;
  updated_at: string;
};

export type ProjectReportRow = {
  id: string;
  title: string;
  summary: string | null;
  report_type: string;
  status: string;
  updated_at: string;
  generated_at: string | null;
  latest_artifact_kind: string | null;
};

export type ReportArtifactRow = {
  report_id: string;
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

export type TimelineItem = {
  id: string;
  type: string;
  title: string;
  description: string;
  at: string | null;
  badge: string;
  tone: "info" | "success" | "warning" | "danger" | "neutral";
};

export type LinkedDatasetItem = {
  datasetId: string;
  name: string;
  status: string;
  relationshipType: string;
  connectorLabel: string | null;
  vintageLabel: string | null;
  lastRefreshedAt: string | null;
};

export type ProjectRtpLinkRow = {
  id: string;
  rtp_cycle_id: string;
  portfolio_role: string;
  priority_rationale: string | null;
  created_at: string;
};

export type RtpCycleRow = {
  id: string;
  title: string;
  status: string;
  geography_label: string | null;
  horizon_start_year: number | null;
  horizon_end_year: number | null;
};

export type MilestoneRow = {
  id: string;
  title: string;
  summary: string | null;
  milestone_type: string;
  phase_code: string;
  status: string;
  owner_label: string | null;
  target_date: string | null;
  actual_date: string | null;
  notes: string | null;
  created_at: string;
};

export type SubmittalRow = {
  id: string;
  title: string;
  submittal_type: string;
  status: string;
  agency_label: string | null;
  reference_number: string | null;
  due_date: string | null;
  submitted_at: string | null;
  review_cycle: number;
  notes: string | null;
  created_at: string;
};

export type BillingInvoiceRow = {
  id: string;
  funding_award_id: string | null;
  invoice_number: string;
  consultant_name: string | null;
  billing_basis: string;
  status: string;
  invoice_date: string | null;
  due_date: string | null;
  amount: number | string | null;
  retention_percent: number | string | null;
  retention_amount: number | string | null;
  net_amount: number | string | null;
  supporting_docs_status: string;
  submitted_to: string | null;
  caltrans_posture: string;
  notes: string | null;
  created_at: string;
  funding_awards:
    | {
        id: string;
        title: string;
      }
    | Array<{
        id: string;
        title: string;
      }>
    | null;
};

export type FundingOpportunityRow = {
  id: string;
  program_id: string | null;
  project_id: string | null;
  title: string;
  opportunity_status: string;
  decision_state: string;
  agency_name: string | null;
  owner_label: string | null;
  cadence_label: string | null;
  expected_award_amount: number | string | null;
  opens_at: string | null;
  closes_at: string | null;
  decision_due_at: string | null;
  fit_notes: string | null;
  readiness_notes: string | null;
  decision_rationale: string | null;
  decided_at: string | null;
  summary: string | null;
  updated_at: string;
  created_at: string;
  programs:
    | {
        id: string;
        title: string;
      }
    | Array<{
        id: string;
        title: string;
      }>
    | null;
};

export type ProjectFundingProfileRow = {
  id: string;
  project_id: string;
  funding_need_amount: number | null;
  local_match_need_amount: number | null;
  notes: string | null;
  updated_at: string;
};

export type FundingAwardRow = {
  id: string;
  project_id: string;
  program_id: string | null;
  funding_opportunity_id: string | null;
  title: string;
  awarded_amount: number | string;
  match_amount: number | string;
  match_posture: string;
  obligation_due_at: string | null;
  spending_status: string;
  risk_flag: string;
  notes: string | null;
  updated_at: string;
  created_at: string;
  funding_opportunities:
    | {
        id: string;
        title: string;
      }
    | Array<{
        id: string;
        title: string;
      }>
    | null;
  programs:
    | {
        id: string;
        title: string;
      }
    | Array<{
        id: string;
        title: string;
      }>
    | null;
};

export type FundingAward = FundingAwardRow & {
  opportunity: { id: string; title: string } | null;
  program: { id: string; title: string } | null;
};

export type FundingOpportunity = FundingOpportunityRow & {
  program: { id: string; title: string } | null;
};

export type BillingInvoice = BillingInvoiceRow & {
  fundingAward: { id: string; title: string } | null;
};

export type WorkspaceRow = {
  id: string;
  name: string;
  plan: string | null;
  slug: string | null;
  stage_gate_template_id: string | null;
  stage_gate_template_version: string | null;
  created_at: string;
};

export type ExistingRtpLink = {
  id: string;
  rtpCycleId: string;
  title: string;
  status: string;
  geographyLabel: string | null;
  horizonStartYear: number | null;
  horizonEndYear: number | null;
  portfolioRole: string;
  priorityRationale: string | null;
};

export type AerialMission = {
  id: string;
  title: string;
  status: string;
  mission_type: string;
  geography_label: string | null;
  collected_at: string | null;
  updated_at: string;
};

export type AerialPackage = {
  id: string;
  mission_id: string;
  title: string;
  package_type: string;
  status: string;
  verification_readiness: string;
  updated_at: string;
};

export type RecentRun = {
  id: string;
  title: string;
  created_at: string;
  summary_text: string | null;
};

export type DeliverableRow = {
  id: string;
  title: string;
  summary: string | null;
  owner_label: string | null;
  due_date: string | null;
  status: string;
  created_at: string;
};

export type RiskRow = {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  mitigation: string | null;
  created_at: string;
};

export type IssueRow = {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  owner_label: string | null;
  created_at: string;
};

export type DecisionRow = {
  id: string;
  title: string;
  rationale: string;
  status: string;
  impact_summary: string | null;
  decided_at: string | null;
  created_at: string;
};

export type MeetingRow = {
  id: string;
  title: string;
  notes: string | null;
  meeting_at: string | null;
  attendees_summary: string | null;
  created_at: string;
};
