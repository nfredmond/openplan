-- Pre-checks for the award custody window (lane 89): 20261117000000,
-- 20261117000100 and 20261117000200. Read-only.
-- Run: bash $KIT/kit.sh hosted $W read /work/prechecks/10-award-custody.sql
--
-- Each check row prints check, expected, found and "pass". A check whose found
-- value differs from expected stops the read with
-- 'invalid input syntax for type integer: "PRE-CHECK FAILED ..."', so the
-- envelope reads read-failed and the window stops.
SELECT c.check_name, c.expected, c.found,
       CASE WHEN c.found IS NOT DISTINCT FROM c.expected THEN 'pass'
            ELSE ('PRE-CHECK FAILED ' || c.check_name || ': expected ' || c.expected || ', found ' || coalesce(c.found, 'NULL'))::integer::text
       END AS result
FROM (
  -- 1. History before the window: the November 14 window's end state.
  SELECT 'history before the window' AS check_name, '455 through 20261102140000' AS expected,
         (SELECT pg_catalog.count(*)::text || ' through ' || coalesce(pg_catalog.max(h.version), 'none')
            FROM supabase_migrations.schema_migrations h) AS found
  UNION ALL
  SELECT 'planned versions already present', '0',
         (SELECT pg_catalog.count(*)::text FROM supabase_migrations.schema_migrations h
           WHERE h.version IN ('20261117000000', '20261117000100', '20261117000200'))
  UNION ALL
  -- 2. The unique index on (funding_award_id, lower(invoice_number)) fails to
  --    build if any award already holds two requests with the same number in
  --    any case. Expected 0. If not 0, stop: list them with the informational
  --    query below and settle each pair before the window (the planner renames
  --    one, for example E-DUP to E-DUP-2); do not delete a request.
  SELECT '000200 awards holding a repeated request number', '0',
         (SELECT pg_catalog.count(*)::text FROM (
            SELECT r.funding_award_id FROM public.billing_invoice_records r
             WHERE r.funding_award_id IS NOT NULL
             GROUP BY r.funding_award_id, pg_catalog.lower(r.invoice_number)
            HAVING pg_catalog.count(*) > 1) d)
  UNION ALL
  -- 3. The constraint 000000 drops and adds back by name, and the shape it
  --    widens: three basis values today.
  SELECT '000000 closure basis CHECK present by name', '1',
         (SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_constraint con
           WHERE con.conrelid = 'public.funding_awards'::regclass AND con.conname = 'funding_awards_closure_basis_known')
  UNION ALL
  SELECT '000000 stored closure basis values outside the widened set', '0',
         (SELECT pg_catalog.count(*)::text FROM public.funding_awards a
           WHERE a.closure_basis IS NOT NULL
             AND a.closure_basis NOT IN ('earned_coverage', 'reconciled_with_balance', 'recorded_on_import', 'unrecorded_legacy'))
  UNION ALL
  -- 4. Nothing the three files create exists yet. A partial earlier attempt
  --    would make CREATE FUNCTION, CREATE TRIGGER or ADD CONSTRAINT fail.
  SELECT 'new columns already present', '0',
         (SELECT pg_catalog.count(*)::text FROM information_schema.columns col
           WHERE col.table_schema = 'public'
             AND ((col.table_name = 'funding_awards' AND col.column_name IN ('closure_released_amount', 'obligated_on'))
               OR (col.table_name = 'billing_invoice_records' AND col.column_name IN ('rejection_reason', 'resubmits_invoice_id', 'paid_date'))))
  UNION ALL
  SELECT 'new functions already present', '0',
         (SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN ('reimbursement_request_net', 'funding_award_closeout_command', 'guard_funding_award_closure', 'guard_reimbursement_request_status'))
  UNION ALL
  SELECT 'new triggers already present', '0',
         (SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_trigger t
           WHERE NOT t.tgisinternal AND t.tgname IN ('funding_award_closure_custody', 'reimbursement_request_status_custody'))
  UNION ALL
  SELECT 'new constraints or indexes already present', '0',
         (SELECT (
            (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint con
              WHERE con.conname IN ('funding_awards_released_amount_matches_basis', 'funding_awards_reconciled_closure_states_its_basis',
                                    'billing_invoice_records_paid_date_only_when_paid', 'billing_invoice_records_rejection_reason_when_rejected',
                                    'billing_invoice_records_resubmits_another'))
            + (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class cl
                WHERE cl.relname IN ('billing_invoice_records_one_resubmission', 'billing_invoice_records_award_number_unique'))
          )::text)
  UNION ALL
  -- 5. The managed guard's transaction setting is the one 000000 reuses.
  SELECT '000000 managed close-out still sets the closure command', 'true',
         (SELECT (pg_catalog.pg_get_functiondef('public.managed_award_closeout(uuid,uuid,uuid,text,text,text)'::regprocedure)
                  LIKE '%openplan.award_closure_command%')::text)
) c;

-- Informational: request numbers repeated on one award (should be empty; see
-- check 2). Planner-entered text; read it, do not paste it anywhere public.
SELECT r.funding_award_id, pg_catalog.lower(r.invoice_number) AS number_lowercase,
       pg_catalog.count(*) AS requests, pg_catalog.array_agg(r.status ORDER BY r.created_at) AS statuses
FROM public.billing_invoice_records r
WHERE r.funding_award_id IS NOT NULL
GROUP BY r.funding_award_id, pg_catalog.lower(r.invoice_number)
HAVING pg_catalog.count(*) > 1;

-- Informational: what the new rules will meet. None of these rows is changed
-- or refused at install; the triggers check changes only. They say what a
-- planner will see next:
--   paid_requests        paid requests recorded before the rules; they stay paid
--                        and print "Not recorded" for the payment date.
--   requests_past_draft  requests already beyond draft; they keep their status
--                        and from now on move forward only.
--   open_on_closed_award open requests on an award already closed; they block
--                        nothing until the award is reopened, and then block
--                        its next close-out until each is paid or rejected.
--   closed_unmanaged     ordinary closed awards; reopening and closing them now
--                        goes through the close-out command.
SELECT
  (SELECT pg_catalog.count(*) FROM public.billing_invoice_records r WHERE r.status = 'paid') AS paid_requests,
  (SELECT pg_catalog.count(*) FROM public.billing_invoice_records r WHERE r.status <> 'draft') AS requests_past_draft,
  (SELECT pg_catalog.count(*) FROM public.billing_invoice_records r
     JOIN public.funding_awards a ON a.id = r.funding_award_id
    WHERE a.spending_status = 'fully_spent'
      AND r.status IN ('draft', 'internal_review', 'submitted', 'approved_for_payment')) AS open_on_closed_award,
  (SELECT pg_catalog.count(*) FROM public.funding_awards a
    WHERE a.spending_status = 'fully_spent' AND a.latest_handoff_revision_id IS NULL) AS closed_unmanaged,
  (SELECT pg_catalog.count(*) FROM public.funding_awards a WHERE a.spending_status = 'fully_spent') AS closed_all;

-- Informational: the row format of the newest history rows (the November 14
-- window's seven files). Set the plan's historyStatements to the format these
-- rows share: whole-file (one element equal to the file text), statements
-- (the file split into statements, as the Supabase CLI writes them) or empty.
-- md5_whole_file is the md5 of each committed file's bytes on main.
SELECT h.version, h.name,
       coalesce(pg_catalog.array_length(h.statements, 1), 0) AS statement_count,
       CASE WHEN coalesce(pg_catalog.array_length(h.statements, 1), 0) = 0 THEN 'empty'
            WHEN pg_catalog.array_length(h.statements, 1) = 1 AND pg_catalog.md5(h.statements[1]) = f.md5_whole_file THEN 'whole-file'
            ELSE 'statements' END AS history_format
FROM supabase_migrations.schema_migrations h
LEFT JOIN (VALUES
  ('20261102100000', '5eafc3dd11c8aba78f5f830dc9a7b9c2'),
  ('20261102100100', '95415298a540f19bb9cdbf719e61caa0'),
  ('20261102110000', '2f3acadea2006516d9c18a5e7795fcf0'),
  ('20261102110100', '22cf56e0bb44fb390613685baca2ceec'),
  ('20261102120000', '038228278b762d1da2014fcee700c505'),
  ('20261102130000', '78f629bec71721be848d9ba5656a9f1b'),
  ('20261102140000', 'eccb9e917a6fad8a037bdd0c583fd868')
) AS f(version, md5_whole_file) ON f.version = h.version
WHERE h.version >= '20261102100000'
ORDER BY h.version;
