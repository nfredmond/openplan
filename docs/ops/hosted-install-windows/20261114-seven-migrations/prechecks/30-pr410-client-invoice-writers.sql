-- Pre-checks for PR 410 (20261102120000 client_invoice_owner_admin_writes).
-- Read-only. The packet's BEGIN READ ONLY and ROLLBACK are left out: the kit's
-- read mode already runs one read-only transaction.
-- Run: bash $KIT/kit.sh hosted $W read /work/prechecks/30-pr410-client-invoice-writers.sql
-- A differing check stops the read with "PRE-CHECK FAILED ..." (see 00-history.sql).
SELECT c.check_name, c.expected, c.found,
       CASE WHEN c.found IS NOT DISTINCT FROM c.expected THEN 'pass'
            ELSE ('PRE-CHECK FAILED ' || c.check_name || ': expected ' || c.expected || ', found ' || coalesce(c.found, 'NULL'))::integer::text
       END AS result
FROM (
  SELECT '410 invoice writer policies absent' AS check_name, '0' AS expected,
         (SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_policies p WHERE p.policyname LIKE '%\_invoice\_writer\_%') AS found
  UNION ALL
  SELECT '410 workspace_member_can_write_invoices absent', '0',
         (SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_proc p WHERE p.proname = 'workspace_member_can_write_invoices')
) c;

-- Informational: invoices whose creator is not now an owner or admin. None is
-- rewritten. After the install only an owner or admin can change them, as the
-- route already required. Record the result in the window notes; a nonzero
-- draft count means a member created drafts through the Data API, or a
-- creator's role changed since. Re-run after the install: counts must match.
SELECT ci.status, coalesce(wm.role, 'not a current member') AS creator_role, pg_catalog.count(*) AS invoices,
       pg_catalog.sum((SELECT pg_catalog.count(*) FROM public.client_invoice_line_items l WHERE l.invoice_id = ci.id)) AS lines,
       pg_catalog.count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.contract_billing_sources s WHERE s.invoice_id = ci.id)) AS contract_billed
FROM public.client_invoices ci
LEFT JOIN public.workspace_members wm ON wm.workspace_id = ci.workspace_id AND wm.user_id = ci.created_by
WHERE coalesce(wm.role, '') NOT IN ('owner', 'admin')
GROUP BY 1, 2 ORDER BY 1, 2;
