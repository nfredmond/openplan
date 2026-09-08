import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createServiceRoleClient } from "../../src/lib/supabase/server";
/** Durable jobs recover expired leases. No business approval is inferred by a retry. */
async function main(){
 const service=createServiceRoleClient();let stopping=false;
 process.on("SIGTERM",()=>{stopping=true;});process.on("SIGINT",()=>{stopping=true;});
 while(!stopping){
  const token=randomUUID(),claimed=await service.rpc("claim_contract_calculation",{p_token:token});
  if(claimed.error){console.error("Contract calculation queue unavailable; retrying.");await delay(5000);continue;}
  const job=claimed.data as {id:string;engagement_id:string;actor_id:string;command:unknown}|null;
  if(!job?.id){await delay(2000);continue;}
  const child=fork(fileURLToPath(new URL("./contract-calculation-child.ts",import.meta.url)),[],{stdio:["ignore","ignore","ignore","ipc"]});
  const heartbeat=setInterval(()=>{void service.rpc("renew_contract_calculation",{p_job:job.id,p_token:token}).then(({data,error})=>{if(error||!data)child.kill("SIGTERM");});},20000);
  const completed=new Promise<number|null>(resolve=>{child.once("exit",code=>resolve(code));child.once("error",()=>resolve(1));});
  child.send({...job,token});
  const code=await completed;clearInterval(heartbeat);
  if(code!==0){await service.rpc("fail_contract_calculation",{p_job:job.id,p_token:token});console.error(`Contract calculation ${job.id} needs review or retry.`);}else console.log(`Retained contract calculation ${job.id}`);
 }
}
void main().catch(()=>{console.error("Contract calculation worker could not start.");process.exitCode=1;});
