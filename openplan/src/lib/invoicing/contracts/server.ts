import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { parseAccountingImport } from "./import";
import { closeoutPosition, settlementPosition } from "./closeout";
import { compareResponse } from "./response";
import { forecastDelivery, validateSchedule } from "./delivery";
import type { ContractState } from "./schema";
import { contractCommandSchema } from "./schema";
import { reportingError } from "@/lib/programs/work-program/reporting-server";
export async function contractAccess(engagementId: string) {
 const client = await createClient();
 const { data: { user } } = await client.auth.getUser();
 if (!user) return { response: NextResponse.json({ error: "Sign in to manage this contract" }, { status: 401 }) };
 const service = createServiceRoleClient();
 const result = await service.rpc("read_contract_management", { p_engagement_id: engagementId, p_actor_id: user.id });
 if (result.error) return { response: reportingError(result.error) };
 return { user, client, service, state: result.data };
}
export async function saveContractCommand(request: NextRequest, engagementId: string, input: unknown) {
 const audit = createApiAuditLogger("invoicing.contract.command", request);
 const access = await contractAccess(engagementId);
 if (access.response) return access.response;
 if (readAssistantExecutionSource(request) !== "manual") return NextResponse.json({ error: "Contract management is not a registered Planner Agent action. Use the contract management page." }, { status: 403 });
 const command = contractCommandSchema.safeParse(input);
 if (!command.success) return NextResponse.json({ error: "Check required dates, source evidence, exact amounts and allocations", issues: command.error.issues }, { status: 400 });
 let normalized: unknown=command.data;
 try {
  if(command.data.kind==="schedule")validateSchedule(command.data.content);
  if(command.data.kind==="forecast"||command.data.kind==="response"){
   const before=await access.service!.rpc("read_contract_delivery",{p_engagement_id:engagementId,p_actor_id:access.user!.id});
   if(before.error)throw new Error("Forecast source version is unavailable");
   const fresh=await access.service!.rpc("read_contract_management",{p_engagement_id:engagementId,p_actor_id:access.user!.id});
   if(fresh.error)throw new Error("Forecast inputs are unavailable");
   const after=await access.service!.rpc("read_contract_delivery",{p_engagement_id:engagementId,p_actor_id:access.user!.id});
   const state=fresh.data as ContractState;
   if(after.error||!state.delivery||before.data.inputHash!==state.delivery.inputHash||state.delivery.inputHash!==after.data.inputHash)throw new Error("Forecast inputs changed during reading. Reload and review again.");
   const cleanState={...state,rates:[],snapshots:[],imports:[],accountingImports:[],accountingReviews:[],access:[],responses:undefined,closeout:undefined,delivery:undefined};
   const inputs={state:cleanState,delivery:{...state.delivery,forecasts:[]},options:command.data};
   normalized=command.data.kind==="response"?{...command.data,_request:command.data,_inputHash:state.delivery.inputHash,_comparison:compareResponse(state,command.data)}:{...command.data,_request:command.data,_inputHash:state.delivery.inputHash,_inputs:inputs,_result:forecastDelivery(cleanState,state.delivery,command.data)};
  }
  if(command.data.kind==="settlement"||command.data.kind==="closeout"){
   const first=await access.service!.rpc("read_contract_management",{p_engagement_id:engagementId,p_actor_id:access.user!.id});
   const state=first.data as ContractState;
   if(first.error||!state.closeout)throw new Error("Closeout source records are unavailable");
   const confirm=await access.service!.rpc("read_contract_management",{p_engagement_id:engagementId,p_actor_id:access.user!.id});
   if(confirm.error||state.closeout.inputHash!==(confirm.data as ContractState).closeout?.inputHash)throw new Error("Financial sources changed during reading. Reload and reconcile again.");
   if(command.data.kind==="settlement"){
    const prospective={...state,closeout:{...state.closeout,settlements:[...state.closeout.settlements,{id:command.data.requestId,version:command.data.expectedVersion+1,content:command.data.content,source_receipt:{id:command.data.content.documentId,checksum:"pending SQL custody",storageRef:"",bytes:null},created_at:new Date().toISOString()}]}};
    const content=command.data.content,position=settlementPosition(prospective),invoice=position.find(i=>i.id===content.invoiceId&&i.direction===content.direction);
    if(!invoice)throw new Error("An approved received invoice or issued outgoing invoice is required");
    if(invoice.warnings.some(w=>w.includes("exceeds")||w.includes("exceed")))throw new Error(invoice.warnings.join(" "));
    normalized={...command.data,_request:command.data,_inputHash:state.closeout.inputHash,_position:position};
   }else{
    const position=closeoutPosition(state,command.data),safeState={...state,rates:[],access:[],imports:[],snapshots:[],closeout:{...state.closeout,versions:state.closeout.versions.map(v=>({id:v.id,version:v.version,state:v.state,content_hash:v.content_hash,previous_id:v.previous_id}))}};
    normalized={...command.data,_request:command.data,_inputHash:state.closeout.inputHash,_position:position,_package:{formatVersion:1,state:safeState,position,request:command.data}};
   }
  }
  if(command.data.kind==="accounting_import")normalized=parseAccountingImport(command.data);} catch(error) {return NextResponse.json({error:error instanceof Error?error.message:"Accounting CSV could not be read"},{status:400});}
 const result = await access.service!.rpc("record_contract_command", { p_engagement_id: engagementId, p_actor_id: access.user!.id, p_command: normalized });
 if (result.error) audit.warn("contract_command_refused", { engagementId, kind: command.data.kind, code: result.error.code });
 else audit.info("contract_command_saved", { engagementId, kind: command.data.kind, requestId: command.data.requestId });
 return result.error ? reportingError(result.error) : NextResponse.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
}
