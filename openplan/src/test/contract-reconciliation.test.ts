import { describe,it,expect } from "vitest";
import { randomUUID } from "node:crypto";
import { utils } from "xlsx";
import { cents } from "@/lib/programs/work-program/reporting";
import { contractActualSchema,type ContractState,type ContractSnapshot,type ActualVersion } from "@/lib/invoicing/contracts/schema";
import { reconcileContract,reconcileSnapshot } from "@/lib/invoicing/contracts/reconciliation";
import { contractSnapshotHtml,contractSnapshotWorkbook } from "@/lib/invoicing/contracts/export";
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
 it("separates internal cost, commitments, gross billing, retention, partial payments and credits",()=>{
  const {state,actual}=fixture();
  for(const category of ["commitment","payment","credit"] as const)state.actuals.push({...actual,id:randomUUID(),entry_id:randomUUID(),time_entry_id:null,command:{...actual.command,category,sourceKey:category},amount:"5.00",hours:null,allocations:actual.allocations.map(a=>({...a,amount:"5.00",hours:null}))});
  const r=reconcileContract(state,{coverageComplete:true});expect(r.total).toEqual({incurred:"12.47",hours:"1.01",commitments:"5.00",payments:"5.00",credits:"5.00"});expect(r.grossBilled).toBe("100.00");expect(r.retention).toBe("10.00");expect(r.grossFeeRemaining).toBe("905.00");expect(r.actualPlusRemaining).toBe("37.47");
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
});
