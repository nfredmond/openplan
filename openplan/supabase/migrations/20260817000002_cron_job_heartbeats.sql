-- A heartbeat each scheduled job stamps when it SUCCEEDS, so the product can
-- tell the truth about whether reminders are actually running.
--
-- Why: the My Work reminder panel keyed its "reminders are on" disclosure on
-- the mere PRESENCE of CRON_SECRET. A self-hoster sets that secret for the
-- model-run reaper (the only cron the docs described), never wires a scheduler
-- to /api/cron/sweep-deadlines, and the panel then claims reminders work while
-- none ever fire (found 2026-08-17). Presence of a secret is not evidence a job
-- ran; a recorded success is. This is the mechanism, replacing a convention.
--
-- Deployment-global operational metadata, NOT tenant data: keyed by job name,
-- no workspace_id, one row per cron job for the whole install. RLS is enabled
-- and there are NO policies, so it is reachable only by the service role (which
-- bypasses RLS) — the sweep route writes it, the My Work layout reads it, both
-- server-side with the service-role client. anon/authenticated get nothing.

CREATE TABLE IF NOT EXISTS public.cron_job_heartbeats (
  job_name           text PRIMARY KEY CHECK (length(btrim(job_name)) > 0),
  last_succeeded_at  timestamptz NOT NULL,
  -- A small JSON summary of the last successful run (counts, not tenant rows),
  -- for an operator reading the table directly. Never rendered to a planner.
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cron_job_heartbeats ENABLE ROW LEVEL SECURITY;

-- Locked: no policies. Only the service role (bypasses RLS) touches this table.
-- The deny is explicit so a future GRANT cannot quietly open it.
REVOKE ALL ON public.cron_job_heartbeats FROM anon, authenticated;

COMMENT ON TABLE public.cron_job_heartbeats IS
  'Deployment-global heartbeat: each scheduled job upserts (job_name, last_succeeded_at) on success. Read server-side via the service role to disclose honestly whether a cron (e.g. sweep-deadlines) is actually running, regardless of how it is scheduled (Vercel cron or a self-host scheduler). No tenant data, no workspace_id; RLS-enabled with no policies so only the service role can reach it.';
