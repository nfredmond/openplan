import Link from "next/link";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { classifyCronFreshness, readCronHeartbeatAt, CRON_JOB_SWEEP_DEADLINES } from "@/lib/notifications/cron-heartbeat";
import { isEmailTransportConfigured } from "@/lib/notifications/email";
import { ForecastTable } from "@/components/invoicing/contracts/delivery-management";
import { ContractScheduleTimeline } from "@/components/invoicing/contracts/schedule-timeline";
import { reconcileContract } from "@/lib/invoicing/contracts/reconciliation";
import type { ContractState } from "@/lib/invoicing/contracts/schema";
export const dynamic="force-dynamic";
export const metadata={title:"Weekly assignment management"};
export default async function WeeklyManagement({params}:{params:Promise<{projectId:string}>}){
 const {projectId}=await params,client=await createClient(),{data:{user}}=await client.auth.getUser();
 if(!user)return <main className="p-8">Sign in to review your assignments.</main>;
 const project=await client.from("projects").select("id,name,workspace_id").eq("id",projectId).maybeSingle();
 if(project.error||!project.data)return <main className="p-8">Project unavailable.</main>;
 const service=createServiceRoleClient(),states:ContractState[]=[];let unavailable=0,readFailed=false;
 for(let offset=0;;offset+=200){
  const page=await client.from("invoicing_engagements").select("id").eq("project_id",projectId).eq("workspace_id",project.data.workspace_id).order("id").range(offset,offset+199);
  if(page.error){readFailed=true;break;}
  for(const row of page.data){const r=await service.rpc("read_contract_management",{p_engagement_id:row.id,p_actor_id:user.id});if(r.error||!["owner","admin","pm","finance"].includes(r.data?.role))unavailable++;else states.push(r.data as ContractState);}
  if(page.data.length<200)break;
 }
 const heartbeat=await readCronHeartbeatAt(service as unknown as Parameters<typeof readCronHeartbeatAt>[0],CRON_JOB_SWEEP_DEADLINES),freshness=classifyCronFreshness(heartbeat);
 return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8"><Link className="underline" href={`/projects/${projectId}`}>Project overview</Link><h1 className="text-3xl font-semibold">Weekly assignment management</h1><p>{project.data.name}</p><p>Review the remaining work in each contract, shared staff reservations and saved response. Costs are shown only for assignments you manage.</p>{readFailed&&<p role="alert">The contract register could not be fully read. This view is incomplete.</p>}{unavailable>0&&<p>{unavailable} contracts require separate management access. Their costs and work are withheld.</p>}<section className="space-y-2 rounded border p-4"><h2 className="font-semibold">Updates and reminders</h2><Link className="underline" href={`/my-work?workspaceId=${project.data.workspace_id}`}>Open My Work for assigned tasks and pending PM reviews</Link><p>Existing reminder sweep: {freshness==="healthy"?`last succeeded ${heartbeat}`:freshness==="stale"?`stale, last succeeded ${heartbeat}`:"no successful run recorded"}. Email transport: {isEmailTransportConfigured()?"configured; delivery is recorded per message":"not configured"}.</p><p>Contract-specific automatic reminders are awaiting installation. My Work lists pending reviews when opened.</p></section>
 {states.map(state=>{
 const url=`/invoicing/engagements/${state.engagement.id}`,forecast=state.delivery?.forecasts.at(-1);let position:ReturnType<typeof reconcileContract>|null=null;try{position=reconcileContract(state);}catch{}
 return <section key={state.engagement.id} className="space-y-4 rounded border p-4"><h2 className="text-xl font-semibold"><Link className="underline" href={url}>{state.engagement.title}</Link></h2><nav className="flex flex-wrap gap-4">{["Updates","Schedule","Capacity","Forecasts","Responses"].map(section=><Link className="underline" key={section} href={`${url}?tab=remaining&section=${section}`}>{section}</Link>)}</nav>{forecast?<><p>Reviewed forecast {forecast.version}: {forecast.input_hash===state.delivery?.inputHash?"inputs unchanged":"stale; review changed inputs"}.</p><ForecastTable result={forecast.content.result} engagementId={state.engagement.id}/><ContractScheduleTimeline result={forecast.content.result}/></>:<p>No reviewed forecast. Review staff updates and calculate a forecast.</p>}
 {position?<details><summary>Task, staff and deliverable incurred-cost detail</summary>{([['Tasks',position.byTask],['Staff',position.byStaff],['Deliverables',position.byDeliverable]] as const).map(([title,rows])=><div key={title} className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="text-left font-semibold">{title}</caption><thead><tr><th>Work</th><th>Incurred cost</th><th>Hours</th><th>Open commitments</th></tr></thead><tbody>{rows.map(r=><tr className="border-t" key={r.id}><th className="py-2 font-normal">{r.label}</th><td>{r.totals.incurred}</td><td>{r.totals.hours}</td><td>{r.totals.commitments}</td></tr>)}</tbody></table></div>)}</details>:<p role="alert">Source allocations do not reconcile; no cost totals are asserted.</p>}
 <p>{state.responses?.responses.length??0} retained response comparisons; {state.responses?.applications.length??0} applied working schedules.</p></section>;
 })}{!states.length&&!readFailed&&<p>No contracts with designated management access are available here.</p>}</main>;
}
