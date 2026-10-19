import { render, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReimbursementLane } from "@/app/(app)/invoicing/_components/reimbursement-lane";

const sources=vi.hoisted(()=>({rows:[] as Array<Record<string,unknown>>,awards:[] as Array<Record<string,unknown>>,selects:[] as Array<{table:string;columns:string}>}));
type ReadResult={data:Array<Record<string,unknown>>;error:null;count:number};
type ReadQuery={select:(columns:string)=>ReadQuery;eq:()=>ReadQuery;in:()=>ReadQuery;order:()=>Promise<ReadResult>;maybeSingle:()=>Promise<{data:null;error:null}>;then:Promise<ReadResult>["then"]};
vi.mock("server-only",()=>({}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/components/invoicing/invoice-record-composer",()=>({InvoiceRecordComposer:()=>null}));
vi.mock("@/components/invoicing/invoice-funding-award-linker",()=>({InvoiceFundingAwardLinker:()=>null}));
vi.mock("@/components/invoicing/invoice-triage-link-copy",()=>({InvoiceTriageLinkCopy:()=>null}));
vi.mock("@/components/operations/workspace-runtime-cue",()=>({WorkspaceRuntimeCue:()=>null}));
vi.mock("@/lib/operations/workspace-summary",()=>({loadWorkspaceOperationsSummaryForWorkspace:async()=>({nextCommand:null})}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({from:(table:string)=>{
  const data=table==="billing_invoice_records" ? sources.rows : table==="funding_awards" ? sources.awards : table==="projects" ? [{id:"p1",name:"Synthetic project",status:"active",delivery_phase:null}] : [];
  const result:ReadResult={data,error:null,count:data.length}; const completed=Promise.resolve(result);
  const query:ReadQuery={select:(columns:string)=>{sources.selects.push({table,columns});return query;},eq:()=>query,in:()=>query,order:()=>completed,maybeSingle:async()=>({data:null,error:null}),then:completed.then.bind(completed)};
  return query;
}})}));

function invoice(overrides:Record<string,unknown>={}) {
  return {id:"i1",project_id:"p1",funding_award_id:"a1",invoice_number:"Synthetic invoice",consultant_name:null,billing_basis:"lump_sum",status:"paid",invoice_date:null,due_date:null,amount:"100.01",retention_amount:"0.00",retention_percent:"0",net_amount:"100.01",award_handoff_revision_id:"r1",handoff_applicable_revision_id:"r2",currency_code:"EUR",supporting_docs_status:"complete",submitted_to:null,caltrans_posture:"lapm_conformed",notes:null,created_at:null,funding_awards:{id:"a1",title:"Synthetic award"},...overrides};
}
async function row(overrides:Record<string,unknown>={}) {
  sources.rows=[invoice(overrides)];
  render(await ReimbursementLane({workspaceId:"w1",canWriteInvoices:false,resolvedParams:{focusInvoiceId:"i1"}}));
  const node=document.getElementById("invoice-record-i1");expect(node).not.toBeNull();
  return within(node!);
}
beforeEach(()=>{sources.rows=[];sources.selects=[];sources.awards=[{id:"a1",project_id:"p1",title:"Synthetic award",current_handoff_revision_id:"r2",latest_handoff_revision_id:"r2",currency_code:"EUR"}];});

describe("actual reimbursement register row, prepared and unrun",()=>{
  it("renders original EUR cents and retained applicability inside the individual row",async()=>{
    const item=await row();
    expect(item.getByText(/Net EUR\s*100\.01/)).toBeInTheDocument();
    expect(item.getByText(/Gross EUR\s*100\.01.*Retention EUR\s*0\.00/)).toBeInTheDocument();
    expect(item.getByText(/Original terms r1. Currency EUR/)).toBeInTheDocument();
    expect(item.getByText(/Applicable to current terms r2 by explicit retained reconciliation/)).toBeInTheDocument();
    expect(item.queryByText(/\$100\.01/)).toBeNull();
    const projection=sources.selects.find((read)=>read.table==="billing_invoice_records")!.columns;
    for(const field of ["amount","retention_amount","net_amount","currency_code","award_handoff_revision_id","handoff_applicable_revision_id"])expect(projection.split(",").map((part)=>part.trim())).toContain(field);
    expect(item.getByText("Synthetic invoice")).toBeInTheDocument();
  });
  it("retains explicit USD zero without treating it as missing",async()=>{
    sources.awards[0].currency_code="USD";
    const item=await row({amount:0,net_amount:"0.00",currency_code:"USD"});
    expect(item.getByText(/Net USD\s*0\.00/)).toBeInTheDocument();
    expect(item.getByText(/Gross USD\s*0\.00.*Retention USD\s*0\.00/)).toBeInTheDocument();
  });
  it("renders positive USD cents at the managed row",async()=>{
    sources.awards[0].currency_code="USD";
    const item=await row({currency_code:"USD"});
    expect(item.getByText(/Net USD\s*100\.01/)).toBeInTheDocument();
    expect(item.getByText(/Gross USD\s*100\.01/)).toBeInTheDocument();
  });
  it.each([{currency_code:null},{award_handoff_revision_id:null}])("refuses an affirmative currency amount when its binding is unavailable: %j",async(overrides)=>{
    const item=await row(overrides);
    expect(item.getByText("Net Unassessed")).toBeInTheDocument();
    expect(item.getByText(/Amounts unassessed: retained terms version and currency/)).toBeInTheDocument();
    expect(item.queryByText(/\$100\.01|Net EUR/)).toBeNull();
  });
  it("keeps absent money separate from a recorded zero and leaves old-version applicability unassessed",async()=>{
    const item=await row({net_amount:null,amount:undefined,retention_amount:"0.00",handoff_applicable_revision_id:null});
    expect(item.getByText("Net Unassessed")).toBeInTheDocument();
    expect(item.getByText(/Gross Unassessed.*Retention EUR\s*0\.00/)).toBeInTheDocument();
    expect(item.getByText(/Current applicability unassessed/)).toBeInTheDocument();
  });
  it("leaves ordinary unmanaged USD rows available",async()=>{
    sources.awards=[{id:"a1",project_id:"p1",title:"Synthetic legacy award",current_handoff_revision_id:null,latest_handoff_revision_id:null,currency_code:null}];
    const item=await row({award_handoff_revision_id:null,handoff_applicable_revision_id:null,currency_code:null});
    expect(item.getByText("$100.01")).toBeInTheDocument();
    expect(item.queryByText(/Original terms/)).toBeNull();
  });
});
