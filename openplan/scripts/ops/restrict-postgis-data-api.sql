-- Optional hosted Data API boundary for PostGIS installed in public.
-- Managed Supabase owns spatial_ref_sys as supabase_admin. Ordinary postgres
-- cannot revoke its grants. This blocks API writes, not direct SQL privileges.
-- OpenPlan uses REST, not GraphQL. Block client GraphQL to prevent a second
-- catalog write path. Application tables retain their existing grants and RLS.
-- Do not replace another installation's pre-request hook without integrating it.
begin;
do $$
declare
  existing_hook text;
begin
  select split_part(setting, '=', 2) into existing_hook
  from pg_roles r, unnest(r.rolconfig) setting
  where r.rolname = 'authenticator' and setting like 'pgrst.db_pre_request=%';
  if coalesce(existing_hook, '') not in ('', 'public.openplan_check_data_api_request') then
    raise exception 'Another Data API pre-request hook is installed: %', existing_hook;
  end if;
end;
$$;

create or replace function public.openplan_check_data_api_request()
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  route text := ltrim(coalesce(current_setting('request.path', true), ''), '/');
  method text := upper(coalesce(current_setting('request.method', true), ''));
begin
  if current_user not in ('anon', 'authenticated') then
    return;
  end if;
  if (route = 'spatial_ref_sys' and method not in ('GET', 'HEAD'))
     or route in ('rpc/graphql', 'rpc/st_estimatedextent') then
    raise sqlstate '42501' using message = 'This PostGIS administration API is restricted.';
  end if;
end;
$$;
revoke all on function public.openplan_check_data_api_request() from public;
grant execute on function public.openplan_check_data_api_request()
  to anon, authenticated, service_role;
alter role authenticator set pgrst.db_pre_request = 'public.openplan_check_data_api_request';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
