import { describe, expect, it } from "vitest";
import { workProgramDifferenceLabel, workProgramDifferenceValue, workProgramDifferences, workflowCommandSchema } from "@/lib/programs/work-program/workflow";
import { workProgramPacketRows, addWorkProgramPacketHtml, addWorkProgramPacketWorkbook, type WorkProgramPacket } from "@/lib/programs/work-program/workflow-export";
import { MY_WORK_SOURCES } from "@/lib/my-work/sources";
import type { WorkProgramDraft } from "@/lib/programs/work-program/schema";
import type { WorkProgramRevision } from "@/lib/programs/work-program/types";
import * as XLSX from "xlsx";
const draft = { schemaVersion:1, documentKind:"owp",agency:"Synthetic review",responsibleAuthority:"Exercise only",authorityBasis:"",periodStart:"2026-07-01",periodEnd:"2027-06-30", introduction:"",staffing:"",financialNotes:"",currency:"USD",priorBalance:null,priorBalanceBasis:"",elements:[] } satisfies WorkProgramDraft;
const revision = {id:"11111111-1111-4111-8111-111111111111",revision:2,previous_revision_id:null,request_id:"22222222-2222-4222-8222-222222222222",content_json:draft,content_sha256:"a".repeat(64),source_ids:[],created_by:"33333333-3333-4333-8333-333333333333",created_at:"2026-09-07T00:00:00Z"} satisfies WorkProgramRevision;
const packet: WorkProgramPacket={id:"packet",snapshot_hash:"b".repeat(64),created_at:revision.created_at,snapshot:{revisionId:revision.id,revisionHash:revision.content_sha256,sequence:0,audience:"internal",baseline:{...revision,revision:1,content_json:{...draft,priorBalance:0}},events:[]}};
describe("OWP review records",()=>{
 it("distinguishes unknown, zero, additions and removals without changing source content",()=>{
  const before=JSON.stringify(draft);
  expect(workProgramDifferences({...draft,priorBalance:0},draft)).toEqual([{path:"priorBalance",before:0,after:null}]);
  expect(workProgramDifferences(draft,{...draft,introduction:"New scope"})).toEqual([{path:"introduction",before:"",after:"New scope"}]);
  expect(JSON.stringify(draft)).toBe(before);
 });
 it("does not hide changed rows with duplicate structured identities",()=>{
  const before={...draft,elements:[{id:'duplicate',title:'First'},{id:'duplicate',title:'Second'}]} as WorkProgramDraft;
  const after={...draft,elements:[{id:'duplicate',title:'Changed first'},{id:'duplicate',title:'Second'}]} as WorkProgramDraft;
  expect(workProgramDifferences(before,after)).toEqual([{path:'elements[row 1; duplicate identity].title',before:'First',after:'Changed first'}]);
 });
 it("explains amendment fields and distinguishes unknown, absent, zero and blank",()=>{
  expect(workProgramDifferenceLabel('preparation.costs[WE100 reference].amount')).toBe('Financial preparation / Expenditure — WE100 reference / Amount');
  expect(workProgramDifferenceLabel('elements[100 Administration].products[Draft report].schedule')).toBe('Work element — 100 Administration / Product — Draft report / Schedule');
  expect(workProgramDifferenceValue(workProgramDifferences(draft,{...draft,newField:'Absent'} as WorkProgramDraft)[0].before)).toBe('Not present in this version');
  expect([null,undefined,0,'',76641.63].map(workProgramDifferenceValue)).toEqual(['Unresolved','Not present in this version','0','Not recorded','76,641.63']);
 });
 it("exports exact revision identity, differences and escaped user text as workbook text",()=>{
  const changed={...revision,content_json:{...draft,introduction:'<script>bad()</script>'}};
  const rows=workProgramPacketRows(packet,changed);
  expect(rows.flat().join('\n')).toContain('Before: 0\nAfter: Unresolved');
  expect(addWorkProgramPacketHtml('<body></body>',packet,changed)).toContain('&lt;script&gt;bad()&lt;/script&gt;');
  const workbook=addWorkProgramPacketWorkbook(XLSX.utils.book_new(),packet,changed);
  expect(workbook.Sheets['Review and amendment record'].B3.v).toBe(revision.content_sha256);
  expect(()=>workProgramPacketRows({...packet,snapshot:{...packet.snapshot,revisionHash:'c'.repeat(64)}},revision)).toThrow('identity mismatch');
 });
 it("requires strict exact-version commands and real calendar dates",()=>{
  const command={requestId:revision.request_id,expectedSequence:0,expectedRevision:2,revisionId:revision.id,revisionHash:revision.content_sha256,kind:'comment',note:'Review scope',visibility:'internal'};
  expect(workflowCommandSchema.safeParse(command).success).toBe(true);
  expect(workflowCommandSchema.safeParse({...command,evidenceDate:'2026-02-30'}).success).toBe(false);
  expect(workflowCommandSchema.safeParse({...command,spendingApproved:true}).success).toBe(false);
 });
 it("shows assigned undated review in My Work and links to the real program",()=>{
  const source=MY_WORK_SOURCES.find(row=>row.id==='work_program_reviews')!;
  expect(source.select).toContain('assignee_user_id, due_on, status');
  expect(source.staticFilters).toEqual([{kind:'in',column:'status',values:['pending','returned']}]);
  const item=source.toItems([{id:'review',program_id:'program',assignee_user_id:'reviewer',due_on:null,status:'pending',programs:{title:'Synthetic OWP'}}],{now:new Date('2026-09-07'),limitPerSource:10})[0];
  expect(item).toMatchObject({block:'undated',dueOn:null,href:'/programs/program/work-program#work-program-review',title:'Review Synthetic OWP',assigneeUserId:'reviewer',badge:{label:'OWP review',tone:'neutral'}});
 });
});
