import { NextRequest } from "next/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { loadProviderProjectPacket, newProviderConnectionToken, PROVIDER_CONNECTION_COLUMNS, providerBody, providerBrowserOrigin, providerError, providerJson, providerRpcError, providerScopeSchema, providerUser, requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";

const createSchema = providerScopeSchema.extend({ label: z.string().trim().min(1).max(120), authMode: z.enum(["chatgpt", "apiKey"]) }).strict();
const revokeSchema = z.object({ connectionId: z.string().uuid() }).strict();

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.providers.connections.get", request);
  try {
    const { client, userId } = await providerUser();
    const scope = providerScopeSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    // Connection metadata stays visible to its owner after departure so it can
    // still be revoked. This projection never includes token digests or packets.
    const { data, error } = await client.from("assistant_provider_connections").select(PROVIDER_CONNECTION_COLUMNS)
      .eq("user_id", userId).eq("workspace_id", scope.workspaceId).eq("project_id", scope.projectId).order("created_at", { ascending: false }).limit(50);
    providerRpcError(error);
    audit.info("connections_read", { count: data?.length ?? 0 });
    return providerJson({ connections: data ?? [] });
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.providers.connections.post", request);
  try {
    requireProviderBrowserOrigin(request);
    const body = await providerBody(request, createSchema);
    const { client, userId } = await providerUser();
    await loadProviderProjectPacket(client, userId, { workspaceId: body.workspaceId, projectId: body.projectId });
    const { connectionId, token, tokenHash } = newProviderConnectionToken();
    const { data, error } = await createServiceRoleClient().rpc("create_assistant_provider_connection", {
      p_id: connectionId, p_user_id: userId, p_workspace_id: body.workspaceId, p_project_id: body.projectId,
      p_label: body.label, p_token_hash: tokenHash, p_auth_mode: body.authMode,
    });
    providerRpcError(error);
    // The token is shown once. Losing this response requires revoking that
    // connection and issuing another; the server cannot recover its plaintext.
    audit.info("connection_issued", { connectionId });
    return providerJson({ connection: data, setup: { version: 1, appUrl: providerBrowserOrigin(request),
      connectionId, workspaceId: body.workspaceId, projectId: body.projectId, expectedAuthMode: body.authMode, token } }, 201);
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}

export async function DELETE(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.providers.connections.delete", request);
  try {
    requireProviderBrowserOrigin(request);
    const body = await providerBody(request, revokeSchema);
    const { userId } = await providerUser();
    const { error } = await createServiceRoleClient().rpc("revoke_assistant_provider_connection", { p_id: body.connectionId, p_user_id: userId });
    providerRpcError(error);
    audit.info("connection_revoked", { connectionId: body.connectionId });
    return providerJson({ revoked: true });
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}
