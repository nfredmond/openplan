import {afterEach,it,expect,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {Forecasts} from "@/components/invoicing/contracts/delivery-management";
import {startForecastPreview,type ForecastPreviewReply} from "@/lib/invoicing/contracts/forecast-preview";
import {deliveryFixture} from "./fixtures/contract-delivery";
import {forecastDelivery} from "@/lib/invoicing/contracts/delivery";
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams()}));
class FakeWorker{
 static instances:FakeWorker[]=[];onmessage:((event:MessageEvent<ForecastPreviewReply>)=>void)|null=null;onerror:(()=>void)|null=null;onmessageerror:(()=>void)|null=null;
 postMessage=vi.fn();terminate=vi.fn();constructor(public url:URL){FakeWorker.instances.push(this);}
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();FakeWorker.instances=[];});
function setup(){vi.stubGlobal("Worker",FakeWorker);const f=deliveryFixture();f.state.delivery=f.delivery;const send=vi.fn().mockResolvedValue(true);const rendered=render(<Forecasts state={f.state} send={send} busy={false}/>);fireEvent.change(screen.getByLabelText("Forecast as-of date"),{target:{value:f.options.asOf}});fireEvent.change(screen.getByLabelText("Forecast horizon end"),{target:{value:f.options.horizonEnd}});fireEvent.change(screen.getByLabelText("Source coverage evidence"),{target:{value:"Synthetic complete sources"}});return {...f,send,...rendered};}
function submit(){fireEvent.submit(screen.getByRole("button",{name:"Calculate or retain reviewed forecast"}).closest("form")!);}
it("calculates preview outside the page and terminates it on completion",async()=>{
 const f=setup();submit();expect(screen.getByRole("status")).toHaveTextContent("Calculating preview");expect(f.send).not.toHaveBeenCalled();const worker=FakeWorker.instances[0];expect(worker.url.pathname).toContain("forecast-preview.worker.ts");expect(worker.postMessage).toHaveBeenCalledWith({state:f.state,delivery:f.delivery,options:{...f.options,coverageComplete:false}});
 await act(async()=>worker.onmessage?.({data:{result:forecastDelivery(f.state,f.delivery,f.options)}} as MessageEvent<ForecastPreviewReply>));expect(worker.terminate).toHaveBeenCalledOnce();expect(screen.getByText("Working preview; not a retained review")).toBeVisible();
});
it("queues reviewed calculation without starting a local preview",async()=>{
 const f=setup();fireEvent.change(screen.getByLabelText("Forecast review evidence; leave blank for preview"),{target:{value:"Synthetic PM accepted inputs"}});submit();await waitFor(()=>expect(f.send).toHaveBeenCalledWith(expect.objectContaining({kind:"forecast",expectedInputHash:f.delivery.inputHash,reviewEvidence:"Synthetic PM accepted inputs"})));expect(FakeWorker.instances).toHaveLength(0);
});
it("cancels and discards late replies, and disposes workers when leaving",async()=>{
 const f=setup();submit();const worker=FakeWorker.instances[0];fireEvent.click(screen.getByRole("button",{name:"Cancel preview"}));await act(async()=>worker.onmessage?.({data:{result:forecastDelivery(f.state,f.delivery,f.options)}} as MessageEvent<ForecastPreviewReply>));expect(worker.terminate).toHaveBeenCalled();expect(screen.queryByText("Working preview; not a retained review")).toBeNull();expect(screen.getByRole("alert")).toHaveTextContent("cancelled");submit();f.unmount();expect(FakeWorker.instances[1].terminate).toHaveBeenCalled();
});
it("discards calculations and previous previews after input changes",async()=>{
 const f=setup();submit();const worker=FakeWorker.instances[0],changed={...f.state};f.rerender(<Forecasts state={changed} send={f.send} busy={false}/>);expect(worker.terminate).toHaveBeenCalled();await act(async()=>worker.onmessage?.({data:{result:forecastDelivery(f.state,f.delivery,f.options)}} as MessageEvent<ForecastPreviewReply>));expect(worker.terminate).toHaveBeenCalled();expect(screen.queryByText("Working preview; not a retained review")).toBeNull();expect(screen.getByRole("button",{name:"Calculate or retain reviewed forecast"})).toBeEnabled();
 submit();await act(async()=>FakeWorker.instances[1].onmessage?.({data:{result:forecastDelivery(f.state,f.delivery,f.options)}} as MessageEvent<ForecastPreviewReply>));expect(screen.getByText("Working preview; not a retained review")).toBeVisible();f.rerender(<Forecasts state={{...changed}} send={f.send} busy={false}/>);expect(screen.queryByText("Working preview; not a retained review")).toBeNull();
});
it("reports calculation and transport errors without claiming a preview",async()=>{
 setup();submit();await act(async()=>FakeWorker.instances[0].onmessage?.({data:{error:"Synthetic dependency cycle"}} as MessageEvent<ForecastPreviewReply>));expect(screen.getByRole("alert")).toHaveTextContent("Synthetic dependency cycle");submit();await act(async()=>FakeWorker.instances[1].onerror?.());expect(screen.getByRole("alert")).toHaveTextContent("could not be calculated");expect(screen.queryByText("Working preview; not a retained review")).toBeNull();
});
it("cancels pending work and clears completed previews when forecast form fields change",async()=>{
 const f=setup();submit();const worker=FakeWorker.instances[0];
 fireEvent.change(screen.getByLabelText("Forecast horizon end"),{target:{value:"2026-10-31"}});
 expect(worker.terminate).toHaveBeenCalledOnce();expect(screen.queryByRole("status")).toBeNull();
 await act(async()=>worker.onmessage?.({data:{result:forecastDelivery(f.state,f.delivery,f.options)}} as MessageEvent<ForecastPreviewReply>));
 expect(screen.queryByText("Working preview; not a retained review")).toBeNull();
 for(const field of ["Reviewed incurred-cost source coverage is complete","Forecast as-of date","Source coverage evidence","Forecast review evidence; leave blank for preview"]){
  submit();await act(async()=>FakeWorker.instances.at(-1)?.onmessage?.({data:{result:forecastDelivery(f.state,f.delivery,f.options)}} as MessageEvent<ForecastPreviewReply>));
  expect(screen.getByText("Working preview; not a retained review")).toBeVisible();
  if(field.startsWith("Reviewed"))fireEvent.click(screen.getByLabelText(field));
  else fireEvent.change(screen.getByLabelText(field),{target:{value:field==="Forecast as-of date"?"2026-09-09":"Synthetic revised evidence"}});
  expect(screen.queryByText("Working preview; not a retained review")).toBeNull();
 }
 expect(f.send).not.toHaveBeenCalled();
});
it("terminates a worker when structured cloning fails",async()=>{
 vi.stubGlobal("Worker",FakeWorker);const f=deliveryFixture();
 class FailedCloneWorker extends FakeWorker{postMessage=vi.fn(()=>{throw new Error("Synthetic clone failure");});}
 vi.stubGlobal("Worker",FailedCloneWorker);const pending=startForecastPreview({state:f.state,delivery:f.delivery,options:f.options});await expect(pending.result).rejects.toThrow("Synthetic clone failure");expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
});
it("runs the worker's deterministic calculation and preserves validation errors",async()=>{
 const postMessage=vi.fn(),scope:{onmessage:((event:MessageEvent)=>void)|null;postMessage:typeof postMessage}={onmessage:null,postMessage};vi.stubGlobal("self",scope);await import("@/lib/invoicing/contracts/forecast-preview.worker");const f=deliveryFixture();scope.onmessage!({data:{state:f.state,delivery:f.delivery,options:f.options}} as MessageEvent);expect(postMessage).toHaveBeenLastCalledWith({result:forecastDelivery(f.state,f.delivery,f.options)});f.schedule.nodes[0].predecessors=[f.review];scope.onmessage!({data:{state:f.state,delivery:f.delivery,options:f.options}} as MessageEvent);expect(postMessage).toHaveBeenLastCalledWith({error:"Finish-to-start dependencies form a cycle."});
});
