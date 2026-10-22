-- Temporary helpers inspect only explicitly supplied owned fixture calls.
CREATE FUNCTION pg_temp.assert_true(value pg_catalog.bool, label pg_catalog.text) RETURNS pg_catalog.void
LANGUAGE plpgsql AS $$ BEGIN IF value IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'a0-assert:%',label USING ERRCODE='P0001'; END IF; END $$;
CREATE FUNCTION pg_temp.expect_state(statement pg_catalog.text, expected pg_catalog.text, label pg_catalog.text) RETURNS pg_catalog.void
LANGUAGE plpgsql AS $$
DECLARE observed pg_catalog.text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE; END;
  IF observed IS DISTINCT FROM expected THEN RAISE EXCEPTION 'a0-expect-state:%:%',label,coalesce(observed,'accepted') USING ERRCODE='P0001'; END IF;
END $$;
