"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ContractActual,ContractState } from "@/lib/invoicing/contracts/schema";
import type { ContractImportMapping } from "@/lib/invoicing/contracts/import";
import { emptyActual } from "./actual-form";
import { Field,inputClass,useRetainedDraft } from "./fields";
const fields=["sourceKey","entryDate","description","hours","amount","staffId","taskId","timeEntryId","spendEntryId","owpVersionId"] as const;
type Preview={hash:string;columns:string[];rows:{row:number;errors:string[];command:ContractActual|null}[]};
type Intake={requestId:string;csv:string;filename:string;mapping:ContractImportMapping;defaults:ContractActual};
export function ContractImportForm({state,onSaved}:{state:ContractState;onSaved:()=>Promise<void>}) {
 const draft=useRetainedDraft<Intake>(`contract-import:${state.engagement.id}`,{requestId:"",csv:"",filename:"",mapping:{},defaults:emptyActual(state.staff[0]?.id??null)});
 const input=draft.value,[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function run(commit:boolean){setBusy(true);setMessage("");try{const response=await fetch(`/api/invoicing/engagements/${state.engagement.id}/management/import`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...input,commit})});const body=await response.json();if(!response.ok)throw new Error(body.error);if(commit){setMessage(`${body.count} draft records retained with the original CSV. Review each valuation before approval.`);await onSaved();}else setPreview(body);}catch(e){setMessage(e instanceof Error?e.message:"Import was not confirmed. Retry the same retained file.");}finally{setBusy(false);}}
 return <details className="space-y-4 rounded border p-4"><summary className="font-semibold">Mapped CSV intake</summary><p className="text-sm">Import up to 200 UTF-8 rows with a header. The original text, file hash and row identities are retained. Existing source keys are refused, so retrying cannot duplicate costs.</p>
 {(message||draft.error)&&<p role="status">{message||draft.error}</p>}
 <Field label="Original CSV file"><input type="file" accept=".csv,text/csv" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>2000000)throw new Error("Choose a CSV smaller than 2 MB.");const csv=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());draft.setValue({...input,requestId:crypto.randomUUID(),csv,filename:file.name,defaults:{...input.defaults,requestId:crypto.randomUUID(),entryId:crypto.randomUUID()}});setPreview(null);}catch(error){setMessage(error instanceof Error?error.message:"CSV could not be read");}}}/></Field>
 {input.filename&&<p className="text-sm">Retained browser file: {input.filename}</p>}
 <div className="grid gap-3 sm:grid-cols-2">{fields.map(f=><Field label={`CSV column for ${f}`} key={f}><input className={inputClass} value={input.mapping[f]??""} onChange={e=>{draft.setValue({...input,mapping:{...input.mapping,[f]:e.target.value}});setPreview(null);}} placeholder="Exact header name, or leave empty"/></Field>)}</div>
 <Field label="Default record kind"><select className={inputClass} value={input.defaults.category} onChange={e=>{draft.setValue({...input,defaults:{...input.defaults,category:e.target.value as ContractActual["category"]}});setPreview(null);}}><option value="labor">Labor</option><option value="expense">Expense</option></select></Field>
 <Field label="Default valuation basis"><select className={inputClass} value={input.defaults.valuationBasis} onChange={e=>{draft.setValue({...input,defaults:{...input.defaults,valuationBasis:e.target.value as ContractActual["valuationBasis"]}});setPreview(null);}}><option value="unvalued">Unvalued</option><option value="recorded">Documented amount from CSV</option></select></Field>
 <Field label="Import source explanation"><textarea className={inputClass} value={input.defaults.sourceReference} onChange={e=>{draft.setValue({...input,defaults:{...input.defaults,sourceReference:e.target.value}});setPreview(null);}}/></Field>
 <div className="flex flex-wrap gap-3"><Button type="button" disabled={busy||!input.csv} variant="outline" onClick={()=>void run(false)}>Preview mapped records</Button><Button type="button" disabled={busy||!preview||preview.rows.some(r=>r.errors.length||!r.command)} onClick={()=>void run(true)}>Retain and import reviewed mapping</Button></div>
 {preview&&<div className="space-y-2"><p className="break-all text-xs">File SHA256: {preview.hash}</p>{preview.rows.map(r=><p className="text-sm" key={r.row}>Row {r.row}: {r.errors.length?r.errors.join("; "):`${r.command?.sourceKey} · ${r.command?.entryDate} · ${r.command?.hours??"Unknown"} hours · ${r.command?.amount??"Unvalued"}`}</p>)}</div>}
 </details>;
}
