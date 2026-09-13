import { NextRequest } from "next/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { checkedProviderTurn, loadProviderProjectPacket, PROVIDER_TURN_COLUMNS, ProviderRequestError, providerBody, providerError, providerJson, providerRpcError, providerScopeSchema, providerUser, requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { providerProjectPrompt } from "@/lib/assistant/provider-project-task";
import { runProviderApiTurn } from "@/lib/assistant/provider-api-turn";

export const maxDuration = 60;
const base = providerScopeSchema.extend({ requestId: z.string().uuid(), question: z.string().trim().min(1).max(2000), model: z.string().trim().min(1).max(160) });
const createSchema = z.discriminatedUnion("provider", [
  base.extend({ provider: z.literal("api_connection"), connectionId: z.string().uuid(), revisionId: z.string().uuid(),
    configurationHash: z.string().regex(/^[a-f0-9]{64}$/), authMode: z.enum(["connection_api_key", "connection_no_key"]), acceptApiCharges: z.literal(true) }).strict(),
  base.extend({ provider: z.literal("codex"), connectionId: z.string().uuid(), authMode: z.enum(["chatgpt", "apiKey"]), acceptApiCharges: z.literal(true).optional() }).strict()
    .refine(body => body.authMode !== "apiKey" || body.acceptApiCharges === true, { message: "Native API billing requires explicit charge acknowledgement." }),
  base.extend({ provider: z.literal("claude"), connectionId: z.string().uuid(), authMode: z.literal("claude_subscription"),
    model: z.string().regex(/^claude-[a-z0-9-]{1,140}$/) }).strict(),
  base.extend({ provider: z.literal("opencode"), connectionId: z.string().uuid(), authMode: z.literal("opencode_api"),
    model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,139}$/), acceptApiCharges: z.literal(true) }).strict(),
  base.extend({ provider: z.literal("anthropic"), connectionId: z.null(), authMode: z.enum(["workspace_api_key", "deployment_api_key"]), acceptApiCharges: z.literal(true) }).strict(),
]);
const cancelSchema = z.object({ turnId: z.string().uuid() }).strict();
const listSchema = providerScopeSchema.extend({ requestId: z.string().uuid().optional() }).strict();

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.providers.turns.get", request);
  try {
    const { client, userId } = await providerUser();
    const scope = listSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    let query = client.from("assistant_provider_turns").select(PROVIDER_TURN_COLUMNS)
      .eq("user_id", userId).eq("workspace_id", scope.workspaceId).eq("project_id", scope.projectId);
    if (scope.requestId) query = query.eq("request_id", scope.requestId);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(20);
    providerRpcError(error);
    const service = createServiceRoleClient();
    const turns = [];
    for (const row of data ?? []) {
      const original = checkedProviderTurn(row).turn;
      // The RPC persists expiry and repeats current ownership/access under locks.
      const refreshed = await service.rpc("read_assistant_provider_turn_for_user", { p_turn_id: original.id, p_user_id: userId });
      providerRpcError(refreshed.error);
      turns.push(checkedProviderTurn(refreshed.data).turn);
    }
    audit.info("requests_read", { count: turns.length });
    return providerJson({ turns });
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.providers.turns.post", request);
  try {
    requireProviderBrowserOrigin(request);
    const body = await providerBody(request, createSchema);
    const { client, userId } = await providerUser();
    const packet = await loadProviderProjectPacket(client, userId, { workspaceId: body.workspaceId, projectId: body.projectId });
    providerProjectPrompt(packet, body.question);
    const service = createServiceRoleClient();
    const common = { p_request_id: body.requestId, p_user_id: userId, p_workspace_id: body.workspaceId,
      p_project_id: body.projectId, p_connection_id: body.connectionId, p_model_id: body.model,
      p_auth_mode: body.authMode, p_question: body.question, p_packet_canonical: JSON.stringify(packet) };
    // Saved API jobs are only queued here. The local worker owns dispatch and
    // completion; a retry must retain the original revision and project packet.
    const { data, error } = body.provider === "api_connection"
      ? await service.rpc("create_assistant_api_turn", { ...common, p_revision_id: body.revisionId,
        p_configuration_hash: body.configurationHash, p_charge_ack: body.acceptApiCharges })
      : await service.rpc("create_assistant_provider_turn", { ...common, p_provider: body.provider });
    providerRpcError(error);
    const saved = z.object({ created: z.boolean(), turn: z.unknown() }).parse(data);
    const original = checkedProviderTurn(saved.turn).turn;
    if (original.request_id !== body.requestId || original.workspace_id !== body.workspaceId || original.project_id !== body.projectId ||
      original.provider !== body.provider || original.model_id !== body.model || original.auth_mode !== body.authMode || original.question !== body.question ||
      (body.provider !== "api_connection" && original.connection_id !== body.connectionId)) {
      throw new ProviderRequestError("provider_retry_conflict", 409);
    }
    if (body.provider === "api_connection" && (original.provider !== "api_connection" || original.user_id !== userId ||
      original.api_connection_id !== body.connectionId || original.api_revision_id !== body.revisionId ||
      original.api_configuration_hash !== body.configurationHash ||
      (saved.created && original.packet_canonical !== common.p_packet_canonical))) {
      throw new ProviderRequestError("provider_retry_conflict", 409);
    }
    const turn = saved.created && body.provider === "anthropic"
      ? await runProviderApiTurn({ service, client, userId, turn: original, signal: request.signal }) : original;
    audit.info("request_retained", { turnId: turn.id, state: turn.state, created: saved.created });
    return providerJson({ created: saved.created, turn }, saved.created ? 201 : 200);
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}

export async function DELETE(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.providers.turns.delete", request);
  try {
    requireProviderBrowserOrigin(request);
    const body = await providerBody(request, cancelSchema);
    const { userId } = await providerUser();
    const service = createServiceRoleClient();
    const { error } = await service.rpc("cancel_assistant_provider_turn", { p_turn_id: body.turnId, p_user_id: userId });
    providerRpcError(error);
    const read = await service.rpc("read_assistant_provider_turn_for_user", { p_turn_id: body.turnId, p_user_id: userId });
    providerRpcError(read.error);
    const saved = checkedProviderTurn(read.data).turn;
    if (saved.id !== body.turnId || ["queued", "running"].includes(saved.state)) throw new ProviderRequestError("provider_cancellation_unconfirmed", 409);
    audit.info("cancellation_checked", { turnId: saved.id, state: saved.state });
    return providerJson({ cancelled: saved.state === "cancelled", state: saved.state, turnId: saved.id });
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}
