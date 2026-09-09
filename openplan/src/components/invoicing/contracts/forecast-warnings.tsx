import Link from "next/link";
import type {ForecastResult,ForecastWarning} from "@/lib/invoicing/contracts/delivery-schema";
/** Repeated dated warnings share an explanation; every source date remains available. */
export function ForecastWarnings({result,engagementId}:{result:ForecastResult;engagementId?:string}){
 const groups=new Map<string,ForecastWarning[]>();
 for(const warning of result.warnings){const key=JSON.stringify([warning.code,warning.nodeId,warning.staffId,warning.message]);const group=groups.get(key)??[];group.push(warning);groups.set(key,group);}
 return <div className="space-y-3">{[...groups.entries()].map(([key,warnings])=>{
  const warning=warnings[0],name=result.nodes.find(n=>n.id===warning.nodeId)?.title,section=warning.code.includes("capacity")||warning.code.includes("availability")?"Capacity":warning.code.includes("update")||warning.code.includes("effort")?"Updates":"Schedule";
  const explanation=`${name?`${name}: `:""}${warning.message}`;
  const link=engagementId?<Link className="underline" href={`/invoicing/engagements/${engagementId}?tab=remaining&section=${section}`}>Review affected {name??"contract inputs"}</Link>:null;
  return warnings.length>1?<details key={key} className="rounded border p-3"><summary>{explanation} ({warnings.length} dated warnings)</summary><ul className="my-2 list-inside list-disc">{warnings.map((w,i)=><li key={i}>{w.date??"Date unassessed"}</li>)}</ul>{link}</details>:<div key={key} className="space-y-2 rounded border p-3"><p>{warning.date?`${warning.date} · `:""}{explanation}</p>{link}</div>;
 })}</div>;
}
