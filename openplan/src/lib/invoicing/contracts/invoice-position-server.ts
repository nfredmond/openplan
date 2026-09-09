import "server-only";
import { cache } from "react";
import { contractAccess } from "./server";
import { settlementPosition } from "./closeout";
import type { ContractState } from "./schema";
/** Shared request cache keeps the register and management page on the same documented financial calculation. */
export const readAssignmentInvoicePosition=cache(async(engagementId:string)=>{
 const access=await contractAccess(engagementId);
 if(access.response||!["owner","admin","pm","finance"].includes(access.state.role))return null;
 try{return settlementPosition(access.state as ContractState);}catch{return null;}
});
