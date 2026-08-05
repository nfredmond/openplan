/**
 * The row shapes the RTP cycle detail page reads.
 *
 * Split out of the page for the same reason `rtp/_components/_types.ts` exists
 * one directory up: the page is a composition root, and a hundred lines of
 * column declarations between its imports and its first query makes the reads
 * harder to find than they should be.
 *
 * These mirror `.select()` projections in the page. Supabase clients are
 * untyped here by deliberate convention, so nothing checks these against the
 * database — a wrong column surfaces at runtime. That is what the
 * projection-string assertions in the page's tests are for.
 */

export type RtpCycleRow = {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
  geography_label: string | null;
  horizon_start_year: number | null;
  horizon_end_year: number | null;
  adoption_target_date: string | null;
  public_review_open_at: string | null;
  public_review_close_at: string | null;
  summary: string | null;
  financial_basis_year: number | null;
  annual_inflation_rate: number | string | null;
  anchor_latitude: number | string | null;
  anchor_longitude: number | string | null;
  public_share_token: string | null;
  public_share_enabled: boolean | null;
  created_at: string;
  updated_at: string;
};

export type RtpCycleChapterRow = {
  id: string;
  chapter_key: string;
  title: string;
  section_type: string;
  status: string;
  sort_order: number;
  required: boolean;
  guidance: string | null;
  summary: string | null;
  content_markdown: string | null;
  updated_at: string;
};

export type ProjectLinkProjectRow = {
  id: string;
  name: string;
  status: string;
  delivery_phase: string;
  summary: string | null;
  rtp_posture_updated_at: string | null;
};

export type ProjectFundingProfileRow = {
  project_id: string;
  funding_need_amount: number | null;
  local_match_need_amount: number | null;
};

export type FundingAwardRow = {
  project_id: string;
  awarded_amount: number | string;
  match_amount: number | string;
  risk_flag: string;
  obligation_due_at: string | null;
};

export type FundingOpportunityRow = {
  project_id: string;
  decision_state: string;
  opportunity_status: string;
  expected_award_amount: number | string | null;
};

export type BillingInvoiceRow = {
  project_id: string;
  funding_award_id: string | null;
  status: string;
  amount: number | string | null;
  retention_percent: number | string | null;
  retention_amount: number | string | null;
  net_amount: number | string | null;
  due_date: string | null;
};

export type ProjectRtpLinkRow = {
  id: string;
  project_id: string;
  portfolio_role: string;
  priority_rationale: string | null;
  priority_scores: Record<string, number> | null;
  horizon_band_id: string | null;
  /** NUMERIC arrives as a string from PostgREST. NULL means UNPRICED, never 0. */
  estimated_cost: number | string | null;
  cost_basis_year: number | null;
  created_at: string;
  projects: ProjectLinkProjectRow | ProjectLinkProjectRow[] | null;
};

export type CampaignProjectRow = {
  id: string;
  name: string;
};

export type EngagementCampaignRow = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  engagement_type: string;
  rtp_cycle_chapter_id: string | null;
  updated_at: string;
  projects: CampaignProjectRow | CampaignProjectRow[] | null;
};

export type RtpPacketReportRow = {
  id: string;
  title: string;
  updated_at: string;
};

export type EngagementItemSummaryRow = {
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

export type ReportArtifactRow = {
  report_id: string;
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

export type ModelingClaimDecisionDefaultRow = {
  county_run_id: string | null;
};
