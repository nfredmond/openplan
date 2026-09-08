import { NextRequest, NextResponse } from "next/server";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { contractAccess, saveContractCommand } from "@/lib/invoicing/contracts/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
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
 return saveContractCommand(request, (await context.params).engagementId, body.data);
}
