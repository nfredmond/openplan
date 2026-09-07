'use client';
import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { GuidedFlow, GuidedFlowRow, useGuidedFlow } from '@/components/ui/guided-flow';
export function EngagementSetupReuse({campaignId,configurationVersionId,canWrite}:{campaignId:string;configurationVersionId:string|null;canWrite:boolean}) {
 const router=useRouter(),request=useRef<{title:string;id:string}|null>(null);
 const flow=useGuidedFlow({id:'reuse-engagement-setup',title:'Reuse this setup',submitLabel:'Create private draft',initialValues:{title:''},
  steps:[{id:'name',title:'What is the new consultation called?',fields:[{name:'title',label:'New consultation title',required:true}],render:flow=><GuidedFlowRow flow={flow} name="title" label="New consultation title"><input className="block w-full rounded border p-2" maxLength={200} {...flow.text("title")}/></GuidedFlowRow>}],
  onSubmit:async ({title})=>{
   if(!canWrite||!configurationVersionId)throw new Error('Staff access and a retained setup are required');
   if(request.current?.title!==title)request.current={title,id:crypto.randomUUID()};
   const response=await fetch(`/api/engagement/campaigns/${campaignId}/reuse`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title,configurationVersionId,requestId:request.current.id})});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'Setup could not be reused');router.push(`/engagement/${data.campaignId}`);
  }});
 if(!canWrite||!configurationVersionId)return null;
 return <section className="module-section-surface space-y-3"><h2 className="module-section-title">Reuse this setup</h2><p>Create a private draft with these categories, published question definitions, language, accessibility contacts and map layers. Questions return to draft and layers are hidden for review. Dates, project links and participation start fresh. No participant data or staff responses are copied.</p><Button type="button" onClick={flow.open}>Reuse this setup</Button><GuidedFlow flow={flow}/></section>;
}
