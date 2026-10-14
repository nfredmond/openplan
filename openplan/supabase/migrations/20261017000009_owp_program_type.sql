-- Add the Overall Work Program type to programs.program_type.
--
-- The federal document is the Unified Planning Work Program (UPWP, 23 CFR
-- 450.308); California and several other states call it the Overall Work
-- Program (OWP). One value, 'owp_upwp', covers both.
--
-- The original CHECK was written inline on the column in
-- 20260315000022_programs_module.sql, so Postgres named it
-- programs_program_type_check. No later migration changes it. The guard below
-- stops the migration unless exactly that constraint, with exactly the six
-- original values, is the only CHECK on program_type. A renamed or already
-- widened constraint fails here instead of leaving two CHECKs behind.
--
-- No rows are rewritten. Every existing value stays allowed, so validation
-- cannot fail on existing data.
BEGIN;

DO $$
DECLARE
  v_count integer;
  v_name text;
  v_definition text;
BEGIN
  SELECT count(*), min(c.conname), min(pg_get_constraintdef(c.oid))
    INTO v_count, v_name, v_definition
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.programs'::regclass
    AND c.contype = 'c'
    AND a.attname = 'program_type';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected one CHECK on public.programs.program_type, found %', v_count;
  END IF;

  IF v_name <> 'programs_program_type_check' THEN
    RAISE EXCEPTION 'Expected programs_program_type_check, found %', v_name;
  END IF;

  IF v_definition <> 'CHECK ((program_type = ANY (ARRAY[''rtip''::text, ''stip''::text, ''itip''::text, ''tcep''::text, ''local_measure''::text, ''other''::text])))' THEN
    RAISE EXCEPTION 'programs_program_type_check is not the original six-value CHECK: %', v_definition;
  END IF;
END $$;

ALTER TABLE public.programs DROP CONSTRAINT programs_program_type_check;

ALTER TABLE public.programs
  ADD CONSTRAINT programs_program_type_check
  CHECK (program_type IN ('rtip', 'stip', 'itip', 'tcep', 'local_measure', 'owp_upwp', 'other')) NOT VALID;

ALTER TABLE public.programs VALIDATE CONSTRAINT programs_program_type_check;

COMMIT;
