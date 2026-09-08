"use client";
import { useEffect, useState, type ReactNode } from "react";
export function Field({label,children}:{label:string;children:ReactNode}) { return <label className="grid min-w-0 gap-1 text-sm"><span className="font-medium">{label}</span>{children}</label>; }
export const inputClass="min-w-0 w-full rounded border border-input bg-background px-3 py-2 text-sm";
export function TextField({label,value,onChange,type="text",required=false}:{label:string;value:string|null;onChange:(value:string)=>void;type?:string;required?:boolean}) { return <Field label={label}><input className={inputClass} type={type} value={value??""} required={required} onChange={e=>onChange(e.target.value)}/></Field>; }
export function NoteField({label,value,onChange,required=false}:{label:string;value:string;onChange:(value:string)=>void;required?:boolean}) { return <Field label={label}><textarea className={inputClass} rows={3} value={value} required={required} onChange={e=>onChange(e.target.value)}/></Field>; }
export function useRetainedDraft<T>(key:string,initial:T) {
 const [value,setState]=useState(initial),[error,setError]=useState("");
 useEffect(()=>{
  // Browser storage is unavailable during server rendering. Read it after hydration.
  const frame=requestAnimationFrame(()=>{try{const saved=localStorage.getItem(key);if(saved)setState(JSON.parse(saved) as T);}catch{setError("Saved draft could not be read. Its browser copy has been retained.");}});
  return ()=>cancelAnimationFrame(frame);
 },[key]);
 function setValue(next:T){setState(next);if(!error)try{localStorage.setItem(key,JSON.stringify(next));}catch{setError("This browser could not retain the draft. Save before leaving this page.");}}
 return {value,setValue,error};
}
export type CommandSender=(command:import("@/lib/invoicing/contracts/schema").ContractCommand)=>Promise<boolean>;
