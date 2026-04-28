-- Add managed-services intake routing fields to request-access rows.
--
-- This is additive by design: existing prospect rows remain readable and can be
-- triaged without backfill, while new submissions carry enough context to route
-- into a delivery lane before provisioning.

ALTER TABLE public.access_requests
  ADD COLUMN IF NOT EXISTS organization_type TEXT,
  ADD COLUMN IF NOT EXISTS service_lane TEXT,
  ADD COLUMN IF NOT EXISTS deployment_posture TEXT,
  ADD COLUMN IF NOT EXISTS data_sensitivity TEXT,
  ADD COLUMN IF NOT EXISTS desired_first_workflow TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_needs TEXT;

CREATE INDEX IF NOT EXISTS access_requests_service_lane_status_created_idx
  ON public.access_requests(service_lane, status, created_at DESC)
  WHERE service_lane IS NOT NULL;

CREATE INDEX IF NOT EXISTS access_requests_first_workflow_status_created_idx
  ON public.access_requests(desired_first_workflow, status, created_at DESC)
  WHERE desired_first_workflow IS NOT NULL;

COMMENT ON COLUMN public.access_requests.organization_type IS
  'Prospect organization category captured from public request-access intake.';
COMMENT ON COLUMN public.access_requests.service_lane IS
  'Nat Ford delivery lane requested before workspace provisioning, such as managed hosting/admin or planning services.';
COMMENT ON COLUMN public.access_requests.deployment_posture IS
  'Preferred deployment/admin posture captured during intake, when known.';
COMMENT ON COLUMN public.access_requests.data_sensitivity IS
  'Prospect-indicated sensitivity level for data likely to be used in the first workflow.';
COMMENT ON COLUMN public.access_requests.desired_first_workflow IS
  'First OpenPlan workflow requested for onboarding, such as RTP, grants, aerial evidence, modeling, or engagement.';
COMMENT ON COLUMN public.access_requests.onboarding_needs IS
  'Free-text onboarding and implementation needs captured before supervised follow-up.';
