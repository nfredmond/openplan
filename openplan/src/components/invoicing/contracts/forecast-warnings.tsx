"use client";
import {useState} from "react";
import Link from "next/link";
import type {ForecastResult,ForecastWarning} from "@/lib/invoicing/contracts/delivery-schema";
import {forecastWarningNodes} from "@/lib/invoicing/contracts/forecast-warning-nodes";

function WarningGroup({result,warnings,engagementId}:{result:ForecastResult;warnings:ForecastWarning[];engagementId?:string}){
 const [open,setOpen]=useState(false),warning=warnings[0],nodes=forecastWarningNodes(result,warning);
 const name=nodes.length===1?nodes[0].title:nodes.length?`${nodes.length} schedule items`:null;
 const section=warning.code.includes("capacity")||warning.code.includes("availability")?"Capacity":warning.code.includes("update")||warning.code.includes("effort")?"Updates":"Schedule";
 const explanation=`${name?`${name}: `:""}${warning.message}`;
 const link=engagementId?<Link className="underline" href={`/invoicing/engagements/${engagementId}?tab=remaining&section=${section}`}>Review affected {name??"contract inputs"}</Link>:null;
 const attribution=<>{warning.staffId&&<p className="break-all">Staff record: {warning.staffId}</p>}{nodes.length>1&&<ul className="list-inside list-disc">{nodes.map(node=><li key={node.id}>{node.title}</li>)}</ul>}</>;
 return warnings.length>1||nodes.length>1?<details open={open} className="rounded border p-3"><summary onClick={event=>{event.preventDefault();setOpen(!open);}}>{explanation} ({warnings.length} dated warnings)</summary>{open&&<>{attribution}<ul className="my-2 list-inside list-disc">{warnings.map((w,i)=><li key={i}>{w.date??"Date unassessed"}</li>)}</ul>{link}</>}</details>:<div className="space-y-2 rounded border p-3"><p>{warning.date?`${warning.date} · `:""}{explanation}</p>{attribution}{link}</div>;
}

/** Group repeated explanations without expanding shared facts into one record per task. */
export function ForecastWarnings({result,engagementId}:{result:ForecastResult;engagementId?:string}){
 const [page,setPage]=useState(0),groups=new Map<string,ForecastWarning[]>();
 for(const warning of result.warnings){const key=JSON.stringify([warning.code,warning.nodeMask??warning.nodeId,warning.staffId,warning.message]);const group=groups.get(key)??[];group.push(warning);groups.set(key,group);}
 const entries=[...groups.entries()],last=Math.max(0,Math.ceil(entries.length/50)-1),current=Math.min(page,last);
 return <div className="space-y-3">{entries.slice(current*50,(current+1)*50).map(([key,warnings])=><WarningGroup key={key} result={result} warnings={warnings} engagementId={engagementId}/>)}{entries.length>50&&<nav aria-label="Forecast warning pages" className="flex flex-wrap items-center gap-3"><button type="button" disabled={current===0} onClick={()=>setPage(current-1)}>Previous warnings</button><span>Warning groups {current*50+1}–{Math.min((current+1)*50,entries.length)} of {entries.length}</span><button type="button" disabled={current===last} onClick={()=>setPage(current+1)}>Next warnings</button></nav>}</div>;
}
