import JSZip from "jszip";
import { describe,it,expect } from "vitest";
import { randomUUID } from "node:crypto";
import { utils } from "xlsx";
import { cents } from "@/lib/programs/work-program/reporting";
import { contractActualSchema,type ContractState,type ContractSnapshot,type ActualVersion } from "@/lib/invoicing/contracts/schema";
import { reconcileContract,reconcileSnapshot } from "@/lib/invoicing/contracts/reconciliation";
import { contractSnapshotHtml,contractSnapshotWorkbook,renderContractSnapshot,contractSnapshotTables } from "@/lib/invoicing/contracts/export";
import { previewContractCsv } from "@/lib/invoicing/contracts/import";
function fixture(){
 const task=randomUUID(),staff=randomUUID(),deliverable=randomUUID(),baseline=randomUUID(),entry=randomUUID();
 const command=contractActualSchema.parse({kind:"actual",requestId:randomUUID(),entryId:entry,expectedVersion:0,sourceKey:"SYNTH-1",sourceReference:"Synthetic timesheet",entryDate:"2026-09-01",category:"labor",status:"approved",description:"Synthetic effort, no actual client spending",staffId:staff,hours:"1.01",amount:"12.47",valuationBasis:"recorded",rateId:null,billable:false,timeEntryId:null,spendEntryId:null,owpVersionId:null,invoiceId:null,allocations:[{taskId:task,deliverableId:deliverable,share:10000}],correctionNote:"",openingStart:null,openingEnd:null,openingBasis:"",reconciliationNote:""});
 const actual:ActualVersion={id:randomUUID(),entry_id:entry,version:1,command,amount:"12.47",hours:"1.01",allocations:[{taskId:task,deliverableId:deliverable,share:10000,amount:"12.47",hours:"1.01"}],time_entry_id:randomUUID(),spend_entry_id:null,created_at:"2026-09-01T00:00:00Z"};
 const state:ContractState={role:"owner",engagement:{id:randomUUID(),workspace_id:randomUUID(),project_id:randomUUID(),title:"Synthetic assignment",parent_engagement_id:null,engagement_kind:"contract"},baselines:[{id:baseline,version:1,state:"approved",content:{title:"Original agreement",scope:"Synthetic scope",currency:"USD",fee:"1000.00",cost:"500.00",hours:"10.00",feeBasis:"gross_fee",feeTerms:"Confirmed synthetic gross basis",sourceDocuments:[randomUUID()],approvalEvidence:"Synthetic authorization",tasks:[{id:task,title:"Prepare draft",scope:"Synthetic report",fee:"1000.00",cost:"500.00",hours:"10.00",deadline:"2026-10-01",deliverableId:deliverable,staff:[{staffId:staff,cost:"500.00",hours:"10.00"}]}]},content_hash:"a".repeat(64),approval_evidence:"Synthetic authorization",created_at:"2026-08-31T00:00:00Z",approved_at:"2026-08-31T01:00:00Z"}],actuals:[actual],estimates:[{id:randomUUID(),task_id:task,version:1,command:{kind:"estimate",requestId:randomUUID(),expectedVersion:0,taskId:task,asOf:"2026-09-01",hours:"2.00",cost:"25.00",basis:"Independent remaining work review",progress:10,progressNote:"Draft outline prepared"},created_at:"2026-09-01T02:00:00Z"}],rates:[],staff:[{id:staff,name:"Synthetic staff",active:true,user_id:randomUUID()}],deliverables:[{id:deliverable,title:"Draft report"}],documents:[],invoices:[{id:randomUUID(),invoice_number:"SYNTH-INV-1",status:"sent",subtotal_amount:"100.00",retention_amount:"10.00",currency_code:"USD",invoice_date:"2026-09-01",sent_date:"2026-09-01",updated_at:"2026-09-01T02:00:00Z"}],billingSources:[],unmappedTime:[],unmappedSpend:[],snapshots:[]};
 const report:ContractSnapshot={id:randomUUID(),title:"Synthetic PM snapshot",created_at:"2026-09-02T00:00:00Z",snapshot_hash:"b".repeat(64),snapshot:{...state,asOf:"2026-09-01",sourceCutoff:"2026-09-02T00:00:00Z",coverageComplete:true,coverageEvidence:"Synthetic complete source register",baselineId:baseline,originalBaselineId:baseline}};
 return {state,actual,command,report,task};
}
describe("contract source reconciliation",()=>{
 it("versions agency snapshot exports and retains source matching and accounting evidence",()=>{
  const {report}=fixture();expect(contractSnapshotTables(report).some(t=>t.name==="Received invoices")).toBe(false);
  report.snapshot.schemaVersion=2;
  report.snapshot.masterTerms=[{id:randomUUID(),version:1,state:"approved",currency:"USD",ceiling:"1500.00",starts_on:"2026-01-01",ends_on:"2026-12-31",terms:"Synthetic master terms",approval_evidence:"Synthetic finance authority",source_document_id:randomUUID()}];
  report.snapshot.masterTerms[0].source_receipt={id:report.snapshot.masterTerms[0].source_document_id,checksum:"c".repeat(64),storageRef:"storage://kb-documents/synthetic-master",bytes:123};
  report.snapshot.receivedInvoices=[{id:randomUUID(),invoice_id:randomUUID(),version:2,state:"approved",content:{number:"SYNTH-RECEIVED",date:"2026-09-01",currency:"USD",total:"25.00",fileId:randomUUID(),lines:[{description:"Synthetic indirect cost",amount:"25.00",treatment:"indirect",basis:"Synthetic documented indirect basis"}]},matches:[{entryId:report.snapshot.actuals[0].entry_id,versionId:report.snapshot.actuals[0].id,amount:"25.00"}],review_note:"Synthetic finance matched",created_at:report.created_at}];
  report.snapshot.accountingImports=[{id:randomUUID(),filename:"synthetic-posted.csv",source_hash:"d".repeat(64),rows:[{externalId:"SYNTH-POST-1",sourceKey:"SYNTH-1",amount:"12.47",hours:"1.01",currency:"USD"}],created_at:report.created_at}];
  report.snapshot.orderPeriods=[{id:randomUUID(),baseline_id:report.snapshot.baselineId,version:1,authorization:{startsOn:"2026-01-01",endsOn:"2026-12-31",beneficiary:"Synthetic agency",funding:"Synthetic source",costBasis:"Retained labor basis",eligibility:"unassessed",eligibilityEvidence:""},evidence:"Legacy source reconciliation",source_document_id:randomUUID()}];
  const tables=contractSnapshotTables(report);
  expect(tables.find(t=>t.name==="Legacy period evidence")?.rows[1].slice(2,5)).toEqual(["2026-01-01","2026-12-31","Synthetic agency"]);
  expect(tables.find(t=>t.name==="Master source custody")?.rows[1].slice(2)).toEqual(["c".repeat(64),"storage://kb-documents/synthetic-master",123]);
  expect(tables.find(t=>t.name==="Master authorization")?.rows[1][3]).toBe("1500.00");
  expect(tables.find(t=>t.name==="Received source matching")?.rows[1].slice(2)).toEqual([report.snapshot.actuals[0].entry_id,report.snapshot.actuals[0].id,"25.00"]);
  expect(tables.find(t=>t.name==="Received cost treatment")?.rows[1].slice(2)).toEqual(["indirect","Synthetic indirect cost","25.00","Synthetic documented indirect basis"]);
  expect(tables.find(t=>t.name==="Accounting comparison")?.rows[1].slice(4)).toEqual(["SYNTH-POST-1","SYNTH-1","12.47","1.01","USD"]);
  expect(contractSnapshotHtml(report)).toContain("Synthetic documented indirect basis");
  expect(contractSnapshotWorkbook(report).SheetNames).toContain("Accounting comparison");
 });

 it("selects remaining-work versions independently of transaction timestamps",()=>{const {state}=fixture();const first=state.estimates[0];state.estimates.unshift({...first,id:randomUUID(),version:2,created_at:"2026-09-01T01:00:00Z",command:{...first.command,cost:"40.00",expectedVersion:1}});expect(reconcileContract(state,{coverageComplete:true}).remainingCost).toBe("40.00");});
 it("separates internal cost, commitments, gross billing, retention, partial payments and credits",()=>{
  const {state,actual}=fixture();
  for(const category of ["commitment","payment","credit"] as const)state.actuals.push({...actual,id:randomUUID(),entry_id:randomUUID(),time_entry_id:null,command:{...actual.command,category,sourceKey:category},amount:"5.00",hours:null,allocations:actual.allocations.map(a=>({...a,amount:"5.00",hours:null}))});
  const r=reconcileContract(state,{coverageComplete:true});expect(r.total).toEqual({incurred:"12.47",hours:"1.01",commitments:"5.00",payments:"5.00",credits:"5.00"});expect(r.grossBilled).toBe("100.00");expect(r.retention).toBe("10.00");expect(r.grossFeeRemaining).toBe("905.00");expect(r.actualPlusRemaining).toBe("37.47");
  state.schemaVersion=5;expect(reconcileContract(state).grossFeeRemaining).toBe("900.00");expect(reconcileContract(state).total.credits).toBe("5.00");
  for(const view of [r.byTask,r.byStaff,r.byDeliverable])expect(view.reduce((n,v)=>n+cents(v.totals.incurred),BigInt(0))).toBe(BigInt(1247));
 });
 it("uses the current source correction once and preserves proposed amendments",()=>{
  const {state,actual}=fixture();state.actuals.push({...actual,id:randomUUID(),version:2,amount:"20.00",allocations:actual.allocations.map(a=>({...a,amount:"20.00"}))});state.baselines.push({...state.baselines[0],id:randomUUID(),version:2,state:"proposed",content:{...state.baselines[0].content,fee:"2000.00"}});
  const r=reconcileContract(state);expect(r.total.incurred).toBe("20.00");expect(r.baseline?.version).toBe(1);expect(r.grossFeeRemaining).toBe("900.00");expect(state.actuals[0].amount).toBe("12.47");
 });
 it("refuses duplicate physical sources and unreconciled allocations",()=>{
  for(const broken of ["source","split","task","hours"]){const {state,actual}=fixture();if(broken==="source")state.actuals.push({...actual,id:randomUUID(),entry_id:randomUUID()});if(broken==="split")actual.allocations[0].amount="12.46";if(broken==="task")actual.allocations[0].taskId=randomUUID();if(broken==="hours")actual.allocations[0].hours="1.00";expect(()=>reconcileContract(state)).toThrow();}
 });
 it("withholds forecast cost for missing rates, unreviewed, unallocated, unmapped or stale shared sources",()=>{
  for(const gap of ["missing_estimate","unreviewed","unmapped","coverage","owp"]){const {state}=fixture();if(gap==="missing_estimate")state.estimates[0].command.cost=null;if(gap==="unreviewed")state.actuals[0].command.status="draft";if(gap==="unmapped")state.unmappedTime.push({id:randomUUID(),hours:"1.00",entry_date:"2026-09-01",staff_id:state.staff[0].id});if(gap==="owp")state.actuals[0].shared_source_stale=true;expect(reconcileContract(state,{coverageComplete:gap!=="coverage"}).actualPlusRemaining).toBeNull();}
 });
 it("excludes later invoices from dated snapshots and leaves undated or mixed-currency billing unassessed",()=>{
  const {report}=fixture();report.snapshot.invoices[0].sent_date="2026-09-06";expect(reconcileSnapshot(report).grossBilled).toBe("0.00");report.snapshot.invoices[0].sent_date=null;expect(reconcileSnapshot(report).grossBilled).toBeNull();report.snapshot.invoices[0].sent_date="2026-09-01";report.snapshot.invoices[0].currency_code="EUR";expect(reconcileSnapshot(report).grossBilled).toBeNull();
 });
 it("keeps unresolved fee terms and unknown opening hours explicit",()=>{
  const {state}=fixture();state.baselines[0].content.feeBasis="unassessed";state.actuals[0].command.category="opening";state.actuals[0].hours=null;state.actuals[0].allocations[0].hours=null;state.staff[0].active=false;const r=reconcileContract(state);expect(r.grossFeeRemaining).toBeNull();expect(r.unknownHours).toBe(1);expect(r.total.incurred).toBe("12.47");
 });
 it("aggregates beyond pagination limits with exact cents",()=>{
  const {state,actual}=fixture();state.actuals=Array.from({length:1501},(_,i)=>({...actual,id:randomUUID(),entry_id:randomUUID(),time_entry_id:randomUUID(),command:{...actual.command,sourceKey:`source-${i}`}}));expect(reconcileContract(state).total.incurred).toBe("18717.47");
 });
 it("retains original CSV mapping and retry identities while rejecting malformed or duplicate sources",()=>{
  const {command,state}=fixture(),request=randomUUID(),csv='key,date,description,hours\nsource-1,2026-09-01,"Draft, review",1.01\nsource-1,2026-09-02,Duplicate,2.00\nbad,2026-02-30,Invalid,1.00';
  const args=[csv,"synthetic.csv",{sourceKey:"key",entryDate:"date",description:"description",hours:"hours"},command,request,state.baselines[0].content.tasks] as const;
  const preview=previewContractCsv(...args),again=previewContractCsv(...args);expect(preview).toEqual(again);expect(preview.rows[0].command?.sourceReference).toContain(preview.hash);expect(preview.rows[0].command?.status).toBe("draft");expect(preview.rows[1].errors.join(" ")).toContain("Duplicate");expect(preview.rows[2].errors.join(" ")).toContain("calendar date");
 });
 it("exports reconciled money, source and baseline history with escaped notes",()=>{
  const {report}=fixture();report.snapshot.actuals[0].command.sourceReference='<script>alert("x")</script>';const html=contractSnapshotHtml(report),book=contractSnapshotWorkbook(report);expect(html).toContain("37.47");expect(html).toContain(report.snapshot_hash);expect(html).not.toContain("<script>");expect(utils.sheet_to_json(book.Sheets["Contract totals"],{header:1})[1]).toEqual(["Contract",12.47,0,0,0,1.01]);expect(book.SheetNames).toContain("Approved staff budgets");expect(book.SheetNames).toContain("Billing source allocations");
 });
 it("exposes overlapping opening balances and unallocated staff budgets",()=>{
  const {state,actual}=fixture();state.baselines[0].content.tasks[0].staff[0].cost="300.00";
  const opening:ActualVersion={...actual,id:randomUUID(),entry_id:randomUUID(),time_entry_id:null,command:{...actual.command,sourceKey:"opening",category:"opening",openingStart:"2026-09-01",openingEnd:"2026-09-07",openingBasis:"Synthetic opening ledger",entryDate:"2026-09-07"}};state.actuals.push(opening);
  const r=reconcileContract(state,{coverageComplete:true});expect(r.overlappingOpenings).toEqual([opening]);expect(r.actualPlusRemaining).toBeNull();expect(r.staffBudgetRemainders[0].cost).toBe("200.00");
  opening.command.reconciliationNote="Opening balance covers separate historical source items; detailed September time is excluded from that balance.";expect(reconcileContract(state,{coverageComplete:true}).actualPlusRemaining).toBe("49.94");
  opening.command.status="excluded";opening.amount=null;expect(reconcileContract(state,{coverageComplete:true}).actualPlusRemaining).toBe("37.47");
 });

 it("writes a wrapped and printable retained workbook with preserved exact source values",async()=>{
  const {report}=fixture();const rendered=await renderContractSnapshot(report,"xlsx"),zip=await JSZip.loadAsync(rendered.bytes);
  const styles=await zip.file("xl/styles.xml")!.async("string"),sheet=await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  expect(styles).toContain('wrapText="1"');expect(sheet).toContain('fitToWidth="1"');expect(sheet).toContain('sheetProtection');expect(sheet).toContain(report.snapshot_hash);
 });

 it("maps unique task and staff names without guessing between duplicates",()=>{
  const {command,state}=fixture();const csv="key,task,staff,hours,date,description\nSYNTH-CSV,Prepare draft,Synthetic staff,1.01,2026-09-01,Intake";
  const mapping={sourceKey:"key",taskId:"task",staffId:"staff",hours:"hours",entryDate:"date",description:"description"};
  const preview=previewContractCsv(csv,"synthetic.csv",mapping,command,randomUUID(),state.baselines[0].content.tasks,state.staff);
  expect(preview.rows[0].errors).toEqual([]);expect(preview.rows[0].command?.allocations[0].taskId).toBe(state.baselines[0].content.tasks[0].id);expect(preview.rows[0].command?.staffId).toBe(state.staff[0].id);
  const ambiguous=previewContractCsv(csv,"synthetic.csv",mapping,command,randomUUID(),[...state.baselines[0].content.tasks,{...state.baselines[0].content.tasks[0],id:randomUUID()}],state.staff);
  expect(ambiguous.rows[0].command).toBeNull();expect(ambiguous.rows[0].errors.join(" ")).toContain("one approved task");
 });

});
