-- Run only after restrict-postgis-data-api.sql on an explicitly selected host.
-- This verifies hook behavior without writing catalog or application records.
-- It does not prove PostgREST activation. Also probe the real REST/GraphQL APIs.
begin;
set local role anon;
do $$
declare
  path text;
  verb text;
  denied boolean;
begin
  foreach path in array array['/spatial_ref_sys', '/rpc/graphql', '/rpc/st_estimatedextent'] loop
    foreach verb in array array['POST', 'PATCH', 'DELETE'] loop
      perform set_config('request.path', path, true);
      perform set_config('request.method', verb, true);
      denied := false;
      begin
        perform public.openplan_check_data_api_request();
      exception when insufficient_privilege then
        if sqlerrm <> 'This PostGIS administration API is restricted.' then raise; end if;
        denied := true;
      end;
      if not denied then raise exception 'Catalog API guard allowed % % as %', verb, path, current_user; end if;
    end loop;
  end loop;
  perform set_config('request.path', '/spatial_ref_sys', true);
  foreach verb in array array['GET', 'HEAD'] loop
    perform set_config('request.method', verb, true);
    perform public.openplan_check_data_api_request();
  end loop;
  perform set_config('request.path', '/projects', true);
  perform set_config('request.method', 'POST', true);
  perform public.openplan_check_data_api_request();
end $$;
set local role authenticated;
select set_config('request.path', '/spatial_ref_sys', true), set_config('request.method', 'PATCH', true);
do $$ begin
  begin
    perform public.openplan_check_data_api_request();
    raise exception 'Catalog API guard allowed authenticated PATCH';
  exception when insufficient_privilege then
    if sqlerrm <> 'This PostGIS administration API is restricted.' then raise; end if;
  end;
end $$;
set local role service_role;
select public.openplan_check_data_api_request();
rollback;
