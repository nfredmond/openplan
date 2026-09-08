import { cents, decimalText as money } from "@/lib/programs/work-program/reporting";
import { reconcileContract } from "./reconciliation";
import type { ContractState } from "./schema";
import type { DeliveryState, ForecastResult, ForecastWarning, Schedule, WorkingCalendar, WorkUpdateVersion } from "./delivery-schema";

const DAY=86_400_000;
export function nextDate(value:string,days=1){return new Date(Date.parse(`${value}T00:00:00Z`)+days*DAY).toISOString().slice(0,10);}
export function isWorkingDate(calendar:WorkingCalendar,value:string){const exception=calendar.exceptions.find(e=>e.date===value);return exception?exception.working:calendar.weekdays.includes(new Date(`${value}T00:00:00Z`).getUTCDay());}
function unique(values:string[]){return new Set(values).size===values.length;}
export function validateSchedule(schedule:Schedule){
 const nodes=new Map(schedule.nodes.map(n=>[n.id,n]));
 if(nodes.size!==schedule.nodes.length||!unique(schedule.nodes.filter(n=>n.kind==="work").map(n=>n.taskId)))throw new Error("Use unique schedule identities and one work node per task.");
 const visiting=new Set<string>(),done=new Set<string>();
 function visit(id:string){if(visiting.has(id))throw new Error("Finish-to-start dependencies form a cycle.");if(done.has(id))return;const node=nodes.get(id);if(!node)throw new Error("A dependency points to a missing schedule node.");visiting.add(id);for(const p of node.predecessors)visit(p);visiting.delete(id);done.add(id);}
 for(const node of schedule.nodes){
  if(node.reserveThrough<node.notBefore||nextDate(node.notBefore,730)<node.reserveThrough)throw new Error("Choose an ordered reservation window of at most 730 days.");
  if(!unique(node.staff.map(s=>s.staffId))||!unique(node.predecessors))throw new Error("Staff and dependencies must be unique within a task.");
  if(node.staff.some(s=>cents(s.hoursPerDay)<=BigInt(0)||cents(s.hoursPerDay)>BigInt(2400)))throw new Error("Daily reservations must be greater than zero and at most 24 hours.");
  if(node.kind!=="work"&&node.staff.length)throw new Error("Outside review periods do not reserve internal staff. Add a separate review-work task for staff effort.");
  if(!unique(node.calendar.weekdays.map(String))||!unique(node.calendar.exceptions.map(e=>e.date)))throw new Error("Calendar weekdays and exceptions must be unique.");
  visit(node.id);
 }
 if(schedule.billingTreatment!=="unassessed"&&(!schedule.billingSourceId||!schedule.billingEvidence))throw new Error("Document the agreement terms before forecasting gross billing.");
}

/** Compute only from reviewed work and explicit reservations. No resource optimizer or implied holidays. */
export function forecastDelivery(state:ContractState,delivery:DeliveryState,options:{asOf:string;horizonEnd:string;coverageComplete:boolean}):ForecastResult{
 const {asOf,horizonEnd}=options;
 if(horizonEnd<asOf||horizonEnd>nextDate(asOf,730))throw new Error("Forecast horizon must be between the as-of date and 730 days later.");
 const schedule=delivery.scheduleVersions.toSorted((a,b)=>a.version-b.version).at(-1)?.content;
 const warnings:ForecastWarning[]=[],results:ForecastResult["nodes"]=[],reservations:ForecastResult["reservations"]=[];
 function warn(code:string,message:string,nodeId:string|null=null,staffId:string|null=null,date:string|null=null){if(!warnings.some(w=>w.code===code&&w.nodeId===nodeId&&w.staffId===staffId&&w.date===date))warnings.push({code,message,nodeId,staffId,date});}
 const empty:ForecastResult={formatVersion:1,asOf,horizonEnd,finish:null,remainingCost:null,actualPlusRemaining:null,remainingGrossBilling:null,coverageComplete:options.coverageComplete,warnings,nodes:results,reservations};
 if(!schedule){warn("missing_schedule","A reviewed schedule has not been retained.");return empty;}
 validateSchedule(schedule);
 const baseline=state.baselines.filter(b=>b.state==="approved").toSorted((a,b)=>a.version-b.version).at(-1),original=state.baselines.filter(b=>b.state==="approved").toSorted((a,b)=>a.version-b.version)[0];
 if(!baseline){warn("missing_baseline","An approved task baseline is required.");return empty;}
 const updates=new Map<string,WorkUpdateVersion>();
 for(const update of delivery.workUpdates.toSorted((a,b)=>a.version-b.version))updates.set(`${update.task_id}:${update.staff_id}`,update);
 const capacities=new Map<string,DeliveryState["capacityVersions"][number]>();
 for(const cap of delivery.capacityVersions.toSorted((a,b)=>a.version-b.version))capacities.set(`${cap.staff_id}:${cap.content.startsOn}`,cap);
 const allReservations=new Map<string,bigint>();
 for(const r of delivery.outsideReservations){const key=`${r.staffId}:${r.date}`;allReservations.set(key,(allReservations.get(key)??BigInt(0))+cents(r.hours));}
 function capacity(staffId:string,date:string):bigint|null{
  const periods=[...capacities.values()].filter(p=>p.staff_id===staffId&&p.content.startsOn<=date&&p.content.endsOn>=date);
  if(periods.length!==1)return null;
  return isWorkingDate(periods[0].content.calendar,date)?cents(periods[0].content.hoursPerDay):BigInt(0);
 }
 for(const node of schedule.nodes)for(const person of node.staff){
  for(let date=node.notBefore<asOf?asOf:node.notBefore;date<=node.reserveThrough&&date<=horizonEnd;date=nextDate(date)){
   if(!isWorkingDate(node.calendar,date))continue;
   const cap=capacity(person.staffId,date);if(cap===BigInt(0))continue;
   const key=`${person.staffId}:${date}`,hours=cents(person.hoursPerDay);allReservations.set(key,(allReservations.get(key)??BigInt(0))+hours);reservations.push({staffId:person.staffId,date,hours:money(hours)});
  }
 }
 let knownCost=BigInt(0),knownBilling=BigInt(0),costCovered=true,billingCovered=schedule.billingTreatment==="time_materials"&&(!baseline.content.billingDirection||["outgoing","received"].includes(baseline.content.billingDirection));
 for(const task of baseline.content.tasks)if(!schedule.nodes.some(n=>n.taskId===task.id&&n.kind==="work")){costCovered=false;billingCovered=false;warn("missing_task",`${task.title} has no remaining-work schedule.`);}
 const visited=new Set<string>();
 function calculate(node:Schedule["nodes"][number]){
  if(visited.has(node.id))return;visited.add(node.id);
  for(const predecessor of node.predecessors)calculate(schedule!.nodes.find(n=>n.id===predecessor)!);
  const task=baseline!.content.tasks.find(t=>t.id===node.taskId);
  const result:ForecastResult["nodes"][number]={id:node.id,title:node.title,taskId:node.taskId,start:null,finish:null,originalApprovedFinish:original?.content.tasks.find(t=>t.id===node.taskId)?.deadline??null,currentApprovedFinish:task?.deadline??null,actualStart:null,actualFinish:null};results.push(result);
  let supported=!!task,start=node.notBefore>asOf?node.notBefore:asOf;
  for(const predecessor of node.predecessors){const prior=results.find(r=>r.id===predecessor)!;if(!prior.finish){supported=false;warn("unsupported_predecessor","A predecessor has no supported finish.",node.id);}else if(nextDate(prior.finish)>start)start=nextDate(prior.finish);}
  if(node.kind!=="work"){
   if(node.reviewStatus!=="available"){warn("review_unavailable","The outside reviewer is unavailable or availability has not been assessed.",node.id);return;}
   if(node.durationDays===null||!node.reviewEvidence){warn("missing_review_duration","Document this outside review period and its duration.",node.id);return;}
   if(!supported)return;
   let remaining=node.durationDays;
   for(let date=start;date<=horizonEnd&&date<=node.reserveThrough;date=nextDate(date)){
    if(node.durationKind==="working"&&!isWorkingDate(node.calendar,date))continue;
    result.start??=date;if(remaining===0||--remaining===0){result.finish=date;break;}
   }
  }else{
   const remaining=new Map<string,bigint>();
   if(!node.staff.length){supported=false;costCovered=false;billingCovered=false;warn("missing_assignment","Assign staff and review their remaining effort, including zero-hour work.",node.id);}
   for(const person of node.staff){
    const update=updates.get(`${node.taskId}:${person.staffId}`),staff=state.staff.find(s=>s.id===person.staffId);
    if(delivery.assignments&&!delivery.assignments.some(a=>a.taskId===node.taskId&&a.staffId===person.staffId)){supported=false;warn("changed_assignment","The working schedule no longer matches the active task assignment. Review the schedule after reassignment or amendment.",node.id,person.staffId);}
    if(!staff?.active){supported=false;warn("departed_staff","Assigned staff is inactive or unavailable in this assignment.",node.id,person.staffId);}
    if(!update||update.state!=="accepted"||update.content.asOf>asOf){supported=false;costCovered=false;billingCovered=false;warn("unreviewed_update","An exact-version remaining-work update needs PM acceptance.",node.id,person.staffId);continue;}
    if(update.content.asOf<schedule!.updateDueOn&&asOf>schedule!.updateDueOn){supported=false;warn("overdue_update","The reviewed update predates the required reporting date.",node.id,person.staffId,schedule!.updateDueOn);}
    if(update.content.hours===null){supported=false;warn("missing_effort","Remaining effort is unassessed.",node.id,person.staffId);}else remaining.set(person.staffId,cents(update.content.hours));
    if(update.content.status==="blocked"){supported=false;warn("blocker",update.content.blockers||"Staff reported blocked work.",node.id,person.staffId);}
    if(update.content.availableHoursPerDay===null||cents(update.content.availableHoursPerDay)<cents(person.hoursPerDay)){supported=false;warn("availability_update","The reservation exceeds staff-reported availability, or availability is unassessed.",node.id,person.staffId);}
    if(update.remaining_cost===null||!update.valuation_evidence)costCovered=false;else knownCost+=cents(update.remaining_cost);
    if(update.remaining_gross_billing===null||!update.valuation_evidence)billingCovered=false;else knownBilling+=cents(update.remaining_gross_billing);
    if(update.content.actualStart&&(result.actualStart===null||result.actualStart>update.content.actualStart))result.actualStart=update.content.actualStart;
   }
   const nodeUpdates=node.staff.map(p=>updates.get(`${node.taskId}:${p.staffId}`));
   if(nodeUpdates.length&&nodeUpdates.every(u=>u?.state==="accepted"&&u.content.actualFinish))result.actualFinish=nodeUpdates.map(u=>u!.content.actualFinish!).sort().at(-1)!;
   if(!supported)return;
   if([...remaining.values()].every(h=>h===BigInt(0))){result.start=start;result.finish=result.actualFinish??start;}else{
   for(let date=start;date<=horizonEnd&&date<=node.reserveThrough;date=nextDate(date)){
    if(!isWorkingDate(node.calendar,date))continue;
    let dayWorked=false;
    for(const person of node.staff){
     if((remaining.get(person.staffId)??BigInt(0))===BigInt(0))continue;
     const cap=capacity(person.staffId,date),reserved=allReservations.get(`${person.staffId}:${date}`)??BigInt(0);
     if(cap===null){supported=false;warn("missing_capacity","Dated availability is missing or overlapping.",node.id,person.staffId,date);continue;}
     if(cap===BigInt(0))continue;
     if(reserved>cap){supported=false;warn("capacity_conflict",`Total reserved ${money(reserved)} hours exceeds available ${money(cap)} hours. Other assignments disclose hours only.`,node.id,person.staffId,date);continue;}
     const left=remaining.get(person.staffId)!;remaining.set(person.staffId,left>cents(person.hoursPerDay)?left-cents(person.hoursPerDay):BigInt(0));dayWorked=true;
    }
    if(dayWorked)result.start??=date;
    if([...remaining.values()].every(h=>h===BigInt(0))){if(supported)result.finish=date;break;}
   }
   }
  }
  if(!result.finish)warn("unresolved_finish","Work does not have a supported finish inside its reservation and forecast horizon.",node.id);
  if(result.finish&&result.currentApprovedFinish&&result.finish>result.currentApprovedFinish)warn("deadline_threat","The forecast finish exceeds the current approved task deadline.",node.id,null,result.finish);
 }
 for(const node of schedule.nodes)calculate(node);
 const reconciliation=reconcileContract(state,{asOf}),sourceCovered=options.coverageComplete&&!reconciliation.unresolved.length&&!state.unmappedTime.length&&!state.unmappedSpend.length&&!state.unmappedSpendCount;
 const remainingCost=costCovered?money(knownCost):null,actualPlusRemaining=sourceCovered&&remainingCost!==null?money(cents(reconciliation.total.incurred)+knownCost):null;
 if(!costCovered)warn("cost_coverage","Remaining cost lacks a reviewed valuation for some assigned work.");
 if(!sourceCovered)warn("actual_coverage","Actual-plus-remaining cost requires complete reconciled source coverage.");
 if(actualPlusRemaining!==null&&baseline.content.cost!==null&&cents(actualPlusRemaining)>cents(baseline.content.cost))warn("cost_threat","Actual-plus-remaining cost exceeds the current approved internal cost budget.");
 if(billingCovered&&reconciliation.grossBilled!==null&&baseline.content.fee!==null&&cents(reconciliation.grossBilled)+knownBilling>cents(baseline.content.fee))warn("fee_threat","Documented gross billing plus reviewed remaining gross billing exceeds the approved fee.");
 return {...empty,finish:results.length&&results.every(n=>n.finish)&&!warnings.some(w=>w.code==="missing_task")?results.map(n=>n.finish!).sort().at(-1)!:null,remainingCost,actualPlusRemaining,remainingGrossBilling:billingCovered?money(knownBilling):null};
}
