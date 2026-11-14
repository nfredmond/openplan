-- Pre-check 60 (window): live traffic and open award handoffs. Read-only and
-- informational; nothing here stops the window by itself.
-- Run right before the dry run (step 18), after the other pre-checks:
--   bash $KIT/kit.sh hosted $W read /work/prechecks/60-live-traffic-and-handoffs.sql
--
-- Review 27, N3: the install takes ACCESS EXCLUSIVE locks on the tables below
-- and waits at most 3 s for each. A transaction already open on one of them
-- makes the install wait, every new reader queues behind the install, and a
-- lock timeout or deadlock rolls the whole window back to 448. The first query
-- lists transactions open for more than 1 s that hold a lock on one of these
-- tables. If it returns rows, wait for them to finish and read it again before
-- the dry run. Query text is not selected.
SELECT a.pid, a.backend_type, a.state, a.wait_event_type,
       pg_catalog.date_trunc('second', pg_catalog.now() - a.xact_start) AS transaction_age,
       pg_catalog.string_agg(DISTINCT c.relname || ' ' || l.mode, ', ' ORDER BY c.relname || ' ' || l.mode) AS locks_held
FROM pg_catalog.pg_stat_activity a
JOIN pg_catalog.pg_locks l ON l.pid = a.pid AND l.granted
JOIN pg_catalog.pg_class c ON c.oid = l.relation
WHERE a.pid <> pg_catalog.pg_backend_pid()
  AND a.xact_start < pg_catalog.now() - interval '1 second'
  AND c.relnamespace = 'public'::regnamespace
  AND c.relname IN ('safety_crashes', 'safety_crash_ingests', 'safety_crash_parties',
                    'funding_opportunity_application_exports', 'client_invoices', 'client_invoice_line_items',
                    'project_rtp_cycle_links', 'projects', 'rtp_cycles')
GROUP BY a.pid, a.backend_type, a.state, a.wait_event_type, a.xact_start
ORDER BY transaction_age DESC;

-- Review 27, N1: award_handoff_state fingerprints every application export row
-- of the award's grant with to_jsonb, which includes the two columns file 4
-- adds. For these awards, a handoff preview that is open across the install
-- is refused once at apply ("Sources, outcomes or terms pointers changed;
-- review again") and must be previewed again. Stored revisions are not
-- rechecked. Awards with no grant linked yet name one at preview and are not
-- counted. Record the counts in the window notes.
SELECT pg_catalog.count(*) AS awards_whose_grant_has_an_export,
       pg_catalog.count(*) FILTER (WHERE fa.latest_handoff_revision_id IS NOT NULL) AS of_which_have_a_handoff_revision
FROM public.funding_awards fa
WHERE fa.funding_opportunity_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.funding_opportunity_application_exports e
               WHERE e.opportunity_id = fa.funding_opportunity_id);
