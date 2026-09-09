import {it,expect,vi,afterEach} from "vitest";
import {render,screen,cleanup} from "@testing-library/react";
import type {SupabaseClient} from "@supabase/supabase-js";
vi.mock("server-only",()=>({}));
import {loadParticipantWork,type ParticipantAssignment} from "@/lib/invoicing/contracts/participant-work";
import {ContractParticipantWork} from "@/components/my-work/contract-participant-work";
afterEach(cleanup);
it("reads every capped participant page in stable order and suppresses partial lists",async()=>{
 const rows:ParticipantAssignment[]=[{id:"a",title:"Synthetic A",returned_invoices:1},{id:"b",title:"Synthetic B",returned_invoices:0}];const range=vi.fn(async(from:number):Promise<{data:ParticipantAssignment[];error:{message:string}|null}>=>({data:rows.slice(from,from+1),error:null})),order=vi.fn(()=>({range})),select=vi.fn(()=>({order})),from=vi.fn(()=>({select}));const client={from} as unknown as SupabaseClient;
 expect(await loadParticipantWork(client)).toEqual({rows,complete:true});expect(from).toHaveBeenCalledWith("contract_participant_my_work");expect(select).toHaveBeenCalledWith("id,title,returned_invoices");expect(order).toHaveBeenCalledWith("id");expect(range.mock.calls.map(([offset])=>offset)).toEqual([0,1,2]);
 range.mockImplementation(async(offset:number)=>offset===0?{data:rows.slice(0,1),error:null}:{data:[],error:{message:"Synthetic later-page failure"}});expect(await loadParticipantWork(client)).toEqual({rows:[],complete:false});
 range.mockResolvedValue({data:rows.slice(0,1),error:null});expect(await loadParticipantWork(client)).toEqual({rows:[],complete:false});
 range.mockRejectedValue(new Error("Synthetic transport unavailable"));expect(await loadParticipantWork(client)).toEqual({rows:[],complete:false});
});
it("renders the scoped invoice entry and keeps unknown work distinct from an empty queue",()=>{
 render(<ContractParticipantWork work={{rows:[{id:"contract-a",title:"Synthetic shared assignment",returned_invoices:2}],complete:true}} standalone/>);expect(screen.getByRole("link",{name:"Synthetic shared assignment"})).toHaveAttribute("href","/invoicing/engagements/contract-a?tab=received");expect(screen.getByText("2 returned invoices need correction.")).toBeInTheDocument();cleanup();render(<ContractParticipantWork work={{rows:[],complete:false}} standalone/>);expect(screen.getByRole("alert")).toHaveTextContent("Whether an invoice or correction is waiting is unknown");
});
