import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
function open(){fireEvent.click(screen.getByTestId("invoice-record-composer-open"));next();}
function next(){fireEvent.click(screen.getByRole("button",{name:/^Next/}));}
const reviewName = /I reviewed this exact current terms version/;
function dialog(){return screen.getByRole("dialog");}
function checkbox(){return within(dialog()).getByRole("checkbox",{name:reviewName});}
function review(){fireEvent.click(checkbox());}
function save(){fireEvent.click(within(dialog()).getByRole("button",{name:"Save the invoice record"}));}
function toSubmit(){next();next();save();}
beforeEach(()=>{vi.clearAllMocks();});
afterEach(()=>{vi.unstubAllGlobals();});

// Real GuidedFlow and its dialog shim remain in use. Containment, DOM focus and
// click activation are asserted here. Native Tab/Space, inertness, scrolling and
// pointer interception still require root's identified desktop/390px journey.

describe("invoice award review lifecycle, prepared and unrun",()=>{
  it("selects project and award normally, reviews inside the active dialog, and preserves exact request binding", async () => {
    const fetchMock = vi.fn(async (url: unknown, _init?: RequestInit) =>
      response(String(url) === "/api/invoicing/invoices" ? {} : terms()));
    vi.stubGlobal("fetch", fetchMock);
    render(<InvoiceRecordComposer {...props} defaultProjectId={null} defaultFundingAwardId={null} />);
    open();
    fireEvent.change(within(dialog()).getByLabelText("Project"), { target: { value: projectId } });
    fireEvent.change(within(dialog()).getByLabelText("Funding award"), { target: { value: a1 } });
    await screen.findByRole("checkbox", { name: reviewName });

    const control = checkbox();
    expect(control.closest("dialog")).toBe(dialog());
    expect(dialog()).toHaveAttribute("open");
    expect(screen.getAllByRole("checkbox", { name: reviewName })).toHaveLength(1);
    expect(control).not.toBeDisabled();
    expect(control.tabIndex).toBe(0);
    expect(control.closest("details")).toHaveAttribute("open");
    control.focus();
    expect(control).toHaveFocus();
    review();
    expect(checkbox()).toBeChecked();
    next();
    expect(checkbox()).toBeChecked();
    fireEvent.change(screen.getByLabelText("Submitted to"), { target: { value: "Synthetic office" } });
    fireEvent.change(screen.getByLabelText("Gross amount"), { target: { value: "100.01" } });
    expect(checkbox()).toBeChecked();
    next();
    fireEvent.change(screen.getByLabelText("Anything to note?"), { target: { value: "Synthetic record only" } });
    expect(checkbox()).toBeChecked();
    expect(within(dialog()).getByText(`Current version: ${r1}. Currency: EUR.`)).toBeInTheDocument();
    save();

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/invoicing/invoices")).toHaveLength(1));
    const reads = fetchMock.mock.calls.filter(([url]) => url === `/api/funding-awards/${a1}/handoff`);
    expect(reads).toHaveLength(2);
    expect(reads[0][1]).toMatchObject({ cache: "no-store", signal: expect.any(AbortSignal) });
    expect(reads[1][1]).toEqual({ cache: "no-store" });
    const post = fetchMock.mock.calls.find(([url]) => url === "/api/invoicing/invoices")!;
    expect(post[1]).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    const payload = JSON.parse(String(post[1]?.body));
    expect(payload).toMatchObject({ workspaceId, projectId, fundingAwardId: a1, awardHandoffRevisionId: r1,
      currencyCode: "EUR", amount: "100.01", retentionPercent: "0", status: "draft",
      submittedTo: "Synthetic office", notes: "Synthetic record only" });
    expect(payload).not.toHaveProperty("reimbursementProfileId");
  });

  it("refuses unreviewed terms at final save while leaving review reachable inside that dialog", async () => {
    const fetchMock = vi.fn(async () => response(terms()));
    vi.stubGlobal("fetch", fetchMock);
    render(<InvoiceRecordComposer {...props} />);open();
    await screen.findByRole("checkbox", { name: reviewName });
    toSubmit();
    expect(await within(dialog()).findByText(/Review current effective award conditions before saving reimbursement/)).toBeInTheDocument();
    expect(checkbox()).not.toBeChecked();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("replaces refreshed currency and clears acknowledgement before accepting the new terms", async () => {
    let reads = 0;
    const posted: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) === "/api/invoicing/invoices") { posted.push(init!); return response({}); }
      return response(terms(a1, r1, ++reads === 1 ? "EUR" : "USD"));
    }));
    render(<InvoiceRecordComposer {...props} />);open();
    await screen.findByRole("checkbox", { name: reviewName });review();toSubmit();
    await within(dialog()).findByText(/Award terms changed. Review the current version/);
    expect(posted).toHaveLength(0);
    expect(checkbox()).not.toBeChecked();
    expect(within(dialog()).getByText(`Current version: ${r1}. Currency: USD.`)).toBeInTheDocument();
    save();
    await within(dialog()).findByText(/Review current effective award conditions before saving reimbursement/);
    expect(posted).toHaveLength(0);
    expect(reads).toBe(2);
    review();save();
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(JSON.parse(String(posted[0].body))).toMatchObject({ awardHandoffRevisionId: r1, currencyCode: "USD" });
  });

  it("shows pending reads inside the dialog and refuses save without an invoice request", async () => {
    let resolveRead!: (value: ReturnType<typeof response>) => void;
    const fetchMock = vi.fn(() => new Promise<ReturnType<typeof response>>((resolve) => { resolveRead = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<InvoiceRecordComposer {...props} />);open();
    expect(within(dialog()).getByRole("status")).toHaveTextContent("Review is pending");
    toSubmit();
    await within(dialog()).findByText(/Load and review award terms before saving/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("checkbox", { name: reviewName })).toBeNull();
    await act(async () => resolveRead(response(terms())));
    expect(checkbox()).not.toBeChecked();
  });

  it("shows no-effective terms without an acknowledgement or default adoption", async () => {
    const data = { ...terms(), award: { ...terms().award, current_handoff_revision_id: null } };
    const fetchMock = vi.fn(async () => response(data));
    vi.stubGlobal("fetch", fetchMock);
    render(<InvoiceRecordComposer {...props} />);open();
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("No effective award terms are available");
    expect(screen.queryByRole("checkbox", { name: reviewName })).toBeNull();
    toSubmit();
    await within(dialog()).findByText(/Review current effective award conditions before saving reimbursement/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a successful legacy read from unavailable managed terms", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      award: { ...terms().award, current_handoff_revision_id: null, latest_handoff_revision_id: null, currency_code: null }, history: [],
    })));
    render(<InvoiceRecordComposer {...props} />);open();
    expect(await within(dialog()).findByText(/No retained award conditions are recorded/)).toHaveTextContent("applicability remains unassessed");
    expect(screen.queryByRole("checkbox", { name: reviewName })).toBeNull();
  });

  it("does not apply a prior acknowledgement after a new selection read fails", async () => {
    const posted: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) === "/api/invoicing/invoices") { posted.push(init!); return response({}); }
      return String(url).includes(a2) ? response({ error: "Selected award terms unavailable" }, false) : response(terms());
    }));
    render(<InvoiceRecordComposer {...props} />);open();
    await screen.findByRole("checkbox", { name: reviewName });review();
    fireEvent.change(screen.getByLabelText("Funding award"), { target: { value: a2 } });
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Selected award terms unavailable");
    expect(screen.queryByRole("checkbox", { name: reviewName })).toBeNull();
    toSubmit();
    await within(dialog()).findByText(/Load and review award terms before saving/);
    expect(posted).toHaveLength(0);
  });

  it("clears review after project selection changes even when the award remains available", async () => {
    const data = { ...terms(), award: { ...terms().award, project_id: null } };
    vi.stubGlobal("fetch", vi.fn(async () => response(data)));
    render(<InvoiceRecordComposer {...props} />);open();
    await screen.findByRole("checkbox", { name: reviewName });review();
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "" } });
    expect(await screen.findByRole("checkbox", { name: reviewName })).not.toBeChecked();
    expect(screen.getByLabelText("Funding award")).toHaveValue(a1);
    toSubmit();
    await within(dialog()).findByText(/Review current effective award conditions before saving reimbursement/);
  });

  it("resets acknowledgement across workspace changes and removes entry when write permission is lost", async () => {
    const otherWorkspace = handoffId(99);
    let currentWorkspace = workspaceId;
    const posted: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) === "/api/invoicing/invoices") { posted.push(init!); return response({}); }
      return response({ ...terms(), award: { ...terms().award, workspace_id: currentWorkspace } });
    }));
    const view = render(<InvoiceRecordComposer {...props} />);open();
    await screen.findByRole("checkbox", { name: reviewName });review();
    currentWorkspace = otherWorkspace;
    view.rerender(<InvoiceRecordComposer {...props} workspaceId={otherWorkspace} />);open();
    expect(await screen.findByRole("checkbox", { name: reviewName })).not.toBeChecked();
    toSubmit();
    await within(dialog()).findByText(/Review current effective award conditions before saving reimbursement/);
    view.rerender(<InvoiceRecordComposer {...props} workspaceId={otherWorkspace} canWrite={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("invoice-record-composer-open")).toBeNull();
    expect(posted).toHaveLength(0);
  });

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
    expect(within(dialog()).getByText(`Current version: ${r2}. Currency: EUR.`)).toBeInTheDocument();
    save();
    await within(dialog()).findByText(/Review current effective award conditions before saving reimbursement/);
    expect(posted).toHaveLength(0);expect(reads).toBe(2);
    review();fireEvent.click(screen.getByRole("button",{name:"Save the invoice record"}));
    await waitFor(()=>expect(posted).toHaveLength(1));
    expect(JSON.parse(String(posted[0].body)).awardHandoffRevisionId).toBe(r2);
  });
  it("does not revive old review after clearing and choosing the same award again",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>response(terms())));
    render(<InvoiceRecordComposer {...props}/>);open();await screen.findByLabelText(/I reviewed this exact current terms version/);review();
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
    render(<InvoiceRecordComposer {...props}/>);open();
    fireEvent.change(screen.getByLabelText("Funding award"),{target:{value:a2}});
    await screen.findByLabelText(/I reviewed this exact current terms version/);
    await act(async()=>resolveOld(response(terms(a1,r1,"EUR"))));
    next();expect(screen.getByTestId("invoice-net-request")).toHaveTextContent(/USD\s*100\.01/);
    expect(screen.queryByText(/EUR/)).toBeNull();
  });
  it("ignores a stale rejected request after selection changed",async()=>{
    let rejectOld!:(error:Error)=>void;
    vi.stubGlobal("fetch",vi.fn(async(url:unknown)=>String(url).includes(a1)?new Promise<ReturnType<typeof response>>((_resolve,reject)=>{rejectOld=reject;}):response(terms(a2,r2,"USD"))));
    render(<InvoiceRecordComposer {...props}/>);open();fireEvent.change(screen.getByLabelText("Funding award"),{target:{value:a2}});
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
