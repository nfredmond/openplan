"use client";
import type { ContractBaseline, ContractState } from "@/lib/invoicing/contracts/schema";
import { Field, inputClass, NoteField, TextField, useRetainedDraft, type CommandSender } from "./fields";
import { Button } from "@/components/ui/button";
export function BaselineForm({state,send,busy}:{state:ContractState;send:CommandSender;busy:boolean}) {
 const latest=state.baselines.at(-1);
 const draft=useRetainedDraft<ContractBaseline>(`contract-baseline:${state.engagement.id}:${latest?.version??0}`,latest?.content??{title:state.engagement.title,scope:"",currency:"USD",fee:null,cost:null,hours:null,feeBasis:"unassessed",feeTerms:"",sourceDocuments:[],approvalEvidence:"",tasks:[]});
 const value=draft.value;
 function set<K extends keyof ContractBaseline>(key:K,v:ContractBaseline[K]){draft.setValue({...value,[key]:v});}
 function task(index:number,patch:Partial<ContractBaseline["tasks"][number]>){set("tasks",value.tasks.map((t,i)=>i===index?{...t,...patch}:t));}
 return <form className="space-y-5" onSubmit={async e=>{e.preventDefault();await send({kind:"baseline",requestId:crypto.randomUUID(),baselineId:crypto.randomUUID(),expectedVersion:latest?.version??0,content:value});}}>
 <p className="text-sm text-muted-foreground">Save a proposal, then add its approval evidence. A proposal does not increase the approved budget. Empty amounts remain unassessed.</p>
 {draft.error&&<p role="alert">{draft.error}</p>}
 <TextField label="Baseline title" value={value.title} onChange={v=>set("title",v)} required/>
 <NoteField label="Agreed scope" value={value.scope} onChange={v=>set("scope",v)} required/>
 <div className="grid gap-3 sm:grid-cols-4">{(["fee","cost","hours"] as const).map(k=><TextField key={k} label={k==="fee"?"Approved fee":k==="cost"?"Internal cost budget":"Budget hours"} value={value[k]} onChange={v=>set(k,v||null)}/>)}<TextField label="Currency code" value={value.currency} onChange={v=>set("currency",v)}/></div>
 <Field label="Fee ceiling basis"><select className={inputClass} value={value.feeBasis} onChange={e=>set("feeBasis",e.target.value as ContractBaseline["feeBasis"])}><option value="unassessed">Agreement terms unassessed</option><option value="gross_fee">Confirmed gross fee before retention</option></select></Field>
 <NoteField label="Source for fee ceiling terms" value={value.feeTerms} onChange={v=>set("feeTerms",v)} required={value.feeBasis==="gross_fee"}/>
 <Field label="Retained agreement documents"><select className={inputClass} multiple size={Math.min(5,Math.max(2,state.documents.length))} value={value.sourceDocuments} onChange={e=>set("sourceDocuments",Array.from(e.target.selectedOptions,o=>o.value))}>{state.documents.map(d=><option key={d.id} value={d.id}>{d.title}</option>)}</select></Field>
 <p className="text-sm"><a className="underline" href={`/knowledge-base?workspaceId=${state.engagement.workspace_id}`}>Upload the agreement in Documents</a>, then reload this page. Select its retained file above.</p>
 {value.tasks.map((t,i)=><fieldset key={t.id} className="space-y-3 rounded border p-4"><legend className="px-2 font-medium">Task {i+1}</legend>
 <TextField label="Task name" value={t.title} onChange={v=>task(i,{title:v})} required/><NoteField label="Task scope and deliverable commitment" value={t.scope} onChange={v=>task(i,{scope:v})}/>
 <div className="grid gap-3 sm:grid-cols-4">{(["fee","cost","hours"] as const).map(k=><TextField key={k} label={`Task ${k}`} value={t[k]} onChange={v=>task(i,{[k]:v||null})}/>)}<TextField label="Agreed deadline" type="date" value={t.deadline} onChange={v=>task(i,{deadline:v||null})}/></div>
 <Field label="Project deliverable"><select className={inputClass} value={t.deliverableId??""} onChange={e=>task(i,{deliverableId:e.target.value||null})}><option value="">Unassigned deliverable</option>{state.deliverables.map(d=><option key={d.id} value={d.id}>{d.title}</option>)}</select></Field>
 {t.staff.map((s,j)=><div key={j} className="grid gap-3 sm:grid-cols-3"><Field label="Assigned staff"><select className={inputClass} required value={s.staffId} onChange={e=>task(i,{staff:t.staff.map((v,n)=>n===j?{...v,staffId:e.target.value}:v)})}><option value="">Select staff</option>{state.staff.map(v=><option key={v.id} value={v.id}>{v.name}{v.active?"":" (departed/inactive)"}</option>)}</select></Field>{(["hours","cost"] as const).map(k=><TextField key={k} label={`Staff ${k}`} value={s[k]} onChange={v=>task(i,{staff:t.staff.map((s,n)=>n===j?{...s,[k]:v||null}:s)})}/>)}<Button type="button" variant="outline" onClick={()=>task(i,{staff:t.staff.filter((_,n)=>n!==j)})}>Remove staff allocation</Button></div>)}
 <Button type="button" variant="outline" onClick={()=>task(i,{staff:[...t.staff,{staffId:"",hours:null,cost:null}]})}>Allocate staff</Button>
 <Button type="button" variant="outline" onClick={()=>set("tasks",value.tasks.filter((_,n)=>n!==i))}>Remove task from proposal</Button>
 </fieldset>)}
 <div className="flex flex-wrap gap-3"><Button variant="outline" type="button" onClick={()=>set("tasks",[...value.tasks,{id:crypto.randomUUID(),title:"",scope:"",fee:null,cost:null,hours:null,deadline:null,deliverableId:null,staff:[]}])}>Add internal task</Button><Button disabled={busy||!value.tasks.length}>Save proposed baseline</Button></div>
 </form>;
}
