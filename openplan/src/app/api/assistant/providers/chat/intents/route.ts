import { NextRequest } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { chatIntentRpc, readChatIntentReview } from "@/lib/assistant/provider-chat-intents";
import { providerBody, providerError, providerJson, providerUser, requireProviderBrowserOrigin, ProviderRequestError } from "@/lib/assistant/provider-server";

export const runtime = "nodejs";
const command = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("claim_execution"), intentId: z.string().uuid(), originalApprovalId: z.string().uuid(), expectedExecutableHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ operation: z.literal("reconcile"), intentId: z.string().uuid() }).strict(),
  z.object({ operation: z.literal("repeat"), intentId: z.string().uuid(), repeatRequestId: z.string().uuid(), acknowledgePossibleDuplicate: z.literal(true) }).strict(),
]);
export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.providers.chat.intents.get", request);
  try {
    if (request.headers.has("authorization")) throw new ProviderRequestError("chat_human_cookie_session_required", 401);
    const input = z.object({ intentId: z.string().uuid(), review: z.enum(["true"]).optional() }).strict().parse(Object.fromEntries(request.nextUrl.searchParams));
    const { client } = await providerUser(), status = await chatIntentRpc(client, "status", input.intentId);
    if (!input.review) { audit.info("intent_status_read", { status: 200 }); return providerJson(status); }
    // A failed body check never turns a status-only recovery into a new card.
    const review = await readChatIntentReview(client, input.intentId);
    audit.info("intent_review_read", { status: 200 });
    return providerJson({ status, review });
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}
export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.providers.chat.intents.post", request);
  try {
    requireProviderBrowserOrigin(request);
    if (request.headers.has("authorization")) throw new ProviderRequestError("chat_human_cookie_session_required", 401);
    const body = await providerBody(request, command), { client } = await providerUser();
    const { operation, intentId, ...payload } = body;
    const result = await chatIntentRpc(client, operation, intentId, payload);
    audit.info("intent_command_completed", { operation, status: 200 });
    return providerJson(result);
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}
