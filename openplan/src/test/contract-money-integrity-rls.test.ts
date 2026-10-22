import { requireContractVerificationStack } from "./helpers/contract-verification-stack";
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

/**
 * Live custody for the 2026-10-17 money-integrity corrections to contract
 * billing and received consultant invoices (KI-2026-10-12-005, -006).
 *
 * Harness cases install the pre-correction function (the refusal must then
 * fail) and the corrected function with a harmless message edit (the refusal
 * must still pass) inside the same rolled-back transaction.
 */
const setup = readFileSync("src/test/fixtures/contracts/setup.sql", "utf8");
function functionText(file: string, start: string) {
  const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
  const from = sql.indexOf(start);
  if (from < 0) throw new Error(`Missing ${start} in ${file}`);
  return sql.slice(from, sql.indexOf("END $$;", from) + 7).replace(/^CREATE FUNCTION/, "CREATE OR REPLACE FUNCTION");
}
const CORRECTED = "20261017000005_money_integrity_corrections.sql";
const oldBill = functionText("20260912000004_contract_accounting_reconciliation.sql", "CREATE OR REPLACE FUNCTION public.bill_contract_actuals(");
const newBill = functionText(CORRECTED, "CREATE OR REPLACE FUNCTION public.bill_contract_actuals(");
const oldReceived = functionText("20260912000003_received_consultant_invoices.sql", "CREATE FUNCTION public.record_received_invoice(");
const newReceived = functionText(CORRECTED, "CREATE OR REPLACE FUNCTION public.record_received_invoice(");
function harmless(text: string, from: string, to: string) {
  if (!text.includes(from)) throw new Error(`Harmless edit target missing: ${from}`);
  return text.replace(from, to);
}

function exercise(body: string, replacement = "") {
  requireContractVerificationStack(resolveLocalDbContainer());
  const injected = process.env.OPENPLAN_CONTRACT_TEST_SQL ? readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL, "utf8") : "";
  return execFileSync("docker", ["exec", "-i", resolveLocalDbContainer(), "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
    encoding: "utf8",
    input: `BEGIN; SET LOCAL lock_timeout='5s';${injected}${replacement}\n${setup.replace("-- TEST_BODY", body)} SELECT 'CONTRACT_MONEY_ASSERTIONS_REACHED'; ROLLBACK;`,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
const reached = (output: string) => expect(output).toContain("CONTRACT_MONEY_ASSERTIONS_REACHED");

const baseline = `PERFORM public.record_contract_command(engagement,owner_id,c); PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',1,'approvalEvidence','Synthetic written authorization, no real authority'));`;

// One approved, billable, split labor source with an effective billing rate.
const billable = `${baseline}
 c:=jsonb_build_object('kind','actual','requestId',gen_random_uuid(),'entryId',entry,'expectedVersion',0,'sourceKey','synthetic-time','sourceReference','Synthetic timesheet','entryDate','2026-09-01','category','labor','status','draft','description','Synthetic effort','staffId',staff,'hours','1.01','amount',NULL,'valuationBasis','unvalued','rateId',NULL,'billable',true,'allocations',jsonb_build_array(jsonb_build_object('taskId',task,'deliverableId',deliverable,'share',3333),jsonb_build_object('taskId',task2,'deliverableId',deliverable,'share',6667)),'correctionNote','','openingBasis','','reconciliationNote','');
 PERFORM public.record_contract_command(engagement,member_id,c);
 PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'status','approved','amount','12.47','valuationBasis','recorded','correctionNote','Synthetic reviewed valuation'));
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','rate','requestId',gen_random_uuid(),'rateId',billing_rate,'staffId',staff,'basis','billing','startsOn','2026-01-01','endsOn','2026-12-31','hourlyRate','100.00','sourceReference','Synthetic billing schedule'));
 c:=jsonb_build_object('kind','bill','requestId',gen_random_uuid(),'invoiceNumber','SYNTH-VOIDED','invoiceDate','2026-09-01','retentionPercent','0.00','entryIds',jsonb_build_array(entry));
 result:=public.record_contract_command(engagement,owner_id,c); invoice:=(result->>'invoiceId')::uuid;`;
// The invoice route voids a draft first, then releases the time stamped to its lines.
const voidDraft = `UPDATE public.client_invoices SET status='void' WHERE id=invoice;
 UPDATE public.invoicing_time_entries SET billed_line_item_id=NULL WHERE billed_line_item_id IN (SELECT id FROM public.client_invoice_line_items WHERE invoice_id=invoice);`;
const rebill = `${billable}${voidDraft}
 BEGIN result:=public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'invoiceNumber','SYNTH-REISSUED'));
 EXCEPTION WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'Voided draft source stranded: %',SQLERRM; END;
 IF (SELECT count(*) FROM public.contract_billing_sources WHERE entry_id=entry)<>2 OR NOT EXISTS(SELECT 1 FROM public.contract_billing_sources WHERE entry_id=entry AND invoice_id=invoice) THEN RAISE EXCEPTION 'Voided billing history lost'; END IF;
 IF (SELECT status FROM public.client_invoices WHERE id=(result->>'invoiceId')::uuid)<>'draft' OR result->>'gross'<>'101.00' THEN RAISE EXCEPTION 'Replacement invoice wrong'; END IF;`;

const receivedSetup = `${baseline}
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','access','requestId',gen_random_uuid(),'expectedVersion',0,'email',member_id||'@example.test','role','pm','active',true,'evidence','Synthetic PM designation'));
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','access','requestId',gen_random_uuid(),'expectedVersion',0,'email',outsider||'@example.test','role','consultant','active',true,'evidence','Synthetic consultant designation'));
 PERFORM public.record_contract_command(engagement,outsider,jsonb_build_object('kind','received_invoice','requestId',gen_random_uuid(),'expectedVersion',0,'invoiceId',entry,'content',jsonb_build_object('number','SYNTHETIC-001','date','2026-09-01','currency','USD','lines',jsonb_build_array(jsonb_build_object('description','Synthetic direct cost','amount','25.00','treatment','direct','basis','Synthetic basis'))),'file',jsonb_build_object('filename','synthetic.csv','contentType','text/csv','base64',encode(convert_to('source,amount'||chr(10)||'SYNTHETIC-001,25.00','UTF8'),'base64'))));
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','actual','requestId',gen_random_uuid(),'entryId',ow_entry,'expectedVersion',0,'sourceKey','synthetic-vendor-cost','sourceReference','Synthetic accounting cost','entryDate','2026-09-01','category','expense','status','approved','description','Synthetic invoice source','staffId',NULL,'hours',NULL,'amount','25.00','valuationBasis','recorded','rateId',NULL,'billable',false,'allocations',jsonb_build_array(jsonb_build_object('taskId',task,'deliverableId',deliverable,'share',10000))));
 c:=jsonb_build_object('kind','received_review','requestId',gen_random_uuid(),'expectedVersion',1,'invoiceId',entry,'state','approved','note','Synthetic finance reconciliation','matches',jsonb_build_array(jsonb_build_object('entryId',ow_entry,'versionId',(SELECT id FROM public.contract_actual_versions WHERE entry_id=ow_entry),'amount','25.00')));`;
const unreviewedRefused = `${receivedSetup}
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c); RAISE EXCEPTION 'Finance approved an invoice that skipped PM review';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT x.state FROM public.contract_received_invoices x WHERE x.invoice_id=entry ORDER BY x.version DESC LIMIT 1)<>'submitted' THEN RAISE EXCEPTION 'Refused approval changed the invoice'; END IF;`;

(LIVE_RLS ? describe : describe.skip)("contract money-integrity corrections", () => {
  it("bills a source again after its draft invoice is voided, and keeps the voided billing as history", () => reached(exercise(rebill)));

  it("still refuses a second live billing of the same source, through the command and directly", () => reached(exercise(`${billable}
   BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'invoiceNumber','SYNTH-DUPLICATE')); RAISE EXCEPTION 'Live source billed twice';
   EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
   BEGIN INSERT INTO public.contract_billing_sources(engagement_id,workspace_id,entry_id,actual_version_id,invoice_id,billing_rate_id,lines) SELECT engagement_id,workspace_id,entry_id,actual_version_id,invoice_id,billing_rate_id,lines FROM public.contract_billing_sources WHERE entry_id=entry; RAISE EXCEPTION 'Second live source row accepted';
   EXCEPTION WHEN unique_violation THEN NULL; END;
  `)));

  it("harness: the pre-correction function strands the voided source, and a harmless edit of the corrected one still rebills it", () => {
    expect(() => exercise(rebill, oldBill)).toThrow(/Voided draft source stranded/);
    reached(exercise(rebill, harmless(newBill, "Approved contract baseline required for billing", "An approved contract baseline is required for billing")));
  });

  it("refuses finance approval of a received invoice that skipped project manager review", () => reached(exercise(unreviewedRefused)));

  it("still approves a received invoice after the project manager review", () => reached(exercise(`${receivedSetup}
   PERFORM public.record_contract_command(engagement,member_id,jsonb_build_object('kind','received_review','requestId',gen_random_uuid(),'expectedVersion',1,'invoiceId',entry,'state','reviewed','note','Synthetic PM review','matches','[]'::jsonb));
   BEGIN PERFORM public.record_contract_command(engagement,member_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',2)); RAISE EXCEPTION 'PM financially approved received invoice';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',2));
   IF (SELECT x.state FROM public.contract_received_invoices x WHERE x.invoice_id=entry ORDER BY x.version DESC LIMIT 1)<>'approved' THEN RAISE EXCEPTION 'Reviewed invoice not approved'; END IF;
  `)));

  it("harness: the pre-correction function approves the unreviewed invoice, and a harmless edit of the corrected one still refuses it", () => {
    expect(() => exercise(unreviewedRefused, oldReceived)).toThrow(/Finance approved an invoice that skipped PM review/);
    reached(exercise(unreviewedRefused, harmless(newReceived, "Record the discrepancy or review and authority evidence", "Record the discrepancy, or the review and authority evidence")));
  });
});
