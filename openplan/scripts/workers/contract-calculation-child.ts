import { createServiceRoleClient } from "../../src/lib/supabase/server";
import { contractCommandSchema } from "../../src/lib/invoicing/contracts/schema";
import { normalizeContractCommand } from "../../src/lib/invoicing/contracts/calculation";
/** A separate process keeps the parent's lease renewal responsive during CPU work. */
process.once("message",async (message:{id:string;engagement_id:string;actor_id:string;command:unknown;token:string})=>{
 try{
  const service=createServiceRoleClient(),command=contractCommandSchema.parse(message.command);
  const normalized=await normalizeContractCommand(service,message.engagement_id,message.actor_id,command);
  const finished=await service.rpc("finish_contract_calculation",{p_job:message.id,p_token:message.token,p_normalized:{...(normalized as Record<string,unknown>),_request:command}});
  if(finished.error)throw new Error("Calculation commit refused");
  process.exitCode=0;
 }catch{process.exitCode=1;}finally{process.disconnect();}
});
