-- Deployment-global worker observations. Only the service role may read or
-- write these rows: they describe infrastructure, not tenant data.
CREATE TABLE public.modeling_worker_heartbeats (
  worker_kind TEXT NOT NULL CHECK (worker_kind IN ('aequilibrae', 'activitysim')),
  instance_id TEXT NOT NULL,
  supported_stages TEXT[] NOT NULL DEFAULT '{}',
  runtime_mode TEXT NOT NULL,
  worker_version TEXT NOT NULL,
  current_work JSONB,
  started_at TIMESTAMPTZ NOT NULL,
  last_successful_heartbeat_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (worker_kind, instance_id)
);

ALTER TABLE public.modeling_worker_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.modeling_worker_heartbeats FROM anon, authenticated;
GRANT ALL ON public.modeling_worker_heartbeats TO service_role;

COMMENT ON TABLE public.modeling_worker_heartbeats IS
  'Service-role-only deployment health observations. Staleness is presentation state and never cancels active work.';

-- Missing rows preserve the behavior that existed before this preference was
-- introduced: seven days, in-app always on, email on when transport exists.
CREATE TABLE public.workspace_reminder_preferences (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  advance_days INTEGER NOT NULL DEFAULT 7 CHECK (advance_days BETWEEN 1 AND 30),
  email_digest_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.workspace_reminder_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_reminder_preferences_member_read
  ON public.workspace_reminder_preferences FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = workspace_reminder_preferences.workspace_id
      AND wm.user_id = auth.uid()
  ));

CREATE POLICY workspace_reminder_preferences_admin_insert
  ON public.workspace_reminder_preferences FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = workspace_reminder_preferences.workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner', 'admin')
  ));

CREATE POLICY workspace_reminder_preferences_admin_update
  ON public.workspace_reminder_preferences FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = workspace_reminder_preferences.workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner', 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = workspace_reminder_preferences.workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner', 'admin')
  ));

GRANT SELECT, INSERT, UPDATE ON public.workspace_reminder_preferences TO authenticated;
GRANT ALL ON public.workspace_reminder_preferences TO service_role;

CREATE OR REPLACE FUNCTION public.set_workspace_reminder_preferences_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER workspace_reminder_preferences_set_updated_at
  BEFORE UPDATE ON public.workspace_reminder_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_reminder_preferences_updated_at();

-- An exact crash-source publication cutoff is optional. It is absent unless
-- the source publishes it or an authoritative source query returns it.
ALTER TABLE public.safety_crash_ingests
  ADD COLUMN published_through DATE,
  ADD COLUMN published_through_provenance JSONB;

ALTER TABLE public.safety_crash_ingests
  ADD CONSTRAINT safety_crash_ingests_cutoff_provenance_pair
  CHECK (
    (published_through IS NULL AND published_through_provenance IS NULL)
    OR
    (published_through IS NOT NULL AND published_through_provenance IS NOT NULL)
  );
