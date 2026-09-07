'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
type Job={id:string;report_id:string;scope:string;filters_json:Record<string,unknown>;snapshot_sha256:string;status:string;phase:string;failure_detail:string|null;created_at:string;artifacts_json:Array<{format:string;checksum:string;byteLength:number}>};
export function EngagementReviewFiles({campaignId,reportId}:{campaignId:string;reportId?:string}) {
 const [jobs,setJobs]=useState<Job[]>([]),[scope,setScope]=useState('internal'),[status,setStatus]=useState('all'),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const [from,setFrom]=useState(''),[to,setTo]=useState('');
 const [request,setRequest]=useState<{id:string;payload:string}|null>(null);
 useEffect(()=>{
  let cancelled=false;
  const load=async()=>{try{const response=await fetch(`/api/engagement/campaigns/${campaignId}/reports${reportId?`?reportId=${reportId}`:''}`);const payload=await response.json();if(cancelled)return;if(!response.ok)throw new Error(payload.error||'Files unavailable');setJobs(payload.jobs);}catch(cause){if(!cancelled)setError(cause instanceof Error?cause.message:'Files unavailable');}};
  void load();const timer=setInterval(load,3000);return()=>{cancelled=true;clearInterval(timer);};
 },[campaignId,reportId]);
 async function queue() {
  setBusy(true);setError(null);
  try {
   const selection=JSON.stringify({scope,filters:{...(status==='all'?{}:{status}),...(from?{from:new Date(`${from}T00:00:00Z`).toISOString()}:{}),...(to?{to:new Date(`${to}T00:00:00Z`).toISOString()}:{})}});
   const id=request?.payload===selection?request.id:crypto.randomUUID();setRequest({id,payload:selection});
   const response=await fetch(`/api/engagement/campaigns/${campaignId}/reports`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:id,...JSON.parse(selection)})});
   const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Could not queue review files');setRequest(null);
   const refreshed=await fetch(`/api/engagement/campaigns/${campaignId}/reports`);if(refreshed.ok)setJobs((await refreshed.json()).jobs);
  } catch(cause){setError(cause instanceof Error?cause.message:'Could not queue review files');}finally{setBusy(false);}
 }
 async function control(job:Job,action:'cancel'|'retry') {
  const response=await fetch(`/api/engagement/campaigns/${campaignId}/reports/${job.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({action})});
  if(!response.ok)setError((await response.json()).error||'Job could not be changed');
 }
 return <section className="module-section-surface space-y-4" id="campaign-review-files"><h2 className="module-section-title">Engagement review files</h2>
  <p>Prepare PDF, XLSX and a portable ZIP from one saved consultation snapshot. Internal copies include pending, withheld and flagged contributions and review reasons. Public copies include approved contributions and reviewed responses. Missing historical definitions remain labelled.</p>
  {!reportId?<><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
   <label>Disclosure scope<select className="block w-full rounded border p-2" value={scope} onChange={event=>{setScope(event.target.value);if(event.target.value==='public')setStatus('approved');}}><option value="internal">Internal staff review</option><option value="public">Public review copy</option></select></label>
   <label>Review status<select className="block w-full rounded border p-2" value={status} onChange={event=>setStatus(event.target.value)} disabled={scope==='public'}><option value="all">All review states</option><option value="approved">Published</option><option value="pending">Pending</option><option value="flagged">Flagged for review</option><option value="rejected">Withheld</option></select></label>
   <label>Received from, UTC<input className="block w-full rounded border p-2" type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label>
   <label>Received before, UTC<input className="block w-full rounded border p-2" type="date" value={to} onChange={event=>setTo(event.target.value)}/></label>
  </div><Button type="button" onClick={queue} disabled={busy}>{busy?'Saving selection…':'Prepare PDF, XLSX and ZIP'}</Button></>:null}
  {error?<p role="alert">{error}</p>:null}
  <p className="text-xs text-muted-foreground">The latest 50 jobs appear here. Each report retains its files and snapshot. The local Documents export worker prepares queued files.</p>
  {(reportId?jobs.filter(job=>job.report_id===reportId):jobs).map(job=><article className="rounded border p-3 space-y-2" key={job.id}><p>{job.scope} · {job.status} · {job.phase}</p><p className="break-all text-xs">Snapshot SHA-256 {job.snapshot_sha256}</p><p className="text-xs">Filters {JSON.stringify(job.filters_json)}</p>{job.failure_detail?<p role="alert">{job.failure_detail}</p>:null}<div className="flex flex-wrap gap-3">
   <Link href={`/reports/${job.report_id}`} className="underline">Open retained report</Link>
   {job.status==='complete'?job.artifacts_json.map(file=><a key={file.format} className="underline" href={`/api/engagement/campaigns/${campaignId}/reports/${job.id}/download?format=${file.format}`}>Download {file.format.toUpperCase()}</a>):null}
   {['queued','running'].includes(job.status)?<Button type="button" variant="outline" onClick={()=>control(job,'cancel')}>Cancel preparation</Button>:null}
   {['failed','cancelled'].includes(job.status)?<Button type="button" variant="outline" onClick={()=>control(job,'retry')}>Retry saved snapshot</Button>:null}
  </div></article>)}
 </section>;
}
