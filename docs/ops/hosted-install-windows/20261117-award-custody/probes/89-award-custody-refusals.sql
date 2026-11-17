-- Probe for the award custody window (lane 89), rolled back. Run after the
-- install:
--   bash $KIT/kit.sh hosted $W probe /work/probes/89-award-custody-refusals.sql
-- The kit replaces the final ROLLBACK with a raise and then rolls back.
--
-- Synthetic users, one workspace, one project and three awards. Each block
-- switches role the way PostgREST does and resets before the next actor. The
-- live test openplan/src/test/award-reimbursement-custody-rls.test.ts covers
-- the same rules through the Data API itself.
--
-- Reading the result:
--   probe-complete, notices "probe 89: member and owner closing writes
--     refused", "probe 89: request rules hold" (including the money fixed
--     after draft) and "probe 89: close-out
--     command closes, reconciles and reopens": the migrations behave as
--     intended.
--   "PROBE SETUP FAILED, probe 89": the probe could not build its rows or
--     switch role. Says nothing about the migrations; not a reason to roll back.
--   "PROBE CHECK FAILED, probe 89: ...": a refusal or an allowed write differs.
--     Stop and review.
-- Without the migrations (455) the first block reads "PROBE CHECK FAILED,
-- probe 89: member closed an award by direct write".
DO $probe$
DECLARE
 owner_id uuid := pg_catalog.gen_random_uuid(); member_id uuid := pg_catalog.gen_random_uuid();
 workspace uuid := pg_catalog.gen_random_uuid(); project uuid := pg_catalog.gen_random_uuid();
 earned uuid := pg_catalog.gen_random_uuid(); under uuid := pg_catalog.gen_random_uuid(); probe_award uuid := pg_catalog.gen_random_uuid();
 paid_request uuid := pg_catalog.gen_random_uuid(); rejected uuid := pg_catalog.gen_random_uuid(); n integer; result jsonb;
 today date := (pg_catalog.now() AT TIME ZONE 'UTC')::date;
BEGIN
 BEGIN
   INSERT INTO auth.users(id,email) VALUES(owner_id,owner_id||'@example.test'),(member_id,member_id||'@example.test');
   INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic custody probe',workspace::text);
   INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,owner_id,'owner'),(workspace,member_id,'member');
   INSERT INTO public.projects(id,workspace_id,name) VALUES(project,workspace,'Synthetic corridor');
   INSERT INTO public.funding_awards(id,workspace_id,project_id,title,awarded_amount,spending_status) VALUES
    (probe_award,workspace,project,'Synthetic probe award',1000,'active'),
    (earned,workspace,project,'Synthetic earned award',1000,'active'),
    (under,workspace,project,'Synthetic under-ceiling award',1000,'active');
   EXECUTE 'SET LOCAL ROLE authenticated'; EXECUTE 'RESET ROLE';
   EXECUTE 'SET LOCAL ROLE service_role'; EXECUTE 'RESET ROLE';
 EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'PROBE SETUP FAILED, probe 89 (synthetic rows or role switches could not be set up; says nothing about the migrations; not a reason to roll back): % (SQLSTATE %)', SQLERRM, SQLSTATE;
 END;

 BEGIN
   -- KI-2026-11-16-134: the PATCH lane 84 sent, as a member and as an owner.
   PERFORM pg_catalog.set_config('request.jwt.claim.sub',member_id::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
   BEGIN UPDATE public.funding_awards SET spending_status='fully_spent',closure_basis='earned_coverage',closed_at=pg_catalog.now() WHERE id=probe_award;
     RAISE EXCEPTION 'member closed an award by direct write'; EXCEPTION WHEN check_violation THEN NULL; END;
   UPDATE public.funding_awards SET spending_status='delayed' WHERE id=probe_award; GET DIAGNOSTICS n=ROW_COUNT;
   IF n<>1 THEN RAISE EXCEPTION 'member could not make an ordinary status edit'; END IF;
   EXECUTE 'RESET ROLE';
   PERFORM pg_catalog.set_config('request.jwt.claim.sub',owner_id::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
   BEGIN UPDATE public.funding_awards SET spending_status='fully_spent',closure_basis='recorded_on_import',closure_note='Typed in' WHERE id=probe_award;
     RAISE EXCEPTION 'owner closed an award by direct write'; EXCEPTION WHEN check_violation THEN NULL; END;
   EXECUTE 'RESET ROLE';
   RAISE NOTICE 'probe 89: member and owner closing writes refused';

   -- KI-2026-11-16-137 and -135: request rules, as the owner.
   PERFORM pg_catalog.set_config('request.jwt.claim.sub',owner_id::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
   BEGIN INSERT INTO public.billing_invoice_records(workspace_id,project_id,funding_award_id,invoice_number,amount,status) VALUES(workspace,project,earned,'P-0',10,'paid');
     RAISE EXCEPTION 'request created as paid'; EXCEPTION WHEN check_violation THEN NULL; END;
   INSERT INTO public.billing_invoice_records(id,workspace_id,project_id,funding_award_id,invoice_number,amount) VALUES(paid_request,workspace,project,earned,'P-1',1000);
   BEGIN UPDATE public.billing_invoice_records SET status='paid',paid_date=today WHERE id=paid_request;
     RAISE EXCEPTION 'draft moved straight to paid'; EXCEPTION WHEN check_violation THEN NULL; END;
   UPDATE public.billing_invoice_records SET status='approved_for_payment' WHERE id=paid_request;
   BEGIN UPDATE public.billing_invoice_records SET status='paid' WHERE id=paid_request;
     RAISE EXCEPTION 'paid without a payment date'; EXCEPTION WHEN check_violation THEN NULL; END;
   UPDATE public.billing_invoice_records SET status='paid',paid_date=today WHERE id=paid_request;
   BEGIN UPDATE public.billing_invoice_records SET status='draft' WHERE id=paid_request;
     RAISE EXCEPTION 'paid request moved back'; EXCEPTION WHEN check_violation THEN NULL; END;
   -- Review 92: the money is fixed once a request leaves draft.
   BEGIN UPDATE public.billing_invoice_records SET amount=50000,net_amount=50000 WHERE id=paid_request;
     RAISE EXCEPTION 'owner changed a paid request''s amount'; EXCEPTION WHEN check_violation THEN NULL; END;
   INSERT INTO public.billing_invoice_records(id,workspace_id,project_id,funding_award_id,invoice_number,amount) VALUES(rejected,workspace,project,under,'R-1',100);
   UPDATE public.billing_invoice_records SET status='submitted' WHERE id=rejected;
   UPDATE public.billing_invoice_records SET status='rejected',rejection_reason='Synthetic return' WHERE id=rejected;
   INSERT INTO public.billing_invoice_records(workspace_id,project_id,funding_award_id,invoice_number,amount,resubmits_invoice_id) VALUES(workspace,project,under,'R-1A',100,rejected);
   BEGIN INSERT INTO public.billing_invoice_records(workspace_id,project_id,funding_award_id,invoice_number,amount) VALUES(workspace,project,under,'r-1a',100);
     RAISE EXCEPTION 'repeated request number accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
   EXECUTE 'RESET ROLE';
   RAISE NOTICE 'probe 89: request rules hold';

   -- KI-2026-11-16-130 and KL-2026-09-04-024: the product's close-out.
   EXECUTE 'SET LOCAL ROLE service_role';
   result := public.funding_award_closeout_command(member_id,earned,'earned_coverage',NULL,today,NULL);
   IF result->>'status' IS DISTINCT FROM 'closed' OR result->>'milestoneFiled' IS DISTINCT FROM 'true' THEN
     RAISE EXCEPTION 'earned close-out answered %', result; END IF;
   BEGIN PERFORM public.funding_award_closeout_command(member_id,under,'reconciled_with_balance','Synthetic',today,NULL);
     RAISE EXCEPTION 'closed with a request still open'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
   EXECUTE 'RESET ROLE';
   PERFORM pg_catalog.set_config('request.jwt.claim.sub',owner_id::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
   UPDATE public.billing_invoice_records SET status='submitted' WHERE funding_award_id=under AND invoice_number='R-1A';
   UPDATE public.billing_invoice_records SET status='rejected',rejection_reason='Synthetic second return' WHERE funding_award_id=under AND invoice_number='R-1A';
   EXECUTE 'RESET ROLE';
   EXECUTE 'SET LOCAL ROLE service_role';
   result := public.funding_award_closeout_command(member_id,under,'reconciled_with_balance','Synthetic: finished under budget',today,NULL);
   IF result->>'released' IS DISTINCT FROM '1000.00' THEN RAISE EXCEPTION 'reconciled close-out answered %', result; END IF;
   result := public.funding_award_closeout_command(owner_id,earned,'reopen','Synthetic reopen',today,'active');
   IF result->>'status' IS DISTINCT FROM 'reopened' THEN RAISE EXCEPTION 'reopen answered %', result; END IF;
   EXECUTE 'RESET ROLE';
   RAISE NOTICE 'probe 89: close-out command closes, reconciles and reopens';
 EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'PROBE CHECK FAILED, probe 89: % (SQLSTATE %)', SQLERRM, SQLSTATE;
 END;
END
$probe$;
ROLLBACK;
