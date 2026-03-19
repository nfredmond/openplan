-- P1B.4: Model run KPIs table for assignment and accessibility extractors

create table if not exists public.model_run_kpis (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.model_runs(id) on delete cascade,
  kpi_name text not null,
  kpi_label text not null,
  kpi_category text not null default 'accessibility' check (kpi_category in ('accessibility', 'assignment', 'safety', 'equity', 'general')),
  value double precision,
  unit text not null default '',
  geometry_ref text,
  breakdown_json jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_model_run_kpis_run on public.model_run_kpis(run_id);
create index if not exists idx_model_run_kpis_name on public.model_run_kpis(run_id, kpi_name);
create index if not exists idx_model_run_kpis_category on public.model_run_kpis(run_id, kpi_category);

-- RLS: workspace isolation via model_runs chain
alter table public.model_run_kpis enable row level security;

create policy "model_run_kpis_select" on public.model_run_kpis
  for select using (
    exists (
      select 1 from public.model_runs mr
      join public.models m on m.id = mr.model_id
      join public.workspace_members wm on wm.workspace_id = m.workspace_id
      where mr.id = model_run_kpis.run_id
        and wm.user_id = auth.uid()
    )
  );

create policy "model_run_kpis_insert" on public.model_run_kpis
  for insert with check (
    exists (
      select 1 from public.model_runs mr
      join public.models m on m.id = mr.model_id
      join public.workspace_members wm on wm.workspace_id = m.workspace_id
      where mr.id = model_run_kpis.run_id
        and wm.user_id = auth.uid()
    )
  );

create policy "model_run_kpis_delete" on public.model_run_kpis
  for delete using (
    exists (
      select 1 from public.model_runs mr
      join public.models m on m.id = mr.model_id
      join public.workspace_members wm on wm.workspace_id = m.workspace_id
      where mr.id = model_run_kpis.run_id
        and wm.user_id = auth.uid()
    )
  );
