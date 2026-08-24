-- Reports are shared across modules. Land Use Plans adds a fourth mutually
-- exclusive report target; extend the existing exact-one-target invariant.
ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_target_presence;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_target_presence CHECK (
    num_nonnulls(project_id, rtp_cycle_id, engagement_campaign_id, land_use_plan_id) = 1
  );
