import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { reportingError } from "@/lib/programs/work-program/reporting-server";
import { contractCommandSchema } from "./schema";
export const calculationKinds = new Set(["forecast", "response", "closeout", "accounting_import"]);
/** Queue metadata never includes original accounting rows or a retained financial package. */
export async function contractCalculationRequest(request: NextRequest, engagementId: string, input?: unknown) {
 const client=await createClient(),{data:{user}}=await client.auth.getUser();
 if(!user)return NextResponse.json({error:"Sign in to manage this contract"},{status:401});
 const service=createServiceRoleClient();
 if(request.method==="GET"){
  const result=await service.rpc("read_contract_calculations",{p_engagement_id:engagementId,p_actor_id:user.id});
  return result.error?reportingError(result.error):NextResponse.json(result.data,{headers:{"Cache-Control":"private, no-store"}});
 }
 if(readAssistantExecutionSource(request)!=="manual")return NextResponse.json({error:"Contract calculations are not a registered Planner Agent action. Use the contract management page."},{status:403});
 const retry=z.object({kind:z.literal("retry_calculation"),jobId:z.string().uuid()}).strict().safeParse(input);
 const command=contractCommandSchema.safeParse(input);
 if(!retry.success&&(!command.success||!calculationKinds.has(command.data.kind)))return NextResponse.json({error:"Check the original calculation request, dates, source evidence and versions"},{status:400});
 const result=retry.success?await service.rpc("retry_contract_calculation",{p_job:retry.data.jobId,p_engagement_id:engagementId,p_actor_id:user.id}):await service.rpc("enqueue_contract_calculation",{p_engagement_id:engagementId,p_actor_id:user.id,p_command:command.data});
 const audit=createApiAuditLogger("invoicing.contract.calculation",request);
 if(result.error)audit.warn("contract_calculation_refused",{engagementId,code:result.error.code});
 else audit.info("contract_calculation_queued",{engagementId});
 return result.error?reportingError(result.error):NextResponse.json(result.data,{status:202,headers:{"Cache-Control":"private, no-store"}});
}
