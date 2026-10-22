-- PREPARATION ONLY. Not a standalone runner or admission mechanism.
-- A NEW root-owned identity-bound wrapper must verify the actual disposable
-- container/stack, fresh fixture, SQL/source hashes and function-definition hashes
-- before opening this transaction. A manually supplied setting is insufficient.
-- The wrapper owns BEGIN, bounded lock/statement timeouts, fail-stop execution,
-- private token-hash custody and unconditional ROLLBACK plus post-rollback proof.
-- It supplies openplan.usage_limit_corrections_identity as a private JSON packet.
-- Do not run this fragment through the historical probe's synthetic=yes flag.
DO $$
DECLARE identity pg_catalog.jsonb; function_oid pg_catalog.oid; config pg_catalog.text[];
  definition_sha pg_catalog.text; function_name pg_catalog.text; target_role pg_catalog.text;
BEGIN
  IF txid_current_if_assigned() IS NULL THEN RAISE EXCEPTION 'Wrapper must assign its owned transaction first'; END IF;
  identity:=current_setting('openplan.usage_limit_corrections_identity',true)::pg_catalog.jsonb;
  IF identity IS NULL OR identity->>'lane' IS DISTINCT FROM 'a0-usage-limit-corrections-20261016'
    OR identity->>'databaseName' IS DISTINCT FROM current_database()
    OR identity->>'databaseOid' IS DISTINCT FROM (SELECT oid::text FROM pg_database WHERE datname=current_database())
    OR identity->>'serverAddress' IS DISTINCT FROM inet_server_addr()::text
    OR identity->>'serverPort' IS DISTINCT FROM inet_server_port()::text
    OR identity->>'sessionRole' IS DISTINCT FROM session_user::text
    OR identity->>'applicationName' IS DISTINCT FROM current_setting('application_name')
    OR coalesce(identity->>'wrapperReceiptSHA256','') !~ '^[a-f0-9]{64}$'
    OR coalesce(identity->>'sql18SHA256','') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'New wrapper identity packet does not match this connection';
  END IF;
  FOREACH function_name IN ARRAY ARRAY['finish_assistant_provider_turn','valid_assistant_native_limit_receipt'] LOOP
    function_oid:=CASE function_name
      WHEN 'finish_assistant_provider_turn' THEN 'public.finish_assistant_provider_turn(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text)'::regprocedure::oid
      ELSE 'public.valid_assistant_native_limit_receipt(jsonb,public.assistant_provider_turns)'::regprocedure::oid END;
    SELECT proconfig INTO STRICT config FROM pg_proc WHERE oid=function_oid;
    IF NOT EXISTS(SELECT 1 FROM unnest(config) setting WHERE regexp_replace(setting,'\s','','g')='search_path=pg_catalog,public,pg_temp') THEN
      RAISE EXCEPTION 'Installed function lost explicit temporary-schema ordering: %',function_name;
    END IF;
    definition_sha:=encode(extensions.digest(convert_to(pg_get_functiondef(function_oid),'UTF8'),'sha256'),'hex');
    IF definition_sha IS DISTINCT FROM identity->'functionDefinitionSHA256'->>function_name THEN
      RAISE EXCEPTION 'Installed definition differs from reviewed wrapper pin: %',function_name;
    END IF;
    IF has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR NOT has_function_privilege('service_role',function_oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Installed function execution grants differ: %',function_name;
    END IF;
  END LOOP;
  FOREACH target_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',target_role);
    BEGIN
      PERFORM public.valid_assistant_native_limit_receipt(NULL::pg_catalog.jsonb,NULL::public.assistant_provider_turns);
      RAISE EXCEPTION 'Role executed service-only validator: %',target_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      PERFORM public.finish_assistant_provider_turn(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
      RAISE EXCEPTION 'Role executed service-only finish: %',target_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    EXECUTE 'RESET ROLE';
  END LOOP;
END $$;

-- Use a fresh backend so these names exist before the functions first compile.
CREATE TEMP TABLE assistant_provider_turns(marker pg_catalog.int4) ON COMMIT DROP;
CREATE TEMP TABLE assistant_provider_connections(marker pg_catalog.int4) ON COMMIT DROP;
CREATE TEMP TABLE workspace_members(marker pg_catalog.int4) ON COMMIT DROP;
CREATE TEMP TABLE projects(marker pg_catalog.int4) ON COMMIT DROP;
CREATE DOMAIN pg_temp.jsonb AS pg_catalog.text;
CREATE DOMAIN pg_temp.uuid AS pg_catalog.text;

DO $$
DECLARE job public.assistant_provider_turns; identity pg_catalog.jsonb; receipt pg_catalog.jsonb;
  saved pg_catalog.jsonb; replay pg_catalog.jsonb;
BEGIN
  identity:=current_setting('openplan.usage_limit_corrections_identity')::pg_catalog.jsonb;
  SELECT * INTO STRICT job FROM public.assistant_provider_turns WHERE id=(identity->>'fixtureTurnId')::pg_catalog.uuid;
  IF job.state<>'running' OR job.provider<>'codex' OR job.lease_expires_at<=clock_timestamp()
    OR job.user_id::text IS DISTINCT FROM identity->>'fixtureUserId'
    OR job.workspace_id::text IS DISTINCT FROM identity->>'fixtureWorkspaceId'
    OR job.project_id::text IS DISTINCT FROM identity->>'fixtureProjectId'
    OR job.connection_id::text IS DISTINCT FROM identity->>'fixtureConnectionId'
    OR job.attempt_id::text IS DISTINCT FROM identity->>'fixtureAttemptId' THEN
    RAISE EXCEPTION 'New owned fixture identity differs';
  END IF;
  -- Unknown reset matches the currently supported generic Codex failure contract.
  receipt:=jsonb_build_object('schemaVersion',2,'outcome','limited','provider','codex','model',job.model_id,'authMode',job.auth_mode,
    'userId',job.user_id,'requestId',job.request_id,'workspaceId',job.workspace_id,'projectId',job.project_id,'connectionId',job.connection_id,
    'turnId',job.id,'attemptId',job.attempt_id,'packetHash',job.packet_hash,'nativeThreadId','synthetic-thread','nativeTurnId','synthetic-turn',
    'signal',jsonb_build_object('code','usageLimitExceeded','resetAtUnixSeconds',NULL,'resetSource',NULL));
  EXECUTE 'SET LOCAL ROLE service_role';
  IF NOT public.valid_assistant_native_limit_receipt(receipt,job) THEN RAISE EXCEPTION 'Shadow names changed validator behavior'; END IF;
  saved:=public.finish_assistant_provider_turn(job.id,job.attempt_id,NULL,job.connection_id,
    current_setting('openplan.usage_limit_corrections_token_hash'),NULL,receipt,'native_usage_limit');
  IF saved->>'state' IS DISTINCT FROM 'failed' OR saved->'provider_receipt' IS DISTINCT FROM receipt THEN
    RAISE EXCEPTION 'Shadow names changed finish retention';
  END IF;
  replay:=public.finish_assistant_provider_turn(job.id,job.attempt_id,NULL,job.connection_id,
    current_setting('openplan.usage_limit_corrections_token_hash'),NULL,receipt,'native_usage_limit');
  IF replay IS DISTINCT FROM saved THEN RAISE EXCEPTION 'Shadow-name exact replay changed'; END IF;
  EXECUTE 'RESET ROLE';
END $$;
-- No COMMIT. The identity-bound wrapper must roll back and prove original rows
-- and temporary objects are restored. This file has not run or been parsed by PG.
