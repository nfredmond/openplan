import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
const live = LIVE_RLS ? describe : describe.skip;
live("OWP saved reconciliation and carryover custody", () => {
 let container: string;
 beforeAll(() => {
  if (!process.env.CI && !process.env.OPENPLAN_SUPABASE_WORKDIR) throw new Error("An explicitly identified disposable Supabase workdir is required");
  container = resolveLocalDbContainer();
 });
 function exercise(body: string, replacement = "", extraSource = "", progress = "Review remains") {
  const mutation = process.env.M2D4_SQL_REPLACEMENT;
  if (mutation) replacement = readFileSync(mutation, "utf8");
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], input: `BEGIN; ${replacement}
  DO $test$ DECLARE
  o uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); foreign_user uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); element uuid:=gen_random_uuid(); task uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); engagement uuid:=gen_random_uuid(); client uuid:=gen_random_uuid(); document uuid:=gen_random_uuid(); baseline uuid:=gen_random_uuid(); deliverable uuid:=gen_random_uuid(); expense_entry uuid:=gen_random_uuid(); expense public.work_program_actual_versions;
  r public.program_work_program_revisions; c jsonb; result jsonb; result2 jsonb; entry uuid:=gen_random_uuid(); period_id uuid:=gen_random_uuid(); rate_id uuid:=gen_random_uuid(); report_id uuid; before_hash text; cid uuid:=gen_random_uuid(); fund uuid:=gen_random_uuid(); match_fund uuid:=gen_random_uuid(); draft jsonb; original jsonb; packet_id uuid;
  next_program uuid:=gen_random_uuid(); next_element uuid:=gen_random_uuid(); next_fund uuid:=gen_random_uuid(); next_revision public.program_work_program_revisions; payment uuid:=gen_random_uuid(); obligation uuid:=gen_random_uuid(); assessment jsonb; close_data jsonb; close_command jsonb; saved_id uuid; physical_count integer;
  BEGIN
   INSERT INTO auth.users(id,email) VALUES(o,o||'@example.test'),(m,m||'@example.test'),(foreign_user,foreign_user||'@example.test');
   INSERT INTO public.workspaces(id,name,slug) VALUES(w,'Synthetic OWP actuals',w::text);
   INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,o,'owner'),(w,m,'member');
   INSERT INTO public.projects(id,workspace_id,name) VALUES(project,w,'Synthetic OWP project');
   INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES(p,w,'Synthetic reporting, no real agency costs','other','Test');
   INSERT INTO public.invoicing_staff(id,workspace_id,name,user_id) VALUES(staff,w,'Synthetic staff',m);
   SELECT * INTO r FROM public.save_program_work_program_revision(p,o,0,gen_random_uuid(),jsonb_build_object('schemaVersion',1,'currency','USD','agency','Synthetic agency','periodStart','2026-07-01','periodEnd','2027-06-30','preparation',jsonb_build_object('funds',jsonb_build_array(jsonb_build_object('id',fund,'name','Synthetic fund','amount',100,'vintage','2026','periodStart','2026-07-01','periodEnd','2027-06-30'),jsonb_build_object('id',match_fund,'name','Synthetic local match','vintage','2026','periodStart','2026-07-01','periodEnd','2027-06-30'))),'elements',jsonb_build_array(jsonb_build_object('id',element,'projectId',project,'tasks',jsonb_build_array(jsonb_build_object('id',task))))));
   c:=jsonb_build_object('requestId',gen_random_uuid(),'entryId',entry,'expectedVersion',0,'revisionId',r.id,'kind','labor','status','draft','entryDate','2026-08-01','sourceKey','synthetic-source-1','sourceReference','Synthetic payroll reference','description','Synthetic time, not actual agency spending','staffId',staff,'projectId',project,'contractId',NULL,'hours','1.00','amount',NULL,'basis','unvalued','allocations',jsonb_build_array(jsonb_build_object('elementId',element,'taskId',task,'share',10000)));
   c:=c||jsonb_build_object('status','approved','basis','recorded','amount','12.35');
   PERFORM public.record_work_program_actual(p,o,c);
   PERFORM public.record_work_program_actual(p,o,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',obligation,'kind','commitment','sourceKey','synthetic-obligation','amount','40.00','hours',NULL,'staffId',NULL));
   ${extraSource}
   INSERT INTO public.program_work_program_events(program_id,workspace_id,sequence,revision_id,revision_hash,kind,actor_id,payload,evidence,request_id) VALUES(p,w,1,r.id,r.content_sha256,'adoption',o,'{}','[]',gen_random_uuid());
   PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','period','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',0,'name','Synthetic August','startsOn','2026-08-01','endsOn','2026-08-31','baselineId',r.id,'sourceCutoff',now(),'progress',jsonb_build_array(jsonb_build_object('elementId',element,'taskId',task,'asOf','2026-08-31','completed','Draft delivered; see synthetic source','outstanding','${progress}','remainingHours',NULL,'remainingCost',NULL,'estimateBasis','Unassessed pending review'))));
   PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',1,'note','Synthetic review'));
   result:=public.work_program_management_command(p,o,jsonb_build_object('kind','issue','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',2,'note','Synthetic issue'));
   report_id:=(result->>'reportId')::uuid;
   draft:=jsonb_build_object('reportId',report_id,'title','Synthetic reimbursement','authorityEvidence','Synthetic agreement and reviewed funding authority','formEvidence','Synthetic required packet review; no agency form claim','costs',jsonb_build_array(jsonb_build_object('actualVersionId',(SELECT id FROM public.work_program_actual_versions WHERE entry_id=entry),'eligibleAmount','12.35','eligibilityEvidence','Synthetic eligibility record','shares',jsonb_build_array(jsonb_build_object('fundId',fund,'amount','10.00','treatment','reimbursement','evidence','Synthetic agreement share'),jsonb_build_object('fundId',match_fund,'amount','2.35','treatment','match','evidence','Synthetic match review')))));
   c:=jsonb_build_object('kind','save','requestId',gen_random_uuid(),'claimId',cid,'expectedVersion',0,'draft',draft);
   PERFORM public.work_program_reimbursement_command(p,o,c);
   result:=public.work_program_reimbursement_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'claimId',cid,'expectedVersion',1,'note','Synthetic review'));
   packet_id:=(result->>'reportId')::uuid;
   PERFORM public.record_work_program_actual(p,o,(SELECT detail FROM public.work_program_actual_versions WHERE entry_id=entry)||jsonb_build_object('requestId',gen_random_uuid(),'entryId',payment,'kind','payment','sourceKey','synthetic-receipt','amount','7.00','hours',NULL,'staffId',NULL));
   INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES(next_program,w,'Synthetic overlapping successor','other','Next');
   SELECT * INTO next_revision FROM public.save_program_work_program_revision(next_program,o,0,gen_random_uuid(),jsonb_build_object('schemaVersion',1,'currency','USD','agency','Synthetic agency','periodStart','2027-01-01','periodEnd','2027-12-31','preparation',jsonb_build_object('funds',jsonb_build_array(jsonb_build_object('id',next_fund,'name','Carryover authority','kind','carryover','amount',30))),'elements',jsonb_build_array(jsonb_build_object('id',next_element,'title','Finish old work','tasks','[]'::jsonb))));
   INSERT INTO public.program_work_program_events(program_id,workspace_id,sequence,revision_id,revision_hash,kind,actor_id,payload,evidence,request_id) VALUES(next_program,w,1,next_revision.id,next_revision.content_sha256,'adoption',o,'{}','[]',gen_random_uuid());
   close_data:=public.read_work_program_closeout(p,o,report_id);
   assessment:=jsonb_build_object('registerEvidence','Synthetic register reviewed, unresolved claim remains with old cycle','claims',jsonb_build_array(jsonb_build_object('claimId',cid,'receipts',jsonb_build_array(jsonb_build_object('actualVersionId',(SELECT id FROM public.work_program_actual_versions WHERE entry_id=payment),'amount','7.00')),'refundDue','0.00','evidence','Synthetic bank receipt, remaining claim 3.00')),'commitments',jsonb_build_array(jsonb_build_object('actualVersionId',(SELECT id FROM public.work_program_actual_versions WHERE entry_id=obligation),'outstandingAmount','15.00','evidence','Synthetic release 25.00 and obligation 15.00')),'work',jsonb_build_array(jsonb_build_object('elementId',element,'disposition','carryover','successorRevisionId',next_revision.id,'successorElementId',next_element,'sourceFundId',fund,'successorFundId',next_fund,'amount','20.00','evidence','Synthetic board approval with funding condition review')));
   close_command:=jsonb_build_object('kind','save','requestId',gen_random_uuid(),'reportId',report_id,'expectedVersion',0,'sourceHash',close_data->>'sourceHash','assessment',assessment);
   SELECT count(*) INTO physical_count FROM public.work_program_actual_versions;
   ${body}
  END $test$;
  SELECT 'OWP_REPORT_ASSERTIONS_REACHED'; ROLLBACK;` });
 }
 const marker = (body: string, replacement = "", extraSource = "", progress = "Review remains") => expect(exercise(body, replacement, extraSource, progress)).toContain("OWP_REPORT_ASSERTIONS_REACHED");
 const save = "result:=public.work_program_closeout_command(p,o,close_command); saved_id:=(result->>'id')::uuid;";
 const approve = "result:=public.work_program_closeout_command(p,o,close_command-'assessment'||jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'expectedVersion',1,'note','Synthetic authority evidence'));";
 it("retains exact retries, overlapping baselines, open balances and source identity through approval and reopening", () => marker(`${save}
 original:=public.work_program_closeout_command(p,o,close_command);
 IF result<>original THEN RAISE EXCEPTION 'Retry changed result'; END IF;
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command||jsonb_build_object('assessment',assessment||'{"registerEvidence":"Changed retry"}')); RAISE EXCEPTION 'Changed retry accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN IF SQLERRM NOT LIKE 'Closeout retry differs%' THEN RAISE; END IF; END;
 ${approve}
 SELECT content INTO original FROM public.work_program_closeout_records WHERE version=2 AND program_id=p;
 IF original->'assessment'->'claims'->0->'receipts'->0->>'amount'<>'7.00' OR original->'assessment'->'commitments'->0->>'outstandingAmount'<>'15.00' OR original->'source'->'report'->'snapshot'->'baseline'->>'content_sha256'<>r.content_sha256 OR original->'source'->'successors'->0->>'content_sha256'<>next_revision.content_sha256 THEN RAISE EXCEPTION 'Reconciliation evidence changed'; END IF;
 IF original->'source'->'reimbursement'->'reports'->0->'snapshot'->'reimbursement'->>'reimbursementTotal'<>'10.00' THEN RAISE EXCEPTION 'Claim treated as settled'; END IF;
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',2)); RAISE EXCEPTION 'Approved record changed without reopening'; EXCEPTION WHEN SQLSTATE 'PT409' THEN IF SQLERRM NOT LIKE 'Reopen the approved%' THEN RAISE; END IF; END;
 PERFORM public.work_program_closeout_command(p,o,close_command-'assessment'||jsonb_build_object('kind','reopen','requestId',gen_random_uuid(),'expectedVersion',2,'note','Synthetic revised approval evidence'));
 PERFORM public.work_program_closeout_command(p,o,close_command||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',3,'assessment',jsonb_set(assessment,'{work,0,amount}','"19.00"')));
 IF (SELECT content FROM public.work_program_closeout_records WHERE version=2 AND program_id=p)<>original THEN RAISE EXCEPTION 'Approved original lost'; END IF;
 IF (SELECT count(*) FROM public.work_program_actual_versions)<>physical_count THEN RAISE EXCEPTION 'Carryover duplicated physical costs'; END IF;
 IF (SELECT count(*) FROM public.work_program_closeout_records WHERE program_id=p)<>4 THEN RAISE EXCEPTION 'History sequence lost'; END IF;
 `));
 it("refuses missing sources, unknown approval and stale source hashes", () => marker(`
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command||'{"sourceHash":"wrong"}'); RAISE EXCEPTION 'Changed sources accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN IF SQLERRM NOT LIKE 'Closeout sources changed%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command||jsonb_build_object('assessment',assessment||'{"claims":[]}')); RAISE EXCEPTION 'Missing claim accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Reconcile every%' THEN RAISE; END IF; END;
 close_command:=close_command||jsonb_build_object('assessment',jsonb_set(assessment,'{claims,0,refundDue}','null')); ${save}
 BEGIN ${approve} RAISE EXCEPTION 'Unknown refund approved'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Assess each current claim%' THEN RAISE; END IF; END;
 `));
 it("rejects duplicated payment allocations and foreign receipts", () => marker(`
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command||jsonb_build_object('assessment',jsonb_set(assessment,'{claims,0,receipts}',(assessment->'claims'->0->'receipts')||(assessment->'claims'->0->'receipts')))); RAISE EXCEPTION 'Duplicated receipt accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Receipt allocations exceed%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command||jsonb_build_object('assessment',jsonb_set(assessment,'{claims,0,receipts,0,actualVersionId}',to_jsonb(gen_random_uuid())))); RAISE EXCEPTION 'Foreign receipt accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Match a positive%' THEN RAISE; END IF; END;
 `));
 it("refuses foreign successors, unknown funding and excess funding totals", () => marker(`
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command||jsonb_build_object('assessment',jsonb_set(assessment,'{work,0,successorRevisionId}',to_jsonb(gen_random_uuid())))); RAISE EXCEPTION 'Foreign successor accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Carryover requires an adopted%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command||jsonb_build_object('assessment',jsonb_set(assessment,'{work,0,sourceFundId}',to_jsonb(gen_random_uuid())))); RAISE EXCEPTION 'Unknown fund accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Carryover source fund%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command||jsonb_build_object('assessment',jsonb_set(assessment,'{work,0,amount}','"31.00"'))); RAISE EXCEPTION 'Successor over-allocation accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Carryover exceeds the successor%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command||jsonb_build_object('assessment',jsonb_set(assessment,'{work,0,amount}','"101.00"'))); RAISE EXCEPTION 'Source over-allocation accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Carryover exceeds the source%' THEN RAISE; END IF; END;
 `));
 for (const [name, change] of [["different currency", '{"currency":"EUR"}'], ["earlier cycle", '{"periodStart":"2026-01-01"}']] as const) it(`excludes a successor with ${name}`, () => marker(`
 SELECT * INTO next_revision FROM public.save_program_work_program_revision(next_program,o,1,gen_random_uuid(),next_revision.content_json||'${change}');
 INSERT INTO public.program_work_program_events(program_id,workspace_id,sequence,revision_id,revision_hash,kind,actor_id,payload,evidence,request_id) VALUES(next_program,w,2,next_revision.id,next_revision.content_sha256,'adoption',o,'{}','[]',gen_random_uuid());
 close_data:=public.read_work_program_closeout(p,o,report_id);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(close_data->'source'->'successors')b WHERE b->>'id'=next_revision.id::text) THEN RAISE EXCEPTION 'Invalid successor offered'; END IF;
 close_command:=close_command||jsonb_build_object('sourceHash',close_data->>'sourceHash','assessment',jsonb_set(assessment,'{work,0,successorRevisionId}',to_jsonb(next_revision.id)));
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command); RAISE EXCEPTION 'Invalid successor accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Carryover requires an adopted%' THEN RAISE; END IF; END;
 `));
 it("refuses a payment valued under a different baseline currency", () => marker(`
 SELECT * INTO next_revision FROM public.save_program_work_program_revision(p,o,1,gen_random_uuid(),r.content_json||'{"currency":"EUR"}');
 SELECT detail INTO original FROM public.work_program_actual_versions WHERE entry_id=payment;
 PERFORM public.record_work_program_actual(p,o,original||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'revisionId',next_revision.id,'correctionNote','Synthetic changed currency baseline'));
 close_data:=public.read_work_program_closeout(p,o,report_id);
 assessment:=jsonb_set(assessment,'{claims,0,receipts,0,actualVersionId}',to_jsonb((SELECT id FROM public.work_program_actual_versions WHERE entry_id=payment ORDER BY version DESC LIMIT 1)));
 close_command:=close_command||jsonb_build_object('sourceHash',close_data->>'sourceHash','assessment',assessment);
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command); RAISE EXCEPTION 'Foreign currency payment matched'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Match a positive%' THEN RAISE; END IF; END;
 `));
 it("requires evidence and current retained costs before approval", () => marker(`${save}
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command-'assessment'||jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'expectedVersion',1,'note','')); RAISE EXCEPTION 'Empty approval accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Record the approval%' THEN RAISE; END IF; END;
 SELECT detail INTO original FROM public.work_program_actual_versions WHERE entry_id=entry;
 PERFORM public.record_work_program_actual(p,o,original||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'amount','11.00','correctionNote','Synthetic correction'));
 BEGIN ${approve} RAISE EXCEPTION 'Changed cost approved'; EXCEPTION WHEN SQLSTATE 'PT409' THEN IF SQLERRM NOT LIKE 'Closeout sources changed%' THEN RAISE; END IF; END;
 close_data:=public.read_work_program_closeout(p,o,report_id);
 close_command:=close_command||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'sourceHash',close_data->>'sourceHash'); ${save}
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command-'assessment'||jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'expectedVersion',2,'note','Synthetic review')); RAISE EXCEPTION 'Old report approved after source change'; EXCEPTION WHEN SQLSTATE 'PT409' THEN IF SQLERRM NOT LIKE 'Issue a current management%' THEN RAISE; END IF; END;
 `));
 it("enforces owner/admin access, scoped reads and immutable history", () => marker(`${save}
 BEGIN PERFORM public.read_work_program_closeout(p,m,report_id); RAISE EXCEPTION 'Member read private closeout'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.work_program_closeout_command(p,foreign_user,close_command); RAISE EXCEPTION 'Foreign actor wrote closeout'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.work_program_closeout_records SET state='approved' WHERE id=saved_id; RAISE EXCEPTION 'History mutated'; EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 IF EXISTS(SELECT 1 FROM public.work_program_closeout_records WHERE id=saved_id) THEN RAISE EXCEPTION 'RLS leaked member closeout'; END IF; RESET ROLE;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',o,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 IF NOT EXISTS(SELECT 1 FROM public.work_program_closeout_records WHERE id=saved_id) THEN RAISE EXCEPTION 'RLS hid owner control'; END IF;
 BEGIN PERFORM public.read_work_program_closeout(p,o,report_id); RAISE EXCEPTION 'Direct source reader granted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command); RAISE EXCEPTION 'Direct command granted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.work_program_closeout_records SELECT * FROM public.work_program_closeout_records; RAISE EXCEPTION 'Direct writes granted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; RESET ROLE;
 `));
 it("refuses malformed command envelopes and reconciliation lists", () => marker(`
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command-'kind'); RAISE EXCEPTION 'Missing command kind accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM<>'Invalid closeout command' THEN RAISE; END IF; END;
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command||jsonb_build_object('unused',repeat('x',1000000))); RAISE EXCEPTION 'Oversized command accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM<>'Invalid closeout command' THEN RAISE; END IF; END;
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command||'{"assessment":[]}'); RAISE EXCEPTION 'Invalid lists accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM<>'Complete the reconciliation lists' THEN RAISE; END IF; END;
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command||jsonb_build_object('assessment',jsonb_set(assessment,'{claims,0,receipts}','null'))); RAISE EXCEPTION 'Invalid receipts accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM<>'List the matched receipts' THEN RAISE; END IF; END;
 `));
 for (const [name, edit, message] of [
  ["duplicate claims", "jsonb_set(assessment,'{claims}',(assessment->'claims')||(assessment->'claims'))", "Reconciliation repeats a source"],
  ["foreign claim", "jsonb_set(assessment,'{claims,0,claimId}',to_jsonb(gen_random_uuid()))", "Claim is outside the retained baseline"],
  ["fractional refund cents", "jsonb_set(assessment,'{claims,0,refundDue}','\"0.001\"')", "Enter refunds in whole cents or leave unknown"],
  ["foreign commitment", "jsonb_set(assessment,'{commitments,0,actualVersionId}',to_jsonb(gen_random_uuid()))", "Commitment is outside the retained report"],
  ["excess commitment", "jsonb_set(assessment,'{commitments,0,outstandingAmount}','\"40.01\"')", "Outstanding commitment exceeds its recorded value"],
  ["foreign work", "jsonb_set(assessment,'{work,0,elementId}',to_jsonb(gen_random_uuid()))", "Select a retained work element and disposition"],
  ["unvalued carryover", "jsonb_set(assessment,'{work,0,amount}','null')", "Carryover requires an explicit amount in whole cents"],
  ["foreign successor fund", "jsonb_set(assessment,'{work,0,successorFundId}',to_jsonb(gen_random_uuid()))", "Select an assessed carryover fund in the adopted successor"],
  ["completed work carrying funds", "jsonb_set(assessment,'{work,0,disposition}','\"completed\"')", "Only carryover work may name a successor or amount"],
 ] as const) it(`refuses ${name}`, () => marker(`BEGIN PERFORM public.work_program_closeout_command(p,o,close_command||jsonb_build_object('assessment',${edit})); RAISE EXCEPTION 'Invalid assessment accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM<>'${message}' THEN RAISE; END IF; END;`));
 for (const [name, edit, message] of [
  ["unknown commitment", "jsonb_set(assessment,'{commitments,0,outstandingAmount}','null')", "Assess each commitment with evidence before approval"],
  ["missing work authority", "jsonb_set(assessment,'{work,0,evidence}','\"\"')", "Assess completion or carryover authority for each element before approval"],
  ["missing register evidence", "jsonb_set(assessment,'{registerEvidence}','\"\"')", "Record the register completeness and reconciliation evidence"],
 ] as const) it(`retains ${name} as draft but refuses approval`, () => marker(`close_command:=close_command||jsonb_build_object('assessment',${edit}); ${save} BEGIN ${approve} RAISE EXCEPTION 'Unknown assessment approved'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM<>'${message}' THEN RAISE; END IF; END;`));
 it("refuses stale versions and approval without a saved reconciliation", () => marker(`
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command||'{"expectedVersion":1}'); RAISE EXCEPTION 'Stale version accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN IF SQLERRM NOT LIKE 'Closeout changed%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command-'assessment'||jsonb_build_object('kind','approve','note','Synthetic')); RAISE EXCEPTION 'Unsaved approval accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN IF SQLERRM NOT LIKE 'Save a current%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.work_program_closeout_command(p,o,close_command-'assessment'||jsonb_build_object('kind','reopen','note','Synthetic')); RAISE EXCEPTION 'Unapproved reopen accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN IF SQLERRM NOT LIKE 'Reopen the current%' THEN RAISE; END IF; END;
 `));
 it("refuses withdrawn source adoption and foreign reports", () => marker(`${save}
 BEGIN PERFORM public.read_work_program_closeout(p,o,packet_id); RAISE EXCEPTION 'Reimbursement report accepted as management'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.read_work_program_closeout(next_program,o,report_id); RAISE EXCEPTION 'Foreign report accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 INSERT INTO public.program_work_program_events(program_id,workspace_id,sequence,revision_id,revision_hash,kind,actor_id,payload,evidence,request_id)
 SELECT p,w,2,r.id,r.content_sha256,'withdraw_authority',o,jsonb_build_object('targetEventId',id),'[]',gen_random_uuid() FROM public.program_work_program_events WHERE program_id=p AND kind='adoption';
 BEGIN ${approve} RAISE EXCEPTION 'Withdrawn adoption approved'; EXCEPTION WHEN SQLSTATE 'PT409' THEN IF SQLERRM NOT LIKE 'The retained baseline%' THEN RAISE; END IF; END;
 `));
 it("counts approved carryover across source cycles and successor amendments", () => marker(`
 original:=to_jsonb(next_revision.id);
 SELECT * INTO next_revision FROM public.save_program_work_program_revision(next_program,o,1,gen_random_uuid(),next_revision.content_json||'{"financialNotes":"Synthetic successor amendment"}');
 INSERT INTO public.program_work_program_events(program_id,workspace_id,sequence,revision_id,revision_hash,kind,actor_id,payload,evidence,request_id) VALUES(next_program,w,2,next_revision.id,next_revision.content_sha256,'adoption',o,'{}','[]',gen_random_uuid());
 close_data:=public.read_work_program_closeout(p,o,report_id);
 assessment:=jsonb_set(assessment,'{work,0,successorRevisionId}',to_jsonb(next_revision.id));
 close_command:=close_command||jsonb_build_object('sourceHash',close_data->>'sourceHash','assessment',assessment);
 ${save}
 DECLARE other_program uuid:=gen_random_uuid(); other_period uuid:=gen_random_uuid(); other_revision public.program_work_program_revisions; other_report uuid; other_data jsonb; other_command jsonb; BEGIN
 INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES(other_program,w,'Synthetic competing source','other','Other source');
 SELECT * INTO other_revision FROM public.save_program_work_program_revision(other_program,o,0,gen_random_uuid(),r.content_json);
 INSERT INTO public.program_work_program_events(program_id,workspace_id,sequence,revision_id,revision_hash,kind,actor_id,payload,evidence,request_id) VALUES(other_program,w,1,other_revision.id,other_revision.content_sha256,'adoption',o,'{}','[]',gen_random_uuid());
 PERFORM public.work_program_management_command(other_program,o,jsonb_build_object('kind','period','requestId',gen_random_uuid(),'periodId',other_period,'expectedVersion',0,'name','Other August','startsOn','2026-08-01','endsOn','2026-08-31','baselineId',other_revision.id,'sourceCutoff',now(),'progress','[]'::jsonb));
 PERFORM public.work_program_management_command(other_program,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'periodId',other_period,'expectedVersion',1,'note','Synthetic'));
 other_report:=(public.work_program_management_command(other_program,o,jsonb_build_object('kind','issue','requestId',gen_random_uuid(),'periodId',other_period,'expectedVersion',2,'note','Synthetic'))->>'reportId')::uuid;
 other_data:=public.read_work_program_closeout(other_program,o,other_report);
 other_command:=jsonb_build_object('kind','save','requestId',gen_random_uuid(),'reportId',other_report,'expectedVersion',0,'sourceHash',other_data->>'sourceHash','assessment',jsonb_set(jsonb_set(assessment||'{"claims":[],"commitments":[]}','{work,0,amount}','"15.00"'),'{work,0,successorRevisionId}',original));
 PERFORM public.work_program_closeout_command(other_program,o,other_command);
 PERFORM public.work_program_closeout_command(other_program,o,other_command-'assessment'||jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'expectedVersion',1,'note','Synthetic second source authority'));
 END;
 BEGIN ${approve} RAISE EXCEPTION 'Competing source over-allocated successor'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Carryover exceeds the successor%' THEN RAISE; END IF; END;
 close_command:=close_command||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'assessment',jsonb_set(assessment,'{work,0,amount}','"15.00"')); ${save}
 PERFORM public.work_program_closeout_command(p,o,close_command-'assessment'||jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'expectedVersion',2,'note','Exact combined ceiling, synthetic'));
 `));
});
