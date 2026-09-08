import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

const setup = readFileSync("src/test/fixtures/contracts/setup.sql", "utf8");
function check(body: string) {
  if (!process.env.CI && !process.env.OPENPLAN_SUPABASE_WORKDIR?.includes("m11-contract-verification")) throw new Error("Explicit disposable M11 stack required");
  const mutation = process.env.OPENPLAN_CONTRACT_TEST_SQL ? readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL, "utf8") : "";
  const output = execFileSync("docker", ["exec", "-i", resolveLocalDbContainer(), "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
    input: `BEGIN;${mutation}\n${setup.replace("-- TEST_BODY", body)} SELECT 'PENDING_ASSERTIONS_REACHED'; ROLLBACK;`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
  expect(output).toContain("PENDING_ASSERTIONS_REACHED");
}
const asActor = (actor: string) => `PERFORM set_config('request.jwt.claim.sub',${actor}::text,true);SET LOCAL ROLE authenticated;`;
const pm = `INSERT INTO public.contract_access_versions(engagement_id,workspace_id,user_id,version,role,active,evidence,created_by) VALUES(engagement,workspace,member_id,1,'pm',true,'Synthetic PM',owner_id);`;

describe.skipIf(!LIVE_RLS)("pending contract review eligibility", () => {
  it("shows designated finance the latest master proposal and only the latest unapplied response", () => check(`
    INSERT INTO public.contract_access_versions(engagement_id,workspace_id,user_id,version,role,active,evidence,created_by) VALUES(engagement,workspace,member_id,1,'finance',true,'Synthetic finance',owner_id);
    report:=gen_random_uuid();INSERT INTO public.contract_master_terms(id,engagement_id,workspace_id,version,state,currency,ceiling,starts_on,ends_on,terms,source_document_id,source_receipt,created_by) VALUES(entry,engagement,workspace,1,'proposed','USD',1500,'2026-01-01','2026-12-31','Synthetic master terms',document,'{}',owner_id),(report,engagement,workspace,2,'proposed','USD',2500,'2026-01-01','2026-12-31','Synthetic revised terms',document,'{}',owner_id);
    ${asActor("member_id")}
    IF (SELECT count(*) FROM public.contract_pending_my_work WHERE engagement_id=engagement AND review_kind='master')<>1 OR NOT EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE id=report) THEN RAISE EXCEPTION 'Scoped finance master version incorrect';END IF;RESET ROLE;
    UPDATE public.contract_master_terms SET state='approved',approved_at=now(),approval_evidence='Synthetic master approval' WHERE id=report;
    ${asActor("member_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Old master proposal resurrected';END IF;RESET ROLE;
    INSERT INTO public.contract_forecasts(id,engagement_id,workspace_id,version,input_hash,content,created_by) VALUES(p,engagement,workspace,1,repeat('a',64),'{}',owner_id);
    INSERT INTO public.contract_management_responses(id,engagement_id,workspace_id,forecast_id,input_hash,content,created_by,created_at) VALUES(entry,engagement,workspace,p,repeat('a',64),jsonb_build_object('sourceRecord',jsonb_build_object('title','Synthetic old response')),owner_id,now()-interval '1 minute'),(report,engagement,workspace,p,repeat('a',64),jsonb_build_object('sourceRecord',jsonb_build_object('title','Synthetic latest response')),owner_id,now());
    ${asActor("member_id")}
    IF (SELECT count(*) FROM public.contract_pending_my_work WHERE engagement_id=engagement AND review_kind='response')<>1 OR NOT EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE id=report AND title='Synthetic latest response') THEN RAISE EXCEPTION 'Latest response decision incorrect';END IF;RESET ROLE;
    INSERT INTO public.contract_schedules(id,engagement_id,workspace_id,version,content,created_by) VALUES(element,engagement,workspace,1,'{}',owner_id);
    INSERT INTO public.contract_response_applications(engagement_id,workspace_id,response_id,schedule_id,evidence,created_by) VALUES(engagement,workspace,report,element,'Synthetic applied comparison',owner_id);
    ${asActor("member_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Applied response remained pending';END IF;RESET ROLE;
  `));
  it("routes proposed baselines only to finance and removes approved decisions", () => check(`
    PERFORM public.record_contract_command(engagement,owner_id,c);
    ${asActor("owner_id")}
    IF (SELECT count(*) FROM public.contract_pending_my_work WHERE engagement_id=engagement AND review_kind='baseline')<>1 THEN RAISE EXCEPTION 'Finance baseline queue missing';END IF;
    RESET ROLE;
    ${asActor("member_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Staff received finance decision';END IF;RESET ROLE;
    ${pm}${asActor("member_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'PM received finance decision';END IF;RESET ROLE;
    ${asActor("outsider")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Foreign actor saw contract decision';END IF;RESET ROLE;
    PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',1,'approvalEvidence','Synthetic approval'));
    ${asActor("owner_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Approved baseline still pending';END IF;RESET ROLE;
  `));
  it("moves current received invoices from PM review to finance without resurfacing returned or approved versions", () => check(`
    ${pm}
    INSERT INTO public.contract_received_invoices(invoice_id,engagement_id,workspace_id,version,state,content,submitted_by,created_by) VALUES(entry,engagement,workspace,1,'submitted',jsonb_build_object('number','SYNTHETIC-001'),member_id,owner_id);
    ${asActor("member_id")}
    IF (SELECT count(*) FROM public.contract_pending_my_work WHERE engagement_id=engagement AND review_kind='received_review' AND title='SYNTHETIC-001')<>1 THEN RAISE EXCEPTION 'PM invoice queue missing';END IF;RESET ROLE;
    INSERT INTO public.contract_received_invoices(invoice_id,engagement_id,workspace_id,version,state,content,submitted_by,created_by) VALUES(entry,engagement,workspace,2,'reviewed',jsonb_build_object('number','SYNTHETIC-001'),member_id,owner_id);
    ${asActor("member_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Reviewed invoice retained PM approval';END IF;RESET ROLE;
    ${asActor("owner_id")}
    IF (SELECT count(*) FROM public.contract_pending_my_work WHERE engagement_id=engagement AND review_kind='received_finance')<>1 THEN RAISE EXCEPTION 'Finance invoice queue missing';END IF;RESET ROLE;
    INSERT INTO public.contract_received_invoices(invoice_id,engagement_id,workspace_id,version,state,content,submitted_by,created_by) VALUES(entry,engagement,workspace,3,'returned',jsonb_build_object('number','SYNTHETIC-001'),member_id,owner_id);
    ${asActor("owner_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Returned invoice resurrected review';END IF;RESET ROLE;
    INSERT INTO public.contract_received_invoices(invoice_id,engagement_id,workspace_id,version,state,content,submitted_by,created_by) VALUES(entry,engagement,workspace,4,'approved',jsonb_build_object('number','SYNTHETIC-001'),member_id,owner_id);
    ${asActor("owner_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Approved invoice still pending';END IF;RESET ROLE;
  `));
});
