import { afterEach,beforeEach,describe,it,expect,vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks=vi.hoisted(()=>({range:vi.fn(),select:vi.fn(),eq:vi.fn(),filter:vi.fn(),order:vi.fn(),read:vi.fn(),calendarSelect:vi.fn(),calendarEq:vi.fn(),calendarRow:null as {time_zone:string|null;home_country_code:string|null}|null}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({from:(table:string)=>table==="workspaces"?{select:mocks.calendarSelect}:{select:mocks.select}})}));
vi.mock("@/lib/invoicing/contracts/invoice-position-server",()=>({readAssignmentInvoicePosition:mocks.read}));
import { ContractCashPosition } from "@/components/invoicing/contracts/cash-position";
describe("documented invoice summary",()=>{
 afterEach(()=>vi.useRealTimers());
 beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));vi.clearAllMocks();mocks.select.mockReturnValue({eq:mocks.eq});mocks.eq.mockReturnValue({in:mocks.filter});mocks.filter.mockReturnValue({order:mocks.order});mocks.order.mockReturnValue({range:mocks.range});mocks.calendarRow=null;mocks.calendarEq.mockImplementation(()=>({maybeSingle:async()=>({data:mocks.calendarRow,error:null})}));mocks.calendarSelect.mockImplementation(()=>({eq:mocks.calendarEq}));});
 it("reads beyond the first page and keeps currency totals exact",async()=>{const rows=Array.from({length:201},(_,i)=>({id:String(i),engagement_id:"synthetic",client_id:"client",due_date:"2026-09-01",updated_at:"2026-09-08T00:00:00Z"}));mocks.range.mockImplementation(async(start:number,end:number)=>({data:rows.slice(start,end+1),error:null}));mocks.read.mockResolvedValue(rows.map((r,i)=>({id:r.id,direction:"outgoing",currency:i===200?"CAD":"USD",open:i===200?"0.01":"0.03",currentlyDue:i===200?"0.01":"0.03",payments:"0.00",refunds:"0.00",retention:"0.00",disputed:"0.00",version:"2026-09-08T00:00:00Z",warnings:[]})));const html=renderToStaticMarkup(await ContractCashPosition({workspaceId:"synthetic"}));expect(mocks.select).toHaveBeenCalledWith("id,engagement_id,client_id,due_date,updated_at");expect(mocks.eq).toHaveBeenCalledWith("workspace_id","synthetic");expect(mocks.filter).toHaveBeenCalledWith("status",["sent","paid"]);expect(mocks.range.mock.calls).toEqual([[0,199],[200,399],[201,400]]);expect(html).toContain("6.00");expect(html).toContain("USD");expect(html).toContain("0.01");expect(html).toContain("CAD");});
 it("ages the amount currently due, separates held cash and refuses a changed invoice version",async()=>{
  const row={id:"1",engagement_id:"synthetic",client_id:"client",due_date:"2026-08-01",updated_at:"2026-09-08T00:00:00.000001+00:00"};mocks.range.mockImplementation(async(start:number)=>({data:start===0?[row]:[],error:null}));
  const position={id:"1",direction:"outgoing",currency:"USD",open:"50.00",currentlyDue:"20.00",payments:"55.01",refunds:"5.00",retention:"10.00",disputed:"20.00",version:row.updated_at,warnings:[]};mocks.read.mockResolvedValue([position]);
  const html=renderToStaticMarkup(await ContractCashPosition({workspaceId:"synthetic",clientId:"client",details:true}));expect(html).toContain("50.00");expect(html).toContain("50.01");expect(html).toContain("31–60 days");expect(html).toContain('<td class="p-2">0.00</td><td class="p-2">0.00</td><td class="p-2">20.00</td>');
  position.version="2026-09-08T00:00:00.000002+00:00";expect(renderToStaticMarkup(await ContractCashPosition({workspaceId:"synthetic"}))).toContain("complete balance is unavailable");
 });
 it("does not claim a complete balance for inaccessible invoices or failed later pages",async()=>{mocks.range.mockImplementation(async(start:number)=>({data:start===0?[{id:"1",engagement_id:"private"}]:[],error:null}));mocks.read.mockResolvedValue(null);expect(renderToStaticMarkup(await ContractCashPosition({workspaceId:"synthetic"}))).toContain("complete balance is unavailable");mocks.range.mockResolvedValue({data:null,error:{message:"Synthetic read failure"}});expect(renderToStaticMarkup(await ContractCashPosition({workspaceId:"synthetic"}))).toContain("No total is asserted");});
 it("continues through a lower server cap and refuses a later failed page",async()=>{
  const rows=Array.from({length:5},(_,i)=>({id:String(i),engagement_id:"synthetic",client_id:"client",due_date:"2026-09-01",updated_at:"2026-09-08T00:00:00Z"}));
  mocks.range.mockImplementation(async(start:number)=>({data:rows.slice(start,start+2),error:null}));mocks.read.mockResolvedValue(rows.map(r=>({id:r.id,direction:"outgoing",currency:"USD",open:"0.03",currentlyDue:"0.03",payments:"0.00",refunds:"0.00",retention:"0.00",disputed:"0.00",version:r.updated_at,warnings:[]})));
  expect(renderToStaticMarkup(await ContractCashPosition({workspaceId:"synthetic"}))).toContain("0.15");expect(mocks.range.mock.calls).toEqual([[0,199],[2,201],[4,203],[5,204]]);expect(mocks.order).toHaveBeenCalledWith("id");
  mocks.range.mockImplementation(async(start:number)=>start<2?{data:rows.slice(0,2),error:null}:{data:null,error:{message:"Synthetic later failure"}});
  const html=renderToStaticMarkup(await ContractCashPosition({workspaceId:"synthetic"}));expect(html).toContain("No total is asserted");expect(html).not.toContain("0.06");
 });

it("keeps known balances but labels aging incomplete for unassessed hold allocation",async()=>{
 const row={id:"1",engagement_id:"synthetic",client_id:"client",due_date:"2026-09-01",updated_at:"2026-09-08T00:00:00Z"};mocks.range.mockImplementation(async(start:number)=>({data:start===0?[row]:[],error:null}));mocks.read.mockResolvedValue([{id:"1",direction:"outgoing",currency:"USD",open:"5.00",currentlyDue:null,payments:"95.00",refunds:"0.00",retention:"20.00",disputed:"10.00",version:row.updated_at,warnings:["Synthetic hold overlap unassessed"]}]);
 const html=renderToStaticMarkup(await ContractCashPosition({workspaceId:"synthetic",details:true}));expect(html).toContain("5.00 USD");expect(html).toContain("Known currently due amounts");expect(html).toContain("1 invoices have unassessed amounts currently due");expect(html).toContain("Aging is incomplete");
});

 it("keeps unknown-currency invoices separate from one another and known totals",async()=>{
 const rows=["1","2","3"].map(id=>({id,engagement_id:"synthetic",client_id:"client",updated_at:"2026-09-08"}));mocks.range.mockImplementation(async(start:number)=>({data:start===0?rows:[],error:null}));mocks.read.mockResolvedValue(rows.map((r,i)=>({id:r.id,number:"SYNTH-"+r.id,direction:"outgoing",currency:[null,"","USD"][i],open:["100.00","200.00","5.00"][i],currentlyDue:"5.00",payments:"1.00",credits:"2.00",refunds:"0.50",retention:"3.00",disputed:"4.00",version:r.updated_at,warnings:[]})));
 const html=renderToStaticMarkup(await ContractCashPosition({workspaceId:"synthetic",details:true}));expect(html).toContain("5.00 USD");expect(html.match(/class="text-2xl font-semibold"/g)).toHaveLength(1);expect(html).toContain("SYNTH-1: currency unassessed");expect(html).toContain("SYNTH-2: currency unassessed");expect(html).toContain("Documented open amount 100.00");expect(html).toContain("Documented open amount 200.00");expect(html).not.toContain("300.00");expect(html).toContain("complete balance is unavailable");
 });


 /** The aging row's six cells, in bucket order. */
 const agingCells=(html:string)=>[...(html.match(/<tbody><tr>(.*?)<\/tr><\/tbody>/)?.[1]??"").matchAll(/<td class="p-2">([^<]*)<\/td>/g)].map(m=>m[1]);
 async function ageOneInvoice(dueOn:string,zone:string|null,now:string){
  vi.setSystemTime(new Date(now));mocks.calendarRow=zone?{time_zone:zone,home_country_code:null}:null;
  const row={id:"1",engagement_id:"synthetic",client_id:"client",due_date:dueOn,updated_at:"2026-10-01T00:00:00Z"};mocks.range.mockImplementation(async(start:number)=>({data:start===0?[row]:[],error:null}));
  mocks.read.mockResolvedValue([{id:"1",direction:"outgoing",currency:"USD",open:"20.00",currentlyDue:"20.00",payments:"0.00",refunds:"0.00",retention:"0.00",disputed:"0.00",version:row.updated_at,warnings:[]}]);
  return renderToStaticMarkup(await ContractCashPosition({workspaceId:"synthetic",details:true}));
 }
 it("counts days past due on the workspace calendar, not the UTC day",async()=>{
  // 01:00 UTC Oct 15 is 6 p.m. Oct 14 in Los Angeles and 3 p.m. Oct 14 in Honolulu: an invoice due Oct 14 is not yet past due.
  for(const zone of ["America/Los_Angeles","Pacific/Honolulu"]){const html=await ageOneInvoice("2026-10-14",zone,"2026-10-15T01:00:00Z");expect(agingCells(html)).toEqual(["20.00","0.00","0.00","0.00","0.00","0.00"]);expect(html).toContain("as of 2026-10-14");}
  // With no zone it is UTC, said in the caption's date: already Oct 15.
  expect(agingCells(await ageOneInvoice("2026-10-14",null,"2026-10-15T01:00:00Z"))).toEqual(["0.00","20.00","0.00","0.00","0.00","0.00"]);
  // 20:00 UTC Oct 14 is 5 a.m. Oct 15 in Tokyo: one day past due there, not yet in UTC.
  const tokyo=await ageOneInvoice("2026-10-14","Asia/Tokyo","2026-10-14T20:00:00Z");expect(agingCells(tokyo)).toEqual(["0.00","20.00","0.00","0.00","0.00","0.00"]);expect(tokyo).toContain("as of 2026-10-15");
 });
 it("keeps the day across the autumn daylight saving change",async()=>{
  // 07:30 UTC Nov 2 is 11:30 p.m. PST Nov 1, the 25-hour day. An invoice due Nov 1 is not yet past due.
  expect(agingCells(await ageOneInvoice("2026-11-01","America/Los_Angeles","2026-11-02T07:30:00Z"))).toEqual(["20.00","0.00","0.00","0.00","0.00","0.00"]);
  expect(mocks.calendarSelect).toHaveBeenCalledWith("time_zone, home_country_code");expect(mocks.calendarEq).toHaveBeenCalledWith("id","synthetic");
 });
});
