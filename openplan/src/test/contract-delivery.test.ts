import { describe,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { forecastDelivery,isWorkingDate,nextDate,validateSchedule } from "@/lib/invoicing/contracts/delivery";
import { contractSnapshotTables,contractSnapshotWorkbook } from "@/lib/invoicing/contracts/export";
import { deliveryFixture as fixture } from "./fixtures/contract-delivery";
describe("reviewed contract delivery",()=>{
 it("sums this assignment's shared daily reservations once while keeping outside hours separate",()=>{
  const f=fixture(),secondTask=randomUUID(),secondNode=randomUUID();
  f.state.baselines[0].content.tasks.push({...f.state.baselines[0].content.tasks[0],id:secondTask});
  f.schedule.nodes.push({...f.schedule.nodes[0],id:secondNode,taskId:secondTask,staff:[{staffId:f.staff,hoursPerDay:"0.01"}]});
  f.delivery.assignments!.push({taskId:secondTask,staffId:f.staff});
  f.delivery.workUpdates.push({...f.delivery.workUpdates[0],id:randomUUID(),task_id:secondTask,content:{...f.delivery.workUpdates[0].content,taskId:secondTask}});
  f.delivery.outsideReservations=[{staffId:f.staff,date:"2026-09-08",hours:"4.00"}];
  const input=JSON.stringify(f.delivery),result=forecastDelivery(f.state,f.delivery,f.options);
  expect(result.formatVersion).toBe(2);
  expect(result.reservations.filter(r=>r.staffId===f.staff&&r.date==="2026-09-08")).toEqual([{staffId:f.staff,date:"2026-09-08",hours:"4.01"}]);
  expect(new Set(result.reservations.map(r=>`${r.staffId}:${r.date}`)).size).toBe(result.reservations.length);
  expect(result.warnings).toContainEqual(expect.objectContaining({code:"capacity_conflict",staffId:f.staff,date:"2026-09-08",message:expect.stringContaining("8.01")}));
  expect(result.finish).toBeNull();expect(JSON.stringify(f.delivery)).toBe(input);
 });
 it("keeps dated capacity revisions, overlapping periods and changed inputs distinct across calculations",()=>{
  const f=fixture(),cap=f.delivery.capacityVersions[0];
  f.delivery.capacityVersions.push({...cap,id:randomUUID(),version:2,content:{...cap.content,hoursPerDay:"4.00"}});
  f.delivery.outsideReservations=[{staffId:f.staff,date:"2026-09-08",hours:"0.01"},{staffId:f.staff,date:"2026-09-10",hours:"0.01"}];
  const input=JSON.stringify(f.delivery),first=forecastDelivery(f.state,f.delivery,f.options);
  expect(first.finish).toBeNull();expect(first.warnings.filter(w=>w.code==="capacity_conflict").map(w=>w.date)).toEqual(["2026-09-08","2026-09-10"]);
  expect(first.reservations.some(r=>r.date==="2026-09-09")).toBe(false);
  expect(JSON.stringify(f.delivery)).toBe(input);
  f.delivery.capacityVersions[1].content.hoursPerDay="8.00";
  expect(forecastDelivery(f.state,f.delivery,f.options).finish).toBe("2026-09-13");
  f.delivery.capacityVersions.push({...cap,id:randomUUID(),version:3,content:{...cap.content,startsOn:"2026-09-10",endsOn:"2026-09-10"}});
  const overlap=forecastDelivery(f.state,f.delivery,f.options);
  expect(overlap.finish).toBeNull();expect(overlap.warnings.filter(w=>w.code==="missing_capacity").map(w=>w.date)).toEqual(["2026-09-10"]);
 });
 it("exports versioned forecast dates, assumptions, capacity and exact reviewed input identities",()=>{
  const f=fixture(),reviewed=randomUUID();f.delivery.workUpdates[0].reviewed_update_id=reviewed;f.delivery.forecasts=[{id:randomUUID(),version:1,input_hash:f.delivery.inputHash,created_at:"2026-09-08T01:00:00Z",content:{inputs:{state:f.state},result:forecastDelivery(f.state,f.delivery,f.options),reviewEvidence:"Synthetic reviewed forecast",coverageEvidence:"Synthetic complete source coverage"}}];
  const report={id:randomUUID(),title:"Synthetic agency PM report",created_at:"2026-09-08T02:00:00Z",snapshot_hash:"c".repeat(64),snapshot:{...f.state,schemaVersion:3 as const,delivery:f.delivery,asOf:f.options.asOf,sourceCutoff:"2026-09-08T02:00:00Z",coverageComplete:true,coverageEvidence:"Synthetic",baselineId:f.state.baselines[0].id,originalBaselineId:f.state.baselines[0].id}};
  const tables=contractSnapshotTables(report);expect(tables.find(t=>t.name==="Reviewed forecasts")?.rows[1].slice(4,8)).toEqual(["2026-09-13","100.01","100.01","200.02"]);expect(tables.find(t=>t.name==="Forecast dates")?.rows[2].slice(5,7)).toEqual(["2026-09-12","2026-09-13"]);expect(tables.find(t=>t.name==="Staff work review history")?.rows[1][14]).toBe(reviewed);expect(contractSnapshotWorkbook(report).SheetNames).toContain("Shared capacity");
  const current={...report,snapshot:{...report.snapshot,schemaVersion:5 as const}};let budget=contractSnapshotTables(current).find(t=>t.name==="Budget and billing")!;expect(budget.rows.find(r=>r[0]==="Reviewed forecast remaining cost")?.[1]).toBe("100.01");expect(budget.rows.find(r=>r[0]==="Unbilled gross fee")?.[1]).toBe("1000.00");current.snapshot.delivery.inputHash="stale";budget=contractSnapshotTables(current).find(t=>t.name==="Budget and billing")!;expect(budget.rows.find(r=>r[0]==="Reviewed forecast remaining cost")?.[1]).toBeNull();
 });

 it("uses explicit unavailable days, exact effort, finish-to-start reviews and distinct dates",()=>{
  const f=fixture(),r=forecastDelivery(f.state,f.delivery,f.options);
  expect(r.nodes[0]).toMatchObject({start:"2026-09-08",finish:"2026-09-11",originalApprovedFinish:"2026-09-30",currentApprovedFinish:"2026-09-30",actualStart:"2026-09-01",actualFinish:null});
  expect(r.nodes[1]).toMatchObject({start:"2026-09-12",finish:"2026-09-13"});expect(r.finish).toBe("2026-09-13");expect(r.remainingCost).toBe("100.01");expect(r.actualPlusRemaining).toBe("100.01");expect(r.remainingGrossBilling).toBe("200.02");
  f.schedule.nodes[1].durationKind="working";expect(forecastDelivery(f.state,f.delivery,f.options).finish).toBe("2026-09-15");
 });
 it("withholds a forecast after an amendment or reassignment changes the active staff assignment",()=>{
  const f=fixture();f.delivery.assignments=[];const r=forecastDelivery(f.state,f.delivery,f.options);expect(r.finish).toBeNull();expect(r.warnings.map(w=>w.code)).toContain("changed_assignment");
 });
 it("keeps a missed approved deadline visible when reviewed remaining effort reaches zero",()=>{
  const f=fixture();f.options.asOf="2026-09-12";const update=f.delivery.workUpdates[0];update.content={...update.content,asOf:"2026-09-12",hours:"0.00",status:"reported_complete",actualFinish:"2026-09-11"};update.remaining_cost="0.00";f.state.baselines[0].content.tasks[0].deadline="2026-09-10";
  const result=forecastDelivery(f.state,f.delivery,f.options);expect(result.nodes[0].finish).toBe("2026-09-11");expect(result.warnings).toContainEqual(expect.objectContaining({code:"deadline_threat",nodeId:f.schedule.nodes[0].id,date:"2026-09-11"}));
 });
 it("handles leap dates and explicitly working weekends without assumed holidays",()=>{
  expect(nextDate("2028-02-28")).toBe("2028-02-29");expect(nextDate("2028-02-29")).toBe("2028-03-01");
  const c=fixture().calendar;c.exceptions.push({date:"2026-09-12",working:true,reason:"Explicit weekend availability"});expect(isWorkingDate(c,"2026-09-12")).toBe(true);expect(isWorkingDate(c,"2026-09-09")).toBe(false);
 });
 it("rejects dependency cycles, missing nodes and duplicate task effort",()=>{
  for(const kind of ["cycle","missing","duplicate"]){const f=fixture();if(kind==="cycle")f.schedule.nodes[0].predecessors=[f.review];if(kind==="missing")f.schedule.nodes[0].predecessors=[randomUUID()];if(kind==="duplicate")f.schedule.nodes.push({...f.schedule.nodes[0],id:randomUUID()});expect(()=>validateSchedule(f.schedule)).toThrow(/cycle|missing|one work node/);}
 });
 it("withholds unsupported finishes for missing review duration, effort or capacity",()=>{
  for(const kind of ["duration","effort","capacity","overlap"]){const f=fixture();if(kind==="duration")f.schedule.nodes[1].durationDays=null;if(kind==="effort")f.delivery.workUpdates[0].content.hours=null;if(kind==="capacity")f.delivery.capacityVersions=[];if(kind==="overlap")f.delivery.capacityVersions.push({...f.delivery.capacityVersions[0],id:randomUUID(),version:2,content:{...f.delivery.capacityVersions[0].content,startsOn:"2026-09-02"}});expect(forecastDelivery(f.state,f.delivery,f.options).finish).toBeNull();}
 });
 it("withholds a finish when the outside reviewer is unavailable",()=>{const f=fixture();f.schedule.nodes[1].reviewStatus="unavailable";const r=forecastDelivery(f.state,f.delivery,f.options);expect(r.finish).toBeNull();expect(r.warnings.map(w=>w.code)).toContain("review_unavailable");});
 it("flags cross-project overload using reserved hours only and never silently optimizes it away",()=>{
  const f=fixture();f.delivery.outsideReservations=[{staffId:f.staff,date:"2026-09-08",hours:"4.01"}];const r=forecastDelivery(f.state,f.delivery,f.options);expect(r.finish).toBeNull();expect(r.warnings).toContainEqual(expect.objectContaining({code:"capacity_conflict",staffId:f.staff,date:"2026-09-08",message:expect.stringContaining("8.01")}));
  f.delivery.outsideReservations[0].hours="4.00";expect(forecastDelivery(f.state,f.delivery,f.options).finish).toBe("2026-09-13");
 });
 it("keeps newer unreviewed, overdue, blocked and departed-staff work visible",()=>{
  for(const kind of ["unreviewed","overdue","blocked","departed"]){const f=fixture();if(kind==="unreviewed")f.delivery.workUpdates.push({...f.delivery.workUpdates[0],id:randomUUID(),version:3,state:"submitted"});if(kind==="overdue"){f.options.asOf="2026-09-10";f.schedule.updateDueOn="2026-09-09";}if(kind==="blocked")f.delivery.workUpdates[0].content.status="blocked";if(kind==="departed")f.state.staff[0].active=false;const r=forecastDelivery(f.state,f.delivery,f.options);expect(r.finish).toBeNull();expect(r.warnings.map(w=>w.code)).toContain({unreviewed:"unreviewed_update",overdue:"overdue_update",blocked:"blocker",departed:"departed_staff"}[kind]);}
 });
 it("withholds incomplete costs and separates fixed fees from expected gross billing",()=>{
  const f=fixture();f.schedule.billingTreatment="fixed_fee";expect(forecastDelivery(f.state,f.delivery,f.options).remainingGrossBilling).toBeNull();f.delivery.workUpdates[0].remaining_cost=null;expect(forecastDelivery(f.state,f.delivery,f.options).actualPlusRemaining).toBeNull();
  f.delivery.workUpdates[0].remaining_cost="100.01";f.options.coverageComplete=false;expect(forecastDelivery(f.state,f.delivery,f.options).actualPlusRemaining).toBeNull();
 });
 it("explains added-work fee and date threats without changing approved baselines",()=>{
  const f=fixture();f.delivery.workUpdates[0].remaining_cost="500.01";f.delivery.workUpdates[0].remaining_gross_billing="1000.01";f.state.baselines.push({...f.state.baselines[0],id:randomUUID(),version:2,content:{...f.state.baselines[0].content,tasks:f.state.baselines[0].content.tasks.map(t=>({...t,deadline:"2026-09-10"}))}});const before=JSON.stringify(f.state.baselines),r=forecastDelivery(f.state,f.delivery,f.options);expect(r.warnings.map(w=>w.code)).toEqual(expect.arrayContaining(["cost_threat","fee_threat","deadline_threat"]));expect(r.nodes[0]).toMatchObject({originalApprovedFinish:"2026-09-30",currentApprovedFinish:"2026-09-10"});expect(JSON.stringify(f.state.baselines)).toBe(before);
 });
});
