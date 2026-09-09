import { NextRequest } from "next/server";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { contractCalculationRequest } from "@/lib/invoicing/contracts/jobs-server";
import { createApiAuditLogger } from "@/lib/observability/audit";
type Context={params:Promise<{engagementId:string}>};
export async function GET(request:NextRequest,context:Context){createApiAuditLogger("invoicing.contract.calculation.read",request).info("contract_calculation_status_requested");return contractCalculationRequest(request,(await context.params).engagementId);}
export async function POST(request:NextRequest,context:Context){
 const body=await readJsonOrNullWithLimit(request,2_000_000);
 return body.ok?contractCalculationRequest(request,(await context.params).engagementId,body.data):body.response;
}
