import {it,expect} from "vitest";
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {LIVE_RLS} from "./local-supabase-env";
import {resolveLocalDbContainer} from "./helpers/live-catalog";
import {normalizeContractCommand,type CalculationClient} from "@/lib/invoicing/contracts/calculation";
import {contractCommandSchema,type ContractCommand,type ContractState} from "@/lib/invoicing/contracts/schema";
import {reconcileContract} from "@/lib/invoicing/contracts/reconciliation";
import {closeoutPosition,settlementPosition} from "@/lib/invoicing/contracts/closeout";
import {accountingHandoffRows,type CloseoutPackage} from "@/lib/invoicing/contracts/closeout-export";

const quote=(value:unknown)=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;

// A live RPC adapter preserves one disposable transaction through real JS normalization and SQL writes.
function session(){
 const container=resolveLocalDbContainer();
 if(!["supabase_db_m11-contract-verification","supabase_db_m11-contract-verification-upgrade"].includes(container))throw new Error("Select the explicitly disposable M11 verification stack");
 const child=spawn("docker",["exec","-i",container,"psql","-U","postgres","-d","postgres","-qAt","-v","ON_ERROR_STOP=1"],{stdio:["pipe","pipe","pipe"]});
 const lines=createInterface({input:child.stdout});let diagnostic="";child.stderr.on("data",chunk=>{diagnostic+=String(chunk);});
 const query=(sql:string)=>new Promise<unknown>((resolve,reject)=>{
  const received=(line:string)=>{child.off("exit",exited);try{resolve(JSON.parse(line));}catch(error){reject(error);}};
  const exited=()=>{lines.off("line",received);reject(new Error(diagnostic||"Disposable SQL session ended"));};
  lines.once("line",received);child.once("exit",exited);child.stdin.write(sql+"\n");
 });
 const rpc:CalculationClient["rpc"]=async(name,args)=>await query(`SELECT pg_temp.m11_rpc(${quote(name)} #>> '{}',${quote(args)});`) as Awaited<ReturnType<CalculationClient["rpc"]>>;
 return {query,rpc,async close(){try{await query(`ROLLBACK; SELECT '{"rolledBack":true}'::jsonb;`);}finally{child.stdin.end();lines.close();}}};
}

it.skipIf(!LIVE_RLS)("normalizes and persists small-practice settlement, costs and immutable closeout in one transaction",async()=>{
 const db=session();
 try{
  const setup=readFileSync("src/test/fixtures/contracts/setup.sql","utf8").replace('-- TEST_BODY',`
   invoice:=gen_random_uuid();
   INSERT INTO public.client_invoices(id,workspace_id,client_id,engagement_id,project_id,invoice_number,status,invoice_date,sent_date,subtotal_amount,retention_percent,retention_amount,total_amount,currency_code,created_by)
   VALUES(invoice,workspace,client,engagement,project,'SYNTHETIC-PRACTICE-FIXED','sent','2026-09-08','2026-09-08',1000,10,100,900,'USD',owner_id);
   INSERT INTO rpc_context VALUES(jsonb_build_object('owner',owner_id,'member',member_id,'engagement',engagement,'document',document,'task',task,'deliverable',deliverable,'invoice',invoice,'baseline',baseline,'baselineCommand',c));
  `);
  const context=await db.query(`BEGIN; CREATE TEMP TABLE rpc_context(body jsonb); ${setup}
   CREATE FUNCTION pg_temp.m11_rpc(n text,a jsonb) RETURNS jsonb LANGUAGE plpgsql AS $rpc$
   DECLARE d jsonb; BEGIN
    CASE n WHEN 'read_contract_management' THEN d:=public.read_contract_management((a->>'p_engagement_id')::uuid,(a->>'p_actor_id')::uuid);
     WHEN 'read_contract_delivery' THEN d:=public.read_contract_delivery((a->>'p_engagement_id')::uuid,(a->>'p_actor_id')::uuid);
     WHEN 'record_contract_command' THEN d:=public.record_contract_command((a->>'p_engagement_id')::uuid,(a->>'p_actor_id')::uuid,a->'p_command');
     ELSE RAISE EXCEPTION 'Unsupported synthetic RPC'; END CASE;
    RETURN jsonb_build_object('data',d,'error',NULL);
   EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('data',NULL,'error',jsonb_build_object('message',SQLERRM,'code',SQLSTATE)); END $rpc$;
   SELECT body FROM rpc_context;`) as Record<string,string>&{baselineCommand:ContractCommand};
  const read=async()=>{const response=await db.rpc("read_contract_management",{p_engagement_id:context.engagement,p_actor_id:context.owner});expect(response.error).toBeNull();return response.data as ContractState;};
  const send=async(command:ContractCommand,actor=context.owner)=>{
   const normalized=await normalizeContractCommand(db,context.engagement,actor,contractCommandSchema.parse(command));
   const response=await db.rpc("record_contract_command",{p_engagement_id:context.engagement,p_actor_id:actor,p_command:normalized});
   if(response.error)throw new Error(response.error.message);return response.data as Record<string,string>;
  };
  await send(context.baselineCommand);await send({kind:"approve",requestId:randomUUID(),baselineId:context.baseline,expectedVersion:1,approvalEvidence:"Synthetic fixed fee 1000, internal cost budget 500; no real contract authority"});
  const cost:Extract<ContractCommand,{kind:"actual"}>={kind:"actual",requestId:randomUUID(),expectedVersion:0,entryId:randomUUID(),sourceKey:"SYNTHETIC-PRACTICE-COST",sourceReference:"Synthetic internal expense, separate from client fixed fee",entryDate:"2026-09-08",category:"expense",status:"approved",description:"Synthetic incurred cost",staffId:null,hours:"0.00",amount:"200.00",valuationBasis:"recorded",rateId:null,billable:false,timeEntryId:null,spendEntryId:null,owpVersionId:null,invoiceId:null,allocations:[{taskId:context.task,deliverableId:context.deliverable,share:10000}],correctionNote:"",openingStart:null,openingEnd:null,openingBasis:"",reconciliationNote:"Synthetic standalone cost"};
  await send(cost);
  const commitment={...cost,requestId:randomUUID(),entryId:randomUUID(),sourceKey:"SYNTHETIC-PRACTICE-COMMITMENT",category:"commitment" as const,amount:"40.00"};await send(commitment);
  await send({...commitment,requestId:randomUUID(),expectedVersion:1,status:"excluded",correctionNote:"Synthetic supplier commitment released without another cost"});
  const invoice=(await read()).invoices.find(i=>i.id===context.invoice)!;
  const event=async(kind:Extract<ContractCommand,{kind:"settlement"}>["content"]["kind"],amount:string)=>{
   const command:Extract<ContractCommand,{kind:"settlement"}>={kind:"settlement",requestId:randomUUID(),expectedVersion:0,content:{eventId:randomUUID(),sourceKey:`SYNTHETIC-${kind}-${randomUUID()}`,direction:"outgoing",invoiceId:context.invoice,invoiceVersion:invoice.updated_at,date:"2026-09-08",kind,amount,currency:"USD",state:"recorded",documentId:context.document,sourceReference:"Synthetic finance evidence, no actual payment",correctionEvidence:"",legacyActualId:null}};
   await send(command);return command;
  };
  await event("retention_hold","20.00");await event("dispute_open","50.00");
  await event("payment","600.00");await event("credit","50.00");await event("refund","10.00");await event("adjustment_debit","5.00");
  const last=await event("payment","350.00");
  await send({...last,requestId:randomUUID(),expectedVersion:1,content:{...last.content,amount:"365.00",correctionEvidence:"Synthetic correction preserves original 350 receipt and replaces it with 365"}});
  await event("retention_release","120.00");await event("dispute_resolve","50.00");
  for(const [index,state] of (["submitted","returned","resubmitted","accepted"] as const).entries())await send({kind:"deliverable_event",requestId:randomUUID(),expectedVersion:index,deliverableId:context.deliverable,state,date:"2026-09-08",documentId:context.document,authority:"Synthetic responsible reviewer",evidence:`Synthetic ${state}, separate from cash`},index%2===0?context.member:context.owner);
  const state=await read();expect(reconcileContract(state,{asOf:"2026-09-08"})).toMatchObject({grossBilled:"1000.00",total:{incurred:"200.00",commitments:"0.00"}});
  expect(settlementPosition(state)[0]).toMatchObject({gross:"1000.00",payments:"965.00",credits:"50.00",refunds:"10.00",adjustments:"5.00",open:"0.00",retention:"0.00",disputed:"0.00"});
  const close:Extract<ContractCommand,{kind:"closeout"}>={kind:"closeout",requestId:randomUUID(),expectedVersion:0,expectedInputHash:state.closeout!.inputHash,title:"Synthetic small-practice reconciled closeout",asOf:"2026-09-08",coverageComplete:true,coverageEvidence:"Only the synthetic fixed invoice, cost and retained events",workAccepted:true,workAuthority:"Synthetic separate accepted deliverable",financialSettled:true,financeAuthority:"Synthetic finance reconstruction",obligations:[{id:randomUUID(),title:"Retain source records",owner:"Synthetic practice",dueOn:"2026-10-15",status:"open",basis:"Synthetic continuing records obligation"}],evidence:"Engineering only; no independent human finance acceptance"};
  expect(closeoutPosition(state,close)).toMatchObject({incurred:"200.00",underspend:"300.00",openObligations:1,workAccepted:true,financialSettled:true});
  const normalizedClose=await normalizeContractCommand(db,context.engagement,context.owner,close);
  const saved=await db.rpc("record_contract_command",{p_engagement_id:context.engagement,p_actor_id:context.owner,p_command:normalizedClose});expect(saved.error).toBeNull();
  expect(await db.rpc("record_contract_command",{p_engagement_id:context.engagement,p_actor_id:context.owner,p_command:normalizedClose})).toEqual(saved);
  expect(await send(close)).toEqual(saved.data);
  await expect(send({...close,title:"Altered retry title"})).rejects.toThrow("Retained request changed");
  const wrongActor=await db.rpc("record_contract_command",{p_engagement_id:context.engagement,p_actor_id:context.member,p_command:normalizedClose});expect(wrongActor.error?.message).toBe("Retained request changed");
  await expect(send({...close,requestId:randomUUID()})).rejects.toThrow("closeout data changed");
  const closed=await read(),version=closed.closeout!.versions[0],hash=version.content_hash,pkg=version.content.package as CloseoutPackage;
  expect(pkg.position).toMatchObject({incurred:"200.00",underspend:"300.00",openObligations:1});
  const rows=accountingHandoffRows(pkg);expect(rows.some(r=>r[0]==="contract_total_incurred"&&r.includes("200.00"))).toBe(true);expect(rows.some(r=>r[0]==="invoice_total_open"&&r.includes("0.00"))).toBe(true);
  await send({kind:"reopen",requestId:randomUUID(),expectedVersion:1,closeoutId:version.id,evidence:"Synthetic reopened records review, not a changed financial history"});
  const reopened=await read();expect(reopened.closeout!.versions[0].content_hash).toBe(hash);expect(reopened.closeout!.versions[1].previous_id).toBe(version.id);
  expect(()=>closeoutPosition(reopened,{...close,obligations:[]})).toThrow("Carry forward each prior open obligation");
  expect(reopened.closeout!.settlements.filter(e=>e.content.eventId===last.content.eventId).map(e=>e.content.amount)).toEqual(["350.00","365.00"]);
 }finally{await db.close();}
},30_000);
