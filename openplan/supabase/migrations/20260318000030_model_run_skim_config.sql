-- P1B.3: Add skim configuration column to model_runs

alter table public.model_runs
  add column if not exists skim_config_json jsonb default '{}'::jsonb;

comment on column public.model_runs.skim_config_json is 'Per-run skim generation configuration: time periods, modes, impedance type';
