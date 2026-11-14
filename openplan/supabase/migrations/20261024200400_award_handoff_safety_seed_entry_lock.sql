-- 20261018000003 composed the award handoff entry mutex into apply_ss4a_safety_seed.
-- 20261023190100 later replaced that function body, which dropped the mutex on every
-- installation that applied the two in version order. Restore the same first
-- statement without restating the body. Installations that applied 20261018000003
-- after 20261023190100 already carry it, so this block leaves them unchanged.
DO $compose$
DECLARE f record; body text; definition text; seen boolean:=false;
BEGIN
 FOR f IN SELECT p.oid,p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
  WHERE n.nspname='public' AND p.proname='apply_ss4a_safety_seed' AND l.lanname='plpgsql' LOOP
  seen:=true;
  CONTINUE WHEN f.prosrc ~* 'BEGIN[[:space:]]+PERFORM pg_catalog.pg_advisory_xact_lock\(713,1\);';
  body:=regexp_replace(f.prosrc,'\mBEGIN\M',E'BEGIN\n PERFORM pg_catalog.pg_advisory_xact_lock(713,1); -- award handoff entry order','i');
  IF body=f.prosrc THEN RAISE EXCEPTION 'Cannot compose lock entry: apply_ss4a_safety_seed'; END IF;
  definition:=replace(pg_get_functiondef(f.oid),f.prosrc,body);
  EXECUTE definition;
 END LOOP;
 IF NOT seen THEN RAISE EXCEPTION 'Missing composed lock entry: apply_ss4a_safety_seed'; END IF;
END $compose$;
