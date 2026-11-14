-- Format example for a window's postchecks.sql (rehearsal only). The real file
-- carries each packet's post-checks rebased to the combined end state (review
-- 15, B4.3), written by the lane that owns the migration packets. Only DO and
-- SELECT statements are accepted. Each runs inside the install transaction
-- after the catalog check, so a failed check rolls the whole window back.
DO $check$
BEGIN
  IF pg_catalog.to_regprocedure('public.reserve_ai_usage(uuid,text[],integer,integer,text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'post-check: public.reserve_ai_usage is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                 WHERE t.tgrelid = 'public.project_rtp_cycle_links'::regclass
                   AND t.tgname = 'project_rtp_cycle_links_workspace_scope' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'post-check: the RTP link workspace trigger is missing';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid IN ('public.client_invoices'::regclass,
        'public.client_invoice_line_items'::regclass) AND p.polname LIKE '%invoice_writer%') <> 6 THEN
    RAISE EXCEPTION 'post-check: expected six invoice writer policies';
  END IF;
END
$check$;
