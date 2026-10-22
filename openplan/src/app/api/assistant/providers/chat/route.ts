import { NextRequest } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { providerBody, providerBrowserOrigin, providerError, providerJson, providerUser, requireProviderBrowserOrigin, ProviderRequestError } from "@/lib/assistant/provider-server";
import { chatOwnerView, chatPrepareSchema, chatSessionRpc, driveChatTurn, loadChatOptions, prepareChatGrant, readChatSnapshot } from "@/lib/assistant/provider-chat-server";

export const runtime = "nodejs";
// The durable lease, not a serverless timeout, governs interruption. This path
// requires an operator-admitted installation/pool; it does not promise unattended work.
export const maxDuration = 900;
const command = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("prepare"), input: chatPrepareSchema }).strict(),
  z.object({ operation: z.literal("accept"), turnId: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), acceptanceRequestId: z.string().uuid() }).strict(),
  z.object({ operation: z.literal("drive"), turnId: z.string().uuid() }).strict(),
  z.object({ operation: z.literal("cancel"), turnId: z.string().uuid() }).strict(),
]);
function rejectPersonalToken(request: Request) {
  if (request.headers.has("authorization")) throw new ProviderRequestError("chat_human_cookie_session_required", 401);
}
export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.providers.chat.get", request);
  try {
    rejectPersonalToken(request);
    const { client } = await providerUser(), query = Object.fromEntries(request.nextUrl.searchParams);
    if (query.operation === "options") {
      const input = z.object({ operation: z.literal("options"), workspaceId: z.string().uuid() }).strict().parse(query);
      const options = await loadChatOptions(client, input.workspaceId);
      audit.info("options_read", { status: 200 });
      return providerJson({ status: options.length ? "admitted" : "unassessed", options: options.map(o => ({ id: o.id, selection: o.record.selection })) });
    }
    if (query.operation === "history") {
      const input = z.object({ operation: z.literal("history"), workspaceId: z.string().uuid() }).strict().parse(query);
      const history = await chatSessionRpc(client, "history", null, { workspaceId: input.workspaceId });
      audit.info("history_read", { status: 200 });
      return providerJson(history);
    }
    const input = z.object({ turnId: z.string().uuid(), afterSequence: z.coerce.number().int().min(0).default(0) }).strict().parse(query);
    const minimal = await chatSessionRpc(client, "metadata", input.turnId);
    try {
      const { snapshot, grant } = await readChatSnapshot(client, input.turnId, input.afterSequence);
      const view = chatOwnerView(snapshot, grant);
      audit.info("progress_read", { status: 200, released: true });
      return providerJson({ released: true, ...view });
    } catch {
      const metadata = await chatSessionRpc(client, "metadata", input.turnId);
      audit.warn("progress_withheld", { status: 200, released: false });
      return providerJson({ released: false, ...metadata, recoveryHref: minimal.recoveryHref });
    }
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}
export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.providers.chat.post", request);
  try {
    requireProviderBrowserOrigin(request); rejectPersonalToken(request);
    const body = await providerBody(request, command), { client, userId } = await providerUser();
    const result = body.operation === "prepare" ? await prepareChatGrant(client, userId, providerBrowserOrigin(request), body.input)
      : body.operation === "accept" ? await chatSessionRpc(client, "accept", body.turnId, { digest: body.digest, acceptanceRequestId: body.acceptanceRequestId })
      : body.operation === "cancel" ? await chatSessionRpc(client, "cancel", body.turnId)
      : await driveChatTurn(client, userId, body.turnId, request.signal);
    const status = body.operation === "prepare" ? 201 : 200;
    audit.info("command_completed", { operation: body.operation, status });
    return providerJson(result, status);
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}
