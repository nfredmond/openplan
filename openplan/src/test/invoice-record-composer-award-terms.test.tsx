import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceRecordComposer } from "@/components/invoicing/invoice-record-composer";
import { awardTermsFixture, handoffId } from "./fixtures/grants/award-handoff";

vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
const workspaceId=handoffId(1), projectId=handoffId(2), a1=handoffId(3), a2=handoffId(4), r1=handoffId(11), r2=handoffId(12);
const props={workspaceId,projects:[{id:projectId,name:"Synthetic project"}],fundingAwards:[{id:a1,title:"First award",projectId},{id:a2,title:"Second award",projectId}],canWrite:true,defaultProjectId:projectId,defaultFundingAwardId:a1,defaultInvoiceNumber:"Synthetic invoice",defaultAmount:"100.01"};
function terms(award=a1,revision=r1,currency="EUR") {
  const actual=awardTermsFixture();actual.currency.code=currency;
  return {award:{id:award,workspace_id:workspaceId,project_id:projectId,current_handoff_revision_id:revision,latest_handoff_revision_id:revision,currency_code:currency},history:[{id:revision,terms:actual}]};
}
function response(data:unknown,ok=true){return {ok,json:async()=>data};}
function open(){fireEvent.click(screen.getByTestId("invoice-record-composer-open"));}
function next(){fireEvent.click(screen.getByRole("button",{name:/^Next/}));}
function review(){fireEvent.click(screen.getByLabelText(/I reviewed this exact current terms version/));}
function toSubmit(){next();next();next();fireEvent.click(screen.getByRole("button",{name:"Save the invoice record"}));}
beforeEach(()=>{vi.clearAllMocks();});

describe("invoice award review lifecycle, prepared and unrun",()=>{
  it.each(["foreign","incomplete"])("keeps %s award terms unavailable instead of treating them as legacy",async(kind)=>{
    const invalid=kind==="foreign" ? terms(a2) : {award:{id:a1,workspace_id:workspaceId,project_id:projectId},history:[]};
    const posted:RequestInit[]=[];
    vi.stubGlobal("fetch",vi.fn(async(url:unknown,init?:RequestInit)=>{
      if(String(url)==="/api/invoicing/invoices")posted.push(init!);
      return response(invalid);
    }));
    render(<InvoiceRecordComposer {...props}/>);open();
    await screen.findByRole("alert");toSubmit();
    await screen.findByText(/Load and review award terms before saving/);
    expect(posted).toHaveLength(0);expect(screen.queryByLabelText(/I reviewed this exact current terms version/)).toBeNull();
  });
  it("posts reviewed current EUR terms with exact string money",async()=>{
    const fetchMock=vi.fn(async(url:unknown)=>response(String(url)==="/api/invoicing/invoices"?{}:terms()));vi.stubGlobal("fetch",fetchMock);
    render(<InvoiceRecordComposer {...props}/>);open();
    await screen.findByLabelText(/I reviewed this exact current terms version/);review();toSubmit();
    await waitFor(()=>expect(fetchMock.mock.calls.some(([url])=>url==="/api/invoicing/invoices")).toBe(true));
    const post=fetchMock.mock.calls.find(([url])=>url==="/api/invoicing/invoices") as unknown as [string,RequestInit];
    expect(JSON.parse(String(post[1].body))).toMatchObject({fundingAwardId:a1,awardHandoffRevisionId:r1,currencyCode:"EUR",amount:"100.01"});
  });
  it("requires new review when current revision changes during final refresh, without posting the old review",async()=>{
    let reads=0;const posted:RequestInit[]=[];
    vi.stubGlobal("fetch",vi.fn(async(url:unknown,init?:RequestInit)=>{
      if(String(url)==="/api/invoicing/invoices"){posted.push(init!);return response({});}
      return response(terms(a1,++reads===1?r1:r2));
    }));
    render(<InvoiceRecordComposer {...props}/>);open();await screen.findByLabelText(/I reviewed this exact current terms version/);review();toSubmit();
    await screen.findByText(/Award terms changed. Review the current version/);
    expect(posted).toHaveLength(0);
    expect(screen.getByLabelText(/I reviewed this exact current terms version/)).not.toBeChecked();
    review();fireEvent.click(screen.getByRole("button",{name:"Save the invoice record"}));
    await waitFor(()=>expect(posted).toHaveLength(1));
    expect(JSON.parse(String(posted[0].body)).awardHandoffRevisionId).toBe(r2);
  });
  it("does not revive old review after clearing and choosing the same award again",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>response(terms())));
    render(<InvoiceRecordComposer {...props}/>);open();await screen.findByLabelText(/I reviewed this exact current terms version/);review();next();
    fireEvent.change(screen.getByLabelText("Funding award"),{target:{value:""}});
    expect(screen.queryByLabelText(/I reviewed this exact current terms version/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Funding award"),{target:{value:a1}});
    expect(await screen.findByLabelText(/I reviewed this exact current terms version/)).not.toBeChecked();
  });
  it("ignores stale success after choosing a different award",async()=>{
    let resolveOld!:(value:ReturnType<typeof response>)=>void;
    let first=true;
    vi.stubGlobal("fetch",vi.fn(async(url:unknown)=>{
      if(String(url).includes(a1) && first){first=false;return new Promise<ReturnType<typeof response>>((resolve)=>{resolveOld=resolve;});}
      return response(terms(a2,r2,"USD"));
    }));
    render(<InvoiceRecordComposer {...props}/>);open();next();
    fireEvent.change(screen.getByLabelText("Funding award"),{target:{value:a2}});
    await screen.findByLabelText(/I reviewed this exact current terms version/);
    await act(async()=>resolveOld(response(terms(a1,r1,"EUR"))));
    next();expect(screen.getByTestId("invoice-net-request")).toHaveTextContent(/USD\s*100\.01/);
    expect(screen.queryByText(/EUR/)).toBeNull();
  });
  it("ignores a stale rejected request after selection changed",async()=>{
    let rejectOld!:(error:Error)=>void;
    vi.stubGlobal("fetch",vi.fn(async(url:unknown)=>String(url).includes(a1)?new Promise<ReturnType<typeof response>>((_resolve,reject)=>{rejectOld=reject;}):response(terms(a2,r2,"USD"))));
    render(<InvoiceRecordComposer {...props}/>);open();next();fireEvent.change(screen.getByLabelText("Funding award"),{target:{value:a2}});
    await screen.findByLabelText(/I reviewed this exact current terms version/);
    await act(async()=>rejectOld(new Error("Stale award error")));
    expect(screen.queryByText(/Stale award error/)).toBeNull();expect(screen.getByLabelText(/I reviewed this exact current terms version/)).not.toBeChecked();
  });
  it("resets review and errors on reopen and when defaults change",async()=>{
    let fail=false;
    vi.stubGlobal("fetch",vi.fn(async(url:unknown)=>fail?response({error:"Synthetic unavailable terms"},false):response(terms(String(url).includes(a2)?a2:a1))));
    const view=render(<InvoiceRecordComposer {...props}/>);open();await screen.findByLabelText(/I reviewed this exact current terms version/);review();
    // Default form values are unchanged, so closing does not invoke discard confirmation.
    fireEvent.click(screen.getByRole("button",{name:"Close without saving"}));open();
    expect(await screen.findByLabelText(/I reviewed this exact current terms version/)).not.toBeChecked();
    fail=true;view.rerender(<InvoiceRecordComposer {...props} defaultFundingAwardId={a2}/>);open();
    await screen.findByText("Synthetic unavailable terms",{exact:false});
    fail=false;view.rerender(<InvoiceRecordComposer {...props}/>);open();
    await screen.findByLabelText(/I reviewed this exact current terms version/);
    expect(screen.queryByText(/Synthetic unavailable terms/)).toBeNull();expect(screen.getByLabelText(/I reviewed this exact current terms version/)).not.toBeChecked();
  });
});
