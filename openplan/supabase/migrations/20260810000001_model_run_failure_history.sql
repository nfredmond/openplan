-- A relaunch resets the failed run's row IN PLACE (status, error_message,
-- stages all wiped), so a run failing for the third time was indistinguishable
-- from one failing for the first — and the failure copy suggested "re-launch to
-- retry" forever. These two columns preserve what the relaunch destroys:
--
--   failure_count         how many FAILED attempts this run row has been
--                          relaunched after (incremented by the relaunch route
--                          when it resets a run whose status is 'failed';
--                          cancelled runs are not failures and do not count).
--   last_failure_message  the most recent failed attempt's recorded reason
--                          (the run-level error_message when one exists,
--                          otherwise the causing stage's), captured at
--                          relaunch time before the wipe.
--
-- Both are written only by the relaunch route; the worker and the in-app
-- engines are untouched, so a deployment running an older app simply keeps
-- the defaults (0 / null) and the UI says nothing new.

alter table public.model_runs
  add column if not exists failure_count integer not null default 0,
  add column if not exists last_failure_message text;

comment on column public.model_runs.failure_count is
  'Failed attempts this run has been relaunched after. Written only by the relaunch route at reset time.';
comment on column public.model_runs.last_failure_message is
  'The most recent failed attempt''s recorded reason, captured by the relaunch route before it wipes the row.';
