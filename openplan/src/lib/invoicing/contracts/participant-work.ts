import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {readEveryPage} from "@/lib/supabase/paged-read";
export type ParticipantAssignment={id:string;title:string;returned_invoices:number};
export type ParticipantWork={rows:ParticipantAssignment[];complete:boolean};
/** Reads only the current authenticated caller's explicit consultant grants. No workspace-wide service client. */
export async function loadParticipantWork(client:SupabaseClient):Promise<ParticipantWork>{
 try{
  const result=await readEveryPage<ParticipantAssignment>((from,to)=>client.from("contract_participant_my_work").select("id,title,returned_invoices").order("id").range(from,to));
  return {rows:result.complete?result.rows:[],complete:result.complete};
 }catch{return {rows:[],complete:false};}
}
