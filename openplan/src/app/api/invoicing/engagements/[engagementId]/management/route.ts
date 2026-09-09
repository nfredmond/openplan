import { NextRequest, NextResponse } from "next/server";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { contractAccess, saveContractCommand } from "@/lib/invoicing/contracts/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { calculationKinds, contractCalculationRequest } from "@/lib/invoicing/contracts/jobs-server";
type Context = { params: Promise<{ engagementId: string }> };
export async function GET(request: NextRequest, context: Context) {
 const { engagementId } = await context.params;
 createApiAuditLogger("invoicing.contract.read", request).info("contract_requested", { engagementId });
 const access = await contractAccess(engagementId);
 return access.response ?? NextResponse.json(access.state, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: NextRequest, context: Context) {
 const body = await readJsonOrNullWithLimit(request, 2_000_000);
 if (!body.ok) return body.response;
 if (body.data && typeof body.data === "object" && "kind" in body.data && typeof body.data.kind === "string" && calculationKinds.has(body.data.kind)) return contractCalculationRequest(request,(await context.params).engagementId,body.data);
 return saveContractCommand(request, (await context.params).engagementId, body.data);
}
