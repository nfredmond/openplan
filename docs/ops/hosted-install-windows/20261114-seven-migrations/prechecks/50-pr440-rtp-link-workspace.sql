-- Pre-checks for PR 440 (20261102140000 project_rtp_cycle_link_workspace_scope).
-- Read-only.
-- Run: bash $KIT/kit.sh hosted $W read /work/prechecks/50-pr440-rtp-link-workspace.sql
-- A differing check stops the read with "PRE-CHECK FAILED ..." (see 00-history.sql).
--
-- If a mismatch count is not 0, stop and list the rows read-only (link id, the
-- three workspace ids, horizon_band_id, evidence_model_run_id, created_by,
-- created_at, the cycle's public_share_enabled) with the same joins and a WHERE
-- on the mismatch. Treat each as a possible cross-workspace write and a
-- possible public disclosure. Do not delete or rewrite rows without a decision.
SELECT c.check_name, c.expected, c.found,
       CASE WHEN c.found IS NOT DISTINCT FROM c.expected THEN 'pass'
            ELSE ('PRE-CHECK FAILED ' || c.check_name || ': expected ' || c.expected || ', found ' || coalesce(c.found, 'NULL'))::integer::text
       END AS result
FROM (
  -- 1. Cross-workspace link rows, in the order project, cycle, band, run.
  SELECT '440-1 cross-workspace link rows (project,cycle,band,run)' AS check_name, '0,0,0,0' AS expected,
         (SELECT pg_catalog.count(*) FILTER (WHERE p.workspace_id <> l.workspace_id)::text || ',' ||
                 pg_catalog.count(*) FILTER (WHERE cy.workspace_id <> l.workspace_id)::text || ',' ||
                 pg_catalog.count(*) FILTER (WHERE b.id IS NOT NULL AND (b.rtp_cycle_id <> l.rtp_cycle_id OR b.workspace_id <> l.workspace_id))::text || ',' ||
                 pg_catalog.count(*) FILTER (WHERE r.id IS NOT NULL AND r.workspace_id <> l.workspace_id)::text
            FROM public.project_rtp_cycle_links l
            JOIN public.projects p ON p.id = l.project_id
            JOIN public.rtp_cycles cy ON cy.id = l.rtp_cycle_id
            LEFT JOIN public.rtp_horizon_bands b ON b.id = l.horizon_band_id
            LEFT JOIN public.model_runs r ON r.id = l.evidence_model_run_id) AS found
  UNION ALL
  -- 2. Name collisions.
  SELECT '440-2 guard function names taken', '0',
         (SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('guard_project_rtp_cycle_link_scope', 'guard_rtp_link_parent_workspace'))
  UNION ALL
  SELECT '440-2 guard trigger names taken', '0',
         (SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_trigger t
           WHERE t.tgname IN ('project_rtp_cycle_links_workspace_scope', 'projects_rtp_link_workspace', 'rtp_cycles_rtp_link_workspace'))
) c;

-- Informational: link rows on hosted.
SELECT pg_catalog.count(*) AS rtp_link_rows FROM public.project_rtp_cycle_links;
