-- Post-checks for the award custody window: three files, history 458.
-- Run inside the install transaction, after the three files. Only DO and
-- SELECT. A failed check raises, so the window rolls back and history stays 455.

DO $check$
DECLARE n bigint; newest text; def text;
BEGIN
  SELECT pg_catalog.count(*), pg_catalog.max(h.version) INTO n, newest FROM supabase_migrations.schema_migrations h;
  IF n <> 458 OR newest IS DISTINCT FROM '20261117000200' THEN
    RAISE EXCEPTION 'post-check history: expected 458 through 20261117000200, found % through %', n, newest;
  END IF;

  -- Columns, all nullable, none filled.
  SELECT pg_catalog.count(*) INTO n FROM information_schema.columns col
   WHERE col.table_schema = 'public' AND col.is_nullable = 'YES'
     AND ((col.table_name = 'funding_awards' AND col.column_name IN ('closure_released_amount', 'obligated_on'))
       OR (col.table_name = 'billing_invoice_records' AND col.column_name IN ('rejection_reason', 'resubmits_invoice_id', 'paid_date')));
  IF n <> 5 THEN RAISE EXCEPTION 'post-check columns: expected 5 nullable columns, found %', n; END IF;
  IF EXISTS (SELECT FROM public.funding_awards WHERE closure_released_amount IS NOT NULL OR obligated_on IS NOT NULL)
     OR EXISTS (SELECT FROM public.billing_invoice_records WHERE rejection_reason IS NOT NULL OR resubmits_invoice_id IS NOT NULL OR paid_date IS NOT NULL) THEN
    RAISE EXCEPTION 'post-check columns: a new column holds a value right after install';
  END IF;

  -- The widened vocabulary.
  SELECT pg_catalog.pg_get_constraintdef(con.oid) INTO def FROM pg_catalog.pg_constraint con
   WHERE con.conrelid = 'public.funding_awards'::regclass AND con.conname = 'funding_awards_closure_basis_known';
  IF def IS NULL OR def NOT LIKE '%reconciled_with_balance%' OR def NOT LIKE '%unrecorded_legacy%' THEN
    RAISE EXCEPTION 'post-check closure basis CHECK: %', coalesce(def, 'missing');
  END IF;

  -- Six new constraints (five named here, one foreign key), all validated.
  SELECT pg_catalog.count(*) INTO n FROM pg_catalog.pg_constraint con
   WHERE con.convalidated AND con.conname IN ('funding_awards_released_amount_matches_basis', 'funding_awards_reconciled_closure_states_its_basis',
         'billing_invoice_records_paid_date_only_when_paid', 'billing_invoice_records_rejection_reason_when_rejected',
         'billing_invoice_records_resubmits_another', 'billing_invoice_records_resubmits_invoice_id_fkey');
  IF n <> 6 THEN RAISE EXCEPTION 'post-check constraints: expected 6 validated, found %', n; END IF;

  -- Two unique partial indexes, valid.
  SELECT pg_catalog.count(*) INTO n FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
   WHERE i.indisunique AND i.indisvalid AND i.indpred IS NOT NULL
     AND c.relname IN ('billing_invoice_records_one_resubmission', 'billing_invoice_records_award_number_unique');
  IF n <> 2 THEN RAISE EXCEPTION 'post-check indexes: expected 2 valid unique partial indexes, found %', n; END IF;

  -- Two row triggers, BEFORE INSERT OR UPDATE, enabled.
  SELECT pg_catalog.count(*) INTO n FROM pg_catalog.pg_trigger t
   WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
     AND ((t.tgname = 'funding_award_closure_custody' AND t.tgrelid = 'public.funding_awards'::regclass)
       OR (t.tgname = 'reimbursement_request_status_custody' AND t.tgrelid = 'public.billing_invoice_records'::regclass))
     AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4 AND (t.tgtype & 16) = 16;
  IF n <> 2 THEN RAISE EXCEPTION 'post-check triggers: expected 2 enabled BEFORE INSERT OR UPDATE row triggers, found %', n; END IF;

  -- The close-out command: service role only, never the Data API roles.
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.funding_award_closeout_command(uuid,uuid,text,text,date,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.funding_award_closeout_command(uuid,uuid,text,text,date,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.funding_award_closeout_command(uuid,uuid,text,text,date,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-check close-out command privileges';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated', 'public.guard_funding_award_closure()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.guard_reimbursement_request_status()', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-check guard function privileges';
  END IF;
END
$check$;

SELECT 'award custody post-checks passed' AS result;
