"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
type Job={id:string;kind:string;status:"queued"|"running"|"failed"|"succeeded";attempts:number;failure_detail:string|null};
export function CalculationJobs({engagementId,onCompleted}:{engagementId:string;onCompleted:()=>Promise<void>}){
 const endpoint=`/api/invoicing/engagements/${engagementId}/management/jobs`;
 const [jobs,setJobs]=useState<Job[]>([]),[error,setError]=useState("");const completed=useRef(new Set<string>()),refresh=useRef(onCompleted);refresh.current=onCompleted;
 useEffect(()=>{
  let active=true;
  async function poll(){try{const response=await fetch(endpoint,{cache:"no-store"});const body=await response.json();if(!response.ok)throw new Error(body.error??"Calculation status unavailable");if(!active)return;setJobs(body);setError("");const newlyCompleted=(body as Job[]).filter(job=>job.status==="succeeded"&&!completed.current.has(job.id));if(newlyCompleted.length){await refresh.current();for(const job of newlyCompleted)completed.current.add(job.id);}}catch(e){if(active)setError(e instanceof Error?e.message:"Calculation status unavailable");}}
  void poll();const timer=setInterval(()=>void poll(),3000);return()=>{active=false;clearInterval(timer);};
 },[endpoint]);
 async function retry(id:string){try{const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind:"retry_calculation",jobId:id})});const body=await response.json();if(!response.ok)throw new Error(body.error??"Retry was not confirmed");setError("");}catch(e){setError(e instanceof Error?e.message:"Retry was not confirmed");}}
 return <section aria-label="Retained calculation jobs" className="space-y-2"><p className="text-sm text-muted-foreground">Calculations run in the local worker. Queued requests survive closing this page. A queue waiting for a worker does not mean the decision has been saved.</p>{error&&<p role="alert">{error}</p>}{jobs.map(j=><div key={j.id} className="rounded border p-3"><p>{j.kind.replaceAll("_"," ")}: {j.status}; attempts {j.attempts}</p>{j.failure_detail&&<p>{j.failure_detail}</p>}{j.status==="failed"&&<Button variant="outline" onClick={()=>void retry(j.id)}>Retry original calculation</Button>}</div>)}</section>;
}
