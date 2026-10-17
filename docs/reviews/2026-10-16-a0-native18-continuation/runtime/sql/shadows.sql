-- Fresh backend only. Create these before either candidate function compiles.
CREATE TEMP TABLE assistant_provider_turns(marker pg_catalog.int4) ON COMMIT DROP;
CREATE TEMP TABLE assistant_provider_connections(marker pg_catalog.int4) ON COMMIT DROP;
CREATE TEMP TABLE workspace_members(marker pg_catalog.int4) ON COMMIT DROP;
CREATE TEMP TABLE projects(marker pg_catalog.int4) ON COMMIT DROP;
CREATE DOMAIN pg_temp.jsonb AS pg_catalog.text;
CREATE DOMAIN pg_temp.uuid AS pg_catalog.text;
