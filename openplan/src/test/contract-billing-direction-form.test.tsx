import {afterEach,it,expect,vi} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {BaselineForm} from "@/components/invoicing/contracts/baseline-form";
import {deliveryFixture} from "./fixtures/contract-delivery";
import {contractCommandSchema} from "@/lib/invoicing/contracts/schema";
afterEach(()=>{cleanup();localStorage.clear();});
it("retains the selected purchaser perspective in a proposal without calling approval",async()=>{const {state}=deliveryFixture(),send=vi.fn().mockResolvedValue(true);render(<BaselineForm state={state} send={send} busy={false}/>);fireEvent.change(screen.getByLabelText("Agreement billing direction"),{target:{value:"received"}});fireEvent.click(screen.getByRole("button",{name:"Save proposed baseline"}));await waitFor(()=>expect(send).toHaveBeenCalledOnce());expect(send.mock.calls[0][0]).toMatchObject({kind:"baseline",expectedVersion:1,content:{billingDirection:"received"}});expect(contractCommandSchema.safeParse(send.mock.calls[0][0]).success).toBe(true);expect(state.baselines[0].content.billingDirection).toBeUndefined();});
it("starts an agreement without an inferred billing perspective",()=>{const {state}=deliveryFixture();state.baselines=[];render(<BaselineForm state={state} send={vi.fn()} busy={false}/>);expect(screen.getByLabelText("Agreement billing direction")).toHaveValue("unassessed");});

it("shows supplier cash totals separately from client invoices and refuses a pending correction total",async()=>{
 const {ContractManagement}=await import("@/components/invoicing/contracts/contract-management");
 const {state}=deliveryFixture();state.schemaVersion=6;state.baselines[0].content.billingDirection="received";state.closeout={settlements:[],deliverableEvents:[],versions:[],inputHash:"b".repeat(64)};
 state.invoices=[{id:crypto.randomUUID(),invoice_number:"SYNTH-CLIENT",status:"sent",subtotal_amount:"90.02",retention_amount:"4.00",currency_code:"USD",invoice_date:"2026-09-01",sent_date:"2026-09-01",updated_at:"2026-09-01T00:00:00Z"}];
 state.receivedInvoices=[{id:crypto.randomUUID(),invoice_id:crypto.randomUUID(),version:1,state:"approved",content:{number:"SYNTH-SUPPLIER",date:"2026-09-01",currency:"USD",total:"25.01",fileId:crypto.randomUUID(),lines:[]},review_note:"Synthetic",created_at:"2026-09-01T00:00:00Z"}];
 const {renderToStaticMarkup}=await import("react-dom/server");
 const html=renderToStaticMarkup(<ContractManagement initial={state}/>);
 expect(html).toMatch(/Open invoice balances<\/p><p[^>]*>25\.01<\/p>/);
 state.receivedInvoices[0].state="submitted";
 const pending=renderToStaticMarkup(<ContractManagement initial={state}/>);
 expect(pending).toMatch(/Open invoice balances<\/p><p[^>]*>Unassessed<\/p>/);
 expect(pending).toContain("correction still needs approval");
});
