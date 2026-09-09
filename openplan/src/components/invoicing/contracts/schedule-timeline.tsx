import type { ForecastResult } from "@/lib/invoicing/contracts/delivery-schema";
/** The adjacent schedule table remains the complete text alternative, including unsupported dates. */
export function ContractScheduleTimeline({result}:{result:ForecastResult}){
 const start=Date.parse(result.asOf),end=Date.parse(result.horizonEnd),span=Math.max(86400000,end-start+86400000);
 return <figure className="rounded border p-3"><figcaption className="mb-3">Forecast timeline, {result.asOf} to {result.horizonEnd}. Unsupported finishes have no bar.</figcaption><div aria-hidden="true" className="space-y-3">{result.nodes.map(n=><div key={n.id}><p className="mb-1 text-sm">{n.title}</p><div className="relative h-5 rounded bg-muted">{n.start&&n.finish&&<div className="absolute h-5 rounded bg-primary" style={{left:`${Math.max(0,(Date.parse(n.start)-start)/span*100)}%`,width:`${Math.max(.5,Math.min(100,(Date.parse(n.finish)-Math.max(start,Date.parse(n.start))+86400000)/span*100))}%`}}/>}</div></div>)}</div></figure>;
}
