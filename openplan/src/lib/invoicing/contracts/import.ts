import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import { contractActualSchema,type ContractActual } from "./schema";
export const contractImportFields=["sourceKey","entryDate","description","hours","amount","staffId","taskId","timeEntryId","spendEntryId","owpVersionId"] as const;
export type ContractImportMapping=Partial<Record<typeof contractImportFields[number],string>>;
function stableId(requestId:string,index:number,kind:string){const h=createHash("sha256").update(`${requestId}:${index}:${kind}`).digest("hex");return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
/** Retain UTF-8 CSV text and deterministic row identities so interrupted imports retry exactly. */
export function previewContractCsv(csv:string,filename:string,mapping:ContractImportMapping,defaults:ContractActual,requestId:string,tasks:{id:string;deliverableId:string|null}[]) {
 const records=parse(csv,{columns:true,bom:true,skip_empty_lines:true,max_record_size:50000}) as Record<string,string>[];
 if(!records.length||records.length>200)throw new Error("Import 1 to 200 rows per file; split larger files while retaining source keys.");
 const hash=createHash("sha256").update(csv).digest("hex"),seen=new Set<string>();
 const rows=records.map((record,index)=>{
  const values=Object.fromEntries(contractImportFields.filter(f=>mapping[f]).map(f=>[f,(record[mapping[f]!]??"").trim()||null]));
  const task=tasks.find(t=>t.id===values.taskId);
  const candidate={...defaults,...Object.fromEntries(Object.entries(values).filter(([k])=>k!=="taskId")),kind:"actual",status:"draft",expectedVersion:0,requestId:stableId(requestId,index,"request"),entryId:stableId(requestId,index,"entry"),sourceReference:`${filename}; sha256:${hash}; CSV row ${index+1}; ${defaults.sourceReference}`,allocations:values.taskId?[{taskId:values.taskId,deliverableId:task?.deliverableId??null,share:10000}]:defaults.allocations};
  const parsed=contractActualSchema.safeParse(candidate),sourceKey=String(candidate.sourceKey??""),duplicate=seen.has(sourceKey);seen.add(sourceKey);
  return {row:index+1,errors:[...(!sourceKey?["Map a stable originating source key"]:[]),...(duplicate?["Duplicate source key in this file"]:[]),...(!parsed.success?parsed.error.issues.map(i=>`${i.path.join(".")}: ${i.message}`):[])],command:parsed.success&&!duplicate?parsed.data:null};
 });
 return {hash,filename,columns:Object.keys(records[0]),rows};
}
