import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
const live = LIVE_RLS ? describe : describe.skip;
live("OWP reimbursement source custody and correction cycle", () => {
 let container: string;
 beforeAll(() => {
  if (!process.env.CI && !process.env.OPENPLAN_SUPABASE_WORKDIR) throw new Error("An explicitly identified disposable Supabase workdir is required");
  container = resolveLocalDbContainer();
 });
 function exercise(body: string, replacement = "", extraSource = "", progress = "Review remains") {
  const mutation = process.env.M2D3_SQL_REPLACEMENT;
  if (mutation) replacement = readFileSync(mutation, "utf8");
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], input: `BEGIN; ${replacement}
  DO $test$ DECLARE
  o uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); foreign_user uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); element uuid:=gen_random_uuid(); task uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); engagement uuid:=gen_random_uuid(); client uuid:=gen_random_uuid(); document uuid:=gen_random_uuid(); baseline uuid:=gen_random_uuid(); deliverable uuid:=gen_random_uuid(); expense_entry uuid:=gen_random_uuid(); expense public.work_program_actual_versions;
  r public.program_work_program_revisions; c jsonb; result jsonb; result2 jsonb; entry uuid:=gen_random_uuid(); period_id uuid:=gen_random_uuid(); rate_id uuid:=gen_random_uuid(); report_id uuid; before_hash text; cid uuid:=gen_random_uuid(); fund uuid:=gen_random_uuid(); match_fund uuid:=gen_random_uuid(); draft jsonb; original jsonb; packet_id uuid;
  BEGIN
   INSERT INTO auth.users(id,email) VALUES(o,o||'@example.test'),(m,m||'@example.test'),(foreign_user,foreign_user||'@example.test');
   INSERT INTO public.workspaces(id,name,slug) VALUES(w,'Synthetic OWP actuals',w::text);
   INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,o,'owner'),(w,m,'member');
   INSERT INTO public.projects(id,workspace_id,name) VALUES(project,w,'Synthetic OWP project');
   INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES(p,w,'Synthetic reporting, no real agency costs','other','Test');
   INSERT INTO public.invoicing_staff(id,workspace_id,name,user_id) VALUES(staff,w,'Synthetic staff',m);
   SELECT * INTO r FROM public.save_program_work_program_revision(p,o,0,gen_random_uuid(),jsonb_build_object('schemaVersion',1,'currency','USD','agency','Synthetic agency','periodStart','2026-07-01','periodEnd','2027-06-30','preparation',jsonb_build_object('funds',jsonb_build_array(jsonb_build_object('id',fund,'name','Synthetic fund','vintage','2026','periodStart','2026-07-01','periodEnd','2027-06-30'),jsonb_build_object('id',match_fund,'name','Synthetic local match','vintage','2026','periodStart','2026-07-01','periodEnd','2027-06-30'))),'elements',jsonb_build_array(jsonb_build_object('id',element,'projectId',project,'tasks',jsonb_build_array(jsonb_build_object('id',task))))));
   c:=jsonb_build_object('requestId',gen_random_uuid(),'entryId',entry,'expectedVersion',0,'revisionId',r.id,'kind','labor','status','draft','entryDate','2026-08-01','sourceKey','synthetic-source-1','sourceReference','Synthetic payroll reference','description','Synthetic time, not actual agency spending','staffId',staff,'projectId',project,'contractId',NULL,'hours','1.00','amount',NULL,'basis','unvalued','allocations',jsonb_build_array(jsonb_build_object('elementId',element,'taskId',task,'share',10000)));
   c:=c||jsonb_build_object('status','approved','basis','recorded','amount','12.35');
   PERFORM public.record_work_program_actual(p,o,c);
   ${extraSource}
   INSERT INTO public.program_work_program_events(program_id,workspace_id,sequence,revision_id,revision_hash,kind,actor_id,payload,evidence,request_id) VALUES(p,w,1,r.id,r.content_sha256,'adoption',o,'{}','[]',gen_random_uuid());
   PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','period','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',0,'name','Synthetic August','startsOn','2026-08-01','endsOn','2026-08-31','baselineId',r.id,'sourceCutoff',now(),'progress',jsonb_build_array(jsonb_build_object('elementId',element,'taskId',task,'asOf','2026-08-31','completed','Draft delivered; see synthetic source','outstanding','${progress}','remainingHours',NULL,'remainingCost',NULL,'estimateBasis','Unassessed pending review'))));
   PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',1,'note','Synthetic review'));
   result:=public.work_program_management_command(p,o,jsonb_build_object('kind','issue','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',2,'note','Synthetic issue'));
   report_id:=(result->>'reportId')::uuid;
   draft:=jsonb_build_object('reportId',report_id,'title','Synthetic reimbursement','authorityEvidence','Synthetic agreement and reviewed funding authority','formEvidence','Synthetic required packet review; no agency form claim','costs',jsonb_build_array(jsonb_build_object('actualVersionId',(SELECT id FROM public.work_program_actual_versions WHERE entry_id=entry),'eligibleAmount','12.35','eligibilityEvidence','Synthetic eligibility record','shares',jsonb_build_array(jsonb_build_object('fundId',fund,'amount','10.00','treatment','reimbursement','evidence','Synthetic agreement share'),jsonb_build_object('fundId',match_fund,'amount','2.35','treatment','match','evidence','Synthetic match review')))));
   c:=jsonb_build_object('kind','save','requestId',gen_random_uuid(),'claimId',cid,'expectedVersion',0,'draft',draft);
   ${body}
  END $test$;
  SELECT 'OWP_REPORT_ASSERTIONS_REACHED'; ROLLBACK;` });
 }
 const marker = (body: string, replacement = "", extraSource = "", progress = "Review remains") => expect(exercise(body, replacement, extraSource, progress)).toContain("OWP_REPORT_ASSERTIONS_REACHED");
 const save = "result:=public.work_program_reimbursement_command(p,o,c);";
 const review = "result:=public.work_program_reimbursement_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'claimId',cid,'expectedVersion',1,'note','Synthetic finance review')); packet_id:=(result->>'reportId')::uuid;";
 it("retains exact retries, eligibility, funding and immutable return-correction-resubmission", () => marker(`${save}
 original:=public.work_program_reimbursement_command(p,o,c);
 IF result<>original THEN RAISE EXCEPTION 'Retry changed result'; END IF;
 BEGIN PERFORM public.work_program_reimbursement_command(p,o,c||jsonb_build_object('draft',draft||'{"title":"Changed retry"}')); RAISE EXCEPTION 'Changed retry accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 ${review}
 SELECT snapshot INTO original FROM public.work_program_period_reports WHERE id=packet_id;
 IF original->'reimbursement'->>'totalCost'<>'12.35' OR original->'reimbursement'->>'reimbursementTotal'<>'10.00' OR original->'reimbursement'->>'matchTotal'<>'2.35' THEN RAISE EXCEPTION 'Funding totals wrong'; END IF;
 PERFORM public.work_program_reimbursement_command(p,o,jsonb_build_object('kind','submit','requestId',gen_random_uuid(),'claimId',cid,'expectedVersion',2,'note','Synthetic external receipt 001'));
 PERFORM public.work_program_reimbursement_command(p,o,jsonb_build_object('kind','return','requestId',gen_random_uuid(),'claimId',cid,'expectedVersion',3,'note','Synthetic reviewer requests revised eligible cost'));
 draft:=jsonb_set(jsonb_set(draft,'{costs,0,eligibleAmount}','"11.35"'),'{costs,0,shares,0,amount}','"9.00"');
 PERFORM public.work_program_reimbursement_command(p,o,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',4,'draft',draft));
 result:=public.work_program_reimbursement_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'claimId',cid,'expectedVersion',5,'note','Reviewed correction'));
 IF (SELECT snapshot FROM public.work_program_period_reports WHERE id=packet_id)<>original OR (SELECT corrects_report_id FROM public.work_program_period_reports WHERE id=(result->>'reportId')::uuid)<>packet_id THEN RAISE EXCEPTION 'Original packet overwritten'; END IF;
 IF (SELECT snapshot->'reimbursement'->>'reimbursementTotal' FROM public.work_program_period_reports WHERE id=(result->>'reportId')::uuid)<>'9.00' OR (SELECT count(*) FROM public.work_program_reimbursement_sources WHERE claim_id=cid)<>1 THEN RAISE EXCEPTION 'Correction duplicated cost'; END IF;
 PERFORM public.work_program_reimbursement_command(p,o,jsonb_build_object('kind','submit','requestId',gen_random_uuid(),'claimId',cid,'expectedVersion',6,'note','Synthetic external receipt 002'));
 PERFORM public.work_program_reimbursement_command(p,o,jsonb_build_object('kind','accept','requestId',gen_random_uuid(),'claimId',cid,'expectedVersion',7,'note','Synthetic reviewer acceptance'));
 IF (SELECT count(*) FROM public.work_program_reimbursement_events WHERE claim_id=cid)<>8 THEN RAISE EXCEPTION 'Receipt history missing'; END IF;
 BEGIN PERFORM public.work_program_reimbursement_command(p,o,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',8)); RAISE EXCEPTION 'Accepted packet rewritten'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 `));
 it("keeps return reservations and refuses a second packet for the same physical source", () => marker(`${save}${review}
 PERFORM public.work_program_reimbursement_command(p,o,jsonb_build_object('kind','return','requestId',gen_random_uuid(),'claimId',cid,'expectedVersion',2,'note','Synthetic return'));
 cid:=gen_random_uuid();
 PERFORM public.work_program_reimbursement_command(p,o,c||jsonb_build_object('requestId',gen_random_uuid(),'claimId',cid));
 BEGIN ${review} RAISE EXCEPTION 'Duplicate reimbursement accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN IF SQLERRM NOT LIKE 'Source cost is already reserved%' THEN RAISE; END IF; END;
 `));
 it("refuses missing authority and changed source versions", () => marker(`
 c:=c||jsonb_build_object('draft',draft||'{"authorityEvidence":""}'); ${save}
 BEGIN ${review} RAISE EXCEPTION 'Missing authority accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.work_program_reimbursement_command(p,o,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'draft',draft));
 SELECT detail INTO original FROM public.work_program_actual_versions WHERE entry_id=entry;
 PERFORM public.record_work_program_actual(p,o,original||jsonb_build_object('requestId',gen_random_uuid(),'entryId',entry,'expectedVersion',1,'amount','11.00','correctionNote','Synthetic correction'));
 BEGIN PERFORM public.work_program_reimbursement_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'claimId',cid,'expectedVersion',2,'note','Review')); RAISE EXCEPTION 'Stale cost accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN IF SQLERRM NOT LIKE 'Source cost changed%' THEN RAISE; END IF; END;
 `));
 it("rejects ineligible excess and unbalanced shares", () => marker(`
 draft:=jsonb_set(draft,'{costs,0,eligibleAmount}','"13.00"'); c:=c||jsonb_build_object('draft',draft); ${save}
 BEGIN ${review} RAISE EXCEPTION 'Excess eligibility accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Eligible cost exceeds%' THEN RAISE; END IF; END;
 draft:=jsonb_set(draft,'{costs,0,eligibleAmount}','"11.00"');
 PERFORM public.work_program_reimbursement_command(p,o,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'draft',draft));
 BEGIN PERFORM public.work_program_reimbursement_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'claimId',cid,'expectedVersion',2,'note','Review')); RAISE EXCEPTION 'Unbalanced shares accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Reimbursement and match%' THEN RAISE; END IF; END;
 `));
 it("rejects a foreign fund without creating reservations", () => marker(`
 draft:=jsonb_set(draft,'{costs,0,shares,0,fundId}',to_jsonb(gen_random_uuid())); c:=c||jsonb_build_object('draft',draft); ${save}
 BEGIN ${review} RAISE EXCEPTION 'Foreign fund accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Fund or vintage%' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.work_program_reimbursement_sources WHERE claim_id=cid) THEN RAISE EXCEPTION 'Failed review reserved costs'; END IF;
 `));
 it("denies nonfinance actors, direct reads and spoofed RPC calls", () => marker(`
 BEGIN PERFORM public.work_program_reimbursement_command(p,m,c); RAISE EXCEPTION 'Member wrote a packet'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 ${save}${review}
 PERFORM set_config('request.jwt.claim.sub',m::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.work_program_reimbursement_claims WHERE id=cid) OR EXISTS(SELECT 1 FROM public.work_program_reimbursement_sources WHERE claim_id=cid) OR EXISTS(SELECT 1 FROM public.work_program_reimbursement_events WHERE claim_id=cid) THEN RAISE EXCEPTION 'Private packet leaked'; END IF;
 BEGIN PERFORM public.work_program_reimbursement_command(p,o,c); RAISE EXCEPTION 'Spoofed RPC permitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 EXECUTE 'RESET ROLE';
 `));
 it("keeps management corrections linked to management reports after packet generation", () => marker(`${save}${review}
 PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','correct','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',3,'note','Correct management report'));
 PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',4,'note','Review management correction'));
 result:=public.work_program_management_command(p,o,jsonb_build_object('kind','issue','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',5,'note','Issue management correction'));
 IF (SELECT corrects_report_id FROM public.work_program_period_reports WHERE id=(result->>'reportId')::uuid)<>report_id THEN RAISE EXCEPTION 'Management correction points at reimbursement'; END IF;
 `));
 const contractSource = `
 INSERT INTO public.invoicing_clients(id,workspace_id,name) VALUES(client,w,'Synthetic client');
 INSERT INTO public.invoicing_engagements(id,workspace_id,client_id,project_id,title) VALUES(engagement,w,client,project,'Synthetic shared contract');
 INSERT INTO public.project_deliverables(id,project_id,title) VALUES(deliverable,project,'Synthetic reviewed draft');
 INSERT INTO public.kb_documents(id,workspace_id,uploaded_by,title,source_kind,checksum,storage_ref,status) VALUES(document,w,o,'Synthetic contract evidence','uploaded_pdf',repeat('a',64),'storage://kb-documents/'||w||'/'||document||'/synthetic.pdf','stored');
 PERFORM public.record_contract_command(engagement,o,jsonb_build_object('kind','baseline','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',0,'content',jsonb_build_object('title','Synthetic agreement','scope','Engineering only','currency','USD','fee','100.00','cost','100.00','hours','1.00','feeBasis','gross_fee','feeTerms','Synthetic ceiling','sourceDocuments',jsonb_build_array(document),'approvalEvidence','','tasks',jsonb_build_array(jsonb_build_object('id',task,'title','Draft','scope','Synthetic work','fee','100.00','cost','100.00','hours','1.00','deadline','2026-10-01','deliverableId',deliverable,'staff','[]'::jsonb)))));
 PERFORM public.record_contract_command(engagement,o,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',1,'approvalEvidence','Synthetic written authority'));
 PERFORM public.record_work_program_actual(p,o,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',expense_entry,'sourceKey','synthetic-shared-expense','kind','expense','staffId',NULL,'hours',NULL,'amount','25.00','contractId',engagement,'allocations',jsonb_build_array(jsonb_build_object('elementId',element,'taskId',task,'deliverableId',deliverable,'share',10000))));
 SELECT * INTO expense FROM public.work_program_actual_versions WHERE entry_id=expense_entry;
 PERFORM public.record_contract_command(engagement,o,jsonb_build_object('kind','actual','requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'expectedVersion',0,'sourceKey','synthetic-shared-expense','sourceReference','Same synthetic vendor charge','entryDate','2026-08-01','category','expense','status','approved','description','Shared source, not another expense','staffId',NULL,'hours',NULL,'amount','25.00','valuationBasis','recorded','rateId',NULL,'billable',false,'timeEntryId',NULL,'spendEntryId',expense.spend_entry_id,'owpVersionId',expense.id,'allocations',jsonb_build_array(jsonb_build_object('taskId',task,'deliverableId',deliverable,'share',10000)),'correctionNote','','openingBasis','','reconciliationNote',''));
 `;
 const includeContract = `draft:=jsonb_set(draft,'{costs}',(draft->'costs')||jsonb_build_array(jsonb_build_object('actualVersionId',expense.id,'eligibleAmount','25.00','eligibilityEvidence','Synthetic contract expense approved against agreement','shares',jsonb_build_array(jsonb_build_object('fundId',fund,'amount','20.00','treatment','reimbursement','evidence','Synthetic contract grant share'),jsonb_build_object('fundId',match_fund,'amount','5.00','treatment','match','evidence','Synthetic contract match'))))); c:=c||jsonb_build_object('draft',draft);`;
 it("links approved staff and shared M11 expense once with retained contract and deliverable evidence", () => marker(`${includeContract}${save}${review}
 SELECT snapshot INTO original FROM public.work_program_period_reports WHERE id=packet_id;
 IF original->'reimbursement'->>'totalCost'<>'37.35' OR original->'reimbursement'->>'reimbursementTotal'<>'30.00' OR original->'reimbursement'->>'matchTotal'<>'7.35' THEN RAISE EXCEPTION 'Shared contract cost counted incorrectly'; END IF;
 IF jsonb_array_length(original->'reimbursement'->'contractCosts')<>1 OR original->'reimbursement'->'contractCosts'->0->>'spend_entry_id'<>expense.spend_entry_id::text OR jsonb_array_length(original->'reimbursement'->'deliverables')<>1 THEN RAISE EXCEPTION 'Shared contract evidence missing'; END IF;
 IF (SELECT count(*) FROM public.project_spend_entries WHERE work_program_id=p)<>1 OR (SELECT count(*) FROM public.work_program_reimbursement_sources WHERE claim_id=cid)<>2 THEN RAISE EXCEPTION 'Shared physical source duplicated'; END IF;
 IF EXISTS(SELECT 1 FROM public.client_invoices WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Reimbursement created billing'; END IF;
 PERFORM public.enqueue_work_program_report(packet_id,'pdf',o);
 IF (SELECT title FROM public.kb_documents WHERE work_program_report_id=packet_id)<>'Reimbursement: Synthetic reimbursement v1' THEN RAISE EXCEPTION 'Packet document mislabeled'; END IF;
 `,"",contractSource));
 it("rejects a stale shared M11 valuation even after the OWP management report is reissued", () => marker(`${includeContract}
 PERFORM public.record_work_program_actual(p,o,expense.detail||jsonb_build_object('requestId',gen_random_uuid(),'entryId',expense_entry,'expectedVersion',1,'amount','24.00','correctionNote','Synthetic corrected vendor cost'));
 PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','correct','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',3,'note','Reissue after source correction'));
 PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',4,'note','Review corrected source'));
 result:=public.work_program_management_command(p,o,jsonb_build_object('kind','issue','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',5,'note','Issue corrected source'));
 draft:=jsonb_set(draft,'{reportId}',result->'reportId');
 draft:=jsonb_set(draft,'{costs,1,actualVersionId}',to_jsonb((SELECT id FROM public.work_program_actual_versions WHERE entry_id=expense_entry ORDER BY version DESC LIMIT 1)));
 draft:=jsonb_set(jsonb_set(draft,'{costs,1,eligibleAmount}','"24.00"'),'{costs,1,shares,0,amount}','"19.00"');
 c:=c||jsonb_build_object('draft',draft); ${save}
 BEGIN ${review} RAISE EXCEPTION 'Stale contract mapping accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN IF SQLERRM NOT LIKE 'Reconcile and approve%' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.work_program_reimbursement_sources WHERE claim_id=cid) THEN RAISE EXCEPTION 'Partial review reserved labor'; END IF;
 `,"",contractSource));
 it("requires remaining-work evidence and rolls back failed review reservations", () => marker(`${save}
 BEGIN ${review} RAISE EXCEPTION 'Incomplete progress accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Each cost needs dated progress%' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.work_program_reimbursement_sources WHERE claim_id=cid) THEN RAISE EXCEPTION 'Incomplete progress reserved cost'; END IF;
 `,"","",""));
 it("protects receipt and source history from mutation", () => marker(`${save}${review}
 BEGIN UPDATE public.work_program_reimbursement_events SET note='Changed' WHERE claim_id=cid; RAISE EXCEPTION 'Receipt history rewritten'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM public.work_program_reimbursement_sources WHERE claim_id=cid; RAISE EXCEPTION 'Source reservation removed'; EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',foreign_user::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.work_program_reimbursement_claims WHERE id=cid) THEN RAISE EXCEPTION 'Foreign workspace packet leaked'; END IF;
 EXECUTE 'RESET ROLE';
 `));

});
