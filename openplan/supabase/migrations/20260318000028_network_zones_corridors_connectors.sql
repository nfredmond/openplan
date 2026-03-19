-- P1A.2: Zone / Corridor / Connector tables for network packages
-- These tables standardize how zones and corridors attach to versioned network bundles.

-- ============================================================
-- network_zones
-- ============================================================
create table if not exists public.network_zones (
  id uuid primary key default gen_random_uuid(),
  package_version_id uuid not null references public.network_package_versions(id) on delete cascade,
  zone_id_external text,
  zone_type text not null default 'taz' check (zone_type in ('taz', 'census_tract', 'custom')),
  name text,
  centroid_lat double precision,
  centroid_lng double precision,
  geometry_geojson jsonb,
  properties jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_network_zones_package_version
  on public.network_zones(package_version_id);

create index if not exists idx_network_zones_external_id
  on public.network_zones(package_version_id, zone_id_external);

-- ============================================================
-- network_corridors
-- ============================================================
create table if not exists public.network_corridors (
  id uuid primary key default gen_random_uuid(),
  package_version_id uuid not null references public.network_package_versions(id) on delete cascade,
  corridor_name text not null,
  corridor_type text not null default 'highway' check (corridor_type in ('highway', 'arterial', 'transit', 'bike', 'custom')),
  geometry_geojson jsonb,
  direction text not null default 'both' check (direction in ('both', 'northbound', 'southbound', 'eastbound', 'westbound', 'inbound', 'outbound')),
  properties jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_network_corridors_package_version
  on public.network_corridors(package_version_id);

-- ============================================================
-- network_connectors
-- ============================================================
create table if not exists public.network_connectors (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.network_zones(id) on delete cascade,
  package_version_id uuid not null references public.network_package_versions(id) on delete cascade,
  target_node_id text,
  connector_type text not null default 'auto' check (connector_type in ('auto', 'transit', 'walk', 'bike')),
  impedance_minutes double precision default 0,
  geometry_geojson jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_network_connectors_zone
  on public.network_connectors(zone_id);

create index if not exists idx_network_connectors_package_version
  on public.network_connectors(package_version_id);

-- ============================================================
-- RLS: workspace isolation via network_package_versions chain
-- ============================================================

-- network_zones RLS
alter table public.network_zones enable row level security;

create policy "network_zones_select" on public.network_zones
  for select using (
    exists (
      select 1 from public.network_package_versions npv
      join public.network_packages np on np.id = npv.package_id
      join public.workspace_members wm on wm.workspace_id = np.workspace_id
      where npv.id = network_zones.package_version_id
        and wm.user_id = auth.uid()
    )
  );

create policy "network_zones_insert" on public.network_zones
  for insert with check (
    exists (
      select 1 from public.network_package_versions npv
      join public.network_packages np on np.id = npv.package_id
      join public.workspace_members wm on wm.workspace_id = np.workspace_id
      where npv.id = network_zones.package_version_id
        and wm.user_id = auth.uid()
    )
  );

create policy "network_zones_update" on public.network_zones
  for update using (
    exists (
      select 1 from public.network_package_versions npv
      join public.network_packages np on np.id = npv.package_id
      join public.workspace_members wm on wm.workspace_id = np.workspace_id
      where npv.id = network_zones.package_version_id
        and wm.user_id = auth.uid()
    )
  );

create policy "network_zones_delete" on public.network_zones
  for delete using (
    exists (
      select 1 from public.network_package_versions npv
      join public.network_packages np on np.id = npv.package_id
      join public.workspace_members wm on wm.workspace_id = np.workspace_id
      where npv.id = network_zones.package_version_id
        and wm.user_id = auth.uid()
    )
  );

-- network_corridors RLS
alter table public.network_corridors enable row level security;

create policy "network_corridors_select" on public.network_corridors
  for select using (
    exists (
      select 1 from public.network_package_versions npv
      join public.network_packages np on np.id = npv.package_id
      join public.workspace_members wm on wm.workspace_id = np.workspace_id
      where npv.id = network_corridors.package_version_id
        and wm.user_id = auth.uid()
    )
  );

create policy "network_corridors_insert" on public.network_corridors
  for insert with check (
    exists (
      select 1 from public.network_package_versions npv
      join public.network_packages np on np.id = npv.package_id
      join public.workspace_members wm on wm.workspace_id = np.workspace_id
      where npv.id = network_corridors.package_version_id
        and wm.user_id = auth.uid()
    )
  );

create policy "network_corridors_update" on public.network_corridors
  for update using (
    exists (
      select 1 from public.network_package_versions npv
      join public.network_packages np on np.id = npv.package_id
      join public.workspace_members wm on wm.workspace_id = np.workspace_id
      where npv.id = network_corridors.package_version_id
        and wm.user_id = auth.uid()
    )
  );

create policy "network_corridors_delete" on public.network_corridors
  for delete using (
    exists (
      select 1 from public.network_package_versions npv
      join public.network_packages np on np.id = npv.package_id
      join public.workspace_members wm on wm.workspace_id = np.workspace_id
      where npv.id = network_corridors.package_version_id
        and wm.user_id = auth.uid()
    )
  );

-- network_connectors RLS
alter table public.network_connectors enable row level security;

create policy "network_connectors_select" on public.network_connectors
  for select using (
    exists (
      select 1 from public.network_package_versions npv
      join public.network_packages np on np.id = npv.package_id
      join public.workspace_members wm on wm.workspace_id = np.workspace_id
      where npv.id = network_connectors.package_version_id
        and wm.user_id = auth.uid()
    )
  );

create policy "network_connectors_insert" on public.network_connectors
  for insert with check (
    exists (
      select 1 from public.network_package_versions npv
      join public.network_packages np on np.id = npv.package_id
      join public.workspace_members wm on wm.workspace_id = np.workspace_id
      where npv.id = network_connectors.package_version_id
        and wm.user_id = auth.uid()
    )
  );

create policy "network_connectors_update" on public.network_connectors
  for update using (
    exists (
      select 1 from public.network_package_versions npv
      join public.network_packages np on np.id = npv.package_id
      join public.workspace_members wm on wm.workspace_id = np.workspace_id
      where npv.id = network_connectors.package_version_id
        and wm.user_id = auth.uid()
    )
  );

create policy "network_connectors_delete" on public.network_connectors
  for delete using (
    exists (
      select 1 from public.network_package_versions npv
      join public.network_packages np on np.id = npv.package_id
      join public.workspace_members wm on wm.workspace_id = np.workspace_id
      where npv.id = network_connectors.package_version_id
        and wm.user_id = auth.uid()
    )
  );
