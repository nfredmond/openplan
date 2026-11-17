-- Pre-check 60 (window): live traffic and open award handoffs. Read-only and
-- informational; nothing here stops the window by itself.
-- Run right before the dry run (kit README, Phase C step 18), after
-- 10-award-custody.sql:
--   bash $KIT/kit.sh hosted $W read /work/prechecks/60-live-traffic.sql
--
-- The install takes ACCESS EXCLUSIVE locks on funding_awards and
-- billing_invoice_records (ALTER TABLE) and a SHARE lock on
-- billing_invoice_records while two unique indexes build, waiting at most 1 s
-- for each. A transaction already open on one of them makes the install wait,
-- every new reader queues behind it, and a lock timeout rolls the whole window
-- back to 455. The first query lists transactions open for more than 1 s that
-- hold a lock on one of these tables. If it returns rows, wait for them to
-- finish and read it again before the dry run. Query text is not selected.
SELECT a.pid, a.backend_type, a.state, a.wait_event_type,
       pg_catalog.date_trunc('second', pg_catalog.now() - a.xact_start) AS transaction_age,
       pg_catalog.string_agg(DISTINCT c.relname || ' ' || l.mode, ', ' ORDER BY c.relname || ' ' || l.mode) AS locks_held
FROM pg_catalog.pg_stat_activity a
JOIN pg_catalog.pg_locks l ON l.pid = a.pid AND l.granted
JOIN pg_catalog.pg_class c ON c.oid = l.relation
WHERE a.pid <> pg_catalog.pg_backend_pid()
  AND a.xact_start < pg_catalog.now() - interval '1 second'
  AND c.relnamespace = 'public'::regnamespace
  AND c.relname IN ('funding_awards', 'billing_invoice_records')
GROUP BY a.pid, a.backend_type, a.state, a.wait_event_type, a.xact_start
ORDER BY transaction_age DESC;

-- award_handoff_state (20261024200100) fingerprints every request linked to
-- the award with to_jsonb, which includes the three columns file 2 adds. For
-- these awards, a handoff preview open across the install is refused once at
-- apply ("Sources, outcomes or terms pointers changed; review again") and must
-- be previewed again. Stored revisions are not rechecked. Record the counts in
-- the window notes.
SELECT pg_catalog.count(*) AS awards_with_linked_requests,
       pg_catalog.count(*) FILTER (WHERE fa.latest_handoff_revision_id IS NOT NULL) AS of_which_have_a_handoff_revision
FROM public.funding_awards fa
WHERE EXISTS (SELECT 1 FROM public.billing_invoice_records r WHERE r.funding_award_id = fa.id);
