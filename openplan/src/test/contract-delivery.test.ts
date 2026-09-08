import { describe,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { forecastDelivery,isWorkingDate,nextDate,validateSchedule } from "@/lib/invoicing/contracts/delivery";
import { contractSnapshotTables,contractSnapshotWorkbook } from "@/lib/invoicing/contracts/export";
import { deliveryFixture as fixture } from "./fixtures/contract-delivery";
describe("reviewed contract delivery",()=>{
 it("exports versioned forecast dates, assumptions, capacity and exact reviewed input identities",()=>{
  const f=fixture(),reviewed=randomUUID();f.delivery.workUpdates[0].reviewed_update_id=reviewed;f.delivery.forecasts=[{id:randomUUID(),version:1,input_hash:f.delivery.inputHash,created_at:"2026-09-08T01:00:00Z",content:{inputs:{state:f.state},result:forecastDelivery(f.state,f.delivery,f.options),reviewEvidence:"Synthetic reviewed forecast",coverageEvidence:"Synthetic complete source coverage"}}];
  const report={id:randomUUID(),title:"Synthetic agency PM report",created_at:"2026-09-08T02:00:00Z",snapshot_hash:"c".repeat(64),snapshot:{...f.state,schemaVersion:3 as const,delivery:f.delivery,asOf:f.options.asOf,sourceCutoff:"2026-09-08T02:00:00Z",coverageComplete:true,coverageEvidence:"Synthetic",baselineId:f.state.baselines[0].id,originalBaselineId:f.state.baselines[0].id}};
  const tables=contractSnapshotTables(report);expect(tables.find(t=>t.name==="Reviewed forecasts")?.rows[1].slice(4,8)).toEqual(["2026-09-13","100.01","100.01","200.02"]);expect(tables.find(t=>t.name==="Forecast dates")?.rows[2].slice(5,7)).toEqual(["2026-09-12","2026-09-13"]);expect(tables.find(t=>t.name==="Staff work review history")?.rows[1][14]).toBe(reviewed);expect(contractSnapshotWorkbook(report).SheetNames).toContain("Shared capacity");
 });

 it("uses explicit unavailable days, exact effort, finish-to-start reviews and distinct dates",()=>{
  const f=fixture(),r=forecastDelivery(f.state,f.delivery,f.options);
  expect(r.nodes[0]).toMatchObject({start:"2026-09-08",finish:"2026-09-11",originalApprovedFinish:"2026-09-30",currentApprovedFinish:"2026-09-30",actualStart:"2026-09-01",actualFinish:null});
  expect(r.nodes[1]).toMatchObject({start:"2026-09-12",finish:"2026-09-13"});expect(r.finish).toBe("2026-09-13");expect(r.remainingCost).toBe("100.01");expect(r.actualPlusRemaining).toBe("100.01");expect(r.remainingGrossBilling).toBe("200.02");
  f.schedule.nodes[1].durationKind="working";expect(forecastDelivery(f.state,f.delivery,f.options).finish).toBe("2026-09-15");
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
