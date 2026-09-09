import { cents } from "@/lib/programs/work-program/reporting";
import { parseAccountingImport } from "./import";
import { compareResponse } from "./response";
import { forecastDelivery,validateSchedule } from "./delivery";
import { closeoutPosition,settlementPosition } from "./closeout";
import type { ContractCommand,ContractState } from "./schema";
import type { DeliveryState } from "./delivery-schema";
export type CalculationClient={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message?:string;code?:string}|null}>};
/** Used by the API and local calculation worker. Caller-reviewed source hashes remain binding. */
export async function normalizeContractCommand(service:CalculationClient,engagementId:string,actorId:string,command:ContractCommand):Promise<unknown>{
 let normalized:unknown=command;

  if(command.kind==="schedule")validateSchedule(command.content);
  if(command.kind==="forecast"||command.kind==="response"){
   const before=await service.rpc("read_contract_delivery",{p_engagement_id:engagementId,p_actor_id:actorId});
   if(before.error)throw new Error("Forecast source version is unavailable");
   const fresh=await service.rpc("read_contract_management",{p_engagement_id:engagementId,p_actor_id:actorId});
   if(fresh.error)throw new Error("Forecast inputs are unavailable");
   const after=await service.rpc("read_contract_delivery",{p_engagement_id:engagementId,p_actor_id:actorId});
   const state=fresh.data as ContractState;
   if(after.error||!state.delivery||(before.data as DeliveryState).inputHash!==state.delivery.inputHash||state.delivery.inputHash!==(after.data as DeliveryState).inputHash)throw new Error("Forecast inputs changed during reading. Reload and review again.");
   if(command.kind==="forecast"&&command.expectedInputHash!==state.delivery.inputHash)throw new Error("The forecast data changed since you opened this page. Reload and review the changed assumptions.");
   const cleanState={...state,rates:[],snapshots:[],imports:[],accountingImports:[],accountingReviews:[],access:[],responses:undefined,closeout:undefined,delivery:undefined};
   const inputs={state:cleanState,delivery:{...state.delivery,forecasts:[]},options:command};
   normalized=command.kind==="response"?{...command,_request:command,_inputHash:state.delivery.inputHash,_comparison:compareResponse(state,command)}:{...command,_request:command,_inputHash:state.delivery.inputHash,_inputs:inputs,_result:forecastDelivery(cleanState,state.delivery,command)};
  }
  if(command.kind==="settlement"||command.kind==="closeout"){
   const first=await service.rpc("read_contract_management",{p_engagement_id:engagementId,p_actor_id:actorId});
   const state=first.data as ContractState;
   if(first.error||!state.closeout)throw new Error("Closeout source records are unavailable");
   // SQL replays the original result only after checking the actor and exact retained request.
   if(command.kind==="closeout"&&state.closeout.versions.some(v=>v.content.request?.requestId===command.requestId))return {...command,_request:command};
   const confirm=await service.rpc("read_contract_management",{p_engagement_id:engagementId,p_actor_id:actorId});
   if(confirm.error||state.closeout.inputHash!==(confirm.data as ContractState).closeout?.inputHash)throw new Error("Financial sources changed during reading. Reload and reconcile again.");
   if(command.kind==="settlement"){
    const prospective={...state,closeout:{...state.closeout,settlements:[...state.closeout.settlements,{id:command.requestId,version:command.expectedVersion+1,content:command.content,source_receipt:{id:command.content.documentId,checksum:"pending SQL custody",storageRef:"",bytes:null},created_at:new Date().toISOString()}]}};
    const content=command.content,position=settlementPosition(prospective),invoice=position.find(i=>i.id===content.invoiceId&&i.direction===content.direction);
    if(!invoice)throw new Error("An approved received invoice or issued outgoing invoice is required");
    if(cents(invoice.retention)<BigInt(0)||cents(invoice.disputed)<BigInt(0)||cents(invoice.refunds)>cents(invoice.payments))throw new Error(invoice.warnings.join(" "));
    normalized={...command,_request:command,_inputHash:state.closeout.inputHash,_position:position};
   }else{
    if(command.expectedInputHash!==state.closeout.inputHash)throw new Error("The closeout data changed since you opened this page. Reload and review the changed position.");
    const position=closeoutPosition(state,command),safeState={...state,rates:[],access:[],imports:[],snapshots:[],closeout:{...state.closeout,versions:state.closeout.versions.map(v=>({id:v.id,version:v.version,state:v.state,content_hash:v.content_hash,previous_id:v.previous_id}))}};
    normalized={...command,_request:command,_inputHash:state.closeout.inputHash,_position:position,_package:{formatVersion:3,state:safeState,position,request:command}};
   }
  }
  if(command.kind==="accounting_import")normalized=parseAccountingImport(command);
 return normalized;
}
