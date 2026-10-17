-- Execute in the same backend after ROLLBACK, then close that backend.
SELECT json_build_object('rollback',
  to_regclass('pg_temp.assistant_provider_turns') IS NULL AND
  to_regclass('pg_temp.assistant_provider_connections') IS NULL AND
  to_regclass('pg_temp.workspace_members') IS NULL AND
  to_regclass('pg_temp.projects') IS NULL AND
  to_regclass('pg_temp.a0_saved') IS NULL AND
  to_regtype('pg_temp.jsonb') IS NULL AND to_regtype('pg_temp.uuid') IS NULL AND
  to_regprocedure('pg_temp.assert_true(pg_catalog.bool,pg_catalog.text)') IS NULL AND
  to_regprocedure('pg_temp.expect_state(pg_catalog.text,pg_catalog.text,pg_catalog.text)') IS NULL);
