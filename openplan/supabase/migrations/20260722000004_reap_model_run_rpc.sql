-- Atomic reaper for stale model runs (Wave 2 pilot hardening).
--
-- Turns a run whose worker crashed (or was never claimed) into a truthful
-- `failed` state, re-validating progress across BOTH model_runs and
-- model_run_stages inside a single transaction so a returning/streaming worker
-- can never be clobbered. Called only by the service role (reconcile-on-read in
-- the model page loader + the /api/cron/reap-model-runs sweep).
--
-- Why a function (not two client-side guarded updates): `model_runs.updated_at`
-- is bumped only when the worker transitions the RUN (claim->running,
-- ->failed, ->succeeded); the per-stage `log_tail` heartbeat the worker streams
-- bumps only `model_run_stages.updated_at` (no cascade). So the real progress
-- signal lives on the stages, and a race-free reap must re-check both tables
-- atomically.
--
-- p_stale_before = the freshest progress timestamp the caller observed at
-- snapshot time (max of the run's and its stages' timestamps). The run is
-- reaped only if NOTHING has advanced past it: the run row itself is untouched
-- (updated_at <= p_stale_before — this also catches a queued run being claimed,
-- since a claim bumps model_runs.updated_at) AND no stage has a fresher
-- updated_at (this catches an in-flight stage still streaming log_tail).

create or replace function public.reap_model_run_if_stale(
  p_run_id uuid,
  p_stale_before timestamptz,
  p_message text
) returns boolean
language plpgsql
as $$
declare
  v_now timestamptz := now();
begin
  update public.model_runs r
     set status = 'failed',
         error_message = p_message,
         completed_at = v_now
   where r.id = p_run_id
     and r.status in ('queued', 'running')
     and r.updated_at <= p_stale_before
     and not exists (
       select 1
         from public.model_run_stages s
        where s.run_id = r.id
          and s.updated_at > p_stale_before
     );

  if not found then
    return false;
  end if;

  update public.model_run_stages
     set status = 'failed',
         error_message = p_message,
         completed_at = v_now
   where run_id = p_run_id
     and status in ('queued', 'running');

  return true;
end;
$$;

-- Lock the RPC down: only the service role may reap runs (not anon/authenticated
-- via PostgREST /rpc).
revoke all on function public.reap_model_run_if_stale(uuid, timestamptz, text) from public;
grant execute on function public.reap_model_run_if_stale(uuid, timestamptz, text) to service_role;
