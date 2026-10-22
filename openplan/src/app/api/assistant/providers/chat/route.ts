import { NextRequest } from "next/server";
import { z } from "zod";
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
  try {
    rejectPersonalToken(request);
    const { client } = await providerUser(), query = Object.fromEntries(request.nextUrl.searchParams);
    if (query.operation === "options") {
      const input = z.object({ operation: z.literal("options"), workspaceId: z.string().uuid() }).strict().parse(query);
      const options = await loadChatOptions(client, input.workspaceId);
      return providerJson({ status: options.length ? "admitted" : "unassessed", options: options.map(o => ({ id: o.id, selection: o.record.selection })) });
    }
    if (query.operation === "history") {
      const input = z.object({ operation: z.literal("history"), workspaceId: z.string().uuid() }).strict().parse(query);
      return providerJson(await chatSessionRpc(client, "history", null, { workspaceId: input.workspaceId }));
    }
    const input = z.object({ turnId: z.string().uuid(), afterSequence: z.coerce.number().int().min(0).default(0) }).strict().parse(query);
    const minimal = await chatSessionRpc(client, "metadata", input.turnId);
    try { const { snapshot, grant } = await readChatSnapshot(client, input.turnId, input.afterSequence); return providerJson({ released: true, ...chatOwnerView(snapshot, grant) }); }
    catch { return providerJson({ released: false, ...await chatSessionRpc(client, "metadata", input.turnId), recoveryHref: minimal.recoveryHref }); }
  } catch (error) { return providerError(error); }
}
export async function POST(request: NextRequest) {
  try {
    requireProviderBrowserOrigin(request); rejectPersonalToken(request);
    const body = await providerBody(request, command), { client, userId } = await providerUser();
    if (body.operation === "prepare") return providerJson(await prepareChatGrant(client, userId, providerBrowserOrigin(request), body.input), 201);
    if (body.operation === "accept") return providerJson(await chatSessionRpc(client, "accept", body.turnId, { digest: body.digest, acceptanceRequestId: body.acceptanceRequestId }));
    if (body.operation === "cancel") return providerJson(await chatSessionRpc(client, "cancel", body.turnId));
    return providerJson(await driveChatTurn(client, userId, body.turnId, request.signal));
  } catch (error) { return providerError(error); }
}
