import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { readAssignmentInvoicePosition } from "./invoice-position-server";
import type { InvoicePosition } from "./closeout-schema";
export type CashRow={id:string;engagement_id:string|null;client_id:string;due_date:string|null;updated_at:string};
export type DocumentedCash={rows:CashRow[];positions:(InvoicePosition&{clientId:string;dueOn:string|null})[];missing:number;failed:boolean};
/** One complete, request-scoped read supplies both the register and its currency/aging summaries. */
export const readDocumentedCash=cache(async(workspaceId:string):Promise<DocumentedCash>=>{
 const client=await createClient(),rows:CashRow[]=[];
 for(let offset=0;;offset+=200){
  const page=await client.from("client_invoices").select("id,engagement_id,client_id,due_date,updated_at").eq("workspace_id",workspaceId).in("status",["sent","paid"]).order("id").range(offset,offset+199);
  if(page.error)return {rows:[],positions:[],missing:0,failed:true};
  rows.push(...page.data);if(page.data.length<200)break;
 }
 const positions:DocumentedCash["positions"]=[];let missing=0;
 for(const row of rows){
  const position=row.engagement_id?(await readAssignmentInvoicePosition(row.engagement_id))?.find(i=>i.id===row.id&&i.direction==="outgoing"):null;
  if(!position||position.version!==row.updated_at){missing++;continue;}
  positions.push({...position,clientId:row.client_id,dueOn:row.due_date});
 }
 return {rows,positions,missing,failed:false};
});
