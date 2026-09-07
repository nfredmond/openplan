"use client";
import {useEffect,useState} from "react";
import {downloadAuthenticatedArtifact} from "@/lib/export/download";
import {Button} from "@/components/ui/button";
const formats = ["html","pdf","xlsx"] as const;
type Format = typeof formats[number];
type State = {status:string; job?:{failure_detail?:string};artifact?:{checksum:string|null}};
export function WorkProgramExports({programId,revision}:{programId:string;revision:number}) {
  const [states,setStates]=useState<Partial<Record<Format,State>>>({});
  const [error,setError]=useState<string|null>(null);
  const [downloading,setDownloading]=useState<Format|null>(null);
  const [busy,setBusy]=useState(false);
  const [generation,setGeneration]=useState(0);
  const url=(format:Format)=>`/api/programs/${programId}/work-program/export?revision=${revision}&format=${format}`;
  useEffect(()=>{
    let active=true;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const read=async()=>{
      try {
        const results=await Promise.all(formats.map(async(format)=>{
          const response=await fetch(`/api/programs/${programId}/work-program/export?revision=${revision}&format=${format}`);
          if(!response.ok) throw new Error("Review file status could not be read. Saved proposals remain available.");
          return [format,await response.json()] as const;
        }));
        if(active) {setStates(Object.fromEntries(results));setError(null);if(results.some(([,value])=>["queued","running"].includes(value.status)))timer=setTimeout(()=>void read(),4000);}
      } catch(e) {if(active){setError(e instanceof Error?e.message:"Status unavailable");timer=setTimeout(()=>void read(),10000);}}
    };
    void read();
    return ()=>{active=false;clearTimeout(timer);};
  },[programId,revision,generation]);
  async function download(format:Format) {
    const checksum=states[format]?.artifact?.checksum;
    if(!checksum)return;
    setDownloading(format);setError(null);
    try {await downloadAuthenticatedArtifact(`${url(format)}&download=1`,`work-program-revision-${revision}.${format}`,checksum);}
    catch(e){setError(e instanceof Error?e.message:"Download unavailable");}
    finally{setDownloading(null);}
  }
  async function prepare() {
    setBusy(true);setError(null);
    try {
      for(const format of formats) {
        const response=await fetch(url(format),{method:"POST"});
        const result=await response.json();
        if(!response.ok) throw new Error(result.error??"Review files could not be queued");
        setStates(current=>({...current,[format]:{status:result.job.status,job:result.job}}));
      }
    } catch(e) {setError(e instanceof Error?e.message:"Preparation unavailable");}
    finally {setBusy(false);setGeneration(value=>value+1);}
  }
  return <div className="space-y-2"><Button type="button" variant="outline" disabled={busy} onClick={()=>void prepare()}>{busy?"Queuing review files…":"Prepare or retry review files"}</Button><p className="text-xs">Rendering continues in the Documents worker after leaving this page. Each file uses this saved revision.</p>{error&&<p role="alert">{error}</p>}<ul className="space-y-2">{formats.map(format=><li key={format}>{states[format]?.status==="succeeded"&&states[format]?.artifact?.checksum?<><Button type="button" variant="outline" disabled={downloading!==null} onClick={()=>void download(format)}>{downloading===format?"Downloading…":`Download ${format.toUpperCase()}`}</Button><p className="break-all text-xs">File SHA-256: {states[format]?.artifact?.checksum}</p></>:<span>{format.toUpperCase()}: {states[format]?.status??"Loading status"}{states[format]?.job?.failure_detail?` — ${states[format]?.job?.failure_detail}`:""}</span>}</li>)}</ul></div>;
}
