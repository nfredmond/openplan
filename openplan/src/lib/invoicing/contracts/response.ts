import { forecastDelivery, validateSchedule } from "./delivery";
import type { ContractState } from "./schema";
import type { ResponseCommand } from "./response-schema";

/** A comparison retains PM assumptions separately from accepted staff submissions. */
export function compareResponse(state:ContractState,command:ResponseCommand){
 const delivery=state.delivery,forecast=delivery?.forecasts.at(-1);
 if(!delivery||!forecast||forecast.id!==command.forecastId||forecast.input_hash!==delivery.inputHash)throw new Error("Compare against the current reviewed forecast with unchanged inputs.");
 const record=state.responses?.records.find(r=>r.id===command.recordId&&r.recordType===command.recordType);
 if(!record||record.updated_at!==command.recordUpdatedAt||record.recordHash!==command.recordHash)throw new Error("The linked project risk, issue or decision changed. Reload it before comparison.");
 validateSchedule(command.schedule);
 const keys=command.workAssumptions.map(a=>`${a.update.taskId}:${a.update.staffId}`);
 if(new Set(keys).size!==keys.length)throw new Error("Use one explicit assumption per task and staff assignment.");
 for(const assumption of command.workAssumptions)if(!command.schedule.nodes.some(n=>n.taskId===assumption.update.taskId&&n.staff.some(s=>s.staffId===assumption.update.staffId)))throw new Error("Each work assumption must belong to the proposed schedule.");
 const proposed={...delivery,assignments:command.schedule.nodes.flatMap(n=>n.staff.map(p=>({taskId:n.taskId,staffId:p.staffId}))),scheduleVersions:[{id:command.requestId,version:1,content:command.schedule,created_at:forecast.created_at}],workUpdates:[...delivery.workUpdates,...command.workAssumptions.map((a,index)=>({id:`assumption:${index}`,version:Math.max(0,...delivery.workUpdates.map(u=>u.version))+1,task_id:a.update.taskId,staff_id:a.update.staffId,state:"accepted" as const,content:a.update,remaining_cost:a.remainingCost,remaining_gross_billing:a.remainingGrossBilling,valuation_evidence:a.valuationEvidence,evidence:"PM scenario assumption only; no staff acceptance",created_at:forecast.created_at}))]};
 const options={asOf:forecast.content.result.asOf,horizonEnd:forecast.content.result.horizonEnd,coverageComplete:forecast.content.result.coverageComplete};
 const safeState={...state,rates:[],snapshots:[],imports:[],accountingImports:[],accountingReviews:[],access:[],responses:undefined,closeout:undefined,delivery:undefined};
 return {request:command,record,inputs:{state:safeState,delivery:{...proposed,forecasts:[]},options},before:forecast.content.result,after:forecastDelivery(safeState,proposed,options)};
}
