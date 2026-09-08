import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
const setup = readFileSync("src/test/fixtures/contracts/setup.sql", "utf8");
const saveBaseline = `result:=public.record_contract_command(engagement,owner_id,c); PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',1,'approvalEvidence','Synthetic written authorization, no real authority'));`;
const time = `c:=jsonb_build_object('kind','actual','requestId',gen_random_uuid(),'entryId',entry,'expectedVersion',0,'sourceKey','synthetic-time','sourceReference','Synthetic timesheet','entryDate','2026-09-01','category','labor','status','draft','description','Synthetic draft effort','staffId',staff,'hours','1.01','amount',NULL,'valuationBasis','unvalued','rateId',NULL,'billable',true,'allocations',jsonb_build_array(jsonb_build_object('taskId',task,'deliverableId',deliverable,'share',3333),jsonb_build_object('taskId',task2,'deliverableId',deliverable,'share',6667)),'correctionNote','','openingBasis','','reconciliationNote','');`;
const approve = `c:=c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'status','approved','amount','12.47','valuationBasis','recorded','correctionNote','Synthetic reviewed valuation'); PERFORM public.record_contract_command(engagement,owner_id,c);`;
function exercise(body: string, replacement = "") {
 if (!process.env.CI && !process.env.OPENPLAN_SUPABASE_WORKDIR?.includes("contract-verification")) throw new Error("Explicit isolated contract-verification stack required");
 return execFileSync("docker", ["exec", "-i", resolveLocalDbContainer(), "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { encoding: "utf8", input: `BEGIN;${replacement}\n${setup.replace("-- TEST_BODY",body)} SELECT 'CONTRACT_ASSERTIONS_REACHED';ROLLBACK;`, stdio: ["pipe","pipe","pipe"] });
}
const marker = (body: string, replacement = "") => expect(exercise(body,replacement)).toContain("CONTRACT_ASSERTIONS_REACHED");
(LIVE_RLS ? describe : describe.skip)("contract database custody", () => {
 it("retains proposals, approved baselines, exact retries and private member time", () => marker(`${saveBaseline}
 again:=public.record_contract_command(engagement,owner_id,c); IF again<>result THEN RAISE EXCEPTION 'Retry changed baseline'; END IF;
 ${time} result:=public.record_contract_command(engagement,member_id,c); again:=public.record_contract_command(engagement,member_id,c);
 IF result<>again OR (SELECT count(*) FROM public.invoicing_time_entries WHERE engagement_id=engagement)<>1 THEN RAISE EXCEPTION 'Retry duplicated time'; END IF;
 ${approve}
 state:=public.read_contract_management(engagement,member_id);
 IF state->'actuals'->1->>'amount' IS NOT NULL OR state::text LIKE '%12.47%' OR state::text LIKE '%500.00%' THEN RAISE EXCEPTION 'Private cost leaked'; END IF;
 IF (SELECT sum((a->>'amount')::numeric) FROM public.contract_actual_versions v CROSS JOIN LATERAL jsonb_array_elements(v.allocations) a WHERE v.entry_id=entry AND version=2)<>12.47 THEN RAISE EXCEPTION 'Split cents lost'; END IF;
 IF (SELECT count(*) FROM public.contract_actual_versions WHERE entry_id=entry)<>2 THEN RAISE EXCEPTION 'History overwritten'; END IF;
 `));
 it("rejects foreign projects, unauthorized approval, missing rates and source duplicates", () => marker(`
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c); RAISE EXCEPTION 'Member approved baseline'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 ${saveBaseline}${time}
 BEGIN INSERT INTO public.invoicing_time_entries(workspace_id,staff_id,engagement_id,deliverable_id,entry_date,hours) VALUES(workspace,staff,engagement,foreign_deliverable,'2026-09-01',1); RAISE EXCEPTION 'Foreign project accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM public.record_contract_command(engagement,outsider,c); RAISE EXCEPTION 'Outsider entered time'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||'{"status":"approved","valuationBasis":"cost_rate"}'); RAISE EXCEPTION 'Missing rate accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.record_contract_command(engagement,member_id,c);
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid())); RAISE EXCEPTION 'Duplicate source accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 ${approve}
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',2,'status','draft','valuationBasis','unvalued','amount',NULL)); RAISE EXCEPTION 'Member changed approved actual'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 `));
 it("bills split sources once using effective billing rates and gross retention", () => marker(`${saveBaseline}${time}
 PERFORM public.record_contract_command(engagement,member_id,c); ${approve}
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','rate','requestId',gen_random_uuid(),'rateId',billing_rate,'staffId',staff,'basis','billing','startsOn','2026-01-01','endsOn','2026-12-31','hourlyRate','100.00','sourceReference','Synthetic approved billing schedule'));
 c:=jsonb_build_object('kind','bill','requestId',gen_random_uuid(),'invoiceNumber','SYNTH-1','invoiceDate','2026-09-01','retentionPercent','10.00','entryIds',jsonb_build_array(entry));
 result:=public.record_contract_command(engagement,owner_id,c); invoice:=(result->>'invoiceId')::uuid;
 IF result->>'gross'<>'101.00' OR result->>'net'<>'90.90' THEN RAISE EXCEPTION 'Billing rate or retention wrong'; END IF;
 IF (SELECT count(*) FROM public.client_invoice_line_items WHERE invoice_id=invoice)<>2 THEN RAISE EXCEPTION 'Split attribution collapsed'; END IF;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'invoiceNumber','SYNTH-2')); RAISE EXCEPTION 'Duplicate billing accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 IF (SELECT count(*) FROM public.client_invoices WHERE engagement_id=engagement)<>1 THEN RAISE EXCEPTION 'Failed billing left orphan invoice'; END IF;
 `));
 it("rejects currency relabeling, contradictory allocations and changed project parents",()=>marker(`${saveBaseline}
 BEGIN UPDATE public.invoicing_engagements SET project_id=other_project WHERE id=engagement; RAISE EXCEPTION 'Retained project changed'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'baselineId',gen_random_uuid(),'expectedVersion',1,'content',(c->'content')||'{"currency":"EUR"}')); RAISE EXCEPTION 'Currency relabeled'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.validate_contract_budget((c->'content')||'{"fee":"1.00"}'); RAISE EXCEPTION 'Contradictory budget approved'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 `));
 it("retains snapshot identities and private Documents access, with more than 1000 records",()=>marker(`${saveBaseline}${time}
 PERFORM public.record_contract_command(engagement,member_id,c);${approve}
 INSERT INTO public.contract_actual_versions(entry_id,engagement_id,workspace_id,version,source_key,command,amount,hours,allocations,created_by)
 SELECT gen_random_uuid(),engagement,workspace,1,'synthetic-bulk-'||i,c||jsonb_build_object('sourceKey','synthetic-bulk-'||i,'category','expense'),0.01,NULL,jsonb_build_array(jsonb_build_object('taskId',task,'deliverableId',deliverable,'share',10000,'amount','0.01','hours',NULL)),owner_id FROM generate_series(1,1101) i;
 state:=public.read_contract_management(engagement,owner_id);
 IF jsonb_array_length(state->'actuals')<>1103 THEN RAISE EXCEPTION 'Source pagination lost rows'; END IF;
 result:=public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','snapshot','requestId',gen_random_uuid(),'title','Synthetic snapshot','asOf','2026-09-01','sourceCutoff',now(),'coverageComplete',false,'coverageEvidence','Synthetic fixture coverage'));
 report:=(result->>'snapshotId')::uuid;
 SELECT snapshot_hash INTO original_hash FROM public.contract_snapshots WHERE id=report;
 PERFORM public.enqueue_contract_snapshot(report,'pdf',owner_id);
 BEGIN UPDATE public.contract_snapshots SET title='Changed' WHERE id=report; RAISE EXCEPTION 'Issued history edited'; EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',member_id::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.contract_actual_versions WHERE engagement_id=engagement) OR EXISTS(SELECT 1 FROM public.contract_snapshots WHERE id=report) OR EXISTS(SELECT 1 FROM public.kb_documents WHERE contract_snapshot_id=report) THEN RAISE EXCEPTION 'Private management records leaked'; END IF;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Actor spoof accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';
 `));
 it("preserves effective rates and rejects changed retries, foreign tasks and missing opening evidence",()=>marker(`${saveBaseline}${time}
 PERFORM public.record_contract_command(engagement,member_id,c);
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c||'{"hours":"2.00"}');RAISE EXCEPTION 'Changed retry accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'sourceKey','foreign-task','allocations',jsonb_build_array(jsonb_build_object('taskId',gen_random_uuid(),'deliverableId',deliverable,'share',10000))));RAISE EXCEPTION 'Foreign task accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'sourceKey','opening','category','opening'));RAISE EXCEPTION 'Undocumented opening accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','rate','requestId',gen_random_uuid(),'rateId',cost_rate,'staffId',staff,'basis','cost','startsOn','2026-01-01','endsOn','2026-12-31','hourlyRate','12.35','sourceReference','Synthetic rate'));
 c:=c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'status','approved','valuationBasis','cost_rate','rateId',cost_rate,'correctionNote','Synthetic review');PERFORM public.record_contract_command(engagement,owner_id,c);
 IF (SELECT amount FROM public.contract_actual_versions WHERE entry_id=entry AND version=2)<>12.47 THEN RAISE EXCEPTION 'Effective cost rate wrong';END IF;
 `));

});
