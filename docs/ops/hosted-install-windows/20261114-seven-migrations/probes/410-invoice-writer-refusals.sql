-- Probe for PR 410 (20261102120000), rolled back. Run after the install:
--   bash $KIT/kit.sh hosted $W probe /work/probes/410-invoice-writer-refusals.sql
-- The kit replaces the final ROLLBACK with a raise and then rolls back.
--
-- The bodies of memberAndViewerRefusals and writersAllowed from
-- openplan/src/test/client-invoice-lifecycle-rls.test.ts, with synthetic users,
-- one workspace, two draft invoices and their lines. Each block switches to
-- the authenticated role with a request claim, as PostgREST does, and resets
-- it before the next actor.
--
-- This probe is the one that still writes to auth.users: the invoice policies
-- ask whether auth.uid() is an owner, admin, member or viewer in
-- workspace_members, and workspace_members.user_id references auth.users, so
-- the four roles need four user rows. (Probes 415 and 440 write none.) If the
-- role the kit connects as may not insert into auth.users, or may not switch
-- to authenticated or service_role, the probe reads PROBE SETUP FAILED.
--
-- Reading the result (the envelope reads probe-failed for every case but the
-- first; read its stderrTail):
--   probe-complete, notices "probe 410: member and viewer refused every draft
--     invoice and line write" and "probe 410: owner, admin and service role
--     allowed": the migration behaves as intended.
--   "PROBE SETUP FAILED, probe 410": the probe could not build its synthetic
--     users, workspace or invoices, or could not switch role. This says
--     nothing about the migration and is not a reason to roll back. Post-check
--     410 inside the install already proved the policies, the helper and row
--     security; the behavior stays covered by the live RLS test in CI.
--   "PROBE BLOCKED, probe 410": a lock held by live traffic ran past the lock
--     timeout. Run the probe again later. Not a reason to roll back.
--   "PROBE CHECK FAILED, probe 410": a refusal or an allowed write differs.
--     Stop and review (rollback is a separate decision).
-- Without the migration (448) the first block reads "PROBE CHECK FAILED,
-- probe 410: Member created a draft invoice".
DO $probe$
DECLARE
 owner_id uuid := pg_catalog.gen_random_uuid(); admin_id uuid := pg_catalog.gen_random_uuid(); member_id uuid := pg_catalog.gen_random_uuid();
 viewer_id uuid := pg_catalog.gen_random_uuid(); workspace uuid := pg_catalog.gen_random_uuid();
 client uuid := pg_catalog.gen_random_uuid(); engagement uuid := pg_catalog.gen_random_uuid(); project uuid := pg_catalog.gen_random_uuid();
 deliverable uuid := pg_catalog.gen_random_uuid(); staff uuid := pg_catalog.gen_random_uuid();
 invoice uuid := pg_catalog.gen_random_uuid(); other_invoice uuid := pg_catalog.gen_random_uuid();
 line_one uuid := pg_catalog.gen_random_uuid(); other_line uuid := pg_catalog.gen_random_uuid();
 entry_one uuid := pg_catalog.gen_random_uuid(); entry_two uuid := pg_catalog.gen_random_uuid(); entry_three uuid := pg_catalog.gen_random_uuid();
 lines jsonb; n integer; before jsonb; who text; actor uuid;
BEGIN
 BEGIN
   INSERT INTO auth.users(id,email) VALUES(owner_id,owner_id||'@example.test'),(admin_id,admin_id||'@example.test'),(member_id,member_id||'@example.test'),(viewer_id,viewer_id||'@example.test');
   INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic receivables',workspace::text);
   INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,owner_id,'owner'),(workspace,admin_id,'admin'),(workspace,member_id,'member'),(workspace,viewer_id,'viewer');
   INSERT INTO public.projects(id,workspace_id,name) VALUES(project,workspace,'Synthetic corridor study');
   INSERT INTO public.project_deliverables(id,project_id,title) VALUES(deliverable,project,'Synthetic draft report');
   INSERT INTO public.invoicing_clients(id,workspace_id,name) VALUES(client,workspace,'Synthetic client, not a real agency');
   INSERT INTO public.invoicing_engagements(id,workspace_id,client_id,project_id,title) VALUES(engagement,workspace,client,project,'Synthetic on-call contract');
   INSERT INTO public.invoicing_staff(id,workspace_id,name) VALUES(staff,workspace,'Synthetic planner');
   INSERT INTO public.invoicing_time_entries(id,workspace_id,staff_id,engagement_id,entry_date,hours) VALUES(entry_one,workspace,staff,engagement,'2026-09-01',2),(entry_two,workspace,staff,engagement,'2026-09-02',1),(entry_three,workspace,staff,engagement,'2026-09-03',1);
   INSERT INTO public.client_invoices(id,workspace_id,client_id,engagement_id,project_id,invoice_number,status,subtotal_amount,total_amount) VALUES(invoice,workspace,client,engagement,project,'SYNTH-001','draft',100,100),(other_invoice,workspace,client,engagement,project,'SYNTH-002','draft',50,50);
   INSERT INTO public.client_invoice_line_items(id,invoice_id,position,description,amount,deliverable_id) VALUES(line_one,invoice,0,'Original line',100,deliverable),(other_line,other_invoice,0,'Other invoice line',50,NULL);
   UPDATE public.invoicing_time_entries SET billed_line_item_id=line_one WHERE id=entry_one;
   UPDATE public.invoicing_time_entries SET billed_line_item_id=other_line WHERE id=entry_three;
   lines:=pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('description','Revised work, September 1','quantity',2,'unit_label','hours','unit_amount',100,'amount',200,'deliverable_id',deliverable,'milestone_id',NULL,'source_time_entry_ids',pg_catalog.jsonb_build_array(entry_one)),
    pg_catalog.jsonb_build_object('description','Revised work, September 2','quantity',NULL,'unit_label',NULL,'unit_amount',NULL,'amount',100,'deliverable_id',NULL,'milestone_id',NULL,'source_time_entry_ids',pg_catalog.jsonb_build_array(entry_two)));
   SELECT pg_catalog.jsonb_build_object('invoices',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) ORDER BY i.id) FROM public.client_invoices i WHERE i.workspace_id=workspace),'lines',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l) ORDER BY l.id) FROM public.client_invoice_line_items l JOIN public.client_invoices i ON i.id=l.invoice_id WHERE i.workspace_id=workspace)) INTO before;
   -- The role switches the checks use, tried here so a refused switch reads as setup.
   EXECUTE 'SET LOCAL ROLE authenticated'; EXECUTE 'RESET ROLE';
   EXECUTE 'SET LOCAL ROLE service_role'; EXECUTE 'RESET ROLE';
 EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'PROBE SETUP FAILED, probe 410 (synthetic users, rows or role switches could not be set up; says nothing about the migration; not a reason to roll back): % (SQLSTATE %)', SQLERRM, SQLSTATE;
 END;

 BEGIN
   -- A member and a viewer may read invoices but may not write a draft or its lines.
   FOREACH who IN ARRAY ARRAY['Member','Viewer'] LOOP
    actor := CASE who WHEN 'Member' THEN member_id ELSE viewer_id END;
    PERFORM pg_catalog.set_config('request.jwt.claim.sub',actor::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN INSERT INTO public.client_invoices(workspace_id,client_id,engagement_id,project_id,invoice_number,status) VALUES(workspace,client,engagement,project,'SYNTH-'||who,'draft'); RAISE EXCEPTION '% created a draft invoice', who; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    UPDATE public.client_invoices SET notes=who||' note',total_amount=1 WHERE id=invoice; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION '% edited a draft invoice', who; END IF;
    UPDATE public.client_invoices SET status='void' WHERE id=invoice; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION '% voided a draft invoice', who; END IF;
    DELETE FROM public.client_invoices WHERE id=other_invoice; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION '% deleted a draft invoice', who; END IF;
    BEGIN INSERT INTO public.client_invoice_line_items(invoice_id,position,description,amount) VALUES(invoice,9,who||' line',1); RAISE EXCEPTION '% added a draft line', who; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    UPDATE public.client_invoice_line_items SET amount=1 WHERE id=line_one; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION '% repriced a draft line', who; END IF;
    DELETE FROM public.client_invoice_line_items WHERE invoice_id=invoice; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION '% deleted a draft line', who; END IF;
    BEGIN PERFORM public.replace_client_invoice_lines(invoice,lines,300,0,300); RAISE EXCEPTION '% replaced draft lines', who; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    IF (SELECT pg_catalog.count(*) FROM public.client_invoices WHERE workspace_id=workspace)<>2 THEN RAISE EXCEPTION '% cannot read the workspace invoices', who; END IF;
    EXECUTE 'RESET ROLE';
   END LOOP;
   IF (SELECT pg_catalog.jsonb_build_object('invoices',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) ORDER BY i.id) FROM public.client_invoices i WHERE i.workspace_id=workspace),'lines',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l) ORDER BY l.id) FROM public.client_invoice_line_items l JOIN public.client_invoices i ON i.id=l.invoice_id WHERE i.workspace_id=workspace)))<>before THEN
    RAISE EXCEPTION 'A refused draft write changed the stored invoice or lines';
   END IF;
 EXCEPTION
  WHEN lock_not_available OR deadlock_detected THEN
   RAISE EXCEPTION 'PROBE BLOCKED, probe 410 (live traffic held a lock; run again later; not a reason to roll back): % (SQLSTATE %)', SQLERRM, SQLSTATE;
  WHEN OTHERS THEN
   RAISE EXCEPTION 'PROBE CHECK FAILED, probe 410: % (SQLSTATE %)', SQLERRM, SQLSTATE;
 END;
 RAISE NOTICE 'probe 410: member and viewer refused every draft invoice and line write';
END
$probe$;
DO $probe$
DECLARE
 owner_id uuid := pg_catalog.gen_random_uuid(); admin_id uuid := pg_catalog.gen_random_uuid(); member_id uuid := pg_catalog.gen_random_uuid();
 viewer_id uuid := pg_catalog.gen_random_uuid(); workspace uuid := pg_catalog.gen_random_uuid();
 client uuid := pg_catalog.gen_random_uuid(); engagement uuid := pg_catalog.gen_random_uuid(); project uuid := pg_catalog.gen_random_uuid();
 deliverable uuid := pg_catalog.gen_random_uuid(); staff uuid := pg_catalog.gen_random_uuid();
 invoice uuid := pg_catalog.gen_random_uuid(); other_invoice uuid := pg_catalog.gen_random_uuid();
 line_one uuid := pg_catalog.gen_random_uuid(); other_line uuid := pg_catalog.gen_random_uuid();
 entry_one uuid := pg_catalog.gen_random_uuid(); entry_two uuid := pg_catalog.gen_random_uuid(); entry_three uuid := pg_catalog.gen_random_uuid();
 lines jsonb; n integer; created uuid;
BEGIN
 BEGIN
   INSERT INTO auth.users(id,email) VALUES(owner_id,owner_id||'@example.test'),(admin_id,admin_id||'@example.test'),(member_id,member_id||'@example.test'),(viewer_id,viewer_id||'@example.test');
   INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic receivables',workspace::text);
   INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,owner_id,'owner'),(workspace,admin_id,'admin'),(workspace,member_id,'member'),(workspace,viewer_id,'viewer');
   INSERT INTO public.projects(id,workspace_id,name) VALUES(project,workspace,'Synthetic corridor study');
   INSERT INTO public.project_deliverables(id,project_id,title) VALUES(deliverable,project,'Synthetic draft report');
   INSERT INTO public.invoicing_clients(id,workspace_id,name) VALUES(client,workspace,'Synthetic client, not a real agency');
   INSERT INTO public.invoicing_engagements(id,workspace_id,client_id,project_id,title) VALUES(engagement,workspace,client,project,'Synthetic on-call contract');
   INSERT INTO public.invoicing_staff(id,workspace_id,name) VALUES(staff,workspace,'Synthetic planner');
   INSERT INTO public.invoicing_time_entries(id,workspace_id,staff_id,engagement_id,entry_date,hours) VALUES(entry_one,workspace,staff,engagement,'2026-09-01',2),(entry_two,workspace,staff,engagement,'2026-09-02',1),(entry_three,workspace,staff,engagement,'2026-09-03',1);
   INSERT INTO public.client_invoices(id,workspace_id,client_id,engagement_id,project_id,invoice_number,status,subtotal_amount,total_amount) VALUES(invoice,workspace,client,engagement,project,'SYNTH-001','draft',100,100),(other_invoice,workspace,client,engagement,project,'SYNTH-002','draft',50,50);
   INSERT INTO public.client_invoice_line_items(id,invoice_id,position,description,amount,deliverable_id) VALUES(line_one,invoice,0,'Original line',100,deliverable),(other_line,other_invoice,0,'Other invoice line',50,NULL);
   UPDATE public.invoicing_time_entries SET billed_line_item_id=line_one WHERE id=entry_one;
   UPDATE public.invoicing_time_entries SET billed_line_item_id=other_line WHERE id=entry_three;
   lines:=pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('description','Revised work, September 1','quantity',2,'unit_label','hours','unit_amount',100,'amount',200,'deliverable_id',deliverable,'milestone_id',NULL,'source_time_entry_ids',pg_catalog.jsonb_build_array(entry_one)),
    pg_catalog.jsonb_build_object('description','Revised work, September 2','quantity',NULL,'unit_label',NULL,'unit_amount',NULL,'amount',100,'deliverable_id',NULL,'milestone_id',NULL,'source_time_entry_ids',pg_catalog.jsonb_build_array(entry_two)));
   -- The role switches the checks use, tried here so a refused switch reads as setup.
   EXECUTE 'SET LOCAL ROLE authenticated'; EXECUTE 'RESET ROLE';
   EXECUTE 'SET LOCAL ROLE service_role'; EXECUTE 'RESET ROLE';
 EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'PROBE SETUP FAILED, probe 410 (synthetic users, rows or role switches could not be set up; says nothing about the migration; not a reason to roll back): % (SQLSTATE %)', SQLERRM, SQLSTATE;
 END;

 BEGIN
   -- The owner, an admin and the create route's service-role rollback still write.
   PERFORM pg_catalog.set_config('request.jwt.claim.sub',admin_id::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
   BEGIN
    INSERT INTO public.client_invoices(workspace_id,client_id,engagement_id,project_id,invoice_number,status,subtotal_amount,total_amount,created_by) VALUES(workspace,client,engagement,project,'SYNTH-ADMIN','draft',40,40,admin_id) RETURNING id INTO created;
    INSERT INTO public.client_invoice_line_items(invoice_id,position,description,amount) VALUES(created,0,'Admin line',40);
   EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'Admin refused a draft the create route allows'; END;
   UPDATE public.client_invoices SET notes='Admin draft note',due_date='2026-10-01' WHERE id=invoice; GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Admin refused a draft edit'; END IF;
   UPDATE public.client_invoice_line_items SET amount=120 WHERE id=line_one; GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Admin refused a draft line edit'; END IF;
   DELETE FROM public.client_invoice_line_items WHERE invoice_id=created; GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Admin refused a draft line delete'; END IF;
   BEGIN SELECT pg_catalog.count(*) INTO n FROM public.replace_client_invoice_lines(invoice,lines,300,0,300); EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'Admin refused a line replacement'; END;
   IF n<>2 THEN RAISE EXCEPTION 'Admin line replacement incomplete'; END IF;
   UPDATE public.client_invoices SET status='void' WHERE id=other_invoice; GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Admin refused voiding a draft'; END IF;
   EXECUTE 'RESET ROLE';
   PERFORM pg_catalog.set_config('request.jwt.claim.sub',owner_id::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
   UPDATE public.client_invoices SET status='sent',sent_date='2026-09-05' WHERE id=invoice; GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Owner refused sending a draft'; END IF;
   EXECUTE 'RESET ROLE';
   EXECUTE 'SET LOCAL ROLE service_role';
   DELETE FROM public.client_invoices WHERE id=created; GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Service role refused the create route rollback delete'; END IF;
   EXECUTE 'RESET ROLE';
   PERFORM pg_catalog.set_config('request.jwt.claim.sub',member_id::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
   DELETE FROM public.projects WHERE id=project; GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Member project delete refused'; END IF;
   EXECUTE 'RESET ROLE';
   IF EXISTS(SELECT 1 FROM public.client_invoices WHERE workspace_id=workspace AND project_id IS NOT NULL) THEN RAISE EXCEPTION 'Deleted project kept on an invoice'; END IF;
   IF (SELECT ROW(status,total_amount) FROM public.client_invoices WHERE id=invoice)<>ROW('sent'::text,300::numeric) THEN RAISE EXCEPTION 'Allowed writes not stored'; END IF;
 EXCEPTION
  WHEN lock_not_available OR deadlock_detected THEN
   RAISE EXCEPTION 'PROBE BLOCKED, probe 410 (live traffic held a lock; run again later; not a reason to roll back): % (SQLSTATE %)', SQLERRM, SQLSTATE;
  WHEN OTHERS THEN
   RAISE EXCEPTION 'PROBE CHECK FAILED, probe 410: % (SQLSTATE %)', SQLERRM, SQLSTATE;
 END;
 RAISE NOTICE 'probe 410: owner, admin and service role allowed';
END
$probe$;
ROLLBACK;
