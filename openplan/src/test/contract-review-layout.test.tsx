import {afterEach,it,expect,vi} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {deliveryFixture} from "./fixtures/contract-delivery";
import {forecastDelivery} from "@/lib/invoicing/contracts/delivery";
import {ForecastWarnings} from "@/components/invoicing/contracts/forecast-warnings";
import {CalculationJobs} from "@/components/invoicing/contracts/calculation-jobs";
import {ContractManagement} from "@/components/invoicing/contracts/contract-management";
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams()}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});
it("groups repeated warnings while retaining every date, separate cause and affected-record link",()=>{
 const f=deliveryFixture(),result=forecastDelivery(f.state,f.delivery,f.options);result.warnings=[{code:"capacity_conflict",nodeId:f.work,staffId:f.staff,date:"2026-09-08",message:"Synthetic 9 hours reserved against 8 available"},{code:"capacity_conflict",nodeId:f.work,staffId:f.staff,date:"2026-09-10",message:"Synthetic 9 hours reserved against 8 available"},{code:"fee_threat",nodeId:null,staffId:null,date:null,message:"Synthetic fee threatened"}];
 const before=JSON.stringify(result);render(<ForecastWarnings result={result} engagementId={f.state.engagement.id}/>);
 const summary=screen.getByText(/2 dated warnings/);expect(summary.closest("details")).not.toHaveAttribute("open");fireEvent.click(summary);expect(screen.getByText("2026-09-08")).toBeInTheDocument();expect(screen.getByText("2026-09-10")).toBeInTheDocument();expect(screen.getByText("Synthetic fee threatened")).toBeInTheDocument();expect(screen.getByRole("link",{name:"Review affected Draft"})).toHaveAttribute("href",`/invoicing/engagements/${f.state.engagement.id}?tab=remaining&section=Capacity`);expect(JSON.stringify(result)).toBe(before);
});
it("keeps failed work and retry visible while completed processing history starts collapsed",async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>[{id:"done",kind:"forecast",status:"succeeded",attempts:2,failure_detail:null},{id:"failed",kind:"closeout",status:"failed",attempts:1,failure_detail:"Synthetic worker interruption"}]});vi.stubGlobal("fetch",fetcher);const completed=vi.fn().mockResolvedValue(undefined);render(<CalculationJobs engagementId="synthetic" onCompleted={completed}/>);
 await screen.findByText("Completed calculations (1)");expect(screen.getByText("Completed calculations (1)").closest("details")).not.toHaveAttribute("open");expect(screen.getByText("Closeout package: needs attention")).toBeVisible();expect(screen.getByText("Synthetic worker interruption")).toBeVisible();fireEvent.click(screen.getByRole("button",{name:"Retry original calculation"}));await waitFor(()=>expect(fetcher).toHaveBeenCalledWith('/api/invoicing/engagements/synthetic/management/jobs',expect.objectContaining({method:"POST",body:JSON.stringify({kind:"retry_calculation",jobId:"failed"})})));expect(completed).toHaveBeenCalledOnce();
});
it("mobile section selectors retain PM permission boundaries and reach the remaining-work form",async()=>{
 const f=deliveryFixture();f.state.delivery=f.delivery;vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>[]}));render(<ContractManagement initial={f.state}/>);
 const section=screen.getByLabelText("Contract section");for(const name of ["Rates","Billing","Master terms","Access"])expect(section.querySelector(`option[value="${name}"]`)).toBeNull();fireEvent.change(section,{target:{value:"Remaining work"}});fireEvent.change(screen.getByLabelText("Remaining work section"),{target:{value:"Forecasts"}});expect(screen.getByRole("button",{name:"Calculate or retain reviewed forecast"})).toBeInTheDocument();
});

it("does not show a zero cash position when financial source reconciliation fails",()=>{
 const f=deliveryFixture();f.state.invoices=[{id:"synthetic-invoice",invoice_number:"SYNTHETIC",status:"sent",subtotal_amount:"25.00",retention_amount:"0.00",currency_code:"USD",invoice_date:"2026-09-08",sent_date:"2026-09-08",updated_at:"2026-09-08T00:00:00Z"}];
 f.state.closeout={settlements:[{id:"synthetic-event",version:1,created_at:"2026-09-08T00:00:00Z",content:{eventId:"synthetic-event",sourceKey:"SYNTHETIC",direction:"outgoing",invoiceId:"synthetic-invoice",invoiceVersion:"2026-09-08T00:00:00Z",date:"2026-09-08",kind:"payment",amount:"5.00",currency:"CAD",state:"recorded",documentId:"synthetic-source",sourceReference:"Synthetic mismatched currency",correctionEvidence:"",legacyActualId:null},source_receipt:{id:"synthetic-source",checksum:"a".repeat(64),storageRef:"synthetic",bytes:1}}],deliverableEvents:[],versions:[],inputHash:"b".repeat(64)};
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>[]}));render(<ContractManagement initial={f.state}/>);expect(screen.getByRole("alert")).toHaveTextContent("Settlement currency differs");expect(screen.queryByText("Open invoice balances")).toBeNull();expect(screen.queryByText("Incurred internal cost")).toBeNull();
});
