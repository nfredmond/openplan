import {it,expect,vi} from "vitest";
import {normalizeContractCommand,type CalculationClient} from "@/lib/invoicing/contracts/calculation";
import type {ContractCommand} from "@/lib/invoicing/contracts/schema";
vi.mock("@/lib/invoicing/contracts/delivery",()=>({validateSchedule:vi.fn(),forecastDelivery:()=>({finish:null})}));
const hash="a".repeat(64),other="b".repeat(64);
const command:Extract<ContractCommand,{kind:"forecast"}>={kind:"forecast",requestId:"10000000-0000-4000-8000-000000000001",expectedInputHash:hash,asOf:"2026-09-08",horizonEnd:"2026-09-30",coverageComplete:false,coverageEvidence:"Synthetic",reviewEvidence:"Synthetic"};
function client(before=hash,after=hash){
 const calls:string[]=[];let reads=0;
 const rpc:CalculationClient["rpc"]=async(name,args)=>{
  calls.push(name);expect(args).toEqual({p_engagement_id:"contract",p_actor_id:"actor"});
  return {data:name==="read_contract_management"?{delivery:{inputHash:hash,forecasts:[{retained:true}]}}:{inputHash:reads++===0?before:after},error:null};
 };
 return {rpc,calls};
}
it("brackets full input retrieval with authorized hash-only reads and retains the reviewed source version",async()=>{
 const service=client();const result=await normalizeContractCommand(service,"contract","actor",command);
 expect(service.calls).toEqual(["read_contract_delivery_version","read_contract_management","read_contract_delivery_version"]);
 expect(result).toMatchObject({_inputHash:hash,_request:command,_inputs:{delivery:{forecasts:[]}},_result:{finish:null}});
});
it.each([[other,hash],[hash,other]])("refuses a changing source version (%s, %s)",async(before,after)=>{
 await expect(normalizeContractCommand(client(before,after),"contract","actor",command)).rejects.toThrow("Forecast inputs changed during reading");
});
it("refuses a source version the caller has not reviewed",async()=>{
 await expect(normalizeContractCommand(client(),"contract","actor",{...command,expectedInputHash:other})).rejects.toThrow("changed since you opened this page");
});
