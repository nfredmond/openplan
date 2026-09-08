DO $test$ DECLARE
 owner_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); other_project uuid:=gen_random_uuid(); client uuid:=gen_random_uuid(); engagement uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); document uuid:=gen_random_uuid(); task uuid:=gen_random_uuid(); task2 uuid:=gen_random_uuid(); deliverable uuid:=gen_random_uuid(); foreign_deliverable uuid:=gen_random_uuid(); baseline uuid:=gen_random_uuid(); entry uuid:=gen_random_uuid(); cost_rate uuid:=gen_random_uuid(); billing_rate uuid:=gen_random_uuid();
 c jsonb; result jsonb; again jsonb; state jsonb; original_hash text; report uuid; invoice uuid; n integer;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(owner_id,owner_id||'@example.test'),(member_id,member_id||'@example.test'),(outsider,outsider||'@example.test');
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic contract engineering',workspace::text);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,owner_id,'owner'),(workspace,member_id,'member');
 INSERT INTO public.projects(id,workspace_id,name) VALUES(project,workspace,'Synthetic assignment'),(other_project,workspace,'Other synthetic assignment');
 INSERT INTO public.invoicing_clients(id,workspace_id,name) VALUES(client,workspace,'Synthetic client');
 INSERT INTO public.invoicing_engagements(id,workspace_id,client_id,project_id,title) VALUES(engagement,workspace,client,project,'Synthetic planning contract');
 INSERT INTO public.invoicing_staff(id,workspace_id,name,user_id) VALUES(staff,workspace,'Synthetic staff',member_id);
 INSERT INTO public.project_deliverables(id,project_id,title) VALUES(deliverable,project,'Synthetic report'),(foreign_deliverable,other_project,'Other report');
 INSERT INTO public.kb_documents(id,workspace_id,uploaded_by,title,source_kind,checksum) VALUES(document,workspace,owner_id,'Synthetic agreement evidence','uploaded_pdf',repeat('a',64));
 c:=jsonb_build_object('kind','baseline','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',0,'content',jsonb_build_object('title','Synthetic original agreement','scope','Engineering only, no actual client spending','currency','USD','fee','1000.00','cost','500.00','hours','10.00','feeBasis','gross_fee','feeTerms','Synthetic ceiling applies before retention','sourceDocuments',jsonb_build_array(document),'approvalEvidence','','tasks',jsonb_build_array(jsonb_build_object('id',task,'title','Prepare draft','scope','Synthetic draft','fee','600.00','cost','300.00','hours','6.00','deadline','2026-10-01','deliverableId',deliverable,'staff',jsonb_build_array(jsonb_build_object('staffId',staff,'hours','6.00','cost','300.00'))),jsonb_build_object('id',task2,'title','Review','scope','Synthetic review','fee','400.00','cost','200.00','hours','4.00','deadline','2026-10-08','deliverableId',deliverable,'staff','[]'::jsonb))));
 -- TEST_BODY
END $test$;
