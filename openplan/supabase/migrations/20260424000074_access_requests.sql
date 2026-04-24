-- Public request-access intake for supervised first-customer onboarding.
--
-- Access requests contain prospect contact data. They are written only by
-- service-role API routes and are not readable through anon/authenticated RLS.

CREATE TABLE IF NOT EXISTS public.access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_name TEXT NOT NULL CHECK (length(btrim(agency_name)) > 0),
  contact_name TEXT NOT NULL CHECK (length(btrim(contact_name)) > 0),
  contact_email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  role_title TEXT,
  region TEXT,
  use_case TEXT NOT NULL CHECK (length(btrim(use_case)) > 0),
  expected_workspace_name TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'reviewing', 'contacted', 'invited', 'provisioned', 'deferred', 'declined')
  ),
  source_path TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  provisioned_workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email_normalized = lower(btrim(contact_email))),
  CHECK (position('@' in email_normalized) > 1)
);

CREATE INDEX IF NOT EXISTS access_requests_status_created_idx
  ON public.access_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS access_requests_email_idx
  ON public.access_requests(email_normalized, created_at DESC);

CREATE INDEX IF NOT EXISTS access_requests_provisioned_workspace_idx
  ON public.access_requests(provisioned_workspace_id)
  WHERE provisioned_workspace_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_open_per_email_idx
  ON public.access_requests(email_normalized)
  WHERE status IN ('new', 'reviewing', 'contacted', 'invited');

ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.access_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.access_requests TO service_role;

CREATE OR REPLACE FUNCTION public.set_access_requests_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_access_requests_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_access_requests_updated_at() TO service_role;

DROP TRIGGER IF EXISTS trg_set_access_requests_updated_at ON public.access_requests;
CREATE TRIGGER trg_set_access_requests_updated_at
BEFORE UPDATE ON public.access_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_access_requests_updated_at();

COMMENT ON TABLE public.access_requests IS
  'Service-role-only public request-access intake for supervised onboarding. Contains prospect contact data; no anon/authenticated RLS read policies by design.';
